from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import audit
from ..services import connectors
from .deps import DB, CurrentUser

router = APIRouter(prefix="/api/connectors", tags=["connectors"])


class CredentialsIn(BaseModel):
    fields: dict[str, str]


def _require_owner(user) -> None:
    if user.role != "owner":
        raise HTTPException(403, "Only the workspace owner can manage connectors.")


def _connector(key: str) -> connectors.Connector:
    if key not in connectors.BY_KEY:
        raise HTTPException(404, "Unknown connector")
    return connectors.BY_KEY[key]


@router.get("")
def list_connectors(db: DB, user: CurrentUser) -> list[dict]:
    return connectors.status(db)


@router.put("/{key}")
def save_credentials(key: str, body: CredentialsIn, db: DB, user: CurrentUser) -> dict:
    _require_owner(user)
    conn = _connector(key)
    if not conn.fields:
        raise HTTPException(400, "This connector has no credentials to set.")
    connectors.save(db, key, body.fields, user.id)
    audit.record(db, "connector.credentials_saved", user_id=user.id, entity_type="connector", entity_id=key,
                 details={"fields": sorted(k for k, v in body.fields.items() if v)})
    db.commit()
    ok, msg = connectors.test(db, key) if conn.active else (None, None)
    db.commit()
    return {"saved": True, "test_ok": ok, "test_message": msg}


@router.delete("/{key}", status_code=204)
def remove_credentials(key: str, db: DB, user: CurrentUser) -> None:
    _require_owner(user)
    _connector(key)
    connectors.delete(db, key)
    audit.record(db, "connector.credentials_removed", user_id=user.id, entity_type="connector", entity_id=key)
    db.commit()


@router.post("/{key}/test")
def test_connector(key: str, db: DB, user: CurrentUser) -> dict:
    _require_owner(user)
    _connector(key)
    ok, msg = connectors.test(db, key)
    db.commit()
    return {"ok": ok, "message": msg}
