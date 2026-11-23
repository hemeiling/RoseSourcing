"""Research workflow: evidence rules and an end-to-end run with a scripted LLM."""

from __future__ import annotations

import pytest

from app.services.agents import opportunity
from app.services.agents.research_schemas import ExtractedFinding
from app.services.llm import anthropic_provider
from app.services.research.providers import EvidenceBundle, SourceDoc

from .fakes import FakeLLM


def _bundle() -> EvidenceBundle:
    return EvidenceBundle(provider="test", question="q", sources=[
        SourceDoc(ref="S1", url="https://a.example", title="A", page_age=None, excerpts=["Sales reached $1,250 million in 2024."]),
        SourceDoc(ref="S2", url="https://b.example", title="B", page_age=None, excerpts=[]),
    ])


def _f(**kw) -> ExtractedFinding:
    base = dict(section="market_size", claim="c", detail=None, evidence_type="sourced", confidence="high",
                source_refs=["S1"], supporting_quote=None, metric=None)
    base.update(kw)
    return ExtractedFinding(**base)


def test_sourced_without_valid_source_is_downgraded():
    v = opportunity.validate_finding(_f(source_refs=["S9"]), _bundle())
    assert v["evidence_type"] == "ai_inference"
    assert v["confidence"] == "low"
    assert v["verification_status"] == "unverified"


def test_numbers_must_appear_in_excerpt():
    ok = opportunity.validate_finding(_f(claim="Sales were $1,250 million in 2024"), _bundle())
    assert ok["verification_status"] == "source_linked"
    bad = opportunity.validate_finding(_f(claim="Sales were $3,000 million in 2024"), _bundle())
    assert bad["verification_status"] == "unverified"
    assert bad["confidence"] == "low"
    assert any("3000" in f for f in bad["flags"])


def test_quote_must_be_verbatim():
    v = opportunity.validate_finding(_f(claim="Sales reached a record", supporting_quote="Sales doubled"), _bundle())
    assert v["verification_status"] == "unverified"
    assert v["quote"] is None


def test_source_without_excerpt_is_not_linked():
    v = opportunity.validate_finding(_f(source_refs=["S2"]), _bundle())
    assert v["verification_status"] == "unverified"
    assert v["confidence"] == "medium"


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(anthropic_provider, "_provider", fake)
    return fake


def test_research_requires_configuration(authed, project):
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "market_opportunity"})
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]["message"]


def test_full_market_opportunity_run(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)  # run synchronously
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "market_opportunity", "focus": "practice wear"})
    assert r.status_code == 201, r.text
    run = authed.get(f"/api/research-runs/{r.json()['id']}").json()
    assert run["status"] == "completed", run
    assert [s["status"] for s in run["steps"]] == ["completed"] * 7
    assert run["search_requests"] == 12
    assert run["cost_usd"] > 0

    findings = authed.get(f"/api/projects/{project['id']}/findings").json()
    by_claim = {f["claim"]: f for f in findings}
    good = by_claim["About 1.2 million adults took part in social dance in 2025."]
    assert good["verification_status"] == "source_linked"
    assert good["sources"][0]["source"]["url"] == "https://stats.example.org/dance"
    assert good["sources"][0]["quote"]
    fabricated = by_claim["The US Latin dancewear market is worth $450 million."]
    assert fabricated["verification_status"] == "unverified" and fabricated["confidence"] == "low"
    bad_ref = by_claim["Demand likely grows with dance TV shows."]
    assert bad_ref["evidence_type"] == "ai_inference"
    assert any(f["evidence_type"] == "unavailable" for f in findings)

    comps = authed.get(f"/api/projects/{project['id']}/competitors").json()
    assert len(comps) == 1
    prices = [po for p in comps[0]["products"] for po in p["price_observations"]]
    assert {p["price"] for p in prices} == {79.0}  # the price with a bogus source ref was discarded
    assert prices[0]["verification_status"] == "source_linked"

    opps = authed.get(f"/api/projects/{project['id']}/opportunities").json()
    assert len(opps) == 1
    rep = opps[0]["report"]
    assert rep["attractiveness"] == "mixed"
    ue = rep["unit_economics"]
    # F1 is a sourced finding, so sourced_research basis is allowed; others stay assumptions.
    assert ue["inputs"]["retail_price"]["basis"] == "sourced_research"
    assert ue["inputs"]["factory_cost"]["basis"] == "assumption"
    assert ue["results"]["contribution_margin"] is not None
    assert ue["cost_scenario_id"]

    recs = authed.get(f"/api/projects/{project['id']}/recommendations").json()
    assert recs[0]["title"] == "Run a landing page test"
    execs = authed.get(f"/api/projects/{project['id']}/agent-executions").json()
    assert {e["status"] for e in execs} == {"succeeded"}
    assert len(execs) == 7
    # Without a SerpApi key the demand step says so instead of inventing popularity data.
    assert any(f["section"] == "demand" and "SerpApi" in f["claim"] and f["evidence_type"] == "unavailable" for f in findings)


def test_resume_only_reruns_incomplete_steps(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", lambda run_id: None)
    run = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "competitor_discovery"}).json()
    assert run["status"] == "queued"
    n = opportunity.recover_interrupted_runs()
    assert n == 1
    assert authed.get(f"/api/research-runs/{run['id']}").json()["status"] == "interrupted"
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    resumed = authed.post(f"/api/research-runs/{run['id']}/resume")
    assert resumed.status_code == 200
    assert authed.get(f"/api/research-runs/{run['id']}").json()["status"] == "completed"


def test_human_review_cannot_set_source_linked(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "competitor_discovery"})
    f = authed.get(f"/api/projects/{project['id']}/findings").json()[0]
    assert authed.patch(f"/api/findings/{f['id']}", json={"verification_status": "source_linked"}).status_code == 400
    r = authed.patch(f"/api/findings/{f['id']}", json={"verification_status": "human_verified", "reviewer_note": "checked"})
    assert r.json()["verification_status"] == "human_verified"


def test_copilot_uses_tools_and_confirms_writes(authed, project, fake_llm):
    r = authed.post(f"/api/projects/{project['id']}/copilot/ask", json={"question": "What is my profit at $69?"})
    assert r.status_code == 200, r.text
    msg = r.json()["message"]
    assert [c["tool"] for c in msg["tool_calls"]] == ["search_findings", "calculate_unit_economics", "create_recommendation"]
    assert all(c["ok"] for c in msg["tool_calls"])
    recs = authed.get(f"/api/projects/{project['id']}/recommendations").json()
    assert any(rec["title"] == "Validate sizing" and rec["source"] == "copilot" for rec in recs)
    thread = authed.get(f"/api/copilot/threads/{r.json()['thread']['id']}").json()
    assert [m["role"] for m in thread["messages"]] == ["user", "assistant"]


def test_generators_persist(authed, project, fake_llm):
    r = authed.post(f"/api/projects/{project['id']}/brand-concepts/generate", json={"kind": "palettes", "brief": "elegant"})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "palettes"
    prod = authed.post(f"/api/projects/{project['id']}/products", json={"name": "Practice dress", "materials": "nylon/spandex"}).json()
    lr = authed.post(f"/api/products/{prod['id']}/listing")
    assert lr.status_code == 200 and lr.json()["listing_draft"]["title"]
