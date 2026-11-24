"use client";

import clsx from "clsx";
import { ImageIcon, Palette, Sparkles, Star, Trash2, X as XIcon, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { ConceptContent } from "@/components/brand/renderers";
import { useStatus } from "@/components/providers";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfigNotice,
  EmptyState,
  Field,
  PageHeader,
  PlannedBadge,
  Spinner,
  Tabs,
  Textarea,
  type Tone,
} from "@/components/ui";
import { ApiError, del, errorText, patch, post } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { BrandConcept } from "@/lib/types";

const KINDS = [
  { value: "names", label: "Brand names", desc: "Brainstorm 12 name ideas with rationale and style." },
  { value: "positioning", label: "Positioning", desc: "Positioning statement, points of difference and reasons to believe." },
  { value: "personas", label: "Personas", desc: "3 illustrative customer personas grounded in your segments." },
  { value: "voice", label: "Brand voice", desc: "Voice traits with do/don't guidance and sample lines." },
  { value: "collections", label: "Collections", desc: "2-3 product collection concepts sized for a first run." },
  { value: "palettes", label: "Color palettes", desc: "3 five-color palettes with usage notes." },
  { value: "messaging", label: "Marketing messages", desc: "Taglines, value props, ad hooks and email subjects." },
] as const;

type Kind = (typeof KINDS)[number]["value"];

const STATUS_TONE: Record<BrandConcept["status"], Tone> = { draft: "slate", shortlisted: "blue", selected: "green", rejected: "red" };

export default function BrandPage() {
  return <RequireProject>{(pid) => <BrandStudio projectId={pid} />}</RequireProject>;
}

