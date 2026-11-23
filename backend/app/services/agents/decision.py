"""Decision brief: an evidence-linked go / no-go recommendation built from everything stored for a product.

The brief is advice. Only the founder records the decision (BusinessProject.decision + ProjectDecision log).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...models import (
    AnalysisSnapshot,
    BusinessProject,
    Competitor,
    CostScenario,
    MarketOpportunity,
    ProjectDecision,
    ResearchFinding,
    SalesChannel,
    Supplier,
    User,
)
from ..llm.anthropic_provider import get_llm
from ..logistics import channel_economics
from .runtime import apply_usage, finish_execution, start_execution, with_retries
from .sourcing import supplier_comparison


class BriefPoint(BaseModel):
    point: str
    finding_refs: list[str]


class KeyNumber(BaseModel):
    label: str
    value: str
    basis: Literal["sourced", "computed_from_assumptions", "supplier_quote", "ai_inference"]


class Offer(BaseModel):
    """What to sell: the product the research supports, at what price, made of what."""
    price_low: float | None = Field(description="Lower end of the recommended retail price (USD); null if the research cannot support one")
    price_high: float | None = Field(description="Upper end of the recommended retail price (USD)")
    price_tier: Literal["budget", "mid", "premium", "luxury", "unknown"]
    positioning: str = Field(description="One sentence: who it is for and how it differs from the competitors found")
    materials: list[str] = Field(description="Materials and construction the research supports (from price tiers, listings, reviews, spec sheet)")
    must_have_features: list[str] = Field(description="Features that answer the complaints and needs in the research")
    first_channel: str = Field(description="Where to sell first, per the channel research")
    finding_refs: list[str]


class DecisionBrief(BaseModel):
    recommendation: Literal["go", "no_go", "needs_more_evidence"]
    confidence: Literal["high", "medium", "low"]
    confidence_score: int = Field(ge=0, le=100, description="0-100: how sure the recommendation is, given how complete and well-sourced "
                                                             "the evidence is (unverified duty, no supplier quotes or untested demand lower it)")
    headline: str
    offer: Offer
    reasons_for: list[BriefPoint]
    reasons_against: list[BriefPoint]
    key_numbers: list[KeyNumber] = Field(description="Only numbers present in the inputs; label assumptions as such")
    conditions_to_go: list[str] = Field(description="What must be true / verified before committing money")
    kill_criteria: list[str] = Field(description="Results that should stop the project")
    cheapest_next_test: str
    evidence_gaps: list[str]


SYSTEM = """You are an investment-committee style advisor for a small founder deciding whether to launch a product.
Weigh the stored evidence honestly. Rules:
- Cite findings by F-ref. Distinguish sourced evidence from AI inference and assumptions.
- Use only numbers that appear in the inputs; computed unit economics rest on assumptions unless marked as quotes/actuals.
- If key evidence is missing (demand, margins, supplier quotes), recommend "needs_more_evidence" and name the cheapest test.
- Always give the offer the research supports: a price range inside a price tier the evidence shows, the materials and features
  that answer buyers' needs and complaints, and the first channel. The calculator checks the margin at your prices.
