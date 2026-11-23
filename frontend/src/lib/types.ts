// Mirrors backend/app/schemas.py

export type EvidenceType = "sourced" | "ai_inference" | "assumption" | "unavailable";
export type Confidence = "high" | "medium" | "low";
export type VerificationStatus = "unverified" | "source_linked" | "human_verified" | "disputed";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

export interface Assumption {
  label: string;
  value: string;
  status: "hypothesis" | "validated" | "invalidated";
}

export interface Project {
  id: string;
  name: string;
  product_category: string;
  target_country: string;
  sourcing_country: string | null;
  budget_usd: number | null;
  target_customers: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  notes: string | null;
  assumptions: Assumption[];
  status: string;
  decision: Decision;
  decision_note: string | null;
  decided_at: string | null;
  cover_scan_id: string | null;
  created_at: string;
  updated_at: string;
}

export type Decision = "undecided" | "go" | "no_go" | "on_hold";

export interface RunStep {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  attempts: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  findings_count: number;
  sources_count: number;
}

export interface ResearchRun {
  id: string;
  project_id: string;
  kind: "market_opportunity" | "competitor_discovery" | "channels_logistics" | "fit_sizing" | "price_tiers" | "compliance" | "supplier_listings"
    | "listing_tracker" | "review_mining";
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "interrupted" | "cancelled";
  provider: string;
  model: string;
  params: Record<string, unknown>;
  steps: RunStep[];
  current_step: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  input_tokens: number;
  output_tokens: number;
  search_requests: number;
  cost_usd: number;
  created_at: string;
}

export interface EvidenceSource {
  id: string;
  url: string | null;
  title: string | null;
  domain: string | null;
  source_type: string;
  provider: string | null;
  retrieved_at: string;
  published_hint: string | null;
  excerpts: string[];
}

export interface Finding {
  id: string;
  research_run_id: string | null;
  section: string;
  claim: string;
  detail: string | null;
  evidence_type: EvidenceType;
  confidence: Confidence;
  verification_status: VerificationStatus;
  metric: { name: string; value_low: number | null; value_high: number | null; unit: string; year: string | null } | null;
  flags: string[];
  created_by: string;
  reviewer_note: string | null;
  created_at: string;
  sources: { source: EvidenceSource; quote: string | null }[];
}

export interface Segment {
  id: string;
  research_run_id: string | null;
  name: string;
  description: string | null;
  needs: string[];
  unmet_needs: string[];
  size_indicator: string | null;
  evidence_type: EvidenceType;
  confidence: Confidence;
  source_ids: string[];
}

export interface UEInputDetail {
  value: number;
  basis: string;
  finding_ids: string[];
  note: string;
}

export interface PriceTarget {
  target_pct: number;
  gross_margin_price: number | null;
  contribution_margin_price: number | null;
  contribution_note: string | null;
}

export interface UEResults {
  landed_cost_breakdown: Record<string, number>;
  per_unit: Record<string, number>;
  contribution_margin: number;
  contribution_margin_pct: number | null;
  gross_margin_pct: number | null;
  breakeven_cac: number;
  breakeven_units_per_month: number | null;
  moq_inventory_cost: number;
  affordable_units_with_budget: number | null;
  units_to_recover_investment: number | null;
  price_sensitivity: { price: number; contribution_margin: number; margin_pct: number | null }[];
  price_targets?: PriceTarget[];
  shipment_units?: number;
  by_shipment_size?: { units: number; shipping_per_unit: number; landed_cost: number; contribution_margin: number; order_cost: number; current: boolean }[];
  warnings: string[];
  error?: string;
}

export interface OpportunityReport {
  executive_summary: string;
  attractiveness: "promising" | "mixed" | "weak" | "insufficient_evidence";
  attractiveness_rationale: string;
  attractiveness_finding_ids: string[];
  recommended_segment: { name: string | null; rationale: string; finding_ids: string[] };
  differentiation: { idea: string; rationale: string; finding_ids: string[] }[];
  pricing: { summary: string; test_price_low: number | null; test_price_high: number | null; finding_ids: string[] };
  unit_economics: { inputs: Record<string, UEInputDetail>; results: UEResults; cost_scenario_id: string | null };
  risks: { risk: string; severity: "high" | "medium" | "low"; mitigation: string; finding_ids: string[] }[];
  evidence_gaps: { gap: string; why_it_matters: string; how_to_close: string }[];
  next_steps: { action: string; rationale: string; priority: "high" | "medium" | "low" }[];
  evidence_summary: { findings: number; by_type: Record<string, number>; source_linked: number };
  generated_by: { model: string; generated_at: string };
}

