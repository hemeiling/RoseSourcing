"use client";

import clsx from "clsx";
import { ArrowUpRight, Pencil, Star, Swords, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DiscoveredByBadge } from "./competitor-modals";
import { Rating, median, type Tracker } from "@/components/listing-insights";
import { fmtFigure } from "@/components/market-size";
import { Badge, Button, Card, CardHeader, ExternalLink, ProductThumb, Td, Th } from "@/components/ui";
import { date, domainOf, money, num, titleCase } from "@/lib/format";
import type { Competitor, CompetitorProduct, PriceObservation } from "@/lib/types";

const OTHER = "Other sites";
const SHOWN = 3; // listings shown per brand before "Show all"

type Row = { product: CompetitorProduct; latest: PriceObservation | null; count: number; platform: string; tracked: boolean; seller: string | null };

const latestOf = (p: CompetitorProduct) =>
  p.price_observations.reduce<PriceObservation | null>((a, o) => (!a || o.observed_at > a.observed_at ? o : a), null);

/** Where a competitor's name links: its website, else the listing where it was seen. */
function brandLink(c: Competitor, rows: Row[]) {
  if (c.website) return { href: c.website, label: domainOf(c.website) };
  const url = rows.map((r) => r.latest?.source_url ?? r.product.url).find(Boolean);
  return url ? { href: url, label: `listing on ${domainOf(url)}` } : null;
}

/** Every competitor brand with its listings underneath: the brand's tier, channels, source and revenue, and each listing's
 *  picture, price, rating, reviews and badges as last seen. Listings the Listing Tracker picked as directly comparable are
 *  marked, with its summary on top. Starred brands come first. */
