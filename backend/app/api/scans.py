from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select

from .. import audit
from ..models import BusinessProject, ProductScan, ResearchRun
from ..services.agents.opportunity import initial_steps, submit_run
from ..services.agents.product_scan import ALLOWED_TYPES, MAX_BYTES, identify
from ..services.llm.anthropic_provider import get_llm
from ..services.research.providers import get_research_provider
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["product scans"])


def scan_out(s: ProductScan, run: ResearchRun | None = None) -> dict:
    return {
        "id": str(s.id), "project_id": str(s.project_id), "status": s.status, "identification": s.identification,
        "error": s.error, "research_run_id": str(s.research_run_id) if s.research_run_id else None,
        "image_url": f"/api/product-scans/{s.id}/image", "created_at": s.created_at,
        "run_status": run.status if run else None,
    }


def start_scan_research(db, project: BusinessProject, scan: ProductScan, user) -> tuple[ResearchRun | None, str | None]:
    """Start market research for an identified product. Returns (run, reason_if_not_started)."""
    ident = scan.identification or {}
    provider = get_research_provider(None)
    if not provider.is_configured():
        return None, f"{provider.label} is not configured. {provider.config_requirement()}"
    if db.scalars(select(ResearchRun).where(ResearchRun.project_id == project.id, ResearchRun.status.in_(["queued", "running"]))).first():
        return None, "A research run is already in progress for this project."
    params = {
        "category": ident.get("research_category") or project.product_category,
        "geography": project.target_country,
        "focus": "Product from the founder's photo: " + "; ".join(
            [ident.get("product_name", "")] + (ident.get("key_attributes") or [])[:6]),
        "keywords": (ident.get("search_keywords") or [])[:3],
        "product_scan_id": str(scan.id),
    }
    run = ResearchRun(project_id=project.id, created_by_id=user.id, kind="market_opportunity", status="queued",
                      provider=provider.name, model=get_llm().model, params=params, steps=initial_steps("market_opportunity"))
    db.add(run)
    db.flush()
    scan.research_run_id = run.id
    audit.record(db, "research_run.started", user_id=user.id, project_id=project.id, entity_type="research_run",
                 entity_id=run.id, details={"kind": "market_opportunity", "from": "product_photo", **params})
    return run, None


@router.post("/projects/{project_id}/product-scans", status_code=201)
async def create_scan(
    project: ProjectDep,
    db: DB,
    user: CurrentUser,
    file: UploadFile = File(...),
    mode: str = Form("new_project"),
    auto_research: bool = Form(True),
) -> dict:
    media_type = (file.content_type or "").lower()
    if media_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Upload a JPEG, PNG, WebP or GIF image.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "Image is larger than 5 MB.")
    scan = ProductScan(project_id=project.id, created_by_id=user.id, image=data, media_type=media_type, status="identifying")
    db.add(scan)
    db.commit()
    try:
        ident, ex = identify(db, project, user, media_type, data)
    except Exception as e:
        scan.status, scan.error = "failed", str(e)[:1000]
        db.commit()
        raise
    scan.identification = ident.model_dump()
    scan.status = "identified"
    target = project
    if not ident.is_product:
        db.commit()
        return {"scan": scan_out(scan), "project_id": str(project.id), "run": None,
                "research_note": "This image doesn't look like a sellable product, so no research was started."}
    if mode == "new_project":
        target = BusinessProject(
            owner_id=user.id, name=ident.product_name[:200], product_category=ident.research_category[:200],
            target_country=project.target_country, sourcing_country=project.sourcing_country,
            budget_usd=project.budget_usd, target_customers=", ".join(ident.likely_customers)[:2000] or None,
            notes="Created from a product photo. Category and customers are AI inferences from the image - edit as needed.",
            assumptions=[{"label": "Product identified from photo", "value": ident.product_name, "status": "hypothesis"}],
            cover_scan_id=scan.id,
        )
        db.add(target)
        db.flush()
        scan.project_id = target.id
        audit.record(db, "project.created", user_id=user.id, project_id=target.id, entity_type="project", entity_id=target.id,
                     details={"from": "product_photo", "scan_id": str(scan.id)})
    elif target.cover_scan_id is None:
        target.cover_scan_id = scan.id
    run, note = (None, None)
    if auto_research:
        run, note = start_scan_research(db, target, scan, user)
    db.commit()
    if run:
        submit_run(run.id)
    return {"scan": scan_out(scan, run), "project_id": str(target.id), "run": {"id": str(run.id), "status": run.status} if run else None,
            "research_note": note}


@router.post("/product-scans/{scan_id}/research")
def research_scan(scan_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    scan = owned(db, ProductScan, scan_id, user)
    if scan.status != "identified":
        raise HTTPException(409, "The photo has not been identified yet.")
    project = db.get(BusinessProject, scan.project_id)
    run, note = start_scan_research(db, project, scan, user)
    if run is None:
        if note and "not configured" in note:
            raise HTTPException(503, {"code": "research_not_configured", "message": note})
        raise HTTPException(409, note)
    db.commit()
    submit_run(run.id)
    return {"run": {"id": str(run.id), "status": run.status}}


@router.get("/projects/{project_id}/product-scans")
def list_scans(project: ProjectDep, db: DB) -> list[dict]:
    rows = db.scalars(select(ProductScan).where(ProductScan.project_id == project.id).order_by(ProductScan.created_at.desc())).all()
    runs = {r.id: r for r in db.scalars(select(ResearchRun).where(ResearchRun.id.in_([s.research_run_id for s in rows if s.research_run_id])))}
    return [scan_out(s, runs.get(s.research_run_id)) for s in rows]


@router.get("/product-scans/{scan_id}/image")
def scan_image(scan_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    scan = owned(db, ProductScan, scan_id, user)
    return Response(content=scan.image, media_type=scan.media_type, headers={"Cache-Control": "private, max-age=86400"})

