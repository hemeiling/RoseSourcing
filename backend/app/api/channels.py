from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from .. import audit
from ..models import AnalysisSnapshot, CostScenario, ProductConcept, ResearchRun, SalesChannel, ShippingOption
from ..schemas import (
    SalesChannelIn,
    SalesChannelOut,
    ScenarioOut,
    ScenarioOverridesIn,
    ShippingCompareIn,
    ShippingOptionIn,
    ShippingOptionOut,
)
from ..services.agents.opportunity import submit_plan_refresh
from ..services.agents.sourcing import baseline_inputs
from ..services.logistics import PackagingSpec, Shipment, channel_economics, channel_inputs, compare_shipping
from ..services.unit_economics import UnitEconomicsInputs, calculate
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["shipping & channels"])

SHIPPING_MONEY = ("rate", "rate_high", "min_charge", "fixed_fees")
CHANNEL_DECIMALS = ("price", "commission_pct", "per_order_fee", "payment_fee_pct", "payment_fee_fixed", "monthly_fee",
                    "fulfillment_per_order", "marketing_cac", "return_rate_pct")


def _decimals(data: dict, fields: tuple[str, ...]) -> dict:
    return {k: (Decimal(str(v)) if k in fields and v is not None else v) for k, v in data.items()}


# ----------------------------------------------------------------------------- shipping options


@router.get("/projects/{project_id}/shipping-options", response_model=list[ShippingOptionOut])
def list_shipping(project: ProjectDep, db: DB) -> list[ShippingOption]:
    return list(db.scalars(select(ShippingOption).where(ShippingOption.project_id == project.id)
                           .order_by(ShippingOption.leg, ShippingOption.created_at)))


@router.post("/projects/{project_id}/shipping-options", response_model=ShippingOptionOut, status_code=201)
def create_shipping(body: ShippingOptionIn, project: ProjectDep, db: DB, user: CurrentUser) -> ShippingOption:
    o = ShippingOption(project_id=project.id, **_decimals(body.model_dump(), SHIPPING_MONEY))
    db.add(o)
    db.flush()
    audit.record(db, "shipping_option.created", user_id=user.id, project_id=project.id, entity_type="shipping_option", entity_id=o.id)
    db.commit()
    return o


@router.put("/shipping-options/{option_id}", response_model=ShippingOptionOut)
def update_shipping(option_id: uuid.UUID, body: ShippingOptionIn, db: DB, user: CurrentUser) -> ShippingOption:
    o = owned(db, ShippingOption, option_id, user)
    for k, v in _decimals(body.model_dump(), SHIPPING_MONEY).items():
        setattr(o, k, v)
    audit.record(db, "shipping_option.updated", user_id=user.id, project_id=o.project_id, entity_type="shipping_option", entity_id=o.id)
    db.commit()
    return o


