"""CSV import helpers: parse, validate per row, report errors without partial silent failures."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Any

MAX_BYTES = 2_000_000
MAX_ROWS = 2000

TEMPLATES: dict[str, list[str]] = {
    "competitors": ["competitor", "website", "price_tier", "channels", "product", "product_url", "price", "currency", "observed_at", "notes"],
    "suppliers": ["supplier", "country", "city", "platform", "website", "contact_name", "contact_email", "capabilities",
                  "certifications_claimed", "product", "moq", "unit_price", "currency", "sample_cost", "lead_time_days",
                  "incoterm", "est_freight_per_unit", "quote_date", "notes"],
}

EXAMPLES: dict[str, list[str]] = {
    "competitors": ["Example Dancewear Co", "https://example.com", "mid", "own website;Amazon", "Latin practice dress",
                    "https://example.com/p/123", "79.00", "USD", "2026-11-01", "Example row - replace with real observations"],
    "suppliers": ["Example Garment Factory", "China", "Guangzhou", "alibaba", "https://example.com", "Ms. Example",
                  "sales@example.com", "knit dresses;sublimation", "", "Latin practice dress", "100", "14.50", "USD", "45",
                  "25", "FOB", "", "2026-11-01", "Example row - replace with a real quote"],
}


class CsvError(ValueError):
    pass


def template_csv(kind: str) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(TEMPLATES[kind])
    w.writerow(EXAMPLES[kind])
    return buf.getvalue()


def read_rows(raw: bytes) -> list[dict[str, str]]:
    if len(raw) > MAX_BYTES:
        raise CsvError("File is larger than 2 MB.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CsvError("File must be UTF-8 encoded CSV.")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise CsvError("CSV has no header row.")
    rows = []
    for i, row in enumerate(reader):
        if i >= MAX_ROWS:
            raise CsvError(f"CSV has more than {MAX_ROWS} rows.")
        rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in row.items()})
    return rows


def opt_float(v: str, field: str) -> float | None:
    if v == "":
        return None
    try:
        return float(v.replace(",", "").replace("$", ""))
    except ValueError:
        raise CsvError(f"{field}: '{v}' is not a number")


def opt_int(v: str, field: str) -> int | None:
    f = opt_float(v, field)
    return int(f) if f is not None else None


def opt_date(v: str, field: str) -> date | None:
    if v == "":
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        raise CsvError(f"{field}: '{v}' is not a date (use YYYY-MM-DD)")


def opt_datetime(v: str, field: str) -> datetime | None:
    d = opt_date(v, field)
    return datetime(d.year, d.month, d.day) if d else None


def split_list(v: str) -> list[str]:
    return [x.strip() for x in v.replace("|", ";").split(";") if x.strip()]


def summarize(created: dict[str, int], errors: list[dict[str, Any]]) -> dict[str, Any]:
    return {"created": created, "errors": errors[:50], "error_count": len(errors)}
