"""Supplier outreach: spec sheet, requests for quotation at several quantities, logged quotes and sample orders.

136Sourcing drafts and tracks; the founder sends each message and places each sample order on the supplier's platform.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from .. import audit
from ..models import SampleOrder, Supplier, SupplierCommunication, SupplierQuote
from ..services.agents.outreach import RFQ_SUBJECT, SPEC_LISTS, _latest, generate_spec_sheet, rfq_message, spec_text
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["outreach"])


class SpecGenerateIn(BaseModel):
    notes: str | None = Field(None, max_length=2000)


class SpecSheetIn(BaseModel):
    product_name: str = Field(min_length=1, max_length=300)
    summary: str = ""
    materials: list[str] = []
    dimensions: list[str] = []
    colours_patterns: list[str] = []
    construction: list[str] = []
    quality_requirements: list[str] = []
    packaging_labeling: list[str] = []
    documents_requested: list[str] = []
    questions: list[str] = []
    quantities: list[int] = Field(default_factory=lambda: [100, 300, 500], min_length=1, max_length=6)
    incoterm: str = "FOB"
    destination: str | None = None
    sample_request: str = "1 sample in each of 2 colourways"
    target_unit_cost: float | None = Field(None, ge=0)


class RfqBatchIn(BaseModel):
    supplier_ids: list[uuid.UUID] = Field(min_length=1, max_length=30)


class TierPrice(BaseModel):
    quantity: int = Field(gt=0)
    unit_price: float = Field(ge=0)


class RfqQuoteIn(BaseModel):
    prices: list[TierPrice] = Field(min_length=1, max_length=6)
    currency: str = "USD"
    sample_cost: float | None = Field(None, ge=0)
    lead_time_days: int | None = Field(None, ge=0)
    incoterm: str | None = None
    notes: str | None = None


class SampleIn(BaseModel):
    supplier_id: uuid.UUID
    quantity: int = Field(1, ge=1)
    variant: str | None = None
    unit_cost: float | None = Field(None, ge=0)
    shipping_cost: float | None = Field(None, ge=0)
    currency: str = "USD"
    status: Literal["requested", "ordered", "shipped", "received", "approved", "rejected"] = "requested"
    ordered_on: date | None = None
    received_on: date | None = None
    tracking: str | None = None
    scores: dict[str, int] = {}
    notes: str | None = None


def _money(v: Decimal | None) -> float | None:
    return float(v) if v is not None else None


def _sample_out(s: SampleOrder) -> dict[str, Any]:
    return {"id": str(s.id), "supplier_id": str(s.supplier_id), "supplier_name": s.supplier.name, "quantity": s.quantity,
            "variant": s.variant, "unit_cost": _money(s.unit_cost), "shipping_cost": _money(s.shipping_cost), "currency": s.currency,
            "status": s.status, "ordered_on": s.ordered_on, "received_on": s.received_on, "tracking": s.tracking,
            "scores": s.scores or {}, "notes": s.notes, "created_at": s.created_at}


def _is_rfq(c: SupplierCommunication) -> bool:
    return (c.subject or "").startswith(RFQ_SUBJECT)


@router.get("/projects/{project_id}/outreach")
def outreach(project: ProjectDep, db: DB) -> dict:
    """Spec sheet, and for each supplier: its RFQ (drafted / sent / quoted), quotes by quantity and sample orders."""
    spec = _latest(db, project.id, "spec_sheet")
    samples = db.scalars(select(SampleOrder).where(SampleOrder.project_id == project.id).order_by(SampleOrder.created_at)).all()
    rows = []
    for s in db.scalars(select(Supplier).where(Supplier.project_id == project.id).order_by(Supplier.created_at)).all():
        rfqs = [c for c in s.communications if _is_rfq(c)]
        sent = next((c for c in rfqs if c.direction == "outbound"), None)
        draft = next((c for c in rfqs if c.direction == "draft"), None)
        rfq_quotes = [q for q in s.quotes if q.source == "rfq"]
        listing = next((q.source_url for q in s.quotes if q.source_url), None)
        rows.append({
            "id": str(s.id), "name": s.name, "platform": s.platform, "country": s.country, "website": s.website,
            "contact_email": s.contact_email, "listing_url": listing, "verification_status": s.verification_status,
            "status": "quoted" if rfq_quotes else "sent" if sent else "drafted" if draft else "not_contacted",
            "draft": {"id": str(draft.id), "subject": draft.subject, "body": draft.summary} if draft else None,
            "sent_at": sent.occurred_at if sent else None,
            "quotes": sorted([{"id": str(q.id), "quantity": q.moq, "unit_price": _money(q.unit_price), "currency": q.currency,
                               "sample_cost": _money(q.sample_cost), "lead_time_days": q.lead_time_days, "source": q.source}
                              for q in s.quotes if q.unit_price is not None], key=lambda q: (q["source"] != "rfq", q["quantity"] or 0)),
        })
    return {"spec": {"id": str(spec.id), "content": spec.content, "text": spec_text(spec.content), "created_at": spec.created_at} if spec else None,
            "suppliers": rows, "samples": [_sample_out(x) for x in samples]}


@router.post("/projects/{project_id}/spec-sheet", status_code=201)
def create_spec_sheet(body: SpecGenerateIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    """Draft the spec sheet from the product's research (complaint themes, compliance, price tiers)."""
    snap = generate_spec_sheet(db, project, user, body.notes)
    db.flush()
    audit.record(db, "spec_sheet.generated", user_id=user.id, project_id=project.id, actor="agent:supplier_outreach",
                 entity_type="analysis_snapshot", entity_id=snap.id)
    db.commit()
    return {"id": str(snap.id), "content": snap.content}


