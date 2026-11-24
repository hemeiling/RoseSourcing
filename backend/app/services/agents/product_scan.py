"""Product photo -> structured product identification (Claude vision), then optional auto-research."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...models import BusinessProject, User
from ..llm.anthropic_provider import get_llm
from .runtime import apply_usage, finish_execution, start_execution, with_retries

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_BYTES = 5 * 1024 * 1024
MAX_PHOTOS = 6  # photos of one product (front, back, label, packaging...) identified together


class ProductIdentification(BaseModel):
    is_product: bool = Field(description="False if the image shows neither a sellable physical product nor a drawing or design of one")
    image_kind: Literal["photo", "screenshot", "sketch_or_design"] = Field(
        "photo", description="sketch_or_design for hand drawings, design sketches, technical drawings, mock-ups or renders of a product idea")
    product_name: str = Field(description="Short generic name, e.g. 'Women's Latin dance practice dress'")
    research_category: str = Field(description="Category phrase to research the market for, e.g. 'Latin dance practice dresses'")
    product_type: str
    key_attributes: list[str] = Field(description="Visible design features: cut, sleeves, fringe, colors, closures...")
    materials_guess: list[str] = Field(description="Likely materials judged from appearance (uncertain)")
    style_tags: list[str]
    likely_customers: list[str]
    price_tier_guess: Literal["budget", "mid", "premium", "luxury", "unknown"]
    search_keywords: list[str] = Field(description="3-6 phrases shoppers would type on Amazon/Google for this product")
    visible_brand_or_text: str | None = Field(description="Any brand name, logo or text visible in the image, else null")
    ip_caution: str | None = Field(description="Warn if the design shows a logo, character or distinctive branded design that must not be copied")
    uncertainties: list[str]
    confidence: Literal["high", "medium", "low"]


SYSTEM = """You identify products from photos or screenshots for a founder deciding what to sell.
A hand drawing, design sketch, technical drawing, mock-up or render of a product idea counts as a product: identify the
product the founder intends to make, describe the design features shown, and list what the drawing leaves open (materials,
size, construction) in uncertainties.
Describe only what is visible; mark guesses (materials, price tier) as uncertain. Use generic product names -
never present a brand's product as the founder's own. If a logo, character or distinctive branded design is visible,
say so in ip_caution. Search keywords must be generic phrases real shoppers use, not brand names."""


def identify(db: Session, user: User, images: list[tuple[str, bytes]], *, target_country: str, sourcing_country: str | None,
             project: BusinessProject | None = None) -> tuple[ProductIdentification, object]:
    """Identify one product from its photos (media type, bytes); several photos are views of the same item."""
    llm = get_llm()
    size = sum(len(d) for _, d in images) // 1024
    ex = start_execution(db, agent="opportunity_research", operation="identify_product_photo", project_id=project.id if project else None,
                         user_id=user.id, model=llm.model,
                         input_summary=f"{len(images)} product photo{'s' if len(images) != 1 else ''} ({size} KB)")
    db.commit()
    prompt = (
        f"The founder's market is {target_country}"
        + (f" and they plan to source from {sourcing_country}" if sourcing_country else "")
        + (". Identify the product in this image so its market can be researched." if len(images) == 1 else
           f". These {len(images)} images all show the same product (different angles, details, labels or packaging). "
           "Identify it from all of them together so its market can be researched.")
    )
    try:
        out, usage = with_retries(lambda: llm.structured(system=SYSTEM, prompt=prompt, output_model=ProductIdentification,
                                                          max_tokens=4000, images=images))
    except Exception as e:
        finish_execution(ex, error=str(e)[:2000])
        db.commit()
        raise
    apply_usage(ex, usage)
    finish_execution(ex, output=out.model_dump())
    return out, ex
