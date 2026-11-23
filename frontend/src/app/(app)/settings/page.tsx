"use client";

import { CheckCircle2, CircleDashed, ScrollText, Server, ShieldCheck, Workflow } from "lucide-react";
import { useAuth, useProjects, useStatus } from "@/components/providers";
import { ClaudeConnectorSection } from "@/components/settings/claude-connector";
import { ConnectorsSection } from "@/components/settings/connectors";
import { Badge, Card, CardBody, CardHeader, PageHeader, Spinner, Td, Th } from "@/components/ui";
import { dateTime, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AuditEvent } from "@/lib/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-right text-slate-900">{children}</span>
    </div>
  );
}

function Configured({ ok, yes = "Configured", no = "Not configured" }: { ok: boolean; yes?: string; no?: string }) {
  return ok ? (
    <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> {yes}</Badge>
  ) : (
    <Badge tone="amber"><CircleDashed className="h-3 w-3" /> {no}</Badge>
  );
}

function AuditLog({ projectId }: { projectId: string }) {
  const { data } = useApi<AuditEvent[]>(`/api/projects/${projectId}/audit-events?limit=50`);
  if (!data) return <CardBody><Spinner /></CardBody>;
  if (!data.length) return <CardBody><p className="text-sm text-slate-500">No events recorded yet.</p></CardBody>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead className="border-b border-slate-100 bg-slate-50"><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Details</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs text-slate-500">{dateTime(e.created_at)}</Td>
              <Td><Badge tone={e.actor.startsWith("agent:") ? "violet" : "slate"}>{e.actor.startsWith("agent:") ? titleCase(e.actor.slice(6)) : titleCase(e.actor)}</Badge></Td>
              <Td className="text-xs">{e.action}</Td>
              <Td className="max-w-md truncate text-xs text-slate-500" >{Object.keys(e.details).length ? JSON.stringify(e.details) : ""}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SettingsPage() {
  const { status } = useStatus();
  const { user } = useAuth();
  const { project } = useProjects();

  return (
    <>
      <PageHeader title="Settings" description="Server configuration, AI providers, guardrails and integrations. Secrets are set as environment variables on the server (Render dashboard) and are never shown here." />
      {!status ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="AI model" icon={<Server className="h-4 w-4" />} />
            <CardBody className="divide-y divide-slate-100 py-1">
              <Row label="Status"><Configured ok={status.ai.configured} /></Row>
              <Row label="Provider">{titleCase(status.ai.provider)}</Row>
              <Row label="Model">{status.ai.model}</Row>
              <Row label="Effort">{status.ai.effort}</Row>
              <Row label="Refusal fallback">{status.ai.refusal_fallback === "off" ? "Off" : "Server-side fallback on"}</Row>
              {!status.ai.configured && <p className="py-2.5 text-xs text-amber-800">Set <code>ANTHROPIC_API_KEY</code> on the server and redeploy. Until then, AI features show this requirement instead of generating content.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Research providers" icon={<Workflow className="h-4 w-4" />} subtitle={`Default: ${status.research.default_provider} (RESEARCH_PROVIDER)`} />
            <CardBody className="divide-y divide-slate-100 py-1">
              {status.research.providers.map((p) => (
                <div key={p.name} className="py-2.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-800">{p.label}</span>
                    <Configured ok={p.configured} />
                  </div>
                  {p.requirement && <p className="mt-1 text-xs text-slate-500">{p.requirement}</p>}
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Guardrails" icon={<ShieldCheck className="h-4 w-4" />} subtitle="Bounded agent behaviour - no open-ended loops" />
            <CardBody className="divide-y divide-slate-100 py-1">
              <Row label="Web searches per research step">{status.guardrails.max_searches_per_step}</Row>
              <Row label="Pages read in full per step">{status.guardrails.max_page_reads_per_step ?? 0}</Row>
              <Row label="Cost cap per research run">{money(status.guardrails.max_research_cost_usd, { decimals: 2 })}</Row>
              <Row label="Attempts per step (transient errors)">{status.guardrails.max_step_attempts}</Row>
              <Row label="Copilot lookups per answer">{status.guardrails.copilot_max_tool_rounds}</Row>
              <Row label="External actions">Always require your approval</Row>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account & access" />
            <CardBody className="divide-y divide-slate-100 py-1">
              <Row label="Signed in as">{user?.email}</Row>
              <Row label="Role">{titleCase(user?.role ?? "")}</Row>
              <Row label="Open sign-ups">{status.signup.enabled ? "Enabled (SIGNUP_ENABLED)" : "Closed"}</Row>
              <Row label="Invite list">{status.signup.invite_list_size} email(s) in ALLOWED_SIGNUP_EMAILS</Row>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Agents" subtitle="Logical agents in this release. Each runs as a bounded, single-purpose service with explicit tools and an execution log." />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {Object.entries(status.agents).map(([k, label]) => <Badge key={k} tone="blue">{label}</Badge>)}
              </div>
            </CardBody>
          </Card>

          <ConnectorsSection />
          <ClaudeConnectorSection />

          {project && (
            <Card className="lg:col-span-2">
              <CardHeader title={`Audit log - ${project.name}`} icon={<ScrollText className="h-4 w-4" />} subtitle="Every change by you or an agent is recorded." />
              <AuditLog projectId={project.id} />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
