from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, File, HTTPException, UploadFile
from sqlalchemy import select

from .. import audit
from ..models import AnalysisSnapshot, Competitor, CompetitorProduct, PriceObservation
from ..schemas import (
    CompetitorIn,
    CompetitorOut,
    CompetitorPatch,
    CompetitorProductIn,
    CompetitorProductOut,
    PriceObservationIn,
    PriceObservationOut,
)
from ..services import csv_import
from ..services.price_tiers import apply_to_competitors
from ..services.agents.generators import analyze_positioning
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["competitors"])


def _new_price(body: PriceObservationIn) -> PriceObservation:
    return PriceObservation(
        price=Decimal(str(body.price)), currency=body.currency.upper()[:8],
        observed_at=body.observed_at or datetime.now(timezone.utc), source_url=body.source_url,
        source_type="manual", verification_status="human_verified" if body.source_url else "unverified", note=body.note,
    )


@router.get("/projects/{project_id}/competitors", response_model=list[CompetitorOut])
def list_competitors(project: ProjectDep, db: DB, watchlist: bool = False) -> list[Competitor]:
    stmt = select(Competitor).where(Competitor.project_id == project.id)
    if watchlist:
        stmt = stmt.where(Competitor.on_watchlist.is_(True))
    return list(db.scalars(stmt.order_by(Competitor.on_watchlist.desc(), Competitor.name)))


@router.post("/projects/{project_id}/competitors", response_model=CompetitorOut, status_code=201)
def create_competitor(body: CompetitorIn, project: ProjectDep, db: DB, user: CurrentUser) -> Competitor:
    if db.scalars(select(Competitor).where(Competitor.project_id == project.id, Competitor.name.ilike(body.name.strip()))).first():
        raise HTTPException(409, "A competitor with this name already exists in this project.")
    c = Competitor(project_id=project.id, discovered_by="manual", **body.model_dump())
    db.add(c)
    db.flush()
    audit.record(db, "competitor.created", user_id=user.id, project_id=project.id, entity_type="competitor", entity_id=c.id)
    db.commit()
    return c


@router.patch("/competitors/{competitor_id}", response_model=CompetitorOut)
def update_competitor(competitor_id: uuid.UUID, body: CompetitorPatch, db: DB, user: CurrentUser) -> Competitor:
    c = owned(db, Competitor, competitor_id, user)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(c, k, v)
    audit.record(db, "competitor.updated", user_id=user.id, project_id=c.project_id, entity_type="competitor",
                 entity_id=c.id, details={"fields": sorted(data)})
    db.commit()
    return c


