"""AI Business Copilot: answers questions from the project's stored records via explicit tools."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

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
    ProductConcept,
    Recommendation,
    ResearchFinding,
    ResearchRun,
    SalesChannel,
    ShippingOption,
    Supplier,
    User,
    SizeChart,
)
from .. import fit as fit_engine
from ..logistics import PackagingSpec, Shipment, channel_economics, compare_shipping
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
- For "where should I sell" or "how should I ship" questions, use compare_sales_channels and compare_shipping_options; say whether each fee or rate is verified, sourced, or an assumption.
- For sizing and fit, use list_size_charts and recommend_size (a deterministic calculator) - never guess a size. Say whose chart it is and whether it is verified, source-linked or unverified. start_research with kind fit_sizing collects competitor size charts and fit/returns evidence.
- Supplier verification status is set by the founder. Never describe an unverified supplier as vetted, certified or reliable.
- Action tools run the app's steps for this product/category: start_research (market opportunity, competitor discovery, channels & shipping, fit & sizing), save_size_chart, add_competitor / record_competitor_price, add_supplier / add_supplier_quote, draft_supplier_rfq, generate_brand_concept, save_cost_scenario, create_recommendation, generate_decision_brief, record_decision.
- Use an action tool only when the founder asks for that work. Research runs and AI generations cost money (research runs are capped per run); mention this when you start one.
- record_decision is the founder's call: use it only when they explicitly state their go / no-go / on-hold decision, and quote their reason.
- Only say something was done if the tool result returns "ok": true. Research runs execute in the background: report the run id and status, not results you have not seen. You cannot publish listings, buy inventory, launch campaigns, or send messages to suppliers - drafts must be sent by the founder.
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


class StartResearchIn(BaseModel):
    kind: Literal["market_opportunity", "competitor_discovery", "channels_logistics", "fit_sizing", "price_tiers", "compliance"] = "market_opportunity"
    focus: str | None = Field(None, description="What to pay special attention to")
    keywords: list[str] = Field(default_factory=list, description="Shopper search phrases for demand signals (max 3)")


class BrandIn(BaseModel):
    kind: Literal["names", "positioning", "personas", "voice", "collections", "palettes", "messaging"]
    brief: str | None = None


class AddCompetitorIn(BaseModel):
    name: str
    website: str | None = None
    price_tier: Literal["budget", "mid", "premium", "luxury"] | None = None
    positioning: str | None = None
    notes: str | None = None


class PriceIn(BaseModel):
    competitor: str
    product: str
    price: float = Field(gt=0)
    currency: str = "USD"
    source_url: str | None = None


class AddSupplierIn(BaseModel):
    name: str
    country: str | None = None
    city: str | None = None
    platform: str | None = None
    website: str | None = None
    notes: str | None = None


class QuoteIn(BaseModel):
    supplier: str
    product_name: str
    unit_price: float | None = Field(None, ge=0)
    currency: str = "USD"
    moq: int | None = Field(None, ge=0)
    sample_cost: float | None = Field(None, ge=0)
    lead_time_days: int | None = Field(None, ge=0)
    incoterm: str | None = None


class RfqIn(BaseModel):
    supplier: str
    notes: str | None = None


class SizeRowSpec(BaseModel):
    size: str
    labels: dict[str, str] = Field(default_factory=dict, description="Equivalent sizes, e.g. {\"US\": \"6\", \"EU\": \"38\"}")
    measurements: dict[str, list[float]] = Field(description="Body measurement ranges, e.g. {\"bust\": [84, 88], \"foot_length\": [23.5, 23.5]}")


class SaveSizeChartIn(BaseModel):
    name: str
    role: Literal["reference", "supplier", "published"] = Field("supplier", description="reference = a competitor's chart, "
                                                                "supplier = a factory's chart, published = the founder's own size guide")
    garment_type: Literal["dress", "top", "bottom", "bodysuit", "shoes", "other"] = "dress"
    unit: Literal["cm", "in"] = "cm"
    rows: list[SizeRowSpec] = Field(description="Sizes from smallest to largest, exactly as the founder or source gave them")
    stretch_allowance: float = Field(0, ge=0, description="How far above a size's maximum the fabric still fits, in the same unit")
    fit_notes: str | None = None
    source_url: str | None = None


class RecommendSizeIn(BaseModel):
    chart: str | None = Field(None, description="Size chart name or id; defaults to the founder's own size guide, else the first chart")
    measurements: dict[str, float] = Field(description="Body measurements by dimension: height, bust, chest, waist, hip, torso_girth, "
                                                       "inseam, foot_length, foot_width")
    unit: Literal["cm", "in"] = "cm"


class DecisionIn(BaseModel):
    decision: Literal["go", "no_go", "on_hold", "undecided"]
    note: str


class ShippingIn(BaseModel):
    units: int = Field(100, ge=1, le=1_000_000, description="Shipment size in units")
    product_id: str | None = Field(None, description="Product whose carton specs to use; defaults to the first with specs")


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
    ToolSpec("compare_sales_channels", "Sales channels on file with fee structure, fee source/verification and computed per-unit "
             "contribution on each channel (deterministic, from the latest cost scenario).",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("compare_shipping_options", "Freight and fulfillment options on file (quotes, assumptions, sourced benchmarks) with computed "
             "cost per unit and transit time for a shipment size, using a product's carton specs.", ShippingIn.model_json_schema()),
    ToolSpec("start_research", "Start a background research run for this product/category: market_opportunity (demand signals, "
             "market, customers, competitors, sourcing, risks, report), competitor_discovery, channels_logistics, fit_sizing (competitor size "
             "charts, fit complaints, returns policies), price_tiers (budget-to-luxury tiers with quality and customer needs per tier) or "
             "compliance (design patents/IP, labelling, UFLPA; drafts supplier questions). Costs money; capped per run.",
             StartResearchIn.model_json_schema()),
    ToolSpec("research_status", "Status and step progress of the latest research run.",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("list_size_charts", "Size charts on file (your size guide, supplier charts, competitor charts from research) with sizes and "
             "body-measurement ranges in cm, source and verification status.", {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("recommend_size", "Deterministic size recommendation for a customer's body measurements against a size chart, with per-measurement fit.",
             RecommendSizeIn.model_json_schema()),
    ToolSpec("save_size_chart", "Save a size chart the founder provides (e.g. a supplier's chart pasted in chat). Saved as unverified until they check it.",
             SaveSizeChartIn.model_json_schema()),
    ToolSpec("add_competitor", "Add a competitor record.", AddCompetitorIn.model_json_schema()),
    ToolSpec("record_competitor_price", "Record an observed competitor price (creates the competitor/product if needed). Include the source URL.",
             PriceIn.model_json_schema()),
    ToolSpec("add_supplier", "Add a supplier record (always unverified until the founder checks it).", AddSupplierIn.model_json_schema()),
    ToolSpec("add_supplier_quote", "Add a quote to an existing supplier (by name).", QuoteIn.model_json_schema()),
    ToolSpec("draft_supplier_rfq", "Draft (not send) a request-for-quotation email to a supplier, saved in its communication log.",
             RfqIn.model_json_schema()),
    ToolSpec("generate_brand_concept", "Generate and save a brand concept draft (names, positioning, personas, voice, collections, palettes, messaging).",
             BrandIn.model_json_schema()),
    ToolSpec("generate_decision_brief", "Generate an evidence-linked go / no-go recommendation from everything stored for this product.",
             {"type": "object", "properties": {}, "additionalProperties": False}),
    ToolSpec("record_decision", "Record the founder's own go / no_go / on_hold decision with their reason. Only when they explicitly decide.",
             DecisionIn.model_json_schema()),
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

    def t_compare_sales_channels(self, _: dict) -> tuple[dict, str]:
        chans = self.db.scalars(select(SalesChannel).where(SalesChannel.project_id == self.project.id)).all()
        econ = channel_economics(self.db, self.project, list(chans))
        meta = {str(c.id): c for c in chans}
        for r in econ["rows"]:
            c = meta[r["channel_id"]]
            self._ref("channel", c.id, c.name, c.fee_source_url)
            r.update({"requirements": c.requirements, "audience_fit": c.audience_fit, "pros": c.pros, "cons": c.cons})
            r.pop("inputs", None)
        return {"ok": True, **econ, "note": "fee_basis: verified = founder checked the fee page; sourced_research = fee found in a "
                "retrieved source; assumption = unconfirmed."}, f"Compared {len(econ['rows'])} sales channels"

    def t_compare_shipping_options(self, raw: dict) -> tuple[dict, str]:
        args = ShippingIn(**raw)
        options = self.db.scalars(select(ShippingOption).where(ShippingOption.project_id == self.project.id)).all()
        for o in options:
            self._ref("shipping", o.id, o.name, o.source_url)
        q = select(ProductConcept).where(ProductConcept.project_id == self.project.id, ProductConcept.units_per_carton.is_not(None))
        if args.product_id:
            q = q.where(ProductConcept.id == uuid.UUID(args.product_id))
        product = self.db.scalars(q).first()
        fields = ("units_per_carton", "carton_length_cm", "carton_width_cm", "carton_height_cm", "carton_gross_weight_kg")
        if product is None or any(getattr(product, f) is None for f in fields):
            listing = [{"name": o.name, "leg": o.leg, "mode": o.mode, "basis": o.basis, "rate": float(o.rate) if o.rate is not None else None,
                        "rate_high": float(o.rate_high) if o.rate_high is not None else None, "rate_basis": o.rate_basis,
                        "currency": o.currency, "transit_days": [o.transit_days_min, o.transit_days_max], "source_url": o.source_url}
                       for o in options]
            return {"ok": True, "options": listing, "note": "No product has complete carton specs, so per-unit freight was not computed. "
                    "Add carton dimensions/weight to a product in Commerce."}, f"Listed {len(options)} shipping options"
        spec = PackagingSpec(**{f: float(getattr(product, f)) for f in fields})
        result = compare_shipping(list(options), Shipment(units=args.units, packaging=spec))
        return {"ok": True, "product": product.name, **result}, f"Compared shipping for {args.units} units of {product.name}"

    # ---- action tools (each step of the workflow)
    def t_start_research(self, raw: dict) -> tuple[dict, str]:
        from ..research.providers import get_research_provider
        from .opportunity import initial_steps, submit_run

        args = StartResearchIn(**raw)
        provider = get_research_provider(None)
        if not provider.is_configured():
            return {"ok": False, "error": f"{provider.label} is not configured. {provider.config_requirement()}"}, "Research not configured"
        if self.db.scalars(select(ResearchRun).where(ResearchRun.project_id == self.project.id,
                                                     ResearchRun.status.in_(["queued", "running"]))).first():
            return {"ok": False, "error": "A research run is already in progress for this project."}, "Run already in progress"
        params = {k: v for k, v in {"focus": args.focus, "keywords": args.keywords[:3] or None}.items() if v}
        if args.kind == "compliance":
            names = self.db.scalars(select(Supplier.name).where(Supplier.project_id == self.project.id)).all()
            params["suppliers"] = ", ".join(names)[:1000] or "none on file yet"
        run = ResearchRun(project_id=self.project.id, created_by_id=self.user.id, kind=args.kind, status="queued",
                          provider=provider.name, model=get_llm().model, params=params, steps=initial_steps(args.kind))
        self.db.add(run)
        self.db.flush()
        audit.record(self.db, "research_run.started", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="research_run", entity_id=run.id, details={"kind": args.kind, **params})
        self.db.commit()
        submit_run(run.id)
        self._ref("run", run.id, f"{args.kind} research run")
        return {"ok": True, "run_id": str(run.id), "status": "queued", "steps": [s["label"] for s in run.steps],
                "cost_cap_usd": get_settings().max_research_cost_usd}, f"Started {args.kind.replace('_', ' ')} research"

    # ---- sizing & fit
    def _charts(self) -> list[SizeChart]:
        return self.db.scalars(select(SizeChart).where(SizeChart.project_id == self.project.id).order_by(SizeChart.role, SizeChart.created_at)).all()

    def t_list_size_charts(self, _: dict) -> tuple[dict, str]:
        out = []
        for c in self._charts():
            self._ref("size_chart", c.id, c.name, c.source_url)
            out.append({"id": str(c.id), "name": c.name, "role": c.role, "garment_type": c.garment_type, "unit": "cm",
                        "dimensions": c.dimensions, "rows": c.rows, "stretch_allowance_cm": float(c.stretch_allowance_cm or 0),
                        "fit_notes": c.fit_notes, "source_type": c.source_type, "source_url": c.source_url,
                        "verification_status": c.verification_status, "published": c.published, "fit_finder_lookups": c.fit_stats or {}})
        return {"ok": True, "size_charts": out}, f"Listed {len(out)} size charts"

    def t_recommend_size(self, raw: dict) -> tuple[dict, str]:
        args = RecommendSizeIn(**raw)
        charts = self._charts()
        if not charts:
            return {"ok": False, "error": "No size charts on file. Add one on the Sizing & Fit page or ask me to save a chart."}, "No size charts"
        want = (args.chart or "").strip().lower()
        chart = next((c for c in charts if want and (str(c.id) == want or want in c.name.lower())), None) if want else None
        chart = chart or next((c for c in charts if c.role == "published"), None) or charts[0]
        self._ref("size_chart", chart.id, chart.name, chart.source_url)
        result = fit_engine.recommend(chart.rows, args.measurements, stretch_allowance_cm=float(chart.stretch_allowance_cm or 0),
                                      unit=args.unit, fit_notes=chart.fit_notes)
        return {"ok": True, "chart": chart.name, "chart_verification": chart.verification_status, **result}, \
            f"Recommended {result['recommended'] or 'no size'} from {chart.name}"

    def t_save_size_chart(self, raw: dict) -> tuple[dict, str]:
        args = SaveSizeChartIn(**raw)
        rows = fit_engine.normalise_rows([r.model_dump() for r in args.rows], args.unit)
        present = list(dict.fromkeys(d for r in rows for d in r["measurements"]))
        systems = list(dict.fromkeys(s for r in rows for s in r["labels"]))
        c = SizeChart(project_id=self.project.id, created_by_id=self.user.id, name=args.name[:200], role=args.role,
                      garment_type=args.garment_type, dimensions=present or fit_engine.GARMENT_DIMENSIONS[args.garment_type],
                      size_systems=systems, rows=rows, stretch_allowance_cm=round(fit_engine.to_cm(args.stretch_allowance, args.unit), 1),
                      fit_notes=args.fit_notes, source_type="manual", source_url=args.source_url, verification_status="unverified", fit_stats={})
        self.db.add(c)
        self.db.flush()
        audit.record(self.db, "size_chart.created", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="size_chart", entity_id=c.id, details={"name": c.name, "sizes": len(rows)})
        self.db.commit()
        self._ref("size_chart", c.id, c.name, c.source_url)
        return {"ok": True, "size_chart_id": str(c.id), "sizes": len(rows), "verification_status": "unverified"}, f"Saved size chart {c.name}"

    def t_research_status(self, _: dict) -> tuple[dict, str]:
        run = self.db.scalars(select(ResearchRun).where(ResearchRun.project_id == self.project.id).order_by(ResearchRun.created_at.desc())).first()
        if not run:
            return {"ok": True, "run": None}, "No research runs yet"
        return {"ok": True, "run": {"id": str(run.id), "kind": run.kind, "status": run.status, "current_step": run.current_step,
                                    "steps": [{"label": s["label"], "status": s["status"], "error": s.get("error")} for s in run.steps],
                                    "cost_usd": float(run.cost_usd or 0)}}, f"Latest run is {run.status}"

    def _competitor(self, name: str, create: bool = True) -> Competitor | None:
        c = self.db.scalars(select(Competitor).where(Competitor.project_id == self.project.id, Competitor.name.ilike(name.strip()))).first()
        if c is None and create:
            c = Competitor(project_id=self.project.id, name=name.strip()[:200], discovered_by="manual")
            self.db.add(c)
            self.db.flush()
        return c

    def t_add_competitor(self, raw: dict) -> tuple[dict, str]:
        args = AddCompetitorIn(**raw)
        if self._competitor(args.name, create=False):
            return {"ok": False, "error": f"'{args.name}' is already a competitor."}, "Competitor exists"
        c = Competitor(project_id=self.project.id, discovered_by="manual", **args.model_dump())
        self.db.add(c)
        self.db.flush()
        audit.record(self.db, "competitor.created", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="competitor", entity_id=c.id)
        self.db.commit()
        self._ref("competitor", c.id, c.name, c.website)
        return {"ok": True, "id": str(c.id), "name": c.name}, f"Added competitor {c.name}"

    def t_record_competitor_price(self, raw: dict) -> tuple[dict, str]:
        from decimal import Decimal

        from ...models import CompetitorProduct, PriceObservation

        args = PriceIn(**raw)
        c = self._competitor(args.competitor)
        prod = next((p for p in c.products if p.name.lower() == args.product.lower()), None)
        if prod is None:
            prod = CompetitorProduct(competitor_id=c.id, name=args.product[:300], url=args.source_url)
            c.products.append(prod)
            self.db.flush()
        obs = PriceObservation(price=Decimal(str(args.price)), currency=args.currency.upper()[:8], source_url=args.source_url,
                               source_type="manual", verification_status="unverified",
                               note="Recorded via AI copilot from the founder's message" + ("" if args.source_url else " (no source URL given)"))
        prod.price_observations.append(obs)
        audit.record(self.db, "price_observation.created", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="price_observation", details={"competitor": c.name, "product": prod.name, "price": args.price})
        self.db.commit()
        return {"ok": True, "competitor": c.name, "product": prod.name, "price": args.price}, f"Recorded {c.name} price {args.price}"

    def _supplier(self, name: str) -> Supplier | None:
        return self.db.scalars(select(Supplier).where(Supplier.project_id == self.project.id, Supplier.name.ilike(name.strip()))).first()

    def t_add_supplier(self, raw: dict) -> tuple[dict, str]:
        args = AddSupplierIn(**raw)
        if self._supplier(args.name):
            return {"ok": False, "error": f"'{args.name}' already exists."}, "Supplier exists"
        sup = Supplier(project_id=self.project.id, verification_status="unverified", source="manual", **args.model_dump())
        self.db.add(sup)
        self.db.flush()
        audit.record(self.db, "supplier.created", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="supplier", entity_id=sup.id)
        self.db.commit()
        self._ref("supplier", sup.id, sup.name, sup.website)
        return {"ok": True, "id": str(sup.id), "name": sup.name, "verification_status": "unverified"}, f"Added supplier {sup.name}"

    def t_add_supplier_quote(self, raw: dict) -> tuple[dict, str]:
        from decimal import Decimal

        from ...models import SupplierQuote

        args = QuoteIn(**raw)
        sup = self._supplier(args.supplier)
        if sup is None:
            return {"ok": False, "error": f"No supplier named '{args.supplier}'. Add it first."}, "Supplier not found"
        q = SupplierQuote(supplier_id=sup.id, product_name=args.product_name[:300], moq=args.moq, currency=args.currency.upper()[:8],
                          unit_price=Decimal(str(args.unit_price)) if args.unit_price is not None else None,
                          sample_cost=Decimal(str(args.sample_cost)) if args.sample_cost is not None else None,
                          lead_time_days=args.lead_time_days, incoterm=args.incoterm, source="manual",
                          notes="Recorded via AI copilot from the founder's message")
        self.db.add(q)
        self.db.commit()
        return {"ok": True, "id": str(q.id), "supplier": sup.name}, f"Added quote from {sup.name}"

    def t_draft_supplier_rfq(self, raw: dict) -> tuple[dict, str]:
        from ...models import SupplierCommunication
        from .generators import draft_rfq

        args = RfqIn(**raw)
        sup = self._supplier(args.supplier)
        if sup is None:
            return {"ok": False, "error": f"No supplier named '{args.supplier}'."}, "Supplier not found"
        draft, _ex = draft_rfq(self.db, self.project, self.user, sup, None, args.notes)
        comm = SupplierCommunication(supplier_id=sup.id, channel="email", direction="draft", subject=draft.subject,
                                     summary=draft.body, next_action="Review and send this draft yourself.")
        self.db.add(comm)
        self.db.commit()
        return {"ok": True, "supplier": sup.name, "subject": draft.subject, "body": draft.body,
                "note": "Saved as a draft in the supplier's communication log; nothing was sent."}, f"Drafted RFQ for {sup.name}"

    def t_generate_brand_concept(self, raw: dict) -> tuple[dict, str]:
        from .generators import generate_brand

        args = BrandIn(**raw)
        content, ex = generate_brand(self.db, self.project, self.user, args.kind, args.brief)
        concept = BrandConcept(project_id=self.project.id, kind=args.kind, title=f"{args.kind.title()} (via copilot)", content=content,
                               brief=args.brief, agent_execution_id=ex.id)
        self.db.add(concept)
        self.db.commit()
        self._ref("brand", concept.id, concept.title)
        return {"ok": True, "id": str(concept.id), "kind": args.kind, "content": content}, f"Generated {args.kind} concept"

    def t_generate_decision_brief(self, _: dict) -> tuple[dict, str]:
        from .decision import generate

        brief, snap = generate(self.db, self.project, self.user)
        self.db.commit()
        self._ref("decision_brief", snap.id, f"Decision brief: {brief.recommendation}")
        return {"ok": True, "id": str(snap.id), **snap.content}, f"Decision brief: {brief.recommendation.replace('_', ' ')}"

    def t_record_decision(self, raw: dict) -> tuple[dict, str]:
        from ...models import ProjectDecision
        from .decision import evidence_snapshot

        args = DecisionIn(**raw)
        self.project.decision, self.project.decision_note = args.decision, args.note
        self.project.decided_at = datetime.now(timezone.utc)
        self.db.add(ProjectDecision(project_id=self.project.id, user_id=self.user.id, decision=args.decision, note=args.note,
                                    snapshot=evidence_snapshot(self.db, self.project)))
        audit.record(self.db, "decision.recorded", user_id=self.user.id, project_id=self.project.id, actor="agent:copilot",
                     entity_type="project", entity_id=self.project.id, details={"to": args.decision, "note": args.note})
        self.db.commit()
        return {"ok": True, "decision": args.decision}, f"Recorded decision: {args.decision.replace('_', ' ')}"

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
