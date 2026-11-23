"""Anthropic Claude implementation of LLMProvider (server-side only)."""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

import anthropic

from ...config import get_settings
from .base import (
    ChatResult,
    LLMError,
    LLMNotConfigured,
    LLMRefusal,
    LLMTransientError,
    LLMUsage,
    T,
    ToolCallRecord,
    ToolExecutor,
    ToolSpec,
    WebCitation,
    WebResearchResult,
    WebSearchHit,
)
from .pricing import estimate_cost

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_PAUSE_CONTINUATIONS = 4


class AnthropicProvider:
    name = "anthropic"

    def __init__(self) -> None:
        s = get_settings()
        self.model = s.llm_model
        self.effort = s.llm_effort
        self._api_key = s.anthropic_api_key
        self._fallbacks = s.anthropic_fallbacks
        self._web_search_type = s.web_search_tool_type
        self._client: anthropic.Anthropic | None = None

    # ------------------------------------------------------------------ plumbing

    def is_configured(self) -> bool:
        return bool(self._api_key)

    @property
    def client(self) -> anthropic.Anthropic:
        if not self._api_key:
            raise LLMNotConfigured("ANTHROPIC_API_KEY is not set. Add it in your environment to enable AI features.")
        if self._client is None:
            self._client = anthropic.Anthropic(api_key=self._api_key, max_retries=3, timeout=900.0)
        return self._client

    def _extra(self) -> dict[str, Any]:
        """Server-side refusal fallback (beta) - routes a policy decline to another model inside the same call."""
        if self._fallbacks and self._fallbacks != "off":
            return {"betas": [FALLBACK_BETA], "fallbacks": self._fallbacks}
        return {}

    def _usage(self, response: Any) -> LLMUsage:
        u = response.usage
        server = getattr(u, "server_tool_use", None)
        searches = int(getattr(server, "web_search_requests", 0) or 0) if server else 0
        model = getattr(response, "model", None) or self.model
        usage = LLMUsage(
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
            search_requests=searches,
            model=model,
        )
        usage.cost_usd = estimate_cost(
            model,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_tokens,
            usage.cache_write_tokens,
            usage.search_requests,
        )
        return usage

    def _call(self, fn: Any, **kwargs: Any) -> Any:
        """Invoke an SDK method, mapping SDK errors onto our error types."""
        try:
            return fn(**kwargs)
        except anthropic.AuthenticationError as e:
            raise LLMNotConfigured(f"Anthropic rejected the API key: {e.message}") from e
        except anthropic.BadRequestError as e:
            # A model or account that doesn't support the fallback beta: retry once without it.
            if "fallback" in str(e.message).lower() and "fallbacks" in kwargs:
                log.warning("Fallback parameter rejected; retrying without it")
                kwargs.pop("fallbacks", None)
                kwargs.pop("betas", None)
                self._fallbacks = "off"
                return self._call(fn, **kwargs)
            raise LLMError(f"Bad request to Anthropic API: {e.message}") from e
        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.InternalServerError) as e:
            raise LLMTransientError(str(e)) from e
        except anthropic.APIStatusError as e:
            if e.status_code >= 500 or e.status_code == 529:
                raise LLMTransientError(f"Anthropic API error {e.status_code}: {e.message}") from e
            raise LLMError(f"Anthropic API error {e.status_code}: {e.message}") from e

    @staticmethod
    def _check_refusal(response: Any) -> None:
        if getattr(response, "stop_reason", None) == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            raise LLMRefusal(f"The model declined this request{f' ({category})' if category else ''}.")

    # ------------------------------------------------------------------ structured output

    def structured(
        self, *, system: str, prompt: str, output_model: type[T], max_tokens: int = 16000,
        images: list[tuple[str, bytes]] | None = None,
    ) -> tuple[T, LLMUsage]:
        content: Any = prompt
        if images:
            content = [
                {"type": "image", "source": {"type": "base64", "media_type": mt, "data": base64.standard_b64encode(data).decode()}}
                for mt, data in images
            ] + [{"type": "text", "text": prompt}]
        response = self._call(
            self.client.beta.messages.parse,
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_format=output_model,
            output_config={"effort": self.effort},
            **self._extra(),
        )
        self._check_refusal(response)
        if response.stop_reason == "max_tokens":
            raise LLMError("Model output was cut off (max_tokens). Try narrowing the request.")
        parsed = response.parsed_output
        if parsed is None:
            raise LLMError("Model did not return output matching the expected schema.")
        return parsed, self._usage(response)

    # ------------------------------------------------------------------ web research

    def web_research(self, *, system: str, prompt: str, max_searches: int, country_code: str | None) -> WebResearchResult:
        tool: dict[str, Any] = {"type": self._web_search_type, "name": "web_search", "max_uses": max_searches}
        if country_code and len(country_code) == 2:
            tool["user_location"] = {"type": "approximate", "country": country_code.upper()}

        result = WebResearchResult()
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        for _ in range(MAX_PAUSE_CONTINUATIONS + 1):
            response = self._call(
                self.client.beta.messages.create,
                model=self.model,
                max_tokens=16000,
                system=system,
                messages=messages,
                tools=[tool],
                output_config={"effort": self.effort},
                **self._extra(),
            )
            self._check_refusal(response)
            result.usage.add(self._usage(response))
            self._collect_research_blocks(response.content, result)
            if response.stop_reason != "pause_turn":
                break
            # Server-side loop paused; re-send so it resumes where it stopped.
            messages = [messages[0], {"role": "assistant", "content": response.content}]
        return result

    @staticmethod
    def _collect_research_blocks(content: list[Any], result: WebResearchResult) -> None:
        for block in content:
            btype = getattr(block, "type", None)
            if btype == "server_tool_use" and getattr(block, "name", None) == "web_search":
                q = (getattr(block, "input", None) or {}).get("query")
                if q:
                    result.queries.append(q)
            elif btype == "web_search_tool_result":
                payload = getattr(block, "content", None)
                if isinstance(payload, list):
                    for hit in payload:
                        url = getattr(hit, "url", None)
                        if url:
                            result.hits.append(
                                WebSearchHit(url=url, title=getattr(hit, "title", None), page_age=getattr(hit, "page_age", None))
                            )
                else:
                    code = getattr(payload, "error_code", "unknown_error")
                    result.errors.append(f"web_search error: {code}")
            elif btype == "text":
                cites: list[WebCitation] = []
                for c in getattr(block, "citations", None) or []:
                    if getattr(c, "type", None) == "web_search_result_location" and getattr(c, "url", None):
                        cites.append(WebCitation(url=c.url, title=getattr(c, "title", None), cited_text=c.cited_text or ""))
                result.text_segments.append((block.text, cites))

    # ------------------------------------------------------------------ tool-calling chat

    def chat_with_tools(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[ToolSpec],
        execute: ToolExecutor,
        max_rounds: int,
    ) -> ChatResult:
        api_tools = [{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in tools]
        convo: list[Any] = list(messages)
        usage = LLMUsage()
        records: list[ToolCallRecord] = []
        response = None

        for _ in range(max_rounds):
            response = self._call(
                self.client.beta.messages.create,
                model=self.model,
                max_tokens=16000,
                system=system,
                messages=convo,
                tools=api_tools,
                output_config={"effort": self.effort},
                **self._extra(),
            )
            usage.add(self._usage(response))
            if response.stop_reason == "refusal":
                return ChatResult(
                    text="I can't help with that request.", tool_calls=records, usage=usage, stop_reason="refusal"
                )
            # Keep the assistant turn unchanged (including thinking blocks) - the history is append-only.
            convo.append({"role": "assistant", "content": response.content})
            if response.stop_reason == "pause_turn":
                continue
            tool_uses = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
            if response.stop_reason != "tool_use" or not tool_uses:
                break
            results = []
            for tu in tool_uses:
                tool_input = tu.input if isinstance(tu.input, dict) else json.loads(tu.input or "{}")
                ok, content, summary = execute(tu.name, tool_input)
                records.append(ToolCallRecord(tool=tu.name, input=tool_input, ok=ok, summary=summary))
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": content, "is_error": not ok})
            # All results for one assistant turn go back in a single user message.
            convo.append({"role": "user", "content": results})
        else:
            # Ran out of rounds while the model still wanted tools.
            text = _final_text(response) if response is not None else ""
            note = "\n\n_(Stopped after the maximum number of lookups for one answer.)_"
            return ChatResult(text=(text + note).strip(), tool_calls=records, usage=usage, stop_reason="max_rounds")

        text = _final_text(response) if response is not None else ""
        if response is not None and response.stop_reason == "max_tokens":
            text += "\n\n_(Answer truncated at the length limit.)_"
        return ChatResult(text=text, tool_calls=records, usage=usage, stop_reason=getattr(response, "stop_reason", None))


def _final_text(response: Any) -> str:
    return "".join(getattr(b, "text", "") for b in response.content if getattr(b, "type", None) == "text").strip()


_provider: AnthropicProvider | None = None


def get_llm() -> AnthropicProvider:
    global _provider
    if _provider is None:
        _provider = AnthropicProvider()
    return _provider
