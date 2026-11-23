"""Opportunity Research Agent + Competitor discovery: a fixed, auditable research workflow.

Each step: (1) gather evidence with the configured research provider, (2) extract structured
findings with the LLM, (3) validate every finding against the evidence the provider actually
returned, (4) persist. Steps are bounded (searches, attempts, cost budget); there is no open-ended loop.
"""

from __future__ import annotations

import logging
import re
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field, create_model
from sqlalchemy import select

from ... import audit
from ...config import get_settings
from ...db import session_scope
from ...models import (
    AgentExecution,
    AnalysisSnapshot,
    BusinessProject,
    Competitor,
    CompetitorProduct,
    CostScenario,
    CustomerSegment,
    EvidenceSource,
    FindingEvidence,
    MarketOpportunity,
    SalesChannel,
    ShippingOption,
    PriceObservation,
    ProductConcept,
    Recommendation,
    ResearchFinding,
    ResearchRun,
    SizeChart,
    Supplier,
    SupplierCommunication,
    SupplierQuote,
)
from .. import demand
from ..llm.anthropic_provider import get_llm
from ..logistics import PackagingSpec, Shipment, channel_economics, compare_shipping
from ..llm.base import LLMError, LLMNotConfigured, LLMRefusal, LLMUsage
from ..research.providers import EvidenceBundle, SourceDoc, get_research_provider
from ..unit_economics import UnitEconomicsInputs, calculate
from .research_schemas import ChannelLogisticsPlan, CompliancePlan, ExtractedFinding, OpportunitySynthesis, StepExtraction
from .size_chart import chart_fields, rows_from_extraction
from .runtime import apply_usage, finish_execution, start_execution, with_retries

log = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="research")

COUNTRY_CODES = {
    "united states": "US", "usa": "US", "us": "US", "u.s.": "US", "america": "US",
    "canada": "CA", "united kingdom": "GB", "uk": "GB", "australia": "AU", "germany": "DE",
    "france": "FR", "japan": "JP", "china": "CN", "mexico": "MX", "spain": "ES", "italy": "IT",
}


def country_code(name: str | None) -> str | None:
    if not name:
        return None
    return COUNTRY_CODES.get(name.strip().lower())


# ----------------------------------------------------------------------------- step definitions

STEP_DEFS: dict[str, dict[str, Any]] = {
    "market_size": {
        "label": "Market size & growth evidence",
        "sections": ["market_size", "growth", "other"],
        "question": (
            "What credible evidence exists about the size and growth of the {category} market in {country}? "
            "If category-specific figures are unavailable, look for the closest broader category and say so explicitly. "
            "Also look for demand indicators such as participation numbers, number of relevant studios/clubs/events, or search interest."
        ),
        "hints": [
            "{category} market size {country}",
            "{category} market growth rate forecast",
            "{category} participation statistics {country}",
            "{category} industry trends {year}",
        ],
    },
    "customers": {
        "label": "Customer segments & unmet needs",
        "sections": ["customer_segments", "unmet_needs", "channels"],
        "question": (
            "Who buys {category} in {country}? Identify distinct customer segments (the founder's hypothesis: {customers}), "
            "what each values, purchase drivers, common complaints and unmet needs (fit, sizing, quality, comfort, price, availability, style), "
            "and where they shop. Use customer reviews, forums and community discussions as evidence where available."
        ),
        "hints": [
            "{category} reviews complaints fit sizing",
            "{category} forum where to buy",
            "{category} for beginners what to wear",
            "best {category} brands reddit",
        ],
    },
    "competitors": {
        "label": "Competitors & pricing",
        "sections": ["competitors", "pricing", "differentiation"],
        "question": (
            "Which brands and retailers sell {category} to customers in {country}? For each, find the website, positioning, "
            "sales channels, and currently listed prices for representative products (with product page URLs). "
            "Prioritise direct competitors around the {price_range} price range, and cover every price tier from budget to "
            "luxury with representative products in each. {focus}"
        ),
        "hints": [
            "{category} brands {country}",
            "{category} online store prices",
            "buy {category} {country}",
            "{category} amazon best sellers",
        ],
    },
    "sourcing": {
        "label": "Sourcing, duties & cost benchmarks",
        "sections": ["sourcing_costs", "regulatory"],
        "question": (
            "What does it cost to manufacture {category} in {sourcing} and import it into {country}? Find evidence for typical "
            "factory unit price ranges and MOQs, sample costs, the likely tariff classification(s) and duty rates "
            "(including any additional tariffs currently applied to goods from {sourcing}), and typical freight cost per unit or per kg. "
            "Cite official sources (tariff schedule, customs agency) for duty rates and say when rates are subject to change."
        ),
        "hints": [
            "{category} manufacturer {sourcing} price MOQ",
            "HTS code {category} duty rate",
            "additional tariffs apparel imports from {sourcing} {year}",
            "air freight vs sea freight cost per kg {sourcing} to {country}",
        ],
    },
    "risks": {
        "label": "Risks, compliance & channels",
        "sections": ["risks", "regulatory", "channels"],
        "question": (
            "What are the main risks and requirements for launching a {category} brand in {country} with a starting budget of about "
            "{budget}? Consider trade-policy and tariff changes, labeling and compliance rules (e.g. fiber content, care labels, "
            "country of origin), seasonality, sizing and returns, marketplace competition, intellectual property, and supplier quality risk."
        ),
        "hints": [
            "textile labeling requirements {country}",
            "{category} return rate sizing issues",
            "{category} seasonality demand",
            "small apparel brand import risks {sourcing}",
        ],
    },
}

STEP_DEFS["demand_signals"] = {
    "label": "Demand & popularity signals",
    "sections": ["demand", "market_size", "growth", "other"],
    "question": (
        "How popular is {category} with shoppers in {country} right now, and is demand growing? Look for concrete signals: "
        "Amazon best-seller ranks, review counts and 'bought in past month' indicators, Google search interest or trend reports, "
        "social media trends (TikTok, Instagram, Pinterest, Xiaohongshu), and seasonality. {focus}"
    ),
    "hints": [
        "{category} best sellers amazon",
        "{category} trend {year}",
        "{category} tiktok trend",
        "{category} search interest seasonality",
    ],
}

STEP_DEFS["channels"] = {
    "label": "Selling channels & current fees",
    "sections": ["channels", "pricing", "other"],
    "question": (
        "Which sales channels are realistic for selling {category} to customers in {country}, and what does each cost a seller today? "
        "Cover the seller's own website (e.g. Shopify), major marketplaces (Amazon, Etsy, eBay, Walmart Marketplace, Target Plus), "
        "warehouse clubs and big-box retail (e.g. Costco, Sam's Club - vendor requirements, minimum volumes, margins), wholesale to "
        "boutiques and department stores (e.g. Faire, direct), social commerce (TikTok Shop, Instagram), and events. For each, find the current official "
        "seller fee schedule for this category (referral/commission %, per-order fees, payment processing, monthly plan fees), "
        "category restrictions or approval requirements, and evidence of how this category's customers buy there. Cite official fee pages "
        "and note the date fees were published or updated."
    ),
    "hints": [
        "Amazon seller fees clothing referral fee {year}",
        "Etsy seller fees transaction fee payment processing",
        "Shopify pricing plans payment processing fees {country}",
        "Walmart Marketplace seller fees referral",
        "how to become a Costco vendor small brand requirements",
        "Faire wholesale fees brands commission",
        "TikTok Shop seller fees {country} {year}",
        "where do dancers buy {category}",
        "{category} wholesale to dance studios",
    ],
}
STEP_DEFS["logistics"] = {
    "label": "Shipping, import & fulfillment",
    "sections": ["logistics", "sourcing_costs", "regulatory", "channels"],
    "question": (
        "How do small brands ship {category} from {sourcing} to {country}, and what does it cost? Find current benchmarks, with dates, "
        "for express courier, air freight and sea freight (LCL/FCL) rates and transit times from {sourcing} to {country}; customs "
        "brokerage and entry costs; the current rules for low-value / de minimis shipments of goods from {sourcing}; and domestic "
        "fulfillment options in {country} (self-fulfillment postage, 3PL pick-pack-ship fees, marketplace fulfillment fees). Cite sources."
    ),
    "hints": [
        "air freight rate per kg {sourcing} to {country} {year}",
        "LCL sea freight cost per cbm {sourcing} to {country}",
        "express courier rates small business import {sourcing} to {country}",
        "de minimis rule imports from {sourcing} {year}",
        "3PL pick and pack fees apparel {country}",
        "customs broker fee small import {country}",
    ],
}