@router.put("/projects/{project_id}/spec-sheet")
def save_spec_sheet(body: SpecSheetIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    snap = _latest(db, project.id, "spec_sheet")
    if snap is None:
        raise HTTPException(404, "No spec sheet yet - draft one first.")
    data = body.model_dump()
    for key in SPEC_LISTS:
        data[key] = [x.strip() for x in data[key] if x.strip()]
    snap.content = {**snap.content, **data, "edited_at": datetime.now(timezone.utc).isoformat()}
    flag_modified(snap, "content")
    db.commit()
    return {"id": str(snap.id), "content": snap.content}


@router.post("/projects/{project_id}/rfq", status_code=201)
def draft_rfqs(body: RfqBatchIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    """One RFQ draft per chosen supplier, rendered from the saved spec sheet. Unsent RFQ drafts are replaced."""
    spec = _latest(db, project.id, "spec_sheet")
    if spec is None:
        raise HTTPException(400, "Draft and review the spec sheet first - the RFQ sends it to each supplier.")
    drafted = 0
    for sid in dict.fromkeys(body.supplier_ids):
        s = owned(db, Supplier, sid, user)
        if s.project_id != project.id:
            raise HTTPException(404, "Supplier not found")
        for old in [c for c in s.communications if _is_rfq(c) and c.direction == "draft"]:
            db.delete(old)
        subject, text = rfq_message(spec.content, s, project)
        db.add(SupplierCommunication(supplier_id=s.id, channel="email" if s.contact_email else (s.platform or "other"), direction="draft",
                                     subject=subject, summary=text, next_action="Send this yourself, then mark it as sent."))
        drafted += 1
    audit.record(db, "rfq.drafted", user_id=user.id, project_id=project.id, actor="agent:supplier_outreach",
                 entity_type="analysis_snapshot", entity_id=spec.id, details={"suppliers": drafted})
    db.commit()
    return {"drafted": drafted}


@router.post("/supplier-communications/{comm_id}/sent")
def mark_sent(comm_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    """The founder sent this draft: record it as an outbound message now."""
    c = owned(db, SupplierCommunication, comm_id, user)
    c.direction = "outbound"
    c.occurred_at = datetime.now(timezone.utc)
    c.next_action = "Wait for the quote, then log the prices."
    db.commit()
    return {"id": str(c.id), "direction": c.direction, "occurred_at": c.occurred_at}


@router.post("/suppliers/{supplier_id}/rfq-quotes", status_code=201)
def log_rfq_quote(supplier_id: uuid.UUID, body: RfqQuoteIn, db: DB, user: CurrentUser) -> dict:
    """A supplier's reply: one quote per quantity, so the comparison and landed cost see each price break."""
    s = owned(db, Supplier, supplier_id, user)
    spec = _latest(db, s.project_id, "spec_sheet")
    name = (spec.content.get("product_name") if spec else None) or "Quoted product"
    for tp in sorted(body.prices, key=lambda t: t.quantity):
        db.add(SupplierQuote(supplier_id=s.id, product_name=name[:300], moq=tp.quantity, unit_price=Decimal(str(tp.unit_price)),
                             currency=body.currency.upper()[:8], sample_cost=Decimal(str(body.sample_cost)) if body.sample_cost is not None else None,
                             lead_time_days=body.lead_time_days, incoterm=body.incoterm, quote_date=date.today(), source="rfq",
                             notes=(f"Reply to our RFQ, price at {tp.quantity} units. " + (body.notes or "")).strip()))
    audit.record(db, "rfq.quote_logged", user_id=user.id, project_id=s.project_id, entity_type="supplier", entity_id=s.id,
                 details={"quantities": [t.quantity for t in body.prices]})
    db.commit()
    return {"quotes": len(body.prices)}


@router.post("/projects/{project_id}/samples", status_code=201)
def add_sample(body: SampleIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    s = owned(db, Supplier, body.supplier_id, user)
    if s.project_id != project.id:
        raise HTTPException(404, "Supplier not found")
    so = SampleOrder(project_id=project.id, **body.model_dump())
    db.add(so)
    db.flush()
    audit.record(db, "sample_order.created", user_id=user.id, project_id=project.id, entity_type="sample_order", entity_id=so.id)
    db.commit()
    db.refresh(so)
    return _sample_out(so)


@router.patch("/samples/{sample_id}")
def update_sample(sample_id: uuid.UUID, body: SampleIn, db: DB, user: CurrentUser) -> dict:
    so = owned(db, SampleOrder, sample_id, user)
    owned(db, Supplier, body.supplier_id, user)
    for k, v in body.model_dump().items():
        setattr(so, k, v)
    db.commit()
    db.refresh(so)
    return _sample_out(so)


@router.delete("/samples/{sample_id}", status_code=204)
def delete_sample(sample_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    db.delete(owned(db, SampleOrder, sample_id, user))
    db.commit()