- Be direct. The founder makes the final call; you give a recommendation with reasons for and against."""


def evidence_snapshot(db: Session, project: BusinessProject) -> dict[str, Any]:
    """Compact numeric snapshot stored with each decision for later reference."""
    pid = project.id
    opp = db.scalars(select(MarketOpportunity).where(MarketOpportunity.project_id == pid).order_by(MarketOpportunity.created_at.desc())).first()
    sc = db.scalars(select(CostScenario).where(CostScenario.project_id == pid).order_by(CostScenario.updated_at.desc())).first()
    brief = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == pid, AnalysisSnapshot.kind == "decision_brief")
                       .order_by(AnalysisSnapshot.created_at.desc())).first()
    by_type = dict(db.execute(select(ResearchFinding.evidence_type, func.count(ResearchFinding.id))
                              .where(ResearchFinding.project_id == pid).group_by(ResearchFinding.evidence_type)).all())
    return {
        "attractiveness": opp.attractiveness if opp else None,
        "report_id": str(opp.id) if opp else None,
        "ai_recommendation": (brief.content or {}).get("recommendation") if brief else None,
        "contribution_margin": (sc.results or {}).get("contribution_margin") if sc else None,
        "contribution_margin_pct": (sc.results or {}).get("contribution_margin_pct") if sc else None,
        "scenario": sc.name if sc else None,
        "findings_by_type": by_type,
        "competitors": db.scalar(select(func.count(Competitor.id)).where(Competitor.project_id == pid)) or 0,
        "suppliers": db.scalar(select(func.count(Supplier.id)).where(Supplier.project_id == pid)) or 0,
        "taken_at": datetime.now(timezone.utc).isoformat(),
    }


def _latest(db: Session, pid, kind: str) -> AnalysisSnapshot | None:
    return db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == pid, AnalysisSnapshot.kind == kind)
                      .order_by(AnalysisSnapshot.created_at.desc())).first()


def _product_research(db: Session, project: BusinessProject) -> list[str]:
    """Market size, competitor revenue, price tiers, tracked listings, review complaints, the spec sheet and recommended
    numbers - what the offer rests on."""
    out: list[str] = []
    sizes = db.scalars(select(ResearchFinding).where(ResearchFinding.project_id == project.id, ResearchFinding.section.in_(["market_size", "growth"]),
                                                     ResearchFinding.metric.is_not(None)).order_by(ResearchFinding.created_at.desc()).limit(12)).all()
    if sizes:
        out.append("=== MARKET SIZE & GROWTH ===\n" + "\n".join(
            f"- {f.metric['name']}: {f.metric.get('value_low')}{'-' + str(f.metric['value_high']) if f.metric.get('value_high') not in (None, f.metric.get('value_low')) else ''} "
            f"{f.metric.get('unit')} ({f.metric.get('year') or 'year not stated'}; {f.evidence_type}, {f.confidence})" for f in sizes))
    revs = [c for c in db.scalars(select(Competitor).where(Competitor.project_id == project.id)).all() if c.revenue]
    if revs:
        out.append("=== COMPETITOR REVENUE (as stated by sources) ===\n" + "\n".join(
            f"- {c.name}: {c.revenue.get('value_low')}{'-' + str(c.revenue['value_high']) if c.revenue.get('value_high') not in (None, c.revenue.get('value_low')) else ''} "
            f"{c.revenue.get('unit')} ({c.revenue.get('year') or 'year not stated'}) - {c.revenue.get('name')}" for c in revs))
    if (t := _latest(db, project.id, "price_tiers")):
        out.append("=== PRICE TIERS ===\n" + "\n".join(
            f"- {x.get('tier')}: ${x.get('price_low')}-${x.get('price_high')}; quality: {'; '.join(x.get('materials_and_quality') or [])}; "
            f"buyers want: {'; '.join(x.get('customer_needs') or [])}; complaints: {'; '.join(x.get('complaints') or [])}"
            for x in t.content.get("tiers") or []))
    if (lt := _latest(db, project.id, "listing_tracker")) and lt.content.get("listings"):
        out.append("=== COMPARABLE LISTINGS ===\n" + "\n".join(
            f"- {r['platform']} ${r['price']:.2f}, {r.get('rating') or '-'} stars ({r.get('reviews') or 0} reviews): {r['title'][:90]}"
            for r in lt.content["listings"][:15]))
    if (rv := _latest(db, project.id, "review_insights")):
        out.append("=== LOW-STAR REVIEW COMPLAINTS ===\n" + "\n".join(
            f"- {x['tag']} ({x['count']}): {x['summary']} Fix: {x['fix']}" for x in rv.content.get("themes") or []))
    if (sp := _latest(db, project.id, "spec_sheet")):
        out.append("=== SPEC SHEET DRAFT ===\nMaterials: " + "; ".join(sp.content.get("materials") or [])
                   + "\nQuality requirements: " + "; ".join(sp.content.get("quality_requirements") or []))
    if (ue := _latest(db, project.id, "ue_recommendation")):
        out.append(f"=== RECOMMENDED NUMBERS ===\n{ue.content.get('summary')} {ue.content.get('price_note') or ''}")
    return out


def _economics_at(sc: CostScenario | None, prices: list[float | None]) -> list[dict[str, Any]]:
    """Contribution per unit at the recommended prices, from the latest saved scenario's costs (the calculator, not the AI)."""
    if sc is None:
        return []
    from ..unit_economics import UnitEconomicsInputs, calculate

    rows = []
    for p in dict.fromkeys(x for x in prices if x):
        r = calculate(UnitEconomicsInputs(**{**(sc.inputs or {}), "retail_price": p}))
        rows.append({"price": p, "contribution_margin": r["contribution_margin"], "contribution_margin_pct": r["contribution_margin_pct"],
                     "scenario": sc.name})
    return rows


