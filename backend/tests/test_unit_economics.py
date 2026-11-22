from app.services.unit_economics import UnitEconomicsInputs, calculate, landed_cost


def test_landed_cost_components():
    i = UnitEconomicsInputs(factory_cost=20, freight_per_unit=3, duty_rate_pct=25, import_clearance_per_unit=1, packaging_per_unit=2)
    lc = landed_cost(i)
    assert lc["duty"] == 5.0
    assert lc["landed_cost"] == 31.0


def test_contribution_margin_hand_calculated():
    i = UnitEconomicsInputs(
        retail_price=100, avg_discount_pct=0, factory_cost=20, freight_per_unit=0, duty_rate_pct=0, import_clearance_per_unit=0,
        packaging_per_unit=0, fulfillment_per_unit=10, payment_fee_pct=3, payment_fee_fixed=0, units_per_order=1,
        marketing_cac=20, return_rate_pct=10, return_cost_per_unit=5, unsellable_return_pct=50, monthly_fixed_costs=300,
        initial_investment=5000, moq=100,
    )
    r = calculate(i)
    # revenue after returns 90; landed 20; fulfillment 10; fees 3; return handling 0.5; unsellable 0.1*0.5*20 = 1
    assert r["per_unit"]["cm_before_marketing"] == 55.5
    assert r["contribution_margin"] == 35.5
    assert r["breakeven_cac"] == 55.5
    assert r["breakeven_units_per_month"] == round(300 / 35.5, 2)
    assert r["affordable_units_with_budget"] == 250
    assert len(r["price_sensitivity"]) == 7


def test_warnings_for_negative_margin_and_moq():
    r = calculate(UnitEconomicsInputs(retail_price=20, factory_cost=18, moq=1000, initial_investment=1000))
    joined = " ".join(r["warnings"])
    assert "negative" in joined
    assert "MOQ" in joined
