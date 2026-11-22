from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy import func, select

from .. import audit
from ..models import (
    AgentExecution,
    AuditEvent,
    BrandConcept,
    BusinessProject,
    Competitor,
    CostScenario,
    Experiment,
    MarketOpportunity,
    ProductConcept,
    Recommendation,
    ResearchFinding,
    ResearchRun,
    SalesChannel,
    ShippingOption,
    Supplier,
)
from ..schemas import ProjectIn, ProjectOut, ProjectPatch
from .deps import DB, CurrentUser, ProjectDep

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _dec(v: float | None) -> Decimal | None:
    return Decimal(str(v)) if v is not None else None


@router.get("", response_model=list[ProjectOut])
def list_projects(db: DB, user: CurrentUser) -> list[BusinessProject]:
    return list(db.scalars(select(BusinessProject).where(BusinessProject.owner_id == user.id)
                           .order_by(BusinessProject.updated_at.desc())))


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: DB, user: CurrentUser) -> BusinessProject:
    p = BusinessProject(
        owner_id=user.id, name=body.name, product_category=body.product_category, target_country=body.target_country,
        sourcing_country=body.sourcing_country, budget_usd=_dec(body.budget_usd), target_customers=body.target_customers,
        price_min=_dec(body.price_min), price_max=_dec(body.price_max), notes=body.notes,
        assumptions=[a.model_dump() for a in body.assumptions],
    )
    db.add(p)
    db.flush()
    audit.record(db, "project.created", user_id=user.id, project_id=p.id, entity_type="project", entity_id=p.id)
    db.commit()
    return p


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project: ProjectDep) -> BusinessProject:
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(body: ProjectPatch, project: ProjectDep, db: DB, user: CurrentUser) -> BusinessProject:
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key in ("budget_usd", "price_min", "price_max"):
            value = _dec(value)
        if key == "assumptions" and value is not None:
            value = [dict(a) for a in value]
        setattr(project, key, value)
    audit.record(db, "project.updated", user_id=user.id, project_id=project.id, entity_type="project",
                 entity_id=project.id, details={"fields": sorted(data)})
    db.commit()
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project: ProjectDep, db: DB) -> None:
    db.delete(project)
    db.commit()


@router.get("/{project_id}/dashboard")
def dashboard(project: ProjectDep, db: DB) -> dict:
    pid = project.id

    def count(model, *where) -> int:
        return db.scalar(select(func.count(model.id)).where(model.project_id == pid, *where)) or 0

    latest_opp = db.scalars(select(MarketOpportunity).where(MarketOpportunity.project_id == pid)
                            .order_by(MarketOpportunity.created_at.desc())).first()
    latest_run = db.scalars(select(ResearchRun).where(ResearchRun.project_id == pid)
                            .order_by(ResearchRun.created_at.desc())).first()
    by_type = dict(db.execute(select(ResearchFinding.evidence_type, func.count(ResearchFinding.id))
                              .where(ResearchFinding.project_id == pid).group_by(ResearchFinding.evidence_type)).all())
    recs = db.scalars(select(Recommendation).where(Recommendation.project_id == pid, Recommendation.status.in_(["open", "accepted"]))
                      .order_by(Recommendation.created_at.desc()).limit(6)).all()
    activity = db.scalars(select(AuditEvent).where(AuditEvent.project_id == pid).order_by(AuditEvent.created_at.desc()).limit(10)).all()
    spend = db.scalar(select(func.coalesce(func.sum(AgentExecution.cost_usd), 0)).where(AgentExecution.project_id == pid))
    best_scenario = db.scalars(select(CostScenario).where(CostScenario.project_id == pid).order_by(CostScenario.updated_at.desc())).first()

    return {
        "counts": {
            "findings": count(ResearchFinding), "reports": count(MarketOpportunity), "competitors": count(Competitor),
            "watchlist": count(Competitor, Competitor.on_watchlist.is_(True)), "suppliers": count(Supplier),
            "scenarios": count(CostScenario), "brand_concepts": count(BrandConcept), "products": count(ProductConcept),
            "experiments": count(Experiment), "research_runs": count(ResearchRun),
            "channels": count(SalesChannel), "shipping_options": count(ShippingOption),
        },
        "findings_by_type": by_type,
        "latest_report": {"id": str(latest_opp.id), "title": latest_opp.title, "attractiveness": latest_opp.attractiveness,
                          "summary": latest_opp.summary, "created_at": latest_opp.created_at} if latest_opp else None,
        "latest_run": {"id": str(latest_run.id), "kind": latest_run.kind, "status": latest_run.status,
                       "current_step": latest_run.current_step, "created_at": latest_run.created_at} if latest_run else None,
        "latest_scenario": {"id": str(best_scenario.id), "name": best_scenario.name, "type": best_scenario.scenario_type,
                            "contribution_margin": (best_scenario.results or {}).get("contribution_margin"),
                            "contribution_margin_pct": (best_scenario.results or {}).get("contribution_margin_pct"),
                            "retail_price": (best_scenario.inputs or {}).get("retail_price")} if best_scenario else None,
        "open_recommendations": [{"id": str(r.id), "title": r.title, "priority": r.priority, "source": r.source, "status": r.status} for r in recs],
        "recent_activity": [{"action": a.action, "actor": a.actor, "entity_type": a.entity_type, "created_at": a.created_at} for a in activity],
        "ai_spend_usd": float(spend or 0),
    }
