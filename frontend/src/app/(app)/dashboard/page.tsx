"use client";

import { ArrowRight, BarChart3, Bot, CheckCircle2, Circle, Factory, FileSearch, Lightbulb, Swords, TrendingUp } from "lucide-react";
import Link from "next/link";
import { RequireProject } from "@/components/app-shell";
import { DecisionPanel } from "@/components/decision";
import { EVIDENCE_META } from "@/components/evidence";
import { useProjects, useStatus } from "@/components/providers";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, EmptyState, PageHeader, Spinner, StatCard, type Tone } from "@/components/ui";
import { errorText, patch } from "@/lib/api";
import { ago, money, pct, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { EvidenceType } from "@/lib/types";

type Dashboard = {
  counts: Record<string, number>;
  findings_by_type: Record<string, number>;
  latest_report: { id: string; title: string; attractiveness: string | null; summary: string | null; created_at: string } | null;
  latest_run: { id: string; kind: string; status: string; current_step: string | null; created_at: string } | null;
  latest_scenario: { id: string; name: string; type: string; contribution_margin: number | null; contribution_margin_pct: number | null; retail_price: number | null } | null;
  open_recommendations: { id: string; title: string; priority: string; source: string; status: string }[];
  recent_activity: { action: string; actor: string; entity_type: string | null; created_at: string }[];
  ai_spend_usd: number;
};

const ATTRACTIVENESS: Record<string, { label: string; tone: Tone }> = {
  promising: { label: "Promising", tone: "green" },
  mixed: { label: "Mixed", tone: "amber" },
  weak: { label: "Weak", tone: "red" },
  insufficient_evidence: { label: "Insufficient evidence", tone: "slate" },
};

function DashboardView({ projectId }: { projectId: string }) {
  const { project, reload: reloadProjects } = useProjects();
  const { status } = useStatus();
  const { data, loading, error, reload } = useApi<Dashboard>(`/api/projects/${projectId}/dashboard`);

  if (loading && !data) return <Spinner />;
  if (error) return <Alert tone="red">{errorText(error)}</Alert>;
  if (!data || !project) return null;
  const c = data.counts;

  const steps = [
    { done: true, label: "Create a business project", href: "/projects" },
    { done: c.research_runs > 0, label: "Run AI market opportunity research", href: "/market" },
    { done: c.reports > 0, label: "Review the opportunity report and its evidence", href: "/market" },
    { done: c.competitors > 0, label: "Build your competitor list and price observations", href: "/competitors" },
    { done: c.suppliers > 0, label: "Add supplier quotes (manual or CSV)", href: "/suppliers" },
    { done: c.scenarios > 0, label: "Model unit economics scenarios", href: "/analytics" },
    { done: (c.channels ?? 0) > 0, label: "Choose selling channels and a shipping plan", href: "/channels" },
    { done: c.brand_concepts > 0, label: "Explore brand concepts", href: "/brand" },
  ];

  async function setRec(id: string, s: string) {
    await patch(`/api/recommendations/${id}`, { status: s }).catch(() => {});
    reload();
  }

  const totalFindings = Object.values(data.findings_by_type).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title={project.name}
        description={`${project.product_category} · ${project.target_country}${project.sourcing_country ? ` · sourcing from ${project.sourcing_country}` : ""}${project.budget_usd !== null ? ` · budget ${money(project.budget_usd, { decimals: 0 })}` : ""}`}
        actions={<Link href="/copilot"><Button variant="secondary"><Bot className="h-4 w-4" /> Ask the copilot</Button></Link>}
      />
      {status && !status.ai.configured && <div className="mb-5"><ConfigNotice message={status.ai.requirement} /></div>}
      <div className="mb-5">
        <DecisionPanel projectId={projectId} decision={project.decision} note={project.decision_note} onChanged={() => { reloadProjects(); reload(); }} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Research findings" value={c.findings} icon={<FileSearch className="h-4 w-4" />}
          hint={totalFindings ? `${data.findings_by_type.sourced ?? 0} sourced · ${data.findings_by_type.ai_inference ?? 0} inference` : "No research yet"} />
        <StatCard label="Competitors tracked" value={c.competitors} icon={<Swords className="h-4 w-4" />} hint={`${c.watchlist} on watchlist`} />
        <StatCard label="Suppliers" value={c.suppliers} icon={<Factory className="h-4 w-4" />} hint="Manual entry or CSV" />
        <StatCard label="Cost scenarios" value={c.scenarios} icon={<BarChart3 className="h-4 w-4" />} hint={`${c.reports} opportunity report${c.reports === 1 ? "" : "s"}`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Latest opportunity assessment" icon={<TrendingUp className="h-4 w-4" />}
              actions={<Link href={data.latest_report ? `/market?report=${data.latest_report.id}` : "/market"} className="text-xs font-medium text-brand-700 hover:underline">
                {data.latest_report ? "Open report" : "Go to Market Opportunity"}</Link>} />
            <CardBody>
              {data.latest_report ? (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{data.latest_report.title}</span>
                    {data.latest_report.attractiveness && (
                      <Badge tone={ATTRACTIVENESS[data.latest_report.attractiveness]?.tone ?? "slate"} title="AI judgment based on stored findings">
                        {ATTRACTIVENESS[data.latest_report.attractiveness]?.label ?? data.latest_report.attractiveness} (AI assessment)
                      </Badge>
                    )}
                    <span className="text-xs text-slate-400">{ago(data.latest_report.created_at)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.latest_report.summary}</p>
                </div>
              ) : (
                <EmptyState icon={<TrendingUp className="h-5 w-5" />} title="No opportunity report yet"
                  action={<Link href="/market"><Button>Start market research <ArrowRight className="h-4 w-4" /></Button></Link>}>
                  The research agent searches the web, records every source, and labels each finding as sourced evidence, AI inference, assumption or unavailable data.
                </EmptyState>
              )}
              {data.latest_run && ["queued", "running"].includes(data.latest_run.status) && (
                <Alert tone="blue" className="mt-3">
                  A {titleCase(data.latest_run.kind)} run is in progress{data.latest_run.current_step ? ` (${titleCase(data.latest_run.current_step)})` : ""}.{" "}
                  <Link href="/market" className="font-medium underline">View progress</Link>
                </Alert>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Open recommendations" icon={<Lightbulb className="h-4 w-4" />} subtitle="From research reports and the copilot. Mark them done or dismiss." />
            <CardBody className="p-0">
              {data.open_recommendations.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No open recommendations.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.open_recommendations.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <Badge tone={r.priority === "high" ? "red" : r.priority === "medium" ? "amber" : "slate"}>{titleCase(r.priority)}</Badge>
                      <span className="min-w-0 flex-1 text-sm text-slate-800">{r.title}</span>
                      <Badge>{titleCase(r.source)}</Badge>
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setRec(r.id, "done")}>Done</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRec(r.id, "dismissed")}>Dismiss</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Evidence mix" subtitle="How much of what you know is backed by retrieved sources" />
            <CardBody>
              {totalFindings === 0 ? (
                <p className="text-sm text-slate-500">No findings yet.</p>
              ) : (
                <>
                  <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                    {(["sourced", "ai_inference", "assumption", "unavailable"] as EvidenceType[]).map((t) => {
                      const n = data.findings_by_type[t] ?? 0;
                      const color = { sourced: "bg-emerald-500", ai_inference: "bg-violet-500", assumption: "bg-amber-400", unavailable: "bg-slate-400" }[t];
                      return n ? <div key={t} className={color} style={{ width: `${(100 * n) / totalFindings}%` }} title={`${EVIDENCE_META[t].label}: ${n}`} /> : null;
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {(["sourced", "ai_inference", "assumption", "unavailable"] as EvidenceType[]).map((t) => (
                      <span key={t}>{EVIDENCE_META[t].label}: <strong>{data.findings_by_type[t] ?? 0}</strong></span>
                    ))}
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Getting started" />
            <CardBody>
              <ul className="space-y-2.5">
                {steps.map((s) => (
                  <li key={s.label} className="flex items-start gap-2 text-sm">
                    {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
                    <Link href={s.href} className={s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800 hover:text-brand-700"}>{s.label}</Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Latest cost scenario" icon={<BarChart3 className="h-4 w-4" />} />
            <CardBody>
              {data.latest_scenario ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{data.latest_scenario.name}</span>
                    <Badge tone={data.latest_scenario.type === "actual" ? "green" : "amber"}>{titleCase(data.latest_scenario.type)}</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{money(data.latest_scenario.contribution_margin)}<span className="ml-1 text-xs font-normal text-slate-500">/ unit contribution</span></p>
                  <p className="text-xs text-slate-500">{pct(data.latest_scenario.contribution_margin_pct)} of net revenue at {money(data.latest_scenario.retail_price)} retail</p>
                  {data.latest_scenario.type !== "actual" && <p className="mt-2 text-[11px] text-amber-700">Includes assumptions - see input sources in Analytics.</p>}
                  <Link href="/analytics" className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">Open analytics</Link>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No scenarios yet. <Link href="/analytics" className="text-brand-700 hover:underline">Build one</Link>.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent activity" subtitle={`Estimated AI spend on this project: ${money(data.ai_spend_usd, { decimals: 2 })}`} />
            <CardBody className="p-0">
              {data.recent_activity.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recent_activity.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-5 py-2 text-xs">
                      <span className="text-slate-700">{titleCase(a.action.replace(".", " "))}</span>
                      <span className="shrink-0 text-slate-400">{a.actor.startsWith("agent:") ? "AI · " : ""}{ago(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return <RequireProject>{(pid) => <DashboardView projectId={pid} />}</RequireProject>;
}
