"""Supplier Outreach Agent: a spec sheet built from the product's research, and one request for quotation per supplier.

The spec sheet is an AI draft the founder edits. RFQ messages are rendered from the saved spec sheet (no AI), saved as
drafts, and sent by the founder - by email or through the supplier's marketplace page. 136Sourcing never sends them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import AnalysisSnapshot, BusinessProject, Supplier, User
from .generators import _run, project_brief

DEFAULT_QUANTITIES = [100, 300, 500]
RFQ_SUBJECT = "Request for quotation"
SPEC_LISTS = ("materials", "dimensions", "colours_patterns", "construction", "quality_requirements", "packaging_labeling",
              "documents_requested", "questions")
SPEC_HEADINGS = {"materials": "Materials", "dimensions": "Dimensions", "colours_patterns": "Colours & patterns",
                 "construction": "Construction", "quality_requirements": "Quality requirements",
                 "packaging_labeling": "Packaging & labelling", "documents_requested": "Documents we will need",
                 "questions": "Questions"}


class SpecSheetDraft(BaseModel):
    product_name: str
    summary: str = Field(description="Two sentences: what the product is and who it is for")
    materials: list[str]
    dimensions: list[str] = Field(description="Measurements with units. Mark any value the context does not support as 'to confirm'")
    colours_patterns: list[str]
    construction: list[str]
    quality_requirements: list[str] = Field(description="Requirements that prevent the complaints competitors' low-star reviews show")
    packaging_labeling: list[str]
    documents_requested: list[str] = Field(description="Certificates, test reports and declarations to request from the supplier")
    questions: list[str] = Field(description="Open questions for the supplier")


SPEC_SYSTEM = """You write a manufacturing spec sheet that a small brand sends to overseas factories with a request for quotation.
Rules:
- Use the product context, research and complaints given. Do not invent measurements, certifications or volumes: when a value
  is not in the context, write a sensible starting point followed by "(to confirm)".
- Turn every complaint theme into a concrete, checkable quality requirement (e.g. "Knot stitched closed so it cannot loosen").
- Labelling must cover what the compliance research requires (fibre content, country of origin, care) for the target market.
- Keep each line short and specific. Factories read this quickly; avoid marketing language."""


def _latest(db: Session, project_id, kind: str) -> AnalysisSnapshot | None:
    return db.scalars(select(AnalysisSnapshot).where(AnalysisSnapshot.project_id == project_id, AnalysisSnapshot.kind == kind)
                      .order_by(AnalysisSnapshot.created_at.desc())).first()


def research_context(db: Session, project: BusinessProject) -> str:
    """What the spec sheet should reflect: complaint themes, labelling rules, price tiers and comparable listings."""
    parts = [project_brief(db, project, max_findings=8)]
    if (rev := _latest(db, project.id, "review_insights")):
        parts.append("Complaints in competitors' low-star reviews (with suggested fixes):\n" + "\n".join(
            f"- {t['tag']} ({t['count']} reviews): {t['summary']} Fix: {t['fix']}" for t in rev.content.get("themes", [])))
    if (comp := _latest(db, project.id, "compliance_checklist")):
        parts.append("Compliance checklist:\n" + "\n".join(
            f"- [{i['area']}, {i['status']}] {i['requirement']} -> {i['what_to_do']}" for i in comp.content.get("items", [])[:14]))
    if (tiers := _latest(db, project.id, "price_tiers")):
        parts.append("Price tiers:\n" + "\n".join(
            f"- {t.get('tier')}: " + (f"${t['price_low']:.2f}-${t['price_high']:.2f}. " if t.get("price_low") is not None and t.get("price_high") is not None else "")
            + f"{t.get('materials_and_quality') or ''} Buyers need: {', '.join(t.get('customer_needs') or [])}"
            for t in (tiers.content.get("tiers") or [])[:4]))
    if (lt := _latest(db, project.id, "listing_tracker")):
        parts.append("Comparable listings: " + "; ".join(f"{r['title'][:80]} ${r['price']:.2f}" for r in lt.content.get("listings", [])[:8]))
    return "\n\n".join(parts)


def generate_spec_sheet(db: Session, project: BusinessProject, user: User, notes: str | None) -> AnalysisSnapshot:
    prompt = (f"{research_context(db, project)}\n\nFounder notes: {notes or '(none)'}\n\n"
              f"Write the spec sheet for {project.name}.")
    out, usage, ex = _run(db, agent="supplier_outreach", operation="spec_sheet", project=project, user=user,
                          system=SPEC_SYSTEM, prompt=prompt, output_model=SpecSheetDraft)
    content: dict[str, Any] = {
        **out.model_dump(), "quantities": DEFAULT_QUANTITIES, "incoterm": "FOB", "destination": project.target_country,
        "sample_request": "1 sample in each of 2 colourways", "target_unit_cost": None,
        "generated_by": {"model": usage.model, "generated_at": datetime.now(timezone.utc).isoformat()}, "edited_at": None,
    }
    snap = AnalysisSnapshot(project_id=project.id, kind="spec_sheet", content=content, agent_execution_id=ex.id)
    db.add(snap)
    return snap


def spec_text(spec: dict[str, Any]) -> str:
    lines = [f"Product: {spec.get('product_name', '')}", spec.get("summary") or ""]
    for key in SPEC_LISTS:
        items = [x for x in spec.get(key) or [] if str(x).strip()]
        if items:
            lines += ["", SPEC_HEADINGS[key] + ":"] + [f"{i}. {x}" if key == "questions" else f"- {x}" for i, x in enumerate(items, 1)]
    return "\n".join(lines).strip()


def rfq_message(spec: dict[str, Any], supplier: Supplier, project: BusinessProject) -> tuple[str, str]:
    qty = ", ".join(str(q) for q in spec.get("quantities") or DEFAULT_QUANTITIES)
    terms = f"{spec.get('incoterm') or 'FOB'}" + (f", shipping to {spec['destination']}" if spec.get("destination") else "")
    target = f"\nOur target unit cost is about ${float(spec['target_unit_cost']):.2f}." if spec.get("target_unit_cost") else ""
    subject = f"{RFQ_SUBJECT}: {spec.get('product_name') or project.name} - {qty} units"[:300]
    body = (
        f"Hello {supplier.contact_name or supplier.name},\n\n"
        f"We are a {project.target_country} brand preparing a first order of {spec.get('product_name') or project.name}. "
        f"Please quote for the product in the specification below.\n\n"
        f"Quantities: please give the unit price at {qty} units ({terms}).{target}\n"
        f"Samples: please confirm the price and shipping time for {spec.get('sample_request') or 'samples'}.\n"
        "Please also tell us your production lead time, payment terms, and which of the requested documents you can provide.\n\n"
        f"SPECIFICATION\n{spec_text(spec)}\n\nThank you - we look forward to your quotation."
    )
    return subject, body
