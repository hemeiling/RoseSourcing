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
  created_at: string;
  updated_at: string;
}

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
  kind: "market_opportunity" | "competitor_discovery";
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
}

export interface CompetitorProduct {
  id: string;
  name: string;
  url: string | null;
  product_type: string | null;
  material: string | null;
  notes: string | null;
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
  guardrails: { max_searches_per_step: number; max_research_cost_usd: number; max_step_attempts: number; copilot_max_tool_rounds: number };
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