@router.delete("/shipping-options/{option_id}", status_code=204)
def delete_shipping(option_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    o = owned(db, ShippingOption, option_id, user)
    db.delete(o)
    db.commit()


@router.post("/projects/{project_id}/shipping/compare")
def shipping_compare(body: ShippingCompareIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    spec = body.packaging
    if spec is None and body.product_id:
        p = owned(db, ProductConcept, body.product_id, user)
        fields = ("units_per_carton", "carton_length_cm", "carton_width_cm", "carton_height_cm", "carton_gross_weight_kg")
        if any(getattr(p, f) is None for f in fields):
            raise HTTPException(400, f"'{p.name}' has no complete carton specs. Add them in Commerce or enter them here.")
        spec = PackagingSpec(**{f: float(getattr(p, f)) for f in fields})
    if spec is None:
        raise HTTPException(400, "Enter carton specs or choose a product that has them.")
    stmt = select(ShippingOption).where(ShippingOption.project_id == project.id)
    if body.option_ids:
        stmt = stmt.where(ShippingOption.id.in_(body.option_ids))
    options = list(db.scalars(stmt))
    result = compare_shipping(options, Shipment(units=body.units, packaging=PackagingSpec(**spec.model_dump())))
    base, base_name, _ = baseline_inputs(db, project)
    result["base_scenario"] = {"name": base_name, "freight_per_unit": base.freight_per_unit, "factory_cost": base.factory_cost}
    return result


# ----------------------------------------------------------------------------- sales channels


@router.get("/projects/{project_id}/channels", response_model=list[SalesChannelOut])
def list_channels(project: ProjectDep, db: DB) -> list[SalesChannel]:
    return list(db.scalars(select(SalesChannel).where(SalesChannel.project_id == project.id).order_by(SalesChannel.name)))


@router.post("/projects/{project_id}/channels", response_model=SalesChannelOut, status_code=201)
def create_channel(body: SalesChannelIn, project: ProjectDep, db: DB, user: CurrentUser) -> SalesChannel:
    if db.scalars(select(SalesChannel).where(SalesChannel.project_id == project.id, SalesChannel.name.ilike(body.name.strip()))).first():
        raise HTTPException(409, "A channel with this name already exists in this project.")
    ch = SalesChannel(project_id=project.id, **_decimals(body.model_dump(), CHANNEL_DECIMALS))
    db.add(ch)
    db.flush()
    audit.record(db, "sales_channel.created", user_id=user.id, project_id=project.id, entity_type="sales_channel", entity_id=ch.id)
    db.commit()
    return ch


@router.put("/channels/{channel_id}", response_model=SalesChannelOut)
def update_channel(channel_id: uuid.UUID, body: SalesChannelIn, db: DB, user: CurrentUser) -> SalesChannel:
    ch = owned(db, SalesChannel, channel_id, user)
    before = ch.fee_basis
    for k, v in _decimals(body.model_dump(), CHANNEL_DECIMALS).items():
        setattr(ch, k, v)
    audit.record(db, "sales_channel.updated", user_id=user.id, project_id=ch.project_id, entity_type="sales_channel", entity_id=ch.id,
                 details={"fee_basis": {"from": before, "to": ch.fee_basis}} if before != ch.fee_basis else {})
    db.commit()
    return ch


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(channel_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    ch = owned(db, SalesChannel, channel_id, user)
    db.delete(ch)
    db.commit()


@router.get("/projects/{project_id}/channels/compare")
def channels_compare(project: ProjectDep, db: DB, include_rejected: bool = False) -> dict:
    stmt = select(SalesChannel).where(SalesChannel.project_id == project.id)
    if not include_rejected:
        stmt = stmt.where(SalesChannel.status != "rejected")
    return channel_economics(db, project, list(db.scalars(stmt)))


@router.get("/projects/{project_id}/channels/plan")
def latest_plan(project: ProjectDep, db: DB) -> dict | None:
    snap = _latest_plan(db, project.id)
    if not snap:
        return None
    based_on = snap.content.get("based_on")
    if not based_on:
        # Plans written before this was recorded used the scenario that was the latest one at the time.
        sc = db.scalars(select(CostScenario).where(CostScenario.project_id == project.id, CostScenario.updated_at <= snap.created_at)
                        .order_by(CostScenario.updated_at.desc())).first()
        based_on = ({"scenario": sc.name, "retail_price": (sc.inputs or {}).get("retail_price"), "inferred": True} if sc
                    else {"scenario": "example defaults", "retail_price": UnitEconomicsInputs().retail_price, "inferred": True})
    base, base_name, _ = baseline_inputs(db, project)
    run = db.get(ResearchRun, uuid.UUID(snap.content["research_run_id"])) if snap.content.get("research_run_id") else None
    refreshing = bool(run and any(s["key"] == "plan" and s["status"] in ("pending", "running") for s in run.steps))
    return {"id": str(snap.id), "created_at": snap.created_at, "content": {**snap.content, "based_on": based_on},
            "current": {"scenario": base_name, "retail_price": base.retail_price}, "refreshing": refreshing}


def _latest_plan(db, project_id) -> AnalysisSnapshot | None:
    return db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project_id,
                                                     AnalysisSnapshot.kind == "channel_logistics_plan")
                      .order_by(AnalysisSnapshot.created_at.desc())).first()


@router.post("/projects/{project_id}/channels/plan/refresh", status_code=202)
def refresh_plan(project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    """Rewrite the channel plan with the channels and saved cost scenario as they are now (one AI call, no new searches)."""
    snap = _latest_plan(db, project.id)
    run = db.get(ResearchRun, uuid.UUID(snap.content["research_run_id"])) if snap and snap.content.get("research_run_id") else None
    if run is None:
        raise HTTPException(404, "No channel plan to refresh - run the Channels & Shipping agent first.")
    if db.scalars(select(ResearchRun).where(ResearchRun.project_id == project.id, ResearchRun.status.in_(["queued", "running"]))).first():
        raise HTTPException(409, "A research run is in progress for this product; refresh the plan when it finishes.")
    if any(s["key"] == "plan" and s["status"] in ("pending", "running") for s in run.steps):
        raise HTTPException(409, "The plan is already being rewritten.")
    run.steps = [dict(s, status="pending", error=None) if s["key"] == "plan" else s for s in run.steps]
    audit.record(db, "channel_plan.refresh_requested", user_id=user.id, project_id=project.id, entity_type="research_run", entity_id=run.id)
    db.commit()
    submit_plan_refresh(run.id)
    return {"refreshing": True}


# ----------------------------------------------------------------------------- scenarios from channels / freight


def _save_scenario(db, project, user, name: str, inputs: UnitEconomicsInputs, basis: dict[str, str], notes: str, stype: str) -> CostScenario:
    sc = CostScenario(project_id=project.id, name=name[:200], scenario_type=stype, inputs=inputs.model_dump(), input_basis=basis,
                      results=calculate(inputs), notes=notes)
    db.add(sc)
    db.flush()
    audit.record(db, "cost_scenario.created", user_id=user.id, project_id=project.id, entity_type="cost_scenario", entity_id=sc.id)
    db.commit()
    return sc


@router.post("/projects/{project_id}/scenarios/from-channel/{channel_id}", response_model=ScenarioOut, status_code=201)
def scenario_from_channel(channel_id: uuid.UUID, project: ProjectDep, db: DB, user: CurrentUser) -> CostScenario:
    ch = owned(db, SalesChannel, channel_id, user)
    if ch.project_id != project.id:
        raise HTTPException(404, "Channel not found in this project")
    base, base_name, base_basis = baseline_inputs(db, project)
    inputs, basis = channel_inputs(base, base_basis, ch)
    basis = {k: ("sourced_research" if "sourced_research" in v else "actual" if "verified" in v else
                 v if v in ("assumption", "supplier_quote", "actual", "sourced_research") else "assumption")
             for k, v in basis.items()}
    return _save_scenario(db, project, user, f"{ch.name} channel", inputs, basis,
                          f"Channel economics for {ch.name}; other inputs from '{base_name}'.", "hypothetical")


@router.post("/projects/{project_id}/scenarios/with-overrides", response_model=ScenarioOut, status_code=201)
def scenario_with_overrides(body: ScenarioOverridesIn, project: ProjectDep, db: DB, user: CurrentUser) -> CostScenario:
    base, base_name, base_basis = baseline_inputs(db, project)
    unknown = [k for k in body.overrides if k not in UnitEconomicsInputs.model_fields]
    if unknown:
        raise HTTPException(400, f"Unknown inputs: {', '.join(unknown)}")
    try:
        inputs = UnitEconomicsInputs(**{**base.model_dump(), **body.overrides})
    except ValidationError as e:
        raise HTTPException(422, e.errors())
    basis = {**{k: base_basis.get(k, "assumption") for k in inputs.model_dump()},
             **{k: body.input_basis.get(k, "assumption") for k in body.overrides}}
    return _save_scenario(db, project, user, body.name, inputs, basis, body.notes or f"Based on '{base_name}'.", "hypothetical")
