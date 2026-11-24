"use client";

import { AlertTriangle, CircleHelp, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { FindingCard } from "./evidence";
import { SEVERITY_TONE } from "./market/shared";
import { Badge, Button, Card, CardBody, CardHeader, Modal, Spinner } from "./ui";
import { patch } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ChannelPlan, Finding, Opportunity } from "@/lib/types";

type Rec = { id: string; source: string; title: string; body: string | null; priority: string; status: string; created_at: string };
type Risk = { risk: string; severity: string; mitigation: string; finding_ids: string[]; from: string };
type Question = { gap: string; why_it_matters?: string; how_to_close?: string; from: string };

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Evidence links for an item; each opens the finding it rests on. */
function Evidence({ ids, byId, onOpen }: { ids: string[]; byId: Map<string, Finding>; onOpen: (f: Finding) => void }) {
  const items = ids.map((id) => byId.get(id)).filter((f): f is Finding => !!f);
  if (!items.length) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-xs text-slate-500">Evidence:</span>
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
  const reports = useApi<Opportunity[]>(`/api/projects/${projectId}/opportunities`);
  const plan = useApi<ChannelPlan | null>(`/api/projects/${projectId}/channels/plan`);
  const recs = useApi<Rec[]>(`/api/projects/${projectId}/recommendations`);
  const findings = useApi<Finding[]>(`/api/projects/${projectId}/findings`);
  const [open, setOpen] = useState<Finding | null>(null);
  const byId = useMemo(() => new Map((findings.data ?? []).map((f) => [f.id, f])), [findings.data]);

  if (!reports.data || plan.data === undefined || !recs.data) return <Spinner />;
  const report = reports.data[0];
  const reportFrom = report ? `Market research, ${date(report.created_at)}` : "";
  const planFrom = plan.data ? `Channel & shipping plan, ${date(plan.data.created_at)}` : "";
  const c = plan.data?.content;

  const risks: Risk[] = [
    ...(report?.report.risks ?? []).map((r) => ({ ...r, from: reportFrom })),
    ...(c?.risks ?? []).map((r) => ({ ...r, from: planFrom })),
  ].sort((a, b) => (RANK[a.severity] ?? 1) - (RANK[b.severity] ?? 1));
  const questions: Question[] = [
    ...(report?.report.evidence_gaps ?? []).map((g) => ({ ...g, from: reportFrom })),
    ...(c?.open_questions ?? []).map((g) => ({ ...g, from: planFrom })),
    ...(c?.customs_and_compliance ?? []).map((x) => ({ gap: x, from: `${planFrom} - confirm with a customs broker or the official source` })),
  ];
  const steps = recs.data.filter((r) => r.status === "open" || r.status === "accepted")
    .sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1));

  const setStatus = async (id: string, status: "done" | "dismissed") => {
    await patch(`/api/recommendations/${id}`, { status }).catch(() => {});
    recs.reload();
  };
  const empty = <p className="text-sm text-slate-500">Nothing yet. The Market Research and Channels & Shipping agents add these when they run.</p>;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Next steps" icon={<ListChecks className="h-4 w-4" />}
          subtitle="What every agent and the copilot recommend, most urgent first. Mark each done or dismiss it." />
        <CardBody>
          {steps.length === 0 ? empty : (
            <ul className="divide-y divide-line">
              {steps.map((r) => (
                <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <Badge tone={SEVERITY_TONE[r.priority] ?? "slate"}>{titleCase(r.priority)}</Badge>
                    <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{r.title}</span>
                  </div>
                  {r.body && <p className="mt-1 text-sm text-slate-600">{r.body}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">{titleCase(r.source)}, {date(r.created_at)}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setStatus(r.id, "done")}>Done</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "dismissed")}>Dismiss</Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Risks" icon={<AlertTriangle className="h-4 w-4" />} subtitle="From the market research and the channel & shipping plan, most severe first." />
        <CardBody>
          {risks.length === 0 ? empty : (
            <ul className="divide-y divide-line">
              {risks.map((r, i) => (
                <li key={`${r.from}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <Badge tone={SEVERITY_TONE[r.severity] ?? "slate"}>{titleCase(r.severity)}</Badge>
                    <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{r.risk}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600"><span className="font-medium text-slate-700">Mitigation:</span> {r.mitigation}</p>
                  <Evidence ids={r.finding_ids} byId={byId} onOpen={setOpen} />
                  <p className="mt-1 text-xs text-slate-500">{r.from}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Open questions" icon={<CircleHelp className="h-4 w-4" />} subtitle="What you still need to know or confirm before investing." />
        <CardBody>
          {questions.length === 0 ? empty : (
            <ul className="divide-y divide-line">
              {questions.map((q, i) => (
                <li key={`${q.from}-${i}`} className="py-2.5 text-sm first:pt-0 last:pb-0">
                  <p className="font-medium text-slate-900">{q.gap}</p>
                  {q.why_it_matters && <p className="mt-0.5 text-slate-600"><span className="text-slate-500">Why it matters:</span> {q.why_it_matters}</p>}
                  {q.how_to_close && <p className="mt-0.5 text-slate-600"><span className="text-slate-500">How to close it:</span> {q.how_to_close}</p>}
                  <p className="mt-1 text-xs text-slate-500">{q.from}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title="Evidence" wide>
        {open && <FindingCard finding={open} />}
      </Modal>
    </div>
  );
}
