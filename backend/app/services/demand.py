"""Demand / popularity signals from SerpApi (Google Trends, Amazon search, Google Shopping).

Every number in a finding is computed directly from the API response; the excerpt stored with
the source lists those same numbers, so findings are source-linked without any model involvement.
"""

from __future__ import annotations

import logging
import re
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
    series: list[tuple[str, float]] = field(default_factory=list)  # Google Trends weekly points (date label, 0-100)


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
    points: list[float] = []
    series: list[tuple[str, float]] = []
    for row in (data.get("interest_over_time") or {}).get("timeline_data") or []:
        for v in (row.get("values") or [])[:1]:
            if isinstance(v.get("extracted_value"), (int, float)):
                points.append(float(v["extracted_value"]))
                series.append((str(row.get("date") or ""), float(v["extracted_value"])))
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
        title=f"Google Trends: {kw} ({geo})", url=url, excerpts=[excerpt], series=series,
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


# ----------------------------------------------------------------------------- B2B supplier listings

B2B_SITES = ("alibaba.com", "made-in-china.com", "1688.com")


def b2b_listing_evidence(keywords: list[str], max_calls: int = 3) -> tuple[list[DemandObservation], list[str], int]:
    """Google results restricted to B2B marketplaces. Each result is its own source: title, link and Google's snippet,
    which for product pages usually shows the listed price range and minimum order."""
    obs: list[DemandObservation] = []
    errors: list[str] = []
    calls = 0
    kw = next(iter(dict.fromkeys(k.strip() for k in keywords if k.strip())), "")
    if not kw:
        return obs, errors, calls
    with httpx2.Client(timeout=40) as http:
        for site in B2B_SITES:
            if calls >= max_calls:
                break
            calls += 1
            try:
                data = _get(http, {"engine": "google", "q": f"site:{site} {kw}", "gl": "us", "hl": "en", "num": 10})
                for r in (data.get("organic_results") or [])[:10]:
                    link, title = r.get("link"), r.get("title")
                    if not link or not title:
                        continue
                    rich = ((r.get("rich_snippet") or {}).get("top") or {}).get("extensions") or []
                    text = " ".join(str(x) for x in [r.get("snippet") or "", *rich] if x).strip()
                    if text:
                        obs.append(DemandObservation(title=str(title)[:300], url=str(link), excerpts=[text[:1000]]))
            except Exception as e:  # noqa: BLE001
                log.warning("B2B listing search failed: %s", e)
                errors.append(str(e)[:300])
    return obs, errors, calls


# ----------------------------------------------------------------------------- comparable listings and reviews


@dataclass
class Candidate:
    """One retail listing as the marketplace API returned it. Every field is copied from the response."""
    platform: str  # Amazon | Etsy | Walmart | the store's name for brand sites
    title: str
    price: float
    url: str
    seller: str | None = None
    brand: str | None = None
    rating: float | None = None
    reviews: int | None = None
    badges: list[str] = field(default_factory=list)
    asin: str | None = None
    page_token: str | None = None  # Google immersive product token (store listings with reviews)

    def line(self) -> str:
        bits = [f"{self.title[:140]} - ${self.price:.2f} on {self.platform}"]
        if self.seller and self.seller != self.platform:
            bits.append(f"sold by {self.seller}")
        if self.rating is not None:
            bits.append(f"{self.rating:g} stars" + (f" ({self.reviews:,} reviews)" if self.reviews is not None else ""))
        if self.badges:
            bits.append("badges: " + "; ".join(self.badges))
        return " - ".join(bits)


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _badge_text(b: Any) -> str | None:
    if isinstance(b, str):
        return b.strip() or None
    if isinstance(b, dict):
        return next((str(b[k]).strip() for k in ("text", "label", "title", "name") if b.get(k)), None)
    return None


