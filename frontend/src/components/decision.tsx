"use client";

import { CheckCircle2, CircleSlash, Gavel, PauseCircle, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, Field, Modal, Spinner, Textarea, type Tone } from "./ui";
import { ApiError, errorText, post } from "@/lib/api";
import { date, dateTime, money, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";
import type { Decision, DecisionBriefContent, DecisionHistoryItem, DecisionOffer } from "@/lib/types";

type T = ReturnType<typeof useT>["t"];

/** `label` is an English dictionary key: show it with t(). */
export const DECISION_META: Record<Decision, { label: MsgKey; tone: Tone; icon: typeof CheckCircle2 }> = {
  go: { label: "Go", tone: "green", icon: CheckCircle2 },
  no_go: { label: "No-go", tone: "red", icon: XCircle },
  on_hold: { label: "On hold", tone: "amber", icon: PauseCircle },
  undecided: { label: "Undecided", tone: "slate", icon: CircleSlash },
};

/** `label` is an English dictionary key: show it with t(). */
export const AI_REC_META: Record<string, { label: MsgKey; tone: Tone }> = {
  go: { label: "AI suggests: go", tone: "green" },
  no_go: { label: "AI suggests: no-go", tone: "red" },
  needs_more_evidence: { label: "AI: needs more evidence", tone: "amber" },
};

export function DecisionBadge({ decision }: { decision: Decision }) {
  const { t } = useT();
  const m = DECISION_META[decision] ?? DECISION_META.undecided;
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon className="h-3 w-3" /> {t(m.label)}</Badge>;
}

/** Record the founder's go / no-go decision with a reason. */
export function DecisionModal({ projectId, open, onClose, onSaved, initial }: {
  projectId: string; open: boolean; onClose: () => void; onSaved: () => void; initial?: Decision;
}) {
  const { t } = useT();
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
    <Modal open={open} onClose={onClose} title={t("Record your decision")}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {(["go", "on_hold", "no_go"] as Decision[]).map((d) => {
            const m = DECISION_META[d];
            const Icon = m.icon;
            return (
              <button key={d} type="button" onClick={() => setDecision(d)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 px-3 py-3 text-sm font-semibold ${decision === d ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line text-slate-600 hover:border-brand-300"}`}>
                <Icon className="h-5 w-5" /> {t(m.label)}
              </button>
            );
          })}
        </div>
        <Field label={t("Why? (saved with a snapshot of the evidence at this moment)")}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Samples approved; margin 28% at $69 with sea freight")} />
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
          <Button loading={busy} onClick={save}>{t("Save decision")}</Button>
        </div>
      </div>
    </Modal>
  );
}

const fmtPrice = (o: DecisionOffer, t: T) => o.price_low === null ? t("Price not supported by the research yet")
  : o.price_high && o.price_high !== o.price_low ? `${money(o.price_low)}–${money(o.price_high)}` : money(o.price_low);

/** What the AI says to sell: price range and tier, materials, must-have features, first channel - with the margin the calculator gives. */
function OfferView({ o }: { o: DecisionOffer }) {
  const { t, tx, tr } = useT();
  return (
    <div className="grid gap-3 rounded-lg border border-primary-200 bg-primary-50/60 p-3 text-sm">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("Sell at")}</div>
        <div className="font-semibold text-ink">{fmtPrice(o, t)}{o.price_tier !== "unknown" && <span className="font-normal text-slate-600"> · {t("{tier} tier", { tier: tx(o.price_tier) })}</span>}</div>
        {o.economics?.map((e) => (
          <div key={e.price} className="text-xs text-slate-600">
            {tr("At {price}: {margin} per unit ({pct})", {
              price: money(e.price),
              margin: <b className={e.contribution_margin < 0 ? "text-red-700" : "text-green-700"}>{money(e.contribution_margin)}</b>,
              pct: pct(e.contribution_margin_pct),
            })}
          </div>
        ))}
        {o.economics?.[0] && <div className="text-[11px] text-slate-500">{t("Calculated with the costs in '{scenario}'.", { scenario: o.economics[0].scenario })}</div>}
        <p className="mt-1.5 text-slate-700">{o.positioning}</p>
        <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("Sell first on")}</div>
        <div className="text-slate-800">{o.first_channel}</div>
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("Materials")}</div>
        <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{o.materials.map((m) => <li key={m}>{m}</li>)}</ul>
        <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("Must-have features")}</div>
        <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{o.must_have_features.map((m) => <li key={m}>{m}</li>)}</ul>
      </div>
    </div>
  );
}

