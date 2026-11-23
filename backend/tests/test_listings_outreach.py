"""Listing Tracker, Review Insights and supplier outreach (spec sheet, RFQs at several quantities, samples)."""

from __future__ import annotations

import pytest

from app.services import demand
from app.services.agents import opportunity
from app.services.llm import anthropic_provider

from .fakes import FakeLLM

REVIEW = "The knot came undone after two wears and it gives me a headache within an hour."


def fake_serpapi(http, params):
    e = params["engine"]
    if e == "amazon":
        return {"organic_results": [
            {"asin": f"B0{i}", "title": f"Knotted Headband Style {i}", "extracted_price": 9.99 + i, "rating": 4.3, "reviews": 1200 - i * 100,
             "badges": ["Best Seller"] if i == 1 else [], "bought_last_month": "1K+ bought in past month" if i == 2 else None,
             "link_clean": f"https://www.amazon.com/dp/B0{i}", "thumbnail": f"https://m.media-amazon.com/images/I/{i}.jpg"} for i in range(1, 9)
        ] + [{"asin": "B0X", "title": "Sweatband for running", "extracted_price": 5, "reviews": 9000, "link_clean": "https://www.amazon.com/dp/B0X"},
             {"asin": "B0S", "title": "Sponsored knot headband", "extracted_price": 7, "sponsored": True}]}
    if e == "google_shopping":
        return {"shopping_results": [
            {"title": "Tweed Top Knot Headband", "extracted_price": 24.0, "source": "Etsy", "rating": 4.9, "reviews": 310,
             "product_link": "https://www.google.com/shopping/product/1", "immersive_product_page_token": "tok1", "tag": "Sale"},
            {"title": "Lele Sadoughi Knotted Headband", "extracted_price": 65.0, "source": "Lele Sadoughi", "rating": 4.7, "reviews": 85,
             "product_link": "https://www.google.com/shopping/product/2", "immersive_product_page_token": "tok2",
             "thumbnail": "javascript:alert(1)"},
            {"title": "Plaid Knot Headband", "extracted_price": 18.0, "source": "Nordstrom", "product_link": "https://www.google.com/shopping/product/3"},
        ] + [{"title": f"Velvet knot headband {i}", "extracted_price": 30.0 + i, "source": f"Boutique {i}",
              "product_link": f"https://www.google.com/shopping/product/b{i}"} for i in range(5)]}
    if e == "google":
        return {"organic_results": [
            {"link": "https://www.etsy.com/listing/123/handmade-knot-headband?ref=x", "title": "Handmade Knot Headband - Etsy",
             "rich_snippet": {"top": {"detected_extensions": {"rating": 4.8, "reviews": 1500}, "extensions": ["4.8(1.5K)", "$22.00"]}}},
            {"link": "https://www.etsy.com/shop/someone", "title": "A shop page"},
        ]}
    if e == "google_trends":
        return {"interest_over_time": {"timeline_data": [{"date": f"Week {i}", "values": [{"extracted_value": 40 + i}]} for i in range(30)]}}
    if e == "google_immersive_product":
        return {"product_results": {"ratings": [{"stars": 5, "amount": 200}, {"stars": 2, "amount": 30}, {"stars": 1, "amount": 20}],
                                    "user_reviews": [{"rating": 2, "title": "Pretty but", "text": REVIEW, "source": "etsy.com", "date": "2 months ago"},
                                                     {"rating": 5, "text": "Love it, so comfortable and cute!"}]}}
    if e == "amazon_product":
        return {"reviews_information": {"summary": {
            "customer_reviews": {"5 star": 70, "4 star": 12, "3 star": 6, "2 star": 4, "1 star": 8},
            "insights": [{"title": "Comfort", "sentiment": "mixed", "mentions": 40, "summary": "Some find it tight.",
                          "examples": [{"snippet": "squeezes behind my ears"}]},
                         {"title": "Looks", "sentiment": "positive", "summary": "Cute."}]}}}
    raise AssertionError(e)


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(anthropic_provider, "_provider", fake)
    return fake


