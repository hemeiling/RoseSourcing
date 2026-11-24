"""Connectors vault, SerpApi demand signals, product photo scans, decisions, copilot actions and the Claude (MCP) connector."""

from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import connectors, demand
from app.services.agents import opportunity
from app.services.llm import anthropic_provider

from .fakes import FakeLLM

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(anthropic_provider, "_provider", fake)
    return fake


@pytest.fixture(autouse=True)
def clear_cache():
    connectors._CACHE.clear()
    yield
    connectors._CACHE.clear()


def test_connector_vault_encrypts_and_hides(authed):
    st = {c["key"]: c for c in authed.get("/api/connectors").json()}
    assert st["serpapi"]["active"] and not st["serpapi"]["configured"]
    assert not st["wechat"]["active"] and st["wechat"]["state"] == "not_connected"
    r = authed.put("/api/connectors/serpapi", json={"fields": {"api_key": "serp-secret-12345"}})
    assert r.status_code == 200
    st = {c["key"]: c for c in authed.get("/api/connectors").json()}
    assert st["serpapi"]["configured"] and st["serpapi"]["source"] == "app"
    assert st["serpapi"]["fields"][0]["hint"] == "…2345"
    assert "serp-secret" not in json.dumps(st)
    from app.db import SessionLocal
    from app.models import IntegrationCredential

    with SessionLocal() as db:
        row = db.query(IntegrationCredential).one()
        assert "serp-secret" not in row.encrypted_fields
    assert connectors.get_value("serpapi", "api_key") == "serp-secret-12345"
    # Gateway connectors store credentials but say the adapter is not active.
    authed.put("/api/connectors/xiaohongshu", json={"fields": {"app_id": "redapp", "app_secret": "s3cret"}})
    t = authed.post("/api/connectors/xiaohongshu/test").json()
    assert t["ok"] is False and "not active" in t["message"]
    assert authed.delete("/api/connectors/serpapi").status_code == 204
    assert not connectors.is_configured("serpapi")


def test_member_cannot_manage_connectors(client, authed):
    from app.config import get_settings

    client.post("/api/auth/logout")
    get_settings().signup_enabled = True
    try:
        client.post("/api/auth/signup", json={"email": "member@example.com", "password": "password123"})
        assert client.put("/api/connectors/serpapi", json={"fields": {"api_key": "x"}}).status_code == 403
    finally:
        get_settings().signup_enabled = False


def _serpapi_fixture(monkeypatch):
    def fake_get(http, params):
        if params["engine"] == "google_trends":
            vals = [40] * 39 + [60] * 13
            return {"interest_over_time": {"timeline_data": [{"values": [{"query": params["q"], "extracted_value": v}]} for v in vals]}}
        if params["engine"] == "amazon":
            return {"organic_results": [
                {"title": "Dress A", "reviews": 1200, "extracted_price": 39.99, "bought_last_month": "500+ bought in past month"},
                {"title": "Dress B", "reviews": 300, "extracted_price": 59.0},
                {"title": "Ad", "sponsored": True, "reviews": 99999, "extracted_price": 10.0},
            ]}
        return {"shopping_results": [{"title": "S1", "extracted_price": 49.0, "source": "Shop1"},
                                     {"title": "S2", "extracted_price": 79.0, "source": "Shop2"}]}

    monkeypatch.setattr(demand, "_get", fake_get)


def test_demand_signals_from_serpapi(authed, project, fake_llm, monkeypatch):
    authed.put("/api/connectors/serpapi", json={"fields": {"api_key": "serp-key-0000"}})
    monkeypatch.setattr(connectors, "_ping", lambda key, fields: (True, "ok"))
    _serpapi_fixture(monkeypatch)
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "market_opportunity"})
    run = authed.get(f"/api/research-runs/{r.json()['id']}").json()
    assert run["status"] == "completed"
    # No keywords given: short shopper phrases are suggested, saved, and demand data is collected once for them.
    assert run["params"]["keywords_source"] == "ai_suggested" and run["params"]["demand_collected_for"] == run["params"]["keywords"]
    demand_f = [f for f in authed.get(f"/api/projects/{project['id']}/findings?section=demand").json() if f["evidence_type"] == "sourced"]
    claims = " | ".join(f["claim"] for f in demand_f)
    assert "rising" in claims and "60/100 vs 40/100" in claims  # +50%
    assert "median of 750 ratings" in claims  # sponsored result excluded
    assert "1 of 2 page-1 Amazon results" in claims
    assert all(f["verification_status"] == "source_linked" and f["sources"][0]["source"]["provider"] == "serpapi" for f in demand_f)


