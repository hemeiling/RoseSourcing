"use client";

import { Palette, Sparkles, UserRound, Users } from "lucide-react";
import { useState } from "react";
import type { Snapshot } from "@/components/listing-insights";
import { Badge, Card, CardBody, CardHeader, ExternalLink, ProductThumb, Spinner } from "@/components/ui";
import { date, num, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Tag = {
  ref: string; age: number | null; age_band: string; wearer: string; gift: boolean; occasions: string[]; liked: string[]; disliked: string[];
  quote: string; stars: number | null; kind: "review" | "web"; source_title: string | null; url: string | null;
};
type Style = {
  term: string; kind: string; synonyms: string[]; liked: number; disliked: number; mentioned: number; top_listings: number; top_listing_reviews: number;
  examples: { title: string; url: string | null; image: string | null }[];
};
type BuyerStyle = {
  summary: string;
  stats: {
    comments_read: number; reviews: number; web_comments: number; tagged: number; unverified_dropped: number; stars: Record<string, number>;
    age: { stated: number; median: number | null; mean: number | null; min: number | null; max: number | null; with_age_info: number; bands: Record<string, number> };
    wearer: Record<string, number>; gift: number; occasions: { tag: string; count: number; includes?: string[] }[]; rated?: number;
  };
  published?: { claim: string; evidence_type: string; url: string | null }[];
  styles: Style[];
  personas: { name: string; age_range: string; description: string; wants: string[]; comment_refs: string[] }[];
  design_directions: { title: string; description: string; why: string; refs: string[] }[];
  comments: Tag[];
  listings: { ref: string; title: string; url: string | null; reviews: number | null }[];
  findings: Record<string, string>;
  generated_by: { generated_at: string };
};

const BAND_LABEL: Record<string, string> = { child: "Under 13", teen: "13-19", "20s": "20s", "30s": "30s", "40s": "40s", "50s": "50s", "60+": "60+" };
const SHOWN = 6;

/** One labelled bar per row; the value is written beside it so nothing depends on reading the bar length. */
function Bars({ rows, empty }: { rows: { label: string; value: number; title?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.some((r) => r.value)) return <p className="text-xs text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
          <span className="break-words leading-tight text-slate-600" title={r.title ?? r.label}>{r.label}</span>
          <span className="h-2.5 rounded-sm bg-canvas"><span className="block h-2.5 rounded-sm bg-primary-300" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="text-right font-semibold text-ink">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Who buys this, what for, and which looks they like - counted by the app from every customer comment collected. */
export function BuyerStyleSection({ projectId }: { projectId: string }) {
  const snap = useApi<Snapshot<BuyerStyle>>(`/api/projects/${projectId}/snapshots/buyer_style`);
  const [all, setAll] = useState(false);
  const c = snap.data?.content;
  const byRef = new Map((c?.comments ?? []).map((t) => [t.ref, t]));
  const listing = new Map((c?.listings ?? []).map((l) => [l.ref, l]));

  const ref = (r: string) => {
    const t = byRef.get(r);
    const l = listing.get(r);
    const href = t?.url ?? l?.url ?? null;
    const title = t ? `"${t.quote}"` : l ? l.title : c?.findings?.[r] ?? r;
    return href ? <a key={r} href={href} target="_blank" rel="noopener noreferrer" title={title}
      className="rounded border border-line px-1 text-[11px] font-semibold text-primary-700 hover:border-primary-300">{r}</a>
      : <span key={r} title={title} className="rounded border border-line px-1 text-[11px] text-slate-500">{r}</span>;
  };

  return (
    <div className="space-y-4">
      {snap.loading && !snap.data ? <Spinner /> : !c ? (
        <p className="text-sm text-slate-500">No buyer profile yet. Run the Buyer Profiler from the <a href="#review" className="font-semibold text-primary-700 underline">agents list at the top</a>, after the Top Listings Tracker.</p>
      ) : (
        <>
          <Card>
            <CardHeader title="Who buys and what they like" icon={<Users className="h-4 w-4" />}
              subtitle={`Counted from ${c.stats.comments_read} customer comments (${c.stats.reviews} marketplace reviews, ${c.stats.web_comments} web) on ${date(c.generated_by.generated_at)} · ${c.stats.tagged} say something about the buyer or the look${c.stats.unverified_dropped ? ` · ${c.stats.unverified_dropped} AI tags dropped (quote not found)` : ""}`} />
            <CardBody className="space-y-4">
              <p className="text-sm text-ink">{c.summary}</p>
              <div className="grid gap-4">
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">Age</h3>
                  <p className="mb-2 text-xs text-slate-600">
                    {c.stats.age.stated
                      ? <>Median <b className="text-ink">{c.stats.age.median}</b> (range {c.stats.age.min}-{c.stats.age.max}) from {c.stats.age.stated} comment{c.stats.age.stated === 1 ? "" : "s"} that state an age.</>
                      : "No comment states an age."}
                    {c.stats.age.with_age_info > c.stats.age.stated && ` ${c.stats.age.with_age_info} mention an age group.`}
                  </p>
                  <Bars rows={Object.entries(c.stats.age.bands).map(([b, v]) => ({ label: BAND_LABEL[b] ?? b, value: v }))} empty="No age groups mentioned." />
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">Who wears it</h3>
                  <Bars rows={Object.entries(c.stats.wearer).map(([w, v]) => ({ label: w === "self" ? "The buyer" : titleCase(w), value: v }))} empty="Not mentioned." />
                  {c.stats.gift > 0 && <p className="mt-1.5 text-xs text-slate-600">{c.stats.gift} bought as a gift.</p>}
                  <h3 className="mb-1.5 mt-3 text-sm font-semibold text-ink">Star ratings read</h3>
                  {(c.stats.rated ?? 0) >= 5
                    ? <Bars rows={Object.entries(c.stats.stars).map(([s, v]) => ({ label: `${s} stars`, value: v }))} empty="No star ratings." />
                    : <p className="text-xs text-slate-500">Only {c.stats.rated ?? 0} of {c.stats.comments_read} comments carry a star rating: Amazon&apos;s quoted reviews come without one.</p>}
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">What they wear it for</h3>
                  <Bars rows={c.stats.occasions.map((o) => ({ label: o.tag, value: o.count, title: o.includes?.length ? `${o.tag}: ${o.includes.join(", ")}` : o.tag }))}
                    empty="No occasions mentioned." />
                  <p className="mt-1 text-[11px] text-slate-500">Comments per group; hover a group for the words buyers used.</p>
                </div>
              </div>
              {!!c.published?.length && (
                <div className="rounded-lg bg-canvas px-3 py-2">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">What published sources say about the buyers</h3>
                  <ul className="space-y-0.5 text-xs text-slate-700">
                    {c.published.map((f) => (
                      <li key={f.claim}>
                        {f.evidence_type === "unavailable" ? <span className="text-slate-500">Not found: {f.claim}</span> : f.claim}
                        {f.url && <> · <ExternalLink href={f.url}>source</ExternalLink></>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Looks they like" icon={<Palette className="h-4 w-4" />}
              subtitle="Praised and criticised in comments, and how many of the best-selling tracked listings use each look." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2">Look</th><th className="px-2 py-2">Praised</th><th className="px-2 py-2">Criticised</th>
                    <th className="px-2 py-2">Mentioned</th><th className="px-2 py-2">In top sellers</th><th className="px-4 py-2">Examples</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {c.styles.map((s) => (
                    <tr key={s.term}>
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium text-ink">{s.term}</div>
                        <div className="text-xs text-slate-500">{titleCase(s.kind)}{s.synonyms.length ? ` · ${s.synonyms.join(", ")}` : ""}</div>
                      </td>
                      <td className="px-2 py-2 align-top font-semibold text-green-700">{s.liked || <span className="font-normal text-slate-400">0</span>}</td>
                      <td className="px-2 py-2 align-top font-semibold text-red-700">{s.disliked || <span className="font-normal text-slate-400">0</span>}</td>
                      <td className="px-2 py-2 align-top text-slate-700">{s.mentioned}</td>
                      <td className="px-2 py-2 align-top text-slate-700">{s.top_listings}{s.top_listings > 0 && <div className="text-xs text-slate-500">{num(s.top_listing_reviews)} reviews</div>}</td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {s.examples.map((e) => e.image ? <ProductThumb key={e.title} src={e.image} href={e.url} alt={e.title} size={36} />
                            : e.url ? <ExternalLink key={e.title} href={e.url} className="text-xs">{e.title.slice(0, 40)}</ExternalLink> : null)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader title="Buyer personas" icon={<UserRound className="h-4 w-4" />} subtitle="Grounded in the tagged comments (hover a ref to read it)." />
              <CardBody className="space-y-3">
                {c.personas.map((p) => (
                  <div key={p.name} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold text-ink">{p.name}</span><Badge tone="slate">{p.age_range}</Badge></div>
                    <p className="mt-1 text-sm text-slate-600">{p.description}</p>
                    {p.wants.length > 0 && <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">Wants:</span> {p.wants.join(" · ")}</p>}
                    {p.comment_refs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{p.comment_refs.map(ref)}</div>}
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Design directions" icon={<Sparkles className="h-4 w-4" />} subtitle="What to design next, with the comments (C), best sellers (L) and web findings (F) behind it." />
              <CardBody className="space-y-3">
                {c.design_directions.map((d) => (
                  <div key={d.title} className="rounded-lg border border-line p-3">
                    <div className="font-semibold text-ink">{d.title}</div>
                    <p className="mt-1 text-sm text-slate-700">{d.description}</p>
                    <p className="mt-1 text-xs text-slate-500">{d.why}</p>
                    {d.refs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{d.refs.map(ref)}</div>}
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={`What buyers say (${c.comments.length})`} subtitle="Each tag rests on the quote shown, copied word for word from the comment." />
            <ul className="divide-y divide-slate-100">
              {(all ? c.comments : c.comments.slice(0, SHOWN)).map((t) => (
                <li key={t.ref} className="px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-400">{t.ref}</span>
                    {t.stars && <span className="text-xs text-slate-500">{t.stars}★</span>}
                    {t.age !== null ? <Badge tone="violet">Age {t.age}</Badge> : t.age_band !== "unknown" && <Badge tone="violet">{BAND_LABEL[t.age_band] ?? t.age_band}</Badge>}
                    {t.wearer !== "unknown" && <Badge tone="slate">{t.wearer === "self" ? "Wears it herself/himself" : `For ${t.wearer}`}</Badge>}
                    {t.gift && <Badge tone="amber">Gift</Badge>}
                    {t.occasions.map((o) => <Badge key={o} tone="blue">{o}</Badge>)}
                    {t.liked.map((l) => <Badge key={`+${l}`} tone="green">+ {l}</Badge>)}
                    {t.disliked.map((l) => <Badge key={`-${l}`} tone="red">- {l}</Badge>)}
                  </div>
                  <p className="mt-1 text-slate-700">&ldquo;{t.quote}&rdquo;</p>
                  {t.url && <ExternalLink href={t.url} className="text-xs">{t.source_title ?? "Source"}</ExternalLink>}
                </li>
              ))}
            </ul>
            {c.comments.length > SHOWN && (
              <button onClick={() => setAll((v) => !v)} className="px-5 pb-3 text-xs font-semibold text-primary-700 hover:underline">
                {all ? "Show fewer" : `Show all ${c.comments.length}`}
              </button>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
