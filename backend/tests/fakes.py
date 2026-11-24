"""A scripted stand-in for the Anthropic provider (same interface, no network)."""

from __future__ import annotations

import re
from typing import Any

from app.services.agents.research_schemas import (
    ExtractedChannel,
    ExtractedCompetitor,
    ExtractedFinding,
    ExtractedMetric,
    ExtractedPrice,
    ExtractedSegment,
    ExtractedMeasure,
    ExtractedPriceTier,
    ExtractedSupplierListing,
    ExtractedShipping,
    ExtractedSizeChart,
    ExtractedSizeLabel,
    ExtractedSizeRow,
    GapItem,
    NextStep,
    OpportunitySynthesis,
    RefIdea,
    RiskItem,
    StepExtraction,
    UEInput,
    UEProposal,
)
from app.services.llm.base import ChatResult, LLMUsage, ToolCallRecord, WebCitation, WebResearchResult, WebSearchHit


def _ext(**kw: Any) -> StepExtraction:
    for k in ("findings", "segments", "competitors", "channels", "shipping_benchmarks", "size_charts", "price_tiers", "supplier_listings", "evidence_gaps"):
        kw.setdefault(k, [])
    return StepExtraction(**kw)


class FakeLLM:
    name = "anthropic"
    model = "claude-opus-5-5"
    effort = "medium"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def is_configured(self) -> bool:
        return True

    def web_research(self, *, system: str, prompt: str, max_searches: int, country_code: str | None, max_fetches: int = 0) -> WebResearchResult:
        self.calls.append("web_research")
        r = WebResearchResult()
        r.queries = ["test query"]
        r.text_segments = [
            ("Industry body reports participation of 1.2 million social dancers.",
             [WebCitation(url="https://stats.example.org/dance", title="Dance Stats 2025",
                          cited_text="An estimated 1.2 million adults took part in social dance in 2025.")]),
            (" Brand A lists a practice dress at $79.",
             [WebCitation(url="https://branda.example.com/dress", title="Brand A Dress", cited_text="Practice Dress - $79.00")]),
            (" The marketplace charges a 17% referral fee on clothing.",
             [WebCitation(url="https://market.example.com/fees", title="Seller fees", cited_text="Clothing & Accessories: 17% referral fee")]),
            (" Air freight costs about $5.50 to $7.00 per kg.",
             [WebCitation(url="https://freight.example.com/rates", title="Freight index",
                          cited_text="Air freight China to US: $5.50-$7.00 per kg, 5-8 days")]),
        ]
        if "size chart" in prompt.lower():
            r.text_segments.append((
                " Brand A publishes a size guide.",
                [WebCitation(url="https://branda.example.com/size-guide", title="Brand A size guide",
                             cited_text="Size S: bust 80-84 cm, waist 62-66 cm. Size M: bust 85-89 cm, waist 67-71 cm. Runs small.")],
            ))
        r.hits = [WebSearchHit(url="https://uncited.example.net", title="Uncited result", page_age="2 months ago")]
        r.usage = LLMUsage(input_tokens=1000, output_tokens=200, search_requests=2, cost_usd=0.03, model=self.model)
        return r

    def structured(self, *, system: str, prompt: str, output_model: type, max_tokens: int = 16000, images=None):
        self.calls.append(f"structured:{output_model.__name__}")
        usage = LLMUsage(input_tokens=500, output_tokens=300, cost_usd=0.01, model=self.model)
        if output_model.__name__.startswith("Extraction_") and "Populate channels" in prompt:
            return _ext(
                findings=[ExtractedFinding(section="channels", claim="The marketplace charges a 17% referral fee on clothing.", detail=None,
                                           evidence_type="sourced", confidence="high", source_refs=["S3"],
                                           supporting_quote="17% referral fee", metric=None)],
                segments=[], competitors=[], shipping_benchmarks=[],
                channels=[
                    ExtractedChannel(name="Example Marketplace", platform="Example", channel_type="marketplace", commission_pct=17,
                                     per_order_fee=0.99, payment_fee_pct=None, payment_fee_fixed=None, monthly_fee=None,
                                     fee_source_ref="S3", requirements="Category approval may apply", audience_fit=None, source_refs=["S3"]),
                    ExtractedChannel(name="Studio wholesale", platform=None, channel_type="wholesale", commission_pct=None, per_order_fee=None,
                                     payment_fee_pct=None, payment_fee_fixed=None, monthly_fee=None, fee_source_ref=None,
                                     requirements=None, audience_fit="Instructors recommend outfits", source_refs=[]),
                ],
                evidence_gaps=[],
            ), usage
        if output_model.__name__.startswith("Extraction_") and "Populate price_tiers" in prompt:
            m = re.search(r"\[(S\d+)\] Brand A Dress", prompt)
            ref = m.group(1) if m else "S1"
            return _ext(price_tiers=[
                ExtractedPriceTier(tier="premium", price_low=70, price_high=120, currency="USD", materials_and_quality=["Lined, stretch mesh"],
                                   buyer_profile="Competitive dancers", customer_needs=["Comfort for long practice"], complaints=["Runs small"],
                                   examples=[ExtractedPrice(product_name="Practice Dress", price=79, currency="USD", product_url=None, source_ref=ref),
                                             ExtractedPrice(product_name="Invented gown", price=999, currency="USD", product_url=None, source_ref=ref)],
                                   source_refs=[ref]),
                ExtractedPriceTier(tier="budget", price_low=None, price_high=None, currency="USD", materials_and_quality=[], buyer_profile=None,
                                   customer_needs=["Cheap"], complaints=[], examples=[], source_refs=[]),
            ]), usage
        if output_model.__name__.startswith("Extraction_") and "Populate supplier_listings" in prompt:
            m = re.search(r"\[(S\d+)\] Brand A Dress", prompt)
            ref = m.group(1) if m else "S1"
            return _ext(supplier_listings=[
                ExtractedSupplierListing(supplier_name="Yiwu Knot Co", platform="alibaba", product_title="Knotted headband", listing_url=None,
                                         price_low=79, price_high=None, currency="USD", moq=500, customization=["Custom logo"],
                                         lead_time_days=None, seller_signals=["5 years"], source_ref=ref),
                ExtractedSupplierListing(supplier_name="Ghost Factory", platform="dhgate", product_title="Invented", listing_url=None,
                                         price_low=1.23, price_high=None, currency="USD", moq=None, customization=[], lead_time_days=None,
                                         seller_signals=[], source_ref=ref),
                ExtractedSupplierListing(supplier_name="unknown", platform="alibaba", product_title="Velvet knot band", listing_url=None,
                                         price_low=79, price_high=None, currency="USD", moq=None, customization=[], lead_time_days=None,
                                         seller_signals=[], source_ref=ref),
                # A listing page that showed no price: kept as a lead because its link is a product listing.
                ExtractedSupplierListing(supplier_name="yundance", platform="alibaba", product_title="K-323 Latin Dance Dress",
                                         listing_url="https://www.alibaba.com/product-detail/K-323-Latin-Dance-Dress_1601169741486.html?utm_source=linkedin",
                                         price_low=None, price_high=None, currency="USD", moq=None, customization=["Custom colors"],
                                         lead_time_days=None, seller_signals=[], source_ref=ref),
            ]), usage
        if output_model.__name__ == "CompliancePlan":
            return output_model(summary="Check labels and traceability.", caveat="Not legal advice.",
                                items=[{"area": "forced_labor", "requirement": "Trace cotton origin", "status": "action_needed",
                                        "what_to_do": "Ask the supplier for mill records", "finding_refs": ["F1"]}],
                                supplier_questions=["Which mill spun the cotton?", "Can you send fiber content test reports?"]), usage
        if output_model.__name__.startswith("Extraction_") and "Populate size_charts" in prompt:
            m = re.search(r"\[(S\d+)\] Brand A size guide", prompt)
            row = lambda size, bust, waist: ExtractedSizeRow(  # noqa: E731
                size=size, other_labels=[ExtractedSizeLabel(system="US", value={"S": "4", "M": "8"}[size])],
                measurements=[ExtractedMeasure(dimension="bust", min=bust[0], max=bust[1]),
                              ExtractedMeasure(dimension="waist", min=waist[0], max=waist[1])])
            return _ext(size_charts=[ExtractedSizeChart(
                brand_or_seller="Brand A", product_type="Latin dress", garment_type="dress", unit="cm",
                rows=[row("S", (80, 84), (62, 66)), row("M", (85, 89), (67, 99))],  # 99 is not in the source and must be dropped
                fit_notes="Runs small.", source_ref=m.group(1) if m else None)]), usage
        if output_model is ExtractedSizeChart:
            self.images = images
            return ExtractedSizeChart(
                brand_or_seller="Factory X", product_type="Latin dress", garment_type="dress", unit="in",
                rows=[ExtractedSizeRow(size="S", other_labels=[], measurements=[ExtractedMeasure(dimension="bust", min=32, max=33)]),
                      ExtractedSizeRow(size="M", other_labels=[], measurements=[ExtractedMeasure(dimension="bust", min=34, max=35)])],
                fit_notes=None, source_ref=None), usage
        if output_model.__name__.startswith("Extraction_") and "Populate shipping_benchmarks" in prompt:
            return _ext(
                findings=[], segments=[], competitors=[], channels=[],
                shipping_benchmarks=[
                    ExtractedShipping(mode="air_freight", leg="international", origin="China", destination="US", rate_low=5.5, rate_high=7.0,
                                      currency="USD", rate_basis="per_kg", transit_days_min=5, transit_days_max=8, as_of="2026",
                                      source_ref="S4", notes=None),
                    ExtractedShipping(mode="sea_lcl", leg="international", origin="China", destination="US", rate_low=88.0, rate_high=None,
                                      currency="USD", rate_basis="per_cbm", transit_days_min=None, transit_days_max=None, as_of=None,
                                      source_ref="S4", notes="invented"),
                ],
                evidence_gaps=[],
            ), usage
        if output_model.__name__.startswith("Extraction_"):
            return _ext(
                findings=[
                    ExtractedFinding(section="market_size", claim="About 1.2 million adults took part in social dance in 2025.",
                                     detail=None, evidence_type="sourced", confidence="high", source_refs=["S1"],
                                     supporting_quote="An estimated 1.2 million adults took part in social dance in 2025.",
                                     metric=ExtractedMetric(name="participants", value_low=1.2, value_high=None, unit="million", year="2025")),
                    ExtractedFinding(section="market_size", claim="The US Latin dancewear market is worth $450 million.",
                                     detail=None, evidence_type="sourced", confidence="high", source_refs=["S1"],
                                     supporting_quote=None, metric=None),
                    ExtractedFinding(section="growth", claim="Demand likely grows with dance TV shows.", detail=None,
                                     evidence_type="sourced", confidence="medium", source_refs=["S99"], supporting_quote=None, metric=None),
                ],
                segments=[ExtractedSegment(name="Social dancers", description="Adults dancing socially", needs=["comfort"],
                                           unmet_needs=["affordable fit"], size_indicator=None, evidence_type="ai_inference",
                                           confidence="low", source_refs=[])],
                competitors=[ExtractedCompetitor(name="Brand A", website="https://branda.example.com", positioning="Practice wear",
                                                 price_tier="mid", channels=["own website"], source_refs=["S2"],
                                                 prices=[ExtractedPrice(product_name="Practice Dress", price=79.0, currency="USD",
                                                                        product_url="https://branda.example.com/dress", source_ref="S2"),
                                                         ExtractedPrice(product_name="Ghost Skirt", price=55.0, currency="USD",
                                                                        product_url=None, source_ref="S42")],
                                                 # Not stated in S2's text, so it must not be saved.
                                                 revenue=ExtractedMetric(name="Brand A annual sales", value_low=12.5, value_high=None,
                                                                         unit="USD million", year="2024"),
                                                 revenue_source_ref="S2")],
                channels=[], shipping_benchmarks=[],
                evidence_gaps=["No category-specific market size found."],
            ), usage
        if output_model is OpportunitySynthesis:
            def ue(v: float, basis: str = "assumption", refs: list[str] | None = None) -> UEInput:
                return UEInput(value=v, basis=basis, finding_refs=refs or [], note="test")

            return OpportunitySynthesis(
                executive_summary="Evidence is thin; test demand cheaply.", attractiveness="mixed",
                attractiveness_rationale="Participation exists (F1) but no market size.", attractiveness_finding_refs=["F1"],
                recommended_segment="Social dancers", recommended_segment_rationale="Largest group", segment_finding_refs=["F1"],
                differentiation=[RefIdea(idea="Inclusive sizing", rationale="Fit complaints", finding_refs=["F1"])],
                pricing_summary="Competitor at $79", test_price_low=59, test_price_high=79, pricing_finding_refs=["F1"],
                unit_economics=UEProposal(retail_price=ue(69, "sourced_research", ["F1", "F2"]), factory_cost=ue(18), freight_per_unit=ue(3),
                                          duty_rate_pct=ue(30), import_clearance_per_unit=ue(0.5), packaging_per_unit=ue(1.5),
                                          fulfillment_per_unit=ue(6), payment_fee_pct=ue(2.9), marketing_cac=ue(15),
                                          return_rate_pct=ue(12), moq=ue(100)),
                risks=[RiskItem(risk="Tariff changes", severity="high", mitigation="Broker", finding_refs=[])],
                evidence_gaps=[GapItem(gap="Market size", why_it_matters="Sizing", how_to_close="Survey")],
                next_steps=[NextStep(action="Run a landing page test", rationale="Cheap", priority="high")],
            ), usage
        if output_model.__name__ == "ListingPick":
            # Every candidate except unrelated sweatbands; the brand only for the first one.
            idx = [int(m.group(1)) for m in re.finditer(r"^\[(\d+)\] (?!.*[Ss]weatband)", prompt, re.M)]
            return output_model(picked=[{"index": i, "brand": "Lele Sadoughi" if n == 0 else None, "why_comparable": "Knotted fabric headband"}
                                        for n, i in enumerate(idx)] + [{"index": 999, "brand": None, "why_comparable": "Out of range"}],
                                left_out="Sweatbands."), usage
        if output_model.__name__ == "ReviewTagging":
            ref = re.search(r"\[(S\d+)\] Low-star reviews:", prompt).group(1)
            return output_model(summary="Knots loosen and bands pinch.", themes=[
                {"tag": "durability", "summary": "Knots come undone.", "fix": "Stitch the knot closed."},
                {"tag": "comfort", "summary": "Pressure behind the ears.", "fix": "Use a padded, softer band."},
            ], reviews=[
                {"source_ref": ref, "product": "Knot headband", "stars": 2, "quote": "The knot came undone after two wears",
                 "tags": ["durability"], "problem": "knot comes undone"},
                {"source_ref": ref, "product": "Knot headband", "stars": 1, "quote": "gives me a headache within an hour",
                 "tags": ["comfort", "durability"], "problem": "headache"},  # two durability quotes from one source page
                {"source_ref": ref, "product": "Knot headband", "stars": 1, "quote": "An invented complaint nobody wrote",
                 "tags": ["fit"], "problem": "invented"},
            ]), usage
        if output_model.__name__ == "SocialPostsOut":
            ref = re.search(r"^\[(C\d+)\] \"I'm 34", prompt, re.M).group(1)  # buyer words reach the content prompt
            assert "never present them as\n  testimonials" in system and "[K1]" in prompt
            return output_model(posts=[{"platform": "instagram", "format": "reel", "hook": "Plaid that stays put", "caption": "Made for work days.",
                                        "hashtags": ["#knotheadband"], "visual": "Close-up of a plaid knot", "based_on": [ref, "K1", "X9"],
                                        "needs_checking": ["Non-slip lining"]}]), usage
        if output_model.__name__ == "ShortName":
            return output_model(short_name="Dance Practice Wear"), usage
        if output_model.__name__ == "CommentTagging":
            refs = {m.group(2): m.group(1) for m in re.finditer(r"^\[(C\d+)\] (.*)$", prompt, re.M)}
            ref = lambda part: next((r for t, r in refs.items() if part in t), None)  # noqa: E731
            tag = dict(age=None, age_band="unknown", wearer="unknown", gift=False, occasions=[], liked=[], disliked=[])
            wanted = [
                (ref("I'm 34"), {"age": 34, "age_band": "30s", "wearer": "self", "occasions": ["Work"], "liked": ["plaid"],
                                 "quote": "I'm 34 and wear the plaid one to work every day"}),
                (ref("teenage daughter"), {"age": 99, "age_band": "teen", "wearer": "daughter", "gift": True,  # 99 is not stated
                                           "occasions": ["school"], "liked": ["velvet"], "quote": "Bought this for my teenage daughter for school"}),
                (ref("knot came undone"), {"disliked": ["knot"], "quote": "The knot came undone after two wears"}),
                (ref("Love it"), {"liked": ["tweed"], "quote": "An invented sentence nobody ever wrote"}),
            ]
            return output_model(comments=[{**tag, "ref": r, **t} for r, t in wanted if r]), usage
        if output_model.__name__ == "StyleSynthesis":
            first = re.search(r"^\[(C\d+)\] .*I'm 34", prompt, re.M).group(1)  # only verified tags reach this call
            assert "invented sentence" not in prompt
            assert "work: 1" in prompt and "school: 1" in prompt  # the occasion tags are listed for grouping
            return output_model(summary="Plaid and velvet knots, worn to work and school.",
               occasion_groups=[{"name": "Work & school", "tags": ["work", "school"]}],
               style_terms=[{"term": "Plaid", "kind": "pattern", "synonyms": ["tartan"]}, {"term": "velvet", "kind": "material", "synonyms": []},
                            {"term": "knot", "kind": "shape", "synonyms": ["knotted"]}],
               personas=[{"name": "Office professional", "age_range": "30s", "description": "Wears it to work.", "wants": ["plaid"],
                          "comment_refs": [first, "C999"]}],
               design_directions=[{"title": "Plaid wide knot", "description": "Autumn plaid, padded wide knot.", "why": "Praised and best-selling.",
                                   "refs": [first, "L1", "X9"]}]), usage
        if output_model.__name__ == "UERecommendation":
            ref = re.search(r"\[(E\d+)\] Supplier listing price", prompt)
            return output_model(summary="Price in the premium tier.", inputs=[
                {"field": "retail_price", "value": 28, "basis": "sourced_research", "refs": ["E1"], "why": "Premium tier."},
                {"field": "factory_cost", "value": 1.2, "basis": "sourced_research", "refs": [ref.group(1)] if ref else [], "why": "Listing price."},
                {"field": "duty_rate_pct", "value": 34.6, "basis": "sourced_research", "refs": ["E999"], "why": "Invented ref."},
                {"field": "return_rate_pct", "value": 140, "basis": "assumption", "refs": [], "why": "Out of range."},
                {"field": "moq", "value": 300, "basis": "assumption", "refs": [], "why": "Fits the budget."},
            ]), usage
        if output_model.__name__ == "ProductIdentification":
            self.images = images
            return output_model(
                is_product=True, product_name="Women's Latin practice dress", research_category="Latin dance practice dresses",
                product_type="dress", key_attributes=["fringe hem", "v-neck"], materials_guess=["polyester spandex"],
                style_tags=["latin"], likely_customers=["social dancers"], price_tier_guess="mid",
                search_keywords=["latin dance dress", "latin practice dress"], visible_brand_or_text=None, ip_caution=None,
                uncertainties=["fabric"], confidence="medium",
            ), usage
        # Generators: build a minimal valid instance from the schema.
        return _minimal(output_model), usage

    def chat_with_tools(self, *, system: str, messages: list[dict[str, Any]], tools, execute, max_rounds: int) -> ChatResult:
        self.calls.append("chat")
        records = []
        for name, args in (("search_findings", {"query": "dance market"}),
                           ("calculate_unit_economics", {"overrides": {"retail_price": 69}}),
                           ("create_recommendation", {"title": "Validate sizing", "body": "Survey 20 dancers", "priority": "high"})):
            ok, content, summary = execute(name, args)
            records.append(ToolCallRecord(tool=name, input=args, ok=ok, summary=summary))
        return ChatResult(text="Based on your data...", tool_calls=records,
                          usage=LLMUsage(input_tokens=100, output_tokens=50, cost_usd=0.002, model=self.model), stop_reason="end_turn")


def _minimal(model: type) -> Any:
    from typing import get_args, get_origin

    from pydantic import BaseModel

    def value(ann: Any) -> Any:
        origin = get_origin(ann)
        args = get_args(ann)
        if origin is list:
            return [value(args[0])]
        if origin is not None and type(None) in args:
            return None
        if isinstance(ann, type) and issubclass(ann, BaseModel):
            return _minimal(ann)
        if ann is bool:
            return True
        if ann is str:
            return "x"
        if ann in (int, float):
            return 3
        if args:  # Literal
            return args[0]
        return "x"

    return model(**{name: value(f.annotation) for name, f in model.model_fields.items()})
