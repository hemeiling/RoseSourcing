"""Listing Tracker and Review Insights agents.

Listing Tracker: Google Trends interest plus 15-20 retail listings directly comparable to the product, across Amazon,
Etsy and brand sites, each logged with its price, rating, review count and badges as the marketplace API returned them.
The AI only chooses which listings are comparable; every number comes from the API.

Review Insights: low-star reviews of the leading tracked listings (Google's product panel and Amazon's product page via
SerpApi, plus web research), tagged for comfort, fit and durability complaints. A tagged quote is kept only if it
appears word for word in the source it cites.
"""

from __future__ import annotations

import logging
import statistics
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import httpx2
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ... import audit
from ...db import session_scope
from ...models import (
    AgentExecution,
    AnalysisSnapshot,
    Competitor,
    CompetitorProduct,
    EvidenceSource,
    FindingEvidence,
    PriceObservation,
    Recommendation,
    ResearchFinding,
    ResearchRun,
)
from .. import demand
from ..llm.anthropic_provider import get_llm
from ..llm.base import LLMUsage
from ..price_tiers import apply_to_competitors
from .runtime import apply_usage, finish_execution, start_execution, with_retries

log = logging.getLogger(__name__)

TARGET_MIN, TARGET_MAX = 15, 20
REVIEW_LISTINGS = 6
REVIEW_TAGS = ("comfort", "fit", "durability", "quality", "appearance", "value", "shipping", "other")
# Fetched pages are cut down to passages that read like reviews or complaints (most carry no figures).
REVIEW_PASSAGES = (r"(?i)\b(stars?|reviews?|returned|return|tight|loose|headache|hurts?|pain|pinch|slip|slides?|fell|fray|ripped|tore|"
                   r"broke|stretch|cheap|thin|flimsy|uncomfortable|disappoint|itch|scratch|smell|faded|color|colour|size|small|large)\b")


class PickedListing(BaseModel):
    index: int = Field(description="The candidate's number in the list")
    brand: str | None = Field(description="Brand or shop name only if the title or seller shows it, otherwise null")
    why_comparable: str = Field(description="A few words: why it matches the product")


class ListingPick(BaseModel):
    picked: list[PickedListing]
    left_out: str = Field(description="One sentence: which kinds of listings were left out and why")


class TaggedReview(BaseModel):
    source_ref: str = Field(description="The S-ref of the source the quote is copied from")
    product: str = Field(description="The product or listing the review is about, as the source names it")
    stars: int | None = Field(description="Star rating if the source shows it (1-5), otherwise null")
    quote: str = Field(description="The complaint copied word for word from that source's excerpt (one or two sentences)")
    tags: list[Literal["comfort", "fit", "durability", "quality", "appearance", "value", "shipping", "other"]]
    problem: str = Field(description="A few words naming the specific problem, e.g. 'pressure behind the ears'")


class ReviewTheme(BaseModel):
    tag: Literal["comfort", "fit", "durability", "quality", "appearance", "value", "shipping", "other"]
    summary: str = Field(description="What reviewers say, in one or two sentences")
    fix: str = Field(description="What to put in the spec sheet or ask the supplier so our product avoids this")


class ReviewTagging(BaseModel):
    summary: str = Field(description="Two or three sentences: the main complaints and what they mean for our product")
    reviews: list[TaggedReview]
    themes: list[ReviewTheme]


PICK_SYSTEM = """You choose retail listings that compete directly with a founder's product, for a price and review tracker.
Pick only listings of the same product type and use (e.g. for a women's knotted top-knot fabric headband: knotted or
top-knot fabric headbands - not plain elastic bands, sweatbands, wigs, kids' sets unless the product is for kids, or
bundles of unrelated items). Spread the picks across platforms: include Etsy and brand or boutique stores when they
appear, not only Amazon, and cover the full price range. Prefer listings with reviews. Never invent listings: use only
the numbered candidates."""

TAG_SYSTEM = """You read customer reviews and tag the complaints in low-star (1-3 star) reviews for a product developer.
Rules:
- Use only the sources given. Copy each quote word for word from the cited source's excerpt; never paraphrase inside a quote.
- Tag what the reviewer actually complains about: comfort (headaches, pressure, itching), fit (too tight or loose,
  slips off, wrong size), durability (fraying, stretching out, knot coming undone, breaking), quality, appearance,
  value, shipping, other.
- Skip praise and reviews of unrelated products. Prefer specific complaints over vague ones.
- Themes: one per tag that has complaints, with a concrete fix for the spec sheet or the supplier."""


