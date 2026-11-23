"""Size charts, the deterministic fit engine, the public size guide, chart extraction and fit research."""

from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import fit
from app.services.agents import opportunity
from app.services.llm import anthropic_provider

from .fakes import FakeLLM

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64

ROWS = [
    {"size": "S", "labels": {"US": "4"}, "measurements": {"bust": [80, 84], "waist": [62, 66], "hip": [88, 92]}},
    {"size": "M", "labels": {"US": "8"}, "measurements": {"bust": [85, 89], "waist": [67, 71], "hip": [93, 97]}},
    {"size": "L", "labels": {"US": "12"}, "measurements": {"bust": [90, 94], "waist": [72, 76], "hip": [98, 102]}},
]


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(anthropic_provider, "_provider", fake)
    return fake


def test_fit_engine_rules():
    r = fit.recommend(ROWS, {"bust": 87, "waist": 69, "hip": 95})
    assert r["recommended"] == "M" and r["status"] == "fits" and r["recommended_labels"] == {"US": "8"}

    mixed = fit.recommend(ROWS, {"bust": 83, "waist": 70, "hip": 99})
    assert mixed["recommended"] == "L" and mixed["status"] == "between_sizes"
    assert mixed["per_dimension"] == {"bust": "S", "waist": "M", "hip": "L"}
    assert any("loose at the bust by 7 cm" in n.lower() for n in mixed["notes"])

    assert fit.recommend(ROWS, {"bust": 96})["status"] == "outside_chart"
    assert fit.recommend(ROWS, {"bust": 96}, stretch_allowance_cm=2)["recommended"] == "L"  # 2 cm over, within stretch
    assert fit.recommend(ROWS, {"height": 165})["status"] == "insufficient"

    inches = fit.recommend(ROWS, {"bust": 34.25}, unit="in")  # 87.0 cm
    assert inches["recommended"] == "M" and inches["measurements_cm"] == {"bust": 87.0}

    shoes = fit.normalise_rows([{"size": "36", "measurements": {"foot_length": 23}}, {"size": "37", "measurements": {"foot_length": 23.5}}])
    assert fit.recommend(shoes, {"foot_length": 23.2})["recommended"] == "37"
    assert fit.recommend(shoes, {"foot_length": 23.0})["recommended"] == "36"

    with pytest.raises(ValueError):
        fit.normalise_rows([{"size": "", "measurements": {}}])