def test_photo_scan_creates_project_and_starts_research(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.scans.submit_run", opportunity.execute_run)
    r = authed.post(f"/api/projects/{project['id']}/product-scans", files={"file": ("p.png", PNG, "image/png")},
                    data={"mode": "new_project", "auto_research": "true"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["project_id"] != project["id"] and body["run"]
    assert fake_llm.images[0][0] == "image/png"
    new = authed.get(f"/api/projects/{body['project_id']}").json()
    assert new["name"] == "Women's Latin practice dress" and new["product_category"] == "Latin dance practice dresses"
    run = authed.get(f"/api/research-runs/{body['run']['id']}").json()
    assert run["params"]["keywords"] == ["latin dance dress", "latin practice dress"] and run["status"] == "completed"
    img = authed.get(body["scan"]["image_url"])
    assert img.status_code == 200 and img.content == PNG
    pipe = {p["id"]: p for p in authed.get("/api/pipeline").json()}
    assert pipe[body["project_id"]]["image_url"] and pipe[body["project_id"]]["attractiveness"] == "mixed"
    assert authed.post(f"/api/projects/{project['id']}/product-scans", files={"file": ("x.txt", b"hi", "text/plain")}).status_code == 400


def test_several_photos_of_one_product_are_identified_together(authed, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.scans.submit_run", lambda run_id: None)
    JPG = b"\xff\xd8\xff" + b"1" * 32
    r = authed.post("/api/product-scans", files=[("files", ("front.png", PNG, "image/png")), ("files", ("label.jpg", JPG, "image/jpeg"))],
                    data={"auto_research": "false"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["photos"] == 2 and [mt for mt, _ in fake_llm.images] == ["image/png", "image/jpeg"]  # one call sees both
    scans = authed.get(f"/api/projects/{body['project_id']}/product-scans").json()
    assert len(scans) == 2 and all(s["status"] == "identified" for s in scans)
    assert authed.get(f"/api/projects/{body['project_id']}").json()["cover_scan_id"] == body["scan"]["id"]
    assert authed.get(body["scan"]["image_url"]).content == PNG  # the first photo is the cover
    seven = [("files", (f"{i}.png", PNG, "image/png")) for i in range(7)]
    assert authed.post("/api/product-scans", files=seven).status_code == 400
    assert authed.post("/api/product-scans", data={"auto_research": "false"}).status_code == 400  # no photo at all


def test_cover_photo_for_an_existing_product_uses_no_ai(authed, project, fake_llm):
    r = authed.post(f"/api/projects/{project['id']}/cover-photo", files={"file": ("p.png", PNG, "image/png")})
    assert r.status_code == 201, r.text
    assert not hasattr(fake_llm, "images")  # stored as is: the AI never saw it, nothing was researched
    assert authed.get(f"/api/projects/{project['id']}").json()["cover_scan_id"] == r.json()["id"]
    assert authed.get(r.json()["image_url"]).content == PNG
    assert authed.get(f"/api/projects/{project['id']}/research-runs").json() == []


def test_photo_scan_without_any_project(authed, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.scans.submit_run", opportunity.execute_run)
    assert authed.get("/api/projects").json() == []
    r = authed.post("/api/product-scans", files={"file": ("p.png", PNG, "image/png")},
                    data={"auto_research": "true", "target_country": "Canada", "sourcing_country": "China"})
    assert r.status_code == 201, r.text
    body = r.json()
    new = authed.get(f"/api/projects/{body['project_id']}").json()
    assert new["name"] == "Women's Latin practice dress" and new["target_country"] == "Canada" and new["sourcing_country"] == "China"
    assert new["cover_scan_id"] == body["scan"]["id"] and body["scan"]["project_id"] == body["project_id"]
    assert authed.get(f"/api/research-runs/{body['run']['id']}").json()["status"] == "completed"
    assert authed.get(body["scan"]["image_url"]).content == PNG
    assert authed.post("/api/product-scans", files={"file": ("x.txt", b"hi", "text/plain")}).status_code == 400


def test_decisions_and_brief(authed, project, fake_llm):
    from app.db import SessionLocal
    from app.models import ResearchFinding

    pid = project["id"]
    with SessionLocal() as db:
        # A market-size finding stated in words has no number: its metric is JSON null, not SQL NULL.
        db.add(ResearchFinding(project_id=uuid.UUID(pid), section="market_size", claim="Demand is growing", evidence_type="ai_inference",
                               confidence="low", verification_status="unverified", flags=[], metric=None))
        db.add(ResearchFinding(project_id=uuid.UUID(pid), section="market_size", claim="US market $4.09B", evidence_type="sourced",
                               confidence="medium", verification_status="unverified", flags=[],
                               metric={"name": "US market size", "value_low": 4.09, "value_high": None, "unit": "USD billion", "year": "2025"}))
        db.commit()
    b = authed.post(f"/api/projects/{pid}/decision-brief")
    assert b.status_code == 200 and b.json()["content"]["recommendation"] == "go"  # first literal from the fake
    c = b.json()["content"]
    assert 0 <= c["confidence_score"] <= 100 and "materials" in c["offer"] and "economics" in c["offer"]
    authed.post(f"/api/projects/{pid}/decision", json={"decision": "on_hold", "note": "waiting for samples"})
    authed.post(f"/api/projects/{pid}/decision", json={"decision": "go", "note": "samples approved"})
    hist = authed.get(f"/api/projects/{pid}/decisions").json()
    assert [h["decision"] for h in hist] == ["go", "on_hold"]
    assert hist[0]["snapshot"]["ai_recommendation"] == "go"
    p = [x for x in authed.get("/api/pipeline").json() if x["id"] == pid][0]
    assert p["decision"] == "go" and p["decision_note"] == "samples approved"


def test_copilot_action_tools(authed, project, fake_llm, monkeypatch):
    from app.db import SessionLocal
    from app.models import BusinessProject, User
    from app.services.agents.copilot import CopilotTools

    monkeypatch.setattr("app.services.agents.opportunity.submit_run", lambda run_id: None)
    with SessionLocal() as db:
        tools = CopilotTools(db, db.get(BusinessProject, uuid.UUID(project["id"])), db.query(User).first())
        ok, out, _ = tools.execute("start_research", {"kind": "competitor_discovery", "focus": "practice wear"})
        assert ok and json.loads(out)["status"] == "queued"
        ok, out, _ = tools.execute("start_research", {})
        assert json.loads(out)["ok"] is False  # one run at a time
        assert tools.execute("add_competitor", {"name": "Brand Z"})[0]
        assert json.loads(tools.execute("record_competitor_price", {"competitor": "Brand Z", "product": "Dress", "price": 64})[1])["ok"]
        assert json.loads(tools.execute("add_supplier", {"name": "Factory Q", "country": "China"})[1])["verification_status"] == "unverified"
        assert json.loads(tools.execute("add_supplier_quote", {"supplier": "Factory Q", "product_name": "Dress", "unit_price": 15, "moq": 100})[1])["ok"]
        assert json.loads(tools.execute("draft_supplier_rfq", {"supplier": "Factory Q"})[1])["ok"]
        assert json.loads(tools.execute("record_decision", {"decision": "no_go", "note": "margins too thin"})[1])["decision"] == "no_go"
    assert authed.get(f"/api/projects/{project['id']}").json()["decision"] == "no_go"


def test_claude_connector_mcp(authed, project):
    tok = authed.post("/api/tokens", json={"name": "Claude"}).json()
    assert tok["token"].startswith("aicos_") and tok["connector_url"].endswith(tok["token"])
    with TestClient(app) as c:
        hdr = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        assert c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=hdr).status_code == 401
        auth = {**hdr, "Authorization": f"Bearer {tok['token']}"}
        init = c.post("/mcp", headers=auth, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}})
        assert init.status_code == 200, init.text
        tools = c.post("/mcp", headers=auth, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()
        names = {t["name"] for t in tools["result"]["tools"]}
        assert {"list_projects", "create_project", "start_research", "record_decision", "compare_sales_channels"} <= names
        res = c.post(f"/mcp?token={tok['token']}", headers=hdr, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                                                     "params": {"name": "list_projects", "arguments": {}}}).json()
        projects = json.loads(res["result"]["content"][0]["text"])["projects"]
        assert projects[0]["id"] == project["id"]
        res = c.post("/mcp", headers=auth, json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
            "name": "add_competitor", "arguments": {"project_id": project["id"], "name": "Via Claude Co"}}}).json()
        assert json.loads(res["result"]["content"][0]["text"])["ok"]
        authed.delete(f"/api/tokens/{tok['id']}")
        assert c.post("/mcp", headers=auth, json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"}).status_code == 401


def test_runs_left_by_a_stopped_server_become_continuable(authed, project):
    from datetime import datetime, timedelta, timezone
    import uuid

    from sqlalchemy import update

    from app.db import session_scope
    from app.models import ResearchRun
    from app.services.agents import opportunity

    pid = uuid.UUID(project["id"])
    with session_scope() as db:
        user_id = db.scalars(__import__("sqlalchemy").select(ResearchRun.created_by_id)).first()
    ids = []
    with session_scope() as db:
        for kind in ("listing_tracker", "price_tiers", "competitor_discovery"):
            r = ResearchRun(project_id=pid, created_by_id=user_id, kind=kind, status="running", provider="anthropic_web_search",
                            model="m", params={}, steps=[dict(s, status="running") for s in opportunity.initial_steps(kind)][:1])
            db.add(r)
            db.flush()
            ids.append(r.id)
    old = datetime.now(timezone.utc) - timedelta(hours=1)
    with session_scope() as db:
        db.execute(update(ResearchRun).where(ResearchRun.id.in_(ids[:2])).values(updated_at=old))
    opportunity._in_process.add(ids[1])  # still running in this process: left alone
    try:
        assert opportunity.interrupt_stale_runs() == 1  # only the stale run no process here owns
        with session_scope() as db:
            stale, mine, fresh = (db.get(ResearchRun, i) for i in ids)
            assert stale.status == "interrupted" and stale.steps[0]["status"] == "pending"
            assert mine.status == "running" and fresh.status == "running"
        assert opportunity.interrupt_own_runs() == 1  # on shutdown this process marks its own run
        with session_scope() as db:
            assert db.get(ResearchRun, ids[1]).status == "interrupted"
    finally:
        opportunity._in_process.discard(ids[1])