@pytest.fixture
def serp(monkeypatch):
    monkeypatch.setattr(demand, "configured", lambda: True)
    monkeypatch.setattr(demand, "_get", fake_serpapi)
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)


def _run(authed, pid, kind, **kw):
    r = authed.post(f"/api/projects/{pid}/research-runs", json={"kind": kind, "keywords": ["knotted headband"], **kw})
    assert r.status_code == 201, r.text
    return authed.get(f"/api/research-runs/{r.json()['id']}").json()


def test_listing_tracker_logs_prices_reviews_and_badges(authed, project, fake_llm, serp):
    pid = project["id"]
    run = _run(authed, pid, "listing_tracker")
    assert run["status"] == "completed", run
    snap = authed.get(f"/api/projects/{pid}/snapshots/listing_tracker").json()["content"]
    titles = [r["title"] for r in snap["listings"]]
    assert "Sweatband for running" not in titles and "Sponsored knot headband" not in titles
    assert 15 <= len(snap["listings"]) <= 20
    assert {"Amazon", "Etsy"} <= set(snap["by_platform"])
    etsy = next(r for r in snap["listings"] if r["url"].startswith("https://www.etsy.com/listing/123"))
    assert etsy["price"] == 22.0 and etsy["reviews"] == 1500 and "?" not in etsy["url"]
    assert snap["trend"]["keyword"] == "knotted headband" and len(snap["trend"]["series"]) == 30 and snap["trend"]["change_pct"] > 0

    comps = {c["name"]: c for c in authed.get(f"/api/projects/{pid}/competitors").json()}
    obs = comps["Lele Sadoughi"]["products"][0]["price_observations"][0]
    assert obs["review_count"] is not None and obs["platform"] and obs["verification_status"] == "source_linked"
    best = next(o for c in comps.values() for p in c["products"] for o in p["price_observations"] if "Best Seller" in o["badges"])
    assert best["platform"] == "Amazon" and best["rating"] == 4.3
    assert "Unbranded Amazon listings" in comps
    pictures = {r["title"]: r["image"] for r in snap["listings"]}
    assert pictures["Knotted Headband Style 1"] == "https://m.media-amazon.com/images/I/1.jpg"
    assert pictures["Lele Sadoughi Knotted Headband"] is None  # only web or inline image addresses are kept
    assert any(p["image_url"] == "https://m.media-amazon.com/images/I/1.jpg" for c in comps.values() for p in c["products"])
    assert authed.get(f"/api/projects/{pid}/dashboard").json()["counts"]["listing_reports"] == 1


def test_review_insights_tags_only_verifiable_quotes(authed, project, fake_llm, serp):
    pid = project["id"]
    before = _run(authed, pid, "review_mining")
    assert before["steps"][0]["status"] == "failed" and "Listing Tracker" in before["steps"][0]["error"]

    _run(authed, pid, "listing_tracker")
    run = _run(authed, pid, "review_mining")
    assert [s["key"] for s in run["steps"]] == ["review_collect", "review_web", "review_tags"]
    assert all(s["status"] == "completed" for s in run["steps"]), run["steps"]
    snap = authed.get(f"/api/projects/{pid}/snapshots/review_insights").json()["content"]
    assert [r["quote"] for r in snap["reviews"]] == ["The knot came undone after two wears", "gives me a headache within an hour"]
    assert snap["unverified_dropped"] == 1
    assert {t["tag"]: t["count"] for t in snap["themes"]} == {"durability": 2, "comfort": 1}
    etsy = next(p for p in snap["products"] if p["star_unit"] == "reviews" and p["star_counts"])
    assert etsy["low_star_share_pct"] == 20.0 and etsy["low_star_reviews_read"] == 1
    amazon = next(p for p in snap["products"] if p["star_unit"] == "percent")
    assert amazon["low_star_share_pct"] == 12.0 and amazon["themes_read"] == 1
    findings = authed.get(f"/api/projects/{pid}/findings", params={"section": "customers"}).json()
    assert any("complain about durability" in f["claim"] for f in findings)


