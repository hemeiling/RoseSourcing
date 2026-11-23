"""API request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import field_validator, BaseModel, ConfigDict, EmailStr, Field

from .enums import BrandKind, ChannelStatus, ChannelType, RateBasis, ShippingMode, SupplierVerification, VerificationStatus


from .services.urls import clean_urls


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------------------------------------------- auth


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORM):
    id: uuid.UUID
    email: str
    display_name: str | None
    role: str


# ----------------------------------------------------------------------------- projects


class Assumption(BaseModel):
    label: str
    value: str
    status: Literal["hypothesis", "validated", "invalidated"] = "hypothesis"


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    product_category: str = Field(min_length=1, max_length=200)
    target_country: str = Field(min_length=1, max_length=100)
    sourcing_country: str | None = None
    budget_usd: float | None = Field(None, ge=0)
    target_customers: str | None = None
    price_min: float | None = Field(None, ge=0)
    price_max: float | None = Field(None, ge=0)
    notes: str | None = None
    assumptions: list[Assumption] = []


class ProjectPatch(BaseModel):
    name: str | None = None
    product_category: str | None = None
    target_country: str | None = None
    sourcing_country: str | None = None
    budget_usd: float | None = None
    target_customers: str | None = None
    price_min: float | None = None
    price_max: float | None = None
    notes: str | None = None
    assumptions: list[Assumption] | None = None
    status: Literal["active", "archived"] | None = None


class ProjectOut(ORM):
    id: uuid.UUID
    name: str
    product_category: str
    target_country: str
    sourcing_country: str | None
    budget_usd: float | None
    target_customers: str | None
    price_min: float | None
    price_max: float | None
    currency: str
    notes: str | None
    assumptions: list[dict[str, Any]]
    status: str
    decision: str
    decision_note: str | None
    decided_at: datetime | None
    cover_scan_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


# ----------------------------------------------------------------------------- research


class ResearchStartIn(BaseModel):
    kind: Literal["market_opportunity", "competitor_discovery", "channels_logistics", "fit_sizing", "price_tiers", "compliance", "supplier_listings"] = "market_opportunity"
    category: str | None = None
    geography: str | None = None
    budget_usd: float | None = Field(None, ge=0)
    focus: str | None = Field(None, max_length=1000)
    source_urls: list[str] = Field(default_factory=list, max_length=8, description="Pages the agent should read in full")
    provider: str | None = None

    @field_validator("source_urls")
    @classmethod
    def _clean_urls(cls, urls: list[str]) -> list[str]:
        return clean_urls(urls)


class ResearchRunOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    kind: str
    status: str
    provider: str
    model: str
    params: dict[str, Any]
    steps: list[dict[str, Any]]
    current_step: str | None
    error: str | None
    started_at: datetime | None
    completed_at: datetime | None
    input_tokens: int
    output_tokens: int
    search_requests: int
    cost_usd: float
    created_at: datetime


class EvidenceSourceOut(ORM):
    id: uuid.UUID
    url: str | None
    title: str | None
    domain: str | None
    source_type: str
    provider: str | None
    retrieved_at: datetime
    published_hint: str | None
    excerpts: list[str]


class FindingSourceOut(BaseModel):
    source: EvidenceSourceOut
    quote: str | None


class FindingOut(ORM):
    id: uuid.UUID
    research_run_id: uuid.UUID | None
    section: str
    claim: str
    detail: str | None
    evidence_type: str
    confidence: str
    verification_status: str
    metric: dict[str, Any] | None
    flags: list[str]
    created_by: str
    reviewer_note: str | None
    created_at: datetime
    sources: list[FindingSourceOut] = []


class FindingReviewIn(BaseModel):
    verification_status: VerificationStatus | None = None
    reviewer_note: str | None = None


class SegmentOut(ORM):
    id: uuid.UUID
    research_run_id: uuid.UUID | None
    name: str
    description: str | None
    needs: list[str]
    unmet_needs: list[str]
    size_indicator: str | None
    evidence_type: str
    confidence: str
    source_ids: list[str]


class OpportunityOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    research_run_id: uuid.UUID | None
    title: str
    category: str
    geography: str
    budget_usd: float | None
    attractiveness: str | None
    summary: str | None
    report: dict[str, Any]
    created_at: datetime


# ----------------------------------------------------------------------------- competitors


class PriceObservationIn(BaseModel):
    price: float = Field(gt=0)
    currency: str = "USD"
    observed_at: datetime | None = None
    source_url: str | None = None
    note: str | None = None


class PriceObservationOut(ORM):
    id: uuid.UUID
    price: float
    currency: str
    observed_at: datetime
    source_url: str | None
    source_type: str
    verification_status: str
    note: str | None


class CompetitorProductIn(BaseModel):
    name: str
    url: str | None = None
    product_type: str | None = None
    material: str | None = None
    notes: str | None = None
    initial_price: PriceObservationIn | None = None


class CompetitorProductOut(ORM):
    id: uuid.UUID
    name: str
    url: str | None
    product_type: str | None
    material: str | None
    notes: str | None
    price_observations: list[PriceObservationOut]


class CompetitorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    website: str | None = None
    country: str | None = None
    positioning: str | None = None
    price_tier: Literal["budget", "mid", "premium", "luxury"] | None = None
    channels: list[str] = []
    notes: str | None = None
    on_watchlist: bool = False


class CompetitorPatch(BaseModel):
    name: str | None = None
    website: str | None = None
    country: str | None = None
    positioning: str | None = None
    price_tier: Literal["budget", "mid", "premium", "luxury"] | None = None
    channels: list[str] | None = None
    notes: str | None = None
    on_watchlist: bool | None = None


class CompetitorOut(ORM):
    id: uuid.UUID
    name: str
    website: str | None
    country: str | None
    positioning: str | None
    price_tier: str | None
    channels: list[str]
    notes: str | None
    on_watchlist: bool
    discovered_by: str
    evidence_source_id: uuid.UUID | None
    created_at: datetime
    products: list[CompetitorProductOut]


# ----------------------------------------------------------------------------- brand


class BrandGenerateIn(BaseModel):
    kind: BrandKind
    brief: str | None = Field(None, max_length=2000)


class BrandConceptOut(ORM):
    id: uuid.UUID
    kind: str
    title: str
    content: dict[str, Any]
    status: str
    brief: str | None
    created_at: datetime


class BrandConceptPatch(BaseModel):
    status: Literal["draft", "shortlisted", "selected", "rejected"] | None = None
    title: str | None = None


# ----------------------------------------------------------------------------- suppliers


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    country: str | None = None
    city: str | None = None
    website: str | None = None
    platform: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    capabilities: list[str] = []
    certifications_claimed: list[str] = []
    verification_status: SupplierVerification = "unverified"
    quality_rating: int | None = Field(None, ge=1, le=5)
    quality_notes: str | None = None
    notes: str | None = None


class SupplierPatch(BaseModel):
    name: str | None = None
    country: str | None = None
    city: str | None = None
    website: str | None = None
    platform: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    capabilities: list[str] | None = None
    certifications_claimed: list[str] | None = None
    verification_status: SupplierVerification | None = None
    quality_rating: int | None = Field(None, ge=1, le=5)
    quality_notes: str | None = None
    notes: str | None = None


class QuoteIn(BaseModel):
    product_name: str
    product_concept_id: uuid.UUID | None = None
    moq: int | None = Field(None, ge=0)
    unit_price: float | None = Field(None, ge=0)
    currency: str = "USD"
    sample_cost: float | None = Field(None, ge=0)
    lead_time_days: int | None = Field(None, ge=0)
    incoterm: str | None = None
    est_freight_per_unit: float | None = Field(None, ge=0)
    quote_date: date | None = None
    valid_until: date | None = None
    notes: str | None = None


class QuoteOut(ORM):
    id: uuid.UUID
    product_name: str
    product_concept_id: uuid.UUID | None
    moq: int | None
    unit_price: float | None
    currency: str
    sample_cost: float | None
    lead_time_days: int | None
    incoterm: str | None
    est_freight_per_unit: float | None
    quote_date: date | None
    valid_until: date | None
    source: str
    notes: str | None


class CommunicationIn(BaseModel):
    occurred_at: datetime | None = None
    channel: str = "email"
    direction: Literal["inbound", "outbound", "draft"] = "outbound"
    subject: str | None = None
    summary: str = Field(min_length=1)
    next_action: str | None = None


class CommunicationOut(ORM):
    id: uuid.UUID
    occurred_at: datetime
    channel: str
    direction: str
    subject: str | None
    summary: str
    next_action: str | None


class SupplierOut(ORM):
    id: uuid.UUID
    name: str
    country: str | None
    city: str | None
    website: str | None
    platform: str | None
    contact_name: str | None
    contact_email: str | None
    capabilities: list[str]
    certifications_claimed: list[str]
    verification_status: str
    quality_rating: int | None
    quality_notes: str | None
    notes: str | None
    source: str
    created_at: datetime
    quotes: list[QuoteOut]
    communications: list[CommunicationOut]


class RfqIn(BaseModel):
    product_concept_id: uuid.UUID | None = None
    notes: str | None = None


# ----------------------------------------------------------------------------- products / commerce


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    description: str | None = None
    product_type: str | None = None
    target_price: float | None = Field(None, ge=0)
    materials: str | None = None
    features: list[str] = []
    sizes: list[str] = []
    sku: str | None = None
    status: Literal["idea", "sampling", "approved", "listed", "retired"] = "idea"
    inventory_on_hand: int | None = Field(None, ge=0)
    reorder_point: int | None = Field(None, ge=0)
    unit_weight_kg: float | None = Field(None, ge=0)
    units_per_carton: int | None = Field(None, ge=1)
    carton_length_cm: float | None = Field(None, gt=0)
    carton_width_cm: float | None = Field(None, gt=0)
    carton_height_cm: float | None = Field(None, gt=0)
    carton_gross_weight_kg: float | None = Field(None, gt=0)


class ProductPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    product_type: str | None = None
    target_price: float | None = None
    materials: str | None = None
    features: list[str] | None = None
    sizes: list[str] | None = None
    sku: str | None = None
    status: Literal["idea", "sampling", "approved", "listed", "retired"] | None = None
    inventory_on_hand: int | None = None
    reorder_point: int | None = None
    listing_draft: dict[str, Any] | None = None
    unit_weight_kg: float | None = Field(None, ge=0)
    units_per_carton: int | None = Field(None, ge=1)
    carton_length_cm: float | None = Field(None, gt=0)
    carton_width_cm: float | None = Field(None, gt=0)
    carton_height_cm: float | None = Field(None, gt=0)
    carton_gross_weight_kg: float | None = Field(None, gt=0)



class ProductOut(ORM):
    id: uuid.UUID
    name: str
    description: str | None
    product_type: str | None
    target_price: float | None
    materials: str | None
    features: list[str]
    sizes: list[str]
    sku: str | None
    status: str
    inventory_on_hand: int | None
    reorder_point: int | None
    listing_draft: dict[str, Any] | None
    unit_weight_kg: float | None
    units_per_carton: int | None
    carton_length_cm: float | None
    carton_width_cm: float | None
    carton_height_cm: float | None
    carton_gross_weight_kg: float | None
    created_at: datetime


class ApprovalIn(BaseModel):
    action_type: Literal["publish_listing", "purchase_inventory", "launch_campaign", "send_supplier_message"]
    title: str
    payload: dict[str, Any] = {}


class ApprovalOut(ORM):
    id: uuid.UUID
    action_type: str
    title: str
    payload: dict[str, Any]
    status: str
    requested_by: str
    decided_at: datetime | None
    execution_result: dict[str, Any] | None
    created_at: datetime


class ApprovalDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]


# ----------------------------------------------------------------------------- analytics


class ScenarioIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scenario_type: Literal["hypothetical", "quote_based", "actual", "research_estimate"] = "hypothetical"
    inputs: dict[str, Any]
    input_basis: dict[str, Literal["assumption", "supplier_quote", "actual", "sourced_research"]] = {}
    supplier_quote_id: uuid.UUID | None = None
    notes: str | None = None


class ScenarioOut(ORM):
    id: uuid.UUID
    name: str
    scenario_type: str
    inputs: dict[str, Any]
    input_basis: dict[str, str]
    results: dict[str, Any]
    supplier_quote_id: uuid.UUID | None
    notes: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime


class ExperimentIn(BaseModel):
    name: str
    hypothesis: str
    method: str | None = None
    success_metric: str | None = None
    status: Literal["planned", "running", "completed", "abandoned"] = "planned"
    result: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class ExperimentOut(ORM):
    id: uuid.UUID
    name: str
    hypothesis: str
    method: str | None
    success_metric: str | None
    status: str
    result: str | None
    start_date: date | None
    end_date: date | None
    created_at: datetime


class RecommendationOut(ORM):
    id: uuid.UUID
    source: str
    title: str
    body: str | None
    priority: str
    status: str
    created_at: datetime


class RecommendationPatch(BaseModel):
    status: Literal["open", "accepted", "done", "dismissed"]


# ----------------------------------------------------------------------------- copilot & audit


class CopilotAskIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    thread_id: uuid.UUID | None = None


class CopilotMessageOut(ORM):
    id: uuid.UUID
    role: str
    content: str
    tool_calls: list[dict[str, Any]]
    references: list[dict[str, Any]]
    created_at: datetime


class CopilotThreadOut(ORM):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class CopilotThreadDetail(CopilotThreadOut):
    messages: list[CopilotMessageOut]


class AgentExecutionOut(ORM):
    id: uuid.UUID
    agent: str
    operation: str
    status: str
    model: str | None
    provider: str | None
    input_summary: str | None
    error: str | None
    attempts: int
    input_tokens: int
    output_tokens: int
    search_requests: int
    cost_usd: float
    started_at: datetime
    finished_at: datetime | None
    research_run_id: uuid.UUID | None


class AuditEventOut(ORM):
    id: uuid.UUID
    created_at: datetime
    actor: str
    action: str
    entity_type: str | None
    entity_id: str | None
    details: dict[str, Any]


# ----------------------------------------------------------------------------- shipping & channels


class ShippingOptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    leg: Literal["international", "domestic"] = "international"
    mode: ShippingMode
    provider: str | None = None
    origin: str | None = None
    destination: str | None = None
    rate_basis: RateBasis
    rate: float | None = Field(None, ge=0)
    rate_high: float | None = Field(None, ge=0)
    currency: str = "USD"
    min_charge: float | None = Field(None, ge=0)
    fixed_fees: float | None = Field(None, ge=0)
    volumetric_divisor: int | None = Field(None, ge=1000, le=10000)
    transit_days_min: int | None = Field(None, ge=0)
    transit_days_max: int | None = Field(None, ge=0)
    includes_duties: bool = False
    basis: Literal["assumption", "quote", "sourced_research"] = "assumption"
    source_url: str | None = None
    quote_date: date | None = None
    valid_until: date | None = None
    notes: str | None = None


class ShippingOptionOut(ORM):
    id: uuid.UUID
    name: str
    leg: str
    mode: str
    provider: str | None
    origin: str | None
    destination: str | None
    rate_basis: str
    rate: float | None
    rate_high: float | None
    currency: str
    min_charge: float | None
    fixed_fees: float | None
    volumetric_divisor: int | None
    transit_days_min: int | None
    transit_days_max: int | None
    includes_duties: bool
    basis: str
    source_url: str | None
    quote_date: date | None
    valid_until: date | None
    notes: str | None
    research_run_id: uuid.UUID | None
    created_at: datetime


class PackagingIn(BaseModel):
    units_per_carton: int = Field(gt=0)
    carton_length_cm: float = Field(gt=0)
    carton_width_cm: float = Field(gt=0)
    carton_height_cm: float = Field(gt=0)
    carton_gross_weight_kg: float = Field(gt=0)


class ShippingCompareIn(BaseModel):
    units: int = Field(gt=0, le=1_000_000)
    product_id: uuid.UUID | None = None
    packaging: PackagingIn | None = None
    option_ids: list[uuid.UUID] | None = None


class SalesChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    channel_type: ChannelType = "marketplace"
    platform: str | None = None
    status: ChannelStatus = "considering"
    price: float | None = Field(None, ge=0)
    commission_pct: float | None = Field(None, ge=0, le=100)
    per_order_fee: float | None = Field(None, ge=0)
    payment_fee_pct: float | None = Field(None, ge=0, le=100)
    payment_fee_fixed: float | None = Field(None, ge=0)
    monthly_fee: float | None = Field(None, ge=0)
    fulfillment_per_order: float | None = Field(None, ge=0)
    marketing_cac: float | None = Field(None, ge=0)
    return_rate_pct: float | None = Field(None, ge=0, le=100)
    expected_monthly_units: int | None = Field(None, ge=1)
    fee_basis: Literal["assumption", "verified", "sourced_research"] = "assumption"
    fee_source_url: str | None = None
    fees_checked_at: date | None = None
    audience_fit: str | None = None
    requirements: str | None = None
    pros: list[str] = []
    cons: list[str] = []
    notes: str | None = None


class SalesChannelOut(ORM):
    id: uuid.UUID
    name: str
    channel_type: str
    platform: str | None
    status: str
    price: float | None
    commission_pct: float | None
    per_order_fee: float | None
    payment_fee_pct: float | None
    payment_fee_fixed: float | None
    monthly_fee: float | None
    fulfillment_per_order: float | None
    marketing_cac: float | None
    return_rate_pct: float | None
    expected_monthly_units: int | None
    fee_basis: str
    fee_source_url: str | None
    fees_checked_at: date | None
    audience_fit: str | None
    requirements: str | None
    pros: list[str]
    cons: list[str]
    notes: str | None
    research_run_id: uuid.UUID | None
    created_at: datetime


class ScenarioOverridesIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    overrides: dict[str, float]
    input_basis: dict[str, Literal["assumption", "supplier_quote", "actual", "sourced_research"]] = {}
    notes: str | None = None
