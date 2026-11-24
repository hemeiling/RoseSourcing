"""Structured output falls back to validated JSON when a schema is too large to compile; step schemas stay small."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.services.agents import opportunity
from app.services.agents.research_schemas import ExtractedSizeChart, StepExtraction
from app.services.llm.anthropic_provider import AnthropicProvider
from app.services.llm.base import LLMError

from .fakes import FakeLLM

GOOD = {"brand_or_seller": "Brand A", "product_type": "Latin dress", "garment_type": "dress", "unit": "cm",
        "rows": [{"size": "S", "other_labels": [], "measurements": [{"dimension": "bust", "min": 80, "max": 84}]}],
        "fit_notes": None, "source_ref": None}


def _response(text: str):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn", model="claude-opus-5-5",
                           usage=SimpleNamespace(input_tokens=100, output_tokens=50, server_tool_use=None))


def _provider(monkeypatch, replies: list[str]) -> tuple[AnthropicProvider, list[dict]]:
    p = AnthropicProvider()
    p._api_key, p._fallbacks = "test", "off"
    sent: list[dict] = []
    parse, create = object(), object()
    p._client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(parse=parse, create=create)))

    def fake_call(fn, **kw):
        if fn is parse:
            raise LLMError("Bad request to Anthropic API: The compiled grammar is too large, which would cause performance issues.")
        sent.append(kw)
        return _response(replies.pop(0))

    monkeypatch.setattr(p, "_call", fake_call)
    return p, sent


def test_grammar_too_large_falls_back_to_validated_json(monkeypatch):
    p, sent = _provider(monkeypatch, ["Here you go:\n```json\n" + json.dumps(GOOD) + "\n```"])
    out, usage = p.structured(system="sys", prompt="p", output_model=ExtractedSizeChart)
    assert out.rows[0].measurements[0].max == 84 and usage.input_tokens == 100
    assert "JSON Schema" in sent[0]["system"] and "output_format" not in sent[0]
    assert "cache_control" not in sent[0]  # a one-shot call would only pay the cache-write premium


def test_invalid_json_gets_one_repair_round(monkeypatch):
    bad = {**GOOD, "unit": "furlongs"}
    p, sent = _provider(monkeypatch, [json.dumps(bad), json.dumps(GOOD)])
    out, usage = p.structured(system="sys", prompt="p", output_model=ExtractedSizeChart)
    assert out.unit == "cm" and len(sent) == 2 and usage.input_tokens == 200
    assert "does not validate" in sent[1]["messages"][-1]["content"]

    p, _ = _provider(monkeypatch, [json.dumps(bad), "still not json"])
    with pytest.raises(LLMError, match="expected schema"):
        p.structured(system="sys", prompt="p", output_model=ExtractedSizeChart)


def test_step_schemas_only_carry_their_own_records():
    full = len(json.dumps(StepExtraction.model_json_schema()))
    for key in opportunity.STEP_DEFS:
        model = opportunity.step_output_model(key)
        fields = set(model.model_fields)
        assert fields - {"findings", "evidence_gaps"} == ({opportunity.STEP_RECORDS[key]} if key in opportunity.STEP_RECORDS else set())
        assert len(json.dumps(model.model_json_schema())) < full * 0.6, key
    ext = opportunity.to_step_extraction(opportunity.step_output_model("fit_charts")(findings=[], size_charts=[], evidence_gaps=["x"]))
    assert ext.channels == [] and ext.evidence_gaps == ["x"]


def test_pages_read_in_full_become_checkable_excerpts(monkeypatch):
    from types import SimpleNamespace

    from app.services.llm.anthropic_provider import AnthropicProvider
    from app.services.llm.base import FetchedPage, WebResearchResult
    from app.services.research import providers

    # Parsing: a web_fetch_tool_result block becomes a FetchedPage; an error block is recorded.
    result = WebResearchResult()
    page_block = SimpleNamespace(type="web_fetch_tool_result", content=SimpleNamespace(
        type="web_fetch_result", url="https://www.etsy.com/legal/fees", retrieved_at="2026-11-23T10:00:00Z",
        content=SimpleNamespace(title="Etsy Fees", source=SimpleNamespace(type="text", data="Fees\n\nTransaction fee: 6.5% of the total.\n\nWelcome!"))))
    err_block = SimpleNamespace(type="web_fetch_tool_result", content=SimpleNamespace(type="web_fetch_tool_result_error", error_code="url_not_accessible"))
    AnthropicProvider._collect_research_blocks([page_block, err_block], result)
    assert result.pages[0].url == "https://www.etsy.com/legal/fees" and result.errors == ["web_fetch error: url_not_accessible"]

    # Gathering: only figure-bearing passages become excerpts, so the 6.5% can be verified later.
    assert providers.page_passages("Intro text\n\nListing fee $0.20 per item\n\nNo numbers here") == ["Listing fee $0.20 per item"]
    fake = FakeLLM()
    raw = WebResearchResult(pages=[FetchedPage(url="https://www.etsy.com/legal/fees", title="Etsy Fees", text=page_block.content.content.source.data,
                                               retrieved_at="2026-11-23T10:00:00Z")])
    seen = {}

    def web_research(**kw):
        seen.update(kw)
        return raw

    monkeypatch.setattr(fake, "web_research", web_research)
    monkeypatch.setattr(providers, "get_llm", lambda: fake)
    bundle = providers.AnthropicWebSearchProvider().gather(question="q", context="c", query_hints=[], country_code="US")
    src = bundle.sources[0]
    assert seen["max_fetches"] == 3 and src.excerpts == ["Transaction fee: 6.5% of the total."] and src.page_age == "read in full 2026-11-23"


def test_web_research_falls_back_to_search_only_when_fetch_is_rejected(monkeypatch):
    p = AnthropicProvider()
    p._api_key, p._fallbacks = "test", "off"
    create = object()
    p._client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    calls: list[list[str]] = []

    def fake_call(fn, **kw):
        assert kw["cache_control"] == {"type": "ephemeral"}  # every round re-reads the earlier ones: cache them
        calls.append([t["name"] for t in kw["tools"]])
        if len(kw["tools"]) > 1:
            raise LLMError("Bad request to Anthropic API: web_fetch tool is not enabled for this organization")
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="ok", citations=None)], stop_reason="end_turn", model="claude-opus-5-5",
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5, server_tool_use=None))

    monkeypatch.setattr(p, "_call", fake_call)
    out = p.web_research(system="s", prompt="p", max_searches=3, country_code="US", max_fetches=3)
    assert calls == [["web_search", "web_fetch"], ["web_search"]] and "search results only" in out.errors[0]
