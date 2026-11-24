"""Run every research agent a product is missing, one after another, without paying twice.

- An agent whose latest run completed is skipped.
- An agent whose latest run was interrupted, failed or cancelled is resumed: its finished steps are kept and only the
  unfinished ones run again.
- Only agents never run start a new run.
The chain runs on the server, in order (later agents use earlier results: reviews read the tracked listings, compliance
drafts questions for the suppliers found). It stops if the AI key is rejected.
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ...db import session_scope
from ...models import ResearchRun, Supplier
from ..llm.anthropic_provider import get_llm
from ..research.providers import get_research_provider
from .opportunity import _safe_execute, initial_steps

log = logging.getLogger(__name__)

# Each agent reads what the earlier ones saved: the listings feed the reviews, and Market research runs last so its
# report (and margin estimate) can use the competitors, supplier prices, freight and duties already found.
ORDER = ("price_tiers", "listing_tracker", "competitor_discovery", "fit_sizing", "supplier_listings",
         "review_mining", "buyer_style", "compliance", "channels_logistics", "market_opportunity")
# Typical cost of a full run (USD), from runs so far; a resumed run costs only its unfinished share.
ESTIMATE_USD = {"market_opportunity": 3.5, "price_tiers": 1.0, "listing_tracker": 0.1, "competitor_discovery": 2.5, "fit_sizing": 1.5,
                "supplier_listings": 1.6, "review_mining": 1.2, "buyer_style": 1.8, "compliance": 2.0, "channels_logistics": 4.6}
DONE = ("completed", "completed_with_errors")
ACTIVE = ("queued", "running")

_chains: dict[uuid.UUID, dict[str, Any]] = {}  # project id -> progress of a chain started in this process
_lock = threading.Lock()


def plan(db, project_id: uuid.UUID) -> list[dict[str, Any]]:
    steps = []
    for kind in ORDER:
        run = db.scalars(select(ResearchRun).where(ResearchRun.project_id == project_id, ResearchRun.kind == kind)
                         .order_by(ResearchRun.created_at.desc())).first()
        if run and run.status in DONE:
            steps.append({"kind": kind, "action": "done", "run_id": str(run.id), "estimate_usd": 0})
        elif run and run.status in ACTIVE:
            steps.append({"kind": kind, "action": "running", "run_id": str(run.id), "estimate_usd": 0})
        elif run:
            left = sum(1 for s in run.steps if s["status"] != "completed") / max(1, len(run.steps))
            steps.append({"kind": kind, "action": "resume", "run_id": str(run.id), "estimate_usd": round(ESTIMATE_USD[kind] * left, 2)})
        else:
            steps.append({"kind": kind, "action": "new", "run_id": None, "estimate_usd": ESTIMATE_USD[kind]})
    return steps


def progress(project_id: uuid.UUID) -> dict[str, Any] | None:
    with _lock:
        c = _chains.get(project_id)
        return dict(c) if c else None


def start(project_id: uuid.UUID, user_id: uuid.UUID, steps: list[dict[str, Any]]) -> None:
    todo = [s for s in steps if s["action"] in ("new", "resume")]
    with _lock:
        _chains[project_id] = {"total": len(todo), "finished": 0, "current": None, "done": False, "stopped": None,
                               "started_at": datetime.now(timezone.utc).isoformat()}
    threading.Thread(target=_run_chain, args=(project_id, user_id, todo), daemon=True, name=f"run-all-{project_id}").start()


def _prepare(project_id: uuid.UUID, user_id: uuid.UUID, step: dict[str, Any]) -> uuid.UUID | None:
    """Resume the existing run or create a new one; None if it got done or started meanwhile."""
    with session_scope() as db:
        if step["action"] == "resume":
            run = db.get(ResearchRun, uuid.UUID(step["run_id"]))
            if run is None or run.status in DONE or run.status in ACTIVE:
                return None
            run.steps = [dict(s, status="pending", error=None) if s["status"] != "completed" else s for s in run.steps]
            run.status, run.error, run.completed_at = "queued", None, None
            return run.id
        latest = db.scalars(select(ResearchRun).where(ResearchRun.project_id == project_id, ResearchRun.kind == step["kind"])
                            .order_by(ResearchRun.created_at.desc())).first()
        if latest and (latest.status in DONE or latest.status in ACTIVE):
            return None
        params: dict[str, Any] = {}
        if step["kind"] == "compliance":
            names = db.scalars(select(Supplier.name).where(Supplier.project_id == project_id)).all()
            params["suppliers"] = ", ".join(names)[:1000] or "none on file yet"
        provider = get_research_provider(None)
        run = ResearchRun(project_id=project_id, created_by_id=user_id, kind=step["kind"], status="queued", provider=provider.name,
                          model=get_llm().model, params=params, steps=initial_steps(step["kind"]))
        db.add(run)
        db.flush()
        return run.id


def _run_chain(project_id: uuid.UUID, user_id: uuid.UUID, todo: list[dict[str, Any]]) -> None:
    try:
        for step in todo:
            with _lock:
                _chains[project_id]["current"] = step["kind"]
            run_id = _prepare(project_id, user_id, step)
            if run_id is not None:
                _safe_execute(run_id)
                with session_scope() as db:
                    run = db.get(ResearchRun, run_id)
                    errors = " ".join([run.error or ""] + [s.get("error") or "" for s in run.steps])
                if "AI key" in errors or "rejected the API key" in errors or "ANTHROPIC_API_KEY" in errors:
                    with _lock:
                        _chains[project_id]["stopped"] = "The AI key was rejected, so the remaining agents were not started."
                    break
            with _lock:
                _chains[project_id]["finished"] += 1
    except Exception:  # noqa: BLE001
        log.exception("Run-all chain failed for %s", project_id)
        with _lock:
            _chains[project_id]["stopped"] = "Stopped by an unexpected error; click Run all again to continue."
    finally:
        with _lock:
            _chains[project_id].update(current=None, done=True)