def test_size_chart_crud_publish_and_public_finder(authed, project):
    pid = project["id"]
    body = {"name": "Factory Y Latin dress", "role": "supplier", "garment_type": "dress", "unit": "in",
            "size_systems": ["US"], "rows": [{"size": "S", "labels": {"US": "4"}, "measurements": {"bust": [31.5, 33], "waist": [24.5, 26]}},
                                             {"size": "M", "labels": {"US": "8"}, "measurements": {"bust": [33.5, 35], "waist": [26.5, 28]}}],
            "stretch_allowance": 0.5, "fit_notes": "Stretch mesh sleeves."}
    r = authed.post(f"/api/projects/{pid}/size-charts", json=body)
    assert r.status_code == 201, r.text
    chart = r.json()
    assert chart["rows"][0]["measurements"]["bust"] == [80.0, 83.8] and chart["stretch_allowance_cm"] == 1.3
    assert chart["dimensions"] == ["bust", "waist"] and chart["verification_status"] == "unverified"

    rec = authed.post(f"/api/size-charts/{chart['id']}/recommend", json={"measurements": {"bust": 86, "waist": 68}}).json()
    assert rec["recommended"] == "M"

    # Supplier charts can't be shared directly; a copy becomes your size guide, which must be verified first.
    assert authed.post(f"/api/size-charts/{chart['id']}/publish").status_code == 409
    guide = authed.post(f"/api/size-charts/{chart['id']}/duplicate").json()
    assert guide["role"] == "published" and guide["rows"] == chart["rows"]
    assert authed.post(f"/api/size-charts/{guide['id']}/publish").status_code == 409
    authed.post(f"/api/size-charts/{guide['id']}/verify")
    pub = authed.post(f"/api/size-charts/{guide['id']}/publish").json()
    slug = pub["public_path"].split("c=")[1]

    public = TestClient(app)  # a customer: no session
    assert public.get(f"/api/public/size-guides/{slug}").json()["rows"] == chart["rows"]
    res = public.post(f"/api/public/size-guides/{slug}/recommend", json={"measurements": {"bust": 34, "waist": 27}, "unit": "in"}).json()
    assert res["recommended"] == "M" and "measurements_cm" not in res
    public.post(f"/api/public/size-guides/{slug}/recommend", json={"measurements": {"bust": 40}, "unit": "in"})
    stats = [c for c in authed.get(f"/api/projects/{pid}/size-charts").json() if c["id"] == guide["id"]][0]["fit_stats"]
    assert stats == {"M": 1, "_none": 1, "_total": 2}  # tallies only - no measurements stored

    # Editing numbers on a non-manual chart would reset verification; unpublishing hides it from customers.
    authed.post(f"/api/size-charts/{guide['id']}/publish?published=false")
    assert public.get(f"/api/public/size-guides/{slug}").status_code == 404
    assert authed.delete(f"/api/size-charts/{chart['id']}").status_code == 204

    # Owner-only routes are not reachable without signing in.
    assert public.get(f"/api/projects/{pid}/size-charts").status_code == 401
    assert public.post(f"/api/size-charts/{guide['id']}/recommend", json={"measurements": {"bust": 80}}).status_code == 401


def test_extract_size_chart_from_photo(authed, project, fake_llm):
    r = authed.post(f"/api/projects/{project['id']}/size-charts/extract", files={"file": ("chart.png", PNG, "image/png")},
                    data={"role": "supplier"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert fake_llm.images[0][0] == "image/png"
    assert c["source_type"] == "photo_extracted" and c["verification_status"] == "unverified" and c["has_source_image"]
    assert c["rows"][0]["measurements"]["bust"] == [81.3, 83.8]  # 32-33 in converted to cm
    assert authed.get(f"/api/size-charts/{c['id']}/source-image").content == PNG
    edited = {**{k: c[k] for k in ("name", "role", "garment_type", "dimensions", "size_systems", "rows")},
              "unit": "cm", "stretch_allowance": 0}
    edited["rows"][0]["measurements"]["bust"] = [81, 84]
    assert authed.put(f"/api/size-charts/{c['id']}", json=edited).json()["verification_status"] == "unverified"
    assert authed.post(f"/api/size-charts/{c['id']}/verify").json()["verification_status"] == "human_verified"


def test_fit_research_run_keeps_only_sourced_measurements(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "fit_sizing", "focus": "competition dresses"})
    assert r.status_code == 201, r.text
    run = authed.get(f"/api/research-runs/{r.json()['id']}").json()
    assert run["status"] == "completed" and [s["key"] for s in run["steps"]] == ["fit_charts", "fit_experience"]
    charts = authed.get(f"/api/projects/{project['id']}/size-charts").json()
    assert len(charts) == 1
    c = charts[0]
    assert c["role"] == "reference" and c["verification_status"] == "source_linked" and c["source_url"] == "https://branda.example.com/size-guide"
    assert c["rows"][0]["measurements"] == {"bust": [80.0, 84.0], "waist": [62.0, 66.0]}
    assert c["rows"][1]["measurements"] == {"bust": [85.0, 89.0]}  # the unsourced waist value was dropped
    gaps = [f["claim"] for f in authed.get(f"/api/projects/{project['id']}/findings").json() if "size-chart measurement" in f["claim"]]
    assert gaps and gaps[0].startswith("1 size-chart measurement")


def test_copilot_sizing_tools(authed, project, monkeypatch):
    from app.db import SessionLocal
    from app.models import BusinessProject, User
    from app.services.agents.copilot import CopilotTools

    with SessionLocal() as db:
        tools = CopilotTools(db, db.get(BusinessProject, uuid.UUID(project["id"])), db.query(User).first())
        ok, out, _ = tools.execute("recommend_size", {"measurements": {"bust": 86}})
        assert not ok or json.loads(out)["ok"] is False
        ok, out, summary = tools.execute("save_size_chart", {"name": "Pasted chart", "rows": ROWS, "fit_notes": "Order your usual size."})
        assert ok and json.loads(out)["verification_status"] == "unverified", out
        ok, out, summary = tools.execute("recommend_size", {"measurements": {"bust": 87, "waist": 69, "hip": 95}})
        res = json.loads(out)
        assert ok and res["recommended"] == "M" and res["chart"] == "Pasted chart" and "Recommended M" in summary
        ok, out, _ = tools.execute("list_size_charts", {})
        assert json.loads(out)["size_charts"][0]["rows"][1]["size"] == "M"


def test_price_tier_run_keeps_only_sourced_prices(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "price_tiers"})
    assert r.status_code == 201, r.text
    assert authed.get(f"/api/research-runs/{r.json()['id']}").json()["status"] == "completed"
    snap = authed.get(f"/api/projects/{project['id']}/snapshots/price_tiers").json()
    budget, premium = snap["content"]["tiers"]  # ordered budget -> luxury
    assert budget["tier"] == "budget" and budget["range_basis"] == "unavailable" and budget["evidence_type"] == "ai_inference"
    assert [e["price"] for e in premium["examples"]] == [79]  # the invented $999 example was dropped
    assert premium["range_basis"] == "from_examples" and premium["price_low"] == premium["price_high"] == 79
    assert premium["customer_needs"] == ["Comfort for long practice"] and premium["sources"]
    assert authed.get(f"/api/projects/{project['id']}/dashboard").json()["counts"]["price_tier_reports"] == 1


