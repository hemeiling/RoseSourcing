"""Buyer & Style Insights Agent: who buys this product, what they do in it, and which patterns and styles they like.

Every comment collected for the product is used: marketplace reviews of the leading tracked listings (any star rating,
read through SerpApi), the low-star reviews earlier Review Insights runs saved, and forum and store comments found by this
run's web research. The AI only tags each comment (stated age, who wears it, occasions, styles liked or disliked) with a
quote; a tag is kept only when its quote appears word for word in that comment, and an age only when the comment states
the number. The app then counts the statistics - the AI does not estimate them.
"""

from __future__ import annotations

import logging
import re
import statistics
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Literal

import httpx2
from pydantic import BaseModel, Field
from sqlalchemy import select

from ... import audit
from ...db import session_scope
from ...models import AgentExecution, AnalysisSnapshot, EvidenceSource, FindingEvidence, ResearchFinding, ResearchRun
from .. import demand
from ..llm.anthropic_provider import get_llm
from ..llm.base import LLMUsage
from .listings import _latest, _quote_in, _source, leading_listings
from .runtime import apply_usage, finish_execution, start_execution, with_retries

log = logging.getLogger(__name__)

STYLE_LISTINGS = 8  # leading listings whose reviews are read (one SerpApi call each)
MAX_COMMENTS = 300
MAX_CHARS = 80000
AGE_BANDS = ("child", "teen", "20s", "30s", "40s", "50s", "60+")
REVIEW_LINE = re.compile(r"^(?:([1-5]) stars?\b|Review \()")
REVIEW_LINK = re.compile(r" <(https?://[^>\s]+)>$")
NOT_COMMENTS = ("Star breakdown", "Amazon review theme")
# Page passages worth keeping for this agent: who wears it, what for, and how it looks.
STYLE_PASSAGES = (r"(?i)\b(stars?|reviews?|love[sd]?|cute|pretty|gorgeous|pattern|print|colou?rs?|plaid|tweed|leopard|floral|velvet|satin|"
                  r"silk|denim|pearls?|rhinestones?|sequins?|wide|padded|knot|years? old|my (daughter|mom|mother|wife|granddaughter|sister)|"
                  r"gift|wear (it|them|this) (to|for)|work|school|gym|yoga|wedding|church|holiday|dance|competition|teen|trend\w*|aesthetic)\b")


class CommentTag(BaseModel):
    ref: str = Field(description="Comment ref, e.g. 'C12'")
    age: int | None = Field(description="The wearer's age only when the comment states it as a number; otherwise null")
    age_band: Literal["child", "teen", "20s", "30s", "40s", "50s", "60+", "unknown"]
    wearer: Literal["self", "daughter", "son", "partner", "mother", "friend", "other", "unknown"]
    gift: bool
    occasions: list[str] = Field(description="Short lowercase tags for where/when/what it is worn for, as the comment says")
    liked: list[str] = Field(description="Pattern, colour, material, shape or embellishment words the comment praises")
    disliked: list[str] = Field(description="Pattern, colour, material, shape or embellishment words the comment criticises")
    quote: str = Field(description="The exact words from the comment that show these tags (8-40 words, verbatim)")


class StyleTerm(BaseModel):
    term: str
    kind: Literal["pattern", "colour", "material", "shape", "embellishment", "style"]
    synonyms: list[str] = Field(description="Other words for it as written in comments and listing titles, lowercase")


class Persona(BaseModel):
    name: str
    age_range: str = Field(description="Only what the comments support, otherwise 'not stated'")
    description: str
    wants: list[str]
    comment_refs: list[str]


class DesignDirection(BaseModel):
    title: str
    description: str = Field(description="Pattern + colour + material + shape, concretely")
    why: str
    refs: list[str] = Field(description="C-refs (comments), L-refs (best-selling listings) and F-refs (web findings)")


class CommentTagging(BaseModel):
    comments: list[CommentTag]


class OccasionGroup(BaseModel):
    name: str = Field(description="Short name, e.g. 'Dance class & practice'")
    tags: list[str] = Field(description="The occasion tags (as listed) that belong to it")


class StyleSynthesis(BaseModel):
    summary: str = Field(description="Two or three sentences. No counts, percentages or averages - the app computes them")
    occasion_groups: list[OccasionGroup] = Field(description="3-8 groups covering the occasion tags; near-duplicates go together")
    style_terms: list[StyleTerm]
    personas: list[Persona]
    design_directions: list[DesignDirection]