def _source(db, run: ResearchRun, title: str, url: str, excerpts: list[str], now: datetime) -> EvidenceSource:
    src = EvidenceSource(project_id=run.project_id, research_run_id=run.id, url=url, title=title[:500],
                         domain=url.split("/")[2] if "//" in url else None, source_type="api", provider="serpapi",
                         retrieved_at=now, excerpts=excerpts)
    db.add(src)
    db.flush()
    return src


def _trend_summary(series: list[tuple[str, float]]) -> dict[str, Any] | None:
    pts = [v for _, v in series]
    if not pts:
        return None
    recent, prior = pts[-13:], pts[:-13] or pts
    r_avg, p_avg = sum(recent) / len(recent), sum(prior) / len(prior)
    return {"average": round(sum(pts) / len(pts), 1), "peak": max(pts), "recent_average": round(r_avg, 1),
            "prior_average": round(p_avg, 1), "change_pct": round((r_avg - p_avg) / p_avg * 100, 1) if p_avg else None}


def _competitor(db, project_id: uuid.UUID, name: str, platform: str) -> Competitor:
    comp = db.scalars(select(Competitor).where(Competitor.project_id == project_id, func.lower(Competitor.name) == name.lower())).first()
    if comp is None:
        comp = Competitor(project_id=project_id, name=name[:200], channels=[platform], discovered_by="listing_tracker",
                          notes="Added by the Listing Tracker Agent from a marketplace listing.")
        db.add(comp)
        db.flush()
    elif platform not in (comp.channels or []):
        comp.channels = [*(comp.channels or []), platform]
    return comp


