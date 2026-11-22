"""Structured-output schemas the research agents must return (validated by the SDK and again by us)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SectionLit = Literal[
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


class StepExtraction(BaseModel):
    findings: list[ExtractedFinding]
    segments: list[ExtractedSegment]
    competitors: list[ExtractedCompetitor]
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
