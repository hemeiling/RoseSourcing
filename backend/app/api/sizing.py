"""Size charts (size scales), the fit finder, and the public customer-facing size guide."""

from __future__ import annotations

import secrets
import uuid
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from .. import audit
from ..models import SizeChart, Supplier
from ..services import fit
from ..services.agents.product_scan import ALLOWED_TYPES, MAX_BYTES
from ..services.agents.size_chart import chart_fields, extract_from_image, rows_from_extraction
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["sizing"])

Role = Literal["reference", "supplier", "published"]
Garment = Literal["dress", "top", "bottom", "bodysuit", "shoes", "other"]
Unit = Literal["cm", "in"]


class SizeRowIn(BaseModel):
    size: str = Field(min_length=1, max_length=40)
    labels: dict[str, str] = {}
    measurements: dict[str, list[float | None] | float | None] = {}


class SizeChartIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    role: Role = "supplier"
    garment_type: Garment = "dress"
    brand: str | None = Field(None, max_length=200)
    supplier_id: uuid.UUID | None = None
    unit: Unit = Field("cm", description="Unit of the measurements in rows and stretch_allowance")
    dimensions: list[str] = []
    size_systems: list[str] = []
    rows: list[SizeRowIn] = []
    stretch_allowance: float = Field(0, ge=0, le=30)
    fit_notes: str | None = Field(None, max_length=2000)
    source_url: str | None = None


class FitIn(BaseModel):
    measurements: dict[str, float | None]
    unit: Unit = "cm"


def chart_out(c: SizeChart) -> dict[str, Any]:
    return {
        "id": str(c.id), "project_id": str(c.project_id), "name": c.name, "role": c.role, "garment_type": c.garment_type,
        "brand": c.brand, "supplier_id": str(c.supplier_id) if c.supplier_id else None, "dimensions": c.dimensions,
        "dimension_labels": {d: fit.label(d) for d in c.dimensions}, "size_systems": c.size_systems, "rows": c.rows,
        "stretch_allowance_cm": float(c.stretch_allowance_cm or 0), "fit_notes": c.fit_notes, "source_type": c.source_type,
        "source_url": c.source_url, "retrieved_at": c.retrieved_at, "verification_status": c.verification_status,
        "research_run_id": str(c.research_run_id) if c.research_run_id else None,
        "has_source_image": c.source_media_type is not None, "published": c.published,
        "public_path": f"/fit?c={c.public_slug}" if c.published and c.public_slug else None,
        "fit_stats": c.fit_stats or {}, "created_at": c.created_at, "updated_at": c.updated_at,
    }


def public_out(c: SizeChart) -> dict[str, Any]:
    return {"name": c.name, "garment_type": c.garment_type, "brand": c.brand, "dimensions": c.dimensions,
            "dimension_labels": {d: fit.label(d) for d in c.dimensions}, "size_systems": c.size_systems, "rows": c.rows,
            "stretch_allowance_cm": float(c.stretch_allowance_cm or 0), "fit_notes": c.fit_notes}


def _apply(c: SizeChart, body: SizeChartIn, db, user) -> None:
    try:
        rows = fit.normalise_rows([r.model_dump() for r in body.rows], body.unit)
    except (ValueError, TypeError) as e:
        raise HTTPException(422, str(e)) from e
    present = [d for r in rows for d in r["measurements"]]
    dims = [d.strip().lower().replace(" ", "_") for d in body.dimensions if d.strip()]
    dims += [d for d in dict.fromkeys(present) if d not in dims]
    if body.supplier_id and owned(db, Supplier, body.supplier_id, user).project_id != c.project_id:
        raise HTTPException(422, "Supplier belongs to another project.")
    c.name, c.role, c.garment_type, c.brand, c.supplier_id = body.name.strip(), body.role, body.garment_type, body.brand, body.supplier_id
    c.dimensions = dims or fit.GARMENT_DIMENSIONS[body.garment_type]
    c.size_systems = [s.strip()[:16] for s in body.size_systems if s.strip()]
    c.rows = rows
    c.stretch_allowance_cm = Decimal(str(round(fit.to_cm(body.stretch_allowance, body.unit), 1)))
    c.fit_notes = body.fit_notes
    if body.source_url is not None:
        c.source_url = body.source_url or None


