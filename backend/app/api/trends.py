"""Google Trends explorer: compare search phrases over time, by region, and their related searches and topics."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from .. import audit
from ..models import AnalysisSnapshot
from ..services import demand, trends
from .deps import DB, CurrentUser, ProjectDep

router = APIRouter(prefix="/api", tags=["trends"])


class TrendsIn(BaseModel):
    terms: list[str] = Field(min_length=1, max_length=trends.MAX_TERMS)
    date: Literal["today 3-m", "today 12-m", "today 5-y", "all"] = "today 12-m"
    geo: str = Field("US", max_length=8, description="Country code, or empty for worldwide")

    @field_validator("terms")
    @classmethod
    def _clean(cls, terms: list[str]) -> list[str]:
        out = list(dict.fromkeys(t.strip()[:100] for t in terms if t.strip() and "," not in t))
        if not out:
            raise ValueError("Enter at least one search phrase.")
        return out


class RelatedIn(BaseModel):
    term: str = Field(min_length=1, max_length=100)


def _latest(db, project_id) -> AnalysisSnapshot | None:
    return db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project_id, AnalysisSnapshot.kind == "trends_explorer")
                      .order_by(AnalysisSnapshot.created_at.desc())).first()


def _need_serpapi() -> None:
    if not demand.configured():
        raise HTTPException(503, {"code": "serpapi_not_configured", "message": "Google Trends data comes through SerpApi: connect it in Settings > Data sources."})


@router.get("/projects/{project_id}/trends")
def latest_trends(project: ProjectDep, db: DB) -> dict:
    snap = _latest(db, project.id)
    tracker = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project.id, AnalysisSnapshot.kind == "listing_tracker")
                         .order_by(AnalysisSnapshot.created_at.desc())).first()
    suggested = (tracker.content.get("keywords") if tracker else None) or [project.product_category[:60]]
    return {"snapshot": {"id": str(snap.id), "content": snap.content, "created_at": snap.created_at} if snap else None,
            "suggested_terms": suggested[:trends.MAX_TERMS], "ranges": trends.RANGES}


@router.post("/projects/{project_id}/trends", status_code=201)
def compare_trends(body: TrendsIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    """Interest over time and by region for up to 5 phrases (2 SerpApi searches). Saved with the product."""
    _need_serpapi()
    try:
        content = trends.compare(body.terms, body.date, body.geo.upper())
    except RuntimeError as e:
        raise HTTPException(502, f"Google Trends request failed: {e}") from e
    snap = AnalysisSnapshot(project_id=project.id, kind="trends_explorer", content=content)
    db.add(snap)
    db.flush()
    audit.record(db, "trends.compared", user_id=user.id, project_id=project.id, entity_type="analysis_snapshot", entity_id=snap.id,
                 details={"terms": body.terms, "date": body.date, "geo": body.geo})
    db.commit()
    return {"id": str(snap.id), "content": snap.content, "created_at": snap.created_at}


@router.post("/projects/{project_id}/trends/related")
def related_trends(body: RelatedIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    """Related searches and topics (top and rising) for one phrase of the latest comparison (2 SerpApi searches)."""
    _need_serpapi()
    snap = _latest(db, project.id)
    if snap is None or body.term not in snap.content.get("terms", []):
        raise HTTPException(404, "Compare this phrase first.")
    try:
        rel = trends.related(body.term, snap.content["date"], snap.content.get("geo", ""))
    except RuntimeError as e:
        raise HTTPException(502, f"Google Trends request failed: {e}") from e
    snap.content = {**snap.content, "related": {**(snap.content.get("related") or {}), body.term: rel},
                    "serpapi_calls": int(snap.content.get("serpapi_calls") or 0) + 2}
    flag_modified(snap, "content")
    db.commit()
    return {"id": str(snap.id), "content": snap.content, "created_at": snap.created_at}