/** One line for the top of a product report: the AI's call, its confidence and the offer, linking to the full brief. */
export function AiRecommendationLine({ projectId }: { projectId: string }) {
  const { t, tx, tr } = useT();
  const brief = useApi<{ id: string; created_at: string; content: DecisionBriefContent } | null>(`/api/projects/${projectId}/decision-brief`);
  if (brief.loading && !brief.data) return null;
  const c = brief.data?.content;
  if (!c) return (
    <p className="mt-2 text-sm text-slate-600">{tr("No AI recommendation yet. {link} - it weighs all the research for this product.", {
      link: <a href="#decision" className="font-semibold text-primary-700 hover:underline">{t("Get one in Overview")}</a>,
    })}</p>
  );
  const rec = AI_REC_META[c.recommendation];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-slate-500">{t("AI recommendation")}</span>
      <Badge tone={rec?.tone ?? "slate"}><Sparkles className="h-3 w-3" /> {rec ? t(rec.label) : c.recommendation}</Badge>
      <span className="text-slate-700">{c.confidence_score !== undefined ? t("{score}/100 confidence", { score: c.confidence_score }) : t("{level} confidence", { level: tx(c.confidence) })}</span>
      {c.offer && <span className="text-slate-700">{c.offer.price_tier !== "unknown"
        ? tr("Sell at {price} ({tier})", { price: <b>{fmtPrice(c.offer, t)}</b>, tier: tx(c.offer.price_tier) })
        : tr("Sell at {price}", { price: <b>{fmtPrice(c.offer, t)}</b> })}</span>}
      {c.offer?.materials?.[0] && <span className="text-slate-700">{t("in {materials}", { materials: c.offer.materials.slice(0, 2).join(", ") })}</span>}
      <a href="#decision" className="ml-auto font-semibold text-primary-700 hover:underline">{t("See the brief")}</a>
    </div>
  );
}

type MarginScenario = { name: string; contribution_margin: number | null; contribution_margin_pct: number | null; retail_price: number | null;
  costs_assumed: boolean; assumed_inputs: number; total_inputs: number };

/** One line under the AI recommendation: the margin per unit from the latest saved scenario, and how much of it is still guessed. */
export function MarginLine({ projectId }: { projectId: string }) {
  const { t, tr } = useT();
  const dash = useApi<{ latest_scenario: MarginScenario | null }>(`/api/projects/${projectId}/dashboard`);
  if (!dash.data) return null;
  const sc = dash.data.latest_scenario;
  const cm = sc?.contribution_margin;
  const loses = !!sc && !sc.costs_assumed && cm !== null && cm !== undefined && cm < 0;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-slate-500">{t("Margin")}</span>
      {!sc || cm === null || cm === undefined ? <span className="text-slate-700">{t("Not worked out yet")}</span> : (
        <>
          <span className={loses ? "text-red-700" : "text-slate-700"} title={t("From the saved scenario '{name}'", { name: sc.name })}>
            {tr(sc.contribution_margin_pct !== null
              ? (sc.retail_price !== null ? "{margin} per unit ({pct}) at {price}" : "{margin} per unit ({pct})")
              : (sc.retail_price !== null ? "{margin} per unit at {price}" : "{margin} per unit"), {
              margin: <b>{money(cm)}</b>,
              pct: sc.contribution_margin_pct !== null ? pct(sc.contribution_margin_pct, 1) : "",
              price: sc.retail_price !== null ? money(sc.retail_price) : "",
            })}
          </span>
          {sc.costs_assumed ? <Badge tone="amber">{t("Rough estimate")}</Badge> : loses && <Badge tone="red">{t("Loses money on each sale")}</Badge>}
          {sc.assumed_inputs > 0 && <span className="text-slate-500">{t("{n} of {total} inputs assumed", { n: sc.assumed_inputs, total: sc.total_inputs })}</span>}
        </>
      )}
      <a href="#economics" className="ml-auto font-semibold text-primary-700 hover:underline">{t("Unit economics")}</a>
    </div>
  );
}

