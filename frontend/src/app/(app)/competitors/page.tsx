"use client";

import { Pencil, Plus, Star, Swords, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { CsvImportCard } from "@/components/competitors/csv-import";
import { PositioningCard, PriceComparisonCard } from "@/components/competitors/charts";
import { CompetitorDetailModal, CompetitorFormModal, DiscoveredByBadge, fmtPrice } from "@/components/competitors/competitor-modals";
import { DiscoverPanel } from "@/components/competitors/discovery";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ExternalLink, PageHeader, Spinner, Tabs, Td, Th } from "@/components/ui";
import { del, errorText, patch } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { date, domainOf, titleCase } from "@/lib/format";
import type { Competitor } from "@/lib/types";

type Tab = "list" | "prices" | "positioning" | "import";

export default function CompetitorsPage() {
  return <RequireProject>{(pid) => <Competitors key={pid} projectId={pid} />}</RequireProject>;
}

function latestPrice(c: Competitor) {
  let best: { price: number; currency: string; product: string; observed_at: string } | null = null;
  let count = 0;
  for (const p of c.products)
    for (const o of p.price_observations) {
      count++;
      if (!best || o.observed_at > best.observed_at) best = { price: o.price, currency: o.currency, product: p.name, observed_at: o.observed_at };
    }
  return { best, count };
}