STEP_DEFS["fit_charts"] = {
    "label": "Size charts & size systems",
    "sections": ["fit", "competitors", "unmet_needs"],
    "question": (
        "Find published size charts for {category} sold to customers in {country}, from brands and retailers (and from {sourcing} "
        "manufacturers selling abroad). For each chart, record the size labels, the size systems shown (US, EU, UK, CN, etc.) and the "
        "BODY measurements per size (e.g. bust, waist, hip, height or torso girth for clothing; foot length and width for shoes), plus "
        "the size range offered (petite, plus, children) and any sizing advice the brand gives (e.g. 'runs small', 'size up for "
        "stretch-free styles'). Prefer official size-guide pages. {focus}"
    ),
    "hints": [
        "{category} size chart",
        "{category} size guide cm inches",
        "{category} size chart bust waist hip",
        "{category} size conversion US EU {sourcing}",
        "how to choose size {category}",
    ],
}
STEP_DEFS["fit_experience"] = {
    "label": "Fit problems, returns & fit services",
    "sections": ["fit", "unmet_needs", "risks", "differentiation"],
    "question": (
        "What fit and sizing problems do customers report when buying {category} online in {country} (including products made in "
        "{sourcing})? How do sellers handle size exchanges and returns (policies, fees, time limits), and which offer made-to-measure, "
        "custom sizing, alterations, size-finder tools or fit consultations? What how-to-measure guidance do they give? "
        "Use reviews, forums and official policy pages as evidence. {focus}"
    ),
    "hints": [
        "{category} runs small sizing reviews",
        "{category} return policy size exchange",
        "{category} made to measure custom sizing",
        "how to measure for {category}",
        "{category} fit problems reddit",
    ],
}

STEP_DEFS["price_tiers"] = {
    "label": "Price tiers & customer needs",
    "sections": ["pricing", "customer_segments", "unmet_needs", "competitors"],
    "question": (
        "How is {category} priced and positioned in {country}, from budget to luxury? Using real listings - Amazon Best Sellers "
        "and top search results, Etsy best sellers and top shops, Google Shopping, and brand or department-store sites - split the "
        "market into price tiers (budget, mid-range, premium, luxury/designer). For each tier give the typical price range, 2-4 "
        "representative products with listed prices and URLs, the materials, construction and quality differences, who buys at "
        "that tier and why, and what customers praise and complain about in reviews. {focus}"
    ),
    "hints": [
        "{category} amazon best sellers",
        "{category} etsy best seller handmade",
        "luxury designer {category} price",
        "{category} reviews cheap quality complaints",
        "premium {category} materials quality",
    ],
}
STEP_DEFS["supplier_listings"] = {
    "label": "Supplier listings & factory prices",
    "sections": ["sourcing_costs", "risks"],
    "question": (
        "What do manufacturers and wholesalers in {sourcing} list for {category} on B2B marketplaces - Alibaba.com, 1688.com, "
        "Made-in-China.com, Global Sources and DHgate? Find 6-10 specific supplier listings for products like this, each with the "
        "supplier or store name, listing URL, unit price range, minimum order quantity (MOQ), price breaks by quantity, customisation "
        "options (custom fabric, logo, packaging), sample availability, lead time, and seller signals (years on platform, verified "
        "supplier, trade assurance, ratings). {focus}"
    ),
    "hints": [
        "site:alibaba.com {category} wholesale",
        "{category} manufacturer alibaba price MOQ",
        "site:made-in-china.com {category}",
        "{category} 1688 wholesale price",
        "{category} OEM custom logo factory {sourcing}",
    ],
}
STEP_DEFS["design_ip"] = {
    "label": "Design patents, trademarks & IP",
    "sections": ["regulatory", "risks"],
    "question": (
        "Could selling {category} infringe a design patent, trademark or trade dress in {country}? Search for US design patents "
        "(USPTO, Google Patents) on similar product designs - record patent numbers, titles, owners, grant dates and links - and "
        "for registered trademarks or distinctive brand designs in this category. Note that US design patents filed on or after "
        "May 13, 2015 last 15 years from grant. Flag well-known brand designs a small seller should not copy. {focus}"
    ),
    "hints": [
        "{category} design patent USPTO",
        "{category} design patent google patents",
        "{category} trademark knock-off lawsuit",
        "{category} trade dress infringement",
    ],
}
STEP_DEFS["labeling"] = {
    "label": "Labelling & product rules",
    "sections": ["regulatory", "risks"],
    "question": (
        "What labelling and product-safety rules apply to selling {category} in {country}? Cover fiber-content, country-of-origin "
        "and manufacturer-identity (RN) labelling under the Textile Fiber Products Identification Act and FTC rules, care labelling, "
        "rules that apply if marketed to children (CPSIA, tracking labels, testing), California Proposition 65, flammability, and "
        "marketplace requirements (e.g. Amazon). Cite official FTC, CPSC and CBP pages."
    ),
    "hints": [
        "FTC textile labeling requirements fiber content country of origin",
        "FTC care labeling rule",
        "RN number textile manufacturer identification",
        "CPSIA children's accessories requirements",
        "Amazon apparel accessories compliance requirements",
    ],
}
STEP_DEFS["uflpa"] = {
    "label": "Forced labour (UFLPA) & import rules",
    "sections": ["regulatory", "risks", "sourcing_costs"],
    "question": (
        "What does the Uyghur Forced Labor Prevention Act (UFLPA) mean for importing {category} made in {sourcing} into {country}? "
        "Cover the rebuttable presumption for goods made wholly or partly in Xinjiang or by listed entities, which materials are "
        "high-risk (e.g. cotton), the supply-chain tracing documents CBP expects from importers, how detentions work, and the "
        "current UFLPA Entity List. Check whether any of these suppliers appear on it: {suppliers}. Cite DHS and CBP pages."
    ),
    "hints": [
        "UFLPA entity list DHS",
        "UFLPA importer guidance supply chain tracing documentation CBP",
        "UFLPA cotton apparel detentions",
        "UFLPA high priority sectors",
    ],
}

RUN_STEPS = {
    "market_opportunity": ["demand_signals", "market_size", "customers", "competitors", "sourcing", "risks", "synthesis"],
    "channels_logistics": ["channels", "logistics", "plan"],
    "competitor_discovery": ["competitors"],
    "fit_sizing": ["fit_charts", "fit_experience"],
    "price_tiers": ["price_tiers"],
    "supplier_listings": ["supplier_listings"],
    "compliance": ["design_ip", "labeling", "uflpa", "compliance_plan"],
}

STEP_LABELS = {k: v["label"] for k, v in STEP_DEFS.items()} | {
    "synthesis": "Opportunity report synthesis",
    "plan": "Channel & logistics plan",
    "compliance_plan": "Compliance checklist & supplier questions",
}
SYNTHESIS_STEP = {"market_opportunity": "synthesis", "channels_logistics": "plan", "compliance": "compliance_plan"}
STEP_AGENT = {"competitors": "competitor_intelligence", "channels": "commerce", "logistics": "sourcing", "demand_signals": "analytics",
              "fit_charts": "fit", "fit_experience": "fit", "price_tiers": "competitor_intelligence",
              "design_ip": "sourcing", "labeling": "sourcing", "uflpa": "sourcing", "supplier_listings": "sourcing"}


# Each step asks for findings, gaps and only the record list it fills, with its own section choices. One schema with
# every list is too large for the API to compile into a constrained grammar.
STEP_RECORDS = {"customers": "segments", "competitors": "competitors", "channels": "channels", "logistics": "shipping_benchmarks",
                "fit_charts": "size_charts", "price_tiers": "price_tiers", "supplier_listings": "supplier_listings"}
_RECORD_LISTS = ("findings", "segments", "competitors", "channels", "shipping_benchmarks", "size_charts", "price_tiers",
                 "supplier_listings", "evidence_gaps")
_step_models: dict[str, type[BaseModel]] = {}


def step_output_model(step_key: str) -> type[BaseModel]:
    if step_key not in _step_models:
        sections = tuple(dict.fromkeys([*STEP_DEFS[step_key]["sections"], "other"]))
        finding = create_model(f"Finding_{step_key}", __base__=ExtractedFinding, section=(Literal[sections], ...))
        fields: dict[str, Any] = {"findings": (list[finding], ...)}
        if rec := STEP_RECORDS.get(step_key):
            fields[rec] = (StepExtraction.model_fields[rec].annotation, ...)
        fields["evidence_gaps"] = (list[str], StepExtraction.model_fields["evidence_gaps"])
        _step_models[step_key] = create_model(f"Extraction_{step_key}", **fields)
    return _step_models[step_key]


def to_step_extraction(out: BaseModel) -> StepExtraction:
    return StepExtraction.model_validate({**{k: [] for k in _RECORD_LISTS}, **out.model_dump()})


def initial_steps(kind: str) -> list[dict[str, Any]]:
    return [
        {"key": k, "label": STEP_LABELS[k], "status": "pending", "attempts": 0, "error": None,
         "started_at": None, "finished_at": None, "findings_count": 0, "sources_count": 0}
        for k in RUN_STEPS[kind]
    ]


def _fmt_money(v: Any) -> str:
    return f"${float(v):,.0f}" if v is not None else "an unspecified amount"


def project_context(project: BusinessProject, params: dict[str, Any]) -> dict[str, str]:
    pmin, pmax = project.price_min, project.price_max
    price_range = f"${float(pmin):.0f}-${float(pmax):.0f}" if pmin is not None and pmax is not None else "target"
    return {
        "category": params.get("category") or project.product_category,
        "country": params.get("geography") or project.target_country,
        "sourcing": project.sourcing_country or "the sourcing region",
        "budget": _fmt_money(params.get("budget_usd", project.budget_usd)),
        "customers": project.target_customers or "not specified",
        "price_range": price_range,
        "year": str(datetime.now(timezone.utc).year),
        "focus": (f"Additional focus from the user: {params['focus']}" if params.get("focus") else ""),
        "suppliers": params.get("suppliers") or "none on file yet",
    }