def run_listing_scan(run_id: uuid.UUID, ctx: dict[str, str], keywords: list[str], cc: str | None) -> dict[str, int]:
    """Step 'listing_scan': Google Trends + comparable listings, logged as competitor price observations."""
    from .opportunity import _add_run_usage, _shopper_keywords

    if not demand.configured():
        raise RuntimeError("The Listing Tracker needs SerpApi for Google Trends and marketplace listings: connect it in Settings > Data sources.")
    llm, usage = get_llm(), LLMUsage()
    geo = cc or "US"
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        project_id, user_id = run.project_id, run.created_by_id
        ex = start_execution(db, agent="listing_tracker", operation="research_step:listing_scan", project_id=project_id, user_id=user_id,
                             model=llm.model, provider="serpapi", research_run_id=run_id, input_summary=ctx["category"])
        ex_id = ex.id
    try:
        kws = keywords or _shopper_keywords(run_id, ctx, llm, usage)
        cands, obs, errors, calls = demand.comparable_candidates(kws, geo)
        trend = None
        with httpx2.Client(timeout=40) as http:
            try:
                trend = demand.trends(http, kws[0], geo)
                calls += 1
            except Exception as e:  # noqa: BLE001
                errors.append(str(e)[:300])
        if not cands:
            raise RuntimeError("No marketplace listings came back for " + ", ".join(kws) + ". " + "; ".join(errors[:2]))
        cands = sorted(cands, key=lambda c: c.reviews or 0, reverse=True)[:90]
        lines = [f"[{i}] {c.platform} | ${c.price:.2f} | " + (f"{c.rating:g} stars ({c.reviews or 0} reviews)" if c.rating is not None else "no rating")
                 + (f" | {'; '.join(c.badges)}" if c.badges else "") + f" | {c.title}" + (f" | seller: {c.seller}" if c.seller else "")
                 + (f" | brand: {c.brand}" if c.brand else "") for i, c in enumerate(cands)]
        prompt = (f"Founder's product: {ctx['category']}\nMarket: {ctx['country']}\nFocus: {ctx.get('focus') or 'none'}\n\n"
                  f"Pick {TARGET_MIN}-{TARGET_MAX} directly comparable listings (fewer only if fewer are comparable).\n\n"
                  "=== CANDIDATES ===\n" + "\n".join(lines))
        pick, u = with_retries(lambda: llm.structured(system=PICK_SYSTEM, prompt=prompt, output_model=ListingPick, max_tokens=4000))
        usage.add(u)
        _add_run_usage(run_id, u)
        picked = [(cands[p.index], p) for p in pick.picked if 0 <= p.index < len(cands)]
        picked = list({id(c): (c, p) for c, p in picked}.values())[:TARGET_MAX]

        now = datetime.now(timezone.utc)
        with session_scope() as db:
            run = db.get(ResearchRun, run_id)
            src_for: dict[str, EvidenceSource] = {}
            for o in obs:
                src = _source(db, run, o.title, o.url, o.excerpts, now)
                for line in o.excerpts:
                    src_for.setdefault(line, src)
            findings = 0
            trend_info = None
            if trend:
                tsrc = _source(db, run, trend.title, trend.url, trend.excerpts, now)
                for f in trend.findings:
                    tf = ResearchFinding(project_id=project_id, research_run_id=run_id, section="demand", claim=f.claim, detail=f.detail,
                                         evidence_type="sourced", confidence=f.confidence, verification_status="source_linked", metric=f.metric,
                                         flags=["Computed directly from SerpApi data at retrieval time (not written by the AI)."], created_by="listing_tracker")
                    tf.evidence_links.append(FindingEvidence(evidence_source_id=tsrc.id, quote=trend.excerpts[0][:500]))
                    db.add(tf)
                    findings += 1
                trend_info = {"keyword": kws[0], "geo": geo, "url": trend.url, "series": [[d, v] for d, v in trend.series],
                              **(_trend_summary(trend.series) or {})}
            rows = []
            for c, p in picked:
                name = p.brand or (c.brand if c.brand else None) or (c.seller if c.seller and c.seller.lower() != c.platform.lower()
                                                                     and c.platform not in ("Amazon", "Etsy", "Walmart") else None)
                comp = _competitor(db, project_id, (name or f"Unbranded {c.platform} listings").strip(), c.platform)
                prod = next((x for x in comp.products if (c.url and x.url == c.url) or x.name == c.title[:300]), None)
                if prod is None:
                    prod = CompetitorProduct(competitor_id=comp.id, name=c.title[:300], url=c.url or None,
                                             product_type=ctx["category"][:100], notes=p.why_comparable[:500])
                    db.add(prod)
                    db.flush()
                src = src_for.get(c.line())
                db.add(PriceObservation(competitor_product_id=prod.id, price=c.price, currency="USD", observed_at=now, source_url=c.url or None,
                                        source_type="api", evidence_source_id=src.id if src else None, verification_status="source_linked",
                                        platform=c.platform, rating=c.rating, review_count=c.reviews, badges=c.badges,
                                        note=f"Listing Tracker, {now:%Y-%m-%d}: as listed on {c.platform}"))
                rows.append({"competitor_product_id": str(prod.id), "competitor": comp.name, "platform": c.platform, "title": c.title,
                             "price": c.price, "rating": c.rating, "reviews": c.reviews, "badges": c.badges, "url": c.url,
                             "seller": c.seller, "asin": c.asin, "page_token": c.page_token, "why": p.why_comparable,
                             "source_id": str(src.id) if src else None})
            by_platform: dict[str, int] = {}
            for r in rows:
                by_platform[r["platform"]] = by_platform.get(r["platform"], 0) + 1
            gaps = []
            if len(rows) < TARGET_MIN:
                gaps.append(f"Only {len(rows)} directly comparable listings were found (target {TARGET_MIN}-{TARGET_MAX}). Add listing links by hand or rerun with other keywords.")
            if not any(r["platform"] == "Etsy" for r in rows):
                gaps.append("No Etsy listing was found among the comparable products.")
            if not trend:
                gaps.append("Google Trends data was not collected.")
            if rows:
                prices = [r["price"] for r in rows]
                counts = [r["reviews"] for r in rows if r["reviews"] is not None]
                badged = sum(1 for r in rows if r["badges"])
                claim = (f"{len(rows)} directly comparable listings ({', '.join(f'{n} {k}' for k, n in sorted(by_platform.items(), key=lambda x: -x[1]))}) "
                         f"are priced ${min(prices):.2f}-${max(prices):.2f} (median ${statistics.median(prices):.2f})"
                         + (f"; median {statistics.median(counts):,.0f} reviews" if counts else "") + f"; {badged} show a badge.")
                sf = ResearchFinding(project_id=project_id, research_run_id=run_id, section="competitors", claim=claim,
                                     detail="Listings chosen as directly comparable by the AI; prices, ratings, review counts and badges copied from the marketplace APIs.",
                                     evidence_type="sourced", confidence="medium", verification_status="source_linked",
                                     metric={"name": "Comparable listing price", "value_low": round(min(prices), 2), "value_high": round(max(prices), 2),
                                             "unit": "USD", "year": None},
                                     flags=["Computed directly from SerpApi data at retrieval time (not written by the AI)."], created_by="listing_tracker")
                for src in {id(s): s for s in src_for.values()}.values():
                    sf.evidence_links.append(FindingEvidence(evidence_source_id=src.id, quote=src.excerpts[0][:500] if src.excerpts else None))
                db.add(sf)
                findings += 1
            content = {"keywords": kws, "geo": geo, "trend": trend_info, "listings": rows, "candidates_considered": len(cands),
                       "by_platform": by_platform, "left_out": pick.left_out, "gaps": gaps, "errors": errors[:5],
                       "research_run_id": str(run_id), "retrieved_at": now.isoformat()}
            snap = AnalysisSnapshot(project_id=project_id, kind="listing_tracker", content=content, agent_execution_id=ex_id)
            db.add(snap)
            db.flush()
            apply_to_competitors(db, project_id)
            ex = db.get(AgentExecution, ex_id)
            ex.search_requests = calls
            apply_usage(ex, usage)
            finish_execution(ex, output={"serpapi_calls": calls, "candidates": len(cands), "tracked": len(rows), "errors": errors[:5]})
            audit.record(db, "listing_tracker.logged", user_id=user_id, project_id=project_id, actor="agent:listing_tracker",
                         entity_type="analysis_snapshot", entity_id=snap.id, details={"tracked": len(rows), "serpapi_calls": calls})
        return {"findings": findings, "sources": len(obs) + (1 if trend else 0)}
    except Exception as e:
        with session_scope() as db:
            ex = db.get(AgentExecution, ex_id)
            apply_usage(ex, usage)
            finish_execution(ex, error=str(e)[:2000])
        raise


