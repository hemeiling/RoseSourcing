from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import func, select, text

from ..config import get_settings
from ..models import AgentExecution, AuditEvent
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
        "guardrails": {"max_searches_per_step": s.max_searches_per_step, "max_research_cost_usd": s.max_research_cost_usd,
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