export function BrandsAndListings({ competitors, tracker, trackedAt, onToggleWatch, onEdit, onRemove, onDetail }: {
  competitors: Competitor[];
  tracker: Tracker | null;
  trackedAt: string | null;
  onToggleWatch: (c: Competitor) => void;
  onEdit: (c: Competitor) => void;
  onRemove: (c: Competitor) => void;
  onDetail: (c: Competitor) => void;
}) {
  const [platform, setPlatform] = useState("all");
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const tracked = useMemo(() => new Map((tracker?.listings ?? []).map((l) => [l.competitor_product_id, l])), [tracker]);
  const all = useMemo(() => competitors.map((c) => {
    const rows: Row[] = c.products.map((p) => {
      const latest = latestOf(p);
      const t = tracked.get(p.id);
      return { product: p, latest, count: p.price_observations.length, platform: latest?.platform ?? t?.platform ?? OTHER,
        tracked: !!t, seller: t?.seller && t.seller !== c.name ? t.seller : null };
    }).sort((a, b) => (b.latest?.review_count ?? -1) - (a.latest?.review_count ?? -1));
    return { c, rows };
  }), [competitors, tracked]);

  const platforms = useMemo(() => {
    const n: Record<string, number> = {};
    for (const { rows } of all) for (const r of rows) n[r.platform] = (n[r.platform] ?? 0) + 1;
    return Object.entries(n).sort((a, b) => (a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : b[1] - a[1]));
  }, [all]);
  const listingCount = platforms.reduce((t, [, n]) => t + n, 0);
  const filtering = platform !== "all" || trackedOnly;

  const brands = all
    .filter(({ c }) => !watchOnly || c.on_watchlist)
    .map(({ c, rows }) => ({ c, rows: rows.filter((r) => (platform === "all" || r.platform === platform) && (!trackedOnly || r.tracked)) }))
    .filter(({ rows }) => !filtering || rows.length > 0)
    // Starred first, then the brands whose listings have the most reviews.
    .sort((a, b) => Number(b.c.on_watchlist) - Number(a.c.on_watchlist)
      || (b.rows[0]?.latest?.review_count ?? -1) - (a.rows[0]?.latest?.review_count ?? -1));

  const tl = tracker?.listings ?? [];
  const prices = tl.map((r) => r.price);
  const counts = tl.flatMap((r) => (r.reviews !== null ? [r.reviews] : []));
  const chip = (active: boolean) => clsx("rounded-md border px-2.5 py-0.5 text-xs font-semibold",
    active ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300");

  return (
    <Card>
      <CardHeader title="Competitors & listings" icon={<Swords className="h-4 w-4" />}
        subtitle={`${competitors.length} brands · ${listingCount} listings · ${competitors.filter((c) => c.on_watchlist).length} on watchlist`} />
      <div className="space-y-2.5 border-b border-line px-5 py-3">
        {tracker && trackedAt ? (
          <>
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{tl.length} directly comparable listings</span> tracked on {date(trackedAt)}, picked
              from {tracker.candidates_considered} search results for &quot;{tracker.keywords.join('", "')}&quot;. {tracker.left_out}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
              {prices.length > 0 && <span>Price {money(Math.min(...prices))} – {money(Math.max(...prices))}, median <b className="text-ink">{money(median(prices))}</b></span>}
              {counts.length > 0 && <span>Median <b className="text-ink">{num(median(counts))}</b> reviews</span>}
              <span><b className="text-ink">{tl.filter((r) => r.badges.length).length}</b> with a badge</span>
            </div>
            {tracker.gaps.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">{tracker.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
          </>
        ) : (
          <p className="text-xs text-slate-500">No comparable listings tracked yet - run the Listing Tracker above to log 15-20 with price, rating, reviews and badges.</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter listings">
          <button onClick={() => setPlatform("all")} aria-pressed={platform === "all"} className={chip(platform === "all")}>All · {listingCount}</button>
          {platforms.map(([p, n]) => (
            <button key={p} onClick={() => setPlatform(p)} aria-pressed={platform === p} className={chip(platform === p)}>{p} · {n}</button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" aria-hidden />
          {tracker && (
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <input type="checkbox" checked={trackedOnly} onChange={(e) => setTrackedOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Comparable only
            </label>
          )}
          <label className="ml-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Watchlist only
          </label>
        </div>
      </div>
      {brands.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">No competitors match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-slate-200 bg-slate-50/60">
              <tr>
                <Th className="w-10"><span className="sr-only">Watchlist</span></Th>
                <Th>Competitor</Th>
                <Th>Tier</Th>
                <Th>Channels</Th>
                <Th>Source</Th>
                <Th>Price</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            {brands.map(({ c, rows }) => {
              const link = brandLink(c, rows);
              const ps = rows.flatMap((r) => (r.latest ? [r.latest.price] : []));
              const shown = open.has(c.id) ? rows : rows.slice(0, SHOWN);
              return (
                <tbody key={c.id} className="border-t border-line first-of-type:border-t-0">
                  <tr>
                    <Td>
                      <button onClick={() => onToggleWatch(c)} className="group rounded p-1 hover:bg-amber-50" aria-pressed={c.on_watchlist}
                        aria-label={c.on_watchlist ? `Remove ${c.name} from watchlist` : `Add ${c.name} to watchlist`}
                        title={c.on_watchlist ? "On watchlist" : "Add to watchlist"}>
                        <Star className={c.on_watchlist ? "h-4 w-4 fill-amber-300 text-amber-500" : "h-4 w-4 text-slate-300 group-hover:text-amber-400"} />
                      </button>
                    </Td>
                    <Td>
                      {link ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer" title={`Open ${c.name} (${link.label})`}
                          className="inline-flex items-start gap-1 font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:text-primary-800 hover:decoration-primary-800">
                          {c.name}<ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        </a>
                      ) : (
                        <button onClick={() => onDetail(c)} className="text-left font-medium text-slate-900 hover:text-primary-800 hover:underline">{c.name}</button>
                      )}
                      {link && <div className="text-xs text-slate-500">{link.label}</div>}
                      {c.revenue && (
                        <div className="text-xs text-slate-600">
                          Revenue {fmtFigure(c.revenue)}{c.revenue.year ? ` (${c.revenue.year})` : ""}
                          {c.revenue.source_url && <> · <ExternalLink href={c.revenue.source_url}>source</ExternalLink></>}
                        </div>
                      )}
                      {c.positioning && <div className="mt-0.5 max-w-xs text-xs text-slate-500">{c.positioning}</div>}
                    </Td>
                    <Td>{c.price_tier ? <Badge tone="blue">{titleCase(c.price_tier)}</Badge> : <span className="text-xs text-slate-400">Unknown</span>}</Td>
                    <Td className="max-w-[12rem] text-xs text-slate-600">{c.channels.length ? c.channels.join(", ") : <span className="text-slate-400">-</span>}</Td>
                    <Td><DiscoveredByBadge by={c.discovered_by} /></Td>
                    <Td className="text-xs text-slate-600">
                      {ps.length ? <span className="text-sm font-medium text-ink">{Math.min(...ps) === Math.max(...ps) ? money(ps[0]) : `${money(Math.min(...ps))} – ${money(Math.max(...ps))}`}</span>
                        : <span className="text-slate-400">None recorded</span>}
                      <div>{rows.length} listing{rows.length === 1 ? "" : "s"}</div>
                    </Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => onDetail(c)} className="whitespace-nowrap" title="Price history of every product">History</Button>
                        <button onClick={() => onEdit(c)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Edit ${c.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => onRemove(c)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${c.name}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                  {rows.length > 0 && (
                    <tr>
                      <td />
                      <td colSpan={6} className="pb-3 pr-3">
                        <ul className="divide-y divide-slate-100 rounded-lg border border-line bg-canvas/40">
                          {shown.map((r) => <ListingRow key={r.product.id} r={r} />)}
                        </ul>
                        {rows.length > SHOWN && (
                          <button className="mt-1.5 text-xs font-semibold text-primary-700 hover:underline"
                            onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                            {open.has(c.id) ? "Show fewer" : `Show all ${rows.length} listings`}
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </Card>
  );
}

function ListingRow({ r }: { r: Row }) {
  const p = r.product;
  const o = r.latest;
  const url = o?.source_url ?? p.url;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)_6.5rem_5.5rem_8rem] sm:items-start">
      <div className="row-span-4 sm:row-span-1"><ProductThumb src={p.image_url} href={url} alt={p.name} size={48} /></div>
      <div className="min-w-0">
        {url ? <ExternalLink href={url} className="font-medium">{p.name}</ExternalLink> : <span className="font-medium text-ink">{p.name}</span>}
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          {r.seller && <span>sold by {r.seller} ·</span>}
          {o ? <span>seen {date(o.observed_at)}{r.count > 1 ? ` · ${r.count} price records` : ""}</span> : <span>no price recorded</span>}
          {r.tracked && <Badge tone="teal" title="Picked by the Listing Tracker as directly comparable">Comparable</Badge>}
        </div>
        {(o?.badges.length ?? 0) > 0 && <div className="mt-1 flex flex-wrap gap-1">{o!.badges.map((b) => <Badge key={b} tone="slate">{b}</Badge>)}</div>}
      </div>
      <div className="text-xs text-slate-600 sm:text-sm">{r.platform}</div>
      <div className="font-semibold text-ink">{o ? money(o.price) : "-"}</div>
      <div className="text-xs sm:text-sm">{o ? <Rating rating={o.rating} reviews={o.review_count} /> : null}</div>
    </li>
  );
}