def _amazon_candidates(data: dict[str, Any]) -> list[Candidate]:
    out = []
    for r in data.get("organic_results") or []:
        price = _num(r.get("extracted_price"))
        if r.get("sponsored") or price is None or not r.get("title"):
            continue
        badges = [t for t in (_badge_text(b) for b in (r.get("badges") or [])) if t]
        for key, label in (("best_seller", "Best Seller"), ("amazons_choice", "Amazon's Choice"), ("amazon_choice", "Amazon's Choice")):
            if r.get(key) is True and label not in badges:
                badges.append(label)
        if r.get("bought_last_month"):
            badges.append(str(r["bought_last_month"]))
        rv = _num(r.get("reviews"))
        out.append(Candidate(platform="Amazon", title=str(r["title"])[:300], price=price, url=str(r.get("link_clean") or r.get("link") or ""),
                             brand=str(r["brand"])[:120] if r.get("brand") else None, rating=_num(r.get("rating")),
                             reviews=int(rv) if rv is not None else None, badges=badges[:5], asin=r.get("asin")))
    return out


_PLATFORM_SOURCES = {"etsy": "Etsy", "amazon": "Amazon", "walmart": "Walmart", "ebay": "eBay", "target": "Target", "temu": "Temu"}


def _shopping_candidates(data: dict[str, Any]) -> list[Candidate]:
    out = []
    for r in data.get("shopping_results") or []:
        price = _num(r.get("extracted_price"))
        if price is None or not r.get("title"):
            continue
        source = str(r.get("source") or "Unknown store")
        platform = next((v for k, v in _PLATFORM_SOURCES.items() if k in source.lower()), source)
        badges = [str(x) for x in (r.get("badge"), r.get("tag")) if x]
        rv = _num(r.get("reviews"))
        out.append(Candidate(platform=platform, title=str(r["title"])[:300], price=price, seller=source,
                             url=str(r.get("product_link") or r.get("link") or ""), rating=_num(r.get("rating")),
                             reviews=int(rv) if rv is not None else None, badges=badges[:4],
                             page_token=r.get("immersive_product_page_token")))
    return out


def _etsy_candidates(data: dict[str, Any]) -> list[Candidate]:
    """Etsy listing pages from Google results; Google's rich snippet shows the listing's rating, review count and price."""
    out = []
    for r in data.get("organic_results") or []:
        link, title = str(r.get("link") or ""), str(r.get("title") or "")
        if "etsy.com" not in link or "/listing/" not in link or not title:
            continue
        rich = (r.get("rich_snippet") or {})
        det: dict[str, Any] = {}
        texts: list[str] = []
        for part in (rich.get("top") or {}, rich.get("bottom") or {}):
            det.update(part.get("detected_extensions") or {})
            texts += [str(x) for x in part.get("extensions") or []]
        price = _num(det.get("price"))
        if price is None:
            m = re.search(r"\$\s?(\d+(?:\.\d{1,2})?)", " ".join(texts + [str(r.get("snippet") or "")]))
            price = float(m.group(1)) if m else None
        if price is None:
            continue
        rv = _num(det.get("reviews"))
        out.append(Candidate(platform="Etsy", title=re.sub(r"\s*[-|]\s*Etsy.*$", "", title)[:300], price=price, url=link.split("?")[0],
                             rating=_num(det.get("rating")), reviews=int(rv) if rv is not None else None))
    return out


def comparable_candidates(keywords: list[str], geo: str = "US", max_calls: int = 5) -> tuple[list[Candidate], list[DemandObservation], list[str], int]:
    """Retail listings for the keywords from Amazon search, Google Shopping (brand sites, Etsy, Walmart...) and Etsy via
    Google. Returns the de-duplicated candidates, one source per query (its excerpt lines list every candidate), errors, calls."""
    kws = [k for k in dict.fromkeys(k.strip() for k in keywords) if k][:2]
    plan: list[tuple[str, str]] = []
    if kws:
        plan = [("amazon", kws[0]), ("google_shopping", kws[0]), ("etsy", kws[0])]
        if len(kws) > 1:
            plan += [("amazon", kws[1]), ("google_shopping", kws[1])]
    cands: list[Candidate] = []
    obs: list[DemandObservation] = []
    errors: list[str] = []
    calls = 0
    with httpx2.Client(timeout=40) as http:
        for engine, kw in plan[:max_calls]:
            calls += 1
            try:
                if engine == "amazon":
                    found = _amazon_candidates(_get(http, {"engine": "amazon", "k": kw, "amazon_domain": "amazon.com"}))
                    title, url = f"Amazon search: {kw}", f"https://www.amazon.com/s?k={quote_plus(kw)}"
                elif engine == "google_shopping":
                    found = _shopping_candidates(_get(http, {"engine": "google_shopping", "q": kw, "gl": geo.lower(), "hl": "en"}))
                    title, url = f"Google Shopping: {kw}", f"https://www.google.com/search?tbm=shop&q={quote_plus(kw)}"
                else:
                    found = _etsy_candidates(_get(http, {"engine": "google", "q": f"site:etsy.com/listing {kw}", "gl": "us", "hl": "en", "num": 20}))
                    title, url = f"Etsy listings via Google: {kw}", f"https://www.etsy.com/search?q={quote_plus(kw)}"
                if found:
                    cands += found
                    obs.append(DemandObservation(title=title, url=url, excerpts=[c.line() for c in found[:60]]))
            except Exception as e:  # noqa: BLE001
                log.warning("Listing search failed: %s", e)
                errors.append(str(e)[:300])
    seen: dict[str, Candidate] = {}
    for c in cands:
        seen.setdefault(c.asin or c.url or c.title.lower()[:90], c)
    return list(seen.values()), obs, errors, calls


