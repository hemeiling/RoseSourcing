"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, Image as ImageIcon, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardBody, ExternalLink, ProductThumb, Spinner, type Tone } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { date, domainOf, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Snapshot<T> = { id: string; content: T; created_at: string } | null;

type Tier = {
  tier: "budget" | "mid" | "premium" | "luxury";
  price_low: number | null;
  price_high: number | null;
  range_basis: "sourced" | "from_examples" | "unavailable";
  currency: string;
  materials_and_quality: string[];
  buyer_profile: string | null;
  customer_needs: string[];
  complaints: string[];
  examples: { product: string; price: number; currency: string; url: string | null; image?: string | null }[];
  evidence_type: "sourced" | "ai_inference";
  sources: { url: string; title: string | null }[];
};

const TIER_LABEL: Record<Tier["tier"], string> = { budget: "Budget", mid: "Mid-range", premium: "Premium", luxury: "Luxury / designer" };

function range(t: Tier): string {
  if (t.price_low === null) return "Price range not found";
  const cur = t.currency === "USD" ? {} : { currency: t.currency };
  return t.price_low === t.price_high ? money(t.price_low, cur) : `${money(t.price_low, cur)} – ${money(t.price_high, cur)}`;
}

/** Price tiers from budget to luxury, with what buyers in each tier want and complain about. */
export function PriceTiersSection({ projectId }: { projectId: string }) {
  const snap = useApi<Snapshot<{ tiers: Tier[] }>>(`/api/projects/${projectId}/snapshots/price_tiers`);
  const tiers = snap.data?.content.tiers ?? [];
  const noPicture = tiers.reduce((n, t) => n + t.examples.filter((e) => !e.image).length, 0);
  const [pics, setPics] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const findPictures = async () => {
    setPics({ busy: true, note: null });
    try {
      const r = await post<{ found: number; still_missing: number; serpapi_calls: number }>(`/api/projects/${projectId}/snapshots/price_tiers/pictures`);
      setPics({ busy: false, note: `Found ${r.found} picture${r.found === 1 ? "" : "s"} (${r.serpapi_calls} SerpApi searches)${r.still_missing ? `; ${r.still_missing} example${r.still_missing === 1 ? " is" : "s are"} not in today's listings` : ""}.` });
      snap.reload();
    } catch (e) { setPics({ busy: false, note: errorText(e) }); }
  };
  return (
    <div className="space-y-4">
      {snap.loading && !snap.data ? <Spinner /> : !snap.data ? (
        <p className="text-sm text-slate-500">Not researched yet. Run the Price Tier Agent from the <a href="#review" className="font-semibold text-primary-700 underline">agents list at the top</a>.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500">From the run on {date(snap.data.created_at)}. Example prices are shown only when they appeared on the source page.</p>
            {noPicture > 0 && (
              <Button size="sm" variant="ghost" onClick={findPictures} loading={pics.busy} title="Looks the examples up in Amazon and Google Shopping listings (up to 4 SerpApi searches, no AI)">
                <ImageIcon className="h-3.5 w-3.5" /> Find {noPicture} missing picture{noPicture === 1 ? "" : "s"}
              </Button>
            )}
            {pics.note && <span className="text-xs text-slate-600">{pics.note}</span>}
          </div>
          <div className="grid gap-3">
            {tiers.map((t) => (
              <Card key={t.tier} className="flex flex-col">
                <div className="border-b border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-serif text-lg font-semibold text-ink">{TIER_LABEL[t.tier]}</h3>
                    {t.evidence_type === "ai_inference" && <Badge title="No retrieved source supports this tier directly">AI inference</Badge>}
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-slate-700">{range(t)}</div>
                  {t.range_basis === "from_examples" && <div className="text-[11px] text-slate-500">Range of the example prices below</div>}
                </div>
                <CardBody className="flex-1 space-y-3 text-sm">
                  {t.buyer_profile && <p className="text-slate-700">{t.buyer_profile}</p>}
                  {t.materials_and_quality.length > 0 && (
                    <div><div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Quality & materials</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-slate-700">{t.materials_and_quality.map((m) => <li key={m}>{m}</li>)}</ul></div>
                  )}
                  {t.customer_needs.length > 0 && (
                    <div><div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">What buyers want</div>
                      <ul className="space-y-1">{t.customer_needs.map((n) => <li key={n} className="flex gap-1.5 text-slate-700"><ThumbsUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{n}</li>)}</ul></div>
                  )}
                  {t.complaints.length > 0 && (
                    <div><div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Complaints</div>
                      <ul className="space-y-1">{t.complaints.map((n) => <li key={n} className="flex gap-1.5 text-slate-700"><ThumbsDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{n}</li>)}</ul></div>
                  )}
                  {t.examples.length > 0 && (
                    <div><div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Examples</div>
                      <ul className="space-y-2">{t.examples.map((e) => (
                        <li key={`${e.product}-${e.price}`} className="flex items-start gap-2.5">
                          <ProductThumb src={e.image} href={e.url} alt={e.product} size={44} />
                          <span className="min-w-0 flex-1">{e.url ? <ExternalLink href={e.url}>{e.product}</ExternalLink> : e.product}</span>
                          <span className="shrink-0 tabular-nums text-slate-700">{money(e.price, e.currency === "USD" ? {} : { currency: e.currency })}</span>
                        </li>
                      ))}</ul></div>
                  )}
                  {t.sources.length > 0 && (
                    <details className="text-xs text-slate-500"><summary className="cursor-pointer">Sources ({t.sources.length})</summary>
                      <ul className="mt-1 space-y-0.5">{t.sources.map((s) => <li key={s.url}><ExternalLink href={s.url}>{s.title || s.url}</ExternalLink></li>)}</ul></details>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type Checklist = {
  summary: string;
  caveat: string;
  items: { area: string; requirement: string; status: "action_needed" | "likely_ok" | "unknown"; what_to_do: string; finding_ids: string[]; sources?: { url: string; title: string }[] }[];
  supplier_questions: string[];
  supplier_drafts: number;
};

const STATUS: Record<Checklist["items"][number]["status"], { label: string; tone: Tone; Icon: typeof CheckCircle2 }> = {
  action_needed: { label: "Action needed", tone: "amber", Icon: AlertTriangle },
  likely_ok: { label: "Likely OK", tone: "green", Icon: CheckCircle2 },
  unknown: { label: "Unknown", tone: "slate", Icon: CircleHelp },
};
const AREA_LABEL: Record<string, string> = { design_ip: "Design patents & IP", labeling: "Labelling", forced_labor: "Forced labour (UFLPA)", safety: "Product safety", other: "Other" };

/** Design-patent, labelling and UFLPA check, with supplier questions drafted (never sent) for each supplier on file. */
export function ComplianceSection({ projectId }: { projectId: string }) {
  const snap = useApi<Snapshot<Checklist>>(`/api/projects/${projectId}/snapshots/compliance_checklist`);
  const c = snap.data?.content;
  const areas = c ? [...new Set(c.items.map((i) => i.area))] : [];
  return (
    <div className="space-y-4">
      {snap.loading && !snap.data ? <Spinner /> : !c ? (
        <p className="text-sm text-slate-500">Not researched yet. Run the Compliance &amp; IP Agent from the <a href="#review" className="font-semibold text-primary-700 underline">agents list at the top</a>.</p>
      ) : (
        <Card>
          <CardBody className="space-y-4">
            <p className="text-sm text-ink">{c.summary}</p>
            {areas.map((a) => (
              <div key={a}>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{AREA_LABEL[a] ?? titleCase(a)}</h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-line">
                  {c.items.filter((i) => i.area === a).map((i) => {
                    const s = STATUS[i.status];
                    return (
                      <li key={i.requirement} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                        <Badge tone={s.tone} className="w-fit"><s.Icon className="h-3 w-3" /> {s.label}</Badge>
                        <div className="min-w-0 text-sm">
                          <div className="font-medium text-ink">{i.requirement}</div>
                          <div className="text-slate-600">{i.what_to_do}</div>
                          {!!i.sources?.length && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                              {i.sources.slice(0, 4).map((s) => <ExternalLink key={s.url} href={s.url} className="max-w-full break-all">{domainOf(s.url)}</ExternalLink>)}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {c.supplier_questions.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Questions for your supplier</h3>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">{c.supplier_questions.map((q) => <li key={q}>{q}</li>)}</ol>
                <p className="mt-2 text-xs text-slate-500">
                  {c.supplier_drafts
                    ? `Drafted in the communication log of ${c.supplier_drafts} supplier${c.supplier_drafts === 1 ? "" : "s"} (see Suppliers). Nothing was sent - review and send them yourself.`
                    : "No suppliers on file yet, so no drafts were saved. Add a supplier and run the check again, or copy these questions."}
                </p>
              </div>
            )}
            <p className="text-xs text-slate-500">{c.caveat}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
