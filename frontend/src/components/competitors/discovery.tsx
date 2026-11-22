"use client";

import { CheckCircle2, Circle, CircleSlash, Loader2, Radar, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorText, post } from "@/lib/api";
import { useApi, usePolling } from "@/lib/hooks";
import type { ProviderStatus, ResearchRun, RunStep } from "@/lib/types";
import { dateTime, money, titleCase } from "@/lib/format";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, Field, Input, Modal, type Tone } from "@/components/ui";

type ProvidersResp = {
  default: string;
  providers: ProviderStatus[];
  guardrails: { max_searches_per_step: number; max_research_cost_usd: number; max_step_attempts: number };
};

const ACTIVE = new Set(["queued", "running"]);

export const RUN_STATUS_TONE: Record<string, Tone> = {
  queued: "slate",
  running: "blue",
  completed: "green",
  completed_with_errors: "amber",
  failed: "red",
  interrupted: "amber",
  cancelled: "slate",
};

function StepIcon({ status }: { status: RunStep["status"] }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" aria-hidden />;
  if (status === "skipped") return <CircleSlash className="h-4 w-4 text-slate-400" aria-hidden />;
  return <Circle className="h-4 w-4 text-slate-300" aria-hidden />;
}

/** Start and track an AI competitor-discovery research run. */
export function DiscoverPanel({ projectId, onFinished }: { projectId: string; onFinished: () => void }) {
  const providers = useApi<ProvidersResp>("/api/research/providers");
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const [runId, setRunId] = useState<string | null>(null);
  const run = useApi<ResearchRun>(runId ? `/api/research-runs/${runId}` : null);
  const [focus, setFocus] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const prevStatus = useRef<string | null>(null);

  // Pick up the latest competitor-discovery run (including one already in progress).
  useEffect(() => {
    if (runId || !runs.data) return;
    const latest = runs.data.find((r) => r.kind === "competitor_discovery");
    if (latest) setRunId(latest.id);
  }, [runs.data, runId]);

  const current = run.data;
  const active = !!current && ACTIVE.has(current.status);
  usePolling(() => run.reload(), 3000, active);

  useEffect(() => {
    if (!current) return;
    if (prevStatus.current && ACTIVE.has(prevStatus.current) && !ACTIVE.has(current.status)) onFinished();
    prevStatus.current = current.status;
  }, [current, onFinished]);

  const provider = useMemo(() => providers.data?.providers.find((p) => p.name === providers.data?.default), [providers.data]);
  const anyActiveRun = runs.data?.some((r) => ACTIVE.has(r.status) && r.id !== runId);

  async function start() {
    setBusy(true);
    setError(null);
    setConfigMsg(null);
    try {
      const r = await post<ResearchRun>(`/api/projects/${projectId}/research-runs`, { kind: "competitor_discovery", focus: focus.trim() || null });
      prevStatus.current = r.status;
      setRunId(r.id);
      run.setData(r);
      setConfirmOpen(false);
      runs.reload();
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else setError(errorText(e));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function control(action: "cancel" | "resume") {
    if (!current) return;
    setError(null);
    try {
      const r = await post<ResearchRun>(`/api/research-runs/${current.id}/${action}`);
      prevStatus.current = r.status;
      run.setData(r);
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else setError(errorText(e));
    }
  }

  const g = providers.data?.guardrails;

  return (
    <Card>
      <CardHeader
        title="Discover competitors with AI research"
        subtitle="Searches the web for brands selling your category, records each competitor with source links, and keeps only prices visible in retrieved sources."
        icon={<Radar className="h-4 w-4" />}
      />
      <CardBody className="space-y-3">
        {provider && !provider.configured && <ConfigNotice message={`${provider.label} is not configured. ${provider.requirement ?? ""}`} />}
        {configMsg && <ConfigNotice message={configMsg} />}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Focus (optional)" className="flex-1">
            <Input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. practice wear brands selling on their own websites"
              maxLength={1000}
              disabled={active}
            />
          </Field>
          <Button onClick={() => setConfirmOpen(true)} disabled={active || anyActiveRun || (provider ? !provider.configured : true)}>
            <Radar className="h-4 w-4" aria-hidden />
            Discover competitors
          </Button>
        </div>
        {anyActiveRun && !active && <p className="text-xs text-slate-500">Another research run is in progress for this project. Wait for it to finish.</p>}
        {error && <Alert tone="red">{error}</Alert>}

        {current && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-medium text-slate-800">Latest discovery run</span>
              <Badge tone={RUN_STATUS_TONE[current.status] ?? "slate"}>{titleCase(current.status)}</Badge>
              <span>started {dateTime(current.started_at ?? current.created_at)}</span>
              <span>· {current.search_requests} searches</span>
              <span>· est. cost {money(current.cost_usd, { decimals: 2 })}</span>
              <span className="ml-auto flex gap-2">
                {active && (
                  <Button size="sm" variant="secondary" onClick={() => control("cancel")}>
                    Cancel
                  </Button>
                )}
                {["interrupted", "failed", "completed_with_errors", "cancelled"].includes(current.status) && (
                  <Button size="sm" variant="secondary" onClick={() => control("resume")}>
                    Resume
                  </Button>
                )}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {current.steps.map((s) => (
                <li key={s.key} className="flex items-start gap-2 text-sm">
                  <StepIcon status={s.status} />
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">{s.label}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {titleCase(s.status)}
                      {s.attempts > 1 ? ` · attempt ${s.attempts}` : ""}
                      {s.status === "completed" ? ` · ${s.sources_count} sources · ${s.findings_count} findings` : ""}
                    </span>
                    {s.error && <div className="text-xs text-red-700">{s.error}</div>}
                  </div>
                </li>
              ))}
            </ul>
            {current.error && <p className="mt-2 text-xs text-red-700">{current.error}</p>}
            {!active && current.status !== "failed" && (
              <p className="mt-2 text-xs text-slate-600">
                Findings from this run (with sources and evidence labels) are in{" "}
                <Link href="/market" className="font-medium text-brand-700 hover:underline">
                  Market Opportunity
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </CardBody>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Start competitor discovery?">
        <div className="space-y-3 text-sm text-slate-700">
          <p>This runs a bounded AI research step that uses paid API calls on your account.</p>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]">
            <li>
              Provider: <span className="font-medium">{provider?.label ?? providers.data?.default ?? "-"}</span>
            </li>
            <li>
              Web searches: up to <span className="font-medium">{g?.max_searches_per_step ?? "-"}</span>
            </li>
            <li>
              Run cost cap: <span className="font-medium">{g ? money(g.max_research_cost_usd, { decimals: 2 }) : "-"}</span> (estimated; your invoice is authoritative)
            </li>
            <li>Retries: up to {g?.max_step_attempts ?? "-"} attempts on transient errors</li>
          </ul>
          <p className="text-xs text-slate-500">Competitors are added to your list. Prices are stored only when they appear in a retrieved source, and every record links to where it came from.</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={start} loading={busy}>
              Start research
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
