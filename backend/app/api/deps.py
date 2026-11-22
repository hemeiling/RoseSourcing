from __future__ import annotations

import uuid
from typing import Annotated, TypeVar

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    BusinessProject,
    CompetitorProduct,
    PriceObservation,
    SupplierCommunication,
    SupplierQuote,
    User,
)
from ..security import get_current_user, get_project_for_user

M = TypeVar("M")

DB = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def project_dep(project_id: uuid.UUID, db: DB, user: CurrentUser) -> BusinessProject:
    return get_project_for_user(project_id, db, user)


ProjectDep = Annotated[BusinessProject, Depends(project_dep)]


def _project_id_of(obj: object) -> uuid.UUID | None:
    if hasattr(obj, "project_id"):
        return obj.project_id  # type: ignore[attr-defined]
    if isinstance(obj, CompetitorProduct):
        return obj.competitor.project_id
    if isinstance(obj, PriceObservation):
        return obj.product.competitor.project_id
    if isinstance(obj, (SupplierQuote, SupplierCommunication)):
        return obj.supplier.project_id
    return None


def owned(db: Session, model: type[M], obj_id: uuid.UUID, user: User) -> M:
    """Load an entity and verify it belongs to a project owned by the user (404 otherwise)."""
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} not found")
    pid = _project_id_of(obj)
    project = db.get(BusinessProject, pid) if pid else None
    if project is None or project.owner_id != user.id:
        raise HTTPException(404, f"{model.__name__} not found")
    return obj
