"""Recommend every unit-economics input from what the product's research found.

The AI proposes a value per input with a reason and the evidence it rests on (numbered E-refs: findings, price tiers,
tracked listings, supplier listing prices, channel fees, shipping benchmarks, review complaints). A value counts as
"sourced_research" only when it cites evidence; the check notes whether the exact figure appears in that evidence or
was estimated from it. The calculator does the math.
"""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import AnalysisSnapshot, BusinessProject, ResearchFinding, SalesChannel, ShippingOption, Supplier, User
from ..unit_economics import INPUT_LABELS, UnitEconomicsInputs, calculate
from .generators import _run
from .outreach import _latest
from .sourcing import baseline_inputs

FIELDS = tuple(INPUT_LABELS)
SECTIONS = ("pricing", "sourcing_costs", "logistics", "channels", "regulatory", "customer_segments", "unmet_needs", "risks", "demand",
            "competitors", "customers")


class RecommendedInput(BaseModel):
    field: Literal[FIELDS]  # type: ignore[valid-type]
    value: float = Field(ge=0)
    basis: Literal["sourced_research", "supplier_quote", "assumption"]
    refs: list[str] = Field(description="E-refs of the evidence the value rests on; required unless basis is assumption")
    why: str = Field(description="One sentence: where the number comes from, or why this assumption")


class UERecommendation(BaseModel):
    summary: str = Field(description="Two or three sentences: the recommended price position and the main risks. "
                                     "Do not state margin or contribution figures - the calculator computes them")
    inputs: list[RecommendedInput]


SYSTEM = """You set the inputs of a small brand's unit-economics calculator from its own research.
Rules:
- Give every input. Use the evidence: cite E-refs for each value that rests on it. When the evidence does not give a number,
  use a cautious, typical starting value and mark it "assumption", saying it must be confirmed.
- Retail price: pick a price that fits the price tiers, comparable listings and the brand's positioning, and that leaves a
  positive contribution after fees, returns and marketing. Say which tier it targets.
- Factory cost: from supplier listing prices or quotes at a realistic first-order MOQ (listing prices are not quotes - say so).
  Use "supplier_quote" only for an actual quote.
- Duty, fees and freight: use the cited rate exactly as the evidence states it. Channel fees: use the channel the research
  recommends launching on.
- Budget, MOQ and samples should fit the founder's budget.
- Never invent a source. Keep each reason to one sentence.
- Do not calculate margins or contribution yourself; the calculator does that from your inputs."""


def _money(v: Any) -> str:
    return f"${float(v):,.2f}" if v is not None else "?"


