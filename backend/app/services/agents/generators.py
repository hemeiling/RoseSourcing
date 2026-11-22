"""Brand Strategy, Sourcing, Commerce and Competitor-positioning generators.

Each is a single bounded LLM call with a validated schema, tracked as an AgentExecution.
They read only the project's stored records; outputs are labelled as AI-generated drafts.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import (
    BusinessProject,
    Competitor,
    CustomerSegment,
    MarketOpportunity,
    ProductConcept,
    ResearchFinding,
    Supplier,
    User,
)
from ..llm.anthropic_provider import get_llm
from ..llm.base import LLMUsage, T
from .runtime import apply_usage, finish_execution, start_execution, with_retries

# ----------------------------------------------------------------------------- shared context


def project_brief(db: Session, project: BusinessProject, *, max_findings: int = 25) -> str:
    """Compact, labelled summary of what the project knows. Used as grounding for generators."""
    lines = [
        f"Project: {project.name}",
        f"Category: {project.product_category} | Market: {project.target_country} | Sourcing: {project.sourcing_country or 'n/a'}",
        f"Budget: {float(project.budget_usd):,.0f} USD" if project.budget_usd is not None else "Budget: not set",
        f"Target customers (founder hypothesis): {project.target_customers or 'not set'}",
    ]
    if project.price_min is not None and project.price_max is not None:
        lines.append(f"Price hypothesis: ${float(project.price_min):.0f}-${float(project.price_max):.0f}")
    opp = db.scalars(
        select(MarketOpportunity).where(MarketOpportunity.project_id == project.id).order_by(MarketOpportunity.created_at.desc())
    ).first()
    if opp:
        lines.append(f"Latest opportunity assessment ({opp.attractiveness}, AI synthesis): {opp.summary}")
        diffs = (opp.report or {}).get("differentiation") or []
        if diffs:
            lines.append("Differentiation ideas from research: " + "; ".join(d["idea"] for d in diffs[:5]))
    segs = db.scalars(select(CustomerSegment).where(CustomerSegment.project_id == project.id).limit(8)).all()
    for s in segs:
        lines.append(f"Segment ({s.evidence_type}): {s.name} - {s.description or ''} Unmet needs: {', '.join(s.unmet_needs or [])}")
    findings = db.scalars(
        select(ResearchFinding)
        .where(ResearchFinding.project_id == project.id, ResearchFinding.evidence_type.in_(["sourced", "ai_inference"]))
        .order_by(ResearchFinding.created_at.desc())
        .limit(max_findings)
    ).all()
    for f in findings:
        lines.append(f"Finding [{f.section}, {f.evidence_type}, {f.verification_status}]: {f.claim}")
    comps = db.scalars(select(Competitor).where(Competitor.project_id == project.id).limit(15)).all()
    for c in comps:
        lines.append(f"Competitor: {c.name} ({c.price_tier or 'tier unknown'}) - {c.positioning or 'positioning unknown'}")
    return "\n".join(lines)


def _run(
    db: Session,
    *,
    agent: str,
    operation: str,
    project: BusinessProject,
    user: User,
    system: str,
    prompt: str,
    output_model: type[T],
) -> tuple[T, LLMUsage, Any]:
    llm = get_llm()
    ex = start_execution(db, agent=agent, operation=operation, project_id=project.id, user_id=user.id,
                         model=llm.model, input_summary=prompt[-1500:])
    db.commit()
    try:
        out, usage = with_retries(lambda: llm.structured(system=system, prompt=prompt, output_model=output_model))
    except Exception as e:
        finish_execution(ex, error=str(e)[:2000])
        db.commit()
        raise
    apply_usage(ex, usage)
    finish_execution(ex, output=out.model_dump())
    return out, usage, ex


DRAFT_RULES = (
    "Ground ideas in the project context provided. Do not invent statistics, certifications, awards, customer quotes, "
    "or claims about competitors. Where an idea rests on an untested assumption, say so briefly."
)

# ----------------------------------------------------------------------------- brand studio


class NameIdea(BaseModel):
    name: str
    rationale: str
    style: str = Field(description="e.g. evocative, descriptive, invented, Spanish-inspired")


class NamesOut(BaseModel):
    ideas: list[NameIdea]


class PositioningOut(BaseModel):
    statement: str
    target_customer: str
    frame_of_reference: str
    points_of_difference: list[str]
    reasons_to_believe: list[str]
    assumptions_to_validate: list[str]


class Persona(BaseModel):
    name: str
    summary: str
    dance_context: str = Field(description="How/where they engage with the category")
    goals: list[str]
    frustrations: list[str]
    buying_triggers: list[str]
    channels: list[str]
    grounding: str = Field(description="Which project findings/segments this persona is based on, or 'hypothesis'")


class PersonasOut(BaseModel):
    personas: list[Persona]


class VoiceTrait(BaseModel):
    trait: str
    do: str
    dont: str


class VoiceOut(BaseModel):
    summary: str
    traits: list[VoiceTrait]
    sample_lines: list[str]
    words_to_avoid: list[str]


class CollectionPiece(BaseModel):
    name: str
    description: str
    target_price: float | None


class Collection(BaseModel):
    name: str
    theme: str
    target_segment: str
    pieces: list[CollectionPiece]
    rationale: str


class CollectionsOut(BaseModel):
    collections: list[Collection]


class Swatch(BaseModel):
    name: str
    hex: str = Field(description="Hex color like #1A2B3C")
    usage: str


class Palette(BaseModel):
    name: str
    mood: str
    colors: list[Swatch]


class PalettesOut(BaseModel):
    palettes: list[Palette]


class MessagingOut(BaseModel):
    taglines: list[str]
    value_propositions: list[str]
    ad_hooks: list[str]
    email_subject_lines: list[str]
    product_page_headline: str


BRAND_KINDS: dict[str, tuple[type[BaseModel], str]] = {
    "names": (NamesOut, "Brainstorm 12 brand name ideas. Note: trademark and domain availability have NOT been checked."),
    "positioning": (PositioningOut, "Write a brand positioning statement and its building blocks."),
    "personas": (PersonasOut, "Create 3 customer personas based on the segments and findings. Personas are illustrative composites, not real people."),
    "voice": (VoiceOut, "Define the brand voice with 4-5 traits, do/don't guidance, and sample lines."),
    "collections": (CollectionsOut, "Propose 2-3 product collection concepts suitable for a small first production run within the budget."),
    "palettes": (PalettesOut, "Propose 3 brand color palettes (5 colors each) with usage notes, suited to the category and positioning."),
    "messaging": (MessagingOut, "Write marketing messages: taglines, value propositions, ad hooks, email subject lines, and a product page headline."),
}


def generate_brand(db: Session, project: BusinessProject, user: User, kind: str, brief: str | None) -> tuple[dict[str, Any], Any]:
    model, instruction = BRAND_KINDS[kind]
    system = "You are a brand strategist for small direct-to-consumer product businesses. " + DRAFT_RULES
    prompt = (
        f"Project context:\n{project_brief(db, project)}\n\n"
        f"Founder's brief: {brief or '(none)'}\n\nTask: {instruction}"
    )
    out, _usage, ex = _run(db, agent="brand_strategy", operation=f"brand:{kind}", project=project, user=user,
                           system=system, prompt=prompt, output_model=model)
    return out.model_dump(), ex


# ----------------------------------------------------------------------------- sourcing


class RfqDraft(BaseModel):
    subject: str
    body: str
    questions_to_ask: list[str]


def draft_rfq(db: Session, project: BusinessProject, user: User, supplier: Supplier, product: ProductConcept | None,
              notes: str | None) -> tuple[RfqDraft, Any]:
    system = (
        "You draft clear, professional request-for-quotation emails from a small brand to an overseas apparel manufacturer. "
        "Ask for specifics (unit price at several quantities, MOQ, sample cost and lead time, production lead time, materials, "
        "size range, labeling, packaging, payment terms, Incoterms). Do not claim volumes or facts the founder has not stated."
    )
    prod = (
        f"Product: {product.name}\nDescription: {product.description or ''}\nMaterials: {product.materials or 'TBD'}\n"
        f"Sizes: {', '.join(product.sizes or []) or 'TBD'}\nTarget retail price: {product.target_price or 'TBD'}"
        if product else "Product: general inquiry for the project's category"
    )
    prompt = (
        f"Project context:\n{project_brief(db, project, max_findings=5)}\n\nSupplier: {supplier.name} ({supplier.country or 'country unknown'})\n"
        f"Capabilities on file: {', '.join(supplier.capabilities or []) or 'unknown'}\n{prod}\n"
        f"Founder notes: {notes or '(none)'}\n\nDraft the RFQ email."
    )
    out, _u, ex = _run(db, agent="sourcing", operation="draft_rfq", project=project, user=user,
                       system=system, prompt=prompt, output_model=RfqDraft)
    return out, ex


# ----------------------------------------------------------------------------- commerce


class ListingDraft(BaseModel):
    title: str
    description: str
    bullets: list[str]
    tags: list[str]
    seo_title: str
    seo_description: str
    size_guidance_note: str
    claims_to_verify: list[str] = Field(description="Any statements in the listing the founder must verify before publishing")


def generate_listing(db: Session, project: BusinessProject, user: User, product: ProductConcept) -> tuple[ListingDraft, Any]:
    system = (
        "You write e-commerce product listings for a small dancewear/apparel brand. "
        "Only describe attributes provided (materials, features, sizes). No superlatives you can't back up, no certifications, "
        "no health claims. List anything that needs verification in claims_to_verify."
    )
    prompt = (
        f"Project context:\n{project_brief(db, project, max_findings=8)}\n\n"
        f"Product: {product.name}\nType: {product.product_type or ''}\nDescription: {product.description or ''}\n"
        f"Materials: {product.materials or 'not specified'}\nFeatures: {', '.join(product.features or []) or 'not specified'}\n"
        f"Sizes: {', '.join(product.sizes or []) or 'not specified'}\nTarget price: {product.target_price or 'not set'}\n\n"
        "Write the listing draft."
    )
    out, _u, ex = _run(db, agent="commerce", operation="generate_listing", project=project, user=user,
                       system=system, prompt=prompt, output_model=ListingDraft)
    return out, ex


# ----------------------------------------------------------------------------- competitor positioning


class CompetitorPosition(BaseModel):
    name: str
    price_position: int = Field(description="1 (lowest price) to 5 (highest), based on observed prices where available")
    specialization: int = Field(description="1 (general activewear) to 5 (highly specialised for the category)")
    basis: Literal["observed_prices", "stated_positioning", "inference"]
    rationale: str


class PositioningAnalysis(BaseModel):
    summary: str
    positions: list[CompetitorPosition]
    white_space: list[str]
    differentiation_options: list[str]
    caveats: list[str]


def analyze_positioning(db: Session, project: BusinessProject, user: User) -> tuple[PositioningAnalysis, Any]:
    comps = db.scalars(select(Competitor).where(Competitor.project_id == project.id)).all()
    lines = []
    for c in comps:
        prices = [f"{po.currency} {float(po.price):.2f} for {p.name} ({po.verification_status}, observed {po.observed_at:%Y-%m-%d})"
                  for p in c.products for po in p.price_observations]
        lines.append(
            f"- {c.name} | tier: {c.price_tier or 'unknown'} | channels: {', '.join(c.channels or []) or 'unknown'} | "
            f"positioning: {c.positioning or 'unknown'} | prices: {'; '.join(prices) or 'none recorded'} | notes: {c.notes or ''}"
        )
    system = (
        "You analyse competitive positioning using only the competitor records provided. Mark each position's basis honestly: "
        "observed_prices only when price observations exist. Identify white space cautiously and list caveats about data gaps."
    )
    prompt = (
        f"Project context:\n{project_brief(db, project, max_findings=10)}\n\nCompetitor records:\n" + "\n".join(lines) +
        "\n\nProduce the positioning analysis."
    )
    out, _u, ex = _run(db, agent="competitor_intelligence", operation="positioning_analysis", project=project, user=user,
                       system=system, prompt=prompt, output_model=PositioningAnalysis)
    return out, ex