function BrandStudio({ projectId }: { projectId: string }) {
  const { status } = useStatus();
  const concepts = useApi<BrandConcept[]>(`/api/projects/${projectId}/brand-concepts`);
  const [kind, setKind] = useState<Kind>("names");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Kind>("all");

  const aiMissing = status && !status.ai.configured;

  async function generate() {
    setBusy(true);
    setError(null);
    setConfigError(null);
    try {
      const created = await post<BrandConcept>(`/api/projects/${projectId}/brand-concepts/generate`, { kind, brief: brief.trim() || null });
      concepts.setData((prev) => [created, ...(prev ?? [])]);
      setFilter(created.kind as Kind);
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigError(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const list = useMemo(() => {
    const all = [...(concepts.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return filter === "all" ? all : all.filter((c) => c.kind === filter);
  }, [concepts.data, filter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of concepts.data ?? []) m[c.kind] = (m[c.kind] ?? 0) + 1;
    return m;
  }, [concepts.data]);

  function onUpdated(updated: BrandConcept) {
    concepts.setData((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
  }
  function onDeleted(id: string) {
    concepts.setData((prev) => (prev ?? []).filter((c) => c.id !== id));
  }

  return (
    <div>
      <PageHeader
        title="Brand Studio"
        description="Generate brand drafts grounded in this project's research, segments and competitors. Everything here is an AI-generated draft for you to refine."
      />

      <div className="grid gap-6">
        <Card >
          <CardHeader title="Generate a draft" icon={<Sparkles className="h-4 w-4" />} subtitle="Uses your project context and saved research findings." />
          <CardBody className="space-y-4">
            {aiMissing && <ConfigNotice message={status?.ai.requirement} />}
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-slate-700">What to generate</legend>
              <div className="space-y-1.5">
                {KINDS.map((k) => (
                  <div key={k.value}
                    className={clsx("rounded-lg border transition-colors", kind === k.value ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                    <label className="flex cursor-pointer gap-2.5 px-3 py-2">
                      {/* Picking a type also shows its saved drafts on the right; the brief and Generate open right here. */}
                      <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => { setKind(k.value); setFilter(k.value); }}
                        className="mt-1 accent-brand-600" />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{k.label}{counts[k.value] ? <span className="ml-1 text-xs font-normal text-slate-500">({counts[k.value]} saved)</span> : null}</span>
                        <span className="block text-xs text-slate-500">{k.desc}</span>
                      </span>
                    </label>
                    {kind === k.value && (
                      <div className="space-y-2 border-t border-brand-200 px-3 py-2.5">
                        <Field label="Brief (optional)" hint="Tone, constraints, words you like or dislike, segments to focus on.">
                          <Textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} placeholder="e.g. elegant but approachable, aimed at adult beginners" />
                        </Field>
                        {configError && <ConfigNotice message={configError} />}
                        {error && <Alert tone="red">{error}</Alert>}
                        <Button onClick={generate} loading={busy} disabled={!!aiMissing} className="w-full">
                          <Sparkles className="h-4 w-4" /> Generate {k.label.toLowerCase()}
                        </Button>
                        {busy && <p className="text-center text-xs text-slate-500">This usually takes 15-60 seconds.</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Saved concepts" icon={<Palette className="h-4 w-4" />} subtitle="Shortlist, select or reject drafts. Newest first." />
            <CardBody>
              <Tabs
                value={filter}
                onChange={(f) => { setFilter(f); if (f !== "all") setKind(f); }}
                tabs={[
                  { value: "all", label: `All (${concepts.data?.length ?? 0})` },
                  ...KINDS.map((k) => ({ value: k.value, label: `${k.label}${counts[k.value] ? ` (${counts[k.value]})` : ""}` })),
                ]}
              />
              {concepts.loading && !concepts.data ? (
                <Spinner />
              ) : concepts.error ? (
                <Alert tone="red">{errorText(concepts.error)}</Alert>
              ) : list.length === 0 ? (
                <EmptyState icon={<Palette className="h-5 w-5" />}
                  title={filter === "all" ? "No brand concepts yet" : `No ${KINDS.find((k) => k.value === filter)?.label.toLowerCase()} yet`}>
                  {filter === "all" ? "Pick a draft type on the left and press Generate. Drafts are saved here automatically."
                    : "Press Generate under this type on the left - the draft appears here, saved automatically."}
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {list.map((c) => (
                    <ConceptCard key={c.id} concept={c} onUpdated={onUpdated} onDeleted={onDeleted} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Logo & mockup generation <PlannedBadge />
                </span>
              }
              icon={<ImageIcon className="h-4 w-4" />}
            />
            <CardBody>
              <p className="text-sm text-slate-600">
                Image generation for logos, product mockups and mood boards is designed behind an <code className="rounded bg-slate-100 px-1 text-xs">ImageGenerator</code> interface
                and will plug into an image or design API in a later release. Until then, use your selected palettes and positioning as a brief for a designer.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConceptCard({ concept, onUpdated, onDeleted }: { concept: BrandConcept; onUpdated: (c: BrandConcept) => void; onDeleted: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kindLabel = KINDS.find((k) => k.value === concept.kind)?.label ?? concept.kind;

  async function setStatus(status: BrandConcept["status"]) {
    setBusy(status);
    setError(null);
    try {
      onUpdated(await patch<BrandConcept>(`/api/brand-concepts/${concept.id}`, { status: concept.status === status ? "draft" : status }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${concept.title}"? This cannot be undone.`)) return;
    setBusy("delete");
    setError(null);
    try {
      await del(`/api/brand-concepts/${concept.id}`);
      onDeleted(concept.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  return (
    <div className={clsx("rounded-xl border bg-white", concept.status === "selected" ? "border-primary-600" : concept.status === "rejected" ? "border-slate-200 opacity-70" : "border-slate-200")}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold text-slate-900">{concept.title}</h3>
            <Badge tone={STATUS_TONE[concept.status]}>{concept.status}</Badge>
            <Badge tone="violet" title="Generated by the Brand Strategy Agent. Review before use.">
              <Sparkles className="h-3 w-3" /> AI-generated draft
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {kindLabel} · {date(concept.created_at)}
            {concept.brief ? ` · Brief: ${concept.brief}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant={concept.status === "shortlisted" ? "primary" : "secondary"} loading={busy === "shortlisted"} onClick={() => setStatus("shortlisted")} title="Toggle shortlist">
            <Star className="h-3.5 w-3.5" /> Shortlist
          </Button>
          <Button size="sm" variant={concept.status === "selected" ? "primary" : "secondary"} loading={busy === "selected"} onClick={() => setStatus("selected")} title="Toggle selected">
            <CheckCircle2 className="h-3.5 w-3.5" /> Select
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "rejected"} onClick={() => setStatus("rejected")} title="Toggle rejected">
            <XIcon className="h-3.5 w-3.5" /> {concept.status === "rejected" ? "Restore" : "Reject"}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "delete"} onClick={remove} aria-label="Delete concept">
            <Trash2 className="h-3.5 w-3.5 text-red-600" />
          </Button>
        </div>
      </div>
      <div className="px-4 py-3">
        {error && <Alert tone="red" className="mb-3">{error}</Alert>}
        <ConceptContent kind={concept.kind} content={concept.content} />
      </div>
    </div>
  );
}
