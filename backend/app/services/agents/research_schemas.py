"""Structured-output schemas the research agents must return (validated by the SDK and again by us)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SectionLit = Literal[
    "demand",
    "market_size",
    "growth",
    "customer_segments",
    "unmet_needs",
    "competitors",
    "pricing",
    "differentiation",
    "sourcing_costs",
    "channels",
    "risks",
    "regulatory",
    "logistics",
    "fit",
    "other",
]
EvidenceLit = Literal["sourced", "ai_inference", "assumption", "unavailable"]
ConfidenceLit = Literal["high", "medium", "low"]


class ExtractedMetric(BaseModel):
    name: str = Field(description="What is measured, e.g. 'US dancewear market size' or 'Section 301 tariff'")
    value_low: float | None = Field(description="Low end (or the single value)")
    value_high: float | None = Field(description="High end, or null if a single value")
    unit: str = Field(description="Unit, e.g. 'USD billion', '% CAGR', 'USD per unit', '% ad valorem'")
    year: str | None = Field(description="Year or period the figure refers to, as stated by the source")


class ExtractedFinding(BaseModel):
    section: SectionLit
    claim: str = Field(description="One specific, self-contained statement")
    detail: str | None = Field(description="Context, caveats, or methodology notes")
    evidence_type: EvidenceLit = Field(
        description="sourced = directly supported by a dossier excerpt; ai_inference = your reasoning; "
        "assumption = a business assumption to test; unavailable = data was searched for but not found"
    )
    confidence: ConfidenceLit
    source_refs: list[str] = Field(description="Dossier source refs such as 'S1'. Required for sourced findings.")
    supporting_quote: str | None = Field(description="Short verbatim quote copied exactly from a dossier excerpt")
    metric: ExtractedMetric | None


class ExtractedPrice(BaseModel):
    product_name: str
    price: float
    currency: str = Field(description="ISO currency code, e.g. USD")
    product_url: str | None
    source_ref: str = Field(description="Dossier ref whose excerpt shows this price")


class ExtractedCompetitor(BaseModel):
    name: str
    website: str | None
    positioning: str | None = Field(description="How the brand positions itself, per sources")
    price_tier: Literal["budget", "mid", "premium", "luxury", "unknown"]
    channels: list[str] = Field(description="e.g. own website, Amazon, Etsy, studios, competitions")
    source_refs: list[str]
    prices: list[ExtractedPrice] = Field(description="Only prices that appear in the dossier")


class ExtractedSegment(BaseModel):
    name: str
    description: str
    needs: list[str]
    unmet_needs: list[str]
    size_indicator: str | None = Field(description="Any evidence about segment size, or null")
    evidence_type: EvidenceLit
    confidence: ConfidenceLit
    source_refs: list[str]


class ExtractedChannel(BaseModel):
    name: str = Field(description="e.g. 'Amazon US', 'Etsy', 'Own Shopify store', 'Wholesale to dance studios'")
    platform: str | None
    channel_type: Literal["own_store", "marketplace", "social_commerce", "wholesale", "retail_partner", "events", "other"]
    commission_pct: float | None = Field(description="Referral/commission % for this category, only if stated in an excerpt")
    per_order_fee: float | None = Field(description="Per-order or per-transaction fixed fee, only if stated")
    payment_fee_pct: float | None = Field(description="Payment processing %, only if stated")
    payment_fee_fixed: float | None
    monthly_fee: float | None = Field(description="Monthly subscription/plan fee, only if stated")
    fee_source_ref: str | None = Field(description="Dossier ref of the excerpt that states these fees")
    requirements: str | None = Field(description="Seller requirements, category restrictions, approvals")
    audience_fit: str | None = Field(description="Evidence of how this category's customers buy here")
    source_refs: list[str]


class ExtractedShipping(BaseModel):
    mode: Literal["express_courier", "air_freight", "sea_lcl", "sea_fcl", "rail", "truck", "domestic_parcel",
                  "fulfillment_3pl", "marketplace_fulfillment"]
    leg: Literal["international", "domestic"]
    origin: str | None
    destination: str | None
    rate_low: float | None
    rate_high: float | None
    currency: str
    rate_basis: Literal["per_kg", "per_cbm", "per_shipment", "per_unit", "per_order"]
    transit_days_min: int | None
    transit_days_max: int | None
    as_of: str | None = Field(description="Date/period the rate refers to, as stated by the source")
    source_ref: str = Field(description="Dossier ref whose excerpt states this rate")
    notes: str | None


class ExtractedMeasure(BaseModel):
    dimension: str = Field(description="One of: height, bust, underbust, chest, waist, hip, torso_girth, neck, sleeve, inseam, "
                                       "foot_length, foot_width - or a short snake_case name for anything else")
    min: float | None = Field(description="Lower bound as printed (or the single value)")
    max: float | None = Field(description="Upper bound as printed, or null if a single value")


class ExtractedSizeLabel(BaseModel):
    system: str = Field(description="Size system name as printed, e.g. US, EU, UK, CN, AU, Mondo")
    value: str


class ExtractedSizeRow(BaseModel):
    size: str = Field(description="The main size label exactly as printed, e.g. 'S', '36', 'XL', '7.5'")
    other_labels: list[ExtractedSizeLabel] = Field(description="Equivalent sizes in other systems shown on the same row")
    measurements: list[ExtractedMeasure] = Field(description="Body measurements for this size; never garment flat-lay widths")


class ExtractedSizeChart(BaseModel):
    brand_or_seller: str | None = Field(description="Whose chart this is, as stated; null if unknown")
    product_type: str = Field(description="What the chart is for, e.g. 'women's Latin dress', 'men's ballroom shoes'")
    garment_type: Literal["dress", "top", "bottom", "bodysuit", "shoes", "other"]
    unit: Literal["cm", "in"] = Field(description="Unit the measurements are printed in")
    rows: list[ExtractedSizeRow] = Field(description="Sizes from smallest to largest")
    fit_notes: str | None = Field(description="Sizing advice the chart or page states (e.g. 'runs small, order one size up'), else null")
    source_ref: str | None = Field(description="Dossier ref whose excerpt contains this chart (research only); null for images")


class StepExtraction(BaseModel):
    findings: list[ExtractedFinding]
    segments: list[ExtractedSegment]
    competitors: list[ExtractedCompetitor]
    channels: list[ExtractedChannel]
    shipping_benchmarks: list[ExtractedShipping]
    size_charts: list[ExtractedSizeChart]
    evidence_gaps: list[str] = Field(description="Important questions the evidence did not answer")


# ----------------------------------------------------------------------------- synthesis


class RefIdea(BaseModel):
    idea: str
    rationale: str
    finding_refs: list[str]


class RiskItem(BaseModel):
    risk: str
    severity: Literal["high", "medium", "low"]
    mitigation: str
    finding_refs: list[str]


class GapItem(BaseModel):
    gap: str
    why_it_matters: str
    how_to_close: str


class NextStep(BaseModel):
    action: str
    rationale: str
    priority: Literal["high", "medium", "low"]


class UEInput(BaseModel):
    value: float
    basis: Literal["sourced_research", "assumption"]
    finding_refs: list[str] = Field(description="F-refs supporting the value; required for sourced_research")
    note: str


class UEProposal(BaseModel):
    retail_price: UEInput
    factory_cost: UEInput
    freight_per_unit: UEInput
    duty_rate_pct: UEInput
    import_clearance_per_unit: UEInput
    packaging_per_unit: UEInput
    fulfillment_per_unit: UEInput
    payment_fee_pct: UEInput
    marketing_cac: UEInput
    return_rate_pct: UEInput
    moq: UEInput


class OpportunitySynthesis(BaseModel):
    executive_summary: str
    attractiveness: Literal["promising", "mixed", "weak", "insufficient_evidence"]
    attractiveness_rationale: str
    attractiveness_finding_refs: list[str]
    recommended_segment: str | None
    recommended_segment_rationale: str
    segment_finding_refs: list[str]
    differentiation: list[RefIdea]
    pricing_summary: str
    test_price_low: float | None
    test_price_high: float | None
    pricing_finding_refs: list[str]
    unit_economics: UEProposal
    risks: list[RiskItem]
    evidence_gaps: list[GapItem]
    next_steps: list[NextStep]


# ----------------------------------------------------------------------------- channel & logistics plan


class ChannelPick(BaseModel):
    channel: str
    role: Literal["primary", "secondary", "test"]
    rationale: str
    finding_refs: list[str]


class ChannelSkip(BaseModel):
    channel: str
    reason: str


class ChannelLogisticsPlan(BaseModel):
    summary: str
    launch_channels: list[ChannelPick]
    channels_to_defer: list[ChannelSkip]
    first_order_shipping: str = Field(description="Recommended freight mode for the first (sample/small) order and why")
    replenishment_shipping: str = Field(description="Recommended mode once demand is proven")
    shipping_finding_refs: list[str]
    fulfillment: str = Field(description="How to fulfill domestic orders at launch (self, 3PL, marketplace fulfillment)")
    customs_and_compliance: list[str] = Field(description="Import/labeling steps to confirm, each phrased as an action")
    risks: list[RiskItem]
    open_questions: list[GapItem]
    next_steps: list[NextStep]