def context_block(ctx: dict[str, str]) -> str:
    return (
        f"Product category: {ctx['category']}\nTarget market: {ctx['country']}\nSourcing region: {ctx['sourcing']}\n"
        f"Starting budget: {ctx['budget']}\nHypothesised customers: {ctx['customers']}\n"
        f"Price hypothesis: {ctx['price_range']}\nToday: {datetime.now(timezone.utc).date().isoformat()}\n"
        "Note: the customers and price range are the founder's untested assumptions, not facts."
    )


# ----------------------------------------------------------------------------- validation

_NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'").replace("“", '"').replace("”", '"')).strip().lower()


def _numbers(s: str) -> set[str]:
    out = set()
    for m in _NUM_RE.findall(s or ""):
        n = m.replace(",", "").rstrip(".")
        if len(n.replace(".", "")) >= 2:
            out.add(n)
    return out


def validate_finding(f: ExtractedFinding, bundle: EvidenceBundle) -> dict[str, Any]:
    """Enforce evidence rules on a model-extracted finding. Returns normalized fields + flags."""
    refs = bundle.by_ref()
    valid_refs = [r for r in dict.fromkeys(f.source_refs) if r in refs]
    invalid_refs = [r for r in f.source_refs if r not in refs]
    flags: list[str] = []
    evidence_type, confidence, status = f.evidence_type, f.confidence, "unverified"
    quote: str | None = None

    if invalid_refs:
        flags.append(f"Ignored citations to non-existent sources: {', '.join(invalid_refs)}")

    if evidence_type == "sourced":
        if not valid_refs:
            evidence_type, confidence = "ai_inference", "low"
            flags.append("Labelled as sourced but cited no retrieved source - downgraded to AI inference.")
        else:
            excerpts = [ex for r in valid_refs for ex in refs[r].excerpts]
            haystack = _norm(" ".join(excerpts)).replace(",", "")
            ok = True
            if not excerpts:
                ok = False
                flags.append("No excerpt was captured for the cited source(s); open the link to verify.")
                if confidence == "high":
                    confidence = "medium"
            claim_numbers = _numbers(f.claim) | (_numbers(f.supporting_quote or ""))
            missing = [n for n in claim_numbers if n not in haystack]
            if excerpts and missing:
                ok = False
                confidence = "low"
                flags.append(f"Figure(s) {', '.join(sorted(missing))} not found in the retrieved excerpts - verify before relying on this.")
            if f.supporting_quote:
                if excerpts and _norm(f.supporting_quote).replace(",", "") in haystack:
                    quote = f.supporting_quote
                elif excerpts:
                    ok = False
                    flags.append("Supporting quote does not appear verbatim in the retrieved excerpts.")
            status = "source_linked" if ok else "unverified"

    return {
        "evidence_type": evidence_type,
        "confidence": confidence,
        "verification_status": status,
        "valid_refs": valid_refs,
        "quote": quote,
        "flags": flags,
    }


def _price_in_excerpts(price: float, excerpts: list[str]) -> bool:
    hay = " ".join(excerpts).replace(",", "")
    candidates = {f"{price:.2f}", f"{price:g}", str(int(price)) if price == int(price) else f"{price:.2f}"}
    return any(c in hay for c in candidates)


# ----------------------------------------------------------------------------- persistence


def _persist_sources(db, run: ResearchRun, bundle: EvidenceBundle) -> dict[str, uuid.UUID]:
    ref_to_id: dict[str, uuid.UUID] = {}
    now = datetime.now(timezone.utc)
    for s in bundle.sources:
        src = EvidenceSource(
            project_id=run.project_id,
            research_run_id=run.id,
            url=s.url,
            title=s.title,
            domain=s.domain,
            source_type="api" if s.provider else "web_search" if bundle.provider == "anthropic_web_search" else "api",
            provider=s.provider or bundle.provider,
            retrieved_at=now,
            published_hint=s.page_age,
            excerpts=s.excerpts,
        )
        db.add(src)
        db.flush()
        ref_to_id[s.ref] = src.id
    return ref_to_id


def _persist_extraction(db, run: ResearchRun, step_key: str, bundle: EvidenceBundle, ext: StepExtraction) -> dict[str, int]:
    ref_to_id = _persist_sources(db, run, bundle)
    refs = bundle.by_ref()
    allowed_sections = set(STEP_DEFS[step_key]["sections"]) if step_key in STEP_DEFS else None
    n_findings = 0

    for f in ext.findings:
        v = validate_finding(f, bundle)
        section = f.section if (allowed_sections is None or f.section in allowed_sections) else "other"
        finding = ResearchFinding(
            project_id=run.project_id,
            research_run_id=run.id,
            section=section,
            claim=f.claim,
            detail=f.detail,
            evidence_type=v["evidence_type"],
            confidence=v["confidence"],
            verification_status=v["verification_status"],
            metric=f.metric.model_dump() if f.metric else None,
            flags=v["flags"],
            created_by="competitor_intelligence_agent" if run.kind == "competitor_discovery" else "opportunity_research_agent",
        )
        for r in v["valid_refs"]:
            finding.evidence_links.append(FindingEvidence(evidence_source_id=ref_to_id[r], quote=v["quote"]))
        db.add(finding)
        n_findings += 1

    for seg in ext.segments:
        valid = [r for r in seg.source_refs if r in refs]
        etype = seg.evidence_type if (seg.evidence_type != "sourced" or valid) else "ai_inference"
        db.add(
            CustomerSegment(
                project_id=run.project_id,
                research_run_id=run.id,
                name=seg.name[:200],
                description=seg.description,
                needs=seg.needs,
                unmet_needs=seg.unmet_needs,
                size_indicator=seg.size_indicator,
                evidence_type=etype,
                confidence=seg.confidence if etype == seg.evidence_type else "low",
                source_ids=[str(ref_to_id[r]) for r in valid],
            )
        )

    dropped_prices = 0
    for c in ext.competitors:
        valid = [r for r in c.source_refs if r in refs]
        existing = db.scalars(
            select(Competitor).where(Competitor.project_id == run.project_id, Competitor.name.ilike(c.name.strip()))
        ).first()
        comp = existing or Competitor(project_id=run.project_id, name=c.name.strip()[:200], discovered_by="ai_research")
        if existing is None:
            db.add(comp)
        comp.website = comp.website or c.website
        comp.positioning = comp.positioning or c.positioning
        if c.price_tier != "unknown" and not comp.price_tier:
            comp.price_tier = c.price_tier
        comp.channels = sorted(set((comp.channels or []) + c.channels))
        if valid and not comp.evidence_source_id:
            comp.evidence_source_id = ref_to_id[valid[0]]
        db.flush()
        for p in c.prices:
            src = refs.get(p.source_ref)
            if src is None:
                dropped_prices += 1  # never store a price without a retrieved source
                continue
            product = next((x for x in comp.products if x.name.lower() == p.product_name.lower()), None)
            if product is None:
                product = CompetitorProduct(competitor_id=comp.id, name=p.product_name[:300], url=p.product_url)
                comp.products.append(product)
                db.flush()
            linked = _price_in_excerpts(p.price, src.excerpts)
            product.price_observations.append(
                PriceObservation(
                    price=Decimal(str(p.price)),
                    currency=p.currency.upper()[:8],
                    source_url=p.product_url or src.url,
                    source_type="web_search" if bundle.provider == "anthropic_web_search" else "api",
                    evidence_source_id=ref_to_id[p.source_ref],
                    verification_status="source_linked" if linked else "unverified",
                    note=None if linked else "Price not found verbatim in the retrieved excerpt - check the source page.",
                )
            )

    dropped_fees, dropped_rates = _persist_channels_and_shipping(db, run, bundle, ext, ref_to_id)
    dropped_sizes = _persist_size_charts(db, run, bundle, ext, ref_to_id)
    dropped_prices += _persist_price_tiers(db, run, bundle, ext)
    dropped_prices += _persist_supplier_listings(db, run, bundle, ext)

    if ext.evidence_gaps or dropped_prices or dropped_fees or dropped_rates or dropped_sizes:
        gaps = list(ext.evidence_gaps)
        if dropped_prices:
            gaps.append(f"{dropped_prices} price(s) were discarded because they could not be tied to a retrieved source.")
        if dropped_fees:
            gaps.append(f"{dropped_fees} channel fee value(s) were left blank because they did not appear in the cited source excerpt.")
        if dropped_rates:
            gaps.append(f"{dropped_rates} shipping rate benchmark(s) were discarded because the rate did not appear in a retrieved source.")
        if dropped_sizes:
            gaps.append(f"{dropped_sizes} size-chart measurement(s) were discarded because they did not appear in the cited source excerpt.")
        for g in gaps:
            db.add(
                ResearchFinding(
                    project_id=run.project_id,
                    research_run_id=run.id,
                    section="other",
                    claim=g,
                    evidence_type="unavailable",
                    confidence="low",
                    verification_status="unverified",
                    flags=[],
                    created_by="opportunity_research_agent",
                )
            )
            n_findings += 1

    return {"findings": n_findings, "sources": len(bundle.sources)}


