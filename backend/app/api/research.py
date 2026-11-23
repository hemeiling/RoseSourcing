from __future__ import annotations

import uuid

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm.attributes import flag_modified

from .. import audit
from ..config import get_settings
from ..models import AnalysisSnapshot, CustomerSegment, EvidenceSource, MarketOpportunity, ResearchFinding, ResearchRun, Supplier
from ..schemas import (
    EvidenceSourceOut,
    FindingOut,
    FindingSourceOut,
    FindingReviewIn,
    OpportunityOut,
    ResearchRunOut,
    ResearchStartIn,
    SegmentOut,
)
from ..services.agents.opportunity import initial_steps, submit_run
from ..services.llm.anthropic_provider import get_llm
from ..services import demand
from ..services.research.providers import PROVIDERS, get_research_provider
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["research"])


def finding_out(f: ResearchFinding) -> FindingOut:
    out = FindingOut.model_validate(f)
    out.sources = [FindingSourceOut(source=EvidenceSourceOut.model_validate(l.source), quote=l.quote)
                   for l in f.evidence_links if l.source]
    return out


@router.get("/research/providers")
def providers(user: CurrentUser) -> dict:
    s = get_settings()
    return {
        "default": s.research_provider,
        "providers": [{"name": p.name, "label": p.label, "configured": p.is_configured(), "requirement": p.config_requirement()}
                      for p in PROVIDERS.values()],
        "guardrails": {"max_searches_per_step": s.max_searches_per_step, "max_research_cost_usd": s.max_research_cost_usd,
                       "max_step_attempts": s.max_step_attempts},
    }


@router.post("/projects/{project_id}/research-runs", response_model=ResearchRunOut, status_code=201)
def start_run(body: ResearchStartIn, project: ProjectDep, db: DB, user: CurrentUser) -> ResearchRun:
    provider = get_research_provider(body.provider)
    if not provider.is_configured():
        raise HTTPException(503, {"code": "research_not_configured", "message": f"{provider.label} is not configured. {provider.config_requirement()}"})
    active = db.scalars(select(ResearchRun).where(ResearchRun.project_id == project.id,
                                                  ResearchRun.status.in_(["queued", "running"]))).first()
    if active:
        raise HTTPException(409, "A research run is already in progress for this project.")
    params = body.model_dump(exclude={"kind", "provider"}, exclude_none=True)
    if body.kind == "compliance":
        names = db.scalars(select(Supplier.name).where(Supplier.project_id == project.id)).all()
        params["suppliers"] = ", ".join(names)[:1000] or "none on file yet"
    run = ResearchRun(project_id=project.id, created_by_id=user.id, kind=body.kind, status="queued", provider=provider.name,
                      model=get_llm().model, params=params, steps=initial_steps(body.kind))
    db.add(run)
    db.flush()
    audit.record(db, "research_run.started", user_id=user.id, project_id=project.id, entity_type="research_run",
                 entity_id=run.id, details={"kind": body.kind, "provider": provider.name, **params})
    db.commit()
    submit_run(run.id)
    return run


@router.get("/projects/{project_id}/research-runs", response_model=list[ResearchRunOut])
def list_runs(project: ProjectDep, db: DB) -> list[ResearchRun]:
    return list(db.scalars(select(ResearchRun).where(ResearchRun.project_id == project.id).order_by(ResearchRun.created_at.desc())))


@router.get("/research-runs/{run_id}", response_model=ResearchRunOut)
def get_run(run_id: uuid.UUID, db: DB, user: CurrentUser) -> ResearchRun:
    return owned(db, ResearchRun, run_id, user)


@router.post("/research-runs/{run_id}/cancel", response_model=ResearchRunOut)
def cancel_run(run_id: uuid.UUID, db: DB, user: CurrentUser) -> ResearchRun:
    run = owned(db, ResearchRun, run_id, user)
    if run.status not in ("queued", "running"):
        raise HTTPException(409, f"Run is {run.status}; nothing to cancel.")
    run.status = "cancelled"
    run.error = "Cancelled by user. The step in progress may finish in the background but no further steps will start."
    audit.record(db, "research_run.cancelled", user_id=user.id, project_id=run.project_id, entity_type="research_run", entity_id=run.id)
    db.commit()
    return run


