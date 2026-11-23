"""Structured output falls back to validated JSON when a schema is too large to compile; step schemas stay small."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.services.agents import opportunity
from app.services.agents.research_schemas import ExtractedSizeChart, StepExtraction
from app.services.llm.anthropic_provider import AnthropicProvider
from app.services.llm.base import LLMError

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