def test_spec_sheet_rfqs_quotes_and_samples(authed, project, fake_llm):
    pid = project["id"]
    sups = [authed.post(f"/api/projects/{pid}/suppliers", json={"name": n, "contact_email": e}).json()
            for n, e in (("Yiwu Knots Co", "sales@yiwu.example.com"), ("Guangzhou Bands", None))]
    assert authed.post(f"/api/projects/{pid}/rfq", json={"supplier_ids": [sups[0]["id"]]}).status_code == 400

    spec = authed.post(f"/api/projects/{pid}/spec-sheet", json={"notes": "tweed and plaid"}).json()["content"]
    assert spec["quantities"] == [100, 300, 500] and spec["incoterm"] == "FOB"
    edited = {**{k: spec[k] for k in ("product_name", "summary", "materials", "dimensions", "colours_patterns", "construction",
                                       "quality_requirements", "packaging_labeling", "documents_requested", "questions")},
              "quality_requirements": ["Knot stitched closed so it cannot loosen", "  "], "target_unit_cost": 2.5}
    saved = authed.put(f"/api/projects/{pid}/spec-sheet", json=edited).json()["content"]
    assert saved["quality_requirements"] == ["Knot stitched closed so it cannot loosen"] and saved["edited_at"]

    assert authed.post(f"/api/projects/{pid}/rfq", json={"supplier_ids": [s["id"] for s in sups]}).json() == {"drafted": 2}
    authed.post(f"/api/projects/{pid}/rfq", json={"supplier_ids": [sups[0]["id"]]})  # redrafting replaces, not duplicates
    rows = {r["name"]: r for r in authed.get(f"/api/projects/{pid}/outreach").json()["suppliers"]}
    first = rows["Yiwu Knots Co"]
    assert first["status"] == "drafted" and "100, 300, 500 units" in first["draft"]["body"]
    assert "Knot stitched closed" in first["draft"]["body"] and "$2.50" in first["draft"]["body"]
    assert len(authed.get(f"/api/suppliers/{sups[0]['id']}").json()["communications"]) == 1

    authed.post(f"/api/supplier-communications/{first['draft']['id']}/sent")
    assert authed.get(f"/api/projects/{pid}/outreach").json()["suppliers"][0]["status"] == "sent"
    r = authed.post(f"/api/suppliers/{sups[0]['id']}/rfq-quotes", json={
        "prices": [{"quantity": 500, "unit_price": 1.1}, {"quantity": 100, "unit_price": 1.6}, {"quantity": 300, "unit_price": 1.3}],
        "sample_cost": 25, "lead_time_days": 20, "incoterm": "FOB"})
    assert r.status_code == 201
    row = authed.get(f"/api/projects/{pid}/outreach").json()["suppliers"][0]
    assert row["status"] == "quoted" and [q["quantity"] for q in row["quotes"]] == [100, 300, 500]
    comparison = authed.get(f"/api/projects/{pid}/suppliers/comparison").json()["rows"]
    assert sorted(x["moq"] for x in comparison) == [100, 300, 500]

    s = authed.post(f"/api/projects/{pid}/samples", json={"supplier_id": sups[0]["id"], "quantity": 2, "variant": "tweed",
                                                         "unit_cost": 12.5, "status": "ordered"}).json()
    assert s["supplier_name"] == "Yiwu Knots Co" and s["status"] == "ordered"
    s = authed.patch(f"/api/samples/{s['id']}", json={**{k: s[k] for k in ("supplier_id", "quantity", "variant", "unit_cost")},
                                                       "status": "received", "scores": {"comfort": 4, "durability": 5}}).json()
    assert s["status"] == "received" and s["scores"]["durability"] == 5
    counts = authed.get(f"/api/projects/{pid}/dashboard").json()["counts"]
    assert counts["spec_sheets"] == 1 and counts["rfqs_sent"] == 1 and counts["rfq_quotes"] == 3 and counts["sample_orders"] == 1
    assert authed.delete(f"/api/samples/{s['id']}").status_code == 204