def evidence(db: Session, project: BusinessProject) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Numbered evidence lines for the prompt, and what each E-ref points at (label, link, text)."""
    lines: list[str] = []
    refs: dict[str, dict[str, Any]] = {}

    def add(text: str, label: str, url: str | None) -> None:
        ref = f"E{len(refs) + 1}"
        refs[ref] = {"label": label, "url": url, "text": text}
        lines.append(f"[{ref}] {text}")

    if (t := _latest(db, project.id, "price_tiers")):
        for tier in t.content.get("tiers") or []:
            ex = "; ".join(f"{e['product'][:60]} {_money(e['price'])}" for e in (tier.get("examples") or [])[:3])
            add(f"Price tier {tier.get('tier')}: {_money(tier.get('price_low'))}-{_money(tier.get('price_high'))}. "
                f"Quality: {'; '.join(tier.get('materials_and_quality') or [])[:200]}. Buyers want: {'; '.join(tier.get('customer_needs') or [])[:200]}. "
                f"Examples: {ex}", f"Price tier: {tier.get('tier')}", (tier.get("sources") or [{}])[0].get("url"))
    if (lt := _latest(db, project.id, "listing_tracker")):
        rows = lt.content.get("listings") or []
        prices = [r["price"] for r in rows if r.get("price") is not None]
        if prices:
            add(f"{len(rows)} directly comparable listings: {_money(min(prices))}-{_money(max(prices))}, median {_money(statistics.median(prices))}; "
                + "; ".join(f"{r['platform']} {_money(r['price'])} {r['title'][:50]}" for r in rows[:8]),
                "Listing tracker", rows[0].get("url"))
    if (rv := _latest(db, project.id, "review_insights")):
        add("Low-star review complaints: " + "; ".join(f"{t['tag']} ({t['count']}): {t['summary']}" for t in rv.content.get("themes") or []),
            "Low-star reviews", None)
    for s in db.scalars(select(Supplier).where(Supplier.project_id == project.id)).all():
        for q in s.quotes:
            if q.unit_price is None:
                continue
            kind = "quote" if q.source in ("rfq", "manual", "email", "csv") else "listing price (not a quote)"
            add(f"Supplier {kind}: {s.name[:70]} - {q.product_name[:60]}: {_money(q.unit_price)} {q.currency}/unit, MOQ {q.moq or '?'}"
                + (f", sample {_money(q.sample_cost)}" if q.sample_cost is not None else "") + (f", lead time {q.lead_time_days} days" if q.lead_time_days else ""),
                s.name[:80], q.source_url or s.website)
    for c in db.scalars(select(SalesChannel).where(SalesChannel.project_id == project.id, SalesChannel.status != "rejected")).all():
        fees = [f"{lab} {v}" for lab, v in (("commission %", c.commission_pct), ("per order $", c.per_order_fee), ("payment %", c.payment_fee_pct),
                                             ("payment fixed $", c.payment_fee_fixed), ("monthly $", c.monthly_fee)) if v is not None]
        add(f"Channel {c.name} ({c.channel_type}, fees {c.fee_basis}): " + (", ".join(fees) or "no fees confirmed"), f"Channel: {c.name}", c.fee_source_url)
    for o in db.scalars(select(ShippingOption).where(ShippingOption.project_id == project.id)).all():
        add(f"Shipping {o.name} ({o.leg}, {o.mode}, {o.basis}): {o.rate}{'-' + str(o.rate_high) if o.rate_high else ''} {o.currency} {o.rate_basis}"
            + (f", fixed fees {o.fixed_fees}" if o.fixed_fees else ""), f"Shipping: {o.name}", o.source_url)
    findings = db.scalars(select(ResearchFinding).where(ResearchFinding.project_id == project.id, ResearchFinding.section.in_(SECTIONS),
                                                        ResearchFinding.evidence_type.in_(["sourced", "ai_inference"]))
                          .order_by(ResearchFinding.created_at.desc()).limit(90)).all()
    for f in findings:
        link = next((lk.source.url for lk in f.evidence_links if lk.source and lk.source.url), None)
        add(f"Finding [{f.section}, {f.evidence_type}]: {f.claim}" + (f" {f.detail[:160]}" if f.detail else ""), f.claim[:80], link)
    return lines, refs


def recommend(db: Session, project: BusinessProject, user: User) -> AnalysisSnapshot:
    base, base_name, _ = baseline_inputs(db, project)
    lines, refs = evidence(db, project)
    spec = UnitEconomicsInputs.model_json_schema()["properties"]
    field_lines = [f"- {k}: {INPUT_LABELS[k]} ({spec[k].get('description', '')}) - current value {getattr(base, k)}" for k in FIELDS]
    prompt = (f"Product: {project.name} - {project.product_category}. Market: {project.target_country}. Sourcing: {project.sourcing_country or 'n/a'}. "
              f"Budget: {_money(project.budget_usd)}. Price hypothesis: {_money(project.price_min)}-{_money(project.price_max)}.\n"
              f"Current saved scenario: '{base_name}'.\n\nCALCULATOR INPUTS:\n" + "\n".join(field_lines)
              + "\n\n=== EVIDENCE ===\n" + ("\n".join(lines) or "(no research saved yet)") + "\n\nRecommend every input.")
    out, usage, ex = _run(db, agent="analytics", operation="recommend_unit_economics", project=project, user=user,
                          system=SYSTEM, prompt=prompt, output_model=UERecommendation)
    values: dict[str, Any] = {}
    items: list[dict[str, Any]] = []
    for r in out.inputs:
        if r.field in values:
            continue
        try:
            UnitEconomicsInputs(**{r.field: r.value})
        except ValidationError:
            continue  # out of range for this input (e.g. a percentage over 100)
        cited = [x for x in dict.fromkeys(r.refs) if x in refs]
        basis = r.basis if cited else "assumption"
        exact = basis != "assumption" and any(f"{r.value:g}" in refs[x]["text"].replace(",", "") or f"{r.value:.2f}" in refs[x]["text"] for x in cited)
        values[r.field] = int(r.value) if r.field in ("moq", "units_per_shipment") else r.value
        items.append({"field": r.field, "value": values[r.field], "basis": basis, "why": r.why, "exact_in_source": exact,
                      "sources": [{"ref": x, "label": refs[x]["label"], "url": refs[x]["url"]} for x in cited]})
    merged = base.model_copy(update=values)
    res = calculate(merged)
    content = {
        "summary": out.summary, "inputs": items, "based_on_scenario": base_name, "evidence_count": len(refs),
        "results": {"retail_price": merged.retail_price, "landed_cost": res["landed_cost_breakdown"]["landed_cost"],
                    "contribution_margin": res["contribution_margin"], "contribution_margin_pct": res["contribution_margin_pct"],
                    "gross_margin_pct": res["gross_margin_pct"], "breakeven_cac": res["breakeven_cac"]},
        "generated_by": {"model": usage.model, "generated_at": datetime.now(timezone.utc).isoformat(), "cost_usd": round(usage.cost_usd, 4)},
    }
    snap = AnalysisSnapshot(project_id=project.id, kind="ue_recommendation", content=content, agent_execution_id=ex.id)
    db.add(snap)
    return snap
