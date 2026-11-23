"""Sourcing Agent tools: supplier comparison and landed-cost math (deterministic)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...enums import SUPPLIER_VERIFICATION_LABELS
from ...models import BusinessProject, CostScenario, Supplier
from ..unit_economics import UnitEconomicsInputs, landed_cost


def baseline_inputs(db: Session, project: BusinessProject) -> tuple[UnitEconomicsInputs, str, dict[str, str]]:
    """Most recent saved scenario, else example defaults (all assumptions)."""
    sc = db.scalars(
        select(CostScenario).where(CostScenario.project_id == project.id).order_by(CostScenario.updated_at.desc())
    ).first()
    if sc:
        return UnitEconomicsInputs(**sc.inputs), sc.name, dict(sc.input_basis or {})
    return UnitEconomicsInputs(), "example defaults", {k: "assumption" for k in UnitEconomicsInputs.model_fields}


def supplier_comparison(db: Session, project: BusinessProject) -> list[dict[str, Any]]:
    base, base_name, base_basis = baseline_inputs(db, project)
    suppliers = db.scalars(select(Supplier).where(Supplier.project_id == project.id)).all()
    rows: list[dict[str, Any]] = []
    for s in suppliers:
        for q in s.quotes:
            notes: list[str] = []
            landed = None
            if q.unit_price is None:
                notes.append("No unit price on this quote.")
            elif q.currency.upper() != "USD":
                notes.append(f"Quote is in {q.currency}; convert to USD before comparing (no FX rate stored).")
            else:
                freight = float(q.est_freight_per_unit) if q.est_freight_per_unit is not None else base.freight_per_unit
                if q.est_freight_per_unit is None:
                    notes.append(f"Freight from scenario '{base_name}' ({base_basis.get('freight_per_unit', 'assumption')}).")
                if (q.incoterm or "").upper() == "DDP":
                    notes.append("DDP quote: freight/duty may already be included - check before adding them.")
                inputs = base.model_copy(update={"factory_cost": float(q.unit_price), "freight_per_unit": freight})
                landed = landed_cost(inputs)
                notes.append(f"Duty {base.duty_rate_pct}% from scenario '{base_name}' ({base_basis.get('duty_rate_pct', 'assumption')}).")
            moq_cost = (landed["landed_cost"] * q.moq) if (landed and q.moq) else None
            rows.append(
                {
                    "supplier_id": str(s.id),
                    "supplier_name": s.name,
                    "country": s.country,
                    "platform": s.platform,
                    "verification_status": s.verification_status,
                    "verification_label": SUPPLIER_VERIFICATION_LABELS.get(s.verification_status, s.verification_status),
                    "quality_rating": s.quality_rating,
                    "quote_id": str(q.id),
                    "product_name": q.product_name,
                    "source_url": q.source_url,
                    "website": s.website,
                    "unit_price": float(q.unit_price) if q.unit_price is not None else None,
                    "currency": q.currency,
                    "moq": q.moq,
                    "sample_cost": float(q.sample_cost) if q.sample_cost is not None else None,
                    "lead_time_days": q.lead_time_days,
                    "incoterm": q.incoterm,
                    "quote_date": q.quote_date,
                    "landed_cost": landed,
                    "moq_landed_cost_total": round(moq_cost, 2) if moq_cost is not None else None,
                    "within_budget": (moq_cost <= float(project.budget_usd)) if (moq_cost is not None and project.budget_usd is not None) else None,
                    "notes": notes,
                }
            )
    rows.sort(key=lambda r: (r["landed_cost"] or {}).get("landed_cost", float("inf")))
    return rows