export interface Opportunity {
  id: string;
  project_id: string;
  research_run_id: string | null;
  title: string;
  category: string;
  geography: string;
  budget_usd: number | null;
  attractiveness: string | null;
  summary: string | null;
  report: OpportunityReport;
  created_at: string;
}

export interface PriceObservation {
  id: string;
  price: number;
  currency: string;
  observed_at: string;
  source_url: string | null;
  source_type: string;
  verification_status: string;
  note: string | null;
  platform: string | null;
  rating: number | null;
  review_count: number | null;
  badges: string[];
}

export interface CompetitorProduct {
  id: string;
  name: string;
  url: string | null;
  product_type: string | null;
  material: string | null;
  notes: string | null;
  image_url: string | null;
  price_observations: PriceObservation[];
}

export interface Competitor {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  positioning: string | null;
  price_tier: string | null;
  channels: string[];
  notes: string | null;
  on_watchlist: boolean;
  discovered_by: string;
  evidence_source_id: string | null;
  created_at: string;
  products: CompetitorProduct[];
}

export interface BrandConcept {
  id: string;
  kind: string;
  title: string;
  content: Record<string, unknown>;
  status: "draft" | "shortlisted" | "selected" | "rejected";
  brief: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  product_name: string;
  product_concept_id: string | null;
  moq: number | null;
  unit_price: number | null;
  currency: string;
  sample_cost: number | null;
  lead_time_days: number | null;
  incoterm: string | null;
  est_freight_per_unit: number | null;
  quote_date: string | null;
  valid_until: string | null;
  source: string;
  source_url: string | null;
  notes: string | null;
}

export interface Communication {
  id: string;
  occurred_at: string;
  channel: string;
  direction: "inbound" | "outbound" | "draft";
  subject: string | null;
  summary: string;
  next_action: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  country: string | null;
  city: string | null;
  website: string | null;
  platform: string | null;
  contact_name: string | null;
  contact_email: string | null;
  capabilities: string[];
  certifications_claimed: string[];
  verification_status: "unverified" | "documents_received" | "sample_approved" | "audited";
  quality_rating: number | null;
  quality_notes: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  quotes: Quote[];
  communications: Communication[];
}

export interface ComparisonRow {
  supplier_id: string;
  supplier_name: string;
  website: string | null;
  country: string | null;
  platform: string | null;
  verification_status: string;
  verification_label: string;
  quality_rating: number | null;
  quote_id: string;
  product_name: string;
  unit_price: number | null;
  currency: string;
  moq: number | null;
  sample_cost: number | null;
  lead_time_days: number | null;
  incoterm: string | null;
  quote_date: string | null;
  source_url: string | null;
  landed_cost: Record<string, number> | null;
  moq_landed_cost_total: number | null;
  within_budget: boolean | null;
  notes: string[];
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  product_type: string | null;
  target_price: number | null;
  materials: string | null;
  features: string[];
  sizes: string[];
  sku: string | null;
  status: "idea" | "sampling" | "approved" | "listed" | "retired";
  inventory_on_hand: number | null;
  reorder_point: number | null;
  listing_draft: {
    title: string;
    description: string;
    bullets: string[];
    tags: string[];
    seo_title: string;
    seo_description: string;
    size_guidance_note: string;
    claims_to_verify: string[];
    generated_at?: string;
  } | null;
  unit_weight_kg: number | null;
  units_per_carton: number | null;
  carton_length_cm: number | null;
  carton_width_cm: number | null;
  carton_height_cm: number | null;
  carton_gross_weight_kg: number | null;
  created_at: string;
}

export interface Approval {
  id: string;
  action_type: string;
  title: string;
  payload: Record<string, unknown>;
  status: string;
  requested_by: string;
  decided_at: string | null;
  execution_result: Record<string, unknown> | null;
  created_at: string;
}

export type InputBasis = "assumption" | "supplier_quote" | "actual" | "sourced_research";

export interface Scenario {
  id: string;
  name: string;
  scenario_type: "hypothetical" | "quote_based" | "actual" | "research_estimate";
  inputs: Record<string, number>;
  input_basis: Record<string, string>;
  results: UEResults;
  supplier_quote_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ModelSpec {
  defaults: Record<string, number>;
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  note: string;
}

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  method: string | null;
  success_metric: string | null;
  status: "planned" | "running" | "completed" | "abandoned";
  result: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  source: string;
  title: string;
  body: string | null;
  priority: "high" | "medium" | "low";
  status: "open" | "accepted" | "done" | "dismissed";
  created_at: string;
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: { tool: string; input: Record<string, unknown>; ok: boolean; summary: string }[];
  references: { type: string; id: string; label: string; url: string | null }[];
  created_at: string;
}

export interface CopilotThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: CopilotMessage[];
}

