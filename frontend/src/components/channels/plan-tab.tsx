"use client";

import { ClipboardCheck, Compass, Play, Ship, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FindingCard } from "@/components/evidence";
import { ConfirmModal, SEVERITY_TONE } from "@/components/market/shared";
import { RunCard } from "@/components/market/runs";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, EmptyState, Field, Modal, Spinner, Textarea, type Tone } from "@/components/ui";
import { ApiError, errorText, post } from "@/lib/api";
import { date, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { parseUrls } from "@/lib/agents";
import type { ChannelPlan, Finding, ProviderStatus, ResearchRun } from "@/lib/types";

type Providers = { default: string; providers: ProviderStatus[]; guardrails: { max_searches_per_step: number; max_research_cost_usd: number } };
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
          <div className="grid gap-4 lg:grid-cols-2">
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
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Customs & compliance to confirm" icon={<ClipboardCheck className="h-4 w-4" />} subtitle="Rules change - confirm each with a customs broker or the official source." />
          <CardBody><ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700">{c.customs_and_compliance.map((x) => <li key={x}>{x}</li>)}</ul></CardBody>
        </Card>
        <Card>
          <CardHeader title="Risks" />
          <CardBody>
            <ul className="space-y-2 text-[13px]">
              {c.risks.map((r) => (
                <li key={r.risk}><Badge tone={SEVERITY_TONE[r.severity] ?? "slate"}>{titleCase(r.severity)}</Badge> <span className="font-medium text-slate-800">{r.risk}</span>
                  <div className="text-slate-600">Mitigation: {r.mitigation}<FindingChips ids={r.finding_ids} findings={findings} onOpen={onOpen} /></div></li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Open questions" />
          <CardBody>
            <ul className="space-y-2 text-[13px]">{c.open_questions.map((q) => <li key={q.gap}><span className="font-medium text-slate-800">{q.gap}</span><div className="text-slate-600">{q.why_it_matters} <span className="text-slate-500">How to close: {q.how_to_close}</span></div></li>)}</ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Next steps" subtitle="Also added to your dashboard recommendations" />
          <CardBody>
            <ol className="list-decimal space-y-2 pl-5 text-[13px]">{c.next_steps.map((n) => <li key={n.action}><span className="font-medium text-slate-800">{n.action}</span> <Badge tone={SEVERITY_TONE[n.priority] ?? "slate"}>{titleCase(n.priority)}</Badge><div className="text-slate-600">{n.rationale}</div></li>)}</ol>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function PlanTab({ projectId, onDataChanged }: { projectId: string; onDataChanged: () => void }) {
  const prov = useApi<Providers>("/api/research/providers");
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const plan = useApi<ChannelPlan | null>(`/api/projects/${projectId}/channels/plan`);
  const latestRun = useMemo(() => runs.data?.find((r) => r.kind === "channels_logistics") ?? null, [runs.data]);
  const anyActive = runs.data?.some((r) => r.status === "queued" || r.status === "running") ?? false;
  const findingsRunId = plan.data?.content.research_run_id ?? latestRun?.id ?? null;
  const findings = useApi<Finding[]>(findingsRunId ? `/api/projects/${projectId}/findings?run_id=${findingsRunId}` : null);
  const byId = useMemo(() => Object.fromEntries((findings.data ?? []).map((f) => [f.id, f])), [findings.data]);
  const [focus, setFocus] = useState("");
  const [pages, setPages] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
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

  const provider = prov.data?.providers.find((p) => p.name === prov.data?.default);
  const g = prov.data?.guardrails;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await post<ResearchRun>(`/api/projects/${projectId}/research-runs`, { kind: "channels_logistics", focus: focus.trim() || undefined, source_urls: parseUrls(pages) });
      setConfirm(false);
      setFocus("");
      setPages("");
      runs.reload();
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else if (e instanceof ApiError && e.status === 409) setError("Another research run is in progress for this project. Wait for it to finish or cancel it.");
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const finished = useCallback(() => {
    runs.reload();
    plan.reload();
    findings.reload();
    onDataChanged();
  }, [runs, plan, findings, onDataChanged]);

  const evidence = (findings.data ?? []).filter((f) => ["channels", "logistics", "regulatory", "sourcing_costs", "pricing", "other"].includes(f.section));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Research selling channels & shipping" icon={<Play className="h-4 w-4" />}
          subtitle="Finds current seller fee schedules and freight/fulfillment benchmarks with sources, stores them as channel profiles and shipping options, then writes a launch plan." />
        <CardBody className="space-y-3">
          {provider && !provider.configured && <ConfigNotice message={`${provider.label} is not configured. ${provider.requirement ?? ""}`} />}
          {configMsg && <ConfigNotice message={configMsg} />}
          <Field label="Focus (optional)" hint="e.g. 'compare Etsy vs own store for practice wear', 'small first order of 100 units'">
            <Textarea rows={2} value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Field>
          <Field label="Pages to read (optional)" hint="Paste up to 8 links - carriers, forwarders, fee pages. The agent opens each one and uses only what it says.">
            <Textarea rows={2} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="https://www.dhl.com/... (one per line)" />
          </Field>
          <ul className="space-y-1 text-xs text-slate-600">
            <li>• A fee or freight rate is stored only if the number appears in the retrieved source text; anything else is left blank and listed as a gap.</li>
            <li>• Fees you have marked as verified are never overwritten.</li>
          </ul>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex justify-end">
            <Button onClick={() => setConfirm(true)} disabled={anyActive || (provider ? !provider.configured : true)}>
              <Play className="h-4 w-4" /> Start research
            </Button>
          </div>
        </CardBody>
      </Card>

      {latestRun && <RunCard run={latestRun} onFinished={finished} onViewReport={() => {}} />}

      {plan.loading && !plan.data ? <Spinner /> : plan.data ? (
        <PlanView plan={plan.data} findings={byId} onOpen={setOpen} onRefresh={() => setRefreshConfirm(true)} />
      ) : (
        <Card>
          <EmptyState icon={<Compass className="h-5 w-5" />} title="No channel & shipping plan yet">
            Run the research above, or add channels and shipping quotes yourself on the other tabs - the calculators work without AI.
          </EmptyState>
        </Card>
      )}

      {evidence.length > 0 && (
        <Card>
          <CardHeader title="Evidence from the latest run" subtitle={`${evidence.length} findings with sources, evidence type and verification status`} />
          <CardBody className="grid gap-3 lg:grid-cols-2">{evidence.map((f) => <FindingCard key={f.id} finding={f} compact />)}</CardBody>
        </Card>
      )}

      <ConfirmModal open={refreshConfirm} title="Rewrite the plan with your current numbers?" confirmLabel="Rewrite plan" busy={busy}
        onConfirm={refreshPlan} onClose={() => setRefreshConfirm(false)}>
        <p>This re-runs only the plan step: one AI call (usually well under $1) using the findings already saved, your channels as they are
          now, and your latest saved cost scenario. No new web searches. The old plan stays in the history.</p>
      </ConfirmModal>
      <ConfirmModal open={confirm} title="Start channels & shipping research?" confirmLabel="Start research" busy={busy} onConfirm={start} onClose={() => setConfirm(false)}>
        <p>This runs 2 web-research steps and a plan synthesis using {provider?.label ?? "the configured provider"}.</p>
        {g && <p>Up to <strong>{g.max_searches_per_step}</strong> searches per step. The run stops starting new steps once estimated cost reaches <strong>${g.max_research_cost_usd.toFixed(2)}</strong>.</p>}
        <p className="text-xs text-slate-500">Costs are billed to your Anthropic account. Progress and actual estimated cost appear below while it runs.</p>
      </ConfirmModal>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Evidence">{open && <FindingCard finding={open} />}</Modal>
    </div>
  );
}
