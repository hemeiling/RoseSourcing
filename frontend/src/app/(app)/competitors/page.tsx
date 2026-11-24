"use client";

import { Plus, Swords } from "lucide-react";
import { useCallback, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { CsvImportCard } from "@/components/competitors/csv-import";
import { PositioningCard, PriceComparisonCard } from "@/components/competitors/charts";
import { BrandsAndListings } from "@/components/competitors/brand-listings";
import { CompetitorDetailModal, CompetitorFormModal } from "@/components/competitors/competitor-modals";
import type { Snapshot, Tracker } from "@/components/listing-insights";
import { Alert, Button, Card, EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui";
import { del, errorText, patch } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Competitor } from "@/lib/types";

type Tab = "list" | "prices" | "positioning" | "import";

export default function CompetitorsPage() {
  return <RequireProject>{(pid) => <Competitors key={pid} projectId={pid} />}</RequireProject>;
}

function Competitors({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("list");
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError, loading, reload, setData } = useApi<Competitor[]>(`/api/projects/${projectId}/competitors`);
  const tracker = useApi<Snapshot<Tracker>>(`/api/projects/${projectId}/snapshots/listing_tracker`);

  const refreshAll = useCallback(() => {
    reload();
    setVersion((v) => v + 1);
  }, [reload]);

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
          { value: "list", label: `Competitors & listings${data ? ` (${data.length})` : ""}` },
          { value: "prices", label: "Price comparison" },
          { value: "positioning", label: "Positioning" },
          { value: "import", label: "Import CSV" },
        ]}
      />

      {tab === "list" && (
        <div className="space-y-5">
          {/* Old links to the Listing tracker land here. */}
          <span id="listings" className="block scroll-mt-20 sm:scroll-mt-36" aria-hidden />
          {error && <Alert tone="red">{error}</Alert>}
          {loadError && <Alert tone="red">{errorText(loadError)}</Alert>}
          {loading && !data ? <Spinner /> : data && data.length === 0 ? (
            <Card>
              <EmptyState icon={<Swords className="h-5 w-5" />} title="No competitors yet">
                Discover competitors with AI research or track comparable listings above, import a CSV, or add one manually.
              </EmptyState>
            </Card>
          ) : data && (
            <BrandsAndListings competitors={data} tracker={tracker.data?.content ?? null} trackedAt={tracker.data?.created_at ?? null}
              onToggleWatch={toggleWatch} onRemove={remove} onDetail={(c) => setDetailId(c.id)}
              onEdit={(c) => { setEditing(c); setFormOpen(true); }} />
          )}
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