def _number_in(value: float, excerpts: list[str]) -> bool:
    return _price_in_excerpts(value, excerpts) or f"{value:g}" in " ".join(excerpts).replace(",", "")


def _persist_channels_and_shipping(db, run: ResearchRun, bundle: EvidenceBundle, ext: StepExtraction,
                                   ref_to_id: dict[str, uuid.UUID]) -> tuple[int, int]:
    """Store channel fee profiles and freight benchmarks. A number is kept only if it appears in the cited excerpt."""
    refs = bundle.by_ref()
    today = datetime.now(timezone.utc).date()
    dropped_fees = dropped_rates = 0
    fee_fields = ("commission_pct", "per_order_fee", "payment_fee_pct", "payment_fee_fixed", "monthly_fee")

    for c in ext.channels:
        src = refs.get(c.fee_source_ref or "")
        kept: dict[str, Decimal] = {}
        for field in fee_fields:
            v = getattr(c, field)
            if v is None:
                continue
            if src and _number_in(v, src.excerpts):
                kept[field] = Decimal(str(v))
            else:
                dropped_fees += 1
        existing = db.scalars(select(SalesChannel).where(SalesChannel.project_id == run.project_id,
                                                         SalesChannel.name.ilike(c.name.strip()))).first()
        ch = existing or SalesChannel(project_id=run.project_id, name=c.name.strip()[:200], channel_type=c.channel_type,
                                      platform=c.platform, status="considering", research_run_id=run.id)
        if existing is None:
            db.add(ch)
        ch.requirements = ch.requirements or c.requirements
        ch.audience_fit = ch.audience_fit or c.audience_fit
        # Never overwrite fees the user has verified.
        if kept and ch.fee_basis != "verified":
            for field, v in kept.items():
                setattr(ch, field, v)
            ch.fee_basis = "sourced_research"
            ch.fee_source_url = src.url
            ch.fees_checked_at = today
            ch.evidence_source_id = ref_to_id[c.fee_source_ref]
        elif not kept and existing is None:
            ch.notes = "Fees not confirmed by a retrieved source - check the platform's fee page."

    for b in ext.shipping_benchmarks:
        src = refs.get(b.source_ref)
        values = [v for v in (b.rate_low, b.rate_high) if v is not None]
        if src is None or not values or not all(_number_in(v, src.excerpts) for v in values):
            dropped_rates += 1
            continue
        low = b.rate_low if b.rate_low is not None else b.rate_high
        db.add(ShippingOption(
            project_id=run.project_id, research_run_id=run.id, evidence_source_id=ref_to_id[b.source_ref],
            name=f"{b.mode.replace('_', ' ').title()} benchmark ({src.domain or 'source'})"[:200], leg=b.leg, mode=b.mode,
            origin=b.origin, destination=b.destination, rate_basis=b.rate_basis, rate=Decimal(str(low)),
            rate_high=Decimal(str(b.rate_high)) if b.rate_high is not None and b.rate_high != low else None,
            currency=b.currency.upper()[:8], transit_days_min=b.transit_days_min, transit_days_max=b.transit_days_max,
            basis="sourced_research", source_url=src.url,
            notes=f"Benchmark as of {b.as_of or 'date not stated'}. {b.notes or ''} Get a real forwarder quote before ordering.".strip(),
        ))
    return dropped_fees, dropped_rates


def _persist_size_charts(db, run: ResearchRun, bundle: EvidenceBundle, ext: StepExtraction, ref_to_id: dict[str, uuid.UUID]) -> int:
    """Store competitor size charts as reference charts. A measurement is kept only if it appears in the cited excerpt."""
    refs = bundle.by_ref()
    dropped = 0
    for chart in ext.size_charts:
        src = refs.get(chart.source_ref or "")
        if src is None:
            dropped += sum(len(r.measurements) for r in chart.rows)
            continue
        rows, lost = rows_from_extraction(chart, keep=lambda v, ex=src.excerpts: _number_in(v, ex))
        dropped += lost
        if not rows:
            continue
        try:
            fields = chart_fields(chart, rows)
        except ValueError:
            dropped += sum(len(r["measurements"]) for r in rows)
            continue
        who = chart.brand_or_seller or src.domain or "source"
        db.add(SizeChart(
            project_id=run.project_id, created_by_id=run.created_by_id, name=f"{who} - {chart.product_type}"[:200], role="reference",
            source_type="research", source_url=src.url, retrieved_at=datetime.now(timezone.utc).date(),
            verification_status="source_linked", evidence_source_id=ref_to_id[chart.source_ref], research_run_id=run.id, **fields,
        ))
    return dropped


class ShopperKeywords(BaseModel):
    keywords: list[str] = Field(description="2-3 short generic phrases (2-5 words) shoppers actually type on Amazon or Google "
                                            "for this category; no brand names, no parentheses")


def _shopper_keywords(run_id: uuid.UUID, ctx: dict[str, str], llm, usage: LLMUsage) -> list[str]:
    """Demand APIs need what shoppers type, not a long category description. Saved on the run so a resume reuses them."""
    fallback = [re.sub(r"\s*\(.*?\)", "", ctx["category"]).strip()[:80] or ctx["category"][:80]]
    try:
        out, u = llm.structured(system="You choose search phrases for measuring shopper demand.", output_model=ShopperKeywords, max_tokens=1000,
                                prompt=f"Category: {ctx['category']}\nMarket: {ctx['country']}\nFocus: {ctx.get('focus') or 'none'}")
        usage.add(u)
        _add_run_usage(run_id, u)
        kws = [k.strip()[:80] for k in out.keywords if k.strip()][:3] or fallback
    except LLMError as e:
        log.warning("Keyword suggestion failed, using the category: %s", e)
        kws = fallback
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        run.params = {**(run.params or {}), "keywords": kws, "keywords_source": "ai_suggested"}
    return kws


def _persist_price_tiers(db, run: ResearchRun, bundle: EvidenceBundle, ext: StepExtraction) -> int:
    """Save the price-tier breakdown. Example prices are kept only when they appear in the cited excerpt; a tier's range is
    kept when its numbers appear in the tier's sources, otherwise it is derived from the kept examples."""
    if not ext.price_tiers:
        return 0
    refs = bundle.by_ref()
    order = {"budget": 0, "mid": 1, "premium": 2, "luxury": 3}
    dropped, tiers = 0, []
    for t in sorted(ext.price_tiers, key=lambda t: order[t.tier]):
        examples = []
        for e in t.examples:
            src = refs.get(e.source_ref)
            if src and _price_in_excerpts(e.price, src.excerpts):
                examples.append({"product": e.product_name, "price": e.price, "currency": e.currency.upper()[:8],
                                 "url": e.product_url or src.url, "source_url": src.url})
            else:
                dropped += 1
        srcs = [refs[r] for r in t.source_refs if r in refs]
        excerpts = [x for s in srcs for x in s.excerpts] + [x for e in t.examples if e.source_ref in refs for x in refs[e.source_ref].excerpts]
        stated = [v for v in (t.price_low, t.price_high) if v is not None]
        if stated and all(_price_in_excerpts(v, excerpts) for v in stated):
            low, high, basis = min(stated), max(stated), "sourced"
        elif examples:
            low, high, basis = min(e["price"] for e in examples), max(e["price"] for e in examples), "from_examples"
        else:
            low = high = None
            basis = "unavailable"
        tiers.append({
            "tier": t.tier, "price_low": low, "price_high": high, "range_basis": basis, "currency": t.currency.upper()[:8],
            "materials_and_quality": t.materials_and_quality, "buyer_profile": t.buyer_profile, "customer_needs": t.customer_needs,
            "complaints": t.complaints, "examples": examples, "evidence_type": "sourced" if srcs else "ai_inference",
            "sources": [{"url": s.url, "title": s.title} for s in srcs],
        })
    db.add(AnalysisSnapshot(project_id=run.project_id, kind="price_tiers",
                            content={"tiers": tiers, "research_run_id": str(run.id), "generated_at": datetime.now(timezone.utc).isoformat()}))
    return dropped


PLATFORM = {"alibaba": "alibaba", "1688": "1688"}
PLATFORM_LABEL = {"alibaba": "Alibaba.com", "1688": "1688.com", "made_in_china": "Made-in-China.com", "global_sources": "Global Sources",
                  "dhgate": "DHgate", "other": "a B2B marketplace"}


