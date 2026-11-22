from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditEvent


def record(
    db: Session,
    action: str,
    *,
    user_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    actor: str = "user",
    entity_type: str | None = None,
    entity_id: Any = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Append an audit event. Caller commits."""
    db.add(
        AuditEvent(
            user_id=user_id,
            project_id=project_id,
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            details=details or {},
        )
    )
