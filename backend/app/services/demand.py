"""Demand / popularity signals from SerpApi (Google Trends, Amazon search, Google Shopping).

Every number in a finding is computed directly from the API response; the excerpt stored with
the source lists those same numbers, so findings are source-linked without any model involvement.
"""

from __future__ import annotations

import logging
import statistics
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote_plus

import httpx2

from ..config import get_settings
from . import connectors

log = logging.getLogger(__name__)
SERPAPI_URL = "https://serpapi.com/search.json"


@dataclass
class DemandFinding:
    claim: str
    detail: str
    confidence: str
    metric: dict[str, Any] | None = None


@dataclass
class DemandObservation:
    title: str
    url: str
    excerpts: list[str]
    findings: list[DemandFinding] = field(default_factory=list)


def configured() -> bool:
    return connectors.is_configured("serpapi")


def _get(http: httpx2.Client, params: dict[str, Any]) -> dict[str, Any]:
    key = connectors.get_value("serpapi", "api_key")
    r = http.get(SERPAPI_URL, params={**params, "api_key": key})
    if r.status_code != 200:
        raise RuntimeError(f"SerpApi {params.get('engine')} returned HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    if data.get("error"):
        raise RuntimeError(f"SerpApi {params.get('engine')}: {data['error']}")
    return data


def _median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def trends(http: httpx2.Client, kw: str, geo: str) -> DemandObservation | None:
    data = _get(http, {"engine": "google_trends", "q": kw, "geo": geo, "date": "today 12-m", "data_type": "TIMESERIES"})
    points = []
    for row in (data.get("interest_over_time") or {}).get("timeline_data") or []:
        for v in row.get("values") or []:
            if isinstance(v.get("extracted_value"), (int, float)):
                points.append(float(v["extracted_value"]))
    if not points:
        return None
    avg = sum(points) / len(points)
    recent = points[-13:]
    prior = points[:-13] or points
    r_avg, p_avg = sum(recent) / len(recent), sum(prior) / len(prior)
    change = ((r_avg - p_avg) / p_avg * 100) if p_avg else None
    url = f"https://trends.google.com/trends/explore?date=today%2012-m&geo={geo}&q={quote_plus(kw)}"
    excerpt = (f"Google Trends ({geo}, past 12 months, {len(points)} weekly points) for '{kw}': average {avg:.0f}/100, "
               f"peak {max(points):.0f}/100, last 13 weeks average {r_avg:.0f}/100 vs prior average {p_avg:.0f}/100"
               + (f" ({change:+.0f}%)." if change is not None else "."))
    trend_word = "rising" if change is not None and change > 15 else "falling" if change is not None and change < -15 else "steady"
    return DemandObservation(
        title=f"Google Trends: {kw} ({geo})", url=url, excerpts=[excerpt],
        findings=[DemandFinding(
            claim=f"Google search interest for '{kw}' in {geo} is {trend_word}: last 13 weeks average {r_avg:.0f}/100 vs {p_avg:.0f}/100 before"
                  + (f" ({change:+.0f}%)." if change is not None else "."),
            detail=f"12-month average {avg:.0f}/100, peak {max(points):.0f}/100. Trends values are relative (100 = peak "
                   "popularity in the period), not absolute search volumes.",
            confidence="medium",
            metric={"name": f"Google Trends interest ({kw})", "value_low": round(r_avg, 1), "value_high": None,
                    "unit": "index 0-100 (last 13 weeks)", "year": "past 12 months"},
        )],
    )


def amazon(http: httpx2.Client, kw: str) -> DemandObservation | None:
    data = _get(http, {"engine": "amazon", "k": kw, "amazon_domain": "amazon.com"})
    results = [r for r in (data.get("organic_results") or []) if not r.get("sponsored")][:20]
    if not results:
        return None
    reviews = [float(r["reviews"]) for r in results[:10] if isinstance(r.get("reviews"), (int, float))]
    prices = [float(r["extracted_price"]) for r in results if isinstance(r.get("extracted_price"), (int, float))]
    badges = [r["bought_last_month"] for r in results if r.get("bought_last_month")]
    url = f"https://www.amazon.com/s?k={quote_plus(kw)}"
    lines = [f"Amazon US search '{kw}': {len(results)} organic results on page 1."]
    findings: list[DemandFinding] = []
    if reviews:
        med = _median(reviews)
        lines.append(f"Top {len(reviews)} organic results: median {med:,.0f} ratings, max {max(reviews):,.0f}.")
        findings.append(DemandFinding(
            claim=f"Top Amazon results for '{kw}' have a median of {med:,.0f} ratings (max {max(reviews):,.0f}).",
            detail="Ratings counts indicate accumulated sales and how established incumbents are; a high median means a "
                   "crowded market with entrenched listings.", confidence="medium",
            metric={"name": f"Median Amazon ratings, top results ({kw})", "value_low": med, "value_high": None, "unit": "ratings", "year": None},
        ))
    lines.append(f"{len(badges)} of {len(results)} results show a 'bought in past month' badge"
                 + (f": {', '.join(badges[:5])}." if badges else "."))
    findings.append(DemandFinding(
        claim=f"{len(badges)} of {len(results)} page-1 Amazon results for '{kw}' show a 'bought in past month' badge"
              + (f" (e.g. {badges[0]})." if badges else "."),
        detail="Amazon shows this badge only above a sales threshold, so it is a direct (rounded) recent-sales signal.",
        confidence="medium",
    ))
    if prices:
        lines.append(f"Listed prices: ${min(prices):.2f} to ${max(prices):.2f}, median ${_median(prices):.2f}.")
        findings.append(DemandFinding(
            claim=f"Page-1 Amazon prices for '{kw}' range ${min(prices):.2f}-${max(prices):.2f} (median ${_median(prices):.2f}).",
            detail="Snapshot of listed prices on the search page; excludes sponsored results.", confidence="medium",
            metric={"name": f"Amazon page-1 price ({kw})", "value_low": round(min(prices), 2), "value_high": round(max(prices), 2), "unit": "USD", "year": None},
        ))
    return DemandObservation(title=f"Amazon search: {kw}", url=url, excerpts=[" ".join(lines)], findings=findings)


def shopping(http: httpx2.Client, kw: str) -> DemandObservation | None:
    data = _get(http, {"engine": "google_shopping", "q": kw, "gl": "us", "hl": "en"})
    results = data.get("shopping_results") or []
    if not results:
        return None
    prices = [float(r["extracted_price"]) for r in results if isinstance(r.get("extracted_price"), (int, float))]
    sources = sorted({r.get("source") for r in results if r.get("source")})
    url = f"https://www.google.com/search?tbm=shop&q={quote_plus(kw)}"
    line = f"Google Shopping US '{kw}': {len(results)} listings from {len(sources)} sellers"
    if prices:
        line += f"; prices ${min(prices):.2f} to ${max(prices):.2f}, median ${_median(prices):.2f}."
    findings = [DemandFinding(
        claim=f"Google Shopping shows {len(results)} listings for '{kw}' from {len(sources)} different sellers"
              + (f", median price ${_median(prices):.2f}." if prices else "."),
        detail="Many distinct sellers indicate an established category with active retail competition. Sellers include: "
               + ", ".join(sources[:8]) + ("..." if len(sources) > 8 else ""),
        confidence="medium",
        metric={"name": f"Google Shopping median price ({kw})", "value_low": round(_median(prices), 2), "value_high": None,
                "unit": "USD", "year": None} if prices else None,
    )]
    return DemandObservation(title=f"Google Shopping: {kw}", url=url, excerpts=[line], findings=findings)


def collect(keywords: list[str], geo: str = "US") -> tuple[list[DemandObservation], list[str], int]:
    """Run up to MAX_DEMAND_API_CALLS SerpApi queries across the keywords. Returns observations, errors, calls made."""
    budget = get_settings().max_demand_api_calls
    obs: list[DemandObservation] = []
    errors: list[str] = []
    calls = 0
    with httpx2.Client(timeout=40) as http:
        for kw in [k for k in dict.fromkeys(k.strip() for k in keywords) if k][:2]:
            for fn in (lambda: trends(http, kw, geo), lambda: amazon(http, kw), lambda: shopping(http, kw)):
                if calls >= budget:
                    break
                calls += 1
                try:
                    o = fn()
                    if o:
                        obs.append(o)
                except Exception as e:  # noqa: BLE001 - record and keep going with other sources
                    log.warning("Demand signal failed: %s", e)
                    errors.append(str(e)[:300])
    return obs, errors, calls


# ----------------------------------------------------------------------------- price tiers


@dataclass
class Listing:
    title: str
    price: float
    rating: float | None
    reviews: int | None
    seller: str


def _listing_line(x: Listing) -> str:
    bits = [f"{x.title[:110]} - ${x.price:.2f}"]
    if x.rating is not None:
        bits.append(f"{x.rating:g} stars" + (f" ({x.reviews:,} ratings)" if x.reviews is not None else ""))
    bits.append(x.seller)
    return " - ".join(bits)


def _tier_lines(listings: list[Listing]) -> list[str]:
    """Split listings into four price tiers by quartile and describe each with exact numbers."""
    prices = sorted(x.price for x in listings)
    q1, q2, q3 = statistics.quantiles(prices, n=4, method="inclusive")
    bands = [("Budget tier (lowest 25% of prices)", lambda p: p <= q1), ("Mid tier", lambda p: q1 < p <= q2),
             ("Premium tier", lambda p: q2 < p <= q3), ("Luxury tier (highest 25% of prices)", lambda p: p > q3)]
    lines = [f"Price tiers across {len(listings)} US marketplace listings: quartile boundaries ${q1:.2f}, ${q2:.2f}, ${q3:.2f}."]
    for name, inside in bands:
        tier = [x for x in listings if inside(x.price)]
        if not tier:
            continue
        ratings = [x.rating for x in tier if x.rating is not None]
        counts = [x.reviews for x in tier if x.reviews is not None]
        sellers = sorted({x.seller for x in tier})
        top = sorted(tier, key=lambda x: x.reviews or 0, reverse=True)[:3]
        lines.append(
            f"{name}: {len(tier)} listings priced ${min(x.price for x in tier):.2f} to ${max(x.price for x in tier):.2f}"
            + (f", median rating {statistics.median(ratings):.1f} stars" if ratings else "")
            + (f", median {statistics.median(counts):,.0f} ratings" if counts else "")
            + f"; sellers include {', '.join(sellers[:5])}; most-reviewed: "
            + "; ".join(f"{x.title[:60]} (${x.price:.2f})" for x in top) + "."
        )
    return lines


def price_tier_evidence(keywords: list[str], geo: str = "US", max_calls: int = 4) -> tuple[list[DemandObservation], list[str], int]:
    """Amazon and Google Shopping listings for the keywords, plus a quartile price-tier summary - every number from the API."""
    listings: list[Listing] = []
    obs: list[DemandObservation] = []
    errors: list[str] = []
    calls = 0
    with httpx2.Client(timeout=40) as http:
        for kw in [k for k in dict.fromkeys(k.strip() for k in keywords) if k][:2]:
            for engine in ("amazon", "google_shopping"):
                if calls >= max_calls:
                    break
                calls += 1
                try:
                    if engine == "amazon":
                        data = _get(http, {"engine": "amazon", "k": kw, "amazon_domain": "amazon.com"})
                        rows = [r for r in (data.get("organic_results") or []) if not r.get("sponsored")]
                        found = [Listing(str(r.get("title") or "")[:200], float(r["extracted_price"]),
                                         float(r["rating"]) if isinstance(r.get("rating"), (int, float)) else None,
                                         int(r["reviews"]) if isinstance(r.get("reviews"), (int, float)) else None, "Amazon")
                                 for r in rows if isinstance(r.get("extracted_price"), (int, float)) and r.get("title")]
                        url, title = f"https://www.amazon.com/s?k={quote_plus(kw)}", f"Amazon listings: {kw}"
                    else:
                        data = _get(http, {"engine": "google_shopping", "q": kw, "gl": geo.lower(), "hl": "en"})
                        rows = data.get("shopping_results") or []
                        found = [Listing(str(r.get("title") or "")[:200], float(r["extracted_price"]),
                                         float(r["rating"]) if isinstance(r.get("rating"), (int, float)) else None,
                                         int(r["reviews"]) if isinstance(r.get("reviews"), (int, float)) else None, str(r.get("source") or "Unknown seller"))
                                 for r in rows if isinstance(r.get("extracted_price"), (int, float)) and r.get("title")]
                        url, title = f"https://www.google.com/search?tbm=shop&q={quote_plus(kw)}", f"Google Shopping listings: {kw}"
                    if found:
                        listings += found
                        obs.append(DemandObservation(title=title, url=url, excerpts=[_listing_line(x) for x in found[:40]]))
                except Exception as e:  # noqa: BLE001
                    log.warning("Price-tier listings failed: %s", e)
                    errors.append(str(e)[:300])
    unique = list({(x.title.lower()[:80], round(x.price, 2)): x for x in listings if x.price > 0}.values())
    if len(unique) >= 8:
        kw0 = next(iter(dict.fromkeys(k.strip() for k in keywords if k.strip())), "")
        obs.insert(0, DemandObservation(title=f"Price tiers from {len(unique)} marketplace listings",
                                        url=f"https://www.google.com/search?tbm=shop&q={quote_plus(kw0)}", excerpts=_tier_lines(unique)))
    return obs, errors, calls
