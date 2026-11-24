"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, CircleHelp, ListChecks, ListTodo } from "lucide-react";
import { useMemo, useState } from "react";
import { FindingCard } from "./evidence";
import { SEVERITY_TONE } from "./market/shared";
import { useProjects } from "./providers";
import { Badge, Button, Card, CardBody, CardHeader, Modal, Spinner } from "./ui";
import { patch } from "@/lib/api";
import { date, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { ChannelPlan, Finding, Opportunity } from "@/lib/types";

type Rec = { id: string; source: string; title: string; body: string | null; priority: string; status: string; created_at: string };
type Risk = { risk: string; severity: string; mitigation: string; finding_ids: string[]; from: string };
type Question = { gap: string; why_it_matters?: string; how_to_close?: string; from: string };

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

type Dashboard = {
  counts: Record<string, number>;
  findings_by_type: Record<string, number>;
  latest_scenario: { contribution_margin: number | null; retail_price: number | null; costs_assumed: boolean } | null;
};
type Todo = { text: string; detail?: string; section: string; tone: "red" | "amber" | "slate" };

/** What is still missing that no agent fills - work for after the research, so it sits at the very end. */
function AlsoToDo({ projectId }: { projectId: string }) {
  const { t } = useT();
  const dash = useApi<Dashboard>(`/api/projects/${projectId}/dashboard`);
  const { projects } = useProjects();
  const decision = projects.find((p) => p.id === projectId)?.decision ?? "undecided";
  if (!dash.data) return <Spinner />;
  const c = dash.data.counts;
  const unavailable = dash.data.findings_by_type.unavailable ?? 0;
  const todos: Todo[] = [];
  const sc = dash.data.latest_scenario;
  const cm = sc?.contribution_margin;
  if (!sc || sc.costs_assumed)
    todos.push({ text: t("Margin not worked out yet"), detail: sc ? t("The research estimate uses assumed factory, freight and fee costs. Work out the margin in Unit economics with supplier quotes.") : t("Model cost, price and margin."), section: "economics", tone: "slate" });
  else if (cm !== null && cm !== undefined && cm < 0)
    todos.push({ text: t("Unit contribution is negative ({amount})", { amount: money(cm) }), detail: t("At {price} retail you lose money on each sale - revisit price or costs.", { price: money(sc.retail_price) }), section: "economics", tone: "red" });
  if (c.suppliers && !c.spec_sheets) todos.push({ text: t("No spec sheet yet"), detail: t("Draft the spec sheet suppliers will quote against."), section: "outreach", tone: "amber" });
  if (c.suppliers && c.rfqs_sent < 5)
    todos.push({ text: c.rfqs_sent ? t(c.rfqs_sent === 1 ? "Only {n} supplier asked for quotes" : "Only {n} suppliers asked for quotes", { n: c.rfqs_sent }) : t("No supplier asked for quotes yet"),
      detail: t("Send the spec sheet to 5+ suppliers for prices at 100 / 300 / 500 units."), section: "outreach", tone: "amber" });
  if (c.rfq_quotes && c.sample_orders < 2) todos.push({ text: t("Order 2-3 samples"), detail: t("Pick the best quotes and track each sample until you have scored it."), section: "outreach", tone: "slate" });
  if (unavailable) todos.push({ text: t("{n} research questions had no reliable data", { n: unavailable }), detail: t("Listed as 'data unavailable' findings - these are your evidence gaps."), section: "research", tone: "slate" });
  if (decision === "undecided") todos.push({ text: t("Record your go / no-go decision"), detail: t("Your decision is saved with a snapshot of the evidence."), section: "decision", tone: "slate" });
  if (!todos.length) return null;
  return (
    <Card>
      <CardHeader title={t("Also to do")} icon={<ListTodo className="h-4 w-4" />} subtitle={t("What is still missing that no agent fills. Each item jumps to where you do it.")} />
      <ul className="px-5 py-1">
        {todos.map((td) => (
          <li key={td.text} className="border-b border-slate-100 last:border-b-0">
            <a href={`#${td.section}`} className="group flex items-start gap-2.5 py-2">
              <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0", td.tone === "red" ? "text-red-600" : td.tone === "amber" ? "text-amber-600" : "text-slate-400")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-sm font-medium", td.tone === "red" ? "text-red-700" : "text-ink")}>{td.text}</span>
                {td.detail && <span className="block text-xs text-slate-500">{td.detail}</span>}
              </span>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Evidence links for an item; each opens the finding it rests on. */
function Evidence({ ids, byId, onOpen }: { ids: string[]; byId: Map<string, Finding>; onOpen: (f: Finding) => void }) {
  const { t } = useT();
  const items = ids.map((id) => byId.get(id)).filter((f): f is Finding => !!f);
  if (!items.length) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-xs text-slate-500">{t("Evidence:")}</span>
      {items.map((f, i) => (
        <button key={f.id} onClick={() => onOpen(f)} title={f.claim}
          className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-primary-300 hover:text-primary-700">
          {i + 1}
        </button>
      ))}
    </span>
  );
}

/**
 * Every agent's risks, open questions and next steps in one place, at the end of the report. Next steps are the saved
 * recommendations (each agent adds its own, without repeats), so marking one done here is the only place to do it.
 */
export function ActionPlan({ projectId }: { projectId: string }) {
  const { t } = useT();
  const reports = useApi<Opportunity[]>(`/api/projects/${projectId}/opportunities`);
  const plan = useApi<ChannelPlan | null>(`/api/projects/${projectId}/channels/plan`);
  const recs = useApi<Rec[]>(`/api/projects/${projectId}/recommendations`);
  const findings = useApi<Finding[]>(`/api/projects/${projectId}/findings`);
  const [open, setOpen] = useState<Finding | null>(null);
  const byId = useMemo(() => new Map((findings.data ?? []).map((f) => [f.id, f])), [findings.data]);

  if (!reports.data || plan.data === undefined || !recs.data) return <Spinner />;
  const report = reports.data[0];
  const reportFrom = report ? t("Market research, {date}", { date: date(report.created_at) }) : "";
  const planFrom = plan.data ? t("Channel & shipping plan, {date}", { date: date(plan.data.created_at) }) : "";
  const c = plan.data?.content;

  const risks: Risk[] = [
    ...(report?.report.risks ?? []).map((r) => ({ ...r, from: reportFrom })),
    ...(c?.risks ?? []).map((r) => ({ ...r, from: planFrom })),
  ].sort((a, b) => (RANK[a.severity] ?? 1) - (RANK[b.severity] ?? 1));
  const questions: Question[] = [
    ...(report?.report.evidence_gaps ?? []).map((g) => ({ ...g, from: reportFrom })),
    ...(c?.open_questions ?? []).map((g) => ({ ...g, from: planFrom })),
    ...(c?.customs_and_compliance ?? []).map((x) => ({ gap: x, from: t("{from} - confirm with a customs broker or the official source", { from: planFrom }) })),
  ];
  const steps = recs.data.filter((r) => r.status === "open" || r.status === "accepted")
    .sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1));

  const setStatus = async (id: string, status: "done" | "dismissed") => {
    await patch(`/api/recommendations/${id}`, { status }).catch(() => {});
    recs.reload();
  };
  return (
    <div className="grid gap-4">
      {!steps.length && !risks.length && !questions.length && (
        <p className="text-sm text-slate-500">{t("Risks, open questions and next steps appear here once the Market Analyst or the Sales & Shipping Planner has run.")}</p>
      )}
      {steps.length > 0 && (
        <Card>
          <CardHeader title={t("Next steps")} icon={<ListChecks className="h-4 w-4" />}
            subtitle={t("What every agent and the copilot recommend, most urgent first. Mark each done or dismiss it.")} />
          <CardBody>
            <ul className="divide-y divide-line">
              {steps.map((r) => (
                <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <Badge tone={SEVERITY_TONE[r.priority] ?? "slate"}>{titleCase(r.priority)}</Badge>
                    <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{r.title}</span>
                  </div>
                  {r.body && <p className="mt-1 text-sm text-slate-600">{r.body}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">{t("{source}, {date}", { source: titleCase(r.source), date: date(r.created_at) })}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setStatus(r.id, "done")}>{t("Done")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "dismissed")}>{t("Dismiss")}</Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {risks.length > 0 && (
        <Card>
          <CardHeader title={t("Risks")} icon={<AlertTriangle className="h-4 w-4" />} subtitle={t("From the market research and the channel & shipping plan, most severe first.")} />
          <CardBody>
            <ul className="divide-y divide-line">
              {risks.map((r, i) => (
                <li key={`${r.from}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <Badge tone={SEVERITY_TONE[r.severity] ?? "slate"}>{titleCase(r.severity)}</Badge>
                    <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{r.risk}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600"><span className="font-medium text-slate-700">{t("Mitigation:")}</span> {r.mitigation}</p>
                  <Evidence ids={r.finding_ids} byId={byId} onOpen={setOpen} />
                  <p className="mt-1 text-xs text-slate-500">{r.from}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {questions.length > 0 && (
        <Card>
          <CardHeader title={t("Open questions")} icon={<CircleHelp className="h-4 w-4" />} subtitle={t("What you still need to know or confirm before investing.")} />
          <CardBody>
            <ul className="divide-y divide-line">
              {questions.map((q, i) => (
                <li key={`${q.from}-${i}`} className="py-2.5 text-sm first:pt-0 last:pb-0">
                  <p className="font-medium text-slate-900">{q.gap}</p>
                  {q.why_it_matters && <p className="mt-0.5 text-slate-600"><span className="text-slate-500">{t("Why it matters:")}</span> {q.why_it_matters}</p>}
                  {q.how_to_close && <p className="mt-0.5 text-slate-600"><span className="text-slate-500">{t("How to close it:")}</span> {q.how_to_close}</p>}
                  <p className="mt-1 text-xs text-slate-500">{q.from}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <AlsoToDo projectId={projectId} />

      <Modal open={!!open} onClose={() => setOpen(null)} title={t("Evidence")} wide>
        {open && <FindingCard finding={open} />}
      </Modal>
    </div>
  );
}
