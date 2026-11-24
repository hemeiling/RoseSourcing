"use client";

import clsx from "clsx";
import { ImageIcon, Sparkles, Star, Trash2, X as XIcon, CheckCircle2 } from "lucide-react";
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
  PageHeader,
  PlannedBadge,
  Input,
  Select,
  Spinner,
  type Tone,
} from "@/components/ui";
import { ApiError, del, errorText, patch, post } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";
import type { BrandConcept } from "@/lib/types";

const KINDS = [
  { value: "names", label: "Brand names", desc: "Brainstorm 12 name ideas with rationale and style." },
  { value: "positioning", label: "Positioning", desc: "Positioning statement, points of difference and reasons to believe." },
  { value: "personas", label: "Personas", desc: "3 illustrative customer personas grounded in your segments." },
  { value: "voice", label: "Brand voice", desc: "Voice traits with do/don't guidance and sample lines." },
  { value: "collections", label: "Collections", desc: "2-3 product collection concepts sized for a first run." },
  { value: "palettes", label: "Color palettes", desc: "3 five-color palettes with usage notes." },
  { value: "messaging", label: "Marketing messages", desc: "Taglines, value props, ad hooks and email subjects." },
  { value: "social_posts", label: "Social posts", desc: "5 Instagram, TikTok and Pinterest posts in your buyers' own words, with what to confirm before posting.", content: true },
  { value: "video_script", label: "Video script", desc: "A 20-30 second vertical video: hook, scenes, voice-over and a presenter/avatar script.", content: true },
  { value: "image_briefs", label: "Image briefs", desc: "4 image prompts (hero, lifestyle, flat lay, social) for an image tool or photographer.", content: true },
] as const;

type Kind = (typeof KINDS)[number]["value"];

const STATUS_TONE: Record<BrandConcept["status"], Tone> = { draft: "slate", shortlisted: "blue", selected: "green", rejected: "red" };

export default function BrandPage() {
  return <RequireProject>{(pid) => <BrandStudio projectId={pid} />}</RequireProject>;
}

