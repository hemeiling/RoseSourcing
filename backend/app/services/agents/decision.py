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


class DecisionBrief(BaseModel):
    recommendation: Literal["go", "no_go", "needs_more_evidence"]
    confidence: Literal["high", "medium", "low"]
    headline: str
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
    content["generated_by"] = {"model": usage.model or llm.model, "generated_at": datetime.now(timezone.utc).isoformat()}
    snap = AnalysisSnapshot(project_id=pid, kind="decision_brief", content=content, agent_execution_id=ex.id)
    db.add(snap)
    finish_execution(ex, output={"recommendation": brief.recommendation})
    return brief, snap
