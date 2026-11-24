"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Palette, Sparkles, UserRound, Users } from "lucide-react";
import { useState } from "react";
import type { Snapshot } from "@/components/listing-insights";
import { Badge, Card, CardBody, CardHeader, ExternalLink, ProductThumb, Spinner } from "@/components/ui";
import { date, num, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";

type Tag = {
  ref: string; age: number | null; age_band: string; wearer: string; gift: boolean; occasions: string[]; liked: string[]; disliked: string[];
  quote: string; stars: number | null; kind: "review" | "web"; source_title: string | null; url: string | null;
};
type Style = {
  term: string; kind: string; synonyms: string[]; liked: number; disliked: number; mentioned: number; top_listings: number; top_listing_reviews: number;
  examples: { title: string; url: string | null; image: string | null }[];
};
type SortKey = "term" | "liked" | "disliked" | "mentioned" | "top_listings";

/** A header that sorts its column: the first click puts the most (or A first for names) on top, the next reverses. */
function SortTh({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; desc: boolean } | null;
  onSort: (k: SortKey) => void; className: string }) {
  const active = sort?.key === k;
  const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <th className={className} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-start gap-1 text-left uppercase tracking-wide hover:text-primary-700 ${active ? "text-primary-700" : ""}`}>
        {label}<Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${active ? "" : "text-slate-300"}`} aria-hidden />
      </button>
    </th>
  );
}

