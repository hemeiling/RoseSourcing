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


class ProductIdentification(BaseModel):
    is_product: bool = Field(description="False if the image does not show a sellable physical product")
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
Describe only what is visible; mark guesses (materials, price tier) as uncertain. Use generic product names -
never present a brand's product as the founder's own. If a logo, character or distinctive branded design is visible,
say so in ip_caution. Search keywords must be generic phrases real shoppers use, not brand names."""


def identify(db: Session, project: BusinessProject, user: User, media_type: str, data: bytes) -> tuple[ProductIdentification, object]:
    llm = get_llm()
    ex = start_execution(db, agent="opportunity_research", operation="identify_product_photo", project_id=project.id,
                         user_id=user.id, model=llm.model, input_summary=f"Product photo ({media_type}, {len(data) // 1024} KB)")
    db.commit()
    prompt = (
        f"The founder's market is {project.target_country}"
        + (f" and they plan to source from {project.sourcing_country}" if project.sourcing_country else "")
        + ". Identify the product in this image so its market can be researched."
    )
    try:
        out, usage = with_retries(lambda: llm.structured(system=SYSTEM, prompt=prompt, output_model=ProductIdentification,
                                                          max_tokens=4000, images=[(media_type, data)]))
    except Exception as e:
        finish_execution(ex, error=str(e)[:2000])
        db.commit()
        raise
    apply_usage(ex, usage)
    finish_execution(ex, output=out.model_dump())
    return out, ex