class BuyerStyleProfile(BaseModel):
    """The tags from every batch plus the synthesis, checked and counted by build_profile."""
    summary: str
    comments: list[CommentTag]
    occasion_groups: list[OccasionGroup] = []
    style_terms: list[StyleTerm]
    personas: list[Persona]
    design_directions: list[DesignDirection]


BATCH = 60  # comments tagged per AI call: a whole pool in one answer runs past the output limit
TAG_SYSTEM = """You read what customers write about a product category, for a founder designing their own version.
For each comment that says who wears or buys it, what they do in it, or which looks they like or dislike, return one tag:
- age: only a number the comment states for the wearer ("I'm 52", "my 13-year-old"); otherwise null. age_band from a stated
  age or clear words ("teenage daughter", "toddler", "in my 40s", "retired"); otherwise "unknown". Never guess an age from
  writing style or product type.
- wearer: who wears it ("self" when the writer does). gift: true only when the comment says it was a gift or bought for someone.
- occasions: short lowercase tags as the comment says them (work, school, gym, yoga, running, travel, church, wedding,
  holiday party, everyday, skincare, photo shoot, dance class, competition ...).
- liked / disliked: pattern, colour, material, shape or embellishment words the comment praises or criticises.
- quote: copy the exact words from that comment that show the tags (8-40 words, verbatim, no edits).
Skip comments that say none of these; tag each comment at most once. Keep quotes short."""

SYNTH_SYSTEM = """You turn tagged customer comments into design guidance for a founder designing their own version of a product.
Group the occasion tags listed into 3-8 occasion_groups (near-duplicates such as "dance", "dancing" and "latin dance" go together).
Give style_terms (8-20 distinct pattern, colour, material, shape or embellishment terms that matter for design, each with its
synonyms as written in comments and listing titles), 2-3 personas grounded in the tagged comments (cite C-refs; an age range only
when the tags support it, otherwise "not stated"), and 3-5 concrete design directions supported by what comments praise and what
the best-selling listings show (cite C-, L- and F-refs). Do not state counts, percentages or averages - the app computes them."""


def run_style_collect(run_id: uuid.UUID, ctx: dict[str, str], keywords: list[str], cc: str | None) -> dict[str, int]:
    """Step 'style_collect': reviews of every star rating for the leading tracked listings, via SerpApi."""
    if not demand.configured():
        raise RuntimeError("Reading marketplace reviews needs SerpApi: connect it in Settings > Data sources.")
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        project_id, user_id = run.project_id, run.created_by_id
        leaders = leading_listings(db, project_id, STYLE_LISTINGS)
        ex = start_execution(db, agent="buyer_style", operation="research_step:style_collect", project_id=project_id, user_id=user_id,
                             model=None, provider="serpapi", research_run_id=run_id, input_summary=f"{len(leaders)} leading listings")
        ex_id = ex.id
    if not leaders:
        with session_scope() as db:
            finish_execution(db.get(AgentExecution, ex_id), error="No tracked listings")
        raise RuntimeError("No tracked listings yet: run the Top Listings Tracker first, so this agent knows which leading listings to read.")
    found, errors = [], []
    sent0 = demand.network_calls()
    with httpx2.Client(timeout=60) as http:
        for c in leaders:
            try:
                if (r := demand.listing_reviews(c, http)):
                    found.append(r)
            except Exception as e:  # noqa: BLE001
                log.warning("Review fetch failed: %s", e)
                errors.append(f"{c.get('title', '')[:60]}: {str(e)[:200]}")
    calls = demand.network_calls() - sent0  # listings Review Mining already read come from the cache
    now = datetime.now(timezone.utc)
    saved = 0
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        for r in found:
            excerpts = [f"{x['stars']} stars" + (f" - \"{x['title']}\"" if x["title"] else "") + f" - {x['text']}"
                        + (f" ({x['source']}, {x['date']})" if x["source"] or x["date"] else "") for x in r.reviews[:40]]
            # Amazon's themes quote individual reviews (with a link to each): those are customers' own words.
            excerpts += [f"Review (Amazon, {x['theme']}, {x['sentiment']}): {x['text']}" + (f" <{x['link']}>" if x["link"] else "")
                         for x in r.snippets[:60]]
            excerpts += [f"Amazon review theme: {i}" for i in (r.praise + r.insights)[:8]]
            if r.summary:
                excerpts.append(f"Amazon review theme: Amazon's summary - {r.summary}")
            if excerpts:
                _source(db, run, f"Reviews: {r.title[:200]} ({r.platform})", r.url, excerpts, now)
                saved += 1
        ex = db.get(AgentExecution, ex_id)
        ex.search_requests = calls
        finish_execution(ex, output={"serpapi_calls": calls, "listings": len(found), "errors": errors[:5]})
    if not saved and errors:
        raise RuntimeError("Could not read reviews: " + "; ".join(errors[:3]))
    return {"findings": 0, "sources": saved}


