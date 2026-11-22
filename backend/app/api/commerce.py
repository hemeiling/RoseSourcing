from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from .. import audit
from ..models import ApprovalRequest, BusinessProject, ProductConcept
from ..schemas import ApprovalDecisionIn, ApprovalIn, ApprovalOut, ProductIn, ProductOut, ProductPatch
from ..services.agents.generators import generate_listing
from ..services.integrations import integration_statuses
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["commerce"])


@router.get("/integrations")
def integrations(user: CurrentUser) -> list[dict]:
    return [s.__dict__ for s in integration_statuses()]


@router.get("/projects/{project_id}/products", response_model=list[ProductOut])
def list_products(project: ProjectDep, db: DB) -> list[ProductConcept]:
    return list(db.scalars(select(ProductConcept).where(ProductConcept.project_id == project.id).order_by(ProductConcept.created_at.desc())))


@router.post("/projects/{project_id}/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductIn, project: ProjectDep, db: DB, user: CurrentUser) -> ProductConcept:
    data = body.model_dump()
    if data.get("target_price") is not None:
        data["target_price"] = Decimal(str(data["target_price"]))
    p = ProductConcept(project_id=project.id, **data)
    db.add(p)
    db.flush()
    audit.record(db, "product.created", user_id=user.id, project_id=project.id, entity_type="product", entity_id=p.id)
    db.commit()
    return p


@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: uuid.UUID, body: ProductPatch, db: DB, user: CurrentUser) -> ProductConcept:
    p = owned(db, ProductConcept, product_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("target_price") is not None:
        data["target_price"] = Decimal(str(data["target_price"]))
    for k, v in data.items():
        setattr(p, k, v)
    audit.record(db, "product.updated", user_id=user.id, project_id=p.project_id, entity_type="product", entity_id=p.id,
                 details={"fields": sorted(data)})
    db.commit()
    return p


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    p = owned(db, ProductConcept, product_id, user)
    db.delete(p)
    db.commit()


@router.post("/products/{product_id}/listing", response_model=ProductOut)
def listing(product_id: uuid.UUID, db: DB, user: CurrentUser) -> ProductConcept:
    p = owned(db, ProductConcept, product_id, user)
    project = db.get(BusinessProject, p.project_id)
    draft, ex = generate_listing(db, project, user, p)
    p.listing_draft = {**draft.model_dump(), "generated_at": datetime.now(timezone.utc).isoformat(), "agent_execution_id": str(ex.id)}
    audit.record(db, "listing_draft.generated", user_id=user.id, project_id=p.project_id, actor="agent:commerce",
                 entity_type="product", entity_id=p.id)
    db.commit()
    return p


# ----------------------------------------------------------------------------- approval checkpoints


@router.get("/projects/{project_id}/approvals", response_model=list[ApprovalOut])
def list_approvals(project: ProjectDep, db: DB) -> list[ApprovalRequest]:
    return list(db.scalars(select(ApprovalRequest).where(ApprovalRequest.project_id == project.id).order_by(ApprovalRequest.created_at.desc())))


@router.post("/projects/{project_id}/approvals", response_model=ApprovalOut, status_code=201)
def request_approval(body: ApprovalIn, project: ProjectDep, db: DB, user: CurrentUser) -> ApprovalRequest:
    a = ApprovalRequest(project_id=project.id, action_type=body.action_type, title=body.title, payload=body.payload, requested_by="user")
    db.add(a)
    db.flush()
    audit.record(db, "approval.requested", user_id=user.id, project_id=project.id, entity_type="approval_request", entity_id=a.id,
                 details={"action_type": body.action_type})
    db.commit()
    return a


@router.post("/approvals/{approval_id}/decision", response_model=ApprovalOut)
def decide(approval_id: uuid.UUID, body: ApprovalDecisionIn, db: DB, user: CurrentUser) -> ApprovalRequest:
    a = owned(db, ApprovalRequest, approval_id, user)
    if a.status != "pending":
        raise HTTPException(409, f"Request is already {a.status}.")
    a.decided_by_id, a.decided_at = user.id, datetime.now(timezone.utc)
    if body.decision == "reject":
        a.status = "rejected"
    else:
        a.status = "approved"
        # No external adapter is connected in this release: record truthfully that nothing was executed.
        a.execution_result = {"executed": False, "reason": "No integration for this action is connected yet (planned). Nothing was sent or purchased."}
    audit.record(db, f"approval.{a.status}", user_id=user.id, project_id=a.project_id, entity_type="approval_request", entity_id=a.id)
    db.commit()
    return a