@router.delete("/competitors/{competitor_id}", status_code=204)
def delete_competitor(competitor_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    c = owned(db, Competitor, competitor_id, user)
    audit.record(db, "competitor.deleted", user_id=user.id, project_id=c.project_id, entity_type="competitor",
                 entity_id=c.id, details={"name": c.name})
    db.delete(c)
    db.commit()


@router.post("/competitors/{competitor_id}/products", response_model=CompetitorProductOut, status_code=201)
def add_product(competitor_id: uuid.UUID, body: CompetitorProductIn, db: DB, user: CurrentUser) -> CompetitorProduct:
    c = owned(db, Competitor, competitor_id, user)
    p = CompetitorProduct(competitor_id=c.id, **body.model_dump(exclude={"initial_price"}))
    if body.initial_price:
        p.price_observations.append(_new_price(body.initial_price))
    db.add(p)
    db.commit()
    return p


@router.delete("/competitor-products/{product_id}", status_code=204)
def delete_product(product_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    p = owned(db, CompetitorProduct, product_id, user)
    db.delete(p)
    db.commit()


@router.post("/competitor-products/{product_id}/prices", response_model=PriceObservationOut, status_code=201)
def add_price(product_id: uuid.UUID, body: PriceObservationIn, db: DB, user: CurrentUser) -> PriceObservation:
    p = owned(db, CompetitorProduct, product_id, user)
    obs = _new_price(body)
    p.price_observations.append(obs)
    audit.record(db, "price_observation.created", user_id=user.id, project_id=p.competitor.project_id,
                 entity_type="price_observation", details={"product": p.name, "price": body.price})
    db.commit()
    return obs


@router.delete("/price-observations/{obs_id}", status_code=204)
def delete_price(obs_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    obs = owned(db, PriceObservation, obs_id, user)
    db.delete(obs)
    db.commit()


@router.get("/projects/{project_id}/competitors/price-comparison")
def price_comparison(project: ProjectDep, db: DB) -> dict:
    rows = []
    for c in db.scalars(select(Competitor).where(Competitor.project_id == project.id)):
        for p in c.products:
            if not p.price_observations:
                continue
            latest = max(p.price_observations, key=lambda o: o.observed_at)
            rows.append({
                "competitor": c.name, "competitor_id": str(c.id), "product": p.name, "price": float(latest.price),
                "currency": latest.currency, "observed_at": latest.observed_at, "source_url": latest.source_url,
                "source_type": latest.source_type, "verification_status": latest.verification_status,
                "observations": len(p.price_observations), "on_watchlist": c.on_watchlist,
            })
    usd = [r["price"] for r in rows if r["currency"] == "USD"]
    stats = None
    if usd:
        s = sorted(usd)
        stats = {"count": len(s), "min": s[0], "max": s[-1], "median": s[len(s) // 2] if len(s) % 2 else (s[len(s) // 2 - 1] + s[len(s) // 2]) / 2}
    hyp = None
    if project.price_min is not None and project.price_max is not None:
        hyp = {"min": float(project.price_min), "max": float(project.price_max)}
    return {"rows": sorted(rows, key=lambda r: r["price"]), "usd_stats": stats, "price_hypothesis": hyp}


@router.post("/projects/{project_id}/competitors/assign-tiers")
def assign_tiers(project: ProjectDep, db: DB, user: CurrentUser, overwrite: bool = False) -> dict:
    """Place competitors in the price tiers found by price-tier research, using their prices or matching listings."""
    result = apply_to_competitors(db, project.id, overwrite=overwrite)
    audit.record(db, "competitors.tiers_assigned", user_id=user.id, project_id=project.id, details=result)
    db.commit()
    return result


@router.post("/projects/{project_id}/competitors/positioning")
def run_positioning(project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    if not db.scalars(select(Competitor.id).where(Competitor.project_id == project.id)).first():
        raise HTTPException(400, "Add or discover competitors first.")
    out, ex = analyze_positioning(db, project, user)
    snap = AnalysisSnapshot(project_id=project.id, kind="competitor_positioning", content=out.model_dump(), agent_execution_id=ex.id)
    db.add(snap)
    audit.record(db, "positioning_analysis.created", user_id=user.id, project_id=project.id, actor="agent:competitor_intelligence",
                 entity_type="analysis_snapshot", entity_id=snap.id)
    db.commit()
    return {"id": str(snap.id), "created_at": snap.created_at, "content": snap.content}


@router.get("/projects/{project_id}/competitors/positioning")
def latest_positioning(project: ProjectDep, db: DB) -> dict | None:
    snap = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project.id,
                                                     AnalysisSnapshot.kind == "competitor_positioning")
                      .order_by(AnalysisSnapshot.created_at.desc())).first()
    return {"id": str(snap.id), "created_at": snap.created_at, "content": snap.content} if snap else None


@router.post("/projects/{project_id}/competitors/import")
async def import_competitors(project: ProjectDep, db: DB, user: CurrentUser, file: UploadFile = File(...)) -> dict:
    try:
        rows = csv_import.read_rows(await file.read())
    except csv_import.CsvError as e:
        raise HTTPException(400, str(e))
    created = {"competitors": 0, "products": 0, "prices": 0}
    errors = []
    cache: dict[str, Competitor] = {}
    for n, row in enumerate(rows, start=2):
        try:
            name = row.get("competitor", "")
            if not name:
                raise csv_import.CsvError("competitor is required")
            key = name.lower()
            comp = cache.get(key) or db.scalars(select(Competitor).where(Competitor.project_id == project.id,
                                                                          Competitor.name.ilike(name))).first()
            if comp is None:
                tier = row.get("price_tier") or None
                comp = Competitor(project_id=project.id, name=name[:200], website=row.get("website") or None,
                                  price_tier=tier if tier in ("budget", "mid", "premium", "luxury") else None,
                                  channels=csv_import.split_list(row.get("channels", "")), notes=row.get("notes") or None,
                                  discovered_by="csv")
                db.add(comp)
                db.flush()
                created["competitors"] += 1
            cache[key] = comp
            product_name = row.get("product", "")
            if product_name:
                prod = next((p for p in comp.products if p.name.lower() == product_name.lower()), None)
                if prod is None:
                    prod = CompetitorProduct(competitor_id=comp.id, name=product_name[:300], url=row.get("product_url") or None)
                    comp.products.append(prod)
                    db.flush()
                    created["products"] += 1
                price = csv_import.opt_float(row.get("price", ""), "price")
                if price is not None:
                    prod.price_observations.append(PriceObservation(
                        price=Decimal(str(price)), currency=(row.get("currency") or "USD").upper()[:8],
                        observed_at=csv_import.opt_datetime(row.get("observed_at", ""), "observed_at") or datetime.now(timezone.utc),
                        source_url=row.get("product_url") or None, source_type="csv",
                        verification_status="unverified", note="Imported from CSV",
                    ))
                    created["prices"] += 1
        except csv_import.CsvError as e:
            errors.append({"row": n, "error": str(e)})
    audit.record(db, "competitors.imported", user_id=user.id, project_id=project.id, details={**created, "errors": len(errors)})
    db.commit()
    return csv_import.summarize(created, errors)
