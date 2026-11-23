"""Research providers: where evidence comes from.

Every provider returns an EvidenceBundle whose sources and excerpts come verbatim from
the provider (search engine / API), never written by the model. A provider that is not
configured reports exactly what is missing; nothing is ever simulated.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import urlparse

import httpx2

from ...config import get_settings
from .. import connectors
from ..llm.anthropic_provider import get_llm
from ..llm.base import LLMNotConfigured, LLMTransientError, LLMUsage

log = logging.getLogger(__name__)


@dataclass
class SourceDoc:
    ref: str  # S1, S2 ... stable within a bundle
    url: str
    title: str | None
    page_age: str | None
    excerpts: list[str] = field(default_factory=list)

    @property
    def domain(self) -> str | None:
        try:
            return urlparse(self.url).netloc or None
        except ValueError:
            return None


@dataclass
class EvidenceBundle:
    provider: str
    question: str
    notes: str = ""  # research notes with [S#] markers (model-written, cited)
    sources: list[SourceDoc] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    usage: LLMUsage = field(default_factory=LLMUsage)

    def by_ref(self) -> dict[str, SourceDoc]:
        return {s.ref: s for s in self.sources}

    def dossier(self, max_excerpt_chars: int = 1200) -> str:
        """Render the bundle as a numbered evidence dossier for the structuring step."""
        lines = []
        for s in self.sources:
            lines.append(f"[{s.ref}] {s.title or '(untitled)'}\nURL: {s.url}")
            if s.page_age:
                lines.append(f"Page age (from search engine): {s.page_age}")
            if s.excerpts:
                for ex in s.excerpts:
                    lines.append(f'Excerpt: "{ex[:max_excerpt_chars]}"')
            else:
                lines.append("Excerpt: (none captured - title only)")
            lines.append("")
        return "\n".join(lines).strip()


class ResearchProvider(Protocol):
    name: str
    label: str

    def is_configured(self) -> bool: ...

    def config_requirement(self) -> str | None: ...

    def gather(self, *, question: str, context: str, query_hints: list[str], country_code: str | None) -> EvidenceBundle: ...


class _SourceCollector:
    def __init__(self) -> None:
        self.sources: dict[str, SourceDoc] = {}

    def add(self, url: str, title: str | None, page_age: str | None = None, excerpt: str | None = None) -> SourceDoc:
        key = url.split("#")[0].rstrip("/")
        doc = self.sources.get(key)
        if doc is None:
            doc = SourceDoc(ref=f"S{len(self.sources) + 1}", url=url, title=title, page_age=page_age)
            self.sources[key] = doc
        if title and not doc.title:
            doc.title = title
        if page_age and not doc.page_age:
            doc.page_age = page_age
        if excerpt:
            ex = excerpt.strip()
            if ex and ex not in doc.excerpts and len(doc.excerpts) < 8:
                doc.excerpts.append(ex)
        return doc


RESEARCH_SYSTEM = """You are a meticulous market research analyst gathering evidence for an entrepreneur.
Search the web and report only what sources actually say. Rules:
- Every factual statement must be supported by a search result you cite. Do not state numbers (market sizes, growth rates, prices, duty rates, costs) from memory.
- If you cannot find reliable data for something, say plainly that it was not found. Never estimate or fill gaps silently.
- Prefer primary and reputable sources (government statistics, trade bodies, company sites, established publications). Note when a source is a vendor blog, press release, or paid market-research teaser.
- Note the year/date of each statistic when the source gives one.
- Be concise: short paragraphs of findings, each grounded in citations."""


class AnthropicWebSearchProvider:
    name = "anthropic_web_search"
    label = "Claude web search (Anthropic)"

    def is_configured(self) -> bool:
        return get_llm().is_configured()

    def config_requirement(self) -> str | None:
        if self.is_configured():
            return None
        return "Set ANTHROPIC_API_KEY. Web search must also be enabled for your organization in the Anthropic Console."

    def gather(self, *, question: str, context: str, query_hints: list[str], country_code: str | None) -> EvidenceBundle:
        settings = get_settings()
        hints = "\n".join(f"- {h}" for h in query_hints)
        prompt = (
            f"Business context:\n{context}\n\nResearch question:\n{question}\n\n"
            f"Useful search angles (adapt as needed):\n{hints}\n\n"
            "Report what you find, citing sources for every statement. List anything you could not find."
        )
        raw = get_llm().web_research(
            system=RESEARCH_SYSTEM, prompt=prompt, max_searches=settings.max_searches_per_step, country_code=country_code
        )
        collector = _SourceCollector()
        notes_parts: list[str] = []
        for text, cites in raw.text_segments:
            refs = []
            for c in cites:
                doc = collector.add(c.url, c.title, excerpt=c.cited_text)
                if doc.ref not in refs:
                    refs.append(doc.ref)
            notes_parts.append(text + (" [" + ", ".join(refs) + "]" if refs else ""))
        # Search hits that were returned but never cited are still recorded (title only).
        for hit in raw.hits:
            collector.add(hit.url, hit.title, page_age=hit.page_age)
        return EvidenceBundle(
            provider=self.name,
            question=question,
            notes="".join(notes_parts).strip(),
            sources=list(collector.sources.values()),
            queries=raw.queries,
            errors=raw.errors,
            usage=raw.usage,
        )


class TavilyProvider:
    name = "tavily"
    label = "Tavily Search API"

    def is_configured(self) -> bool:
        return bool(connectors.get_value("tavily", "api_key")) and get_llm().is_configured()

    def config_requirement(self) -> str | None:
        missing = []
        if not connectors.get_value("tavily", "api_key"):
            missing.append("a Tavily API key (Settings > Data sources)")
        if not get_llm().is_configured():
            missing.append("ANTHROPIC_API_KEY (used to structure findings)")
        return f"Set {', '.join(missing)}." if missing else None

    def gather(self, *, question: str, context: str, query_hints: list[str], country_code: str | None) -> EvidenceBundle:
        key = connectors.get_value("tavily", "api_key")
        if not key:
            raise LLMNotConfigured("TAVILY_API_KEY is not set.")
        collector = _SourceCollector()
        errors: list[str] = []
        queries = query_hints[: get_settings().max_searches_per_step]
        with httpx2.Client(timeout=30) as http:
            for q in queries:
                try:
                    r = http.post(
                        "https://api.tavily.com/search",
                        headers={"Authorization": f"Bearer {key}"},
                        json={"query": q, "max_results": 6, "search_depth": "advanced", "include_answer": False},
                    )
                    if r.status_code == 429 or r.status_code >= 500:
                        raise LLMTransientError(f"Tavily HTTP {r.status_code}")
                    if r.status_code in (401, 403):
                        raise LLMNotConfigured("Tavily rejected the API key.")
                    r.raise_for_status()
                    for item in r.json().get("results", []):
                        if item.get("url"):
                            collector.add(item["url"], item.get("title"), item.get("published_date"), item.get("content"))
                except (LLMTransientError, LLMNotConfigured):
                    raise
                except Exception as e:  # noqa: BLE001 - record and continue with other queries
                    errors.append(f"Tavily query failed ({q}): {e}")
        return EvidenceBundle(provider=self.name, question=question, sources=list(collector.sources.values()), queries=queries, errors=errors)


class BraveSearchProvider:
    name = "brave"
    label = "Brave Search API"

    def is_configured(self) -> bool:
        return bool(connectors.get_value("brave", "api_key")) and get_llm().is_configured()

    def config_requirement(self) -> str | None:
        missing = []
        if not connectors.get_value("brave", "api_key"):
            missing.append("a Brave Search API key (Settings > Data sources)")
        if not get_llm().is_configured():
            missing.append("ANTHROPIC_API_KEY (used to structure findings)")
        return f"Set {', '.join(missing)}." if missing else None

    def gather(self, *, question: str, context: str, query_hints: list[str], country_code: str | None) -> EvidenceBundle:
        key = connectors.get_value("brave", "api_key")
        if not key:
            raise LLMNotConfigured("BRAVE_SEARCH_API_KEY is not set.")
        collector = _SourceCollector()
        errors: list[str] = []
        queries = query_hints[: get_settings().max_searches_per_step]
        with httpx2.Client(timeout=30) as http:
            for q in queries:
                try:
                    params = {"q": q, "count": 8}
                    if country_code:
                        params["country"] = country_code.lower()
                    r = http.get(
                        "https://api.search.brave.com/res/v1/web/search",
                        headers={"X-Subscription-Token": key, "Accept": "application/json"},
                        params=params,
                    )
                    if r.status_code == 429 or r.status_code >= 500:
                        raise LLMTransientError(f"Brave HTTP {r.status_code}")
                    if r.status_code in (401, 403):
                        raise LLMNotConfigured("Brave Search rejected the API key.")
                    r.raise_for_status()
                    for item in (r.json().get("web") or {}).get("results", []):
                        if not item.get("url"):
                            continue
                        doc = collector.add(item["url"], item.get("title"), item.get("page_age") or item.get("age"), item.get("description"))
                        for extra in item.get("extra_snippets") or []:
                            collector.add(doc.url, None, excerpt=extra)
                except (LLMTransientError, LLMNotConfigured):
                    raise
                except Exception as e:  # noqa: BLE001
                    errors.append(f"Brave query failed ({q}): {e}")
        return EvidenceBundle(provider=self.name, question=question, sources=list(collector.sources.values()), queries=queries, errors=errors)


PROVIDERS: dict[str, ResearchProvider] = {
    p.name: p for p in (AnthropicWebSearchProvider(), TavilyProvider(), BraveSearchProvider())
}


def get_research_provider(name: str | None = None) -> ResearchProvider:
    key = name or get_settings().research_provider
    if key not in PROVIDERS:
        raise LLMNotConfigured(f"Unknown research provider '{key}'. Options: {', '.join(PROVIDERS)}.")
    return PROVIDERS[key]
