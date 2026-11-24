"""CRUD, auth policy, CSV import, comparisons and scenario flows."""

from __future__ import annotations


def test_signup_policy_and_login(client):
    assert client.get("/api/auth/signup-status").json()["first_user"] is True
    assert client.post("/api/auth/signup", json={"email": "a@example.com", "password": "password123"}).status_code == 200
    client.post("/api/auth/logout")
    # Second sign-up is closed by default.
    r = client.post("/api/auth/signup", json={"email": "b@example.com", "password": "password123"})
    assert r.status_code == 403
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "A@example.com", "password": "password123"}).status_code == 200
    assert client.get("/api/auth/me").json()["role"] == "owner"


def test_requires_auth(client):
    assert client.get("/api/projects").status_code == 401


def test_project_isolation(client, project):
    pid = project["id"]
    client.post("/api/auth/logout")
    from app.config import get_settings

    get_settings().signup_enabled = True
    try:
        client.post("/api/auth/signup", json={"email": "other@example.com", "password": "password123"})
        assert client.get(f"/api/projects/{pid}").status_code == 404
        assert client.get(f"/api/projects/{pid}/competitors").status_code == 404
    finally:
        get_settings().signup_enabled = False


def test_dashboard_reports_real_counts_only(authed, project):
    d = authed.get(f"/api/projects/{project['id']}/dashboard").json()
    assert d["counts"]["findings"] == 0
    assert d["latest_report"] is None
    assert d["ai_spend_usd"] == 0


def test_competitor_watchlist_and_prices(authed, project):
    pid = project["id"]
    c = authed.post(f"/api/projects/{pid}/competitors", json={"name": "Brand X", "price_tier": "premium", "on_watchlist": True}).json()
    assert authed.post(f"/api/projects/{pid}/competitors", json={"name": "brand x"}).status_code == 409
    p = authed.post(f"/api/competitors/{c['id']}/products", json={
        "name": "Latin dress", "initial_price": {"price": 120, "source_url": "https://x.example/p"}}).json()
    authed.post(f"/api/competitor-products/{p['id']}/prices", json={"price": 110})
    cmp = authed.get(f"/api/projects/{pid}/competitors/price-comparison").json()
    assert cmp["rows"][0]["observations"] == 2
    assert cmp["price_hypothesis"] == {"min": 49.0, "max": 89.0}
    assert len(authed.get(f"/api/projects/{pid}/competitors?watchlist=true").json()) == 1
    assert authed.post(f"/api/projects/{pid}/competitors/positioning").status_code == 503  # AI not configured


def test_supplier_csv_import_and_landed_cost(authed, project):
    pid = project["id"]
    csv = (
        "supplier,country,platform,certifications_claimed,product,moq,unit_price,currency,sample_cost,lead_time_days,incoterm,est_freight_per_unit\n"
        "Factory A,China,alibaba,ISO 9001,Practice dress,100,15,USD,40,30,FOB,2.5\n"
        "Factory B,China,1688,,Practice dress,300,12.5,USD,30,35,FOB,\n"
        "Factory C,China,direct,,Practice dress,50,abc,USD,,,,\n"
        ",China,,,,,,,,,,\n"
    )
    r = authed.post(f"/api/projects/{pid}/suppliers/import", files={"file": ("s.csv", csv, "text/csv")})
    body = r.json()
    assert body["created"] == {"suppliers": 3, "quotes": 2}
    assert body["error_count"] == 2
    sups = authed.get(f"/api/projects/{pid}/suppliers").json()
    assert all(s["verification_status"] == "unverified" for s in sups)
    a = next(s for s in sups if s["name"] == "Factory A")
    assert a["certifications_claimed"] == ["ISO 9001"]

    rows = authed.get(f"/api/projects/{pid}/suppliers/comparison").json()["rows"]
    assert rows[0]["landed_cost"]["landed_cost"] <= rows[1]["landed_cost"]["landed_cost"]
    assert all(r["verification_label"].startswith("Unverified") for r in rows)

    q = a["quotes"][0]
    sc = authed.post(f"/api/projects/{pid}/scenarios/from-quote/{q['id']}")
    assert sc.status_code == 201, sc.text
    assert sc.json()["input_basis"]["factory_cost"] == "supplier_quote"
    assert sc.json()["inputs"]["factory_cost"] == 15


