from __future__ import annotations

import uuid
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from .. import audit
from ..models import CostScenario, Experiment, Recommendation, SupplierQuote
from ..schemas import (
    ExperimentIn,
    ExperimentOut,
    RecommendationOut,
    RecommendationPatch,
    ScenarioIn,
    ScenarioOut,
)
from ..services.agents.sourcing import baseline_inputs
from ..services.unit_economics import INPUT_LABELS, UnitEconomicsInputs, calculate, price_for_margin
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["analytics"])


def _validated(inputs: dict) -> UnitEconomicsInputs:
    try:
        return UnitEconomicsInputs(**inputs)
    except ValidationError as e:
        raise HTTPException(422, e.errors())


@router.get("/analytics/model")
def model_spec(user: CurrentUser) -> dict:
    fields = UnitEconomicsInputs.model_fields
    return {
        "defaults": UnitEconomicsInputs().model_dump(),
        "labels": INPUT_LABELS,
        "descriptions": {k: (f.description or "") for k, f in fields.items()},
        "note": "Defaults are illustrative placeholders, not market data. Replace them with your quotes, verified duty rates and actuals.",
    }


@router.post("/analytics/calculate")
def calc(inputs: dict, user: CurrentUser) -> dict:
    return calculate(_validated(inputs))


@router.post("/analytics/price-for-margin")
def price_for_target_margin(body: dict, user: CurrentUser) -> dict:
    """Retail price for any target margin (gross, and contribution after fees, returns and marketing) at these inputs."""
    try:
        target = float(body.get("target_margin_pct"))
    except (TypeError, ValueError):
        raise HTTPException(422, "target_margin_pct must be a number") from None
    if not 0 <= target < 100:
        raise HTTPException(422, "Target margin must be at least 0% and below 100%.")
    return price_for_margin(_validated(body.get("inputs") or {}), target)


@router.get("/projects/{project_id}/scenarios", response_model=list[ScenarioOut])
def list_scenarios(project: ProjectDep, db: DB) -> list[CostScenario]:
    return list(db.scalars(select(CostScenario).where(CostScenario.project_id == project.id).order_by(CostScenario.updated_at.desc())))


@router.post("/projects/{project_id}/scenarios", response_model=ScenarioOut, status_code=201)
def create_scenario(body: ScenarioIn, project: ProjectDep, db: DB, user: CurrentUser) -> CostScenario:
    model = _validated(body.inputs)
    basis = {k: body.input_basis.get(k, "assumption") for k in model.model_dump()}
    sc = CostScenario(project_id=project.id, name=body.name, scenario_type=body.scenario_type, inputs=model.model_dump(),
                      input_basis=basis, results=calculate(model), supplier_quote_id=body.supplier_quote_id, notes=body.notes)
    db.add(sc)
    db.flush()
    audit.record(db, "cost_scenario.created", user_id=user.id, project_id=project.id, entity_type="cost_scenario", entity_id=sc.id)
    db.commit()
    return sc


@router.put("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(scenario_id: uuid.UUID, body: ScenarioIn, db: DB, user: CurrentUser) -> CostScenario:
    sc = owned(db, CostScenario, scenario_id, user)
    model = _validated(body.inputs)
    sc.name, sc.scenario_type, sc.notes = body.name, body.scenario_type, body.notes
    sc.inputs = model.model_dump()
    sc.input_basis = {k: body.input_basis.get(k, sc.input_basis.get(k, "assumption")) for k in model.model_dump()}
    sc.results = calculate(model)
    audit.record(db, "cost_scenario.updated", user_id=user.id, project_id=sc.project_id, entity_type="cost_scenario", entity_id=sc.id)
    db.commit()
    return sc


@router.delete("/scenarios/{scenario_id}", status_code=204)
def delete_scenario(scenario_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    sc = owned(db, CostScenario, scenario_id, user)
    db.delete(sc)
    db.commit()


@router.post("/projects/{project_id}/scenarios/from-quote/{quote_id}", response_model=ScenarioOut, status_code=201)
def scenario_from_quote(quote_id: uuid.UUID, project: ProjectDep, db: DB, user: CurrentUser) -> CostScenario:
    q = owned(db, SupplierQuote, quote_id, user)
    if q.supplier.project_id != project.id:
        raise HTTPException(404, "Quote not found in this project")
    if q.unit_price is None or q.currency.upper() != "USD":
        raise HTTPException(400, "Quote needs a USD unit price to build a scenario.")
    base, base_name, basis = baseline_inputs(db, project)
    updates = {"factory_cost": float(q.unit_price)}
    basis = {**basis, "factory_cost": "supplier_quote"}
    if q.est_freight_per_unit is not None:
        updates["freight_per_unit"] = float(q.est_freight_per_unit)
        basis["freight_per_unit"] = "supplier_quote"
    if q.moq is not None:
        updates["moq"] = q.moq
        basis["moq"] = "supplier_quote"
    if q.sample_cost is not None:
        updates["sample_costs"] = float(q.sample_cost)
        basis["sample_costs"] = "supplier_quote"
    model = base.model_copy(update=updates)
    sc = CostScenario(project_id=project.id, name=f"{q.supplier.name} - {q.product_name}", scenario_type="quote_based",
                      inputs=model.model_dump(), input_basis=basis, results=calculate(model), supplier_quote_id=q.id,
                      notes=f"Factory cost/MOQ from supplier quote; other inputs from '{base_name}'.")
    db.add(sc)
    db.flush()
    audit.record(db, "cost_scenario.created", user_id=user.id, project_id=project.id, entity_type="cost_scenario", entity_id=sc.id,
                 details={"from_quote": str(q.id)})
    db.commit()
    return sc


# ----------------------------------------------------------------------------- experiments & recommendations


@router.get("/projects/{project_id}/experiments", response_model=list[ExperimentOut])
def list_experiments(project: ProjectDep, db: DB) -> list[Experiment]:
    return list(db.scalars(select(Experiment).where(Experiment.project_id == project.id).order_by(Experiment.created_at.desc())))


@router.post("/projects/{project_id}/experiments", response_model=ExperimentOut, status_code=201)
def create_experiment(body: ExperimentIn, project: ProjectDep, db: DB, user: CurrentUser) -> Experiment:
    e = Experiment(project_id=project.id, **body.model_dump())
    db.add(e)
    db.commit()
    return e


@router.put("/experiments/{experiment_id}", response_model=ExperimentOut)
def update_experiment(experiment_id: uuid.UUID, body: ExperimentIn, db: DB, user: CurrentUser) -> Experiment:
    e = owned(db, Experiment, experiment_id, user)
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    db.commit()
    return e


@router.delete("/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    e = owned(db, Experiment, experiment_id, user)
    db.delete(e)
    db.commit()


@router.get("/projects/{project_id}/recommendations", response_model=list[RecommendationOut])
def list_recommendations(project: ProjectDep, db: DB, status: str | None = None) -> list[Recommendation]:
    stmt = select(Recommendation).where(Recommendation.project_id == project.id)
    if status:
        stmt = stmt.where(Recommendation.status == status)
    return list(db.scalars(stmt.order_by(Recommendation.created_at.desc())))


@router.patch("/recommendations/{rec_id}", response_model=RecommendationOut)
def update_recommendation(rec_id: uuid.UUID, body: RecommendationPatch, db: DB, user: CurrentUser) -> Recommendation:
    r = owned(db, Recommendation, rec_id, user)
    r.status = body.status
    audit.record(db, "recommendation.updated", user_id=user.id, project_id=r.project_id, entity_type="recommendation",
                 entity_id=r.id, details={"status": body.status})
    db.commit()
    return r