def trends_serpapi(http, params):
    assert params["engine"] == "google_trends" and params["date"] == "today 5-y" and params["geo"] == "US"
    terms = params["q"].split(",")
    kind = params["data_type"]
    if kind == "TIMESERIES":
        return {"interest_over_time": {
            "timeline_data": [{"date": f"Week {i}", "partial_data": i == 4,
                               "values": [{"query": t, "extracted_value": (i + 1) * (j + 1)} for j, t in enumerate(terms)]} for i in range(5)],
            "averages": [{"query": t, "value": 10 * (j + 1)} for j, t in enumerate(terms)]}}
    if kind == "GEO_MAP":
        return {"compared_breakdown_by_region": [
            {"location": "Texas", "geo": "US-TX", "values": [{"query": t, "extracted_value": [60, 40][j]} for j, t in enumerate(terms)]}]}
    if kind == "RELATED_QUERIES":
        return {"related_queries": {"top": [{"query": "headband for women", "value": "100", "extracted_value": 100}],
                                    "rising": [{"query": "knot headband", "value": "Breakout", "extracted_value": 5000}]}}
    if kind == "RELATED_TOPICS":
        return {"related_topics": {"top": [{"topic": {"title": "Hairband", "type": "Topic"}, "value": "100", "extracted_value": 100}],
                                   "rising": []}}
    raise AssertionError(kind)


def test_trends_explorer_compares_phrases_regions_and_related(authed, project, monkeypatch):
    pid = project["id"]
    monkeypatch.setattr(demand, "configured", lambda: True)
    monkeypatch.setattr(demand, "_get", trends_serpapi)
    monkeypatch.setattr("app.services.trends._get", trends_serpapi)
    assert authed.get(f"/api/projects/{pid}/trends").json()["snapshot"] is None
    r = authed.post(f"/api/projects/{pid}/trends", json={"terms": ["headband", " yoga sock ", "headband"], "date": "today 5-y", "geo": "us"})
    assert r.status_code == 201, r.text
    c = r.json()["content"]
    assert c["terms"] == ["headband", "yoga sock"] and c["series"]["yoga sock"] == [2, 4, 6, 8, 10] and c["partial"][-1] is True
    assert c["averages"] == {"headband": 10, "yoga sock": 20} and c["region_mode"] == "share"
    assert c["regions"] == [{"location": "Texas", "geo": "US-TX", "values": {"headband": 60, "yoga sock": 40}}]
    assert "date=today%205-y" in c["url"] and "q=headband%2Cyoga%20sock" in c["url"]
    rel = authed.post(f"/api/projects/{pid}/trends/related", json={"term": "headband"}).json()["content"]["related"]["headband"]
    assert rel["queries"]["rising"][0] == {"name": "knot headband", "type": None, "value": "Breakout", "score": 5000, "link": None}
    assert rel["topics"]["top"][0]["name"] == "Hairband"
    assert authed.post(f"/api/projects/{pid}/trends/related", json={"term": "facial mask"}).status_code == 404
    assert authed.post(f"/api/projects/{pid}/trends", json={"terms": ["a", "b", "c", "d", "e", "f"]}).status_code == 422


