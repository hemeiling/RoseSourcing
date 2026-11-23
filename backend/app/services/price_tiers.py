"""Place competitors into the price tiers discovered for a product (deterministic, no AI).

A competitor's tier comes from its observed prices. When it has none, its name is matched against the marketplace
listings collected by the price-tier research (SerpApi, exact prices); matches are saved as source-linked price
observations, so the tier is traceable to a listing.
"""

from __future__ import annotations

import re
import statistics
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AnalysisSnapshot, Competitor, CompetitorProduct, EvidenceSource, PriceObservation

ORDER = ["budget", "mid", "premium", "luxury"]
LISTING_LINE = re.compile(r"^(?P<title>.+?) - \$(?P<price>[\d,]+(?:\.\d+)?)\b")


def latest_tiers(db: Session, project_id: uuid.UUID) -> tuple[list[dict[str, Any]], str | None]:
    snap = db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project_id, AnalysisSnapshot.kind == "price_tiers")
                      .order_by(AnalysisSnapshot.created_at.desc())).first()
    if not snap:
        return [], None
    tiers = [t for t in snap.content.get("tiers", []) if t.get("price_low") is not None and t.get("tier") in ORDER]
    return sorted(tiers, key=lambda t: ORDER.index(t["tier"])), snap.content.get("research_run_id")


def tier_for(price: float, tiers: list[dict[str, Any]]) -> str | None:
    """The tier whose range contains the price; between ranges, the highest tier starting at or below it."""
    if not tiers:
        return None
    for t in tiers:
        if t["price_low"] <= price <= (t["price_high"] if t["price_high"] is not None else t["price_low"]):
            return t["tier"]
    below = [t for t in tiers if t["price_low"] <= price]
    return (below[-1] if below else tiers[0])["tier"]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _listings(db: Session, run_id: str | None) -> list[dict[str, Any]]:
    if not run_id:
        return []
    out = []
    for src in db.scalars(select(EvidenceSource).where(EvidenceSource.research_run_id == uuid.UUID(run_id), EvidenceSource.provider == "serpapi")):
        for line in src.excerpts or []:
            m = LISTING_LINE.match(line)
            if m:
                out.append({"title": m["title"], "price": float(m["price"].replace(",", "")), "url": src.url, "source_id": src.id})
    return out


def apply_to_competitors(db: Session, project_id: uuid.UUID, *, overwrite: bool = False) -> dict[str, int]:
    """Set each competitor's price tier from its prices. Returns how many tiers were set and prices added."""
    tiers, run_id = latest_tiers(db, project_id)
    if not tiers:
        return {"updated": 0, "prices_added": 0}
    listings = _listings(db, run_id)
    updated = added = 0
    for comp in db.scalars(select(Competitor).where(Competitor.project_id == project_id)).all():
        prices = [float(o.price) for p in comp.products for o in p.price_observations if (o.currency or "USD").upper() == "USD"]
        key = _norm(comp.name)
        if not prices and len(key) >= 3:
            matches = [li for li in listings if f" {key} " in f" {_norm(li['title'])} "][:3]
            if matches:
                product = CompetitorProduct(competitor_id=comp.id, name=matches[0]["title"][:300], url=matches[0]["url"],
                                            notes="Matched by brand name in marketplace listings collected by price-tier research.")
                db.add(product)
                db.flush()
                for li in matches:
                    db.add(PriceObservation(competitor_product_id=product.id, price=Decimal(str(li["price"])), currency="USD",
                                            source_url=li["url"], source_type="api", evidence_source_id=li["source_id"],
                                            verification_status="source_linked", note=f"Listing: {li['title'][:200]}"))
                    prices.append(li["price"])
                    added += 1
        if prices and (overwrite or comp.price_tier in (None, "", "unknown")):
            tier = tier_for(statistics.median(prices), tiers)
            if tier and tier != comp.price_tier:
                comp.price_tier = tier
                updated += 1
    return {"updated": updated, "prices_added": added}