def _latest(db, project_id: uuid.UUID, kind: str) -> AnalysisSnapshot | None:
    return db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project_id, AnalysisSnapshot.kind == kind)
                      .order_by(AnalysisSnapshot.created_at.desc())).first()


def leading_listings(db, project_id: uuid.UUID, n: int = REVIEW_LISTINGS) -> list[dict[str, Any]]:
    """The most-reviewed tracked listings that SerpApi can read reviews for. Google's product panel returns review text,
    Amazon's product page only a star breakdown and themes, so Google-listed products get most of the slots."""
    snap = _latest(db, project_id, "listing_tracker")
    rows = sorted((snap.content.get("listings") or []) if snap else [], key=lambda r: r.get("reviews") or 0, reverse=True)
    google = [r for r in rows if r.get("page_token")]
    amazon = [r for r in rows if r.get("asin") and not r.get("page_token")]
    take_google = min(len(google), max(n - 2, n - len(amazon)))
    return google[:take_google] + amazon[:n - take_google]


def tracked_page_urls(db, project_id: uuid.UUID, n: int = 3) -> list[str]:
    """Etsy and brand-site listing pages worth reading for reviews (Amazon and Google pages can't be fetched)."""
    snap = _latest(db, project_id, "listing_tracker")
    rows = sorted((snap.content.get("listings") or []) if snap else [], key=lambda r: r.get("reviews") or 0, reverse=True)
    return [r["url"] for r in rows if r.get("url") and "amazon." not in r["url"] and "google." not in r["url"]][:n]