def test_match_listing_ignores_store_suffix_and_finds_tier_pictures(authed, project, monkeypatch):
    import uuid as _uuid

    from app.db import session_scope
    from app.models import AnalysisSnapshot

    line = "Women's Knotted Headband - $14.00 - 4.9 stars (77 ratings) - Boon Ties"
    media = {line: {"url": "https://www.google.com/shopping/product/9", "image": "https://img.example/boon.jpg"}}
    assert demand.match_listing("Women's Knotted Headband (Boon Ties)", media)["image"] == "https://img.example/boon.jpg"
    assert demand.match_listing("Headband", media) is None  # too short to identify one listing
    assert demand.match_listing("Velvet Knotted Headband (Boon Ties)", media) is None

    search = "https://www.google.com/search?tbm=shop&q=knotted+headband"
    with session_scope() as db:
        db.add(AnalysisSnapshot(project_id=_uuid.UUID(project["id"]), kind="price_tiers", content={"keywords": ["knotted headband"], "tiers": [
            {"tier": "premium", "examples": [
                {"product": "Women's Knotted Headband (Boon Ties)", "price": 14, "currency": "USD", "url": search, "source_url": search},
                {"product": "Unknown Boutique Band", "price": 15, "currency": "USD", "url": None, "source_url": search}]}]}))
    monkeypatch.setattr(demand, "configured", lambda: True)
    monkeypatch.setattr(demand, "price_tier_evidence", lambda kws, geo: ([demand.DemandObservation(title="t", url="u", excerpts=[line], media=media)], [], 2))
    r = authed.post(f"/api/projects/{project['id']}/snapshots/price_tiers/pictures").json()
    assert r == {"found": 1, "still_missing": 1, "serpapi_calls": 2, "errors": []}
    ex = authed.get(f"/api/projects/{project['id']}/snapshots/price_tiers").json()["content"]["tiers"][0]["examples"]
    assert ex[0]["image"] == "https://img.example/boon.jpg" and ex[0]["url"] == "https://www.google.com/shopping/product/9"
    assert not ex[1].get("image")


def test_price_for_margin_and_shipment_size():
    from app.services.unit_economics import UnitEconomicsInputs, calculate, price_for_margin

    i = UnitEconomicsInputs(retail_price=20, avg_discount_pct=10, factory_cost=4, freight_per_unit=1, shipment_fixed_costs=300,
                            units_per_shipment=0, moq=300, duty_rate_pct=0, import_clearance_per_unit=0, packaging_per_unit=0)
    r = calculate(i)
    assert r["landed_cost_breakdown"]["shipment_fees"] == 1.0 and r["landed_cost_breakdown"]["landed_cost"] == 6.0
    sizes = {s["units"]: s for s in r["by_shipment_size"]}
    assert sizes[100]["shipping_per_unit"] == 4.0 and sizes[1000]["shipping_per_unit"] == 1.3 and sizes[300]["current"]
    assert sizes[100]["contribution_margin"] < sizes[1000]["contribution_margin"]

    p = price_for_margin(i, 20)
    assert p["gross_margin_price"] == round(6 / 0.8 / 0.9, 2)
    at = calculate(i.model_copy(update={"retail_price": p["gross_margin_price"]}))
    assert abs(at["gross_margin_pct"] - 20) < 0.1
    at = calculate(i.model_copy(update={"retail_price": p["contribution_margin_price"]}))
    assert abs(at["contribution_margin_pct"] - 20) < 0.1
    impossible = price_for_margin(i.model_copy(update={"channel_commission_pct": 60, "payment_fee_pct": 30}), 20)
    assert impossible["contribution_margin_price"] is None and "no price reaches" in impossible["contribution_note"]
    assert [t["target_pct"] for t in r["price_targets"]] == [10, 20, 30, 40, 50]


def test_dedupe_channels_and_recommendations(authed, project):
    import uuid as _uuid

    from app.db import session_scope
    from app.models import SalesChannel
    from app.services.dedupe import add_recommendation, find_channel, same_channel, similar_text

    assert same_channel("Instagram", "Instagram Shopping")
    assert same_channel("Wholesale to boutiques via Faire", "Wholesale via Faire / direct to boutiques")
    assert same_channel("Markets and trade shows", "Markets, craft fairs and pop-ups")
    assert not same_channel("Amazon US", "Walmart Marketplace") and not same_channel("TikTok Shop", "Own Shopify store")
    assert similar_text("Open a Shopify Basic store using Shopify Payments.", "Open a Shopify Basic store with Shopify Payments")
    assert not similar_text("Open a Shopify Basic store.", "Revisit Amazon after confirming the category and fees.")

    pid = _uuid.UUID(project["id"])
    with session_scope() as db:
        db.add(SalesChannel(project_id=pid, name="Instagram", channel_type="social_commerce", status="considering"))
        db.add(SalesChannel(project_id=pid, name="TikTok Shop", channel_type="social_commerce", status="considering"))
        db.flush()
        assert find_channel(db, pid, "Instagram Shopping", "social_commerce").name == "Instagram"
        assert find_channel(db, pid, "Instagram Shopping", "marketplace") is None  # a different kind of channel
        first = add_recommendation(db, project_id=pid, title="Open a Shopify Basic store using Shopify Payments.", body="a", priority="medium")
        again = add_recommendation(db, project_id=pid, title="Open a Shopify Basic store with Shopify Payments", body="b", priority="high")
        other = add_recommendation(db, project_id=pid, title="Revisit Amazon after confirming the category and fees.", body="c")
        assert again.id == first.id and first.priority == "high" and other.id != first.id


