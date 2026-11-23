"""Keep research runs from saving the same thing twice: a channel under a second name, or a recommendation that repeats
an open one. Matching is deliberately conservative - a near-miss is shown twice rather than two different things merged."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Recommendation, SalesChannel

_STOP = {"a", "an", "the", "and", "or", "to", "for", "of", "with", "via", "in", "on", "your", "you", "at", "by", "its", "it", "from",
         "as", "be", "is", "are", "then", "after", "if", "only", "this", "that", "these", "their", "them", "us", "plus"}
# Words every channel name could share; matching on them alone would merge unrelated channels.
_GENERIC_CHANNEL = {"store", "shop", "shopping", "marketplace", "online", "own", "direct", "website", "site", "sales", "selling",
                    "retail", "channel", "us", "usa", "ads"}


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in words if w not in _STOP and len(w) > 1}


def similar_text(a: str, b: str) -> bool:
    """Two short texts say the same thing: most of their words are shared."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    shared = len(ta & tb)
    return shared / len(ta | tb) >= 0.6 or (shared >= 4 and shared / min(len(ta), len(tb)) >= 0.8)


def same_channel(a: str, b: str) -> bool:
    """'Instagram' and 'Instagram Shopping', or 'Wholesale via Faire' and 'Faire wholesale to boutiques': the same channel
    when they share a distinctive word (not 'store', 'marketplace' ...). Callers also require the same channel type."""
    return bool((_tokens(a) & _tokens(b)) - _GENERIC_CHANNEL)


def find_channel(db: Session, project_id: uuid.UUID, name: str, channel_type: str) -> SalesChannel | None:
    rows = db.scalars(select(SalesChannel).where(SalesChannel.project_id == project_id)).all()
    exact = next((c for c in rows if c.name.strip().lower() == name.strip().lower()), None)
    return exact or next((c for c in rows if c.channel_type == channel_type and same_channel(c.name, name)), None)


def add_recommendation(db: Session, *, project_id: uuid.UUID, title: str, body: str | None, priority: str = "medium",
                       research_run_id: uuid.UUID | None = None, source: str = "research") -> Recommendation:
    """Add a recommendation unless an open one already says the same; then keep that one (raising its priority if needed)."""
    order = {"low": 0, "medium": 1, "high": 2}
    for r in db.scalars(select(Recommendation).where(Recommendation.project_id == project_id,
                                                     Recommendation.status.in_(["open", "accepted"]))).all():
        if similar_text(r.title, title):
            if order.get(priority, 1) > order.get(r.priority, 1):
                r.priority = priority
            return r
    rec = Recommendation(project_id=project_id, source=source, title=title[:300], body=body, priority=priority, research_run_id=research_run_id)
    db.add(rec)
    db.flush()
    return rec