def _persist_supplier_listings(db, run: ResearchRun, bundle: EvidenceBundle, ext: StepExtraction) -> int:
    """Save B2B listings as unverified suppliers with a listing-price quote. Numbers are kept only if they appear in the excerpt."""
    refs = bundle.by_ref()
    today = datetime.now(timezone.utc).date()
    dropped = 0
    for li in ext.supplier_listings:
        src = refs.get(li.source_ref)
        if src is None:
            dropped += 1
            continue
        low = li.price_low if li.price_low is not None and _price_in_excerpts(li.price_low, src.excerpts) else None
        high = li.price_high if li.price_high is not None and _price_in_excerpts(li.price_high, src.excerpts) else None
        moq = li.moq if li.moq is not None and _number_in(li.moq, src.excerpts) else None
        lead = li.lead_time_days if li.lead_time_days is not None and _number_in(li.lead_time_days, src.excerpts) else None
        dropped += sum(v is not None for v in (li.price_low, li.price_high, li.moq, li.lead_time_days)) - sum(v is not None for v in (low, high, moq, lead))
        if low is None and high is None and moq is None:
            continue
        where = PLATFORM_LABEL[li.platform]
        name = li.supplier_name.strip()
        if not name or re.search(r"unnamed|unknown|not shown|not stated|n/a", name, re.I):
            # No seller name in the source: keep each listing separate rather than merging strangers into one supplier.
            name = f"{where} listing: {li.product_title.strip()[:80]}"
        name = name[:300]
        sup = db.scalars(select(Supplier).where(Supplier.project_id == run.project_id, Supplier.name.ilike(name))).first()
        if sup is None:
            sup = Supplier(project_id=run.project_id, name=name, country=None, platform=PLATFORM.get(li.platform, "other"),
                           website=li.listing_url or src.url, source="research", verification_status="unverified",
                           capabilities=li.customization[:10],
                           notes=(f"Found by research on {where}. " + (f"Seller signals as listed: {'; '.join(li.seller_signals)}. " if li.seller_signals else "")
                                  + "Not verified - check the store, ask for samples and documents.")[:2000])
            db.add(sup)
            db.flush()
        price = low if low is not None else high
        rng = f"{li.currency.upper()} {low:g}-{high:g}" if low is not None and high is not None and low != high else (f"{li.currency.upper()} {price:g}" if price is not None else "not shown")
        db.add(SupplierQuote(
            supplier_id=sup.id, product_name=li.product_title[:300], moq=moq, unit_price=Decimal(str(price)) if price is not None else None,
            currency=li.currency.upper()[:8], lead_time_days=lead, quote_date=today, source="research_listing",
            notes=f"Listed price {rng} per unit on {where} (a listing price, not a quote). Source: {li.listing_url or src.url}"[:2000],
        ))
    return dropped


def _persist_demand(db, run: ResearchRun, keywords: list[str], geo: str) -> tuple[int, dict[str, Any]]:
    """Collect SerpApi popularity data (Google Trends, Amazon, Google Shopping) and store it as sourced findings."""
    if not demand.configured():
        db.add(ResearchFinding(
            project_id=run.project_id, research_run_id=run.id, section="demand", evidence_type="unavailable", confidence="low",
            verification_status="unverified", flags=[], created_by="analytics_agent",
            claim="Google Trends and Amazon search data were not collected: no SerpApi key is connected (Settings > Data sources). "
                  "Demand evidence below comes from web search only.",
        ))
        return 1, {"serpapi": "not_connected"}
    obs, errors, calls = demand.collect(keywords, geo)
    now = datetime.now(timezone.utc)
    n = 0
    for o in obs:
        src = EvidenceSource(project_id=run.project_id, research_run_id=run.id, url=o.url, title=o.title,
                             domain=o.url.split("/")[2] if "//" in o.url else None, source_type="api", provider="serpapi",
                             retrieved_at=now, excerpts=o.excerpts)
        db.add(src)
        db.flush()
        for f in o.findings:
            finding = ResearchFinding(
                project_id=run.project_id, research_run_id=run.id, section="demand", claim=f.claim, detail=f.detail,
                evidence_type="sourced", confidence=f.confidence, verification_status="source_linked", metric=f.metric,
                flags=["Computed directly from SerpApi data at retrieval time (not written by the AI)."], created_by="analytics_agent",
            )
            finding.evidence_links.append(FindingEvidence(evidence_source_id=src.id, quote=o.excerpts[0][:500]))
            db.add(finding)
            n += 1
    if errors:
        db.add(ResearchFinding(
            project_id=run.project_id, research_run_id=run.id, section="demand", evidence_type="unavailable", confidence="low",
            verification_status="unverified", flags=errors[:5], created_by="analytics_agent",
            claim=f"{len(errors)} SerpApi request(s) failed; some popularity data is missing.",
        ))
        n += 1
    return n, {"serpapi_calls": calls, "keywords": keywords, "errors": errors}


# ----------------------------------------------------------------------------- prompts

EXTRACT_SYSTEM = """You convert a research evidence dossier into structured findings for a business intelligence database.
Hard rules:
- Use ONLY the dossier. Do not add facts, numbers, brands, prices, or quotes from memory.
- evidence_type "sourced" only when a dossier excerpt directly supports the claim; cite its refs (e.g. "S3") and copy a short supporting_quote verbatim from that excerpt.
- Research notes are an analyst's summary; treat a statement as sourced only if a cited excerpt backs it.
- Your own analysis must be labelled "ai_inference". Untested business premises are "assumption".
- When the dossier lacks something important (e.g. no category-specific market size), add a finding with evidence_type "unavailable" stating what was not found.
- Prices: include only prices visible in an excerpt, with that excerpt's ref. Never infer a price.
- Confidence reflects source quality and directness: official statistics/primary sources = high; reputable secondary = medium; vendor blogs, teasers, forum posts, or old data = low.
- Keep claims specific and short. Prefer 5-15 high-value findings over many trivial ones."""

SYNTH_SYSTEM = """You are a senior strategy advisor writing an evidence-linked market opportunity assessment for a small founder.
Rules:
- Base conclusions on the findings provided; reference them by F-ref (e.g. "F4"). Distinguish what evidence shows from your judgment.
- If evidence is thin or missing, say so and choose "insufficient_evidence" or "mixed" rather than guessing.
- Unit economics inputs: use basis "sourced_research" only when an F-ref finding labelled sourced supports the value; otherwise basis "assumption" with a note explaining the assumption. Never present an assumption as a fact.
- Duty rates and tariffs change: if unsure, use an assumption and say the founder must confirm with a customs broker.
- Be direct and practical: what to test next, with the cheapest experiments first. The founder's budget is limited."""


def _extraction_prompt(step_key: str, ctx: dict[str, str], bundle: EvidenceBundle) -> str:
    sections = ", ".join(STEP_DEFS[step_key]["sections"])
    record_instructions = {
        "segments": "Populate segments with distinct customer segments.",
        "competitors": "Populate competitors with each brand/retailer found, including only prices visible in excerpts.",
        "channels": "Populate channels with each selling channel; fill fee fields only with numbers stated in the fee_source_ref excerpt, otherwise null.",
        "shipping_benchmarks": "Populate shipping_benchmarks only with rates stated in an excerpt, with that excerpt as source_ref.",
        "size_charts": "Populate size_charts with each size chart visible in an excerpt, copying every measurement exactly as printed, with that excerpt as source_ref.",
        "price_tiers": ("Populate price_tiers with one entry per tier the evidence supports. When a 'Price tiers from N marketplace listings' "
                        "source is present, copy each tier's price range from it and pick examples from the marketplace listing sources; "
                        "describe quality and buyer needs from listing titles, reviews and the other sources. Give example prices only when "
                        "visible in the cited excerpt."),
        "supplier_listings": ("Populate supplier_listings with each specific supplier listing in an excerpt. Fill price, MOQ and lead time "
                              "only with numbers visible in that listing's excerpt; otherwise null. Use the seller name only if the excerpt "
                              "shows it, otherwise write 'unknown'. Never invent a supplier."),
    }
    rec = STEP_RECORDS.get(step_key)
    return (
        f"Business context:\n{context_block(ctx)}\n\n"
        f"Research question:\n{bundle.question}\n\n"
        f"Allowed finding sections for this step: {sections}.\n"
        f"{record_instructions[rec] if rec else ''}\n\n"
        f"=== RESEARCH NOTES (analyst summary, citations in brackets) ===\n{bundle.notes or '(none - search API results only)'}\n\n"
        f"=== EVIDENCE DOSSIER (verbatim provider data) ===\n{bundle.dossier() or '(no sources were retrieved)'}\n"
    )


# ----------------------------------------------------------------------------- execution


def submit_run(run_id: uuid.UUID) -> None:
    _executor.submit(_safe_execute, run_id)


def _safe_execute(run_id: uuid.UUID) -> None:
    try:
        execute_run(run_id)
    except Exception as e:  # noqa: BLE001 - last-resort guard so a run never stays "running"
        log.exception("Research run %s crashed", run_id)
        with session_scope() as db:
            run = db.get(ResearchRun, run_id)
            if run and run.status in ("queued", "running"):
                run.status = "failed"
                run.error = f"Unexpected error: {e}"
                run.completed_at = datetime.now(timezone.utc)


def _update_step(run_id: uuid.UUID, key: str, **changes: Any) -> None:
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        steps = [dict(s) for s in run.steps]
        for s in steps:
            if s["key"] == key:
                s.update(changes)
        run.steps = steps
        if changes.get("status") == "running":
            run.current_step = key


def _add_run_usage(run_id: uuid.UUID, usage: LLMUsage) -> float:
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        run.input_tokens += usage.input_tokens
        run.output_tokens += usage.output_tokens
        run.search_requests += usage.search_requests
        run.cost_usd = Decimal(str(run.cost_usd or 0)) + Decimal(str(round(usage.cost_usd, 6)))
        return float(run.cost_usd)


def _run_status(run_id: uuid.UUID) -> str:
    with session_scope() as db:
        return db.get(ResearchRun, run_id).status


def _step_status(run_id: uuid.UUID, key: str) -> str | None:
    with session_scope() as db:
        return next((s["status"] for s in db.get(ResearchRun, run_id).steps if s["key"] == key), None)


