from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from .. import audit
from ..enums import SUPPLIER_VERIFICATION_LABELS
from ..models import BusinessProject, ProductConcept, Supplier, SupplierCommunication, SupplierQuote
from ..schemas import (
    CommunicationIn,
    CommunicationOut,
    QuoteIn,
    QuoteOut,
    RfqIn,
    SupplierIn,
    SupplierOut,
    SupplierPatch,
)
from ..services import csv_import
from ..services.agents.generators import draft_rfq
from ..services.agents.sourcing import supplier_comparison
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["suppliers"])

MONEY_FIELDS = ("unit_price", "sample_cost", "est_freight_per_unit")


def _quote_kwargs(body: QuoteIn) -> dict:
    data = body.model_dump()
    for f in MONEY_FIELDS:
        if data.get(f) is not None:
            data[f] = Decimal(str(data[f]))
    data["currency"] = (data.get("currency") or "USD").upper()[:8]
    return data


@router.get("/suppliers/verification-levels")
def verification_levels() -> dict:
    return SUPPLIER_VERIFICATION_LABELS


@router.get("/csv-templates/{kind}", response_class=PlainTextResponse)
def csv_template(kind: str) -> PlainTextResponse:
    if kind not in csv_import.TEMPLATES:
        raise HTTPException(404, "Unknown template")
    return PlainTextResponse(csv_import.template_csv(kind), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{kind}-template.csv"'})


@router.get("/projects/{project_id}/suppliers", response_model=list[SupplierOut])
def list_suppliers(project: ProjectDep, db: DB) -> list[Supplier]:
    return list(db.scalars(select(Supplier).where(Supplier.project_id == project.id).order_by(Supplier.name)))


@router.post("/projects/{project_id}/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(body: SupplierIn, project: ProjectDep, db: DB, user: CurrentUser) -> Supplier:
    s = Supplier(project_id=project.id, source="manual", **body.model_dump())
    db.add(s)
    db.flush()
    audit.record(db, "supplier.created", user_id=user.id, project_id=project.id, entity_type="supplier", entity_id=s.id)
    db.commit()
    return s


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def get_supplier(supplier_id: uuid.UUID, db: DB, user: CurrentUser) -> Supplier:
    return owned(db, Supplier, supplier_id, user)


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: uuid.UUID, body: SupplierPatch, db: DB, user: CurrentUser) -> Supplier:
    s = owned(db, Supplier, supplier_id, user)
    data = body.model_dump(exclude_unset=True)
    before = s.verification_status
    for k, v in data.items():
        setattr(s, k, v)
    details = {"fields": sorted(data)}
    if "verification_status" in data and data["verification_status"] != before:
        details["verification"] = {"from": before, "to": s.verification_status}
    audit.record(db, "supplier.updated", user_id=user.id, project_id=s.project_id, entity_type="supplier", entity_id=s.id, details=details)
    db.commit()
    return s


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    s = owned(db, Supplier, supplier_id, user)
    audit.record(db, "supplier.deleted", user_id=user.id, project_id=s.project_id, entity_type="supplier", entity_id=s.id, details={"name": s.name})
    db.delete(s)
    db.commit()


@router.post("/suppliers/{supplier_id}/quotes", response_model=QuoteOut, status_code=201)
def add_quote(supplier_id: uuid.UUID, body: QuoteIn, db: DB, user: CurrentUser) -> SupplierQuote:
    s = owned(db, Supplier, supplier_id, user)
    q = SupplierQuote(supplier_id=s.id, source="manual", **_quote_kwargs(body))
    db.add(q)
    db.flush()
    audit.record(db, "supplier_quote.created", user_id=user.id, project_id=s.project_id, entity_type="supplier_quote", entity_id=q.id)
    db.commit()
    return q


@router.patch("/supplier-quotes/{quote_id}", response_model=QuoteOut)
def update_quote(quote_id: uuid.UUID, body: QuoteIn, db: DB, user: CurrentUser) -> SupplierQuote:
    q = owned(db, SupplierQuote, quote_id, user)
    for k, v in _quote_kwargs(body).items():
        setattr(q, k, v)
    db.commit()
    return q


@router.delete("/supplier-quotes/{quote_id}", status_code=204)
def delete_quote(quote_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    q = owned(db, SupplierQuote, quote_id, user)
    db.delete(q)
    db.commit()


@router.post("/suppliers/{supplier_id}/communications", response_model=CommunicationOut, status_code=201)
def add_communication(supplier_id: uuid.UUID, body: CommunicationIn, db: DB, user: CurrentUser) -> SupplierCommunication:
    s = owned(db, Supplier, supplier_id, user)
    data = body.model_dump()
    data["occurred_at"] = data["occurred_at"] or datetime.now(timezone.utc)
    c = SupplierCommunication(supplier_id=s.id, **data)
    db.add(c)
    db.commit()
    return c


@router.delete("/supplier-communications/{comm_id}", status_code=204)
def delete_communication(comm_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    c = owned(db, SupplierCommunication, comm_id, user)
    db.delete(c)
    db.commit()


@router.post("/suppliers/{supplier_id}/rfq-draft", response_model=CommunicationOut, status_code=201)
def rfq_draft(supplier_id: uuid.UUID, body: RfqIn, db: DB, user: CurrentUser) -> SupplierCommunication:
    s = owned(db, Supplier, supplier_id, user)
    product = owned(db, ProductConcept, body.product_concept_id, user) if body.product_concept_id else None
    project = db.get(BusinessProject, s.project_id)
    draft, ex = draft_rfq(db, project, user, s, product, body.notes)
    questions = "\n".join(f"- {q}" for q in draft.questions_to_ask)
    c = SupplierCommunication(
        supplier_id=s.id, channel="email", direction="draft", subject=draft.subject,
        summary=f"{draft.body}\n\nQuestions checklist:\n{questions}",
        next_action="Review and send this draft yourself. AI Commerce OS does not send messages.",
    )
    db.add(c)
    audit.record(db, "rfq_draft.created", user_id=user.id, project_id=s.project_id, actor="agent:sourcing",
                 entity_type="supplier", entity_id=s.id, details={"agent_execution_id": str(ex.id)})
    db.commit()
    return c


@router.get("/projects/{project_id}/suppliers/comparison")
def comparison(project: ProjectDep, db: DB) -> dict:
    return {"rows": supplier_comparison(db, project)}


@router.post("/projects/{project_id}/suppliers/import")
async def import_suppliers(project: ProjectDep, db: DB, user: CurrentUser, file: UploadFile = File(...)) -> dict:
    try:
        rows = csv_import.read_rows(await file.read())
    except csv_import.CsvError as e:
        raise HTTPException(400, str(e))
    created = {"suppliers": 0, "quotes": 0}
    errors = []
    cache: dict[str, Supplier] = {}
    for n, row in enumerate(rows, start=2):
        try:
            name = row.get("supplier", "")
            if not name:
                raise csv_import.CsvError("supplier is required")
            key = name.lower()
            sup = cache.get(key) or db.scalars(select(Supplier).where(Supplier.project_id == project.id, Supplier.name.ilike(name))).first()
            if sup is None:
                sup = Supplier(
                    project_id=project.id, name=name[:300], country=row.get("country") or None, city=row.get("city") or None,
                    platform=row.get("platform") or None, website=row.get("website") or None,
                    contact_name=row.get("contact_name") or None, contact_email=row.get("contact_email") or None,
                    capabilities=csv_import.split_list(row.get("capabilities", "")),
                    certifications_claimed=csv_import.split_list(row.get("certifications_claimed", "")),
                    verification_status="unverified", source="csv",
                )
                db.add(sup)
                db.flush()
                created["suppliers"] += 1
            cache[key] = sup
            if row.get("product"):
                unit = csv_import.opt_float(row.get("unit_price", ""), "unit_price")
                sample = csv_import.opt_float(row.get("sample_cost", ""), "sample_cost")
                freight = csv_import.opt_float(row.get("est_freight_per_unit", ""), "est_freight_per_unit")
                db.add(SupplierQuote(
                    supplier_id=sup.id, product_name=row["product"][:300], moq=csv_import.opt_int(row.get("moq", ""), "moq"),
                    unit_price=Decimal(str(unit)) if unit is not None else None, currency=(row.get("currency") or "USD").upper()[:8],
                    sample_cost=Decimal(str(sample)) if sample is not None else None,
                    lead_time_days=csv_import.opt_int(row.get("lead_time_days", ""), "lead_time_days"),
                    incoterm=(row.get("incoterm") or None), est_freight_per_unit=Decimal(str(freight)) if freight is not None else None,
                    quote_date=csv_import.opt_date(row.get("quote_date", ""), "quote_date"), notes=row.get("notes") or None, source="csv",
                ))
                created["quotes"] += 1
        except csv_import.CsvError as e:
            errors.append({"row": n, "error": str(e)})
    audit.record(db, "suppliers.imported", user_id=user.id, project_id=project.id, details={**created, "errors": len(errors)})
    db.commit()
    return csv_import.summarize(created, errors)