def test_compliance_run_drafts_supplier_questions(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    sup = authed.post(f"/api/projects/{project['id']}/suppliers", json={"name": "Guangzhou Dancewear Co"}).json()
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "compliance"})
    run = authed.get(f"/api/research-runs/{r.json()['id']}").json()
    assert run["status"] == "completed" and run["params"]["suppliers"] == "Guangzhou Dancewear Co"
    assert [s["key"] for s in run["steps"]] == ["design_ip", "labeling", "uflpa", "compliance_plan"]
    snap = authed.get(f"/api/projects/{project['id']}/snapshots/compliance_checklist").json()["content"]
    assert snap["items"][0]["status"] == "action_needed" and snap["supplier_drafts"] == 1
    assert snap["items"][0]["sources"] and snap["items"][0]["sources"][0]["url"].startswith("http")
    comms = authed.get(f"/api/suppliers/{sup['id']}").json()["communications"]
    assert comms[0]["direction"] == "draft" and "Which mill spun the cotton?" in comms[0]["summary"]
    assert authed.get(f"/api/projects/{project['id']}/snapshots/price_tiers").json() is None


def test_price_tier_evidence_from_marketplace_listings(monkeypatch):
    from app.services import demand

    def fake_get(http, params):
        if params["engine"] == "amazon":
            return {"organic_results": [{"title": f"Knot headband {i}", "extracted_price": 8 + i, "rating": 4.0 + i / 20, "reviews": 100 * i}
                                        for i in range(1, 9)] + [{"title": "Ad", "extracted_price": 5, "sponsored": True}]}
        return {"shopping_results": [{"title": f"Silk headband {i}", "extracted_price": 40 + 10 * i, "source": "Boutique"} for i in range(1, 5)]}

    monkeypatch.setattr(demand, "_get", fake_get)
    obs, errors, calls = demand.price_tier_evidence(["top knot headband"])
    assert calls == 2 and not errors
    summary = obs[0]
    assert summary.title == "Price tiers from 12 marketplace listings"
    assert summary.excerpts[1].startswith("Budget tier (lowest 25% of prices): 3 listings priced $9.00 to $11.00")
    assert "Luxury tier (highest 25% of prices): 3 listings priced $60.00 to $80.00" in " ".join(summary.excerpts)
    assert "Ad" not in " ".join(obs[1].excerpts)  # sponsored results excluded
    assert obs[1].excerpts[0] == "Knot headband 1 - $9.00 - 4.05 stars (100 ratings) - Amazon"