function Competitors({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("list");
  const [watchOnly, setWatchOnly] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError, loading, reload, setData } = useApi<Competitor[]>(`/api/projects/${projectId}/competitors`);

  const refreshAll = useCallback(() => {
    reload();
    setVersion((v) => v + 1);
  }, [reload]);

  const competitors = useMemo(() => (data ?? []).filter((c) => !watchOnly || c.on_watchlist), [data, watchOnly]);
  const detail = data?.find((c) => c.id === detailId) ?? null;

  async function toggleWatch(c: Competitor) {
    setError(null);
    setData((list) => list?.map((x) => (x.id === c.id ? { ...x, on_watchlist: !c.on_watchlist } : x)));
    try {
      await patch(`/api/competitors/${c.id}`, { on_watchlist: !c.on_watchlist });
    } catch (e) {
      setError(errorText(e));
      reload();
    }
  }

  async function remove(c: Competitor) {
    if (!window.confirm(`Delete ${c.name} and all of its products and price observations? This cannot be undone.`)) return;
    setError(null);
    try {
      await del(`/api/competitors/${c.id}`);
      refreshAll();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const watchCount = data?.filter((c) => c.on_watchlist).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Competitor Intelligence"
        description="Track competitors, their products and observed prices - every price keeps its source link, observation date and verification status."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add competitor
          </Button>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "list", label: `Competitors${data ? ` (${data.length})` : ""}` },
          { value: "prices", label: "Price comparison" },
          { value: "positioning", label: "Positioning" },
          { value: "import", label: "Import CSV" },
        ]}
      />

      {tab === "list" && (
        <div className="space-y-5">
          <DiscoverPanel projectId={projectId} onFinished={refreshAll} />
          <Card>
            <CardHeader
              title="Competitor records"
              subtitle={`${watchCount} on watchlist`}
              icon={<Swords className="h-4 w-4" />}
              actions={
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  Watchlist only
                </label>
              }
            />
            {error && (
              <div className="px-5 pt-3">
                <Alert tone="red">{error}</Alert>
              </div>
            )}
            {loading && !data && (
              <div className="px-5 py-6">
                <Spinner />
              </div>
            )}
            {loadError && (
              <div className="px-5 py-4">
                <Alert tone="red">{errorText(loadError)}</Alert>
              </div>
            )}
            {data && competitors.length === 0 && (
              <EmptyState icon={<Swords className="h-5 w-5" />} title={watchOnly ? "No competitors on your watchlist" : "No competitors yet"}>
                {watchOnly ? "Star a competitor to add it to your watchlist." : "Discover competitors with AI research above, import a CSV, or add one manually."}
              </EmptyState>
            )}
            {competitors.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead className="border-b border-slate-200 bg-slate-50/60">
                    <tr>
                      <Th className="w-10">
                        <span className="sr-only">Watchlist</span>
                      </Th>
                      <Th>Competitor</Th>
                      <Th>Tier</Th>
                      <Th>Channels</Th>
                      <Th>Source</Th>
                      <Th>Products</Th>
                      <Th>Latest observed price</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {competitors.map((c) => {
                      const { best, count } = latestPrice(c);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/50">
                          <Td>
                            <button
                              onClick={() => toggleWatch(c)}
                              className="rounded p-1 hover:bg-slate-100"
                              aria-label={c.on_watchlist ? `Remove ${c.name} from watchlist` : `Add ${c.name} to watchlist`}
                              aria-pressed={c.on_watchlist}
                              title={c.on_watchlist ? "On watchlist" : "Add to watchlist"}
                            >
                              <Star className={c.on_watchlist ? "h-4 w-4 fill-slate-500 text-slate-500" : "h-4 w-4 text-slate-300"} />
                            </button>
                          </Td>
                          <Td>
                            <button onClick={() => setDetailId(c.id)} className="text-left font-medium text-slate-900 hover:text-primary-800 hover:underline">
                              {c.name}
                            </button>
                            {c.website && (
                              <div className="text-xs">
                                <ExternalLink href={c.website}>{domainOf(c.website)}</ExternalLink>
                              </div>
                            )}
                            {c.positioning && <div className="mt-0.5 line-clamp-2 max-w-xs text-xs text-slate-500">{c.positioning}</div>}
                          </Td>
                          <Td>{c.price_tier ? <Badge tone="blue">{titleCase(c.price_tier)}</Badge> : <span className="text-xs text-slate-400">Unknown</span>}</Td>
                          <Td className="max-w-[12rem] text-xs text-slate-600">{c.channels.length ? c.channels.join(", ") : <span className="text-slate-400">-</span>}</Td>
                          <Td>
                            <DiscoveredByBadge by={c.discovered_by} />
                          </Td>
                          <Td className="text-xs">{c.products.length}</Td>
                          <Td className="text-xs">
                            {best ? (
                              <>
                                <span className="text-sm font-medium text-slate-900">{fmtPrice(best.price, best.currency)}</span>
                                <div className="text-slate-500">
                                  {best.product} · {date(best.observed_at)}
                                </div>
                                <div className="text-slate-400">{count} observation{count === 1 ? "" : "s"}</div>
                              </>
                            ) : (
                              <span className="text-slate-400">None recorded</span>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap text-right">
                            <Button size="sm" variant="secondary" onClick={() => setDetailId(c.id)}>
                              Products &amp; prices
                            </Button>
                            <button
                              onClick={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                              className="ml-1 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => remove(c)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${c.name}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "prices" && <PriceComparisonCard projectId={projectId} version={version} />}
      {tab === "positioning" && <PositioningCard projectId={projectId} hasCompetitors={(data?.length ?? 0) > 0} />}
      {tab === "import" && (
        <CsvImportCard
          title="Import competitors & price observations"
          description="One row per product price. Rows for the same competitor are merged; imported prices are marked unverified until you check them."
          templateKind="competitors"
          uploadPath={`/api/projects/${projectId}/competitors/import`}
          onDone={refreshAll}
        >
          <p className="text-xs text-slate-600">
            Columns: <code className="rounded bg-slate-100 px-1">competitor</code> (required), website, price_tier (budget/mid/premium/luxury), channels, product,
            product_url, price, currency, observed_at (YYYY-MM-DD), notes. Only import data you are permitted to collect.
          </p>
        </CsvImportCard>
      )}

      <CompetitorFormModal open={formOpen} onClose={() => setFormOpen(false)} projectId={projectId} competitor={editing} onSaved={refreshAll} />
      <CompetitorDetailModal competitor={detail} onClose={() => setDetailId(null)} onChanged={refreshAll} />
    </div>
  );
}