/** Each look: how often it is praised, criticised and mentioned, and how many top sellers use it - sortable by any column. */
function LooksTable({ styles }: { styles: Style[] }) {
  const { t } = useT();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const onSort = (k: SortKey) => setSort((cur) => (cur?.key === k ? { key: k, desc: !cur.desc } : { key: k, desc: k !== "term" }));
  const rows = !sort ? styles : [...styles].sort((a, b) => {
    const d = sort.key === "term" ? a.term.localeCompare(b.term)
      : sort.key === "top_listings" ? a.top_listings - b.top_listings || a.top_listing_reviews - b.top_listing_reviews
      : a[sort.key] - b[sort.key];
    return sort.desc ? -d : d;
  });
  const th = { sort, onSort };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-line bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <SortTh label={t("Look")} k="term" className="px-4 py-2" {...th} />
            <SortTh label={t("Praised")} k="liked" className="px-2 py-2" {...th} />
            <SortTh label={t("Criticised")} k="disliked" className="px-2 py-2" {...th} />
            <SortTh label={t("Mentioned")} k="mentioned" className="px-2 py-2" {...th} />
            <SortTh label={t("In top sellers")} k="top_listings" className="px-2 py-2" {...th} />
            <th className="px-4 py-2">{t("Examples")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((s) => (
            <tr key={s.term}>
              <td className="px-4 py-2 align-top">
                <div className="font-medium text-ink">{s.term}</div>
                <div className="text-xs text-slate-500">{titleCase(s.kind)}{s.synonyms.length ? ` · ${s.synonyms.join(", ")}` : ""}</div>
              </td>
              <td className="px-2 py-2 align-top font-semibold text-green-700">{s.liked || <span className="font-normal text-slate-400">0</span>}</td>
              <td className="px-2 py-2 align-top font-semibold text-red-700">{s.disliked || <span className="font-normal text-slate-400">0</span>}</td>
              <td className="px-2 py-2 align-top text-slate-700">{s.mentioned}</td>
              <td className="px-2 py-2 align-top text-slate-700">{s.top_listings}{s.top_listings > 0 && <div className="text-xs text-slate-500">{t("{n} reviews", { n: num(s.top_listing_reviews) })}</div>}</td>
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
  );
}

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

const BAND_LABEL: Record<string, MsgKey> = { child: "Under 13", teen: "13-19", "20s": "20s", "30s": "30s", "40s": "40s", "50s": "50s", "60+": "60+" };
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
  const { t, tr, lang } = useT();
  const snap = useApi<Snapshot<BuyerStyle>>(`/api/projects/${projectId}/snapshots/buyer_style`);
  const [all, setAll] = useState(false);
  const c = snap.data?.content;
  const byRef = new Map((c?.comments ?? []).map((tag) => [tag.ref, tag]));
  const listing = new Map((c?.listings ?? []).map((l) => [l.ref, l]));

  const ref = (r: string) => {
    const tag = byRef.get(r);
    const l = listing.get(r);
    const href = tag?.url ?? l?.url ?? null;
    const title = tag ? `"${tag.quote}"` : l ? l.title : c?.findings?.[r] ?? r;
    return href ? <a key={r} href={href} target="_blank" rel="noopener noreferrer" title={title}
      className="rounded border border-line px-1 text-[11px] font-semibold text-primary-700 hover:border-primary-300">{r}</a>
      : <span key={r} title={title} className="rounded border border-line px-1 text-[11px] text-slate-500">{r}</span>;
  };

  return (
    <div className="space-y-4">
      {snap.loading && !snap.data ? <Spinner /> : !c ? (
        <p className="text-sm text-slate-500">{tr("No buyer profile yet. Run the Buyer Profiler from the {link}, after the Top Listings Tracker.", { link: <a href="#review" className="font-semibold text-primary-700 underline">{t("agents list at the top")}</a> })}</p>
      ) : (
        <>
          <Card>
            <CardHeader title={t("Who buys and what they like")} icon={<Users className="h-4 w-4" />}
              subtitle={`${t("Counted from {n} customer comments ({reviews} marketplace reviews, {web} web) on {date}", { n: c.stats.comments_read, reviews: c.stats.reviews, web: c.stats.web_comments, date: date(c.generated_by.generated_at) })} · ${t("{n} say something about the buyer or the look", { n: c.stats.tagged })}${c.stats.unverified_dropped ? ` · ${t("{n} AI tags dropped (quote not found)", { n: c.stats.unverified_dropped })}` : ""}`} />
            <CardBody className="space-y-4">
              <p className="text-sm text-ink">{c.summary}</p>
              <div className="grid gap-4">
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">{t("Age")}</h3>
                  <p className="mb-2 text-xs text-slate-600">
                    {c.stats.age.stated
                      ? tr(c.stats.age.stated === 1 ? "Median {median} (range {min}-{max}) from {n} comment that state an age." : "Median {median} (range {min}-{max}) from {n} comments that state an age.", {
                          median: <b className="text-ink">{c.stats.age.median}</b>, min: c.stats.age.min, max: c.stats.age.max, n: c.stats.age.stated })
                      : t("No comment states an age.")}
                    {c.stats.age.with_age_info > c.stats.age.stated && `${lang === "zh" ? "" : " "}${t("{n} mention an age group.", { n: c.stats.age.with_age_info })}`}
                  </p>
                  <Bars rows={Object.entries(c.stats.age.bands).map(([b, v]) => ({ label: BAND_LABEL[b] ? t(BAND_LABEL[b]) : b, value: v }))} empty={t("No age groups mentioned.")} />
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">{t("Who wears it")}</h3>
                  <Bars rows={Object.entries(c.stats.wearer).map(([w, v]) => ({ label: w === "self" ? t("The buyer") : titleCase(w), value: v }))} empty={t("Not mentioned.")} />
                  {c.stats.gift > 0 && <p className="mt-1.5 text-xs text-slate-600">{t("{n} bought as a gift.", { n: c.stats.gift })}</p>}
                  <h3 className="mb-1.5 mt-3 text-sm font-semibold text-ink">{t("Star ratings read")}</h3>
                  {(c.stats.rated ?? 0) >= 5
                    ? <Bars rows={Object.entries(c.stats.stars).map(([s, v]) => ({ label: t("{n} stars", { n: s }), value: v }))} empty={t("No star ratings.")} />
                    : <p className="text-xs text-slate-500">{t("Only {n} of {total} comments carry a star rating: Amazon's quoted reviews come without one.", { n: c.stats.rated ?? 0, total: c.stats.comments_read })}</p>}
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">{t("What they wear it for")}</h3>
                  <Bars rows={c.stats.occasions.map((o) => ({ label: o.tag, value: o.count, title: o.includes?.length ? `${o.tag}: ${o.includes.join(", ")}` : o.tag }))}
                    empty={t("No occasions mentioned.")} />
                  <p className="mt-1 text-[11px] text-slate-500">{t("Comments per group; hover a group for the words buyers used.")}</p>
                </div>
              </div>
              {!!c.published?.length && (
                <div className="rounded-lg bg-canvas px-3 py-2">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("What published sources say about the buyers")}</h3>
                  <ul className="space-y-0.5 text-xs text-slate-700">
                    {c.published.map((f) => (
                      <li key={f.claim}>
                        {f.evidence_type === "unavailable" ? <span className="text-slate-500">{t("Not found: {claim}", { claim: f.claim })}</span> : f.claim}
                        {f.url && <> · <ExternalLink href={f.url}>{t("source")}</ExternalLink></>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("Looks they like")} icon={<Palette className="h-4 w-4" />}
              subtitle={t("Praised and criticised in comments, and how many of the best-selling tracked listings use each look.")} />
            <LooksTable styles={c.styles} />
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader title={t("Buyer personas")} icon={<UserRound className="h-4 w-4" />} subtitle={t("Grounded in the tagged comments (hover a ref to read it).")} />
              <CardBody className="space-y-3">
                {c.personas.map((p) => (
                  <div key={p.name} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold text-ink">{p.name}</span><Badge tone="slate">{p.age_range}</Badge></div>
                    <p className="mt-1 text-sm text-slate-600">{p.description}</p>
                    {p.wants.length > 0 && <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">{t("Wants:")}</span> {p.wants.join(" · ")}</p>}
                    {p.comment_refs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{p.comment_refs.map(ref)}</div>}
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("Design directions")} icon={<Sparkles className="h-4 w-4" />} subtitle={t("What to design next, with the comments (C), best sellers (L) and web findings (F) behind it.")} />
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
            <CardHeader title={t("What buyers say ({n})", { n: c.comments.length })} subtitle={t("Each tag rests on the quote shown, copied word for word from the comment.")} />
            <ul className="divide-y divide-slate-100">
              {(all ? c.comments : c.comments.slice(0, SHOWN)).map((tag) => (
                <li key={tag.ref} className="px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-400">{tag.ref}</span>
                    {tag.stars && <span className="text-xs text-slate-500">{tag.stars}★</span>}
                    {tag.age !== null ? <Badge tone="violet">{t("Age {n}", { n: tag.age })}</Badge> : tag.age_band !== "unknown" && <Badge tone="violet">{BAND_LABEL[tag.age_band] ? t(BAND_LABEL[tag.age_band]) : tag.age_band}</Badge>}
                    {tag.wearer !== "unknown" && <Badge tone="slate">{tag.wearer === "self" ? t("Wears it herself/himself") : t("For {who}", { who: lang === "zh" ? titleCase(tag.wearer) : tag.wearer })}</Badge>}
                    {tag.gift && <Badge tone="amber">{t("Gift")}</Badge>}
                    {tag.occasions.map((o) => <Badge key={o} tone="blue">{o}</Badge>)}
                    {tag.liked.map((l) => <Badge key={`+${l}`} tone="green">+ {l}</Badge>)}
                    {tag.disliked.map((l) => <Badge key={`-${l}`} tone="red">- {l}</Badge>)}
                  </div>
                  <p className="mt-1 text-slate-700">&ldquo;{tag.quote}&rdquo;</p>
                  {tag.url && <ExternalLink href={tag.url} className="text-xs">{tag.source_title ?? t("Source")}</ExternalLink>}
                </li>
              ))}
            </ul>
            {c.comments.length > SHOWN && (
              <button onClick={() => setAll((v) => !v)} className="px-5 pb-3 text-xs font-semibold text-primary-700 hover:underline">
                {all ? t("Show fewer") : t("Show all {n}", { n: c.comments.length })}
              </button>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