def collect_comments(db, project_id: uuid.UUID, run_id: uuid.UUID) -> tuple[list[dict[str, Any]], list[str]]:
    """Every comment saved for the product by review and buyer runs, de-duplicated: marketplace reviews (with stars) and
    the page passages this run's web research kept. Also returns Amazon's review themes, which summarise many reviews."""
    runs = db.scalars(select(ResearchRun.id).where(ResearchRun.project_id == project_id,
                                                   ResearchRun.kind.in_(["review_mining", "buyer_style"]))).all()
    sources = db.scalars(select(EvidenceSource).where(EvidenceSource.research_run_id.in_(runs))
                         .order_by(EvidenceSource.created_at.desc())).all() if runs else []
    reviews, web, themes, seen = [], [], [], set()
    for s in sources:
        for e in s.excerpts or []:
            if e.startswith(NOT_COMMENTS):
                if e.startswith("Amazon review theme") and e not in themes:
                    themes.append(e)
                continue
            m = REVIEW_LINE.match(e)
            if not m and (s.provider == "serpapi" or s.research_run_id != run_id):
                continue  # only this run's web passages; other runs' web pages were read for complaints, not for buyers
            link = REVIEW_LINK.search(e)
            text = e[:link.start()] if link else e
            key = re.sub(r"\W+", " ", re.sub(r"^\w+ \([^)]*\): ", "", text).lower())[:220]  # the same quote under two themes counts once
            if key in seen or len(text) < 25:
                continue
            seen.add(key)
            item = {"text": text[:1500], "stars": int(m.group(1)) if m and m.group(1) else None, "source_id": str(s.id), "source_title": s.title,
                    "url": link.group(1) if link else s.url, "kind": "review" if m else "web"}
            (reviews if m else web).append(item)
    out, used = [], 0
    for c in reviews + web:
        if len(out) >= MAX_COMMENTS or used + len(c["text"]) > MAX_CHARS:
            break
        out.append(c)
        used += len(c["text"])
    for i, c in enumerate(out, 1):
        c["ref"] = f"C{i}"
    return out, themes[:12]


def _label(c: dict[str, Any]) -> str:
    return f"{c['stars']} stars" if c["stars"] else "web"


def _band(age: int) -> str:
    if age < 13:
        return "child"
    if age < 20:
        return "teen"
    return "60+" if age >= 60 else f"{age // 10 * 10}s"


def _hit(words: list[str], text: str) -> bool:
    return any(re.search(rf"(?<![a-z]){re.escape(w)}", text, re.I) for w in words if w)


