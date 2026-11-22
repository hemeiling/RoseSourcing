"""Relational schema for AI Commerce OS.

Enumerated values are stored as strings (validated in the API layer) so new values
do not require Postgres enum migrations. Allowed values are documented in enums.py.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


Money = Numeric(14, 4)


# --------------------------------------------------------------------------- users & projects


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    display_name: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(32), default="member")  # owner | member
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class BusinessProject(IdMixin, TimestampMixin, Base):
    __tablename__ = "business_projects"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    product_category: Mapped[str] = mapped_column(String(200))
    target_country: Mapped[str] = mapped_column(String(100))
    sourcing_country: Mapped[str | None] = mapped_column(String(100))
    budget_usd: Mapped[Decimal | None] = mapped_column(Money)
    target_customers: Mapped[str | None] = mapped_column(Text)
    price_min: Mapped[Decimal | None] = mapped_column(Money)
    price_max: Mapped[Decimal | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    notes: Mapped[str | None] = mapped_column(Text)
    # Business assumptions the user is testing: [{label, value, status: hypothesis|validated|invalidated}]
    assumptions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(32), default="active")  # active | archived


# --------------------------------------------------------------------------- research


class ResearchRun(IdMixin, TimestampMixin, Base):
    __tablename__ = "research_runs"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(48))  # market_opportunity | competitor_discovery
    status: Mapped[str] = mapped_column(String(32), default="queued")
    provider: Mapped[str] = mapped_column(String(48))
    model: Mapped[str] = mapped_column(String(64))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # [{key, label, status, attempts, started_at, finished_at, error, findings_count, sources_count}]
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    current_step: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    search_requests: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Money, default=0)


class EvidenceSource(IdMixin, TimestampMixin, Base):
    """A retrieved document (web page, API record, manual reference) that findings cite."""

    __tablename__ = "evidence_sources"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    research_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("research_runs.id", ondelete="SET NULL"), index=True)
    url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    domain: Mapped[str | None] = mapped_column(String(255))
    source_type: Mapped[str] = mapped_column(String(32), default="web_search")  # web_search | api | manual | csv
    provider: Mapped[str | None] = mapped_column(String(48))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_hint: Mapped[str | None] = mapped_column(String(100))  # e.g. page_age from search results
    # Verbatim excerpts returned by the provider (not model-written).
    excerpts: Mapped[list[str]] = mapped_column(JSONB, default=list)


class MarketOpportunity(IdMixin, TimestampMixin, Base):
    """A structured opportunity report produced by a research run."""

    __tablename__ = "market_opportunities"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    research_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("research_runs.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(200))
    geography: Mapped[str] = mapped_column(String(100))
    budget_usd: Mapped[Decimal | None] = mapped_column(Money)
    attractiveness: Mapped[str | None] = mapped_column(String(32))  # AI inference label
    summary: Mapped[str | None] = mapped_column(Text)
    report: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class ResearchFinding(IdMixin, TimestampMixin, Base):
    __tablename__ = "research_findings"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    research_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("research_runs.id", ondelete="SET NULL"), index=True)
    market_opportunity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("market_opportunities.id", ondelete="SET NULL"), index=True
    )
    section: Mapped[str] = mapped_column(String(48), index=True)
    claim: Mapped[str] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text)
    evidence_type: Mapped[str] = mapped_column(String(32))  # sourced | ai_inference | assumption | unavailable
    confidence: Mapped[str] = mapped_column(String(16))  # high | medium | low
    verification_status: Mapped[str] = mapped_column(String(32))  # unverified | source_linked | human_verified | disputed
    metric: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # {name, value_low, value_high, unit, year}
    flags: Mapped[list[str]] = mapped_column(JSONB, default=list)  # automated quality warnings
    created_by: Mapped[str] = mapped_column(String(48), default="opportunity_research_agent")
    reviewer_note: Mapped[str | None] = mapped_column(Text)

    evidence_links: Mapped[list[FindingEvidence]] = relationship(
        back_populates="finding", cascade="all, delete-orphan", lazy="selectin"
    )


class FindingEvidence(Base):
    __tablename__ = "finding_evidence"

    finding_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("research_findings.id", ondelete="CASCADE"), primary_key=True)
    evidence_source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("evidence_sources.id", ondelete="CASCADE"), primary_key=True
    )
    quote: Mapped[str | None] = mapped_column(Text)

    finding: Mapped[ResearchFinding] = relationship(back_populates="evidence_links")
    source: Mapped[EvidenceSource] = relationship(lazy="joined")


class CustomerSegment(IdMixin, TimestampMixin, Base):
    __tablename__ = "customer_segments"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    research_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("research_runs.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    needs: Mapped[list[str]] = mapped_column(JSONB, default=list)
    unmet_needs: Mapped[list[str]] = mapped_column(JSONB, default=list)
    size_indicator: Mapped[str | None] = mapped_column(Text)
    evidence_type: Mapped[str] = mapped_column(String(32), default="ai_inference")
    confidence: Mapped[str] = mapped_column(String(16), default="low")
    source_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    priority: Mapped[int | None] = mapped_column(Integer)


# --------------------------------------------------------------------------- competitors


class Competitor(IdMixin, TimestampMixin, Base):
    __tablename__ = "competitors"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_competitor_project_name"),)

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(String(100))
    positioning: Mapped[str | None] = mapped_column(Text)
    price_tier: Mapped[str | None] = mapped_column(String(32))  # budget | mid | premium | luxury
    channels: Mapped[list[str]] = mapped_column(JSONB, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    on_watchlist: Mapped[bool] = mapped_column(Boolean, default=False)
    discovered_by: Mapped[str] = mapped_column(String(32), default="manual")  # ai_research | manual | csv
    evidence_source_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("evidence_sources.id", ondelete="SET NULL"))

    products: Mapped[list[CompetitorProduct]] = relationship(
        back_populates="competitor", cascade="all, delete-orphan", lazy="selectin"
    )


class CompetitorProduct(IdMixin, TimestampMixin, Base):
    __tablename__ = "competitor_products"

    competitor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("competitors.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    url: Mapped[str | None] = mapped_column(Text)
    product_type: Mapped[str | None] = mapped_column(String(100))  # e.g. latin dress, practice skirt
    material: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)

    competitor: Mapped[Competitor] = relationship(back_populates="products")
    price_observations: Mapped[list[PriceObservation]] = relationship(
        back_populates="product", cascade="all, delete-orphan", lazy="selectin", order_by="PriceObservation.observed_at"
    )


class PriceObservation(IdMixin, TimestampMixin, Base):
    __tablename__ = "price_observations"

    competitor_product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("competitor_products.id", ondelete="CASCADE"), index=True
    )
    price: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    source_url: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(32), default="manual")  # manual | web_search | csv | api
    evidence_source_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("evidence_sources.id", ondelete="SET NULL"))
    verification_status: Mapped[str] = mapped_column(String(32), default="unverified")
    note: Mapped[str | None] = mapped_column(Text)

    product: Mapped[CompetitorProduct] = relationship(back_populates="price_observations")


# --------------------------------------------------------------------------- brand


class BrandConcept(IdMixin, TimestampMixin, Base):
    __tablename__ = "brand_concepts"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # names | positioning | personas | voice | collections | palettes | messaging
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="draft")  # draft | shortlisted | selected | rejected
    brief: Mapped[str | None] = mapped_column(Text)
    agent_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))


# --------------------------------------------------------------------------- sourcing


class Supplier(IdMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    country: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    website: Mapped[str | None] = mapped_column(Text)
    platform: Mapped[str | None] = mapped_column(String(48))  # alibaba | 1688 | direct | trade_show | referral | other
    contact_name: Mapped[str | None] = mapped_column(String(200))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    capabilities: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # Certifications the supplier *claims*. Never treated as verified.
    certifications_claimed: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # unverified | documents_received | sample_approved | audited  (set only by the user)
    verification_status: Mapped[str] = mapped_column(String(32), default="unverified")
    quality_rating: Mapped[int | None] = mapped_column(Integer)  # 1-5, user's evaluation
    quality_notes: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(32), default="manual")  # manual | csv | integration

    quotes: Mapped[list[SupplierQuote]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan", lazy="selectin"
    )
    communications: Mapped[list[SupplierCommunication]] = relationship(
        back_populates="supplier",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="SupplierCommunication.occurred_at.desc()",
    )


class SupplierQuote(IdMixin, TimestampMixin, Base):
    __tablename__ = "supplier_quotes"

    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    product_concept_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_concepts.id", ondelete="SET NULL"))
    product_name: Mapped[str] = mapped_column(String(300))
    moq: Mapped[int | None] = mapped_column(Integer)
    unit_price: Mapped[Decimal | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    sample_cost: Mapped[Decimal | None] = mapped_column(Money)
    lead_time_days: Mapped[int | None] = mapped_column(Integer)
    incoterm: Mapped[str | None] = mapped_column(String(16))  # EXW | FOB | CIF | DDP ...
    est_freight_per_unit: Mapped[Decimal | None] = mapped_column(Money)
    quote_date: Mapped[date | None] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(32), default="manual")  # manual | csv | email | integration
    notes: Mapped[str | None] = mapped_column(Text)

    supplier: Mapped[Supplier] = relationship(back_populates="quotes")


class SupplierCommunication(IdMixin, TimestampMixin, Base):
    __tablename__ = "supplier_communications"

    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    channel: Mapped[str] = mapped_column(String(32), default="email")
    direction: Mapped[str] = mapped_column(String(16), default="outbound")  # inbound | outbound | draft
    subject: Mapped[str | None] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    next_action: Mapped[str | None] = mapped_column(Text)

    supplier: Mapped[Supplier] = relationship(back_populates="communications")


# --------------------------------------------------------------------------- product, commerce


class ProductConcept(IdMixin, TimestampMixin, Base):
    __tablename__ = "product_concepts"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    product_type: Mapped[str | None] = mapped_column(String(100))
    target_price: Mapped[Decimal | None] = mapped_column(Money)
    materials: Mapped[str | None] = mapped_column(Text)
    features: Mapped[list[str]] = mapped_column(JSONB, default=list)
    sizes: Mapped[list[str]] = mapped_column(JSONB, default=list)
    sku: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="idea")  # idea | sampling | approved | listed | retired
    inventory_on_hand: Mapped[int | None] = mapped_column(Integer)
    reorder_point: Mapped[int | None] = mapped_column(Integer)
    # Generated listing draft: {title, description, bullets[], tags[], seo_title, seo_description}
    listing_draft: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class CostScenario(IdMixin, TimestampMixin, Base):
    __tablename__ = "cost_scenarios"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # hypothetical | quote_based | actual | research_estimate
    scenario_type: Mapped[str] = mapped_column(String(32), default="hypothetical")
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Where each input value came from: {input_name: assumption | supplier_quote | actual | sourced_research}
    input_basis: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)
    results: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    supplier_quote_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("supplier_quotes.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(48), default="user")


class Experiment(IdMixin, TimestampMixin, Base):
    """A demand or pricing validation test (e.g. landing-page test, pre-order, sample poll)."""

    __tablename__ = "experiments"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    hypothesis: Mapped[str] = mapped_column(Text)
    method: Mapped[str | None] = mapped_column(Text)
    success_metric: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="planned")  # planned | running | completed | abandoned
    result: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)


class Recommendation(IdMixin, TimestampMixin, Base):
    __tablename__ = "recommendations"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(32))  # research | copilot | user
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(16), default="medium")  # high | medium | low
    status: Mapped[str] = mapped_column(String(32), default="open")  # open | accepted | done | dismissed
    finding_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    research_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("research_runs.id", ondelete="SET NULL"))


class AnalysisSnapshot(IdMixin, TimestampMixin, Base):
    """Saved AI analysis outputs (e.g. competitor positioning) for later review."""

    __tablename__ = "analysis_snapshots"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(48))  # competitor_positioning
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    agent_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))


class ApprovalRequest(IdMixin, TimestampMixin, Base):
    """Human approval checkpoint for any external or spending action."""

    __tablename__ = "approval_requests"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    action_type: Mapped[str] = mapped_column(String(48))  # publish_listing | purchase_inventory | launch_campaign
    title: Mapped[str] = mapped_column(String(300))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending | approved | rejected | executed | failed
    requested_by: Mapped[str] = mapped_column(String(48), default="user")
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    execution_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


# --------------------------------------------------------------------------- copilot


class CopilotThread(IdMixin, TimestampMixin, Base):
    __tablename__ = "copilot_threads"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300), default="New conversation")

    messages: Mapped[list[CopilotMessage]] = relationship(
        back_populates="thread", cascade="all, delete-orphan", lazy="selectin", order_by="CopilotMessage.created_at"
    )


class CopilotMessage(IdMixin, TimestampMixin, Base):
    __tablename__ = "copilot_messages"

    thread_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("copilot_threads.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    # [{tool, input, ok, summary}] - what the copilot looked up or did, as confirmed by the backend
    tool_calls: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    # [{type: finding|source|competitor|supplier|scenario, id, label, url}]
    references: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    agent_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_executions.id", ondelete="SET NULL"))

    thread: Mapped[CopilotThread] = relationship(back_populates="messages")


# --------------------------------------------------------------------------- audit


class AgentExecution(IdMixin, TimestampMixin, Base):
    __tablename__ = "agent_executions"

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    research_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("research_runs.id", ondelete="SET NULL"), index=True)
    agent: Mapped[str] = mapped_column(String(48))
    operation: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="running")  # running | succeeded | failed
    model: Mapped[str | None] = mapped_column(String(64))
    provider: Mapped[str | None] = mapped_column(String(48))
    input_summary: Mapped[str | None] = mapped_column(Text)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    search_requests: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Money, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEvent(IdMixin, Base):
    __tablename__ = "audit_events"

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("business_projects.id", ondelete="CASCADE"), index=True)
    actor: Mapped[str] = mapped_column(String(48), default="user")  # user | agent:<name> | system
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str | None] = mapped_column(String(48))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