@router.get("/fit/dimensions")
def dimensions(user: CurrentUser) -> dict:
    return {"dimensions": fit.DIMENSIONS, "garment_dimensions": fit.GARMENT_DIMENSIONS}


@router.get("/projects/{project_id}/size-charts")
def list_charts(project: ProjectDep, db: DB) -> list[dict]:
    rows = db.scalars(select(SizeChart).where(SizeChart.project_id == project.id).order_by(SizeChart.role, SizeChart.created_at)).all()
    return [chart_out(c) for c in rows]


@router.post("/projects/{project_id}/size-charts", status_code=201)
def create_chart(body: SizeChartIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    c = SizeChart(project_id=project.id, created_by_id=user.id, source_type="manual", fit_stats={},
                  verification_status="human_verified" if body.role == "published" else "unverified")
    _apply(c, body, db, user)
    db.add(c)
    db.flush()
    audit.record(db, "size_chart.created", user_id=user.id, project_id=project.id, entity_type="size_chart", entity_id=c.id,
                 details={"name": c.name, "role": c.role, "sizes": len(c.rows)})
    db.commit()
    return chart_out(c)


@router.post("/projects/{project_id}/size-charts/extract", status_code=201)
async def extract_chart(project: ProjectDep, db: DB, user: CurrentUser, file: UploadFile = File(...),
                        role: Role = Form("supplier"), name: str | None = Form(None)) -> dict:
    media_type = (file.content_type or "").lower()
    if media_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Upload a JPEG, PNG, WebP or GIF image.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "Image is larger than 5 MB.")
    ext = extract_from_image(db, project, user, media_type, data)
    rows, _ = rows_from_extraction(ext)
    if not rows:
        db.commit()
        raise HTTPException(422, "No size measurements could be read from this image. Try a sharper, uncropped screenshot of the size chart.")
    try:
        fields = chart_fields(ext, rows)
    except ValueError as e:
        db.commit()
        raise HTTPException(422, f"The chart could not be read cleanly: {e}") from e
    c = SizeChart(project_id=project.id, created_by_id=user.id, role=role, source_type="photo_extracted", verification_status="unverified",
                  name=(name or f"{ext.brand_or_seller or 'Size chart'} - {ext.product_type}")[:200], source_image=data,
                  source_media_type=media_type, retrieved_at=date.today(), fit_stats={}, **fields)
    db.add(c)
    db.flush()
    audit.record(db, "size_chart.extracted", user_id=user.id, project_id=project.id, actor="agent:fit", entity_type="size_chart",
                 entity_id=c.id, details={"name": c.name, "sizes": len(c.rows), "unit_in_image": ext.unit})
    db.commit()
    return chart_out(c)


@router.put("/size-charts/{chart_id}")
def update_chart(chart_id: uuid.UUID, body: SizeChartIn, db: DB, user: CurrentUser) -> dict:
    c = owned(db, SizeChart, chart_id, user)
    before = (c.rows, float(c.stretch_allowance_cm or 0))
    _apply(c, body, db, user)
    if (c.rows, float(c.stretch_allowance_cm or 0)) != before and c.source_type != "manual" and c.verification_status != "human_verified":
        c.verification_status = "unverified"  # edited numbers no longer match the source exactly
    audit.record(db, "size_chart.updated", user_id=user.id, project_id=c.project_id, entity_type="size_chart", entity_id=c.id,
                 details={"name": c.name, "sizes": len(c.rows)})
    db.commit()
    return chart_out(c)


