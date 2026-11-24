"use client";

import clsx from "clsx";
import { CheckCircle2, Copy, CopyPlus, ExternalLink as ExtIcon, FileSearch, Pencil, Ruler, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { FindingCard } from "@/components/evidence";
import { ConfirmModal } from "@/components/market/shared";
import { ChartEditor } from "@/components/sizing/chart-editor";
import { SizeTable, UnitToggle } from "@/components/sizing/fit-finder";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ExternalLink, PageHeader, Spinner } from "@/components/ui";
import { del, errorText, post } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { GARMENT_LABEL, type Unit } from "@/lib/sizing";
import type { Finding, SizeChart } from "@/lib/types";

const ROLE_META: Record<SizeChart["role"], { title: string; badge: string; blurb: string }> = {
  published: { title: "Your size guides", badge: "Your size guide", blurb: "What customers see. Share one as a public fit finder link." },
  supplier: { title: "Supplier charts", badge: "Supplier chart", blurb: "Factory size charts - compare them with your size guide before ordering." },
  reference: { title: "Competitor & reference charts", badge: "Reference", blurb: "Found by fit research or added by you, with their source." },
};

function VerificationBadge({ c }: { c: SizeChart }) {
  if (c.verification_status === "human_verified") return <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Verified by you</Badge>;
  if (c.verification_status === "source_linked")
    return <Badge tone="teal" title="Every number appeared in the retrieved source page. Not checked by you.">Source-linked</Badge>;
  return <Badge tone="slate" title={c.source_type === "photo_extracted" ? "Read from your image by AI - check against the original." : "Not checked yet."}>Unverified</Badge>;
}

// ----------------------------------------------------------------------------- fit research

