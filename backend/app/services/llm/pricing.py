"""Estimated API pricing (USD). Used for cost tracking only - check your Anthropic invoice for actuals."""

from __future__ import annotations

# model -> (input $/MTok, output $/MTok, cache read $/MTok)
MODEL_PRICES: dict[str, tuple[float, float, float]] = {
    "claude-fable-5-1": (10.0, 50.0, 0.25),
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-opus-5": (5.0, 25.0, 0.50),
    "claude-opus-4-8": (5.0, 25.0, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-sonnet-5": (2.0, 10.0, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}
CACHE_WRITE_MULTIPLIER = 1.25
WEB_SEARCH_PRICE_PER_1K = 10.0


def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    search_requests: int = 0,
) -> float:
    inp, out, cache_read = MODEL_PRICES.get(model, MODEL_PRICES["claude-opus-5-5"])
    cost = (
        input_tokens * inp
        + output_tokens * out
        + cache_read_tokens * cache_read
        + cache_write_tokens * inp * CACHE_WRITE_MULTIPLIER
    ) / 1_000_000
    cost += search_requests * WEB_SEARCH_PRICE_PER_1K / 1000
    return round(cost, 6)
