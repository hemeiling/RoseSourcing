"""AI Business Copilot: answers questions from the project's stored records via explicit tools."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ... import audit
from ...config import get_settings
from ...models import (
    BrandConcept,
    BusinessProject,
    Competitor,
    CopilotMessage,
    CopilotThread,
    CostScenario,
    Experiment,
    MarketOpportunity,
    Recommendation,
    ResearchFinding,
    ResearchRun,
    Supplier,
    User,
)
from ..llm.anthropic_provider import get_llm
from ..llm.base import ToolSpec
from ..unit_economics import UnitEconomicsInputs, calculate
from .runtime import apply_usage, finish_execution, start_execution
from .sourcing import supplier_comparison

SYSTEM = """You are the AI Business Copilot inside AI Commerce OS, helping a founder decide and act on a product business.

How to work:
- Use the tools to look up the founder's saved project data before answering anything about their business. Do not rely on memory for project facts.
- Ground answers in retrieved records. When you use a research finding, say what kind of evidence it is (sourced evidence, AI inference, assumption, or data unavailable) and link the source as [title](url) when one exists.
- Separate clearly: what the stored evidence shows, what you infer, and what is unknown. If the data needed is missing, say so and suggest how to get it (e.g. run market research, add supplier quotes).
- Never invent market sizes, prices, supplier quotes, reviews or growth rates. For profit or margin questions, call calculate_unit_economics - do not do the math yourself - and state which inputs are assumptions.
- Supplier verification status is set by the founder. Never describe an unverified supplier as vetted, certified or reliable.
- Write actions: only create_recommendation and save_cost_scenario change data. Only say something was saved if the tool result returns "ok": true with an id. You cannot publish listings, buy inventory, launch campaigns, or contact suppliers - those require the founder to act in the app with explicit approval.
- Be concise and practical. Use short sections or bullets. End with a clear next step when useful."""


# ----------------------------------------------------------------------------- tool inputs


class SearchFindingsIn(BaseModel):
    query: str = Field(description="Keywords to search for in findings")
    section: str | None = None
    evidence_type: str | None = None
    limit: int = Field(12, ge=1, le=30)


class ListCompetitorsIn(BaseModel):
    watchlist_only: bool = False


class CalcIn(BaseModel):
    base_scenario_id: str | None = Field(None, description="Scenario to start from; defaults to the most recent")
    overrides: dict[str, float] = Field(default_factory=dict, description="Input values to change, e.g. {'retail_price': 69}")


class CreateRecIn(BaseModel):
    title: str
    body: str
    priority: str = "medium"


class SaveScenarioIn(BaseModel):
    name: str
    base_scenario_id: str | None = None
    overrides: dict[str, float] = Field(default_factory=dict)


class ListRecsIn(BaseModel):
    status: str | None = None


TOOLS: list[ToolSpec] = [
    ToolSpec("get_project_overview", "Project parameters (category, market, budget, price hypothesis), record counts, latest research run status.",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("search_findings", "Search stored research findings by keyword. Returns claims with evidence type, confidence, verification status and source links.",
             SearchFindingsIn.model_json_schema()),
    ToolSpec("get_opportunity_report", "The latest market opportunity report: summary, attractiveness, recommended segment, differentiation, pricing, risks, evidence gaps, next steps.",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("list_competitors", "Competitor records with observed prices, source links and observation dates.", ListCompetitorsIn.model_json_schema()),
    ToolSpec("compare_suppliers", "Suppliers with quotes, verification status and computed landed cost per unit (using the latest cost scenario's freight/duty assumptions where a quote lacks them).",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("list_cost_scenarios", "Saved unit-economics scenarios with key results and which inputs are assumptions.",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("calculate_unit_economics", "Run the deterministic unit-economics model from a saved scenario with optional overrides (e.g. retail_price). Input names: "
             + ", ".join(UnitEconomicsInputs.model_fields), CalcIn.model_json_schema()),
    ToolSpec("list_recommendations", "Saved recommendations / next steps and their status.", ListRecsIn.model_json_schema()),
    ToolSpec("list_brand_concepts", "Saved brand concepts (names, positioning, personas, palettes, messaging).",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("create_recommendation", "Save a recommendation to the project's action list. Only when the founder asks to save/track something.",
             CreateRecIn.model_json_schema()),
    ToolSpec("save_cost_scenario", "Save a new cost scenario (hypothetical) built from a base scenario plus overrides. Only when the founder asks to save.",
             SaveScenarioIn.model_json_schema()),
]


class CopilotTools:
    def __init__(self, db: Session, project: BusinessProject, user: User) -> None:
        self.db, self.project, self.user = db, project, user
        self.references: dict[str, dict[str, Any]] = {}

    def _ref(self, kind: str, id_: Any, label: str, url: str | None = None) -> None:
        self.references[f"{kind}:{id_}"] = {"type": kind, "id": str(id_), "label": label[:200], "url": url}

    # ---- dispatch
    def execute(self, name: str, raw: dict[str, Any]) -> tuple[bool, str, str]:
        handler = getattr(self, f"t_{name}", None)
        if handler is None:
            return False, json.dumps({"ok": False, "error": f"Unknown tool {name}"}), f"Unknown tool {name}"
        try:
            result, summary = handler(raw or {})
            return True, json.dumps(result, default=str), summary
        except ValidationError as e:
            return False, json.dumps({"ok": False, "error": f"Invalid input: {e.errors()[:3]}"}, default=str), "Invalid tool input"
        except Exception as e:  # noqa: BLE001 - report the failure to the model truthfully
            self.db.rollback()
            return False, json.dumps({"ok": False, "error": str(e)}), f"Failed: {e}"

    def _latest_scenario(self, scenario_id: str | None) -> CostScenario | None:
        q = select(CostScenario).where(CostScenario.project_id == self.project.id)
        if scenario_id:
            q = q.where(CostScenario.id == uuid.UUID(scenario_id))
        return self.db.scalars(q.order_by(CostScenario.updated_at.desc())).first()

    # ---- read tools
    def t_get_project_overview(self, _: dict) -> tuple[dict, str]:
        p, db = self.project, self.db

        def count(model) -> int:
            return len(db.scalars(select(model.id).where(model.project_id == p.id)).all())

        run = db.scalars(select(ResearchRun).where(ResearchRun.project_id == p.id).order_by(ResearchRun.created_at.desc())).first()
        data = {
            "name": p.name, "category": p.product_category, "target_country": p.target_country, "sourcing_country": p.sourcing_country,
            "budget_usd": float(p.budget_usd) if p.budget_usd is not None else None,
            "price_hypothesis": [float(p.price_min) if p.price_min is not None else None, float(p.price_max) if p.price_max is not None else None],
            "target_customers": p.target_customers, "assumptions": p.assumptions,
            "counts": {"findings": count(ResearchFinding), "competitors": count(Competitor), "suppliers": count(Supplier),
                       "cost_scenarios": count(CostScenario), "experiments": count(Experiment), "brand_concepts": count(BrandConcept)},
            "latest_research_run": {"status": run.status, "kind": run.kind, "created_at": run.created_at} if run else None,
        }
        return data, "Read project overview"

    def t_search_findings(self, raw: dict) -> tuple[dict, str]:
        args = SearchFindingsIn(**raw)
        words = [w for w in re.findall(r"[A-Za-z0-9$%]+", args.query.lower()) if len(w) >= 3][:8]
        q = select(ResearchFinding).where(ResearchFinding.project_id == self.project.id)
        if words:
            q = q.where(or_(*[ResearchFinding.claim.ilike(f"%{w}%") for w in words], *[ResearchFinding.detail.ilike(f"%{w}%") for w in words]))
        if args.section:
            q = q.where(ResearchFinding.section == args.section)
        if args.evidence_type:
            q = q.where(ResearchFinding.evidence_type == args.evidence_type)
        rows = self.db.scalars(q.order_by(ResearchFinding.created_at.desc()).limit(80)).all()

        def score(f: ResearchFinding) -> int:
            text = f"{f.claim} {f.detail or ''}".lower()
            return sum(w in text for w in words) + (1 if f.evidence_type == "sourced" else 0)

        rows = sorted(rows, key=score, reverse=True)[: args.limit]
        out = []
        for f in rows:
            sources = [{"title": l.source.title, "url": l.source.url, "retrieved_at": l.source.retrieved_at.date().isoformat(), "quote": l.quote}
                       for l in f.evidence_links if l.source]
            self._ref("finding", f.id, f.claim, sources[0]["url"] if sources else None)
            out.append({"id": str(f.id), "section": f.section, "claim": f.claim, "detail": f.detail, "evidence_type": f.evidence_type,
                        "confidence": f.confidence, "verification_status": f.verification_status, "metric": f.metric,
                        "warnings": f.flags, "sources": sources})
        return {"ok": True, "count": len(out), "findings": out}, f"Searched findings for “{args.query}” ({len(out)} found)"

    def t_get_opportunity_report(self, _: dict) -> tuple[dict, str]:
        opp = self.db.scalars(select(MarketOpportunity).where(MarketOpportunity.project_id == self.project.id)
                              .order_by(MarketOpportunity.created_at.desc())).first()
        if not opp:
            return {"ok": True, "report": None, "note": "No opportunity report yet. The founder can run Market Opportunity research."}, "No report found"
        self._ref("report", opp.id, opp.title)
        r = dict(opp.report or {})
        r.pop("generated_by", None)
        return {"ok": True, "id": str(opp.id), "title": opp.title, "created_at": opp.created_at, "report": r,
                "note": "This report is an AI synthesis of stored findings; check finding evidence types."}, "Read latest opportunity report"

    def t_list_competitors(self, raw: dict) -> tuple[dict, str]:
        args = ListCompetitorsIn(**raw)
        q = select(Competitor).where(Competitor.project_id == self.project.id)
        if args.watchlist_only:
            q = q.where(Competitor.on_watchlist.is_(True))
        out = []
        for c in self.db.scalars(q).all():
            self._ref("competitor", c.id, c.name, c.website)
            prices = [{"product": p.name, "price": float(po.price), "currency": po.currency, "observed_at": po.observed_at.date().isoformat(),
                       "source_url": po.source_url, "source_type": po.source_type, "verification_status": po.verification_status}
                      for p in c.products for po in p.price_observations]
            out.append({"name": c.name, "website": c.website, "price_tier": c.price_tier, "positioning": c.positioning,
                        "channels": c.channels, "on_watchlist": c.on_watchlist, "discovered_by": c.discovered_by, "prices": prices})
        return {"ok": True, "competitors": out}, f"Listed {len(out)} competitors"

    def t_compare_suppliers(self, _: dict) -> tuple[dict, str]:
        rows = supplier_comparison(self.db, self.project)
        for r in rows:
            self._ref("supplier", r["supplier_id"], r["supplier_name"])
        return {"ok": True, "rows": rows,
                "note": "verification_status is set by the founder; 'unverified' means no checks have been done."}, f"Compared {len(rows)} supplier quotes"

    def t_list_cost_scenarios(self, _: dict) -> tuple[dict, str]:
        out = []
        for s in self.db.scalars(select(CostScenario).where(CostScenario.project_id == self.project.id).order_by(CostScenario.updated_at.desc())).all():
            self._ref("scenario", s.id, s.name)
            r = s.results or {}
            out.append({"id": str(s.id), "name": s.name, "type": s.scenario_type, "inputs": s.inputs, "input_basis": s.input_basis,
                        "contribution_margin": r.get("contribution_margin"), "contribution_margin_pct": r.get("contribution_margin_pct"),
                        "landed_cost": (r.get("landed_cost_breakdown") or {}).get("landed_cost"), "warnings": r.get("warnings")})
        return {"ok": True, "scenarios": out}, f"Listed {len(out)} cost scenarios"

    def t_calculate_unit_economics(self, raw: dict) -> tuple[dict, str]:
        args = CalcIn(**raw)
        base = self._latest_scenario(args.base_scenario_id)
        inputs = dict(base.inputs) if base else UnitEconomicsInputs().model_dump()
        basis = dict(base.input_basis) if base else {k: "assumption" for k in inputs}
        unknown = [k for k in args.overrides if k not in UnitEconomicsInputs.model_fields]
        for k, v in args.overrides.items():
            if k in UnitEconomicsInputs.model_fields:
                inputs[k] = v
                basis[k] = "assumption (copilot what-if)"
        results = calculate(UnitEconomicsInputs(**inputs))
        return {"ok": True, "base_scenario": base.name if base else "built-in example defaults (all assumptions)",
                "inputs": inputs, "input_basis": basis, "ignored_unknown_inputs": unknown, "results": results}, \
            f"Calculated unit economics{' with ' + ', '.join(f'{k}={v}' for k, v in args.overrides.items()) if args.overrides else ''}"

    def t_list_recommendations(self, raw: dict) -> tuple[dict, str]:
        args = ListRecsIn(**raw)
        q = select(Recommendation).where(Recommendation.project_id == self.project.id)
        if args.status:
            q = q.where(Recommendation.status == args.status)
        recs = self.db.scalars(q.order_by(Recommendation.created_at.desc()).limit(30)).all()
        return {"ok": True, "recommendations": [{"id": str(r.id), "title": r.title, "body": r.body, "priority": r.priority,
                                                  "status": r.status, "source": r.source} for r in recs]}, f"Listed {len(recs)} recommendations"

    def t_list_brand_concepts(self, _: dict) -> tuple[dict, str]:
        rows = self.db.scalars(select(BrandConcept).where(BrandConcept.project_id == self.project.id).order_by(BrandConcept.created_at.desc()).limit(20)).all()
        return {"ok": True, "concepts": [{"id": str(b.id), "kind": b.kind, "title": b.title, "status": b.status, "content": b.content} for b in rows]}, \
            f"Listed {len(rows)} brand concepts"

    # ---- write tools (backend-confirmed)
    def t_create_recommendation(self, raw: dict) -> tuple[dict, str]:
        args = CreateRecIn(**raw)
        prio = args.priority if args.priority in ("high", "medium", "low") else "medium"
        rec = Recommendation(project_id=self.project.id, source="copilot", title=args.title[:300], body=args.body, priority=prio)
        self.db.add(rec)
        audit.record(self.db, "recommendation.created", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="recommendation", entity_id=rec.id)
        self.db.commit()
        self._ref("recommendation", rec.id, rec.title)
        return {"ok": True, "id": str(rec.id), "title": rec.title}, f"Saved recommendation “{rec.title}”"

    def t_save_cost_scenario(self, raw: dict) -> tuple[dict, str]:
        args = SaveScenarioIn(**raw)
        base = self._latest_scenario(args.base_scenario_id)
        inputs = dict(base.inputs) if base else UnitEconomicsInputs().model_dump()
        basis = dict(base.input_basis) if base else {k: "assumption" for k in inputs}
        for k, v in args.overrides.items():
            if k in UnitEconomicsInputs.model_fields:
                inputs[k] = v
                basis[k] = "assumption"
        model = UnitEconomicsInputs(**inputs)
        sc = CostScenario(project_id=self.project.id, name=args.name[:200], scenario_type="hypothetical", inputs=model.model_dump(),
                          input_basis=basis, results=calculate(model), created_by="copilot",
                          notes=f"Created by copilot from '{base.name if base else 'defaults'}'.")
        self.db.add(sc)
        audit.record(self.db, "cost_scenario.created", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="cost_scenario", entity_id=sc.id)
        self.db.commit()
        self._ref("scenario", sc.id, sc.name)
        return {"ok": True, "id": str(sc.id), "name": sc.name, "contribution_margin": sc.results["contribution_margin"]}, f"Saved scenario “{sc.name}”"


def answer(db: Session, project: BusinessProject, user: User, thread: CopilotThread, question: str) -> CopilotMessage:
    settings = get_settings()
    llm = get_llm()

    history = [m for m in thread.messages if m.role in ("user", "assistant")][-20:]
    messages: list[dict[str, Any]] = []
    for m in history:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": question})

    user_msg = CopilotMessage(thread_id=thread.id, role="user", content=question)
    db.add(user_msg)
    if thread.title == "New conversation":
        thread.title = question[:80]
    ex = start_execution(db, agent="copilot", operation="answer", project_id=project.id, user_id=user.id,
                         model=llm.model, input_summary=question)
    db.commit()

    tools = CopilotTools(db, project, user)
    system = f"{SYSTEM}\n\nToday's date: {datetime.now(timezone.utc).date().isoformat()}. Active project: {project.name}."
    try:
        result = llm.chat_with_tools(system=system, messages=messages, tools=TOOLS, execute=tools.execute,
                                     max_rounds=settings.copilot_max_tool_rounds)
    except Exception as e:
        finish_execution(ex, error=str(e)[:2000])
        db.commit()
        raise

    apply_usage(ex, result.usage)
    calls = [{"tool": c.tool, "input": c.input, "ok": c.ok, "summary": c.summary} for c in result.tool_calls]
    finish_execution(ex, output={"tool_calls": calls, "stop_reason": result.stop_reason})
    reply = CopilotMessage(thread_id=thread.id, role="assistant", content=result.text or "(no answer)",
                           tool_calls=calls, references=list(tools.references.values()), agent_execution_id=ex.id)
    db.add(reply)
    db.commit()
    return reply