@dataclass
class ListingReviews:
    title: str
    url: str
    platform: str
    star_counts: dict[int, int] = field(default_factory=dict)  # stars -> count, or percent on Amazon
    star_unit: str = "reviews"
    low_star: list[dict[str, Any]] = field(default_factory=list)  # {stars, title, text, date, source}
    insights: list[str] = field(default_factory=list)  # Amazon "customers say" themes with negative or mixed sentiment


def _walk_reviews(obj: Any, found: list[dict[str, Any]]) -> None:
    """Any object in the response that looks like one review (a star rating plus text)."""
    if isinstance(obj, dict):
        stars, text = _num(obj.get("rating")), obj.get("text") or obj.get("content") or obj.get("snippet") or obj.get("body")
        if stars is not None and 1 <= stars <= 5 and isinstance(text, str) and len(text) > 15:
            found.append({"stars": int(stars), "title": str(obj.get("title") or "")[:200], "text": text[:1500],
                          "date": str(obj.get("date") or obj.get("review_submission_time") or "")[:40],
                          "source": str(obj.get("source") or "")[:80]})
            return
        for v in obj.values():
            _walk_reviews(v, found)
    elif isinstance(obj, list):
        for v in obj:
            _walk_reviews(v, found)


def listing_reviews(c: dict[str, Any], http: httpx2.Client) -> ListingReviews | None:
    """Low-star reviews for one tracked listing: Google's product panel (reviews from the stores selling it) or Amazon's
    product page (star breakdown and the review themes Amazon summarises)."""
    out = ListingReviews(title=str(c.get("title") or ""), url=str(c.get("url") or ""), platform=str(c.get("platform") or ""))
    if c.get("page_token"):
        data = _get(http, {"engine": "google_immersive_product", "page_token": c["page_token"]})
        pr = data.get("product_results") or {}
        for r in pr.get("ratings") or []:
            if _num(r.get("stars")) is not None and _num(r.get("amount")) is not None:
                out.star_counts[int(r["stars"])] = int(r["amount"])
        reviews: list[dict[str, Any]] = []
        _walk_reviews(pr.get("user_reviews") or [], reviews)
        out.low_star = [r for r in reviews if r["stars"] <= 3]
    elif c.get("asin"):
        data = _get(http, {"engine": "amazon_product", "asin": c["asin"], "amazon_domain": "amazon.com"})
        info = data.get("reviews_information") or {}
        summary = info.get("summary") or {}
        for label, v in (summary.get("customer_reviews") or {}).items():
            m = re.match(r"(\d)", str(label))
            if m and _num(v) is not None:
                out.star_counts[int(m.group(1))] = int(v)
        out.star_unit = "percent"
        for ins in summary.get("insights") or []:
            if str(ins.get("sentiment") or "").lower() in ("negative", "mixed"):
                ex = "; ".join(f'"{e.get("snippet")}"' for e in (ins.get("examples") or [])[:3] if e.get("snippet"))
                out.insights.append(f"{ins.get('title')} ({ins.get('sentiment')}, {ins.get('mentions') or '?'} mentions): "
                                    f"{ins.get('summary') or ''} {ex}".strip())
        reviews = []
        _walk_reviews({k: v for k, v in info.items() if k != "summary"}, reviews)
        out.low_star = [r for r in reviews if r["stars"] <= 3]
    else:
        return None
    return out
