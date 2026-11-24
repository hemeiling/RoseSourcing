"use client";

import { CheckCircle2, CircleSlash, Gavel, PauseCircle, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, Field, Modal, Spinner, Textarea, type Tone } from "./ui";
import { ApiError, errorText, post } from "@/lib/api";
import { date, dateTime, money, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Decision, DecisionBriefContent, DecisionHistoryItem, DecisionOffer } from "@/lib/types";

export const DECISION_META: Record<Decision, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  go: { label: "Go", tone: "green", icon: CheckCircle2 },
  no_go: { label: "No-go", tone: "red", icon: XCircle },
  on_hold: { label: "On hold", tone: "amber", icon: PauseCircle },
  undecided: { label: "Undecided", tone: "slate", icon: CircleSlash },
};

export const AI_REC_META: Record<string, { label: string; tone: Tone }> = {
  go: { label: "AI suggests: go", tone: "green" },
  no_go: { label: "AI suggests: no-go", tone: "red" },
  needs_more_evidence: { label: "AI: needs more evidence", tone: "amber" },
};

export function DecisionBadge({ decision }: { decision: Decision }) {
  const m = DECISION_META[decision] ?? DECISION_META.undecided;
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon className="h-3 w-3" /> {m.label}</Badge>;
}

/** Record the founder's go / no-go decision with a reason. */
export function DecisionModal({ projectId, open, onClose, onSaved, initial }: {
  projectId: string; open: boolean; onClose: () => void; onSaved: () => void; initial?: Decision;
}) {
  const [decision, setDecision] = useState<Decision>(initial && initial !== "undecided" ? initial : "go");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/projects/${projectId}/decision`, { decision, note: note.trim() || null });
      setNote("");
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record your decision">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {(["go", "on_hold", "no_go"] as Decision[]).map((d) => {
            const m = DECISION_META[d];
            const Icon = m.icon;
            return (
              <button key={d} type="button" onClick={() => setDecision(d)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 px-3 py-3 text-sm font-semibold ${decision === d ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line text-slate-600 hover:border-brand-300"}`}>
                <Icon className="h-5 w-5" /> {m.label}
              </button>
            );
          })}
        </div>
        <Field label="Why? (saved with a snapshot of the evidence at this moment)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Samples approved; margin 28% at $69 with sea freight" />
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save decision</Button>
        </div>
      </div>
    </Modal>
  );
}

const fmtPrice = (o: DecisionOffer) => o.price_low === null ? "Price not supported by the research yet"
  : o.price_high && o.price_high !== o.price_low ? `${money(o.price_low)}–${money(o.price_high)}` : money(o.price_low);

/** What the AI says to sell: price range and tier, materials, must-have features, first channel - with the margin the calculator gives. */
function OfferView({ o }: { o: DecisionOffer }) {
  return (
    <div className="grid gap-3 rounded-lg border border-primary-200 bg-primary-50/60 p-3 text-sm">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Sell at</div>
        <div className="font-semibold text-ink">{fmtPrice(o)}{o.price_tier !== "unknown" && <span className="font-normal text-slate-600"> · {o.price_tier} tier</span>}</div>
        {o.economics?.map((e) => (
          <div key={e.price} className="text-xs text-slate-600">
            At {money(e.price)}: <b className={e.contribution_margin < 0 ? "text-red-700" : "text-green-700"}>{money(e.contribution_margin)}</b> per unit ({pct(e.contribution_margin_pct)})
          </div>
        ))}
        {o.economics?.[0] && <div className="text-[11px] text-slate-500">Calculated with the costs in &apos;{o.economics[0].scenario}&apos;.</div>}
        <p className="mt-1.5 text-slate-700">{o.positioning}</p>
        <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Sell first on</div>
        <div className="text-slate-800">{o.first_channel}</div>
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Materials</div>
        <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{o.materials.map((m) => <li key={m}>{m}</li>)}</ul>
        <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Must-have features</div>
        <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{o.must_have_features.map((m) => <li key={m}>{m}</li>)}</ul>
      </div>
    </div>
  );
}

