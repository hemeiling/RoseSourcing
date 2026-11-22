"""Shipping math, channel economics, and the channels & logistics research run."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.models import SalesChannel, ShippingOption
from app.services.agents import opportunity
from app.services.llm import anthropic_provider
from app.services.logistics import PackagingSpec, Shipment, compare_shipping, option_cost
from app.services.unit_economics import UnitEconomicsInputs, calculate

from .fakes import FakeLLM

SPEC = PackagingSpec(units_per_carton=20, carton_length_cm=60, carton_width_cm=40, carton_height_cm=40, carton_gross_weight_kg=10)


def _opt(**kw) -> ShippingOption:
    base = dict(id=uuid.uuid4(), name="x", leg="international", mode="air_freight", rate_basis="per_kg", rate=Decimal("6"),
                rate_high=None, currency="USD", min_charge=None, fixed_fees=None, volumetric_divisor=None, includes_duties=False,
                basis="quote", provider=None, source_url=None, transit_days_min=5, transit_days_max=8)
    base.update(kw)
    return ShippingOption(**base)


def test_air_freight_uses_volumetric_weight():
    # 100 units -> 5 cartons, 50 kg gross; volume 5*96000 cm3 / 6000 = 80 kg chargeable
    r = option_cost(_opt(fixed_fees=Decimal("40")), Shipment(units=100, packaging=SPEC))
    assert r["chargeable"] == 80
    assert r["total_low"] == 80 * 6 + 40
    assert r["per_unit_low"] == 5.2


def test_sea_weight_or_measure_min_charge_and_range():
    r = option_cost(_opt(mode="sea_lcl", rate_basis="per_cbm", rate=Decimal("80"), rate_high=Decimal("120"), min_charge=Decimal("150")),
                    Shipment(units=100, packaging=SPEC))
    assert r["chargeable"] == 0.48  # 0.48 cbm > 0.05 t
    assert r["total_low"] == 150 and r["total_high"] == 150  # minimum charge applies to both
    express = option_cost(_opt(mode="express_courier"), Shipment(units=100, packaging=SPEC))
    assert express["chargeable"] == 96  # divisor 5000
    rows = compare_shipping([_opt(mode="express_courier"), _opt(), _opt(leg="domestic", mode="domestic_parcel", rate_basis="per_order",
                                                                         rate=Decimal("5"))], Shipment(units=100, packaging=SPEC))["rows"]
    assert [r["leg"] for r in rows] == ["international", "international", "domestic"]


def test_channel_commission_reduces_margin():
    base = UnitEconomicsInputs(retail_price=70, duty_rate_pct=20)
    with_fees = base.model_copy(update={"channel_commission_pct": 17, "channel_fee_per_order": 1})
    assert calculate(base)["contribution_margin"] - calculate(with_fees)["contribution_margin"] == pytest.approx(70 * 0.17 + 1, abs=0.02)


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(anthropic_provider, "_provider", fake)
    return fake


def test_channels_logistics_run(authed, project, fake_llm, monkeypatch):
    pid = project["id"]
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    authed.post(f"/api/projects/{pid}/products", json={"name": "Practice dress", "units_per_carton": 20, "carton_length_cm": 60,
                                                       "carton_width_cm": 40, "carton_height_cm": 40, "carton_gross_weight_kg": 10})
    r = authed.post(f"/api/projects/{pid}/research-runs", json={"kind": "channels_logistics"})
    assert r.status_code == 201, r.text
    run = authed.get(f"/api/research-runs/{r.json()['id']}").json()
    assert run["status"] == "completed", run
    assert [s["key"] for s in run["steps"]] == ["channels", "logistics", "plan"]

    chans = {c["name"]: c for c in authed.get(f"/api/projects/{pid}/channels").json()}
    mk = chans["Example Marketplace"]
    assert mk["commission_pct"] == 17 and mk["fee_basis"] == "sourced_research"
    assert mk["fee_source_url"] == "https://market.example.com/fees"
    assert mk["per_order_fee"] is None  # 0.99 is not in the excerpt, so it was not stored
    assert chans["Studio wholesale"]["fee_basis"] == "assumption"

    opts = authed.get(f"/api/projects/{pid}/shipping-options").json()
    assert len(opts) == 1  # the invented LCL rate was discarded
    assert opts[0]["rate"] == 5.5 and opts[0]["rate_high"] == 7.0 and opts[0]["basis"] == "sourced_research"

    findings = authed.get(f"/api/projects/{pid}/findings").json()
    assert any("left blank" in f["claim"] for f in findings)
    assert any("discarded" in f["claim"] for f in findings)

    plan = authed.get(f"/api/projects/{pid}/channels/plan").json()
    assert plan and plan["content"]["research_run_id"] == run["id"]

    # Deterministic comparisons
    cmp = authed.post(f"/api/projects/{pid}/shipping/compare", json={"units": 100, "product_id":
                      authed.get(f"/api/projects/{pid}/products").json()[0]["id"]}).json()
    assert cmp["shipment"]["cartons"] == 5
    assert cmp["rows"][0]["per_unit_low"] == 4.4 and cmp["rows"][0]["per_unit_high"] == 5.6
    econ = authed.get(f"/api/projects/{pid}/channels/compare").json()
    assert {r["name"] for r in econ["rows"]} == {"Example Marketplace", "Studio wholesale"}

    sc = authed.post(f"/api/projects/{pid}/scenarios/from-channel/{mk['id']}")
    assert sc.status_code == 201, sc.text
    assert sc.json()["inputs"]["channel_commission_pct"] == 17
    assert sc.json()["input_basis"]["channel_commission_pct"] == "sourced_research"
    ov = authed.post(f"/api/projects/{pid}/scenarios/with-overrides",
                     json={"name": "Air freight", "overrides": {"freight_per_unit": 5.2}, "input_basis": {"freight_per_unit": "supplier_quote"}})
    assert ov.status_code == 201 and ov.json()["input_basis"]["freight_per_unit"] == "supplier_quote"
    assert authed.post(f"/api/projects/{pid}/scenarios/with-overrides", json={"name": "bad", "overrides": {"nope": 1}}).status_code == 400


def test_user_verified_fees_are_not_overwritten(authed, project, fake_llm, monkeypatch):
    pid = project["id"]
    authed.post(f"/api/projects/{pid}/channels", json={"name": "Example Marketplace", "commission_pct": 15, "fee_basis": "verified"})
    monkeypatch.setattr("app.api.research.submit_run", opportunity.execute_run)
    authed.post(f"/api/projects/{pid}/research-runs", json={"kind": "channels_logistics"})
    ch = [c for c in authed.get(f"/api/projects/{pid}/channels").json() if c["name"] == "Example Marketplace"][0]
    assert ch["commission_pct"] == 15 and ch["fee_basis"] == "verified"


def test_channel_crud_and_copilot_tools(authed, project, fake_llm):
    pid = project["id"]
    c = authed.post(f"/api/projects/{pid}/channels", json={"name": "Own store", "channel_type": "own_store", "monthly_fee": 39,
                                                          "expected_monthly_units": 30, "payment_fee_pct": 2.9})
    assert c.status_code == 201
    assert authed.post(f"/api/projects/{pid}/channels", json={"name": "own store"}).status_code == 409
    row = authed.get(f"/api/projects/{pid}/channels/compare").json()["rows"][0]
    assert row["contribution_margin_after_monthly_fee"] == round(row["contribution_margin"] - 1.3, 2)
    assert row["warnings"][0].startswith("Fees are assumptions")

    from app.db import SessionLocal
    from app.models import BusinessProject, User
    from app.services.agents.copilot import CopilotTools

    with SessionLocal() as db:
        tools = CopilotTools(db, db.get(BusinessProject, uuid.UUID(pid)), db.query(User).first())
        ok, content, _ = tools.execute("compare_sales_channels", {})
        assert ok and "Own store" in content
        ok, content, _ = tools.execute("compare_shipping_options", {"units": 50})
        assert ok and "carton specs" in content