/** What the Size & Fit Checker found (run it from the agents list at the top of the report). */
function FitResearch({ projectId }: { projectId: string }) {
  const findings = useApi<Finding[]>(`/api/projects/${projectId}/findings?section=fit`);
  return (
    <Card>
      <CardHeader title="Fit & sizing research" icon={<FileSearch className="h-4 w-4" />}
        subtitle="Competitors' published size charts and what customers say about fit, returns and exchanges. Size charts are saved only with numbers that appear on the source page." />
      <CardBody>
        {!findings.data ? <Spinner /> : findings.data.length === 0 ? (
          <p className="text-sm text-slate-500">No fit research yet. Run the Size &amp; Fit Checker from the{" "}
            <a href="#review" className="font-semibold text-primary-700 underline">agents list at the top</a>.</p>
        ) : (
          <details open className="space-y-2">
            <summary className="cursor-pointer text-sm font-semibold text-brand-700">Fit & sizing findings ({findings.data.length})</summary>
            <div className="mt-2 grid gap-2">{findings.data.map((f) => <FindingCard key={f.id} finding={f} compact />)}</div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- chart card

function ChartCard({ c, unit, onEdit, onChanged }: { c: SizeChart; unit: Unit; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const publicUrl = c.public_path && typeof window !== "undefined" ? `${window.location.origin}${c.public_path}` : null;

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const total = c.fit_stats._total ?? 0;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-serif text-base font-semibold text-ink">{c.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Badge tone={c.role === "published" ? "violet" : c.role === "supplier" ? "blue" : "slate"}>{ROLE_META[c.role].badge}</Badge>
            <VerificationBadge c={c} />
            <span>{GARMENT_LABEL[c.garment_type]}</span>
            {c.stretch_allowance_cm > 0 && <span>· stretch allowance {c.stretch_allowance_cm} cm</span>}
            {c.retrieved_at && <span>· retrieved {date(c.retrieved_at)}</span>}
            {c.source_url && <ExternalLink href={c.source_url}>source</ExternalLink>}
            {c.has_source_image && <a className="font-semibold text-primary-600 hover:text-primary-800" href={`/api/size-charts/${c.id}/source-image`} target="_blank" rel="noreferrer">original image</a>}
          </div>
        </div>
        {c.published && <Badge tone="green"><Share2 className="h-3 w-3" /> Shared with customers</Badge>}
      </div>
      {c.rows.length ? <SizeTable chart={c} unit={unit} /> : <p className="text-sm text-slate-500">No sizes yet.</p>}
      {c.fit_notes && <p className="text-xs text-slate-600"><span className="font-semibold">Fit notes:</span> {c.fit_notes}</p>}
      {c.role === "published" && total > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-700">Sizes recommended to customers ({total} lookups)</p>
          {[...c.rows.map((r) => r.size), "_none"].filter((s) => c.fit_stats[s]).map((s) => (
            <div key={s} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-slate-600">{s === "_none" ? "No fit" : s}</span>
              <span className="h-2 rounded bg-brand-500" style={{ width: `${Math.max(4, (c.fit_stats[s] / total) * 100)}%` }} />
              <span className="tabular-nums text-slate-500">{c.fit_stats[s]}</span>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">Counts only - customers' measurements are not stored. Useful for deciding how many of each size to order.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
        {c.verification_status !== "human_verified" && (
          <Button size="sm" variant="secondary" loading={busy === "verify"} onClick={() => act("verify", () => post(`/api/size-charts/${c.id}/verify`))}>
            <CheckCircle2 className="h-3.5 w-3.5" /> I checked these numbers
          </Button>
        )}
        {c.role !== "published" && (
          <Button size="sm" variant="secondary" loading={busy === "dup"} onClick={() => act("dup", () => post(`/api/size-charts/${c.id}/duplicate`))}>
            <CopyPlus className="h-3.5 w-3.5" /> Start our size guide from this
          </Button>
        )}
        {c.role === "published" && (
          <Button size="sm" variant="secondary" loading={busy === "pub"}
            onClick={() => act("pub", () => post(`/api/size-charts/${c.id}/publish?published=${!c.published}`))}>
            <Share2 className="h-3.5 w-3.5" /> {c.published ? "Stop sharing" : "Share with customers"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
      </div>
      {publicUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-canvas px-3 py-2 text-xs">
          <span className="text-slate-600">Customer fit finder:</span>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="min-w-0 break-all font-semibold text-primary-600 hover:text-primary-800">{publicUrl} <ExtIcon className="inline h-3 w-3" /></a>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
      {error && <Alert tone="red">{error}</Alert>}
      <ConfirmModal open={confirmDelete} danger title="Delete size chart" confirmLabel="Delete" busy={busy === "del"} onClose={() => setConfirmDelete(false)}
        onConfirm={() => act("del", () => del(`/api/size-charts/${c.id}`)).then(() => setConfirmDelete(false))}>
        <p>Delete <strong>{c.name}</strong>? {c.published ? "Its customer link will stop working. " : ""}This cannot be undone.</p>
      </ConfirmModal>
    </div>
  );
}

// ----------------------------------------------------------------------------- page

function SizingView({ projectId }: { projectId: string }) {
  const charts = useApi<SizeChart[]>(`/api/projects/${projectId}/size-charts`);
  const [unit, setUnit] = useState<Unit>("cm");
  const [editing, setEditing] = useState<{ chart: SizeChart | null; garment?: SizeChart["garment_type"] } | null>(null);
  const list = charts.data ?? [];

  return (
    <>
      <PageHeader title="Sizing & Fit"
        description="What the Size & Fit Checker found: competitors' size charts and what customers say about fit, returns and exchanges." />
      <div className="grid gap-5">
        <FitResearch projectId={projectId} />

        <div className="space-y-5">
          {charts.loading && !charts.data && <Spinner />}
          {charts.error && <Alert tone="red">{errorText(charts.error)}</Alert>}
          {charts.data && list.length === 0 && (
            <EmptyState icon={<Ruler className="h-5 w-5" />} title="No size charts yet">
              Run the Size &amp; Fit Checker from the agents list at the top to collect competitors&apos; size charts.
            </EmptyState>
          )}
          {list.length > 0 && <div className="flex justify-end"><UnitToggle unit={unit} onChange={setUnit} /></div>}
          {(["published", "supplier", "reference"] as SizeChart["role"][]).map((role) => {
            const items = list.filter((c) => c.role === role);
            if (!items.length) return null;
            return (
              <section key={role} className="space-y-2">
                <h2 className="font-serif text-lg font-semibold text-brand-700">{ROLE_META[role].title}</h2>
                <p className={clsx("text-xs text-slate-500")}>{ROLE_META[role].blurb}</p>
                <div className="grid gap-3">
                  {items.map((c) => (
                    <ChartCard key={c.id} c={c} unit={unit} onChanged={charts.reload} onEdit={() => setEditing({ chart: c })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <ChartEditor open={!!editing} chart={editing?.chart ?? null} projectId={projectId} preset={editing?.garment ? { garment_type: editing.garment } : undefined}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); charts.reload(); }} />
    </>
  );
}

export default function SizingPage() {
  return <RequireProject>{(pid) => <SizingView key={pid} projectId={pid} />}</RequireProject>;
}
