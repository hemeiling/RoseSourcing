"""Personal tokens for the Claude connector (MCP)."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import audit
from ..config import get_settings
from ..mcp_server import TOKEN_PREFIX, hash_token
from ..models import ApiToken
from .deps import DB, CurrentUser

router = APIRouter(prefix="/api/tokens", tags=["claude connector"])


class TokenIn(BaseModel):
    name: str = Field("Claude", min_length=1, max_length=100)


def _base(request: Request) -> str:
    s = get_settings()
    return (s.public_base_url or s.render_external_url or str(request.base_url)).rstrip("/")


@router.get("")
def list_tokens(request: Request, db: DB, user: CurrentUser) -> dict:
    rows = db.scalars(select(ApiToken).where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None)).order_by(ApiToken.created_at.desc())).all()
    return {"mcp_url": f"{_base(request)}/mcp",
            "tokens": [{"id": str(t.id), "name": t.name, "last4": t.last4, "created_at": t.created_at, "last_used_at": t.last_used_at} for t in rows]}


@router.post("", status_code=201)
def create_token(body: TokenIn, request: Request, db: DB, user: CurrentUser) -> dict:
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = ApiToken(user_id=user.id, name=body.name, token_hash=hash_token(token), last4=token[-4:])
    db.add(row)
    db.flush()
    audit.record(db, "api_token.created", user_id=user.id, entity_type="api_token", entity_id=row.id, details={"name": body.name})
    db.commit()
    base = _base(request)
    # The raw token is returned exactly once.
    return {"id": str(row.id), "name": row.name, "token": token, "mcp_url": f"{base}/mcp", "connector_url": f"{base}/mcp?token={token}"}


@router.delete("/{token_id}", status_code=204)
def revoke_token(token_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    row = db.get(ApiToken, token_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Token not found")
    row.revoked_at = datetime.now(timezone.utc)
    audit.record(db, "api_token.revoked", user_id=user.id, entity_type="api_token", entity_id=row.id)
    db.commit()
