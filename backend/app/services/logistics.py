"""Deterministic shipping and sales-channel economics. The AI never does this math."""

from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..models import BusinessProject, SalesChannel, ShippingOption
from .agents.sourcing import baseline_inputs
from .unit_economics import UnitEconomicsInputs, calculate

# Common volumetric-weight conventions (cm3 per kg). Carriers differ - an option's own divisor wins.
DEFAULT_DIVISOR = {"express_courier": 5000, "air_freight": 6000}
SEA_MODES = {"sea_lcl", "sea_fcl"}


class PackagingSpec(BaseModel):
    units_per_carton: int = Field(gt=0)
    carton_length_cm: float = Field(gt=0)
    carton_width_cm: float = Field(gt=0)
    carton_height_cm: float = Field(gt=0)
    carton_gross_weight_kg: float = Field(gt=0)


class Shipment(BaseModel):
    units: int = Field(gt=0, description="Units in this shipment")
    packaging: PackagingSpec


def _f(v: Any) -> float | None:
    return float(v) if v is not None else None


def shipment_metrics(s: Shipment) -> dict[str, float]:
    p = s.packaging
    cartons = math.ceil(s.units / p.units_per_carton)
    carton_cm3 = p.carton_length_cm * p.carton_width_cm * p.carton_height_cm
    return {
        "cartons": cartons,
        "gross_weight_kg": round(cartons * p.carton_gross_weight_kg, 2),
        "volume_cbm": round(cartons * carton_cm3 / 1_000_000, 3),
        "carton_cm3": carton_cm3,
    }


def option_cost(o: ShippingOption, s: Shipment) -> dict[str, Any]:
    """Cost of moving the shipment with one option, as a low/high range when the rate is a range."""
    m = shipment_metrics(s)
    notes: list[str] = []
    chargeable: float | None = None
    unit = ""
    if o.rate_basis == "per_kg":
        divisor = o.volumetric_divisor or DEFAULT_DIVISOR.get(o.mode)
        vol_kg = (m["cartons"] * m["carton_cm3"] / divisor) if divisor else 0.0
        chargeable = max(m["gross_weight_kg"], vol_kg)
        unit = "kg"
        if divisor:
            notes.append(f"Volumetric weight {vol_kg:.1f} kg at divisor {divisor}{'' if o.volumetric_divisor else ' (common default - confirm with carrier)'}.")
    elif o.rate_basis == "per_cbm":
        # Weight/measure: 1 CBM is charged as 1,000 kg, whichever is greater.
        chargeable = max(m["volume_cbm"], m["gross_weight_kg"] / 1000)
        unit = "W/M (cbm)"
    elif o.rate_basis == "per_shipment":
        chargeable = 1
        unit = "shipment"
    elif o.rate_basis in ("per_unit", "per_order"):
        chargeable = s.units
        unit = "unit" if o.rate_basis == "per_unit" else "order (1 unit/order)"

    def cost(rate: float | None) -> float | None:
        if rate is None or chargeable is None:
            return None
        c = rate * chargeable
        if o.min_charge is not None and c < float(o.min_charge):
            c = float(o.min_charge)
        return round(c + float(o.fixed_fees or 0), 2)

    low = cost(_f(o.rate))
    high = cost(_f(o.rate_high)) if o.rate_high is not None else low
    if o.currency.upper() != "USD":
        notes.append(f"Rate is in {o.currency}; convert to USD before comparing.")
    if o.rate is None:
        notes.append("No rate entered.")
    if o.includes_duties:
        notes.append("Quoted DDP: duties may already be included.")
    return {
        "option_id": str(o.id),
        "name": o.name,
        "leg": o.leg,
        "mode": o.mode,
        "provider": o.provider,
        "basis": o.basis,
        "source_url": o.source_url,
        "rate_basis": o.rate_basis,
        "chargeable": round(chargeable, 3) if chargeable is not None else None,
        "chargeable_unit": unit,
        "total_low": low,
        "total_high": high,
        "per_unit_low": round(low / s.units, 2) if low is not None else None,
        "per_unit_high": round(high / s.units, 2) if high is not None else None,
        "transit_days_min": o.transit_days_min,
        "transit_days_max": o.transit_days_max,
        "currency": o.currency,
        "notes": notes,
    }


