"""Size chart photo/screenshot -> structured size chart (Claude vision). Extracted charts stay unverified until the user checks them."""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import BusinessProject, User
from ..fit import GARMENT_DIMENSIONS, DIMENSIONS, normalise_rows
from ..llm.anthropic_provider import get_llm
from .research_schemas import ExtractedSizeChart
from .runtime import apply_usage, finish_execution, start_execution, with_retries

SYSTEM = """You transcribe size charts from images for a founder building a dancewear size guide.
Copy only what is printed: size labels, size-system equivalents and body measurements, exactly as shown, in the printed unit.
Never fill gaps, convert units or guess values. If a chart shows garment (flat-lay) measurements rather than body measurements,
transcribe them but say so in fit_notes. If the image holds several charts, transcribe the main one and mention the others in fit_notes.
Use the standard dimension keys where they apply (height, bust, underbust, chest, waist, hip, torso_girth, neck, sleeve, inseam,
foot_length, foot_width)."""


def rows_from_extraction(chart: ExtractedSizeChart, keep: Callable[[float], bool] = lambda _v: True) -> tuple[list[dict[str, Any]], int]:
    """Turn an extracted chart into stored rows (still in the printed unit). Values failing `keep` are dropped and counted."""
    rows, dropped = [], 0
    for r in chart.rows:
        meas: dict[str, list[float]] = {}
        for m in r.measurements:
            vals = [v for v in (m.min, m.max) if v is not None]
            if not vals:
                continue
            if not all(keep(v) for v in vals):
                dropped += 1
                continue
            meas[m.dimension.strip().lower().replace(" ", "_")] = [min(vals), max(vals)]
        if meas:
            rows.append({"size": r.size, "labels": {lb.system: lb.value for lb in r.other_labels}, "measurements": meas})
    return rows, dropped


def chart_fields(chart: ExtractedSizeChart, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Model fields for a SizeChart built from an extraction (rows converted to cm)."""
    present = {d for r in rows for d in r["measurements"]}
    order = [d for d in DIMENSIONS if d in present] + sorted(present - set(DIMENSIONS))
    systems: list[str] = []
    for r in rows:
        systems += [s for s in r["labels"] if s not in systems]
    return {
        "garment_type": chart.garment_type, "brand": (chart.brand_or_seller or None) and chart.brand_or_seller[:200],
        "dimensions": order or GARMENT_DIMENSIONS[chart.garment_type], "size_systems": systems,
        "rows": normalise_rows(rows, chart.unit), "fit_notes": chart.fit_notes,
    }


def extract_from_image(db: Session, project: BusinessProject, user: User, media_type: str, data: bytes) -> ExtractedSizeChart:
    llm = get_llm()
    ex = start_execution(db, agent="fit", operation="extract_size_chart", project_id=project.id, user_id=user.id,
                         model=llm.model, input_summary=f"Size chart image ({media_type}, {len(data) // 1024} KB)")
    db.commit()
    prompt = f"Transcribe this size chart. The founder sells {project.product_category} in {project.target_country}."
    try:
        out, usage = with_retries(lambda: llm.structured(system=SYSTEM, prompt=prompt, output_model=ExtractedSizeChart,
                                                          max_tokens=8000, images=[(media_type, data)]))
    except Exception as e:
        finish_execution(ex, error=str(e)[:2000])
        db.commit()
        raise
    apply_usage(ex, usage)
    finish_execution(ex, output={"rows": len(out.rows), "garment_type": out.garment_type, "unit": out.unit})
    return out
