"use client";

import { Factory, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { CsvImportCard } from "@/components/competitors/csv-import";
import { SupplierComparison } from "@/components/suppliers/comparison";
import { QualityStars, SupplierDetailModal, SupplierFormModal, SupplierVerificationBadge, fmtMoney } from "@/components/suppliers/supplier-modals";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ExternalLink, PageHeader, PlannedBadge, Spinner, Tabs, Td, Th } from "@/components/ui";
import { del, errorText } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { domainOf, titleCase } from "@/lib/format";
import type { IntegrationStatus, Supplier } from "@/lib/types";

type Tab = "list" | "compare" | "import";

export default function SuppliersPage() {
  return <RequireProject>{(pid) => <Suppliers key={pid} projectId={pid} />}</RequireProject>;
}

function platformLabel(p: string | null): string {
  if (!p) return "-";
  if (p === "1688") return "1688.com";
  if (p === "alibaba") return "Alibaba.com";
  return titleCase(p);
}

function Suppliers({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("list");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError, loading, reload } = useApi<Supplier[]>(`/api/projects/${projectId}/suppliers`);
  const levels = useApi<Record<string, string>>("/api/suppliers/verification-levels");
  const integrations = useApi<IntegrationStatus[]>("/api/integrations");
  const labels = levels.data;

  const refreshAll = useCallback(() => {
    reload();
    setVersion((v) => v + 1);
  }, [reload]);

  function openEdit(s: Supplier | null) {
    setEditing(s);
    setFormOpen(true);
  }

  async function remove(s: Supplier) {
    if (!window.confirm(`Delete ${s.name} with all of its quotes and communication history? This cannot be undone.`)) return;
    setError(null);
    try {
      await del(`/api/suppliers/${s.id}`);
      refreshAll();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const sourcingIntegrations = (integrations.data ?? []).filter((i) => i.category === "sourcing");

  return (
    <div>
      <PageHeader
        title="Supplier Intelligence"
        description="Compare manufacturers on MOQ, unit price, samples, lead time and landed cost. Verification levels are set only by you - nothing here is presented as vetted or certified."
        actions={
          <Button onClick={() => openEdit(null)}>
            <Plus className="h-4 w-4" aria-hidden /> Add supplier
          </Button>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "list", label: `Suppliers${data ? ` (${data.length})` : ""}` },
          { value: "compare", label: "Comparison & landed cost" },
          { value: "import", label: "Import & integrations" },
        ]}
      />

      {tab === "list" && (
        <Card>
          <CardHeader title="Supplier records" subtitle="Click a supplier to manage quotes, communication history and RFQ drafts." icon={<Factory className="h-4 w-4" />} />
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
          {data && data.length === 0 && (
            <EmptyState
              icon={<Factory className="h-5 w-5" />}
              title="No suppliers yet"
              action={
                <div className="flex gap-2">
                  <Button onClick={() => openEdit(null)}>Add supplier</Button>
                  <Button variant="secondary" onClick={() => setTab("import")}>
                    Import CSV
                  </Button>
                </div>
              }
            >
              Record manufacturers you are evaluating along with their quotes. Landed-cost comparison updates automatically.
            </EmptyState>
          )}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <Th>Supplier</Th>
                    <Th>Location</Th>
                    <Th>Platform</Th>
                    <Th>Verification</Th>
                    <Th>Quality</Th>
                    <Th>Certifications</Th>
                    <Th>Quotes</Th>
                    <Th>Source</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((s) => {
                    const usdPrices = s.quotes.filter((q) => q.unit_price !== null && q.currency === "USD").map((q) => q.unit_price as number);
                    const best = usdPrices.length ? Math.min(...usdPrices) : null;
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/50">
                        <Td>
                          <button onClick={() => setDetailId(s.id)} className="text-left font-medium text-slate-900 hover:text-primary-800 hover:underline">
                            {s.name}
                          </button>
                          {s.website && (
                            <div className="text-xs">
                              <ExternalLink href={s.website}>{domainOf(s.website)}</ExternalLink>
                            </div>
                          )}
                          {s.capabilities.length > 0 && <div className="mt-0.5 max-w-xs break-words text-xs text-slate-500">{s.capabilities.join(", ")}</div>}
                        </Td>
                        <Td className="text-xs">{[s.city, s.country].filter(Boolean).join(", ") || "-"}</Td>
                        <Td className="text-xs">{platformLabel(s.platform)}</Td>
                        <Td>
                          <SupplierVerificationBadge status={s.verification_status} labels={labels} />
                        </Td>
                        <Td>
                          <QualityStars rating={s.quality_rating} />
                        </Td>
                        <Td className="max-w-[12rem] text-xs text-slate-600">
                          {s.certifications_claimed.length ? (
                            <span title="Claimed by the supplier; not verified">
                              Claimed: {s.certifications_claimed.join(", ")} <span className="text-slate-400">(not verified)</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">None claimed</span>
                          )}
                        </Td>
                        <Td className="text-xs">
                          {s.quotes.length}
                          {best !== null && <div className="text-slate-500">from {fmtMoney(best)}/unit</div>}
                        </Td>
                        <Td>
                          <Badge tone={s.source === "csv" ? "blue" : "slate"}>{s.source === "csv" ? "CSV import" : titleCase(s.source)}</Badge>
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          <Button size="sm" variant="secondary" onClick={() => setDetailId(s.id)}>
                            Open
                          </Button>
                          <button onClick={() => openEdit(s)} className="ml-1 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Edit ${s.name}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(s)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${s.name}`}>
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
      )}

      {tab === "compare" && <SupplierComparison projectId={projectId} labels={labels} version={version} />}

      {tab === "import" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CsvImportCard
              title="Import suppliers & quotes"
              description="One row per quote. Rows with the same supplier name are merged. Imported suppliers always start as Unverified."
              templateKind="suppliers"
              uploadPath={`/api/projects/${projectId}/suppliers/import`}
              onDone={refreshAll}
            >
              <p className="text-xs text-slate-600">
                Columns: <code className="rounded bg-slate-100 px-1">supplier</code> (required), country, city, platform, website, contact_name, contact_email,
                capabilities, certifications_claimed, product, moq, unit_price, currency, sample_cost, lead_time_days, incoterm, est_freight_per_unit, quote_date, notes.
              </p>
            </CsvImportCard>
          </div>
          <Card>
            <CardHeader title="Sourcing integrations" icon={<Plug className="h-4 w-4" />} />
            <CardBody className="space-y-3">
              {integrations.loading && !integrations.data && <Spinner />}
              {sourcingIntegrations.map((i) => (
                <div key={i.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{i.name}</span>
                    {i.state === "planned" ? <PlannedBadge /> : <Badge tone="green">{titleCase(i.state)}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{i.detail}</p>
                </div>
              ))}
              <p className="text-xs text-slate-500">Today, add suppliers manually or by CSV. Future integrations will use authorized partner APIs only.</p>
            </CardBody>
          </Card>
        </div>
      )}

      <SupplierFormModal open={formOpen} onClose={() => setFormOpen(false)} projectId={projectId} supplier={editing} labels={labels} onSaved={refreshAll} />
      <SupplierDetailModal
        supplierId={detailId}
        projectId={projectId}
        labels={labels}
        onClose={() => setDetailId(null)}
        onChanged={refreshAll}
        onEdit={(s) => {
          setDetailId(null);
          openEdit(s);
        }}
      />
    </div>
  );
}
