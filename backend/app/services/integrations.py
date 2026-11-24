"""Integration interfaces for external platforms.

The MVP ships the contracts and status reporting only. No adapter performs an external
action; when one is implemented, every write must go through an approved ApprovalRequest.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from ..config import get_settings


@dataclass
class IntegrationStatus:
    key: str
    name: str
    category: str  # commerce | sourcing | design
    state: str  # planned | not_configured | configured
    detail: str


class CommercePlatform(Protocol):
    """E.g. Shopify. Writes require an approved ApprovalRequest id."""

    def test_connection(self) -> bool: ...

    def list_products(self) -> list[dict[str, Any]]: ...

    def publish_listing(self, *, approval_request_id: str, listing: dict[str, Any]) -> dict[str, Any]: ...

    def list_orders(self, *, since: str | None = None) -> list[dict[str, Any]]: ...


class SourcingMarketplace(Protocol):
    """E.g. Alibaba / 1688 via authorized partner APIs. Read-only search; no messaging without approval."""

    def search_suppliers(self, *, query: str, country: str | None = None) -> list[dict[str, Any]]: ...

    def get_supplier(self, external_id: str) -> dict[str, Any]: ...


class ImageGenerator(Protocol):
    """Brand Studio image/mockup generation (planned)."""

    def generate(self, *, prompt: str, size: str) -> bytes: ...


def integration_statuses() -> list[IntegrationStatus]:
    s = get_settings()
    shopify_env = bool(s.shopify_store_domain and s.shopify_admin_token)
    return [
        IntegrationStatus(
            "shopify", "Shopify", "commerce", "planned",
            "Adapter interface defined. Catalog sync, listing publish and order import are planned; "
            + ("credentials detected but not used in this release." if shopify_env else "no credentials configured."),
        ),
        IntegrationStatus("alibaba", "Alibaba.com", "sourcing", "planned",
                          "Planned via authorized partner APIs only. Use manual entry or CSV import today."),
        IntegrationStatus("1688", "1688.com", "sourcing", "planned",
                          "The Supplier Finder reads 1688's public English search pages (free, no sign-in). Full Chinese search, "
                          "product details and messaging are planned via the 1688 Open Platform only."),
        IntegrationStatus("ads", "Meta / Google Ads", "commerce", "planned",
                          "Campaign launch is planned and will always require explicit approval."),
        IntegrationStatus("image_gen", "Image generation", "design", "planned",
                          "Brand Studio mockups/logo generation planned behind the ImageGenerator interface."),
    ]
