"use client";

import { Star, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ResearchRunStarter } from "@/components/research-run-starter";
import { Badge, Card, CardBody, CardHeader, ExternalLink, ProductThumb, Spinner, type Tone } from "@/components/ui";
import { date, domainOf, money, num, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Snapshot<T> = { id: string; content: T; created_at: string } | null;

type Listing = {
  competitor_product_id: string;
  competitor: string;
  platform: string;
  title: string;
  price: number;
  rating: number | null;
  reviews: number | null;
  badges: string[];
  url: string;
  seller: string | null;
  why: string;
  image?: string | null;
};

type Tracker = {
  keywords: string[];
  geo: string;
  trend: ({ keyword: string; url: string; series: [string, number][]; average: number; peak: number; recent_average: number;
    prior_average: number; change_pct: number | null }) | null;
  listings: Listing[];
  candidates_considered: number;
  by_platform: Record<string, number>;
  left_out: string;
  gaps: string[];
  retrieved_at: string;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function TrendCard({ trend }: { trend: NonNullable<Tracker["trend"]> }) {
  const data = trend.series.map(([d, v]) => ({ d, v }));
  const ch = trend.change_pct;
  // Many zero weeks = too few searches for Trends to show a direction; the swings are noise.
  const zeros = trend.series.filter(([, v]) => v === 0).length;
  const sparse = zeros / Math.max(1, trend.series.length) >= 0.2;
  const [tone, Icon, word]: [Tone, typeof TrendingUp, string] = sparse ? ["slate", Minus, "Low search volume"]
    : ch === null || Math.abs(ch) <= 15 ? ["slate", Minus, "Steady"] : ch > 0 ? ["green", TrendingUp, "Rising"] : ["amber", TrendingDown, "Falling"];
  return (
    <Card>
      <CardHeader title={`Google search interest: "${trend.keyword}"`}
        subtitle={<>Weekly, past 12 months, {trend.series.length} points. 100 = the busiest week; values are relative, not search volumes. <ExternalLink href={trend.url}>Open in Google Trends</ExternalLink></>}
        actions={<Badge tone={tone}><Icon className="h-3 w-3" aria-hidden /> {word}{ch !== null && !sparse ? ` ${ch > 0 ? "+" : ""}${ch.toFixed(0)}%` : ""}</Badge>} />
      <CardBody>
        {sparse && (
          <p className="mb-2 text-sm text-slate-600">
            {zeros} of {trend.series.length} weeks are 0: too few people search this exact phrase for Trends to show a real direction.
            Track a broader phrase too (e.g. the plain product name) to judge demand.
          </p>
        )}
        <p className="mb-2 text-sm text-slate-600">
          Last 13 weeks average <b className="text-ink">{trend.recent_average.toFixed(0)}</b> vs <b className="text-ink">{trend.prior_average.toFixed(0)}</b> before ·
          12-month average {trend.average.toFixed(0)} · peak {trend.peak.toFixed(0)}
        </p>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 11, fill: "#64748b" }} interval="preserveStartEnd" minTickGap={48}
                tickFormatter={(s: string) => s.replace(/\s*[–-].*$/, "")} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip cursor={{ stroke: "#94a3b8" }}
                content={({ active, payload }) => active && payload?.length ? (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                    <div className="text-slate-500">{(payload[0].payload as { d: string }).d}</div>
                    <div className="font-semibold text-ink">Interest {payload[0].value as number}</div>
                  </div>
                ) : null} />
              <Line type="monotone" dataKey="v" stroke="#334155" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function Rating({ rating, reviews }: { rating: number | null; reviews: number | null }) {
  if (rating === null && reviews === null) return <span className="text-slate-400">No reviews shown</span>;
  return (
    <span className="whitespace-nowrap">
      {rating !== null && <><Star className="mr-0.5 inline h-3 w-3 fill-current align-[-1px] text-slate-500" aria-hidden />{rating.toFixed(1)}</>}
      {reviews !== null && <span className="text-slate-500"> ({num(reviews)})</span>}
    </span>
  );
}

/** Google Trends + 15-20 comparable listings with price, rating, review count and badges, as the marketplaces showed them. */
export function ListingTrackerSection({ projectId, onLogged }: { projectId: string; onLogged?: () => void }) {
  const snap = useApi<Snapshot<Tracker>>(`/api/projects/${projectId}/snapshots/listing_tracker`);
  const t = snap.data?.content;
  const [platform, setPlatform] = useState<string>("all");
  const rows = useMemo(() => (t?.listings ?? []).filter((r) => platform === "all" || r.platform === platform)
    .sort((a, b) => (b.reviews ?? -1) - (a.reviews ?? -1)), [t, platform]);
  const prices = (t?.listings ?? []).map((r) => r.price);
  const counts = (t?.listings ?? []).flatMap((r) => (r.reviews !== null ? [r.reviews] : []));
  return (
    <div className="space-y-4">
      <ResearchRunStarter projectId={projectId} kind="listing_tracker" label="Track listings" onFinished={() => { snap.reload(); onLogged?.(); }}
        keywordsPlaceholder="e.g. knotted headband, top knot headband"
        approval="This makes about 6 SerpApi searches (Google Trends, Amazon, Google Shopping, and Etsy through Google) and one short AI call that picks the 15-20 listings directly comparable to this product. Every price, rating, review count and badge is copied from the marketplace data and saved as a dated price record, so running it again later builds a price history."
        focusPlaceholder="e.g. women's knotted tweed and plaid headbands" />
      {snap.loading && !snap.data ? <Spinner /> : !t ? (
        <p className="text-sm text-slate-500">No listings tracked yet for this product.</p>
      ) : (
        <>
          {t.trend && <TrendCard trend={t.trend} />}
          <Card>
            <CardHeader title={`${t.listings.length} comparable listings`}
              subtitle={`Picked from ${t.candidates_considered} search results for "${t.keywords.join('", "')}" on ${date(t.retrieved_at)}. ${t.left_out}`} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
                {prices.length > 0 && <span>Price {money(Math.min(...prices))} – {money(Math.max(...prices))}, median <b className="text-ink">{money(median(prices))}</b></span>}
                {counts.length > 0 && <span>Median <b className="text-ink">{num(median(counts))}</b> reviews</span>}
                <span><b className="text-ink">{t.listings.filter((r) => r.badges.length).length}</b> with a badge</span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by platform">
                {[["all", t.listings.length] as const, ...Object.entries(t.by_platform).sort((a, b) => b[1] - a[1])].map(([p, n]) => (
                  <button key={p} onClick={() => setPlatform(p)} aria-pressed={platform === p}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${platform === p ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300"}`}>
                    {p === "all" ? "All" : p} · {n}
                  </button>
                ))}
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-line">
                {rows.map((r) => (
                  <li key={r.competitor_product_id + r.url} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_6.5rem_5.5rem_8rem] sm:items-start">
                    <div className="row-span-4 sm:row-span-1"><ProductThumb src={r.image} href={r.url} alt={r.title} size={64} /></div>
                    <div className="min-w-0">
                      {r.url ? <ExternalLink href={r.url} className="font-medium">{r.title}</ExternalLink> : <span className="font-medium text-ink">{r.title}</span>}
                      <div className="text-xs text-slate-500">{r.competitor}{r.seller && r.seller !== r.competitor ? ` · sold by ${r.seller}` : ""}</div>
                      {r.badges.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">{r.badges.map((b) => <Badge key={b} tone="slate">{b}</Badge>)}</div>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 sm:text-sm">{r.platform}</div>
                    <div className="font-semibold text-ink">{money(r.price)}</div>
                    <div className="text-xs sm:text-sm"><Rating rating={r.rating} reviews={r.reviews} /></div>
                  </li>
                ))}
              </ul>
              {t.gaps.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">{t.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
              <p className="text-xs text-slate-500">Each listing is saved under Competitors with a dated price record (rating, reviews and badges included).</p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

type Reviews = {
  summary: string;
  themes: { tag: string; count: number; summary: string; fix: string; problems: string[] }[];
  reviews: { product: string; stars: number | null; quote: string; tags: string[]; problem: string; url: string | null; source_title: string | null }[];
  products: { title: string; url: string; platform: string; star_counts: Record<string, number>; star_unit: "reviews" | "percent";
    low_star_share_pct: number | null; low_star_reviews_read: number; themes_read: number }[];
  unverified_dropped: number;
  generated_by: { generated_at: string };
};

/** Complaints in 1-3 star reviews of the leading listings, tagged for comfort, fit and durability. */
export function ReviewInsightsSection({ projectId }: { projectId: string }) {
  const snap = useApi<Snapshot<Reviews>>(`/api/projects/${projectId}/snapshots/review_insights`);
  const tracker = useApi<Snapshot<Tracker>>(`/api/projects/${projectId}/snapshots/listing_tracker`);
  const c = snap.data?.content;
  const [tag, setTag] = useState("all");
  const shown = (c?.reviews ?? []).filter((r) => tag === "all" || r.tags.includes(tag));
  return (
    <div className="space-y-4">
      {tracker.data === null && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Run the Listing Tracker first (<a href="#listings" className="font-semibold underline">Listing tracker</a>): this agent reads the reviews of the leading listings it found.
        </p>
      )}
      <ResearchRunStarter projectId={projectId} kind="review_mining" label="Read low-star reviews" onFinished={snap.reload}
        approval="This reads the reviews of the 6 most-reviewed tracked listings through SerpApi (Google's product panel and Amazon's product page), searches the web - Etsy, brand sites, Reddit - for 1-3 star reviews, then tags each complaint as comfort, fit, durability and so on. A quote is kept only if it appears word for word in its source."
        focusPlaceholder="e.g. headaches, slipping, knot coming undone" />
      {snap.loading && !snap.data ? <Spinner /> : !c ? (
        <p className="text-sm text-slate-500">No reviews tagged yet for this product.</p>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-4">
              <p className="text-sm text-ink">{c.summary}</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {c.themes.map((t) => (
                  <div key={t.tag} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink">{titleCase(t.tag)}</h3>
                      <span className="text-xs text-slate-500">{t.count} review{t.count === 1 ? "" : "s"}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{t.summary}</p>
                    <p className="mt-2 text-sm"><span className="font-semibold text-ink">Spec fix: </span><span className="text-slate-700">{t.fix}</span></p>
                  </div>
                ))}
              </div>
              {c.unverified_dropped > 0 && <p className="text-xs text-slate-500">{c.unverified_dropped} AI-tagged quote(s) were dropped because they could not be found word for word in their source.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`${c.reviews.length} tagged complaints`} subtitle={`Tagged ${date(c.generated_by.generated_at)}. Each quote links to the page or listing it came from.`} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by complaint">
                {["all", ...c.themes.map((t) => t.tag)].map((x) => (
                  <button key={x} onClick={() => setTag(x)} aria-pressed={tag === x}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tag === x ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300"}`}>
                    {x === "all" ? "All" : titleCase(x)}
                  </button>
                ))}
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-line">
                {shown.map((r) => (
                  <li key={r.quote} className="px-3 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.stars !== null && <span className="whitespace-nowrap text-xs font-semibold text-slate-700">{r.stars}<Star className="ml-0.5 inline h-3 w-3 fill-current align-[-1px]" aria-label="stars" /></span>}
                      {r.tags.map((x) => <Badge key={x} tone="slate">{titleCase(x)}</Badge>)}
                      <span className="text-xs text-slate-500">{r.problem}</span>
                    </div>
                    <blockquote className="mt-1 text-ink">“{r.quote}”</blockquote>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {r.product}{r.url && <> · <ExternalLink href={r.url}>{domainOf(r.url)}</ExternalLink></>}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          {c.products.length > 0 && (
            <Card>
              <CardHeader title="Leading listings read" subtitle="Share of 1-2 star ratings, from the star breakdown each listing shows." />
              <ul className="divide-y divide-slate-100 text-sm">
                {c.products.map((p) => (
                  <li key={p.url + p.title} className="flex flex-col gap-1 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      {p.url ? <ExternalLink href={p.url}>{p.title}</ExternalLink> : p.title}
                      <div className="text-xs text-slate-500">{p.platform}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-600">
                      <span>{p.low_star_share_pct !== null ? <><b className="text-ink">{p.low_star_share_pct}%</b> 1-2 star</> : "No star breakdown"}</span>
                      <span>{p.low_star_reviews_read} low-star review{p.low_star_reviews_read === 1 ? "" : "s"} read{p.themes_read ? ` · ${p.themes_read} Amazon theme${p.themes_read === 1 ? "" : "s"}` : ""}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