def test_scenario_crud_and_validation(authed, project):
    pid = project["id"]
    spec = authed.get("/api/analytics/model").json()
    inputs = {**spec["defaults"], "retail_price": 69}
    assert authed.post("/api/analytics/calculate", json=inputs).json()["contribution_margin"] is not None
    assert authed.post("/api/analytics/calculate", json={**inputs, "return_rate_pct": 150}).status_code == 422
    s = authed.post(f"/api/projects/{pid}/scenarios", json={"name": "Base", "inputs": inputs,
                                                             "input_basis": {"retail_price": "assumption"}}).json()
    assert s["input_basis"]["factory_cost"] == "assumption"
    s2 = authed.put(f"/api/scenarios/{s['id']}", json={"name": "Base v2", "inputs": {**inputs, "retail_price": 79}}).json()
    assert s2["results"]["contribution_margin"] > s["results"]["contribution_margin"]


def test_approval_records_no_execution(authed, project):
    pid = project["id"]
    a = authed.post(f"/api/projects/{pid}/approvals", json={"action_type": "publish_listing", "title": "Publish dress"}).json()
    d = authed.post(f"/api/approvals/{a['id']}/decision", json={"decision": "approve"}).json()
    assert d["status"] == "approved"
    assert d["execution_result"]["executed"] is False


def test_csv_template_and_frontend_fallback(authed):
    r = authed.get("/api/csv-templates/suppliers")
    assert r.status_code == 200 and r.text.startswith("supplier,")
    assert authed.get("/api/nope").status_code in (404, 405)
    assert authed.get("/api/health").json() == {"status": "ok"}


def test_short_names_for_the_sidebar(authed, monkeypatch):
    from app.services.llm import anthropic_provider
    from app.services.naming import heuristic

    from .fakes import FakeLLM

    monkeypatch.setattr(anthropic_provider, "_provider", FakeLLM())

    assert heuristic("Heated covered cat bed cave (igloo style) with plug-in controller") == "Heated covered cat bed cave"
    assert heuristic("Women's knotted tweed and plaid fabric headband") == "Knotted tweed and plaid fabric"
    assert heuristic("Men's Latin & ballroom wear and shoes") == "Latin & ballroom wear"  # no trailing "and"
    assert heuristic("Women's rhinestone fringe Latin dance competition dress") == "Rhinestone fringe Latin dance"  # whole words
    p = authed.post("/api/projects", json={"name": "Women's Latin practice skirts and dresses for beginners",
                                           "product_category": "Dancewear", "target_country": "United States"}).json()
    assert p["short_name"] == "Dance Practice Wear"  # suggested by the AI once, at creation
    r = authed.patch(f"/api/projects/{p['id']}", json={"short_name": "Practice Skirts"}).json()
    assert r["short_name"] == "Practice Skirts" and r["name"].startswith("Women's Latin")  # editable; the full name stays


def test_account_usage_dashboard(authed, project):
    import uuid

    from app.db import session_scope
    from app.models import AgentExecution

    pid = uuid.UUID(project["id"])
    with session_scope() as db:
        db.add(AgentExecution(project_id=pid, agent="price_tier", operation="research_step:price_tiers", status="succeeded", model="m",
                              input_tokens=1000, output_tokens=200, cache_read_tokens=3000, search_requests=5, cost_usd=0.5))
        db.add(AgentExecution(project_id=pid, agent="brand_strategy", operation="short_name", status="succeeded", model="m",
                              input_tokens=400, output_tokens=20, cost_usd=0.002))
    u = authed.get("/api/usage").json()
    assert u["totals"]["calls"] == 2 and u["totals"]["cost_usd"] == 0.502 and u["totals"]["search_requests"] == 5
    assert u["totals"]["cached_share_pct"] == 68.2  # 3000 of 4400 input tokens came from the cache
    assert u["by_product"][0]["name"] == "Latin dancewear" and u["by_agent"][0]["label"] == "Price Tier Agent"
    assert len(u["by_day"]) == 1 and u["recent"][0]["product"] == "Latin dancewear"
    assert authed.get("/api/usage", params={"project_id": str(uuid.uuid4())}).json()["totals"]["calls"] == 0  # not this account's