def execute_run(run_id: uuid.UUID) -> None:
    settings = get_settings()
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        if run is None or run.status not in ("queued",):
            return
        project = db.get(BusinessProject, run.project_id)
        run.status = "running"
        run.started_at = run.started_at or datetime.now(timezone.utc)
        run.error = None
        ctx = project_context(project, run.params or {})
        keywords = [k for k in (run.params or {}).get("keywords") or [] if isinstance(k, str)]
        kind = run.kind
        provider_name = run.provider
        user_id = run.created_by_id
        project_id = run.project_id
        pending = [s["key"] for s in run.steps if s["status"] != "completed"]
        cc = country_code(ctx["country"])

    provider = get_research_provider(provider_name)
    llm = get_llm()
    fatal: str | None = None

    for key in pending:
        if _run_status(run_id) == "cancelled":
            return
        with session_scope() as db:
            spent = float(db.get(ResearchRun, run_id).cost_usd or 0)
        if spent >= settings.max_research_cost_usd:
            _update_step(run_id, key, status="skipped", error=f"Skipped: run reached the ${settings.max_research_cost_usd:.2f} cost limit.")
            continue
        if key in SYNTHESIS_STEP.values():
            continue  # handled after research steps
        _update_step(run_id, key, status="running", started_at=datetime.now(timezone.utc).isoformat(), error=None)
        attempts = {"n": 0}

        def do_step() -> dict[str, int]:
            attempts["n"] += 1
            _update_step(run_id, key, attempts=attempts["n"])
            step = STEP_DEFS[key]
            question = step["question"].format(**ctx)
            hints = [h.format(**ctx) for h in step["hints"]]
            with session_scope() as db:
                ex = start_execution(
                    db, agent=STEP_AGENT.get(key, "opportunity_research"),
                    operation=f"research_step:{key}", project_id=project_id, user_id=user_id,
                    model=llm.model, provider=provider.name, research_run_id=run_id, input_summary=question,
                )
                ex_id = ex.id
            usage = LLMUsage()
            try:
                api_findings, api_meta = 0, {}
                if key == "demand_signals":
                    kws = keywords or _shopper_keywords(run_id, ctx, llm, usage)
                    with session_scope() as db:
                        run = db.get(ResearchRun, run_id)
                        # Collect API data once per keyword set: not again on a retry or a resume.
                        if attempts["n"] == 1 and (run.params or {}).get("demand_collected_for") != kws:
                            api_findings, api_meta = _persist_demand(db, run, kws, cc or "US")
                            run.params = {**(run.params or {}), "demand_collected_for": kws}
                    hints = [f"{k} best sellers" for k in kws[:2]] + hints
                bundle = provider.gather(question=question, context=context_block(ctx), query_hints=hints, country_code=cc)
                usage.add(bundle.usage)
                _add_run_usage(run_id, bundle.usage)  # searches are paid for even if extraction fails below
                if key == "price_tiers" and demand.configured():
                    # Real marketplace listings (prices, ratings, sellers) so tiers rest on actual prices, not page titles.
                    obs, errs, calls = demand.price_tier_evidence(keywords or _shopper_keywords(run_id, ctx, llm, usage), cc or "US")
                    nxt = max([int(s.ref[1:]) for s in bundle.sources if s.ref[1:].isdigit()] or [0])
                    for i, o in enumerate(obs, 1):
                        bundle.sources.append(SourceDoc(ref=f"S{nxt + i}", url=o.url, title=o.title, page_age="retrieved via SerpApi",
                                                        excerpts=o.excerpts, provider="serpapi"))
                    bundle.errors += errs
                    api_meta = {**api_meta, "serpapi_calls": calls}
                if key == "supplier_listings" and demand.configured():
                    # Google's result snippets for B2B product pages carry the listed price and MOQ; web search excerpts often don't.
                    obs, errs, calls = demand.b2b_listing_evidence(keywords or _shopper_keywords(run_id, ctx, llm, usage))
                    nxt = max([int(s.ref[1:]) for s in bundle.sources if s.ref[1:].isdigit()] or [0])
                    for i, o in enumerate(obs, 1):
                        bundle.sources.append(SourceDoc(ref=f"S{nxt + i}", url=o.url, title=o.title, page_age="Google result via SerpApi",
                                                        excerpts=o.excerpts, provider="serpapi"))
                    bundle.errors += errs
                    api_meta = {**api_meta, "serpapi_calls": calls}
                if not bundle.sources:
                    ext = to_step_extraction(step_output_model(key)(findings=[], evidence_gaps=[f"No sources were retrieved for: {question}"],
                                                                    **({STEP_RECORDS[key]: []} if key in STEP_RECORDS else {})))
                else:
                    out, u2 = llm.structured(system=EXTRACT_SYSTEM, prompt=_extraction_prompt(key, ctx, bundle), output_model=step_output_model(key))
                    ext = to_step_extraction(out)
                    usage.add(u2)
                    _add_run_usage(run_id, u2)
                with session_scope() as db:
                    run = db.get(ResearchRun, run_id)
                    counts = _persist_extraction(db, run, key, bundle, ext)
                    counts["findings"] += api_findings
                    ex = db.get(AgentExecution, ex_id)
                    apply_usage(ex, usage)
                    finish_execution(ex, output={"queries": bundle.queries, "sources": len(bundle.sources),
                                                 "findings": counts["findings"], "provider_errors": bundle.errors, **api_meta})
                return counts
            except Exception as e:
                with session_scope() as db:
                    ex = db.get(AgentExecution, ex_id)
                    apply_usage(ex, usage)
                    finish_execution(ex, error=str(e)[:2000])
                raise

        try:
            counts = with_retries(do_step)
            _update_step(run_id, key, status="completed", finished_at=datetime.now(timezone.utc).isoformat(),
                         findings_count=counts["findings"], sources_count=counts["sources"])
        except LLMNotConfigured as e:
            fatal = str(e)
            _update_step(run_id, key, status="failed", error=str(e), finished_at=datetime.now(timezone.utc).isoformat())
            break
        except (LLMError, LLMRefusal) as e:
            _update_step(run_id, key, status="failed", error=str(e)[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        except Exception as e:  # noqa: BLE001
            log.error("Step %s failed: %s", key, traceback.format_exc())
            _update_step(run_id, key, status="failed", error=f"{type(e).__name__}: {e}"[:1000],
                         finished_at=datetime.now(timezone.utc).isoformat())

    synth_key = SYNTHESIS_STEP.get(kind)
    if fatal is None and synth_key and _step_status(run_id, synth_key) == "pending" and _run_status(run_id) != "cancelled":
        {"synthesis": _run_synthesis, "plan": _run_channel_plan, "compliance_plan": _run_compliance_plan}[synth_key](run_id, ctx)

    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        if run.status == "cancelled":
            return
        statuses = [s["status"] for s in run.steps]
        run.current_step = None
        run.completed_at = datetime.now(timezone.utc)
        if fatal:
            run.status, run.error = "failed", fatal
        elif all(s == "completed" for s in statuses):
            run.status = "completed"
        elif any(s == "completed" for s in statuses):
            run.status = "completed_with_errors"
        else:
            run.status = "failed"
            run.error = run.error or "All research steps failed. See step errors."
        audit.record(db, "research_run.finished", user_id=user_id, project_id=project_id, actor="agent:opportunity_research",
                     entity_type="research_run", entity_id=run_id,
                     details={"status": run.status, "cost_usd": float(run.cost_usd), "searches": run.search_requests})


def _run_synthesis(run_id: uuid.UUID, ctx: dict[str, str]) -> None:
    llm = get_llm()
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        research_ok = any(s["status"] == "completed" for s in run.steps if s["key"] != "synthesis")
        project = db.get(BusinessProject, run.project_id)
        findings = db.scalars(
            select(ResearchFinding).where(ResearchFinding.research_run_id == run_id).order_by(ResearchFinding.created_at)
        ).all()
        segments = db.scalars(select(CustomerSegment).where(CustomerSegment.research_run_id == run_id)).all()
        competitors = db.scalars(select(Competitor).where(Competitor.project_id == run.project_id)).all()
        user_id, project_id = run.created_by_id, run.project_id
        budget = float(project.budget_usd) if project.budget_usd is not None else 5000.0

        fmap: dict[str, ResearchFinding] = {}
        lines = []
        for i, f in enumerate(findings, 1):
            ref = f"F{i}"
            fmap[ref] = f
            domains = sorted({link.source.domain or "" for link in f.evidence_links if link.source})
            metric = ""
            if f.metric:
                m = f.metric
                metric = f" | metric: {m.get('name')} = {m.get('value_low')}-{m.get('value_high')} {m.get('unit')} ({m.get('year')})"
            lines.append(
                f"{ref} [{f.section}] ({f.evidence_type}, {f.confidence} confidence, {f.verification_status}): {f.claim}"
                f"{(' - ' + f.detail) if f.detail else ''}{metric}{(' | sources: ' + ', '.join(d for d in domains if d)) if domains else ''}"
                f"{(' | warnings: ' + '; '.join(f.flags)) if f.flags else ''}"
            )
        seg_lines = [f"- {s.name} ({s.evidence_type}, {s.confidence}): {s.description} | unmet needs: {', '.join(s.unmet_needs)}" for s in segments]
        comp_lines = []
        for c in competitors:
            prices = [f"{po.currency} {float(po.price):.2f} ({p.name}, {po.verification_status})" for p in c.products for po in p.price_observations]
            comp_lines.append(f"- {c.name} [{c.price_tier or 'tier unknown'}]: {c.positioning or ''} | prices: {', '.join(prices[:6]) or 'none observed'}")

    if not research_ok:
        _update_step(run_id, "synthesis", status="skipped", error="Skipped: no research step completed.")
        return

    _update_step(run_id, "synthesis", status="running", started_at=datetime.now(timezone.utc).isoformat(), attempts=1)
    prompt = (
        f"Business context:\n{context_block(ctx)}\nStarting budget (USD): {budget:.0f}\n\n"
        f"=== FINDINGS ===\n" + ("\n".join(lines) or "(none)") +
        "\n\n=== CUSTOMER SEGMENTS ===\n" + ("\n".join(seg_lines) or "(none)") +
        "\n\n=== COMPETITORS ON FILE ===\n" + ("\n".join(comp_lines) or "(none)") +
        "\n\nWrite the opportunity assessment. Reference findings by F-ref."
    )
    with session_scope() as db:
        ex = start_execution(db, agent="supervisor", operation="opportunity_synthesis", project_id=project_id,
                             user_id=user_id, model=llm.model, research_run_id=run_id,
                             input_summary=f"{len(lines)} findings, {len(seg_lines)} segments, {len(comp_lines)} competitors")
        ex_id = ex.id
    try:
        synth, usage = with_retries(lambda: llm.structured(system=SYNTH_SYSTEM, prompt=prompt, output_model=OpportunitySynthesis))
    except Exception as e:  # noqa: BLE001
        with session_scope() as db:
            finish_execution(db.get(AgentExecution, ex_id), error=str(e)[:2000])
        _update_step(run_id, "synthesis", status="failed", error=str(e)[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    _add_run_usage(run_id, usage)

    def ids(refs: list[str]) -> list[str]:
        return [str(fmap[r].id) for r in refs if r in fmap]

    # Unit economics: enforce basis rules, then compute deterministically.
    ue_inputs: dict[str, Any] = {}
    ue_basis: dict[str, str] = {}
    ue_detail: dict[str, Any] = {}
    for name, item in synth.unit_economics.model_dump().items():
        refs_ok = [r for r in item["finding_refs"] if r in fmap and fmap[r].evidence_type == "sourced"]
        basis = item["basis"]
        note = item["note"]
        if basis == "sourced_research" and not refs_ok:
            basis = "assumption"
            note = f"{note} (Downgraded to assumption: no sourced finding supports this value.)"
        ue_inputs[name] = int(item["value"]) if name == "moq" else item["value"]
        ue_basis[name] = basis
        ue_detail[name] = {"value": ue_inputs[name], "basis": basis, "finding_ids": ids(item["finding_refs"]), "note": note}
    ue_inputs["initial_investment"] = budget
    ue_basis["initial_investment"] = "actual"
    try:
        model_inputs = UnitEconomicsInputs(**{k: v for k, v in ue_inputs.items() if k in UnitEconomicsInputs.model_fields})
        results = calculate(model_inputs)
    except Exception as e:  # noqa: BLE001 - invalid values from the model
        model_inputs, results = None, {"error": f"Could not compute unit economics: {e}"}

    report = {
        "executive_summary": synth.executive_summary,
        "attractiveness": synth.attractiveness,
        "attractiveness_rationale": synth.attractiveness_rationale,
        "attractiveness_finding_ids": ids(synth.attractiveness_finding_refs),
        "recommended_segment": {"name": synth.recommended_segment, "rationale": synth.recommended_segment_rationale,
                                "finding_ids": ids(synth.segment_finding_refs)},
        "differentiation": [{"idea": d.idea, "rationale": d.rationale, "finding_ids": ids(d.finding_refs)} for d in synth.differentiation],
        "pricing": {"summary": synth.pricing_summary, "test_price_low": synth.test_price_low,
                    "test_price_high": synth.test_price_high, "finding_ids": ids(synth.pricing_finding_refs)},
        "unit_economics": {"inputs": ue_detail, "results": results},
        "risks": [{"risk": r.risk, "severity": r.severity, "mitigation": r.mitigation, "finding_ids": ids(r.finding_refs)} for r in synth.risks],
        "evidence_gaps": [g.model_dump() for g in synth.evidence_gaps],
        "next_steps": [n.model_dump() for n in synth.next_steps],
        "evidence_summary": {
            "findings": len(lines),
            "by_type": {t: sum(1 for f in fmap.values() if f.evidence_type == t) for t in ("sourced", "ai_inference", "assumption", "unavailable")},
            "source_linked": sum(1 for f in fmap.values() if f.verification_status == "source_linked"),
        },
        "generated_by": {"model": usage.model or llm.model, "generated_at": datetime.now(timezone.utc).isoformat()},
    }

    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        project = db.get(BusinessProject, run.project_id)
        scenario_id = None
        if model_inputs is not None:
            scenario = CostScenario(
                project_id=run.project_id, name=f"Research estimate ({datetime.now(timezone.utc):%Y-%m-%d})",
                scenario_type="research_estimate", inputs=model_inputs.model_dump(),
                input_basis={k: ue_basis.get(k, "assumption") for k in model_inputs.model_dump()},
                results=results, created_by="opportunity_research_agent",
                notes="Generated by the research synthesis. Values marked 'assumption' are not verified.",
            )
            db.add(scenario)
            db.flush()
            scenario_id = str(scenario.id)
        report["unit_economics"]["cost_scenario_id"] = scenario_id
        opp = MarketOpportunity(
            project_id=run.project_id, research_run_id=run.id,
            title=f"{ctx['category']} in {ctx['country']}", category=ctx["category"], geography=ctx["country"],
            budget_usd=Decimal(str(budget)), attractiveness=synth.attractiveness, summary=synth.executive_summary, report=report,
        )
        db.add(opp)
        db.flush()
        for f in db.scalars(select(ResearchFinding).where(ResearchFinding.research_run_id == run_id)):
            f.market_opportunity_id = opp.id
        for n in synth.next_steps:
            db.add(Recommendation(project_id=run.project_id, source="research", title=n.action[:300], body=n.rationale,
                                  priority=n.priority, research_run_id=run.id))
        ex = db.get(AgentExecution, ex_id)
        apply_usage(ex, usage)
        finish_execution(ex, output={"market_opportunity_id": str(opp.id), "attractiveness": synth.attractiveness})
        audit.record(db, "market_opportunity.created", user_id=user_id, project_id=project.id,
                     actor="agent:supervisor", entity_type="market_opportunity", entity_id=opp.id)
    _update_step(run_id, "synthesis", status="completed", finished_at=datetime.now(timezone.utc).isoformat(), findings_count=0)


PLAN_SYSTEM = """You are an e-commerce operations advisor helping a small founder choose where to sell and how to ship.
Rules:
- Use the findings (F-refs) and the computed economics provided. Never invent fees, rates, transit times or regulations.
- The per-channel and per-shipping-option numbers were computed by a deterministic calculator; quote them, do not recompute.
- If fees or rates are assumptions or missing, say what must be confirmed before deciding.
- Customs and trade rules change frequently; phrase compliance items as things to confirm with a customs broker or official source.
- Favour low-commitment options for a small first order, then a cheaper mode once demand is proven."""


def _run_channel_plan(run_id: uuid.UUID, ctx: dict[str, str]) -> None:
    llm = get_llm()
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        research_ok = any(s["status"] == "completed" for s in run.steps if s["key"] != "plan")
        project = db.get(BusinessProject, run.project_id)
        user_id, project_id = run.created_by_id, run.project_id
        findings = db.scalars(select(ResearchFinding).where(ResearchFinding.research_run_id == run_id)
                              .order_by(ResearchFinding.created_at)).all()
        fmap = {f"F{i}": f for i, f in enumerate(findings, 1)}
        f_lines = [f"{ref} [{f.section}] ({f.evidence_type}, {f.confidence}, {f.verification_status}): {f.claim}" for ref, f in fmap.items()]
        channels = db.scalars(select(SalesChannel).where(SalesChannel.project_id == project_id,
                                                         SalesChannel.status != "rejected")).all()
        econ = channel_economics(db, project, list(channels))
        c_lines = [f"- {r['name']} ({r['channel_type']}, fees: {r['fee_basis']}): price ${r['price']:.2f}, channel fees ${r['channel_fees_per_unit']:.2f}/unit, "
                   f"contribution ${r['contribution_margin']:.2f}/unit ({r['contribution_margin_pct']}%), break-even CAC ${r['breakeven_cac']:.2f}"
                   for r in econ["rows"]]
        options = db.scalars(select(ShippingOption).where(ShippingOption.project_id == project_id)).all()
        product = db.scalars(select(ProductConcept).where(ProductConcept.project_id == project_id,
                                                          ProductConcept.units_per_carton.is_not(None))).first()
        s_lines: list[str] = []
        if product and all(getattr(product, k) is not None for k in ("carton_length_cm", "carton_width_cm", "carton_height_cm", "carton_gross_weight_kg")):
            spec = PackagingSpec(units_per_carton=product.units_per_carton, carton_length_cm=float(product.carton_length_cm),
                                 carton_width_cm=float(product.carton_width_cm), carton_height_cm=float(product.carton_height_cm),
                                 carton_gross_weight_kg=float(product.carton_gross_weight_kg))
            cmp = compare_shipping(list(options), Shipment(units=100, packaging=spec))
            s_lines.append(f"(Computed for a 100-unit shipment of '{product.name}': {cmp['shipment']})")
            for r in cmp["rows"]:
                s_lines.append(f"- {r['name']} [{r['leg']}, {r['basis']}]: ${r['per_unit_low']}-{r['per_unit_high']}/unit, transit {r['transit_days_min']}-{r['transit_days_max']} days")
        else:
            for o in options:
                s_lines.append(f"- {o.name} [{o.leg}, {o.mode}, {o.basis}]: {o.rate}{('-' + str(o.rate_high)) if o.rate_high else ''} {o.currency} {o.rate_basis}, "
                               f"transit {o.transit_days_min}-{o.transit_days_max} days (no carton specs on file, per-unit cost not computed)")

    if not research_ok:
        _update_step(run_id, "plan", status="skipped", error="Skipped: no research step completed.")
        return
    _update_step(run_id, "plan", status="running", started_at=datetime.now(timezone.utc).isoformat(), attempts=1)
    prompt = (
        f"Business context:\n{context_block(ctx)}\n\n=== FINDINGS ===\n" + ("\n".join(f_lines) or "(none)") +
        "\n\n=== SALES CHANNELS ON FILE (computed economics) ===\n" + ("\n".join(c_lines) or "(none)") +
        "\n\n=== SHIPPING OPTIONS ON FILE ===\n" + ("\n".join(s_lines) or "(none)") +
        "\n\nWrite the channel and logistics plan. Reference findings by F-ref."
    )
    with session_scope() as db:
        ex = start_execution(db, agent="supervisor", operation="channel_logistics_plan", project_id=project_id, user_id=user_id,
                             model=llm.model, research_run_id=run_id,
                             input_summary=f"{len(f_lines)} findings, {len(c_lines)} channels, {len(s_lines)} shipping lines")
        ex_id = ex.id
    try:
        plan, usage = with_retries(lambda: llm.structured(system=PLAN_SYSTEM, prompt=prompt, output_model=ChannelLogisticsPlan))
    except Exception as e:  # noqa: BLE001
        with session_scope() as db:
            finish_execution(db.get(AgentExecution, ex_id), error=str(e)[:2000])
        _update_step(run_id, "plan", status="failed", error=str(e)[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    _add_run_usage(run_id, usage)

    def ids(refs: list[str]) -> list[str]:
        return [str(fmap[r].id) for r in refs if r in fmap]

    content = plan.model_dump()
    for pick in content["launch_channels"]:
        pick["finding_ids"] = ids(pick.pop("finding_refs"))
    for r in content["risks"]:
        r["finding_ids"] = ids(r.pop("finding_refs"))
    content["shipping_finding_ids"] = ids(content.pop("shipping_finding_refs"))
    content["research_run_id"] = str(run_id)
    content["generated_by"] = {"model": usage.model or llm.model, "generated_at": datetime.now(timezone.utc).isoformat()}

    with session_scope() as db:
        snap = AnalysisSnapshot(project_id=project_id, kind="channel_logistics_plan", content=content, agent_execution_id=ex_id)
        db.add(snap)
        for n in plan.next_steps:
            db.add(Recommendation(project_id=project_id, source="research", title=n.action[:300], body=n.rationale,
                                  priority=n.priority, research_run_id=run_id))
        ex = db.get(AgentExecution, ex_id)
        apply_usage(ex, usage)
        finish_execution(ex, output={"launch_channels": [p.channel for p in plan.launch_channels]})
        audit.record(db, "channel_plan.created", user_id=user_id, project_id=project_id, actor="agent:supervisor",
                     entity_type="analysis_snapshot", entity_id=snap.id)
    _update_step(run_id, "plan", status="completed", finished_at=datetime.now(timezone.utc).isoformat())


COMPLIANCE_SYSTEM = """You are an import-compliance analyst helping a small founder prepare to sell a product. You are not a lawyer.
Rules:
- Base every item on the findings provided and cite them by F-ref. If a requirement is not established by the findings, mark it "unknown" and say how to confirm it.
- Never state that a design is free to use, that a product is compliant, or that a supplier is cleared - only what the evidence shows.
- Supplier questions must be specific and answerable with documents: fiber content, country of origin of each material, mills and spinners, traceability records, label artwork, test reports.
- Keep it short and practical; the founder will act on it."""


def _run_compliance_plan(run_id: uuid.UUID, ctx: dict[str, str]) -> None:
    """Turn the compliance findings into a checklist, and draft (not send) the questions for each supplier on file."""
    llm = get_llm()
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        research_ok = any(s["status"] == "completed" for s in run.steps if s["key"] != "compliance_plan")
        user_id, project_id = run.created_by_id, run.project_id
        project = db.get(BusinessProject, project_id)
        findings = db.scalars(select(ResearchFinding).where(ResearchFinding.research_run_id == run_id).order_by(ResearchFinding.created_at)).all()
        fmap = {f"F{i}": f for i, f in enumerate(findings, 1)}
        f_lines = [f"{ref} [{f.section}] ({f.evidence_type}, {f.confidence}): {f.claim}" for ref, f in fmap.items()]
        product_name = project.name
    if not research_ok:
        _update_step(run_id, "compliance_plan", status="skipped", error="Skipped: no research step completed.")
        return
    _update_step(run_id, "compliance_plan", status="running", started_at=datetime.now(timezone.utc).isoformat(), attempts=1)
    prompt = (f"Business context:\n{context_block(ctx)}\nSuppliers on file: {ctx['suppliers']}\n\n=== FINDINGS ===\n" + ("\n".join(f_lines) or "(none)")
              + "\n\nWrite the compliance checklist (design/IP, labelling, forced labour/UFLPA, safety) and the supplier questions.")
    with session_scope() as db:
        ex = start_execution(db, agent="sourcing", operation="compliance_checklist", project_id=project_id, user_id=user_id,
                             model=llm.model, research_run_id=run_id, input_summary=f"{len(f_lines)} findings")
        ex_id = ex.id
    try:
        plan, usage = with_retries(lambda: llm.structured(system=COMPLIANCE_SYSTEM, prompt=prompt, output_model=CompliancePlan, max_tokens=8000))
    except Exception as e:  # noqa: BLE001
        with session_scope() as db:
            finish_execution(db.get(AgentExecution, ex_id), error=str(e)[:2000])
        _update_step(run_id, "compliance_plan", status="failed", error=str(e)[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    _add_run_usage(run_id, usage)
    content = plan.model_dump()
    for item in content["items"]:
        item["finding_ids"] = [str(fmap[r].id) for r in item.pop("finding_refs") if r in fmap]
    content.update(research_run_id=str(run_id), generated_by={"model": usage.model or llm.model, "generated_at": datetime.now(timezone.utc).isoformat()})
    with session_scope() as db:
        drafted = 0
        if plan.supplier_questions:
            body = ("Hello,\n\nBefore we place an order for " + product_name + ", could you please confirm the following and send any supporting documents?\n\n"
                    + "\n".join(f"{i}. {q}" for i, q in enumerate(plan.supplier_questions, 1)) + "\n\nThank you.")
            for sup in db.scalars(select(Supplier).where(Supplier.project_id == project_id)).all():
                db.add(SupplierCommunication(supplier_id=sup.id, channel="email", direction="draft", subject=f"Compliance questions - {product_name}"[:300],
                                             summary=body, next_action="Review this draft and send it yourself."))
                drafted += 1
        content["supplier_drafts"] = drafted
        snap = AnalysisSnapshot(project_id=project_id, kind="compliance_checklist", content=content, agent_execution_id=ex_id)
        db.add(snap)
        for item in plan.items:
            if item.status == "action_needed":
                db.add(Recommendation(project_id=project_id, source="research", title=f"{item.requirement}"[:300], body=item.what_to_do,
                                      priority="high" if item.area in ("design_ip", "forced_labor") else "medium", research_run_id=run_id))
        ex = db.get(AgentExecution, ex_id)
        apply_usage(ex, usage)
        finish_execution(ex, output={"items": len(plan.items), "supplier_drafts": drafted})
        audit.record(db, "compliance_checklist.created", user_id=user_id, project_id=project_id, actor="agent:sourcing",
                     entity_type="analysis_snapshot", entity_id=snap.id, details={"supplier_drafts": drafted})
    _update_step(run_id, "compliance_plan", status="completed", finished_at=datetime.now(timezone.utc).isoformat())


def recover_interrupted_runs() -> int:
    """On startup, mark runs that were in flight when the process stopped."""
    with session_scope() as db:
        runs = db.scalars(select(ResearchRun).where(ResearchRun.status.in_(["queued", "running"]))).all()
        for run in runs:
            run.status = "interrupted"
            run.error = "The server restarted while this run was in progress. Resume it to continue from the last completed step."
            run.steps = [dict(s, status="pending" if s["status"] == "running" else s["status"]) for s in run.steps]
        return len(runs)
