"use client";

import { ImageIcon, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AI_REC_META, DecisionBadge, DecisionModal, DECISION_META } from "@/components/decision";
import { ProductSnap } from "@/components/product-snap";
import { useProjects } from "@/components/providers";
import { Alert, Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { del, errorText } from "@/lib/api";
import { ago, money, pct, titleCase } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import { productHref, type SectionId } from "@/lib/sections";
import type { Decision, PipelineItem } from "@/lib/types";

const FILTERS: { value: Decision | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "undecided", label: "Undecided" },
  { value: "go", label: "Go" },
  { value: "on_hold", label: "On hold" },
  { value: "no_go", label: "No-go" },
];

export default function ProductsPage() {
  const { data, error, loading, reload } = useApi<PipelineItem[]>("/api/pipeline");
  const { select, reload: reloadProjects } = useProjects();
  const router = useRouter();
  const [filter, setFilter] = useState<Decision | "all">("all");
  const [deciding, setDeciding] = useState<PipelineItem | null>(null);
  const running = (data ?? []).some((p) => p.latest_run && ["queued", "running"].includes(p.latest_run.status));
  usePolling(reload, 5000, running);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function remove(p: PipelineItem) {
    if (!window.confirm(`Delete "${p.name}"?\n\nThis permanently removes its research, competitors, suppliers, scenarios and decisions. It cannot be undone.`)) return;
    setDeleteError(null);
    try { await del(`/api/projects/${p.id}`); reload(); reloadProjects(); }
    catch (e) { setDeleteError(errorText(e)); }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const p of data ?? []) c[p.decision] = (c[p.decision] ?? 0) + 1;
    return c;
  }, [data]);
  const rows = (data ?? []).filter((p) => filter === "all" || p.decision === filter);

  function open(p: PipelineItem, section?: SectionId) {
    select(p.id);
    router.push(productHref(p.id, section));
  }

  return (
    <>
      <PageHeader title="Products"
        description="Every product or category you are evaluating. Open one to see its full report - research, competitors, sizing, suppliers, channels and economics in one place - and what to improve." />
      <div className="mb-6"><ProductSnap compact /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`rounded-md border px-3 py-1 text-xs font-bold uppercase tracking-wide ${filter === f.value ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300"}`}>
            {f.label} <span className="ml-1 opacity-70">{counts[f.value] ?? 0}</span>
          </button>
        ))}
      </div>
      {error && <Alert tone="red">{errorText(error)}</Alert>}
      {deleteError && <Alert tone="red">{deleteError}</Alert>}
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState icon={<ImageIcon className="h-5 w-5" />} title={filter === "all" ? "No products yet" : `No ${DECISION_META[filter as Decision]?.label ?? ""} products`}>
          Snap a product photo above, or create a project for a category in Business Projects.
        </EmptyState></Card>
      ) : (
        <div className="grid gap-4">
          {rows.map((p) => {
            const rec = p.ai_recommendation ? AI_REC_META[p.ai_recommendation] : null;
            const active = p.latest_run && ["queued", "running"].includes(p.latest_run.status);
            return (
              <Card key={p.id} className="flex flex-col">
                <div className="flex gap-3 p-4">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-400"><ImageIcon className="h-6 w-6" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <button onClick={() => open(p)} className="block break-words text-left font-serif text-lg font-semibold text-primary-700 hover:underline">{p.name}</button>
                    <p className="break-words text-xs text-slate-500">{p.category} · {p.target_country}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <DecisionBadge decision={p.decision} />
                      {rec ? (
                        <Badge tone={rec.tone} title={p.ai_headline ?? undefined}><Sparkles className="h-3 w-3" aria-hidden /> AI: {rec.label}
                          {p.ai_confidence_score != null ? ` · ${p.ai_confidence_score}/100` : p.ai_confidence ? ` · ${p.ai_confidence} confidence` : ""}</Badge>
                      ) : (
                        <button onClick={() => open(p, "decision")} className="rounded-md border border-dashed border-line px-2 py-0.5 text-[11px] text-slate-500 hover:border-primary-300 hover:text-primary-700">
                          AI: not assessed yet
                        </button>
                      )}
                      {p.attractiveness && <Badge tone="slate">Market: {titleCase(p.attractiveness)}</Badge>}
                    </div>
                  </div>
                </div>
                <CardBody className="mt-auto space-y-2 border-t border-line pt-3 text-xs text-slate-600">
                  {active ? (
                    <div className="flex items-center gap-1.5 text-brand-700"><Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Researching{p.latest_run?.current_step ? `: ${titleCase(p.latest_run.current_step)}` : "..."}</div>
                  ) : p.latest_run ? (
                    <div>Last research: {titleCase(p.latest_run.kind)} · {titleCase(p.latest_run.status)}</div>
                  ) : <div>No research yet</div>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>{p.counts.findings} findings</span><span>{p.counts.competitors} competitors</span><span>{p.counts.suppliers} suppliers</span>
                    {p.contribution_margin !== null && (
                      <span title={p.scenario_type === "actual" ? "From actuals" : "Includes assumptions"}>
                        {money(p.contribution_margin)}/unit ({pct(p.contribution_margin_pct)}){p.scenario_type !== "actual" ? "*" : ""}
                      </span>
                    )}
                  </div>
                  {p.decision_note && <p className="text-slate-700">&ldquo;{p.decision_note}&rdquo; <span className="text-slate-400">{ago(p.decided_at)}</span></p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => setDeciding(p)}>Decide</Button>
                    <Button size="sm" variant="secondary" onClick={() => open(p, "market")}>Research</Button>
                    <Button size="sm" variant="ghost" onClick={() => open(p, "actions")} title="Risks, next steps and what is still left to do for this product">To-dos</Button>
                    <Button size="sm" variant="ghost" className="ml-auto text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={() => remove(p)}
                      aria-label={`Delete ${p.name}`}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-[11px] text-slate-500">* Margin from the latest cost scenario; includes assumptions unless the scenario is marked actual.</p>
      {deciding && (
        <DecisionModal projectId={deciding.id} open={!!deciding} initial={deciding.decision} onClose={() => setDeciding(null)}
          onSaved={() => { reload(); reloadProjects(); }} />
      )}
    </>
  );
}
