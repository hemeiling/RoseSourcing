"""Product pipeline: every product/category project with its research status, AI brief and the founder's decision."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import audit
from ..models import (
    AnalysisSnapshot,
    BusinessProject,
    Competitor,
    CostScenario,
    MarketOpportunity,
    ProjectDecision,
    ResearchFinding,
    ResearchRun,
    Supplier,
)
from ..services.agents.decision import evidence_snapshot, generate
from .deps import DB, CurrentUser, ProjectDep

router = APIRouter(prefix="/api", tags=["pipeline & decisions"])


class DecisionIn(BaseModel):
    decision: Literal["undecided", "go", "no_go", "on_hold"]
    note: str | None = Field(None, max_length=4000)


def _latest(db, model, pid, order_col):
    return db.scalars(select(model).where(model.project_id == pid).order_by(order_col.desc())).first()


@router.get("/pipeline")
def pipeline(db: DB, user: CurrentUser) -> list[dict]:
    projects = db.scalars(select(BusinessProject).where(BusinessProject.owner_id == user.id).order_by(BusinessProject.updated_at.desc())).all()
    out = []
    for p in projects:
        opp = _latest(db, MarketOpportunity, p.id, MarketOpportunity.created_at)
        sc = _latest(db, CostScenario, p.id, CostScenario.updated_at)
        run = _latest(db, ResearchRun, p.id, ResearchRun.created_at)
        brief = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == p.id, AnalysisSnapshot.kind == "decision_brief")
                           .order_by(AnalysisSnapshot.created_at.desc())).first()
        last = db.scalars(select(ProjectDecision).where(ProjectDecision.project_id == p.id).order_by(ProjectDecision.created_at.desc())).first()
        count = lambda m: db.scalar(select(func.count(m.id)).where(m.project_id == p.id)) or 0  # noqa: E731
        out.append({
            "id": str(p.id), "name": p.name, "category": p.product_category, "target_country": p.target_country,
            "status": p.status, "decision": p.decision, "decision_note": p.decision_note, "decided_at": p.decided_at,
            "image_url": f"/api/product-scans/{p.cover_scan_id}/image" if p.cover_scan_id else None,
            "attractiveness": opp.attractiveness if opp else None,
            "ai_recommendation": (brief.content or {}).get("recommendation") if brief else None,
            "ai_headline": (brief.content or {}).get("headline") if brief else None,
            "ai_confidence": (brief.content or {}).get("confidence") if brief else None,
            "ai_confidence_score": (brief.content or {}).get("confidence_score") if brief else None,
            "contribution_margin": (sc.results or {}).get("contribution_margin") if sc else None,
            "contribution_margin_pct": (sc.results or {}).get("contribution_margin_pct") if sc else None,
            "scenario_type": sc.scenario_type if sc else None,
            "latest_run": {"id": str(run.id), "kind": run.kind, "status": run.status, "current_step": run.current_step} if run else None,
            "counts": {"findings": count(ResearchFinding), "competitors": count(Competitor), "suppliers": count(Supplier)},
            "last_decision_at": last.created_at if last else None,
            "updated_at": p.updated_at,
        })
    return out


@router.post("/projects/{project_id}/decision")
def record_decision(body: DecisionIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    before = project.decision
    project.decision = body.decision
    project.decision_note = body.note
    project.decided_at = datetime.now(timezone.utc)
    entry = ProjectDecision(project_id=project.id, user_id=user.id, decision=body.decision, note=body.note,
                            snapshot=evidence_snapshot(db, project))
    db.add(entry)
    audit.record(db, "decision.recorded", user_id=user.id, project_id=project.id, entity_type="project", entity_id=project.id,
                 details={"from": before, "to": body.decision, "note": body.note})
    db.commit()
    return {"decision": project.decision, "decided_at": project.decided_at, "history_id": str(entry.id)}


@router.get("/projects/{project_id}/decisions")
def decision_history(project: ProjectDep, db: DB) -> list[dict]:
    rows = db.scalars(select(ProjectDecision).where(ProjectDecision.project_id == project.id).order_by(ProjectDecision.created_at.desc())).all()
    return [{"id": str(r.id), "decision": r.decision, "note": r.note, "snapshot": r.snapshot, "created_at": r.created_at} for r in rows]


@router.post("/projects/{project_id}/decision-brief")
def create_brief(project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    _, snap = generate(db, project, user)
    audit.record(db, "decision_brief.created", user_id=user.id, project_id=project.id, actor="agent:supervisor",
                 entity_type="analysis_snapshot", entity_id=snap.id)
    db.commit()
    return {"id": str(snap.id), "created_at": snap.created_at, "content": snap.content}


@router.get("/projects/{project_id}/decision-brief")
def latest_brief(project: ProjectDep, db: DB) -> dict | None:
    snap = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project.id, AnalysisSnapshot.kind == "decision_brief")
                      .order_by(AnalysisSnapshot.created_at.desc())).first()
    return {"id": str(snap.id), "created_at": snap.created_at, "content": snap.content} if snap else None