def generate(db: Session, project: BusinessProject, user: User) -> tuple[DecisionBrief, AnalysisSnapshot]:
    pid = project.id
    findings = db.scalars(select(ResearchFinding).where(ResearchFinding.project_id == pid)
                          .order_by(ResearchFinding.created_at.desc()).limit(60)).all()
    fmap = {f"F{i}": f for i, f in enumerate(findings, 1)}
    f_lines = [f"{r} [{f.section}] ({f.evidence_type}, {f.confidence}, {f.verification_status}): {f.claim}" for r, f in fmap.items()]
    opp = db.scalars(select(MarketOpportunity).where(MarketOpportunity.project_id == pid).order_by(MarketOpportunity.created_at.desc())).first()
    sc = db.scalars(select(CostScenario).where(CostScenario.project_id == pid).order_by(CostScenario.updated_at.desc())).first()
    suppliers = supplier_comparison(db, project)[:3]
    channels = channel_economics(db, project, list(db.scalars(select(SalesChannel).where(SalesChannel.project_id == pid,
                                                                                      SalesChannel.status != "rejected"))))
    history = db.scalars(select(ProjectDecision).where(ProjectDecision.project_id == pid).order_by(ProjectDecision.created_at.desc()).limit(5)).all()

    parts = [
        f"Product/category: {project.product_category} | market {project.target_country} | sourcing {project.sourcing_country or 'n/a'} "
        f"| budget {project.budget_usd} | price hypothesis {project.price_min}-{project.price_max}",
        "=== FINDINGS ===\n" + ("\n".join(f_lines) or "(none - no research yet)"),
    ]
    if opp:
        r = opp.report or {}
        parts.append(f"=== LATEST OPPORTUNITY REPORT ({opp.created_at:%Y-%m-%d}) ===\nAttractiveness: {opp.attractiveness}\n{opp.summary}\n"
                     f"Pricing: {(r.get('pricing') or {}).get('summary')}\nRisks: " + "; ".join(x.get("risk", "") for x in r.get("risks") or []))
    if sc:
        res = sc.results or {}
        assumed = [k for k, v in (sc.input_basis or {}).items() if str(v).startswith("assumption")]
        parts.append(f"=== LATEST COST SCENARIO '{sc.name}' ({sc.scenario_type}) ===\nRetail {sc.inputs.get('retail_price')}, contribution "
                     f"{res.get('contribution_margin')} per unit ({res.get('contribution_margin_pct')}%), break-even CAC {res.get('breakeven_cac')}. "
                     f"Inputs that are assumptions: {', '.join(assumed) or 'none'}. Warnings: {'; '.join(res.get('warnings') or [])}")
    if suppliers:
        parts.append("=== BEST SUPPLIER QUOTES (landed cost) ===\n" + "\n".join(
            f"- {s['supplier_name']} ({s['verification_label']}): unit {s['unit_price']} {s['currency']}, MOQ {s['moq']}, "
            f"landed {(s['landed_cost'] or {}).get('landed_cost')}" for s in suppliers))
    if channels["rows"]:
        parts.append("=== CHANNEL ECONOMICS ===\n" + "\n".join(
            f"- {c['name']} (fees {c['fee_basis']}): contribution {c['contribution_margin']} per unit" for c in channels["rows"][:5]))
    parts += _product_research(db, project)
    if history:
        parts.append("=== PREVIOUS DECISIONS ===\n" + "\n".join(f"- {h.created_at:%Y-%m-%d}: {h.decision} - {h.note or ''}" for h in history))

    llm = get_llm()
    ex = start_execution(db, agent="supervisor", operation="decision_brief", project_id=pid, user_id=user.id, model=llm.model,
                         input_summary=f"{len(f_lines)} findings, report={'yes' if opp else 'no'}, scenario={'yes' if sc else 'no'}")
    db.commit()
    try:
        brief, usage = with_retries(lambda: llm.structured(system=SYSTEM, prompt="\n\n".join(parts) + "\n\nWrite the decision brief.",
                                                            output_model=DecisionBrief))
    except Exception as e:
        finish_execution(ex, error=str(e)[:2000])
        db.commit()
        raise
    apply_usage(ex, usage)
    content = brief.model_dump()
    for key in ("reasons_for", "reasons_against"):
        for p in content[key]:
            p["finding_ids"] = [str(fmap[r].id) for r in p.pop("finding_refs") if r in fmap]
    content["offer"]["finding_ids"] = [str(fmap[r].id) for r in content["offer"].pop("finding_refs") if r in fmap]
    content["offer"]["economics"] = _economics_at(sc, [brief.offer.price_low, brief.offer.price_high])
    content["generated_by"] = {"model": usage.model or llm.model, "generated_at": datetime.now(timezone.utc).isoformat()}
    snap = AnalysisSnapshot(project_id=pid, kind="decision_brief", content=content, agent_execution_id=ex.id)
    db.add(snap)
    finish_execution(ex, output={"recommendation": brief.recommendation})
    return brief, snap