def build_profile(out: BuyerStyleProfile, comments: list[dict[str, Any]], listings: list[dict[str, Any]],
                  finding_refs: dict[str, str]) -> dict[str, Any]:
    """Check every tag against its comment, then count. Returns the snapshot content (without generated_by)."""
    by_ref = {c["ref"]: c for c in comments}
    tags, dropped, done = [], 0, set()
    for t in out.comments:
        c = by_ref.get(t.ref)
        if c is None or t.ref in done or not _quote_in(t.quote, [c["text"]]):
            dropped += 1
            continue
        done.add(t.ref)
        age = t.age if t.age is not None and 1 <= t.age <= 100 and re.search(rf"(?<!\d){t.age}(?!\d)", c["text"]) else None
        tags.append({"ref": t.ref, "age": age, "age_band": _band(age) if age is not None else t.age_band, "wearer": t.wearer, "gift": t.gift,
                     "occasions": list(dict.fromkeys(o.strip().lower() for o in t.occasions if o.strip()))[:6],
                     "liked": [x.strip().lower() for x in t.liked if x.strip()][:8], "disliked": [x.strip().lower() for x in t.disliked if x.strip()][:8],
                     "quote": t.quote, "stars": c["stars"], "kind": c["kind"], "source_title": c["source_title"], "url": c["url"],
                     "source_id": c["source_id"]})
    ages = [t["age"] for t in tags if t["age"] is not None]
    bands = Counter(t["age_band"] for t in tags if t["age_band"] != "unknown")
    groups = [(g.name, {x.strip().lower() for x in g.tags}) for g in out.occasion_groups if g.tags]
    grouped = {o for _, members in groups for o in members}
    occasions = Counter()
    examples: dict[str, list[str]] = {}
    for t in tags:  # a comment counts once per group, however many of the group's tags it uses
        for name, members in groups:
            hits = [o for o in t["occasions"] if o in members]
            if hits:
                occasions[name] += 1
                examples.setdefault(name, [])
                examples[name] += [h for h in hits if h not in examples[name]]
        for o in t["occasions"]:
            if o not in grouped:
                occasions[o] += 1
    stats = {
        "comments_read": len(comments),
        "reviews": sum(1 for c in comments if c["kind"] == "review"),
        "web_comments": sum(1 for c in comments if c["kind"] == "web"),
        "tagged": len(tags),
        "unverified_dropped": dropped,
        "stars": {str(k): v for k, v in sorted(Counter(c["stars"] for c in comments if c["stars"]).items(), reverse=True)},
        "age": {"stated": len(ages), "median": statistics.median(ages) if ages else None, "mean": round(statistics.mean(ages), 1) if ages else None,
                "min": min(ages) if ages else None, "max": max(ages) if ages else None, "with_age_info": sum(bands.values()),
                "bands": {b: bands.get(b, 0) for b in AGE_BANDS}},
        "wearer": dict(Counter(t["wearer"] for t in tags if t["wearer"] != "unknown").most_common()),
        "gift": sum(1 for t in tags if t["gift"]),
        "occasions": [{"tag": k, "count": v, "includes": examples.get(k, [])[:6]} for k, v in occasions.most_common(12)],
        "rated": sum(1 for c in comments if c["stars"]),
    }
    styles, seen_terms = [], set()
    for st in out.style_terms:
        words = list(dict.fromkeys(w.strip().lower() for w in [st.term, *st.synonyms] if w.strip()))
        if not words or words[0] in seen_terms:
            continue
        seen_terms.add(words[0])
        top = [x for x in listings if _hit(words, x["title"])]
        styles.append({"term": words[0], "kind": st.kind, "synonyms": words[1:],
                       "liked": sum(1 for t in tags if any(_hit(words, x) for x in t["liked"])),
                       "disliked": sum(1 for t in tags if any(_hit(words, x) for x in t["disliked"])),
                       "mentioned": sum(1 for c in comments if _hit(words, c["text"])),
                       "top_listings": len(top), "top_listing_reviews": sum(x.get("reviews") or 0 for x in top),
                       "examples": [{"title": x["title"], "url": x.get("url"), "image": x.get("image")} for x in top[:3]]})
    styles.sort(key=lambda s: (-(s["liked"] + s["top_listings"]), -s["mentioned"]))
    ok_refs = set(by_ref) | {f"L{i}" for i in range(1, len(listings) + 1)} | set(finding_refs)
    personas = [{"name": p.name, "age_range": p.age_range, "description": p.description, "wants": p.wants[:6],
                 "comment_refs": [r for r in p.comment_refs if r in done]} for p in out.personas]
    directions = [{"title": d.title, "description": d.description, "why": d.why, "refs": [r for r in d.refs if r in ok_refs]}
                  for d in out.design_directions]
    return {"summary": out.summary, "stats": stats, "styles": styles, "personas": personas, "design_directions": directions,
            "comments": tags, "listings": [{"ref": f"L{i}", "title": x["title"], "url": x.get("url"), "reviews": x.get("reviews")}
                                           for i, x in enumerate(listings, 1)], "findings": finding_refs}