export interface ProviderStatus {
  name: string;
  label: string;
  configured: boolean;
  requirement: string | null;
}

export interface IntegrationStatus {
  key: string;
  name: string;
  category: string;
  state: string;
  detail: string;
}

export interface SystemStatus {
  environment: string;
  ai: { configured: boolean; provider: string; model: string; effort: string; refusal_fallback: string; requirement: string | null };
  research: { default_provider: string; providers: ProviderStatus[] };
  guardrails: { max_searches_per_step: number; max_page_reads_per_step?: number; max_research_cost_usd: number; max_step_attempts: number; copilot_max_tool_rounds: number };
  signup: { enabled: boolean; invite_list_size: number };
  integrations: IntegrationStatus[];
  agents: Record<string, string>;
}

export interface AgentExecution {
  id: string;
  agent: string;
  operation: string;
  status: string;
  model: string | null;
  provider: string | null;
  input_summary: string | null;
  error: string | null;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  search_requests: number;
  cost_usd: number;
  started_at: string;
  finished_at: string | null;
  research_run_id: string | null;
}

export interface AuditEvent {
  id: string;
  created_at: string;
  actor: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
}

export interface ShippingOption {
  id: string;
  name: string;
  leg: "international" | "domestic";
  mode: string;
  provider: string | null;
  origin: string | null;
  destination: string | null;
  rate_basis: "per_kg" | "per_cbm" | "per_shipment" | "per_unit" | "per_order";
  rate: number | null;
  rate_high: number | null;
  currency: string;
  min_charge: number | null;
  fixed_fees: number | null;
  volumetric_divisor: number | null;
  transit_days_min: number | null;
  transit_days_max: number | null;
  includes_duties: boolean;
  basis: "assumption" | "quote" | "sourced_research";
  source_url: string | null;
  quote_date: string | null;
  valid_until: string | null;
  notes: string | null;
  research_run_id: string | null;
  created_at: string;
}

export interface ShippingRow {
  option_id: string;
  name: string;
  leg: string;
  mode: string;
  provider: string | null;
  basis: string;
  source_url: string | null;
  rate_basis: string;
  chargeable: number | null;
  chargeable_unit: string;
  total_low: number | null;
  total_high: number | null;
  per_unit_low: number | null;
  per_unit_high: number | null;
  transit_days_min: number | null;
  transit_days_max: number | null;
  currency: string;
  notes: string[];
}

export interface ShippingComparison {
  shipment: { units: number; cartons: number; gross_weight_kg: number; volume_cbm: number };
  rows: ShippingRow[];
  base_scenario: { name: string; freight_per_unit: number; factory_cost: number };
}

export interface SalesChannel {
  id: string;
  name: string;
  channel_type: string;
  platform: string | null;
  status: "considering" | "testing" | "active" | "paused" | "rejected";
  price: number | null;
  commission_pct: number | null;
  per_order_fee: number | null;
  payment_fee_pct: number | null;
  payment_fee_fixed: number | null;
  monthly_fee: number | null;
  fulfillment_per_order: number | null;
  marketing_cac: number | null;
  return_rate_pct: number | null;
  expected_monthly_units: number | null;
  fee_basis: "assumption" | "verified" | "sourced_research";
  fee_source_url: string | null;
  fees_checked_at: string | null;
  audience_fit: string | null;
  requirements: string | null;
  pros: string[];
  cons: string[];
  notes: string | null;
  research_run_id: string | null;
  created_at: string;
}

export interface ChannelEconomicsRow {
  channel_id: string;
  name: string;
  channel_type: string;
  status: string;
  fee_basis: string;
  fee_source_url: string | null;
  fees_checked_at: string | null;
  price: number;
  channel_fees_per_unit: number;
  payment_fees_per_unit: number;
  contribution_margin: number;
  contribution_margin_after_monthly_fee: number | null;
  contribution_margin_pct: number | null;
  breakeven_cac: number;
  breakeven_units_per_month: number | null;
  input_basis: Record<string, string>;
  warnings: string[];
}

export interface ChannelPlan {
  id: string;
  created_at: string;
  /** The saved cost scenario the other tabs use now; compare with content.based_on to see if the plan is out of date. */
  current?: { scenario: string; retail_price: number };
  refreshing?: boolean;
  content: {
    based_on?: { scenario: string; retail_price: number | null; inferred?: boolean };
    summary: string;
    launch_channels: { channel: string; role: "primary" | "secondary" | "test"; rationale: string; finding_ids: string[] }[];
    channels_to_defer: { channel: string; reason: string }[];
    first_order_shipping: string;
    replenishment_shipping: string;
    shipping_finding_ids: string[];
    fulfillment: string;
    customs_and_compliance: string[];
    risks: { risk: string; severity: "high" | "medium" | "low"; mitigation: string; finding_ids: string[] }[];
    open_questions: { gap: string; why_it_matters: string; how_to_close: string }[];
    next_steps: { action: string; rationale: string; priority: "high" | "medium" | "low" }[];
    research_run_id: string;
    generated_by: { model: string; generated_at: string };
  };
}

