"""Google Trends explorer through SerpApi: what trends.google.com/trends/explore shows, saved per product.

compare(): interest over time for up to 5 phrases (one request) and interest by region (one request).
related(): the related searches and related topics, top and rising, for one phrase (two requests).
Every number is copied from the Google Trends response; values are relative (100 = the peak in the period).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx2

from .demand import _get, _num

RANGES = {"today 3-m": "Past 90 days", "today 12-m": "Past 12 months", "today 5-y": "Past 5 years", "all": "2004 - present"}
MAX_TERMS = 5


def explore_url(terms: list[str], date: str, geo: str) -> str:
    return (f"https://trends.google.com/trends/explore?date={quote(date)}" + (f"&geo={geo}" if geo else "")
            + f"&q={quote(','.join(terms))}")


def _params(date: str, geo: str, **kw: Any) -> dict[str, Any]:
    p = {"engine": "google_trends", "date": date, **kw}
    if geo:
        p["geo"] = geo
    return p


def compare(terms: list[str], date: str, geo: str) -> dict[str, Any]:
    """Interest over time (one line per phrase, with Google's averages) and interest by region."""
    with httpx2.Client(timeout=60) as http:
        ts = _get(http, _params(date, geo, q=",".join(terms), data_type="TIMESERIES"))
        iot = ts.get("interest_over_time") or {}
        dates: list[str] = []
        series: dict[str, list[float | None]] = {t: [] for t in terms}
        partial: list[bool] = []
        for row in iot.get("timeline_data") or []:
            dates.append(str(row.get("date") or ""))
            partial.append(bool(row.get("partial_data")))
            vals = {str(v.get("query") or ""): _num(v.get("extracted_value")) for v in row.get("values") or []}
            for i, t in enumerate(terms):
                # Values come back in the order asked; fall back to that when the query echo differs in case/spacing.
                v = vals.get(t)
                if v is None and len(row.get("values") or []) > i:
                    v = _num(row["values"][i].get("extracted_value"))
                series[t].append(v)
        averages = {str(a.get("query") or ""): _num(a.get("value")) for a in iot.get("averages") or []}
        if not averages:
            averages = {t: round(sum(x for x in s if x is not None) / max(1, sum(1 for x in s if x is not None)), 1) for t, s in series.items()}

        regions: list[dict[str, Any]] = []
        if len(terms) == 1:
            gm = _get(http, _params(date, geo, q=terms[0], data_type="GEO_MAP_0"))
            for r in gm.get("interest_by_region") or []:
                v = _num(r.get("extracted_value"))
                if v is not None:
                    regions.append({"location": r.get("location"), "geo": r.get("geo"), "values": {terms[0]: v}})
            region_mode = "interest"
        else:
            gm = _get(http, _params(date, geo, q=",".join(terms), data_type="GEO_MAP"))
            for r in gm.get("compared_breakdown_by_region") or []:
                vals = {}
                for i, v in enumerate(r.get("values") or []):
                    term = str(v.get("query") or (terms[i] if i < len(terms) else ""))
                    if _num(v.get("extracted_value")) is not None:
                        vals[term] = _num(v.get("extracted_value"))
                if vals:
                    regions.append({"location": r.get("location"), "geo": r.get("geo"), "values": vals})
            region_mode = "share"
    return {
        "terms": terms, "date": date, "range_label": RANGES.get(date, date), "geo": geo, "url": explore_url(terms, date, geo),
        "dates": dates, "series": series, "partial": partial, "averages": averages,
        "regions": regions, "region_mode": region_mode, "related": {}, "serpapi_calls": 2,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


def _ranked(items: list[dict[str, Any]], *, topic: bool) -> list[dict[str, Any]]:
    out = []
    for x in items[:25]:
        name = (x.get("topic") or {}).get("title") if topic else x.get("query")
        if not name:
            continue
        out.append({"name": str(name), "type": (x.get("topic") or {}).get("type") if topic else None,
                    "value": str(x.get("value") or x.get("formatted_value") or ""), "score": _num(x.get("extracted_value")),
                    "link": x.get("link")})
    return out


def related(term: str, date: str, geo: str) -> dict[str, Any]:
    """Related searches and related topics for one phrase, each split into top and rising (e.g. 'Breakout', '+250%')."""
    with httpx2.Client(timeout=60) as http:
        rq = (_get(http, _params(date, geo, q=term, data_type="RELATED_QUERIES")).get("related_queries") or {})
        rt = (_get(http, _params(date, geo, q=term, data_type="RELATED_TOPICS")).get("related_topics") or {})
    return {"queries": {"top": _ranked(rq.get("top") or [], topic=False), "rising": _ranked(rq.get("rising") or [], topic=False)},
            "topics": {"top": _ranked(rt.get("top") or [], topic=True), "rising": _ranked(rt.get("rising") or [], topic=True)},
            "retrieved_at": datetime.now(timezone.utc).isoformat()}
