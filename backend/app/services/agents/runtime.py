"""Shared agent plumbing: execution records, cost tracking, bounded retries."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, TypeVar

from sqlalchemy.orm import Session

from ...config import get_settings
from ...models import AgentExecution
from ..llm.base import LLMNotConfigured, LLMRefusal, LLMTransientError, LLMUsage

log = logging.getLogger(__name__)
R = TypeVar("R")

AGENTS = {
    "opportunity_research": "Opportunity Research Agent",
    "competitor_intelligence": "Competitor Intelligence Agent",
    "brand_strategy": "Brand Strategy Agent",
    "sourcing": "Sourcing Agent",
    "commerce": "Commerce Agent",
    "analytics": "Analytics Agent",
    "fit": "Fit & Sizing Agent",
    "price_tier": "Price Tier Agent",
    "supplier_sourcing": "Supplier Sourcing Agent",
    "compliance": "Compliance & IP Agent",
    "supervisor": "Supervisor / Orchestration Agent",
    "copilot": "AI Business Copilot",
}


def start_execution(
    db: Session,
    *,
    agent: str,
    operation: str,
    project_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    model: str | None,
    provider: str | None = "anthropic",
    research_run_id: uuid.UUID | None = None,
    input_summary: str | None = None,
) -> AgentExecution:
    ex = AgentExecution(
        agent=agent,
        operation=operation,
        project_id=project_id,
        user_id=user_id,
        model=model,
        provider=provider,
        research_run_id=research_run_id,
        input_summary=(input_summary or "")[:4000],
        status="running",
    )
    db.add(ex)
    db.flush()
    return ex


def apply_usage(ex: AgentExecution, usage: LLMUsage) -> None:
    ex.input_tokens = (ex.input_tokens or 0) + usage.input_tokens
    ex.output_tokens = (ex.output_tokens or 0) + usage.output_tokens
    ex.cache_read_tokens = (ex.cache_read_tokens or 0) + usage.cache_read_tokens
    ex.search_requests = (ex.search_requests or 0) + usage.search_requests
    ex.cost_usd = Decimal(str(ex.cost_usd or 0)) + Decimal(str(round(usage.cost_usd, 6)))
    if usage.model:
        ex.model = usage.model


def finish_execution(ex: AgentExecution, *, output: dict[str, Any] | None = None, error: str | None = None) -> None:
    ex.status = "failed" if error else "succeeded"
    ex.error = error
    if output is not None:
        ex.output = output
    ex.finished_at = datetime.now(timezone.utc)


def with_retries(fn: Callable[[], R], *, attempts: int | None = None, on_retry: Callable[[int, Exception], None] | None = None) -> R:
    """Run fn with a bounded number of attempts. Only transient errors are retried."""
    max_attempts = attempts or get_settings().max_step_attempts
    last: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except (LLMNotConfigured, LLMRefusal):
            raise
        except LLMTransientError as e:
            last = e
            if on_retry:
                on_retry(attempt, e)
            if attempt < max_attempts:
                time.sleep(min(30, 5 * attempt))
    assert last is not None
    raise last
