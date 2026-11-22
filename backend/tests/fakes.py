"""A scripted stand-in for the Anthropic provider (same interface, no network)."""

from __future__ import annotations

from typing import Any

from app.services.agents.research_schemas import (
    ExtractedCompetitor,
    ExtractedFinding,
    ExtractedMetric,
    ExtractedPrice,
    ExtractedSegment,
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


class FakeLLM:
    name = "anthropic"
    model = "claude-opus-5-5"
    effort = "medium"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def is_configured(self) -> bool:
        return True

    def web_research(self, *, system: str, prompt: str, max_searches: int, country_code: str | None) -> WebResearchResult:
        self.calls.append("web_research")
        r = WebResearchResult()
        r.queries = ["test query"]
        r.text_segments = [
            ("Industry body reports participation of 1.2 million social dancers.",
             [WebCitation(url="https://stats.example.org/dance", title="Dance Stats 2025",
                          cited_text="An estimated 1.2 million adults took part in social dance in 2025.")]),
            (" Brand A lists a practice dress at $79.",
             [WebCitation(url="https://branda.example.com/dress", title="Brand A Dress", cited_text="Practice Dress - $79.00")]),
        ]
        r.hits = [WebSearchHit(url="https://uncited.example.net", title="Uncited result", page_age="2 months ago")]
        r.usage = LLMUsage(input_tokens=1000, output_tokens=200, search_requests=2, cost_usd=0.03, model=self.model)
        return r

    def structured(self, *, system: str, prompt: str, output_model: type, max_tokens: int = 16000):
        self.calls.append(f"structured:{output_model.__name__}")
        usage = LLMUsage(input_tokens=500, output_tokens=300, cost_usd=0.01, model=self.model)
        if output_model is StepExtraction:
            return StepExtraction(
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
                                                                        product_url=None, source_ref="S42")])],
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
                unit_economics=UEProposal(retail_price=ue(69, "sourced_research", ["F1"]), factory_cost=ue(18), freight_per_unit=ue(3),
                                          duty_rate_pct=ue(30), import_clearance_per_unit=ue(0.5), packaging_per_unit=ue(1.5),
                                          fulfillment_per_unit=ue(6), payment_fee_pct=ue(2.9), marketing_cac=ue(15),
                                          return_rate_pct=ue(12), moq=ue(100)),
                risks=[RiskItem(risk="Tariff changes", severity="high", mitigation="Broker", finding_refs=[])],
                evidence_gaps=[GapItem(gap="Market size", why_it_matters="Sizing", how_to_close="Survey")],
                next_steps=[NextStep(action="Run a landing page test", rationale="Cheap", priority="high")],
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
        if ann is str:
            return "x"
        if ann in (int, float):
            return 3
        if args:  # Literal
            return args[0]
        return "x"

    return model(**{name: value(f.annotation) for name, f in model.model_fields.items()})