@router.post("/research-runs/{run_id}/resume", response_model=ResearchRunOut)
def resume_run(run_id: uuid.UUID, db: DB, user: CurrentUser) -> ResearchRun:
    run = owned(db, ResearchRun, run_id, user)
    if run.status not in ("interrupted", "failed", "completed_with_errors", "cancelled"):
        raise HTTPException(409, f"Run is {run.status}; it cannot be resumed.")
    provider = get_research_provider(run.provider)
    if not provider.is_configured():
        raise HTTPException(503, {"code": "research_not_configured", "message": provider.config_requirement()})
    run.steps = [dict(s, status="pending", error=None) if s["status"] != "completed" else s for s in run.steps]
    run.status, run.error, run.completed_at = "queued", None, None
    audit.record(db, "research_run.resumed", user_id=user.id, project_id=run.project_id, entity_type="research_run", entity_id=run.id)
    db.commit()
    submit_run(run.id)
    return run


@router.get("/projects/{project_id}/snapshots/{kind}")
def latest_snapshot(kind: Literal["price_tiers", "compliance_checklist", "listing_tracker", "review_insights"], project: ProjectDep, db: DB) -> dict | None:
    """The latest price tiers, compliance checklist, listing tracker or review insights for a product (null if none yet)."""
    snap = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project.id, AnalysisSnapshot.kind == kind)
                      .order_by(AnalysisSnapshot.created_at.desc())).first()
    if not snap:
        return None
    content = snap.content
    if kind == "compliance_checklist":
        # Each checklist item links to the pages its findings came from, so the claim can be checked at the source.
        ids = {uuid.UUID(i) for item in content.get("items", []) for i in item.get("finding_ids", [])}
        findings = {str(f.id): f for f in db.scalars(select(ResearchFinding).where(ResearchFinding.id.in_(ids)))} if ids else {}
        items = []
        for item in content.get("items", []):
            sources: dict[str, str] = {}
            for fid in item.get("finding_ids", []):
                for link in findings[fid].evidence_links if fid in findings else []:
                    if link.source.url:
                        sources.setdefault(link.source.url, link.source.title or link.source.url)
            items.append({**item, "sources": [{"url": u, "title": t} for u, t in sources.items()]})
        content = {**content, "items": items}
    if kind == "price_tiers":
        content = _with_listing_pictures(db, project.id, content)
    return {"id": str(snap.id), "kind": snap.kind, "content": content, "created_at": snap.created_at}


@router.post("/projects/{project_id}/snapshots/price_tiers/pictures")
def find_tier_pictures(project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    """Look the tier examples up again in Amazon and Google Shopping listings (up to 4 SerpApi searches, no AI) and save the
    picture and listing link of each example that has none."""
    snap = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project.id, AnalysisSnapshot.kind == "price_tiers")
                      .order_by(AnalysisSnapshot.created_at.desc())).first()
    if snap is None:
        raise HTTPException(404, "No price tiers yet.")
    if not demand.configured():
        raise HTTPException(503, {"code": "serpapi_not_configured", "message": "Pictures come from marketplace listings through SerpApi: connect it in Settings > Data sources."})
    run = db.get(ResearchRun, uuid.UUID(snap.content["research_run_id"])) if snap.content.get("research_run_id") else None
    keywords = snap.content.get("keywords") or ((run.params or {}).get("keywords") if run else None) or [project.product_category[:60]]
    obs, errors, calls = demand.price_tier_evidence(keywords, "US")
    media = {line: m for o in obs for line, m in o.media.items()}
    found = 0
    tiers = []
    for t in snap.content.get("tiers") or []:
        examples = []
        for e in t.get("examples") or []:
            m = None if e.get("image") else demand.match_listing(e.get("product") or "", media)
            if m and m.get("image"):
                search_page = not e.get("url") or e.get("url") == e.get("source_url") or "/search?" in (e.get("url") or "")
                e = {**e, "image": m["image"], "url": m.get("url") if search_page and m.get("url") else e.get("url")}
                found += 1
            examples.append(e)
        tiers.append({**t, "examples": examples})
    snap.content = {**snap.content, "tiers": tiers}
    flag_modified(snap, "content")
    audit.record(db, "price_tiers.pictures_found", user_id=user.id, project_id=project.id, entity_type="analysis_snapshot",
                 entity_id=snap.id, details={"found": found, "serpapi_calls": calls})
    db.commit()
    missing = sum(1 for t in tiers for e in t["examples"] if not e.get("image"))
    return {"found": found, "still_missing": missing, "serpapi_calls": calls, "errors": errors[:3]}


def _with_listing_pictures(db, project_id: uuid.UUID, content: dict) -> dict:
    """Tier examples saved before pictures were kept borrow the picture of the same tracked listing (same link or title)."""
    tracker = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project_id, AnalysisSnapshot.kind == "listing_tracker")
                         .order_by(AnalysisSnapshot.created_at.desc())).first()
    rows = [r for r in (tracker.content.get("listings") or []) if r.get("image")] if tracker else []
    if not rows:
        return content
    by_url = {r["url"]: r for r in rows if r.get("url")}
    media = {r["title"]: {"url": r.get("url"), "image": r["image"]} for r in rows}
    tiers = []
    for t in content.get("tiers") or []:
        examples = []
        for e in t.get("examples") or []:
            hit = None if e.get("image") else by_url.get(e.get("url") or "") or demand.match_listing(e.get("product") or "", media)
            examples.append({**e, "image": hit["image"], "url": e.get("url") or hit.get("url")} if hit else e)
        tiers.append({**t, "examples": examples})
    return {**content, "tiers": tiers}