def compare_shipping(options: list[ShippingOption], s: Shipment) -> dict[str, Any]:
    rows = [option_cost(o, s) for o in options]
    rows.sort(key=lambda r: (r["leg"] != "international", r["per_unit_low"] if r["per_unit_low"] is not None else float("inf")))
    return {"shipment": {"units": s.units, **{k: v for k, v in shipment_metrics(s).items() if k != "carton_cm3"}}, "rows": rows}


# ----------------------------------------------------------------------------- channels

CHANNEL_FIELD_MAP = {
    # channel column -> unit-economics input
    "price": "retail_price",
    "commission_pct": "channel_commission_pct",
    "per_order_fee": "channel_fee_per_order",
    "payment_fee_pct": "payment_fee_pct",
    "payment_fee_fixed": "payment_fee_fixed",
    "fulfillment_per_order": "fulfillment_per_unit",
    "marketing_cac": "marketing_cac",
    "return_rate_pct": "return_rate_pct",
}


def channel_inputs(base: UnitEconomicsInputs, base_basis: dict[str, str], ch: SalesChannel) -> tuple[UnitEconomicsInputs, dict[str, str]]:
    updates: dict[str, float] = {}
    basis = dict(base_basis)
    for col, field in CHANNEL_FIELD_MAP.items():
        v = getattr(ch, col)
        if v is not None:
            updates[field] = float(v)
            basis[field] = f"channel ({ch.fee_basis})" if col in ("commission_pct", "per_order_fee", "payment_fee_pct", "payment_fee_fixed") else "channel (assumption)"
    if ch.monthly_fee is not None:
        updates["monthly_fixed_costs"] = base.monthly_fixed_costs + float(ch.monthly_fee)
        basis["monthly_fixed_costs"] = f"base + channel monthly fee ({ch.fee_basis})"
    return base.model_copy(update=updates), basis


def channel_economics(db: Session, project: BusinessProject, channels: list[SalesChannel]) -> dict[str, Any]:
    base, base_name, base_basis = baseline_inputs(db, project)
    rows = []
    for ch in channels:
        inputs, basis = channel_inputs(base, base_basis, ch)
        r = calculate(inputs)
        monthly_alloc = None
        if ch.monthly_fee is not None and ch.expected_monthly_units:
            monthly_alloc = round(float(ch.monthly_fee) / ch.expected_monthly_units, 2)
        warnings = list(r["warnings"])
        if ch.fee_basis == "assumption":
            warnings.insert(0, "Fees are assumptions - check the platform's current fee page and mark them verified.")
        rows.append({
            "channel_id": str(ch.id),
            "name": ch.name,
            "channel_type": ch.channel_type,
            "status": ch.status,
            "fee_basis": ch.fee_basis,
            "fee_source_url": ch.fee_source_url,
            "fees_checked_at": ch.fees_checked_at,
            "price": inputs.retail_price,
            "channel_fees_per_unit": r["per_unit"]["channel_fees"],
            "payment_fees_per_unit": r["per_unit"]["payment_fees"],
            "contribution_margin": r["contribution_margin"],
            "contribution_margin_after_monthly_fee": round(r["contribution_margin"] - monthly_alloc, 2) if monthly_alloc is not None else None,
            "contribution_margin_pct": r["contribution_margin_pct"],
            "breakeven_cac": r["breakeven_cac"],
            "breakeven_units_per_month": r["breakeven_units_per_month"],
            "inputs": inputs.model_dump(),
            "input_basis": basis,
            "warnings": warnings,
        })
    rows.sort(key=lambda x: x["contribution_margin"], reverse=True)
    return {"base_scenario": base_name, "base_price": base.retail_price, "rows": rows}