export interface ConnectorField {
  name: string;
  label: string;
  secret: boolean;
  env: string | null;
  hint: string | null;
}

export interface ConnectorStatus {
  key: string;
  name: string;
  group: string;
  active: boolean;
  provides: string;
  requirements: string;
  cost: string;
  setup_url: string | null;
  login_note: string | null;
  fields: ConnectorField[];
  configured: boolean;
  source: "app" | "environment" | null;
  state: "connected" | "not_connected" | "credentials_saved";
  last_test_ok: boolean | null;
  last_test_message: string | null;
  last_tested_at: string | null;
}

export interface ProductIdentification {
  is_product: boolean;
  product_name: string;
  research_category: string;
  product_type: string;
  key_attributes: string[];
  materials_guess: string[];
  style_tags: string[];
  likely_customers: string[];
  price_tier_guess: string;
  search_keywords: string[];
  visible_brand_or_text: string | null;
  ip_caution: string | null;
  uncertainties: string[];
  confidence: "high" | "medium" | "low";
}

export interface ProductScan {
  id: string;
  project_id: string;
  status: "identifying" | "identified" | "failed";
  identification: ProductIdentification | null;
  error: string | null;
  research_run_id: string | null;
  image_url: string;
  created_at: string;
  run_status: string | null;
}

export interface PipelineItem {
  id: string;
  name: string;
  category: string;
  target_country: string;
  status: string;
  decision: Decision;
  decision_note: string | null;
  decided_at: string | null;
  image_url: string | null;
  attractiveness: string | null;
  ai_recommendation: "go" | "no_go" | "needs_more_evidence" | null;
  ai_headline: string | null;
  contribution_margin: number | null;
  contribution_margin_pct: number | null;
  scenario_type: string | null;
  latest_run: { id: string; kind: string; status: string; current_step: string | null } | null;
  counts: { findings: number; competitors: number; suppliers: number };
  last_decision_at: string | null;
  updated_at: string;
}

export interface DecisionBriefContent {
  recommendation: "go" | "no_go" | "needs_more_evidence";
  confidence: "high" | "medium" | "low";
  headline: string;
  reasons_for: { point: string; finding_ids: string[] }[];
  reasons_against: { point: string; finding_ids: string[] }[];
  key_numbers: { label: string; value: string; basis: string }[];
  conditions_to_go: string[];
  kill_criteria: string[];
  cheapest_next_test: string;
  evidence_gaps: string[];
  generated_by: { model: string; generated_at: string };
}

export interface DecisionHistoryItem {
  id: string;
  decision: Decision;
  note: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
}

// ----------------------------------------------------------------------------- sizing & fit

export type SizeRow = { size: string; labels: Record<string, string>; measurements: Record<string, [number, number]> };

export interface SizeChart {
  id: string;
  project_id: string;
  name: string;
  role: "reference" | "supplier" | "published";
  garment_type: "dress" | "top" | "bottom" | "bodysuit" | "shoes" | "other";
  brand: string | null;
  supplier_id: string | null;
  dimensions: string[];
  dimension_labels: Record<string, string>;
  size_systems: string[];
  rows: SizeRow[];
  stretch_allowance_cm: number;
  fit_notes: string | null;
  source_type: "manual" | "photo_extracted" | "research";
  source_url: string | null;
  retrieved_at: string | null;
  verification_status: "unverified" | "source_linked" | "human_verified";
  research_run_id: string | null;
  has_source_image: boolean;
  published: boolean;
  public_path: string | null;
  fit_stats: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export type PublicSizeGuide = Pick<SizeChart, "name" | "garment_type" | "brand" | "dimensions" | "dimension_labels" | "size_systems" | "rows" | "stretch_allowance_cm" | "fit_notes">;

export interface FitCheck { dimension: string; label: string; customer: number; min: number; max: number; result: "fits" | "snug" | "loose" | "too_small"; by_cm: number }

export interface FitResult {
  status: "fits" | "between_sizes" | "outside_chart" | "insufficient";
  recommended: string | null;
  recommended_labels?: Record<string, string>;
  used_dimensions: string[];
  missing_dimensions: string[];
  per_size: { size: string; labels: Record<string, string>; checks: FitCheck[]; fits: boolean }[];
  per_dimension: Record<string, string | null>;
  notes: string[];
}