@router.post("/size-charts/{chart_id}/verify")
def verify_chart(chart_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    c = owned(db, SizeChart, chart_id, user)
    c.verification_status = "human_verified"
    audit.record(db, "size_chart.verified", user_id=user.id, project_id=c.project_id, entity_type="size_chart", entity_id=c.id)
    db.commit()
    return chart_out(c)


@router.post("/size-charts/{chart_id}/duplicate", status_code=201)
def duplicate_chart(chart_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    """Start your own size guide from a reference or supplier chart."""
    src = owned(db, SizeChart, chart_id, user)
    c = SizeChart(project_id=src.project_id, created_by_id=user.id, name=f"Our size guide - {src.name}"[:200], role="published",
                  garment_type=src.garment_type, dimensions=list(src.dimensions), size_systems=list(src.size_systems),
                  rows=[dict(r) for r in src.rows], stretch_allowance_cm=src.stretch_allowance_cm, fit_notes=src.fit_notes,
                  source_type="manual", source_url=src.source_url, verification_status="unverified", fit_stats={})
    db.add(c)
    db.flush()
    audit.record(db, "size_chart.created", user_id=user.id, project_id=c.project_id, entity_type="size_chart", entity_id=c.id,
                 details={"name": c.name, "copied_from": str(src.id)})
    db.commit()
    return chart_out(c)


@router.post("/size-charts/{chart_id}/publish")
def publish_chart(chart_id: uuid.UUID, db: DB, user: CurrentUser, published: bool = True) -> dict:
    c = owned(db, SizeChart, chart_id, user)
    if published:
        if c.role != "published":
            raise HTTPException(409, "Only your own size guide can be shared with customers. Duplicate this chart as your size guide first.")
        if not c.rows:
            raise HTTPException(409, "Add sizes before sharing the size guide.")
        if c.verification_status != "human_verified":
            raise HTTPException(409, "Check the numbers and mark this size guide as verified before customers see it.")
        c.public_slug = c.public_slug or secrets.token_urlsafe(12)
    c.published = published
    audit.record(db, "size_chart.published" if published else "size_chart.unpublished", user_id=user.id, project_id=c.project_id,
                 entity_type="size_chart", entity_id=c.id)
    db.commit()
    return chart_out(c)


@router.delete("/size-charts/{chart_id}", status_code=204)
def delete_chart(chart_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    c = owned(db, SizeChart, chart_id, user)
    audit.record(db, "size_chart.deleted", user_id=user.id, project_id=c.project_id, entity_type="size_chart", entity_id=c.id,
                 details={"name": c.name})
    db.delete(c)
    db.commit()
    return Response(status_code=204)


@router.get("/size-charts/{chart_id}/source-image")
def chart_image(chart_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    c = owned(db, SizeChart, chart_id, user)
    if not c.source_image:
        raise HTTPException(404, "No source image for this chart.")
    return Response(content=c.source_image, media_type=c.source_media_type, headers={"Cache-Control": "private, max-age=86400"})


@router.post("/size-charts/{chart_id}/recommend")
def recommend(chart_id: uuid.UUID, body: FitIn, db: DB, user: CurrentUser) -> dict:
    c = owned(db, SizeChart, chart_id, user)
    return fit.recommend(c.rows, body.measurements, stretch_allowance_cm=float(c.stretch_allowance_cm or 0), unit=body.unit,
                         fit_notes=c.fit_notes)


# ----------------------------------------------------------------------------- public (customers, no sign-in)


def _public_chart(db, slug: str) -> SizeChart:
    c = db.scalars(select(SizeChart).where(SizeChart.public_slug == slug, SizeChart.published.is_(True))).first()
    if c is None:
        raise HTTPException(404, "This size guide is not available.")
    return c


@router.get("/public/size-guides/{slug}")
def public_chart(slug: str, db: DB) -> dict:
    return public_out(_public_chart(db, slug))


@router.post("/public/size-guides/{slug}/recommend")
def public_recommend(slug: str, body: FitIn, db: DB) -> dict:
    c = _public_chart(db, slug)
    if len(body.measurements) > 12:
        raise HTTPException(422, "Too many measurements.")
    result = fit.recommend(c.rows, body.measurements, stretch_allowance_cm=float(c.stretch_allowance_cm or 0), unit=body.unit,
                           fit_notes=c.fit_notes)
    if result["status"] != "insufficient":
        stats = dict(c.fit_stats or {})
        key = result["recommended"] or "_none"
        stats[key] = stats.get(key, 0) + 1
        stats["_total"] = stats.get("_total", 0) + 1
        c.fit_stats = stats
        flag_modified(c, "fit_stats")
        db.commit()
    result.pop("measurements_cm", None)
    return result
