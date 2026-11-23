"""Deterministic size recommendation against a size chart (no AI).

Charts store body-measurement ranges in cm per size, ordered smallest to largest. The rule:
recommend the smallest size whose range is not too small for any measurement the customer gave,
allowing the chart's stretch allowance above each maximum. Everything else (loose spots, mixed sizes,
nothing fits) is reported as a note rather than hidden.
"""

from __future__ import annotations

from typing import Any, Iterable

CM_PER_INCH = 2.54

# Known body measurements, in the order they are usually shown. Charts may also use custom snake_case keys.
DIMENSIONS: dict[str, str] = {
    "height": "Height",
    "bust": "Bust",
    "underbust": "Underbust",
    "chest": "Chest",
    "waist": "Waist",
    "hip": "Hip",
    "torso_girth": "Torso girth",
    "neck": "Neck",
    "sleeve": "Sleeve / arm length",
    "inseam": "Inseam",
    "foot_length": "Foot length",
    "foot_width": "Foot width",
}

GARMENT_DIMENSIONS: dict[str, list[str]] = {
    "dress": ["bust", "waist", "hip", "height"],
    "bodysuit": ["bust", "waist", "hip", "torso_girth"],
    "top": ["bust", "waist"],
    "bottom": ["waist", "hip", "inseam"],
    "shoes": ["foot_length", "foot_width"],
    "other": ["bust", "waist", "hip"],
}


def label(dim: str) -> str:
    return DIMENSIONS.get(dim, dim.replace("_", " ").capitalize())


def to_cm(value: float, unit: str) -> float:
    return value * CM_PER_INCH if unit == "in" else value


def normalise_rows(rows: Iterable[dict[str, Any]], unit: str = "cm") -> list[dict[str, Any]]:
    """Validate rows and convert measurement ranges to cm, rounded to 0.1 cm."""
    out = []
    for r in rows:
        size = str(r.get("size") or "").strip()
        if not size:
            raise ValueError("Every row needs a size label.")
        meas: dict[str, list[float]] = {}
        for dim, rng in (r.get("measurements") or {}).items():
            if rng is None:
                continue
            lo, hi = (rng, rng) if isinstance(rng, (int, float)) else (rng[0], rng[-1])
            if lo is None and hi is None:
                continue
            lo = hi if lo is None else lo
            hi = lo if hi is None else hi
            lo, hi = sorted((round(to_cm(float(lo), unit), 1), round(to_cm(float(hi), unit), 1)))
            if lo <= 0:
                raise ValueError(f"Size {size}: {label(dim)} must be a positive measurement.")
            meas[str(dim).strip().lower().replace(" ", "_")] = [lo, hi]
        labels = {str(k).strip()[:16]: str(v).strip()[:24] for k, v in (r.get("labels") or {}).items() if str(v).strip()}
        out.append({"size": size[:40], "labels": labels, "measurements": meas})
    return out


def _check(v: float, lo: float, hi: float, stretch: float) -> tuple[str, float]:
    if v > hi + stretch:
        return "too_small", round(v - hi, 1)
    if v > hi:
        return "snug", round(v - hi, 1)
    if v < lo and lo < hi:
        return "loose", round(lo - v, 1)
    return "fits", 0.0


def recommend(rows: list[dict[str, Any]], measurements: dict[str, float], *, stretch_allowance_cm: float = 0.0,
              unit: str = "cm", fit_notes: str | None = None) -> dict[str, Any]:
    cust = {k: round(to_cm(float(v), unit), 1) for k, v in measurements.items() if v is not None and float(v) > 0}
    chart_dims = {d for r in rows for d in r.get("measurements", {})}
    used = [d for d in DIMENSIONS if d in cust and d in chart_dims] + sorted(d for d in cust if d in chart_dims and d not in DIMENSIONS)
    missing = sorted(chart_dims - set(cust), key=lambda d: list(DIMENSIONS).index(d) if d in DIMENSIONS else 99)
    base = {"used_dimensions": used, "missing_dimensions": missing, "measurements_cm": {d: cust[d] for d in used}}
    if not rows or not used:
        return {**base, "status": "insufficient", "recommended": None, "per_size": [], "per_dimension": {},
                "notes": ["Enter at least one measurement that this size chart lists: " + ", ".join(label(d) for d in sorted(chart_dims)) + "."]
                if rows else ["This size chart has no sizes yet."]}

    per_size = []
    for r in rows:
        checks = []
        for d in used:
            rng = r["measurements"].get(d)
            if not rng:
                continue
            result, by = _check(cust[d], rng[0], rng[1], stretch_allowance_cm)
            checks.append({"dimension": d, "label": label(d), "customer": cust[d], "min": rng[0], "max": rng[1], "result": result, "by_cm": by})
        per_size.append({"size": r["size"], "labels": r.get("labels", {}), "checks": checks,
                         "fits": bool(checks) and all(c["result"] != "too_small" for c in checks)})

    per_dimension: dict[str, str | None] = {}
    for d in used:
        exact = next((s["size"] for s in per_size for c in s["checks"] if c["dimension"] == d and c["result"] == "fits"), None)
        ok = next((s["size"] for s in per_size for c in s["checks"] if c["dimension"] == d and c["result"] != "too_small"), None)
        per_dimension[d] = exact or ok

    rec = next((s for s in per_size if s["fits"]), None)
    notes: list[str] = []
    if rec is None:
        largest = per_size[-1]
        tight = [f"{c['label'].lower()} by {c['by_cm']:g} cm" for c in largest["checks"] if c["result"] == "too_small"]
        notes.append(f"No size fits every measurement. Even {largest['size']} is too small at the {', '.join(tight)}."
                     " Consider made-to-measure or a different size chart.")
        status = "outside_chart"
    else:
        status = "fits"
        for c in rec["checks"]:
            if c["result"] == "snug":
                notes.append(f"Snug at the {c['label'].lower()} ({c['by_cm']:g} cm over the chart, within the {stretch_allowance_cm:g} cm stretch allowance).")
                status = "between_sizes"
            elif c["result"] == "loose":
                notes.append(f"Loose at the {c['label'].lower()} by {c['by_cm']:g} cm - may need a small alteration.")
                status = "between_sizes"
        if len({v for v in per_dimension.values() if v}) > 1:
            mixed = ", ".join(f"{label(d).lower()} {s}" for d, s in per_dimension.items() if s)
            notes.append(f"Measurements point to different sizes ({mixed}); {rec['size']} is the smallest that is not too small anywhere.")
            status = "between_sizes"
    if missing:
        notes.append("Not checked (not entered): " + ", ".join(label(d) for d in missing) + ".")
    if fit_notes:
        notes.append(f"Seller's fit note: {fit_notes}")
    return {**base, "status": status, "recommended": rec["size"] if rec else None,
            "recommended_labels": rec["labels"] if rec else {}, "per_size": per_size, "per_dimension": per_dimension, "notes": notes}
