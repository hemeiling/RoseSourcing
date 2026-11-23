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
