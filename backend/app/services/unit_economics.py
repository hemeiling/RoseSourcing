"""Deterministic unit-economics model. All AI features call this instead of doing math in-model."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class UnitEconomicsInputs(BaseModel):
    retail_price: float = Field(69.0, ge=0, description="List price per unit (USD)")
    avg_discount_pct: float = Field(0.0, ge=0, le=100, description="Average promo discount off list price")
    factory_cost: float = Field(18.0, ge=0, description="Unit cost from supplier (FOB/EXW)")
    freight_per_unit: float = Field(3.0, ge=0, description="International freight per unit: the carrier's rate times each unit's weight or volume")
    shipment_fixed_costs: float = Field(0.0, ge=0, description="Paid once per shipment however many units it carries: customs broker and entry, "
                                        "documents, pickup, delivery to your warehouse, the carrier's minimum charge")
    units_per_shipment: int = Field(0, ge=0, description="Units in each shipment; 0 = the supplier MOQ")
    duty_rate_pct: float = Field(0.0, ge=0, le=200, description="Customs duty as % of customs value (factory cost)")
    import_clearance_per_unit: float = Field(0.5, ge=0, description="Clearance fees that grow with each unit's value (e.g. MPF, HMF); "
                                             "per-shipment broker fees go in 'Fixed cost per shipment'")
    packaging_per_unit: float = Field(1.5, ge=0)
    fulfillment_per_unit: float = Field(6.0, ge=0, description="Domestic pick/pack/ship per order unit")
    payment_fee_pct: float = Field(2.9, ge=0, le=100)
    payment_fee_fixed: float = Field(0.30, ge=0, description="Fixed payment fee per order")
    channel_commission_pct: float = Field(0.0, ge=0, le=100, description="Marketplace referral/commission % of the sale price")
    channel_fee_per_order: float = Field(0.0, ge=0, description="Per-order marketplace/transaction fee")
    units_per_order: float = Field(1.0, gt=0)
    marketing_cac: float = Field(15.0, ge=0, description="Marketing cost to acquire one order")
    return_rate_pct: float = Field(10.0, ge=0, le=100)
    return_cost_per_unit: float = Field(8.0, ge=0, description="Return shipping + processing per returned unit")
    unsellable_return_pct: float = Field(20.0, ge=0, le=100, description="Share of returns that cannot be resold")
    monthly_fixed_costs: float = Field(150.0, ge=0, description="Software, subscriptions, storage etc.")
    initial_investment: float = Field(5000.0, ge=0, description="Total starting budget")
    moq: int = Field(100, ge=0, description="Supplier minimum order quantity (units)")
    sample_costs: float = Field(0.0, ge=0, description="One-time sample/prototype costs")


INPUT_LABELS: dict[str, str] = {
    "retail_price": "Retail price",
    "avg_discount_pct": "Average discount %",
    "factory_cost": "Factory cost",
    "freight_per_unit": "International freight / unit",
    "shipment_fixed_costs": "Fixed cost per shipment",
    "units_per_shipment": "Units per shipment (0 = MOQ)",
    "duty_rate_pct": "Customs duty %",
    "import_clearance_per_unit": "Import clearance / unit",
    "packaging_per_unit": "Packaging / unit",
    "fulfillment_per_unit": "Domestic fulfillment / unit",
    "payment_fee_pct": "Payment fee %",
    "payment_fee_fixed": "Payment fee fixed / order",
    "channel_commission_pct": "Channel commission %",
    "channel_fee_per_order": "Channel fee / order",
    "units_per_order": "Units per order",
    "marketing_cac": "Marketing CAC / order",
    "return_rate_pct": "Return rate %",
    "return_cost_per_unit": "Return cost / returned unit",
    "unsellable_return_pct": "Unsellable returns %",
    "monthly_fixed_costs": "Monthly fixed costs",
    "initial_investment": "Initial investment",
    "moq": "Supplier MOQ (units)",
    "sample_costs": "Sample costs",
}


def _r(x: float) -> float:
    return round(x, 2)


def shipment_units(i: UnitEconomicsInputs) -> int:
    return i.units_per_shipment or i.moq or 1


def landed_cost(i: UnitEconomicsInputs) -> dict[str, float]:
    duty = i.factory_cost * i.duty_rate_pct / 100
    # Per-shipment costs are shared by every unit in the shipment, so bigger shipments carry less of them per unit.
    shipment_share = i.shipment_fixed_costs / shipment_units(i)
    total = i.factory_cost + i.freight_per_unit + shipment_share + duty + i.import_clearance_per_unit + i.packaging_per_unit
    return {
        "factory_cost": _r(i.factory_cost),
        "freight": _r(i.freight_per_unit),
        "shipment_fees": _r(shipment_share),
        "duty": _r(duty),
        "clearance": _r(i.import_clearance_per_unit),
        "packaging": _r(i.packaging_per_unit),
        "landed_cost": _r(total),
    }


def price_for_margin(i: UnitEconomicsInputs, target_pct: float) -> dict[str, Any]:
    """The retail price that gives a target margin, both ways the calculator reports margin:
    gross = (net price - landed cost) / net price; contribution = contribution / net revenue after returns."""
    m = target_pct / 100
    keep = 1 - i.avg_discount_pct / 100
    lc = landed_cost(i)["landed_cost"]
    gross = round(lc / (1 - m) / keep, 2) if m < 1 and keep > 0 else None
    # Contribution and revenue are both straight lines in the price; read them off the model and solve where they meet.
    c0, c1 = _contribution(i, 0.0), _contribution(i, 1.0)
    slope = c1["contribution_margin"] - c0["contribution_margin"]
    revenue_per_dollar = c1["revenue_after_returns"]
    room = slope - m * revenue_per_dollar
    contribution = round(-c0["contribution_margin"] / room, 2) if room > 0 and c0["contribution_margin"] < 0 else None
    reason = None
    if contribution is None:
        reason = (f"Fees, returns and discounts take {100 * (1 - slope / revenue_per_dollar):.0f}% of net revenue, so no price reaches "
                  f"a {target_pct:g}% contribution margin." if room <= 0 else "Any price above $0 already reaches this margin.")
    return {"target_pct": target_pct, "gross_margin_price": gross, "contribution_margin_price": contribution, "contribution_note": reason}


SHIPMENT_SIZES = (100, 300, 500, 1000)


def _contribution(i: UnitEconomicsInputs, price: float) -> dict[str, float]:
    net_price = price * (1 - i.avg_discount_pct / 100)
    rr = i.return_rate_pct / 100
    lc = landed_cost(i)["landed_cost"]
    revenue_after_returns = net_price * (1 - rr)
    payment_fees = net_price * i.payment_fee_pct / 100 + i.payment_fee_fixed / i.units_per_order
    channel_fees = net_price * i.channel_commission_pct / 100 + i.channel_fee_per_order / i.units_per_order
    return_handling = rr * i.return_cost_per_unit
    unsellable_loss = rr * (i.unsellable_return_pct / 100) * lc
    cm_before_marketing = (
        revenue_after_returns - lc - i.fulfillment_per_unit - payment_fees - channel_fees - return_handling - unsellable_loss
    )
    marketing = i.marketing_cac / i.units_per_order
    cm = cm_before_marketing - marketing
    return {
        "net_price": net_price,
        "revenue_after_returns": revenue_after_returns,
        "landed_cost": lc,
        "fulfillment": i.fulfillment_per_unit,
        "payment_fees": payment_fees,
        "channel_fees": channel_fees,
        "return_handling": return_handling,
        "unsellable_loss": unsellable_loss,
        "cm_before_marketing": cm_before_marketing,
        "marketing": marketing,
        "contribution_margin": cm,
    }


def calculate(i: UnitEconomicsInputs) -> dict[str, Any]:
    c = _contribution(i, i.retail_price)
    lc = landed_cost(i)
    cm = c["contribution_margin"]
    net_rev = c["revenue_after_returns"]

    breakeven_units_monthly = (i.monthly_fixed_costs / cm) if cm > 0 else None
    moq_inventory_cost = i.moq * lc["landed_cost"]
    budget_after_samples = i.initial_investment - i.sample_costs
    affordable_units = int(budget_after_samples // lc["landed_cost"]) if lc["landed_cost"] > 0 else None
    units_to_recover_investment = (i.initial_investment / cm) if cm > 0 else None

    # Price sensitivity: contribution per unit at a range of price points.
    sensitivity = []
    for factor in (0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3):
        p = i.retail_price * factor
        cc = _contribution(i, p)
        sensitivity.append(
            {
                "price": _r(p),
                "contribution_margin": _r(cc["contribution_margin"]),
                "margin_pct": _r(100 * cc["contribution_margin"] / cc["revenue_after_returns"]) if cc["revenue_after_returns"] else None,
            }
        )

    # How much shipment size matters: the same inputs at other shipment sizes (only the per-shipment costs change).
    sizes = sorted({*SHIPMENT_SIZES, shipment_units(i)})
    by_shipment = []
    for n in sizes:
        si = i.model_copy(update={"units_per_shipment": n})
        slc = landed_cost(si)
        by_shipment.append({"units": n, "shipping_per_unit": _r(slc["freight"] + slc["shipment_fees"]), "landed_cost": slc["landed_cost"],
                            "contribution_margin": _r(_contribution(si, i.retail_price)["contribution_margin"]),
                            "order_cost": _r(n * slc["landed_cost"]), "current": n == shipment_units(i)})

    # Break-even CAC: the most you can pay per order and still break even per unit.
    breakeven_cac = c["cm_before_marketing"] * i.units_per_order

    warnings: list[str] = []
    if cm <= 0:
        warnings.append("Contribution margin is negative or zero: each sale loses money at these inputs.")
    if affordable_units is not None and i.moq and affordable_units < i.moq:
        warnings.append(
            f"Budget after samples covers ~{affordable_units} units at landed cost, below the MOQ of {i.moq}."
        )
    if moq_inventory_cost > budget_after_samples:
        warnings.append("MOQ inventory alone exceeds the remaining budget; no cash left for marketing.")
    if i.duty_rate_pct == 0:
        warnings.append(
            "Duty rate is 0%. Most apparel imports are dutiable - enter the rate for your HTS code (confirm with a customs broker)."
        )
    if net_rev and cm / net_rev < 0.15 and cm > 0:
        warnings.append("Contribution margin is under 15% of net revenue - little room for error.")

    return {
        "landed_cost_breakdown": lc,
        "per_unit": {k: _r(v) for k, v in c.items()},
        "contribution_margin": _r(cm),
        "contribution_margin_pct": _r(100 * cm / net_rev) if net_rev else None,
        "gross_margin_pct": _r(100 * (c["net_price"] - lc["landed_cost"]) / c["net_price"]) if c["net_price"] else None,
        "breakeven_cac": _r(breakeven_cac),
        "breakeven_units_per_month": _r(breakeven_units_monthly) if breakeven_units_monthly is not None else None,
        "moq_inventory_cost": _r(moq_inventory_cost),
        "affordable_units_with_budget": affordable_units,
        "units_to_recover_investment": _r(units_to_recover_investment) if units_to_recover_investment is not None else None,
        "price_sensitivity": sensitivity,
        "price_targets": [price_for_margin(i, t) for t in (10, 20, 30, 40, 50)],
        "shipment_units": shipment_units(i),
        "by_shipment_size": by_shipment,
        "warnings": warnings,
    }