def run_review_collect(run_id: uuid.UUID, ctx: dict[str, str], keywords: list[str], cc: str | None) -> dict[str, int]:
    """Step 'review_collect': low-star reviews and star breakdowns of the leading tracked listings, via SerpApi."""
    if not demand.configured():
        raise RuntimeError("Reading marketplace reviews needs SerpApi: connect it in Settings > Data sources.")
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        project_id, user_id = run.project_id, run.created_by_id
        leaders = leading_listings(db, project_id)
        ex = start_execution(db, agent="review_insights", operation="research_step:review_collect", project_id=project_id, user_id=user_id,
                             model=None, provider="serpapi", research_run_id=run_id, input_summary=f"{len(leaders)} leading listings")
        ex_id = ex.id
    if not leaders:
        with session_scope() as db:
            finish_execution(db.get(AgentExecution, ex_id), error="No tracked listings")
        raise RuntimeError("No tracked listings yet: run the Listing Tracker Agent first, so this agent knows which leading listings to read.")
    errors: list[str] = []
    found: list[demand.ListingReviews] = []
    calls = 0
    with httpx2.Client(timeout=60) as http:
        for c in leaders:
            calls += 1
            try:
                r = demand.listing_reviews(c, http)
                if r:
                    found.append(r)
            except Exception as e:  # noqa: BLE001
                log.warning("Review fetch failed: %s", e)
                errors.append(f"{c.get('title', '')[:60]}: {str(e)[:200]}")
    now = datetime.now(timezone.utc)
    products = []
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        for r in found:
            total = sum(r.star_counts.values())
            low = sum(v for k, v in r.star_counts.items() if k <= 2)
            share = round(low / total * 100, 1) if total else None
            breakdown = ", ".join(f"{k} star: {r.star_counts[k]}{'%' if r.star_unit == 'percent' else ''}" for k in sorted(r.star_counts, reverse=True))
            excerpts = ([f"Star breakdown for {r.title[:120]}: {breakdown}."] if breakdown else [])
            excerpts += [f"{x['stars']} stars" + (f" - \"{x['title']}\"" if x["title"] else "") + f" - {x['text']}"
                         + (f" ({x['source']}, {x['date']})" if x["source"] or x["date"] else "") for x in r.low_star[:15]]
            excerpts += [f"Amazon review theme: {i}" for i in r.insights[:6]]
            if excerpts:
                _source(db, run, f"Low-star reviews: {r.title[:200]} ({r.platform})", r.url, excerpts, now)
            products.append({"title": r.title, "url": r.url, "platform": r.platform, "star_counts": {str(k): v for k, v in r.star_counts.items()},
                             "star_unit": r.star_unit, "low_star_share_pct": share, "low_star_reviews_read": len(r.low_star),
                             "themes_read": len(r.insights)})
        run.params = {**(run.params or {}), "review_products": products}
        ex = db.get(AgentExecution, ex_id)
        ex.search_requests = calls
        finish_execution(ex, output={"serpapi_calls": calls, "listings": len(found), "errors": errors[:5]})
    if not products and errors:
        raise RuntimeError("Could not read reviews: " + "; ".join(errors[:3]))
    return {"findings": 0, "sources": sum(1 for p in products if p["low_star_reviews_read"] or p["themes_read"] or p["star_counts"])}


def _quote_in(quote: str, excerpts: list[str]) -> bool:
    from .opportunity import _norm

    q = _norm(quote).strip(" .\"'")
    return len(q) >= 12 and any(q in _norm(e) for e in excerpts)


