from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import Date, cast, func, or_, select, text

from ..config import get_settings
from ..models import AgentExecution, AuditEvent, BusinessProject
from ..schemas import AgentExecutionOut, AuditEventOut
from ..services.agents.runtime import AGENTS
from ..services.integrations import integration_statuses
from ..services.llm.anthropic_provider import get_llm
from ..services.research.providers import PROVIDERS
from .deps import DB, CurrentUser, ProjectDep

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health(db: DB) -> dict:
    db.execute(text("select 1"))
    return {"status": "ok"}


@router.get("/system/status")
def status(user: CurrentUser) -> dict:
    s = get_settings()
    llm = get_llm()
    return {
        "environment": s.environment,
        "ai": {"configured": llm.is_configured(), "provider": llm.name, "model": llm.model, "effort": llm.effort,
               "refusal_fallback": s.anthropic_fallbacks, "requirement": None if llm.is_configured() else "Set ANTHROPIC_API_KEY on the server."},
        "research": {"default_provider": s.research_provider,
                     "providers": [{"name": p.name, "label": p.label, "configured": p.is_configured(), "requirement": p.config_requirement()}
                                   for p in PROVIDERS.values()]},
        "guardrails": {"max_searches_per_step": s.max_searches_per_step, "max_page_reads_per_step": s.max_page_reads_per_step, "max_research_cost_usd": s.max_research_cost_usd,
                       "max_step_attempts": s.max_step_attempts, "copilot_max_tool_rounds": s.copilot_max_tool_rounds},
        "signup": {"enabled": s.signup_enabled, "invite_list_size": len(s.allowed_signup_email_set)},
        "integrations": [i.__dict__ for i in integration_statuses()],
        "agents": AGENTS,
    }


@router.get("/projects/{project_id}/agent-executions", response_model=list[AgentExecutionOut])
def executions(project: ProjectDep, db: DB, limit: int = Query(100, le=500)) -> list[AgentExecution]:
    return list(db.scalars(select(AgentExecution).where(AgentExecution.project_id == project.id)
                           .order_by(AgentExecution.started_at.desc()).limit(limit)))


@router.get("/projects/{project_id}/audit-events", response_model=list[AuditEventOut])
def audit_events(project: ProjectDep, db: DB, limit: int = Query(100, le=500)) -> list[AuditEvent]:
    return list(db.scalars(select(AuditEvent).where(AuditEvent.project_id == project.id)
                           .order_by(AuditEvent.created_at.desc()).limit(limit)))


@router.get("/projects/{project_id}/usage")
def usage(project: ProjectDep, db: DB) -> dict:
    rows = db.execute(
        select(AgentExecution.agent, func.count(AgentExecution.id), func.sum(AgentExecution.cost_usd),
               func.sum(AgentExecution.input_tokens), func.sum(AgentExecution.output_tokens), func.sum(AgentExecution.search_requests))
        .where(AgentExecution.project_id == project.id).group_by(AgentExecution.agent)
    ).all()
    by_agent = [{"agent": a, "label": AGENTS.get(a, a), "calls": n, "cost_usd": float(c or 0), "input_tokens": int(i or 0),
                 "output_tokens": int(o or 0), "search_requests": int(sr or 0)} for a, n, c, i, o, sr in rows]
    return {"by_agent": by_agent, "total_cost_usd": round(sum(r["cost_usd"] for r in by_agent), 4),
            "note": "Estimated from token usage and list prices; your Anthropic invoice is authoritative."}


@router.get("/usage")
def account_usage(user: CurrentUser, db: DB, period: Literal["30d", "all"] = "30d", project_id: uuid.UUID | None = None,
                  limit: int = Query(50, le=300)) -> dict:
    """AI spend across every product this account owns (or one product): totals, by product, by agent, by day, recent calls."""
    projects = {p.id: p for p in db.scalars(select(BusinessProject).where(BusinessProject.owner_id == user.id)).all()}
    scope = [AgentExecution.project_id.in_(list(projects)) if projects else AgentExecution.project_id.is_(None)]
    if project_id is not None:
        scope = [AgentExecution.project_id == project_id] if project_id in projects else [AgentExecution.project_id.is_(None), AgentExecution.id.is_(None)]
    else:
        scope = [or_(scope[0], (AgentExecution.project_id.is_(None)) & (AgentExecution.user_id == user.id))]
    since = datetime.now(timezone.utc) - timedelta(days=30)
    if period == "30d":
        scope.append(AgentExecution.started_at >= since)
    cols = (func.count(AgentExecution.id), func.coalesce(func.sum(AgentExecution.cost_usd), 0), func.coalesce(func.sum(AgentExecution.input_tokens), 0),
            func.coalesce(func.sum(AgentExecution.output_tokens), 0), func.coalesce(func.sum(AgentExecution.cache_read_tokens), 0),
            func.coalesce(func.sum(AgentExecution.search_requests), 0))
    n, cost, inp, out, cached, searches = db.execute(select(*cols).where(*scope)).one()

    def name(pid: uuid.UUID | None) -> str:
        p = projects.get(pid) if pid else None
        return (p.short_name or p.name) if p else "No product"

    by_product = [{"project_id": str(pid) if pid else None, "name": name(pid), "calls": c, "cost_usd": round(float(v), 4)}
                  for pid, c, v in db.execute(select(AgentExecution.project_id, func.count(AgentExecution.id), func.coalesce(func.sum(AgentExecution.cost_usd), 0))
                                              .where(*scope).group_by(AgentExecution.project_id)).all()]
    by_agent = [{"agent": a, "label": AGENTS.get(a, a), "calls": c, "cost_usd": round(float(v), 4), "input_tokens": int(i), "output_tokens": int(o),
                 "search_requests": int(sr)}
                for a, c, v, i, o, _, sr in db.execute(select(AgentExecution.agent, *cols).where(*scope).group_by(AgentExecution.agent)).all()]
    day = cast(AgentExecution.started_at, Date)
    by_day = [{"date": d.isoformat(), "cost_usd": round(float(v), 4), "calls": c}
              for d, c, v in db.execute(select(day, func.count(AgentExecution.id), func.coalesce(func.sum(AgentExecution.cost_usd), 0))
                                        .where(*scope).group_by(day).order_by(day)).all()]
    recent = db.scalars(select(AgentExecution).where(*scope).order_by(AgentExecution.started_at.desc()).limit(limit)).all()
    total_in = int(inp) + int(cached)
    return {
        "period": period,
        "totals": {"calls": n, "cost_usd": round(float(cost), 4), "input_tokens": int(inp), "output_tokens": int(out), "cached_tokens": int(cached),
                   "cached_share_pct": round(100 * int(cached) / total_in, 1) if total_in else None, "search_requests": int(searches)},
        "by_product": sorted(by_product, key=lambda r: -r["cost_usd"]),
        "by_agent": sorted(by_agent, key=lambda r: -r["cost_usd"]),
        "by_day": by_day,
        "recent": [{**AgentExecutionOut.model_validate(e).model_dump(mode="json"), "product": name(e.project_id),
                    "agent_label": AGENTS.get(e.agent, e.agent)} for e in recent],
        "products": [{"id": str(p.id), "name": p.short_name or p.name} for p in projects.values()],
        "note": "Estimated from token usage and list prices; your Anthropic invoice is authoritative. Web searches are billed by Anthropic; SerpApi searches are not included.",
    }