@router.get("/projects/{project_id}/findings", response_model=list[FindingOut])
def list_findings(
    project: ProjectDep,
    db: DB,
    run_id: uuid.UUID | None = None,
    section: str | None = None,
    evidence_type: str | None = None,
    verification_status: str | None = None,
    q: str | None = None,
    limit: int = Query(300, le=1000),
) -> list[FindingOut]:
    stmt = select(ResearchFinding).where(ResearchFinding.project_id == project.id)
    if run_id:
        stmt = stmt.where(ResearchFinding.research_run_id == run_id)
    if section:
        stmt = stmt.where(ResearchFinding.section == section)
    if evidence_type:
        stmt = stmt.where(ResearchFinding.evidence_type == evidence_type)
    if verification_status:
        stmt = stmt.where(ResearchFinding.verification_status == verification_status)
    if q:
        stmt = stmt.where(or_(ResearchFinding.claim.ilike(f"%{q}%"), ResearchFinding.detail.ilike(f"%{q}%")))
    rows = db.scalars(stmt.order_by(ResearchFinding.created_at).limit(limit)).all()
    return [finding_out(f) for f in rows]


@router.patch("/findings/{finding_id}", response_model=FindingOut)
def review_finding(finding_id: uuid.UUID, body: FindingReviewIn, db: DB, user: CurrentUser) -> FindingOut:
    f = owned(db, ResearchFinding, finding_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("verification_status") == "source_linked":
        raise HTTPException(400, "source_linked is set only by the automated evidence check.")
    before = f.verification_status
    for k, v in data.items():
        setattr(f, k, v)
    audit.record(db, "finding.reviewed", user_id=user.id, project_id=f.project_id, entity_type="finding", entity_id=f.id,
                 details={"from": before, "to": f.verification_status, "note": f.reviewer_note})
    db.commit()
    return finding_out(f)


@router.delete("/findings/{finding_id}", status_code=204)
def delete_finding(finding_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    """Remove a finding that a later run superseded (its sources stay)."""
    f = owned(db, ResearchFinding, finding_id, user)
    audit.record(db, "finding.deleted", user_id=user.id, project_id=f.project_id, entity_type="finding", entity_id=f.id,
                 details={"claim": f.claim[:300]})
    db.delete(f)
    db.commit()


@router.get("/projects/{project_id}/segments", response_model=list[SegmentOut])
def list_segments(project: ProjectDep, db: DB, run_id: uuid.UUID | None = None) -> list[CustomerSegment]:
    stmt = select(CustomerSegment).where(CustomerSegment.project_id == project.id)
    if run_id:
        stmt = stmt.where(CustomerSegment.research_run_id == run_id)
    return list(db.scalars(stmt.order_by(CustomerSegment.created_at)))


@router.get("/projects/{project_id}/sources", response_model=list[EvidenceSourceOut])
def list_sources(project: ProjectDep, db: DB, run_id: uuid.UUID | None = None) -> list[EvidenceSource]:
    stmt = select(EvidenceSource).where(EvidenceSource.project_id == project.id)
    if run_id:
        stmt = stmt.where(EvidenceSource.research_run_id == run_id)
    return list(db.scalars(stmt.order_by(EvidenceSource.created_at)))


@router.get("/projects/{project_id}/opportunities", response_model=list[OpportunityOut])
def list_opportunities(project: ProjectDep, db: DB) -> list[MarketOpportunity]:
    return list(db.scalars(select(MarketOpportunity).where(MarketOpportunity.project_id == project.id)
                           .order_by(MarketOpportunity.created_at.desc())))


@router.get("/opportunities/{opportunity_id}", response_model=OpportunityOut)
def get_opportunity(opportunity_id: uuid.UUID, db: DB, user: CurrentUser) -> MarketOpportunity:
    return owned(db, MarketOpportunity, opportunity_id, user)


@router.delete("/opportunities/{opportunity_id}", status_code=204)
def delete_opportunity(opportunity_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    opp = owned(db, MarketOpportunity, opportunity_id, user)
    audit.record(db, "market_opportunity.deleted", user_id=user.id, project_id=opp.project_id, entity_type="market_opportunity", entity_id=opp.id)
    db.delete(opp)
    db.commit()