def run_review_tags(run_id: uuid.UUID, ctx: dict[str, str]) -> None:
    """Synthesis step 'review_tags': tag the complaints in this run's low-star reviews and summarise them by theme."""
    from .opportunity import _add_run_usage, _update_step, context_block

    llm = get_llm()
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        research_ok = any(s["status"] == "completed" for s in run.steps if s["key"] != "review_tags")
        user_id, project_id = run.created_by_id, run.project_id
        products = (run.params or {}).get("review_products") or []
        sources = db.scalars(select(EvidenceSource).where(EvidenceSource.research_run_id == run_id).order_by(EvidenceSource.created_at)).all()
        smap = {f"S{i}": s for i, s in enumerate(sources, 1)}
        dossier, used = [], 0
        for ref, s in smap.items():
            if not s.excerpts:
                continue
            block = f"[{ref}] {s.title or ''} - {s.url or ''}\n" + "\n".join(f"- {e[:1500]}" for e in s.excerpts[:20])
            if used + len(block) > 60000:
                break
            dossier.append(block)
            used += len(block)
    if not research_ok or not dossier:
        _update_step(run_id, "review_tags", status="skipped", error="Skipped: no reviews were collected.")
        return
    _update_step(run_id, "review_tags", status="running", started_at=datetime.now(timezone.utc).isoformat(), attempts=1)
    prompt = (f"Business context:\n{context_block(ctx)}\n\nTag the complaints in the low-star reviews below.\n\n=== SOURCES ===\n" + "\n\n".join(dossier))
    with session_scope() as db:
        ex = start_execution(db, agent="review_insights", operation="review_tags", project_id=project_id, user_id=user_id,
                             model=llm.model, research_run_id=run_id, input_summary=f"{len(dossier)} sources")
        ex_id = ex.id
    try:
        out, usage = with_retries(lambda: llm.structured(system=TAG_SYSTEM, prompt=prompt, output_model=ReviewTagging, max_tokens=12000))
    except Exception as e:  # noqa: BLE001
        with session_scope() as db:
            finish_execution(db.get(AgentExecution, ex_id), error=str(e)[:2000])
        _update_step(run_id, "review_tags", status="failed", error=str(e)[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    _add_run_usage(run_id, usage)
    try:
        findings = _save_review_tags(run_id, project_id, user_id, ex_id, out, usage, llm.model, products, smap)
    except Exception as e:  # noqa: BLE001 - the AI work is paid for; record the failure on the step so the run can be resumed
        log.exception("Saving review tags failed")
        with session_scope() as db:
            ex = db.get(AgentExecution, ex_id)
            apply_usage(ex, usage)
            finish_execution(ex, error=str(e)[:2000])
        _update_step(run_id, "review_tags", status="failed", error=f"{type(e).__name__}: {e}"[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        steps = [dict(s) for s in run.steps]
        for s in steps:
            if s["key"] == "review_tags":
                s["findings_count"] = findings
        run.steps = steps
    _update_step(run_id, "review_tags", status="completed", finished_at=datetime.now(timezone.utc).isoformat())


def _save_review_tags(run_id: uuid.UUID, project_id: uuid.UUID, user_id: uuid.UUID | None, ex_id: uuid.UUID, out: ReviewTagging,
                      usage: LLMUsage, model: str, products: list[dict[str, Any]], smap: dict[str, EvidenceSource]) -> int:
    """Keep the quotes found word for word in their source; save themes as findings, recommendations and a snapshot."""
    with session_scope() as db:
        smap = {ref: db.get(EvidenceSource, s.id) for ref, s in smap.items()}
        kept, dropped = [], 0
        for r in out.reviews:
            src = smap.get(r.source_ref)
            if not src or not r.tags or not _quote_in(r.quote, src.excerpts or []):
                dropped += 1
                continue
            kept.append({"product": r.product, "stars": r.stars, "quote": r.quote, "tags": list(dict.fromkeys(r.tags)), "problem": r.problem,
                         "url": src.url, "source_title": src.title, "source_id": str(src.id)})
        themes = []
        findings = 0
        for t in out.themes:
            mine = [k for k in kept if t.tag in k["tags"]]
            if not mine:
                continue
            themes.append({"tag": t.tag, "count": len(mine), "summary": t.summary, "fix": t.fix,
                           "problems": list(dict.fromkeys(k["problem"] for k in mine))[:8]})
            f = ResearchFinding(project_id=project_id, research_run_id=run_id, section="customers",
                                claim=f"{len(mine)} low-star review{'s' if len(mine) != 1 else ''} complain about {t.tag}: "
                                      + "; ".join(list(dict.fromkeys(k["problem"] for k in mine))[:4]) + ".",
                                detail=t.summary, evidence_type="sourced", confidence="medium", verification_status="source_linked",
                                flags=["Quotes checked word for word against the cited review source."], created_by="review_insights")
            linked: set[str] = set()
            for k in mine:  # one link per source page (several quotes often come from the same page)
                if k["source_id"] not in linked and len(linked) < 5:
                    linked.add(k["source_id"])
                    f.evidence_links.append(FindingEvidence(evidence_source_id=uuid.UUID(k["source_id"]), quote=k["quote"][:500]))
            db.add(f)
            findings += 1
            if len(mine) >= 2 and t.tag in ("comfort", "fit", "durability", "quality"):
                db.add(Recommendation(project_id=project_id, source="research", title=f"Spec sheet: prevent {t.tag} complaints"[:300],
                                      body=t.fix, priority="high" if len(mine) >= 4 else "medium", research_run_id=run_id))
        themes.sort(key=lambda t: -t["count"])
        content = {"summary": out.summary, "themes": themes, "reviews": kept, "products": products, "unverified_dropped": dropped,
                   "research_run_id": str(run_id),
                   "generated_by": {"model": usage.model or model, "generated_at": datetime.now(timezone.utc).isoformat()}}
        snap = AnalysisSnapshot(project_id=project_id, kind="review_insights", content=content, agent_execution_id=ex_id)
        db.add(snap)
        ex = db.get(AgentExecution, ex_id)
        apply_usage(ex, usage)
        finish_execution(ex, output={"reviews_tagged": len(kept), "unverified_dropped": dropped, "themes": len(themes)})
        audit.record(db, "review_insights.created", user_id=user_id, project_id=project_id, actor="agent:review_insights",
                     entity_type="analysis_snapshot", entity_id=snap.id, details={"reviews": len(kept)})
    return findings
