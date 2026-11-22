"""Provider-neutral LLM interface. Agents depend on this, not on a vendor SDK."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Base error for LLM calls."""


class LLMNotConfigured(LLMError):
    """Raised when the provider has no credentials. Never fall back to fabricated output."""


class LLMRefusal(LLMError):
    """The model declined the request."""


class LLMTransientError(LLMError):
    """Rate limit, overload, timeout or network failure - safe to retry."""


@dataclass
class LLMUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    search_requests: int = 0
    cost_usd: float = 0.0
    model: str | None = None

    def add(self, other: LLMUsage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens
        self.search_requests += other.search_requests
        self.cost_usd += other.cost_usd
        self.model = other.model or self.model


@dataclass
class WebCitation:
    url: str
    title: str | None
    cited_text: str


@dataclass
class WebSearchHit:
    url: str
    title: str | None
    page_age: str | None


@dataclass
class WebResearchResult:
    """Raw output of a model-driven web research call. Hits and citations come from the provider, not the model."""

    text_segments: list[tuple[str, list[WebCitation]]] = field(default_factory=list)
    hits: list[WebSearchHit] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    usage: LLMUsage = field(default_factory=LLMUsage)


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolCallRecord:
    tool: str
    input: dict[str, Any]
    ok: bool
    summary: str


@dataclass
class ChatResult:
    text: str
    tool_calls: list[ToolCallRecord]
    usage: LLMUsage
    stop_reason: str | None


# Executes a tool call and returns (ok, content_for_model, short_summary_for_user).
ToolExecutor = Callable[[str, dict[str, Any]], tuple[bool, str, str]]


class LLMProvider(Protocol):
    name: str
    model: str

    def is_configured(self) -> bool: ...

    def structured(self, *, system: str, prompt: str, output_model: type[T], max_tokens: int = 16000) -> tuple[T, LLMUsage]: ...

    def web_research(self, *, system: str, prompt: str, max_searches: int, country_code: str | None) -> WebResearchResult: ...

    def chat_with_tools(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[ToolSpec],
        execute: ToolExecutor,
        max_rounds: int,
    ) -> ChatResult: ...