def run_style_profile(run_id: uuid.UUID, ctx: dict[str, str]) -> None:
    """Synthesis step 'style_profile': tag every collected comment, then count who buys, what for, and which looks they like."""
    from .opportunity import _add_run_usage, _update_step, context_block

    llm = get_llm()
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        project_id, user_id = run.project_id, run.created_by_id
        comments, themes = collect_comments(db, project_id, run_id)
        snap = _latest(db, project_id, "listing_tracker")
        listings = sorted((snap.content.get("listings") or []) if snap else [], key=lambda r: r.get("reviews") or 0, reverse=True)[:20]
        web = db.scalars(select(ResearchFinding).where(ResearchFinding.research_run_id == run_id)).all()
        finding_refs = {f"F{i}": f.claim for i, f in enumerate(web, 1)}
        # What published sources say about the buyers (or that nothing was found), shown beside the counted comments.
        buyer_findings = [{"claim": f.claim, "evidence_type": f.evidence_type,
                           "url": next((lk.source.url for lk in f.evidence_links if lk.source and lk.source.url), None)}
                          for f in web if f.section == "customer_segments" and f.created_by != "buyer_style"][:8]
    if not comments:
        _update_step(run_id, "style_profile", status="skipped",
                     error="Skipped: no customer comments were collected. Run the Top Listings Tracker first so reviews can be read.")
        return
    _update_step(run_id, "style_profile", status="running", started_at=datetime.now(timezone.utc).isoformat(), attempts=1)
    context = f"Business context:\n{context_block(ctx)}\n\n"
    with session_scope() as db:
        ex = start_execution(db, agent="buyer_style", operation="style_profile", project_id=project_id, user_id=user_id, model=llm.model,
                             research_run_id=run_id, input_summary=f"{len(comments)} comments, {len(listings)} listings")
        ex_id = ex.id
    usage = LLMUsage(model=llm.model)

    def tag(batch: list[dict[str, Any]]) -> list[CommentTag]:
        prompt = (context + "=== COMMENTS ===\n" + "\n".join(f"[{c['ref']}] ({_label(c)}; {(c['source_title'] or '')[:70]}) {c['text']}" for c in batch)
                  + "\n\nTag the comments that say who wears it, what for, or which looks they like or dislike.")
        out, u = with_retries(lambda: llm.structured(system=TAG_SYSTEM, prompt=prompt, output_model=CommentTagging, max_tokens=16000))
        _add_run_usage(run_id, u)  # each batch's cost is recorded as soon as it is paid for
        usage.add(u)
        return out.comments

    tags: list[CommentTag] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for fut in [pool.submit(tag, comments[i:i + BATCH]) for i in range(0, len(comments), BATCH)]:
            try:
                tags += fut.result()
            except Exception as e:  # noqa: BLE001 - a failed batch leaves its comments untagged; the rest still count
                log.warning("Tagging a comment batch failed: %s", e)
                errors.append(str(e)[:300])
    by_ref = {c["ref"]: c for c in comments}
    verified = [t for t in tags if t.ref in by_ref and _quote_in(t.quote, [by_ref[t.ref]["text"]])]
    prompt = (context + "=== TAGGED CUSTOMER COMMENTS (quotes checked word for word) ===\n"
              + ("\n".join(f"[{t.ref}] ({_label(by_ref[t.ref])}) age={t.age if t.age is not None else t.age_band}; wearer={t.wearer}"
                           + f"{'; gift' if t.gift else ''}; occasions={', '.join(t.occasions) or '-'}; liked={', '.join(t.liked) or '-'}; "
                           + f"disliked={', '.join(t.disliked) or '-'} - \"{t.quote}\"" for t in verified) or "(no comment said anything about buyers or looks)")
              + "\n\n=== OCCASION TAGS USED (tag: comments) ===\n"
              + (", ".join(f"{k}: {v}" for k, v in Counter(o.strip().lower() for t in verified for o in t.occasions).most_common()) or "(none)")
              + ("\n\n=== AMAZON REVIEW THEMES (summaries of many reviews) ===\n" + "\n".join(f"- {t}" for t in themes) if themes else "")
              + "\n\n=== BEST-SELLING COMPARABLE LISTINGS (most reviewed first) ===\n"
              + ("\n".join(f"[L{i}] {x.get('platform')} ${x.get('price')}, {x.get('reviews') or 0} reviews"
                           + (f", badges: {', '.join(x.get('badges') or [])}" if x.get("badges") else "") + f" - {x['title']}"
                           for i, x in enumerate(listings, 1)) or "(none tracked)")
              + "\n\n=== WEB RESEARCH FINDINGS ===\n" + ("\n".join(f"[{r}] {c}" for r, c in finding_refs.items()) or "(none)")
              + "\n\nGroup the occasion tags, then give the style terms, personas and design directions.")
    try:
        if errors and not tags:
            raise RuntimeError("Tagging the comments failed: " + errors[0])
        synth, u = with_retries(lambda: llm.structured(system=SYNTH_SYSTEM, prompt=prompt, output_model=StyleSynthesis, max_tokens=12000))
        _add_run_usage(run_id, u)
        usage.add(u)
    except Exception as e:  # noqa: BLE001
        with session_scope() as db:
            ex = db.get(AgentExecution, ex_id)
            apply_usage(ex, usage)
            finish_execution(ex, error=str(e)[:2000])
        _update_step(run_id, "style_profile", status="failed", error=str(e)[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    out = BuyerStyleProfile(summary=synth.summary, comments=tags, occasion_groups=synth.occasion_groups, style_terms=synth.style_terms,
                            personas=synth.personas, design_directions=synth.design_directions)
    try:
        content = build_profile(out, comments, listings, finding_refs)
        content["stats"]["batches_failed"] = len(errors)
        content["published"] = buyer_findings
        n = _save_profile(run_id, project_id, user_id, ex_id, content, usage, llm.model)
    except Exception as e:  # noqa: BLE001 - the AI work is paid for; record the failure so the run can be resumed
        log.exception("Saving the buyer profile failed")
        with session_scope() as db:
            ex = db.get(AgentExecution, ex_id)
            apply_usage(ex, usage)
            finish_execution(ex, error=str(e)[:2000])
        _update_step(run_id, "style_profile", status="failed", error=f"{type(e).__name__}: {e}"[:1000], finished_at=datetime.now(timezone.utc).isoformat())
        return
    with session_scope() as db:
        run = db.get(ResearchRun, run_id)
        run.steps = [dict(s, findings_count=n) if s["key"] == "style_profile" else s for s in run.steps]
    _update_step(run_id, "style_profile", status="completed", finished_at=datetime.now(timezone.utc).isoformat())


def _save_profile(run_id: uuid.UUID, project_id: uuid.UUID, user_id: uuid.UUID | None, ex_id: uuid.UUID, content: dict[str, Any],
                  usage: LLMUsage, model: str) -> int:
    """Snapshot plus findings for the headline statistics, each linked to the review pages behind it."""
    stats, tags = content["stats"], content["comments"]
    findings = []
    age = stats["age"]
    if age["stated"] >= 3:
        findings.append((f"Of {age['stated']} customer comments that state the wearer's age, the median is {age['median']:g} "
                         f"(range {age['min']}-{age['max']}).", [t for t in tags if t["age"] is not None]))
    liked = sorted((s for s in content["styles"] if s["liked"]), key=lambda s: -s["liked"])[:3]
    if liked:
        findings.append((f"Most-praised looks in {stats['tagged']} tagged customer comments: "
                         + ", ".join(f"{s['term']} ({s['liked']})" for s in liked) + ".",
                         [t for t in tags if t["liked"]]))
    if stats["occasions"]:
        top = stats["occasions"][:4]
        findings.append((f"Customers say they wear it for: " + ", ".join(f"{o['tag']} ({o['count']})" for o in top) + ".",
                         [t for t in tags if t["occasions"]]))
    with session_scope() as db:
        for claim, backing in findings:
            f = ResearchFinding(project_id=project_id, research_run_id=run_id, section="customer_segments", claim=claim,
                                detail=f"Counted by the app from {stats['comments_read']} comments; each tag's quote was checked word for word.",
                                evidence_type="sourced", confidence="medium" if len(backing) >= 10 else "low", verification_status="source_linked",
                                flags=["Counted by the app from verified comment tags (not estimated by the AI)."], created_by="buyer_style")
            linked: set[str] = set()
            for t in backing:
                if t["source_id"] not in linked and len(linked) < 5:
                    linked.add(t["source_id"])
                    f.evidence_links.append(FindingEvidence(evidence_source_id=uuid.UUID(t["source_id"]), quote=t["quote"][:500]))
            db.add(f)
        content = {**content, "research_run_id": str(run_id),
                   "generated_by": {"model": usage.model or model, "generated_at": datetime.now(timezone.utc).isoformat()}}
        snap = AnalysisSnapshot(project_id=project_id, kind="buyer_style", content=content, agent_execution_id=ex_id)
        db.add(snap)
        ex = db.get(AgentExecution, ex_id)
        apply_usage(ex, usage)
        finish_execution(ex, output={"comments": stats["comments_read"], "tagged": stats["tagged"], "dropped": stats["unverified_dropped"]})
        audit.record(db, "buyer_style.created", user_id=user_id, project_id=project_id, actor="agent:buyer_style",
                     entity_type="analysis_snapshot", entity_id=snap.id, details={"comments": stats["comments_read"], "tagged": stats["tagged"]})
    return len(findings)