/** One line for the top of a product report: the AI's call, its confidence and the offer, linking to the full brief. */
export function AiRecommendationLine({ projectId }: { projectId: string }) {
  const brief = useApi<{ id: string; created_at: string; content: DecisionBriefContent } | null>(`/api/projects/${projectId}/decision-brief`);
  if (brief.loading && !brief.data) return null;
  const c = brief.data?.content;
  if (!c) return (
    <p className="mt-2 text-sm text-slate-600">No AI recommendation yet. <a href="#decision" className="font-semibold text-primary-700 hover:underline">Get one in Overview</a> - it weighs all the research for this product.</p>
  );
  const rec = AI_REC_META[c.recommendation];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-slate-500">AI recommendation</span>
      <Badge tone={rec?.tone ?? "slate"}><Sparkles className="h-3 w-3" /> {rec?.label ?? c.recommendation}</Badge>
      <span className="text-slate-700">{c.confidence_score !== undefined ? `${c.confidence_score}/100 confidence` : `${c.confidence} confidence`}</span>
      {c.offer && <span className="text-slate-700">Sell at <b>{fmtPrice(c.offer)}</b>{c.offer.price_tier !== "unknown" ? ` (${c.offer.price_tier})` : ""}</span>}
      {c.offer?.materials?.[0] && <span className="text-slate-700">in {c.offer.materials.slice(0, 2).join(", ")}</span>}
      <a href="#decision" className="ml-auto font-semibold text-primary-700 hover:underline">See the brief</a>
    </div>
  );
}

function BriefView({ c }: { c: DecisionBriefContent }) {
  const rec = AI_REC_META[c.recommendation];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={rec?.tone ?? "slate"}><Sparkles className="h-3 w-3" /> {rec?.label ?? c.recommendation}</Badge>
        <Badge>{c.confidence_score !== undefined ? `Confidence ${c.confidence_score}/100` : `${c.confidence} confidence`}</Badge>
        <span className="text-[11px] text-slate-400">AI recommendation · {c.generated_by?.model} · {dateTime(c.generated_by?.generated_at)}</span>
      </div>
      <p className="text-base font-semibold text-ink">{c.headline}</p>
      {c.offer && <OfferView o={c.offer} />}
      <div className="grid gap-4">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-700">For</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.reasons_for.map((r) => <li key={r.point}>{r.point}</li>)}</ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-red-700">Against</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.reasons_against.map((r) => <li key={r.point}>{r.point}</li>)}</ul>
        </div>
      </div>
      {c.key_numbers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {c.key_numbers.map((k) => (
            <div key={k.label} className="rounded-lg border border-line px-3 py-2">
              <div className="text-[11px] text-slate-500">{k.label}</div>
              <div className="text-sm font-semibold text-ink">{k.value}</div>
              <div className="text-[10px] text-slate-400">{k.basis.replace(/_/g, " ")}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Conditions to go</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.conditions_to_go.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Kill criteria</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.kill_criteria.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      <Alert tone="blue" title="Cheapest next test">{c.cheapest_next_test}</Alert>
    </div>
  );
}

/** Decision card for one project: AI brief + the founder's decision and its history. */
export function DecisionPanel({ projectId, decision, note, onChanged }: {
  projectId: string; decision: Decision; note: string | null; onChanged: () => void;
}) {
  const brief = useApi<{ id: string; created_at: string; content: DecisionBriefContent } | null>(`/api/projects/${projectId}/decision-brief`);
  const history = useApi<DecisionHistoryItem[]>(`/api/projects/${projectId}/decisions`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      brief.setData(await post(`/api/projects/${projectId}/decision-brief`));
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfig(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Go / no-go decision" icon={<Gavel className="h-4 w-4" />}
        subtitle="The AI brief weighs all stored research for this product. The decision is yours and is logged with an evidence snapshot."
        actions={<>
          <Button size="sm" variant="secondary" loading={busy} onClick={generate}><Sparkles className="h-3.5 w-3.5" /> {brief.data ? "Refresh brief" : "Get AI brief"}</Button>
          <Button size="sm" onClick={() => setOpen(true)}>Record decision</Button>
        </>} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Your decision:</span> <DecisionBadge decision={decision} />
          {note && <span className="text-slate-700">- {note}</span>}
        </div>
        {config && <ConfigNotice message={config} />}
        {error && <Alert tone="red">{error}</Alert>}
        {brief.loading && !brief.data ? <Spinner /> : brief.data ? <BriefView c={brief.data.content} /> : (
          <p className="text-sm text-slate-500">No AI brief yet. Generate one after research to get an evidence-linked go / no-go recommendation.</p>
        )}
        {history.data && history.data.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Decision history</h4>
            <ul className="divide-y divide-slate-100 text-sm">
              {history.data.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <DecisionBadge decision={h.decision} />
                  <span className="text-slate-700">{h.note}</span>
                  <span className="ml-auto text-[11px] text-slate-400">{date(h.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
      <DecisionModal projectId={projectId} open={open} onClose={() => setOpen(false)} initial={decision}
        onSaved={() => { history.reload(); onChanged(); }} />
    </Card>
  );
}
