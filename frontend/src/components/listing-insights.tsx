"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { Badge, Card, CardBody, CardHeader, ExternalLink, Spinner } from "@/components/ui";
import { date, domainOf, num, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";

export type Snapshot<T> = { id: string; content: T; created_at: string } | null;

export type Listing = {
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

export type Tracker = {
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

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function Rating({ rating, reviews }: { rating: number | null; reviews: number | null }) {
  const { t } = useT();
  if (rating === null && reviews === null) return <span className="text-slate-400">{t("No reviews shown")}</span>;
  return (
    <span className="whitespace-nowrap">
      {rating !== null && <><Star className="mr-0.5 inline h-3 w-3 fill-current align-[-1px] text-slate-500" aria-hidden />{rating.toFixed(1)}</>}
      {reviews !== null && <span className="text-slate-500"> ({num(reviews)})</span>}
    </span>
  );
}

// Complaint tags as stored ("value"): Title Case in English. Chinese needs its own keys, because plain "Value" / "value"
// mean a number elsewhere in the app.
const TAG_ZH: Record<string, MsgKey> = {
  comfort: "Complaint tag: comfort", fit: "Complaint tag: fit", durability: "Complaint tag: durability", quality: "Complaint tag: quality",
  appearance: "Complaint tag: appearance", value: "Complaint tag: value", shipping: "Complaint tag: shipping", other: "Complaint tag: other",
};

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
  const { t, tr, lang } = useT();
  const tagLabel = (tag: string) => (lang === "zh" && TAG_ZH[tag] ? t(TAG_ZH[tag]) : titleCase(tag));
  const snap = useApi<Snapshot<Reviews>>(`/api/projects/${projectId}/snapshots/review_insights`);
  const c = snap.data?.content;
  const [tag, setTag] = useState("all");
  const shown = (c?.reviews ?? []).filter((r) => tag === "all" || r.tags.includes(tag));
  return (
    <div className="space-y-4">
      {snap.loading && !snap.data ? <Spinner /> : !c ? (
        <p className="text-sm text-slate-500">{tr("No reviews tagged yet. Run the Complaint Reader from the {link}, after the Top Listings Tracker.", {
          link: <a href="#review" className="font-semibold text-primary-700 underline">{t("agents list at the top")}</a>,
        })}</p>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-4">
              <p className="text-sm text-ink">{c.summary}</p>
              <div className="grid gap-3">
                {c.themes.map((th) => (
                  <div key={th.tag} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink">{tagLabel(th.tag)}</h3>
                      <span className="text-xs text-slate-500">{t(th.count === 1 ? "{n} review" : "{n} reviews", { n: th.count })}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{th.summary}</p>
                    <p className="mt-2 text-sm"><span className="font-semibold text-ink">{t("Spec fix: ")}</span><span className="text-slate-700">{th.fix}</span></p>
                  </div>
                ))}
              </div>
              {c.unverified_dropped > 0 && <p className="text-xs text-slate-500">{t("{n} AI-tagged quote(s) were dropped because they could not be found word for word in their source.", { n: c.unverified_dropped })}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("{n} tagged complaints", { n: c.reviews.length })} subtitle={t("Tagged {date}. Each quote links to the page or listing it came from.", { date: date(c.generated_by.generated_at) })} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filter by complaint")}>
                {["all", ...c.themes.map((th) => th.tag)].map((x) => (
                  <button key={x} onClick={() => setTag(x)} aria-pressed={tag === x}
                    className={`rounded-md border px-2.5 py-0.5 text-xs font-semibold ${tag === x ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300"}`}>
                    {x === "all" ? t("All") : tagLabel(x)}
                  </button>
                ))}
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-line">
                {shown.map((r) => (
                  <li key={r.quote} className="px-3 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.stars !== null && <span className="whitespace-nowrap text-xs font-semibold text-slate-700">{r.stars}<Star className="ml-0.5 inline h-3 w-3 fill-current align-[-1px]" aria-label={t("stars")} /></span>}
                      {r.tags.map((x) => <Badge key={x} tone="slate">{tagLabel(x)}</Badge>)}
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
              <CardHeader title={t("Leading listings read")} subtitle={t("Share of 1-2 star ratings, from the star breakdown each listing shows.")} />
              <ul className="divide-y divide-slate-100 text-sm">
                {c.products.map((p) => (
                  <li key={p.url + p.title} className="flex flex-col gap-1 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      {p.url ? <ExternalLink href={p.url}>{p.title}</ExternalLink> : p.title}
                      <div className="text-xs text-slate-500">{p.platform}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-600">
                      <span>{p.low_star_share_pct !== null ? tr("{pct} 1-2 star", { pct: <b className="text-ink">{p.low_star_share_pct}%</b> }) : t("No star breakdown")}</span>
                      <span>{t(p.low_star_reviews_read === 1 ? "{n} low-star review read" : "{n} low-star reviews read", { n: p.low_star_reviews_read })}{p.themes_read ? ` · ${t(p.themes_read === 1 ? "{n} Amazon theme" : "{n} Amazon themes", { n: p.themes_read })}` : ""}</span>
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
