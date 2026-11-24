"use client";

import { Compass, Ship, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FindingCard } from "@/components/evidence";
import { ConfirmModal } from "@/components/market/shared";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal, Spinner, type Tone } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { date, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ChannelPlan, Finding, ResearchRun } from "@/lib/types";

const ROLE_TONE: Record<string, Tone> = { primary: "slate", secondary: "slate", test: "slate" };

function FindingChips({ ids, findings, onOpen }: { ids: string[]; findings: Record<string, Finding>; onOpen: (f: Finding) => void }) {
  const items = ids.map((id) => findings[id]).filter(Boolean);
  if (!items.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {items.map((f, i) => (
        <button key={f.id} onClick={() => onOpen(f)} title={f.claim}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-700">
          evidence {i + 1}
        </button>
      ))}
    </span>
  );
}

function PlanView({ plan, findings, onOpen, onRefresh }: { plan: ChannelPlan; findings: Record<string, Finding>; onOpen: (f: Finding) => void; onRefresh: () => void }) {
  const c = plan.content;
  const was = c.based_on;
  const now = plan.current;
  const stale = !!(was && now && (was.retail_price === null || Math.abs((was.retail_price ?? 0) - now.retail_price) > 0.005));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Channel & shipping plan" icon={<Compass className="h-4 w-4" />}
          subtitle={`AI-written ${date(plan.created_at)} from your findings and channel numbers${was ? ` at ${money(was.retail_price)} retail (saved scenario '${was.scenario}')` : ""} · ${c.generated_by.model}`} />
        <CardBody className="space-y-4">
          {plan.refreshing ? (
            <Alert tone="blue">Rewriting the plan with your current numbers - this takes about a minute.</Alert>
          ) : stale && now && (
            <Alert>
              This plan was written at <b>{money(was?.retail_price)}</b> retail. Your saved scenario <b>&apos;{now.scenario}&apos;</b> now uses <b>{money(now.retail_price)}</b>, so
              the risks, channel picks and margins quoted below may be out of date.
              <div className="mt-2"><Button size="sm" onClick={onRefresh}>Rewrite the plan with {money(now.retail_price)}</Button></div>
            </Alert>
          )}
          <p className="text-sm leading-relaxed text-slate-800">{c.summary}</p>
          <div className="grid gap-4">
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Store className="h-3.5 w-3.5" /> Launch channels</h3>
              <ul className="space-y-2">
                {c.launch_channels.map((p) => (
                  <li key={p.channel} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-center gap-2"><Badge tone={ROLE_TONE[p.role] ?? "slate"}>{titleCase(p.role)}</Badge><span className="font-medium">{p.channel}</span></div>
                    <p className="mt-1 text-[13px] text-slate-600">{p.rationale}<FindingChips ids={p.finding_ids} findings={findings} onOpen={onOpen} /></p>
                  </li>
                ))}
              </ul>
              {c.channels_to_defer.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-slate-500">Defer for now</div>
                  <ul className="mt-1 space-y-1 text-[13px] text-slate-600">{c.channels_to_defer.map((d) => <li key={d.channel}><span className="font-medium text-slate-800">{d.channel}:</span> {d.reason}</li>)}</ul>
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Ship className="h-3.5 w-3.5" /> Shipping & fulfillment</h3>
              <dl className="space-y-2 text-[13px]">
                <div><dt className="font-medium text-slate-800">First order</dt><dd className="text-slate-600">{c.first_order_shipping}<FindingChips ids={c.shipping_finding_ids} findings={findings} onOpen={onOpen} /></dd></div>
                <div><dt className="font-medium text-slate-800">Once demand is proven</dt><dd className="text-slate-600">{c.replenishment_shipping}</dd></div>
                <div><dt className="font-medium text-slate-800">Fulfillment at launch</dt><dd className="text-slate-600">{c.fulfillment}</dd></div>
              </dl>
            </div>
          </div>
        </CardBody>
      </Card>
      <p className="text-sm text-slate-600">
        The plan&apos;s customs checks, risks, open questions and next steps are in{" "}
        <a href="#actions" className="font-semibold text-primary-700 underline">Risks &amp; next steps</a>.
      </p>
    </div>
  );
}

/** The channel & shipping plan and its evidence (the agent runs from the agents list at the top of the report). */
export function PlanTab({ projectId }: { projectId: string }) {
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const plan = useApi<ChannelPlan | null>(`/api/projects/${projectId}/channels/plan`);
  const latestRun = useMemo(() => runs.data?.find((r) => r.kind === "channels_logistics") ?? null, [runs.data]);
  const findingsRunId = plan.data?.content.research_run_id ?? latestRun?.id ?? null;
  const findings = useApi<Finding[]>(findingsRunId ? `/api/projects/${projectId}/findings?run_id=${findingsRunId}` : null);
  const byId = useMemo(() => Object.fromEntries((findings.data ?? []).map((f) => [f.id, f])), [findings.data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Finding | null>(null);
  const [refreshConfirm, setRefreshConfirm] = useState(false);
  // While the plan is being rewritten, check for the new one every few seconds.
  useEffect(() => {
    if (!plan.data?.refreshing) return;
    const t = setInterval(() => plan.reload(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.data?.refreshing]);

  async function refreshPlan() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/projects/${projectId}/channels/plan/refresh`);
      plan.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setRefreshConfirm(false);
    }
  }

  const evidence = (findings.data ?? []).filter((f) => ["channels", "logistics", "regulatory", "sourcing_costs", "pricing", "other"].includes(f.section));

  return (
    <div className="space-y-5">
      {error && <Alert tone="red">{error}</Alert>}
      {plan.loading && !plan.data ? <Spinner /> : plan.data ? (
        <PlanView plan={plan.data} findings={byId} onOpen={setOpen} onRefresh={() => setRefreshConfirm(true)} />
      ) : (
        <Card>
          <EmptyState icon={<Compass className="h-5 w-5" />} title="No channel & shipping plan yet">
            Run the Sales &amp; Shipping Planner from the <a href="#review" className="font-semibold text-primary-700 underline">agents list at the top</a>, or add channels and shipping quotes yourself on the other tabs - the calculators work without AI.
          </EmptyState>
        </Card>
      )}

      {evidence.length > 0 && (
        <Card>
          <CardHeader title="Evidence from the latest run" subtitle={`${evidence.length} findings with sources, evidence type and verification status`} />
          <CardBody className="grid gap-3">{evidence.map((f) => <FindingCard key={f.id} finding={f} compact />)}</CardBody>
        </Card>
      )}

      <ConfirmModal open={refreshConfirm} title="Rewrite the plan with your current numbers?" confirmLabel="Rewrite plan" busy={busy}
        onConfirm={refreshPlan} onClose={() => setRefreshConfirm(false)}>
        <p>This re-runs only the plan step: one AI call (usually well under $1) using the findings already saved, your channels as they are
          now, and your latest saved cost scenario. No new web searches. The old plan stays in the history.</p>
      </ConfirmModal>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Evidence">{open && <FindingCard finding={open} />}</Modal>
    </div>
  );
}
