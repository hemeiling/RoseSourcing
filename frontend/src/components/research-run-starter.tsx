"use client";

import { Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmModal, RunStatusBadge, fmtCost, isActive } from "@/components/market/shared";
import { useStatus } from "@/components/providers";
import { Alert, Button, ConfigNotice, Field, Textarea } from "@/components/ui";
import { ApiError, errorText, post } from "@/lib/api";
import { parseUrls } from "@/lib/agents";
import { useApi } from "@/lib/hooks";
import type { ResearchRun } from "@/lib/types";

/** Start one kind of research run for a product, with spend approval, and follow its progress. */
export function ResearchRunStarter({ projectId, kind, label, approval, focusPlaceholder, keywordsPlaceholder, onFinished }: {
  projectId: string;
  kind: ResearchRun["kind"];
  label: string;
  approval: string;
  focusPlaceholder?: string;
  /** Shows a "search phrases" field: what shoppers type, used for marketplace and Google Trends searches. */
  keywordsPlaceholder?: string;
  onFinished: () => void;
}) {
  const { status } = useStatus();
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const [focus, setFocus] = useState("");
  const [pages, setPages] = useState("");
  const [keywords, setKeywords] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = runs.data?.find((r) => r.kind === kind);
  const anyActive = runs.data?.some((r) => isActive(r.status));
  const wasActive = useRef(false);

  useEffect(() => {
    if (!anyActive) {
      if (wasActive.current) onFinished();
      wasActive.current = false;
      return;
    }
    wasActive.current = true;
    const t = setInterval(() => runs.reload(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyActive]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/projects/${projectId}/research-runs`, {
        kind, focus: focus.trim() || undefined, source_urls: parseUrls(pages),
        keywords: keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 3),
      });
      setPages("");
      runs.reload();
    } catch (e) {
      setError(e instanceof ApiError && e.isConfigError ? e.message : errorText(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      {status && !status.ai.configured && <ConfigNotice message={status.ai.requirement} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className={`grid flex-1 gap-3 ${keywordsPlaceholder ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {keywordsPlaceholder && (
            <Field label="Search phrases (optional)">
              <Textarea rows={1} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={keywordsPlaceholder} />
            </Field>
          )}
          <Field label="Focus (optional)">
            <Textarea rows={1} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={focusPlaceholder} />
          </Field>
          <Field label="Pages to read (optional)">
            <Textarea rows={1} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="Paste links, one per line (up to 8)" />
          </Field>
        </div>
        <Button onClick={() => setConfirm(true)} disabled={!!anyActive || (status ? !status.ai.configured : false)}
          title={anyActive ? "A research run is already in progress for this product" : undefined}>
          <Play className="h-4 w-4" /> {latest ? `Run again` : label}
        </Button>
      </div>
      {latest && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Latest run:</span>
          <RunStatusBadge status={latest.status} />
          {isActive(latest.status) && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" />}
          <span className="text-xs text-slate-500">{latest.steps.map((s) => `${s.label}: ${s.status}`).join(" · ")} · {fmtCost(latest.cost_usd)}</span>
        </div>
      )}
      {anyActive && !(latest && isActive(latest.status)) && <p className="text-xs text-slate-500">Another research run is in progress for this product. You can start this one when it finishes.</p>}
      {error && <Alert tone="red">{error}</Alert>}
      <ConfirmModal open={confirm} title="Approve research spend" confirmLabel="Start research" busy={busy} onClose={() => setConfirm(false)} onConfirm={start}>
        <p>{approval}</p>
        <p>Each step makes up to 5 web searches, and the run stops starting new steps once its estimated AI cost reaches the per-run limit in Settings.</p>
      </ConfirmModal>
    </div>
  );
}
