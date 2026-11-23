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