def test_split_supplier_listings_and_delete_finding(authed, project):
    pid = project["id"]
    sup = authed.post(f"/api/projects/{pid}/suppliers", json={"name": "Unnamed supplier (not shown in excerpt)", "platform": "alibaba"}).json()
    for title, url in (("Velvet knot headband", "https://www.alibaba.com/product-detail/velvet_1.html"),
                       ("Tweed top knot band", "https://www.made-in-china.com/prod/tweed_2.html")):
        q = authed.post(f"/api/suppliers/{sup['id']}/quotes", json={"product_name": title, "unit_price": 1.2, "moq": 50}).json()
        from app.db import session_scope
        from app.models import SupplierQuote
        import uuid as _uuid
        with session_scope() as db:
            db.get(SupplierQuote, _uuid.UUID(q["id"])).source_url = url
    authed.post(f"/api/suppliers/{sup['id']}/communications", json={"direction": "draft", "subject": "Compliance questions", "summary": "Q?"})
    r = authed.post(f"/api/suppliers/{sup['id']}/split-listings").json()
    assert sorted(c["name"] for c in r["created"]) == ["Alibaba.com listing: Velvet knot headband", "Made-in-China.com listing: Tweed top knot band"]
    sups = authed.get(f"/api/projects/{pid}/suppliers").json()
    assert len(sups) == 2 and all(len(s["quotes"]) == 1 and len(s["communications"]) == 1 for s in sups)
    assert authed.get(f"/api/suppliers/{sup['id']}").status_code == 404

    from app.models import ResearchFinding
    with session_scope() as db:
        f = ResearchFinding(project_id=_uuid.UUID(pid), section="demand", claim="old", evidence_type="sourced", confidence="low",
                            verification_status="unverified", flags=[])
        db.add(f)
        db.flush()
        fid = f.id
    assert authed.delete(f"/api/findings/{fid}").status_code == 204
    assert authed.delete(f"/api/findings/{fid}").status_code == 404


def test_recommended_inputs_cite_evidence(authed, project, fake_llm):
    pid = project["id"]
    assert authed.get(f"/api/projects/{pid}/analytics/recommended-inputs").json() is None
    sup = authed.post(f"/api/projects/{pid}/suppliers", json={"name": "Yiwu Knots"}).json()
    authed.post(f"/api/suppliers/{sup['id']}/quotes", json={"product_name": "Knot band", "unit_price": 1.2, "moq": 100})
    from app.db import session_scope
    from app.models import SupplierQuote
    with session_scope() as db:
        db.query(SupplierQuote).update({"source": "research_listing"})
    r = authed.post(f"/api/projects/{pid}/analytics/recommended-inputs")
    assert r.status_code == 201, r.text
    c = r.json()["content"]
    items = {i["field"]: i for i in c["inputs"]}
    assert "return_rate_pct" not in items  # 140% is out of range and dropped
    assert items["factory_cost"]["basis"] == "sourced_research" and items["factory_cost"]["exact_in_source"]
    assert items["factory_cost"]["sources"][0]["label"] == "Yiwu Knots"
    assert items["duty_rate_pct"]["basis"] == "assumption" and items["duty_rate_pct"]["sources"] == []  # E999 does not exist
    assert items["moq"]["value"] == 300 and c["results"]["retail_price"] == 28
    assert authed.get(f"/api/projects/{pid}/analytics/recommended-inputs").json()["id"] == r.json()["id"]