def test_supplier_listing_run_creates_unverified_suppliers(authed, project, fake_llm, monkeypatch):
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "supplier_listings"})
    assert authed.get(f"/api/research-runs/{r.json()['id']}").json()["status"] == "completed"
    sups = authed.get(f"/api/projects/{project['id']}/suppliers").json()
    # The invented listing (no verifiable number, no listing link) was not saved; an unnamed seller gets its own record named
    # after the listing; a listing page without a shown price is kept as a lead with no numbers.
    assert sorted(s["name"] for s in sups) == ["Alibaba.com listing: Velvet knot band", "Yiwu Knot Co", "yundance"]
    lead = next(x for x in sups if x["name"] == "yundance")["quotes"][0]
    assert lead["unit_price"] is None and "not shown" in lead["notes"] and lead["source_url"].endswith("_1601169741486.html")  # tracking code stripped
    s = next(x for x in sups if x["name"] == "Yiwu Knot Co")
    assert s["verification_status"] == "unverified" and s["platform"] == "alibaba"
    q = s["quotes"][0]
    assert float(q["unit_price"]) == 79 and q["moq"] is None and q["source"] == "research_listing"  # 500 is not in the excerpt
    assert "not a quote" in q["notes"] and q["source_url"].startswith("https://branda.example.com")
    row = next(r for r in authed.get(f"/api/projects/{project['id']}/suppliers/comparison").json()["rows"] if r["supplier_name"] == "Yiwu Knot Co")
    assert row["source_url"] == q["source_url"]

    # Running the search again refreshes the same listings instead of adding duplicate quotes.
    authed.post(f"/api/projects/{project['id']}/research-runs", json={"kind": "supplier_listings"})
    again = authed.get(f"/api/projects/{project['id']}/suppliers").json()
    assert len(again) == 3 and all(len(s["quotes"]) == 1 for s in again)


def test_add_listing_links_saves_leads_once(authed, project):
    pid = project["id"]
    urls = ["https://www.alibaba.com/product-detail/L-2034-New-Latin-Dance-Dress_10000010430140.html?spm=a2700&utm_source=x",
            "https://detail.1688.com/offer/123456789.html", "not a link"]
    r = authed.post(f"/api/projects/{pid}/suppliers/from-links", json={"urls": urls}).json()
    assert [a["name"] for a in r["added"]] == ["Alibaba.com listing: L 2034 New Latin Dance Dress", "1688.com listing: 1688.com page"]
    assert r["invalid"] == ["not a link"]
    sups = {s["name"]: s for s in authed.get(f"/api/projects/{pid}/suppliers").json()}
    s = sups["Alibaba.com listing: L 2034 New Latin Dance Dress"]
    assert s["platform"] == "alibaba" and s["verification_status"] == "unverified" and "spm" not in s["website"]
    assert s["quotes"][0]["unit_price"] is None and s["quotes"][0]["source"] == "listing_link"
    again = authed.post(f"/api/projects/{pid}/suppliers/from-links", json={"urls": urls[:1]}).json()
    assert again["added"] == [] and len(again["already_saved"]) == 1


