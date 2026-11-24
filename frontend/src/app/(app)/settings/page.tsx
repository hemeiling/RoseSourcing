"use client";

import { CheckCircle2, CircleDashed, Languages, ScrollText, Server, ShieldCheck, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth, useProjects, useStatus } from "@/components/providers";
import { ClaudeConnectorSection } from "@/components/settings/claude-connector";
import { LanguageSwitch } from "@/components/language-switch";
import { ConnectorsSection } from "@/components/settings/connectors";
import { Badge, Card, CardBody, CardHeader, PageHeader, Spinner, Tabs, Td, Th } from "@/components/ui";
import { UsageDashboard } from "@/components/usage-dashboard";
import { dateTime, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";
import type { AuditEvent } from "@/lib/types";

function Row({ label, children }: { label: MsgKey; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <span className="text-slate-600">{t(label)}</span>
      <span className="text-right text-slate-900">{children}</span>
    </div>
  );
}

function Configured({ ok, yes = "Configured", no = "Not configured" }: { ok: boolean; yes?: MsgKey; no?: MsgKey }) {
  const { t } = useT();
  return ok ? (
    <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> {t(yes)}</Badge>
  ) : (
    <Badge tone="amber"><CircleDashed className="h-3 w-3" /> {t(no)}</Badge>
  );
}

function AuditLog({ projectId }: { projectId: string }) {
  const { data } = useApi<AuditEvent[]>(`/api/projects/${projectId}/audit-events?limit=50`);
  const { t, tx } = useT();
  if (!data) return <CardBody><Spinner /></CardBody>;
  if (!data.length) return <CardBody><p className="text-sm text-slate-500">{t("No events recorded yet.")}</p></CardBody>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead className="border-b border-slate-100 bg-slate-50"><tr><Th>{t("When")}</Th><Th>{t("Actor")}</Th><Th>{t("Action")}</Th><Th>{t("Details")}</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs text-slate-500">{dateTime(e.created_at)}</Td>
              <Td><Badge tone={e.actor.startsWith("agent:") ? "violet" : "slate"}>{e.actor.startsWith("agent:") ? tx(AGENT_LABELS[e.actor.slice(6)]) || titleCase(e.actor.slice(6)) : titleCase(e.actor)}</Badge></Td>
              <Td className="text-xs">{e.action}</Td>
              <Td className="max-w-md break-all text-xs text-slate-500" >{Object.keys(e.details).length ? JSON.stringify(e.details) : ""}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SettingsTab = "api" | "usage";

// The server's agent keys (agents/runtime.py) and their labels, for the activity log.
const AGENT_LABELS: Record<string, string> = {
  opportunity_research: "Market Analyst", competitor_intelligence: "Competitor Finder", brand_strategy: "Brand & Content Writer",
  sourcing: "Sourcing & Shipping Researcher", commerce: "Sales & Shipping Planner", analytics: "Numbers Analyst", fit: "Size & Fit Checker",
  price_tier: "Price Range Finder", supplier_sourcing: "Supplier Finder", compliance: "Rules & Patent Checker", listing_tracker: "Top Listings Tracker",
  review_insights: "Complaint Reader", buyer_style: "Buyer Profiler", supplier_outreach: "Supplier Outreach Writer", supervisor: "Report Writer",
  copilot: "AI Business Copilot",
};

export default function SettingsPage() {
  const { status } = useStatus();
  const { user } = useAuth();
  const { project } = useProjects();
  const { t, tx, tr } = useT();
  // The tab lives in the URL (#usage), so a link or reload lands on it.
  const [tab, setTab] = useState<SettingsTab>("api");
  useEffect(() => {
    if (window.location.hash === "#usage") setTab("usage");
  }, []);
  const pick = (next: SettingsTab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "usage" ? "#usage" : window.location.pathname);
  };

  return (
    <>
      <PageHeader title={t("Settings")} description={t("Your API keys and providers, and what the AI has cost. Secrets are set as environment variables on the server (Render dashboard) and are never shown here.")} />
      <Card className="mb-5">
        <CardHeader title={t("Interface language")} icon={<Languages className="h-4 w-4" />} actions={<LanguageSwitch showIcon={false} />}
          subtitle={t("Switch every page between English and Chinese. Research the agents already wrote (findings, reports, supplier names) stays in the language it was written in. Saved in this browser.")} />
      </Card>
      <Tabs tabs={[{ value: "api", label: t("API configuration") }, { value: "usage", label: t("Usage analysis") }]} value={tab} onChange={pick} />
      {tab === "usage" ? (
        <div className="grid gap-5">
          <UsageDashboard />
          {project && (
            <Card>
              <CardHeader title={t("Activity - {name}", { name: project.short_name || project.name })} icon={<ScrollText className="h-4 w-4" />}
                subtitle={t("Every change by you or an agent on this product, newest first. Pick another product at the top; its AI spend is in Usage above.")} />
              <AuditLog projectId={project.id} />
            </Card>
          )}
        </div>
      ) : !status ? <Spinner /> : (
        <div className="grid gap-5">
          <Card>
            <CardHeader title={t("AI model")} icon={<Server className="h-4 w-4" />} />
            <CardBody className="divide-y divide-slate-100 py-1">
              <Row label="Status"><Configured ok={status.ai.configured} /></Row>
              <Row label="Provider">{titleCase(status.ai.provider)}</Row>
              <Row label="Model">{status.ai.model}</Row>
              <Row label="Effort">{status.ai.effort}</Row>
              <Row label="Refusal fallback">{status.ai.refusal_fallback === "off" ? t("Off") : t("Server-side fallback on")}</Row>
              {!status.ai.configured && <p className="py-2.5 text-xs text-amber-800">{tr("Set {key} on the server and redeploy. Until then, AI features show this requirement instead of generating content.", { key: <code>ANTHROPIC_API_KEY</code> })}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("Research providers")} icon={<Workflow className="h-4 w-4" />} subtitle={t("Default: {provider} (RESEARCH_PROVIDER)", { provider: status.research.default_provider })} />
            <CardBody className="divide-y divide-slate-100 py-1">
              {status.research.providers.map((p) => (
                <div key={p.name} className="py-2.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-800">{tx(p.label)}</span>
                    <Configured ok={p.configured} />
                  </div>
                  {p.requirement && <p className="mt-1 text-xs text-slate-500">{tx(p.requirement)}</p>}
                </div>
              ))}
            </CardBody>
          </Card>

          <ConnectorsSection />
          <ClaudeConnectorSection />

          <Card>
            <CardHeader title={t("Guardrails")} icon={<ShieldCheck className="h-4 w-4" />} subtitle={t("Bounded agent behaviour - no open-ended loops")} />
            <CardBody className="divide-y divide-slate-100 py-1">
              <Row label="Web searches per research step">{status.guardrails.max_searches_per_step}</Row>
              <Row label="Pages read in full per step">{status.guardrails.max_page_reads_per_step ?? 0}</Row>
              <Row label="Cost cap per research run">{money(status.guardrails.max_research_cost_usd, { decimals: 2 })}</Row>
              <Row label="Attempts per step (transient errors)">{status.guardrails.max_step_attempts}</Row>
              <Row label="Copilot lookups per answer">{status.guardrails.copilot_max_tool_rounds}</Row>
              <Row label="External actions">{t("Always require your approval")}</Row>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("Account & access")} />
            <CardBody className="divide-y divide-slate-100 py-1">
              <Row label="Signed in as">{user?.email}</Row>
              <Row label="Role">{titleCase(user?.role ?? "")}</Row>
              <Row label="Open sign-ups">{status.signup.enabled ? t("Enabled (SIGNUP_ENABLED)") : t("Closed")}</Row>
              <Row label="Invite list">{t("{n} email(s) in ALLOWED_SIGNUP_EMAILS", { n: status.signup.invite_list_size })}</Row>
            </CardBody>
          </Card>

          <Card >
            <CardHeader title={t("Agents")} subtitle={t("Logical agents in this release. Each runs as a bounded, single-purpose service with explicit tools and an execution log.")} />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {Object.entries(status.agents).map(([k, label]) => <Badge key={k} tone="blue">{tx(label)}</Badge>)}
              </div>
            </CardBody>
          </Card>

        </div>
      )}
    </>
  );
}
