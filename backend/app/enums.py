"""Allowed values for string-typed enum columns."""

from typing import Literal

EvidenceType = Literal["sourced", "ai_inference", "assumption", "unavailable"]
Confidence = Literal["high", "medium", "low"]
# source_linked = an automated check found the claim attached to a verbatim excerpt the
# provider returned; it is NOT human verification. Only a user can set human_verified.
VerificationStatus = Literal["unverified", "source_linked", "human_verified", "disputed"]

FindingSection = Literal[
    "demand",
    "market_size",
    "growth",
    "customer_segments",
    "unmet_needs",
    "competitors",
    "pricing",
    "differentiation",
    "sourcing_costs",
    "channels",
    "risks",
    "regulatory",
    "logistics",
    "fit",
    "other",
]

RunStatus = Literal["queued", "running", "completed", "completed_with_errors", "failed", "interrupted", "cancelled"]
RunKind = Literal["market_opportunity", "competitor_discovery", "channels_logistics", "fit_sizing"]

SupplierVerification = Literal["unverified", "documents_received", "sample_approved", "audited"]
SUPPLIER_VERIFICATION_LABELS = {
    "unverified": "Unverified - no checks done",
    "documents_received": "Documents received (not independently verified)",
    "sample_approved": "Sample approved by you",
    "audited": "Factory audit completed (by you or a third party you hired)",
}

BrandKind = Literal["names", "positioning", "personas", "voice", "collections", "palettes", "messaging"]
ScenarioType = Literal["hypothetical", "quote_based", "actual", "research_estimate"]
InputBasis = Literal["assumption", "supplier_quote", "actual", "sourced_research"]
ApprovalAction = Literal["publish_listing", "purchase_inventory", "launch_campaign", "send_supplier_message"]

ShippingMode = Literal[
    "express_courier", "air_freight", "sea_lcl", "sea_fcl", "rail", "truck",
    "domestic_parcel", "fulfillment_3pl", "marketplace_fulfillment",
]
RateBasis = Literal["per_kg", "per_cbm", "per_shipment", "per_unit", "per_order"]
ChannelType = Literal["own_store", "marketplace", "social_commerce", "wholesale", "retail_partner", "events", "other"]
ChannelStatus = Literal["considering", "testing", "active", "paused", "rejected"]
