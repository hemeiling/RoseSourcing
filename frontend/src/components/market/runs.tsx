"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, History, Loader2, MinusCircle, RotateCcw, Square, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, ConfigNotice, EmptyState, Spinner } from "@/components/ui";
import { ApiError, errorText, get, post } from "@/lib/api";
import { dateTime, num, titleCase } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import type { ResearchRun, RunStep } from "@/lib/types";
import { KIND_LABEL, RESUMABLE_STATUSES, RunStatusBadge, fmtCost, isActive } from "./shared";

function StepIcon({ status }: { status: RunStep["status"] }) {
  const cls = "h-4 w-4 shrink-0";
  if (status === "completed") return <CheckCircle2 className={clsx(cls, "text-emerald-600")} aria-label="Completed" />;
  if (status === "running") return <Loader2 className={clsx(cls, "animate-spin text-brand-600")} aria-label="Running" />;
  if (status === "failed") return <XCircle className={clsx(cls, "text-red-600")} aria-label="Failed" />;
  if (status === "skipped") return <MinusCircle className={clsx(cls, "text-amber-600")} aria-label="Skipped" />;
  return <Circle className={clsx(cls, "text-slate-300")} aria-label="Pending" />;
}

function duration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RunCard({
  run: initial,
  reportId,
  onFinished,
  onViewReport,
}: {
  run: ResearchRun;
  reportId?: string;
  onFinished: () => void;
  onViewReport: (id: string) => void;
}) {
  const [run, setRun] = useState(initial);
  const [busy, setBusy] = useState<"cancel" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(isActive(initial.status));
  const lastStatus = useRef(initial.status);

  useEffect(() => {
    setRun(initial);
  }, [initial]);

  useEffect(() => {
    if (isActive(lastStatus.current) && !isActive(run.status)) onFinished();
    if (isActive(run.status)) setExpanded(true);
    lastStatus.current = run.status;
  }, [run.status, onFinished]);

  usePolling(
    async () => {
      try {
        setRun(await get<ResearchRun>(`/api/research-runs/${run.id}`));
      } catch {
        /* transient polling failure; next tick retries */
      }
    },
    3000,
    isActive(run.status),
  );

  async function act(kind: "cancel" | "resume") {
    setBusy(kind);
    setError(null);
    setConfigMsg(null);
    try {
      setRun(await post<ResearchRun>(`/api/research-runs/${run.id}/${kind}`));
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const params = run.params as { category?: string; geography?: string; focus?: string; budget_usd?: number };
  const done = run.steps.filter((s) => s.status === "completed").length;
  const dur = duration(run.started_at, run.completed_at);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            <Badge tone="slate">{KIND_LABEL[run.kind] ?? titleCase(run.kind)}</Badge>
            <span className="text-xs text-slate-500">{dateTime(run.created_at)}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-900">
            {params.category ?? "Project category"} · {params.geography ?? "Project market"}
            {params.budget_usd !== undefined ? ` · $${num(params.budget_usd)}` : ""}
          </p>
          {params.focus && <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">Focus: {params.focus}</p>}
          <p className="mt-1 text-[11px] text-slate-500">
            {done}/{run.steps.length} steps · {num(run.search_requests)} searches · {num(run.input_tokens + run.output_tokens)} tokens · est.{" "}
            {fmtCost(run.cost_usd)}
            {dur ? ` · ${dur}` : ""} · {run.provider} · {run.model}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reportId && (
            <Button size="sm" onClick={() => onViewReport(reportId)}>
              View report
            </Button>
          )}
          {isActive(run.status) && (
            <Button size="sm" variant="danger" loading={busy === "cancel"} onClick={() => act("cancel")}>
              <Square className="h-3.5 w-3.5" aria-hidden />
              Cancel
            </Button>
          )}
          {RESUMABLE_STATUSES.includes(run.status) && (
            <Button size="sm" variant="secondary" loading={busy === "resume"} onClick={() => act("resume")} title="Re-runs only the steps that did not complete">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Resume
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Hide steps" : "Show steps"}
          </Button>
        </div>
      </div>

      {run.error && (
        <div className="px-4 pb-3">
          <Alert tone={run.status === "failed" ? "red" : "amber"}>{run.error}</Alert>
        </div>
      )}
      {(error || configMsg) && (
        <div className="space-y-2 px-4 pb-3">
          {error && <Alert tone="red">{error}</Alert>}
          {configMsg && <ConfigNotice message={configMsg} />}
        </div>
      )}

      {expanded && (
        <ol className="divide-y divide-slate-100 border-t border-slate-100">
          {run.steps.map((s) => (
            <li key={s.key} className="flex gap-3 px-4 py-2.5">
              <StepIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className={clsx("font-medium", s.status === "pending" ? "text-slate-500" : "text-slate-800")}>{s.label}</span>
                  {s.attempts > 1 && <span className="text-[11px] text-amber-700">attempt {s.attempts}</span>}
                  {s.status === "completed" && s.key !== "synthesis" && (
                    <span className="text-[11px] text-slate-500">
                      {s.findings_count} findings · {s.sources_count} sources
                    </span>
                  )}
                  {(s.status === "completed" || s.status === "failed") && duration(s.started_at, s.finished_at) && (
                    <span className="text-[11px] text-slate-400">{duration(s.started_at, s.finished_at)}</span>
                  )}
                </div>
                {s.error && <p className="mt-0.5 text-xs text-red-700">{s.error}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function RunsList({
  runs,
  loading,
  error,
  reportByRun,
  onFinished,
  onViewReport,
}: {
  runs: ResearchRun[] | undefined;
  loading: boolean;
  error: Error | null;
  reportByRun: Record<string, string>;
  onFinished: () => void;
  onViewReport: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader icon={<History className="h-4 w-4" />} title="Research runs" subtitle="Progress updates every few seconds while a run is active." />
      <div className="space-y-3 p-4">
        {loading && !runs && <Spinner />}
        {error && <Alert tone="red">Could not load runs: {errorText(error)}</Alert>}
        {runs && runs.length === 0 && (
          <EmptyState icon={<History className="h-5 w-5" />} title="No research runs yet">
            Start your first run above. Each run records its steps, sources, token usage and estimated cost.
          </EmptyState>
        )}
        {runs?.map((r) => (
          <RunCard key={r.id} run={r} reportId={reportByRun[r.id]} onFinished={onFinished} onViewReport={onViewReport} />
        ))}
      </div>
    </Card>
  );
}
