"use client";

import { ImageIcon, ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AI_REC_META, DecisionBadge, DecisionModal, DECISION_META } from "@/components/decision";
import { ProductSnap } from "@/components/product-snap";
import { useProjects } from "@/components/providers";
import { Alert, Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { AGENTS } from "@/lib/agents";
import { api, del, errorText } from "@/lib/api";
import { ago, money, pct, titleCase } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";
import { prepareImage } from "@/lib/image";
import { productHref, type SectionId } from "@/lib/sections";
import type { Decision, PipelineItem } from "@/lib/types";

const FILTERS: { value: Decision | "all"; label: MsgKey }[] = [
  { value: "all", label: "All" },
  { value: "undecided", label: "Undecided" },
  { value: "go", label: "Go" },
  { value: "on_hold", label: "On hold" },
  { value: "no_go", label: "No-go" },
];

const CONFIDENCE: Record<string, MsgKey> = { high: "high confidence", medium: "medium confidence", low: "low confidence" };

export default function ProductsPage() {
  const { t, tx } = useT();
  const { data, error, loading, reload } = useApi<PipelineItem[]>("/api/pipeline");
  const { select, reload: reloadProjects } = useProjects();
  const router = useRouter();
  const [filter, setFilter] = useState<Decision | "all">("all");
  const [deciding, setDeciding] = useState<PipelineItem | null>(null);
  const running = (data ?? []).some((p) => p.latest_run && ["queued", "running"].includes(p.latest_run.status));
  usePolling(reload, 5000, running);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function remove(p: PipelineItem) {
    if (!window.confirm(t("Delete \"{name}\"?\n\nThis permanently removes its research, competitors, suppliers, scenarios and decisions. It cannot be undone.", { name: p.name }))) return;
    setDeleteError(null);
    try { await del(`/api/projects/${p.id}`); reload(); reloadProjects(); }
    catch (e) { setDeleteError(errorText(e)); }
  }
  // A picture for a product without one: stored as is - no AI, no research.
  const [uploading, setUploading] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  async function addPhoto(p: PipelineItem, file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setUploading(p.id);
    try {
      const form = new FormData();
      form.append("file", await prepareImage(file));
      await api(`/api/projects/${p.id}/cover-photo`, { method: "POST", form });
      reload();
    } catch (e) {
      setPhotoError(errorText(e));
    } finally {
      setUploading(null);
    }
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
      <PageHeader title={t("Products")}
        description={t("Every product or category you are evaluating. Open one to see its full report - research, competitors, sizing, suppliers, channels and economics in one place - and what to improve.")} />
      <div className="mb-6"><ProductSnap compact /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`rounded-md border px-3 py-1 text-xs font-bold uppercase tracking-wide ${filter === f.value ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300"}`}>
            {t(f.label)} <span className="ml-1 opacity-70">{counts[f.value] ?? 0}</span>
          </button>
        ))}
      </div>
      {error && <Alert tone="red">{errorText(error)}</Alert>}
      {deleteError && <Alert tone="red">{deleteError}</Alert>}
      {photoError && <Alert tone="red">{photoError}</Alert>}
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState icon={<ImageIcon className="h-5 w-5" />} title={filter === "all" ? t("No products yet") : t("No {label} products", { label: tx(DECISION_META[filter as Decision]?.label ?? "") })}>
          {t("Snap a product photo above, or create a project for a category in Business Projects.")}
        </EmptyState></Card>
      ) : (
        <div className="grid gap-4">
          {rows.map((p) => {
            const rec = p.ai_recommendation ? AI_REC_META[p.ai_recommendation] : null;
            const active = p.latest_run && ["queued", "running"].includes(p.latest_run.status);
            const agent = p.latest_run ? AGENTS.find((a) => a.kind === p.latest_run!.kind) : undefined;
            return (
              <Card key={p.id} className="flex flex-col">
                <div className="flex gap-3 p-4">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <label title={t("Add a photo")}
                      className="group flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-brand-200 bg-brand-50 text-brand-400 hover:border-primary-400 hover:text-primary-600">
                      {uploading === p.id ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
                      <span className="px-1 text-center text-[10px] font-medium leading-tight">{uploading === p.id ? t("Uploading...") : t("Add a photo")}</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" disabled={uploading === p.id}
                        onChange={(e) => { addPhoto(p, e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  )}
                  <div className="min-w-0 flex-1">
                    <button onClick={() => open(p)} className="block break-words text-left font-serif text-lg font-semibold text-primary-700 hover:underline">{p.name}</button>
                    <p className="break-words text-xs text-slate-500">{p.category} · {p.target_country}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <DecisionBadge decision={p.decision} />
                      {rec ? (
                        <Badge tone={rec.tone} title={p.ai_headline ?? undefined}><Sparkles className="h-3 w-3" aria-hidden /> {t("AI: {label}", { label: tx(rec.label) })}
                          {p.ai_confidence_score != null ? ` · ${p.ai_confidence_score}/100` : p.ai_confidence ? ` · ${CONFIDENCE[p.ai_confidence] ? t(CONFIDENCE[p.ai_confidence]) : `${p.ai_confidence} confidence`}` : ""}</Badge>
                      ) : (
                        <button onClick={() => open(p, "decision")} className="rounded-md border border-dashed border-line px-2 py-0.5 text-[11px] text-slate-500 hover:border-primary-300 hover:text-primary-700">
                          {t("AI: not assessed yet")}
                        </button>
                      )}
                      {p.attractiveness && <Badge tone="slate">{t("Market: {value}", { value: titleCase(p.attractiveness) })}</Badge>}
                    </div>
                  </div>
                </div>
                <CardBody className="mt-auto space-y-2 border-t border-line pt-3 text-xs text-slate-600">
                  {active ? (
                    <div className="flex items-center gap-1.5 text-brand-700"><Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {p.latest_run?.current_step ? t("Researching: {step}", { step: titleCase(p.latest_run.current_step) }) : t("Researching...")}</div>
                  ) : p.latest_run ? (
                    <div>{t("Last research: {agent} · {status}", { agent: agent ? t(agent.name) : titleCase(p.latest_run.kind), status: titleCase(p.latest_run.status) })}</div>
                  ) : <div>{t("No research yet")}</div>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>{t("{n} findings", { n: p.counts.findings })}</span><span>{t("{n} competitors", { n: p.counts.competitors })}</span><span>{t("{n} suppliers", { n: p.counts.suppliers })}</span>
                    {p.contribution_margin !== null && (
                      <span title={p.scenario_type === "actual" ? t("From actuals") : t("Includes assumptions")}>
                        {t("{amount}/unit ({pct})", { amount: money(p.contribution_margin), pct: pct(p.contribution_margin_pct) })}{p.scenario_type !== "actual" ? "*" : ""}
                      </span>
                    )}
                  </div>
                  {p.decision_note && <p className="text-slate-700">&ldquo;{p.decision_note}&rdquo; <span className="text-slate-400">{ago(p.decided_at)}</span></p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => setDeciding(p)}>{t("Decide")}</Button>
                    <Button size="sm" variant="secondary" onClick={() => open(p, "market")}>{t("Research")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => open(p, "actions")} title={t("Risks, next steps and what is still left to do for this product")}>{t("To-dos")}</Button>
                    <Button size="sm" variant="ghost" className="ml-auto text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={() => remove(p)}
                      aria-label={t("Delete {name}", { name: p.name })}><Trash2 className="h-3.5 w-3.5" /> {t("Delete")}</Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-[11px] text-slate-500">{t("* Margin from the latest cost scenario; includes assumptions unless the scenario is marked actual.")}</p>
      {deciding && (
        <DecisionModal projectId={deciding.id} open={!!deciding} initial={deciding.decision} onClose={() => setDeciding(null)}
          onSaved={() => { reload(); reloadProjects(); }} />
      )}
    </>
  );
}