def test_b2b_listing_evidence_uses_google_snippets(monkeypatch):
    from app.services import demand

    seen = []

    def fake_get(http, params):
        seen.append(params["q"])
        return {"organic_results": [{"title": "Knotted Headband Wholesale", "link": "https://www.alibaba.com/product-detail/x.html",
                                     "snippet": "US$0.39 - 0.59. Min. order: 50 pieces.", "rich_snippet": {"top": {"extensions": ["5 yrs CN Supplier"]}}},
                                    {"title": "No link"}]}

    monkeypatch.setattr(demand, "_get", fake_get)
    obs, errors, calls = demand.b2b_listing_evidence(["knotted headband"])
    assert calls == 3 and seen[0] == "site:alibaba.com knotted headband"
    assert obs[0].url.startswith("https://www.alibaba.com/") and obs[0].excerpts == ["US$0.39 - 0.59. Min. order: 50 pieces. 5 yrs CN Supplier"]


def test_competitor_tiers_from_price_tier_listings(authed, project, fake_llm, monkeypatch):
    from app.db import SessionLocal
    from app.models import AnalysisSnapshot, EvidenceSource, ResearchRun
    from app.services.price_tiers import tier_for

    tiers = [{"tier": "budget", "price_low": 5, "price_high": 9}, {"tier": "mid", "price_low": 10, "price_high": 12},
             {"tier": "luxury", "price_low": 40, "price_high": 600}]
    assert [tier_for(p, tiers) for p in (7, 9.5, 11, 25, 99, 2)] == ["budget", "budget", "mid", "mid", "luxury", "budget"]

    pid = uuid.UUID(project["id"])
    with SessionLocal() as db:
        run = ResearchRun(project_id=pid, kind="price_tiers", status="completed", provider="anthropic_web_search", model="m", params={}, steps=[])
        db.add(run)
        db.flush()
        db.add(EvidenceSource(project_id=pid, research_run_id=run.id, url="https://www.google.com/search?tbm=shop&q=x", provider="serpapi",
                              source_type="api", excerpts=["Lele Sadoughi Woven Knotted Headband - $49.00 - Saks", "Generic band - $6.00 - Amazon"]))
        db.add(AnalysisSnapshot(project_id=pid, kind="price_tiers", content={"research_run_id": str(run.id), "tiers": tiers}))
        db.commit()
    authed.post(f"/api/projects/{project['id']}/competitors", json={"name": "Lele Sadoughi"})
    authed.post(f"/api/projects/{project['id']}/competitors", json={"name": "Nobody Brand"})
    r = authed.post(f"/api/projects/{project['id']}/competitors/assign-tiers").json()
    assert r == {"updated": 1, "prices_added": 1}
    comps = {c["name"]: c for c in authed.get(f"/api/projects/{project['id']}/competitors").json()}
    assert comps["Lele Sadoughi"]["price_tier"] == "luxury" and comps["Nobody Brand"]["price_tier"] in (None, "unknown")
    obs = comps["Lele Sadoughi"]["products"][0]["price_observations"][0]
    assert float(obs["price"]) == 49 and obs["verification_status"] == "source_linked"


def test_pages_to_read_are_cleaned_and_passed_to_research(authed, project, fake_llm, monkeypatch):
    from app.services.research import providers

    seen = {}
    real = providers.AnthropicWebSearchProvider.gather

    def spy(self, **kw):
        seen.setdefault("read_urls", kw.get("read_urls"))
        return real(self, **kw)

    monkeypatch.setattr(providers.AnthropicWebSearchProvider, "gather", spy)
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    r = authed.post(f"/api/projects/{project['id']}/research-runs", json={
        "kind": "price_tiers", "source_urls": ["https://chinausfreight.com/?gad_source=1&gclid=abc&page=2", "not a url"]})
    assert r.status_code == 201, r.text
    assert r.json()["params"]["source_urls"] == ["https://chinausfreight.com/?page=2"]
    assert seen["read_urls"] == ["https://chinausfreight.com/?page=2"]