function BriefView({ c }: { c: DecisionBriefContent }) {
  const { t, tx } = useT();
  const rec = AI_REC_META[c.recommendation];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={rec?.tone ?? "slate"}><Sparkles className="h-3 w-3" /> {rec ? t(rec.label) : c.recommendation}</Badge>
        <Badge>{c.confidence_score !== undefined ? t("Confidence {score}/100", { score: c.confidence_score }) : t("{level} confidence", { level: tx(c.confidence) })}</Badge>
        <span className="text-[11px] text-slate-400">{t("AI recommendation")} · {c.generated_by?.model} · {dateTime(c.generated_by?.generated_at)}</span>
      </div>
      <p className="text-base font-semibold text-ink">{c.headline}</p>
      {c.offer && <OfferView o={c.offer} />}
      <div className="grid gap-4">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-700">{t("For")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.reasons_for.map((r) => <li key={r.point}>{r.point}</li>)}</ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-red-700">{t("Against")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.reasons_against.map((r) => <li key={r.point}>{r.point}</li>)}</ul>
        </div>
      </div>
      {c.key_numbers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {c.key_numbers.map((k) => (
            <div key={k.label} className="rounded-lg border border-line px-3 py-2">
              <div className="text-[11px] text-slate-500">{k.label}</div>
              <div className="text-sm font-semibold text-ink">{k.value}</div>
              <div className="text-[10px] text-slate-400">{tx(k.basis.replace(/_/g, " "))}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t("Conditions to go")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.conditions_to_go.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t("Kill criteria")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.kill_criteria.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      <Alert tone="blue" title={t("Cheapest next test")}>{c.cheapest_next_test}</Alert>
    </div>
  );
}

/** Decision card for one project: AI brief + the founder's decision and its history. */
export function DecisionPanel({ projectId, decision, note, onChanged }: {
  projectId: string; decision: Decision; note: string | null; onChanged: () => void;
}) {
  const { t } = useT();
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
      <CardHeader title={t("Go / no-go decision")} icon={<Gavel className="h-4 w-4" />}
        subtitle={t("The AI brief weighs all stored research for this product. The decision is yours and is logged with an evidence snapshot.")}
        actions={<>
          <Button size="sm" variant="secondary" loading={busy} onClick={generate}><Sparkles className="h-3.5 w-3.5" /> {brief.data ? t("Refresh brief") : t("Get AI brief")}</Button>
          <Button size="sm" onClick={() => setOpen(true)}>{t("Record decision")}</Button>
        </>} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">{t("Your decision:")}</span> <DecisionBadge decision={decision} />
          {note && <span className="text-slate-700">- {note}</span>}
        </div>
        {config && <ConfigNotice message={config} />}
        {error && <Alert tone="red">{error}</Alert>}
        {brief.loading && !brief.data ? <Spinner /> : brief.data ? <BriefView c={brief.data.content} /> : (
          <p className="text-sm text-slate-500">{t("No AI brief yet. Generate one after research to get an evidence-linked go / no-go recommendation.")}</p>
        )}
        {history.data && history.data.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t("Decision history")}</h4>
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