function BrandStudio({ projectId }: { projectId: string }) {
  const { status } = useStatus();
  const { t, tx, lang } = useT();
  const concepts = useApi<BrandConcept[]>(`/api/projects/${projectId}/brand-concepts`);
  const [kind, setKind] = useState<Kind>("names");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Kind>("all");

  const aiMissing = status && !status.ai.configured;
  // A draft type inside a sentence: lower case in English ("Generate brand names"), as is in Chinese.
  const kindWord = (label: MsgKey | undefined) => (!label ? "" : lang === "zh" ? t(label) : label.toLowerCase());
  const kindLabel = KINDS.find((k) => k.value === kind)?.label;
  const filterLabel = KINDS.find((k) => k.value === filter)?.label;
  const kindDesc = KINDS.find((k) => k.value === kind)?.desc;

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
        title={t("Brand Studio")}
        description={t("Generate brand drafts grounded in this project's research, segments and competitors. Everything here is an AI-generated draft for you to refine.")}
      />

      {/* One card: pick the draft type (the same dropdown filters the saved drafts), add a brief, generate. */}
      <Card>
        <CardHeader title={t("Brand & content studio")} icon={<Sparkles className="h-4 w-4" />}
          subtitle={t("Pick a brand draft or launch content, add an optional brief and generate - saved below, newest first. Uses this product's research (no new searches).")} />
        <div className="space-y-1.5 border-b border-line px-5 py-3">
          {aiMissing && <ConfigNotice message={status?.ai.requirement} />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-60 shrink-0">
              <Select aria-label={t("Draft type")} value={filter} className="h-8 py-0!"
                onChange={(e) => { const v = e.target.value as "all" | Kind; setFilter(v); if (v !== "all") setKind(v); }}>
                <option value="all">{t("All drafts ({n})", { n: concepts.data?.length ?? 0 })}</option>
                <optgroup label={t("Brand")}>
                  {KINDS.filter((k) => !("content" in k)).map((k) => <option key={k.value} value={k.value}>{counts[k.value] ? t("{kind} ({n} saved)", { kind: t(k.label), n: counts[k.value] }) : t(k.label)}</option>)}
                </optgroup>
                <optgroup label={t("Content (from your buyer research)")}>
                  {KINDS.filter((k) => "content" in k).map((k) => <option key={k.value} value={k.value}>{counts[k.value] ? t("{kind} ({n} saved)", { kind: t(k.label), n: counts[k.value] }) : t(k.label)}</option>)}
                </optgroup>
              </Select>
            </div>
            <Input aria-label={t("Brief (optional)")} className="h-8 min-w-[12rem] flex-1 py-0!" value={brief} maxLength={2000} onChange={(e) => setBrief(e.target.value)}
              placeholder={t("Brief (optional): tone, audience, words to use")} title={t("Tone, constraints, words you like or dislike, segments to focus on")} />
            <Button size="sm" onClick={generate} loading={busy} disabled={!!aiMissing || filter === "all"}
              title={filter === "all" ? t("Choose a draft type first") : undefined}>
              <Sparkles className="h-3.5 w-3.5" /> {filter === "all" ? t("Generate") : t("Generate {kind}", { kind: kindWord(kindLabel) })}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            {filter === "all" ? t("Choose a draft type to generate one; the list shows every saved draft.") : kindDesc && t(kindDesc)}
            {busy && t(" This usually takes 15-60 seconds.")}
          </p>
          {configError && <ConfigNotice message={configError} />}
          {error && <Alert tone="red">{error}</Alert>}
        </div>
        <CardBody>
          {concepts.loading && !concepts.data ? (
            <Spinner />
          ) : concepts.error ? (
            <Alert tone="red">{errorText(concepts.error)}</Alert>
          ) : list.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">
              {filter === "all" ? t("No drafts yet - choose a type above and press Generate.") : t("No {kind} yet - press Generate above.", { kind: kindWord(filterLabel) })}
            </p>
          ) : (
            <div className="space-y-4">
              {list.map((c) => (
                <ConceptCard key={c.id} concept={c} onUpdated={onUpdated} onDeleted={onDeleted} />
              ))}
            </div>
          )}
        </CardBody>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-xs text-slate-500">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {t("Logo & mockup images")} <PlannedBadge />
          <span>{t("will connect to an image tool with the Content Studio; until then use your selected palettes and positioning as a designer brief.")}</span>
        </div>
      </Card>
    </div>
  );
}

function ConceptCard({ concept, onUpdated, onDeleted }: { concept: BrandConcept; onUpdated: (c: BrandConcept) => void; onDeleted: (id: string) => void }) {
  const { t, tx, lang } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kindMeta = KINDS.find((k) => k.value === concept.kind);
  const kindLabel = kindMeta ? t(kindMeta.label) : concept.kind;

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
    if (!window.confirm(t('Delete "{name}"? This cannot be undone.', { name: concept.title }))) return;
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
            <h3 className="text-sm font-semibold text-slate-900">{tx(concept.title)}</h3>
            <Badge tone={STATUS_TONE[concept.status]}>{lang === "zh" ? titleCase(concept.status) : concept.status}</Badge>
            <Badge tone="violet" title={t("Generated by the Brand Strategy Agent. Review before use.")}>
              <Sparkles className="h-3 w-3" /> {t("AI-generated draft")}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {kindLabel} · {date(concept.created_at)}
            {concept.brief ? ` · ${t("Brief: {brief}", { brief: concept.brief })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant={concept.status === "shortlisted" ? "primary" : "secondary"} loading={busy === "shortlisted"} onClick={() => setStatus("shortlisted")} title={t("Toggle shortlist")}>
            <Star className="h-3.5 w-3.5" /> {t("Shortlist")}
          </Button>
          <Button size="sm" variant={concept.status === "selected" ? "primary" : "secondary"} loading={busy === "selected"} onClick={() => setStatus("selected")} title={t("Toggle selected")}>
            <CheckCircle2 className="h-3.5 w-3.5" /> {t("Select")}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "rejected"} onClick={() => setStatus("rejected")} title={t("Toggle rejected")}>
            <XIcon className="h-3.5 w-3.5" /> {concept.status === "rejected" ? t("Restore") : t("Reject")}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "delete"} onClick={remove} aria-label={t("Delete concept")}>
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
