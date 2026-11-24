"use client";

import { Factory, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { CsvImportCard } from "@/components/competitors/csv-import";
import { SupplierComparison } from "@/components/suppliers/comparison";
import { QualityStars, SupplierDetailModal, SupplierFormModal, SupplierVerificationBadge, fmtMoney } from "@/components/suppliers/supplier-modals";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ExternalLink, PageHeader, PlannedBadge, ProductThumb, Spinner, Tabs, Td, Th } from "@/components/ui";
import { del, errorText } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { domainOf, titleCase } from "@/lib/format";
import { useT } from "@/lib/i18n";
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
  const { t, tx, tr } = useT();
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
    if (!window.confirm(t("Delete {name} with all of its quotes and communication history? This cannot be undone.", { name: s.name }))) return;
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
        title={t("Supplier Intelligence")}
        description={t("Compare manufacturers on MOQ, unit price, samples, lead time and landed cost. Verification levels are set only by you - nothing here is presented as vetted or certified.")}
        actions={
          <Button onClick={() => openEdit(null)}>
            <Plus className="h-4 w-4" aria-hidden /> {t("Add supplier")}
          </Button>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "list", label: `${t("Suppliers")}${data ? ` (${data.length})` : ""}` },
          { value: "compare", label: t("Comparison & landed cost") },
          { value: "import", label: t("Import & integrations") },
        ]}
      />

      {tab === "list" && (
        <Card>
          <CardHeader title={t("Supplier records")} subtitle={t("Click a supplier to manage quotes, communication history and RFQ drafts.")} icon={<Factory className="h-4 w-4" />} />
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
              title={t("No suppliers yet")}
              action={
                <div className="flex gap-2">
                  <Button onClick={() => openEdit(null)}>{t("Add supplier")}</Button>
                  <Button variant="secondary" onClick={() => setTab("import")}>
                    {t("Import CSV")}
                  </Button>
                </div>
              }
            >
              {t("Record manufacturers you are evaluating along with their quotes. Landed-cost comparison updates automatically.")}
            </EmptyState>
          )}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-slate-200 bg-slate-50/60">
                  <tr>
                    <Th>{t("Supplier")}</Th>
                    <Th>{t("Where")}</Th>
                    <Th>{t("Status")}</Th>
                    <Th>{t("Certifications")}</Th>
                    <Th>{t("Quotes")}</Th>
                    <Th>{t("Source")}</Th>
                    <Th className="text-right">{t("Actions")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((s) => {
                    const usdPrices = s.quotes.filter((q) => q.unit_price !== null && q.currency === "USD").map((q) => q.unit_price as number);
                    const best = usdPrices.length ? Math.min(...usdPrices) : null;
                    const pictured = s.quotes.find((q) => q.image_url);
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/50">
                        <Td className="min-w-[11rem]">
                          <div className="flex items-start gap-2.5">
                            {pictured && <ProductThumb src={pictured.image_url} href={pictured.source_url} alt={pictured.product_name} size={44} />}
                            <div className="min-w-0">
                              <button onClick={() => setDetailId(s.id)} className="text-left font-medium text-slate-900 hover:text-primary-800 hover:underline">
                                {s.name}
                              </button>
                              {s.website && (
                                <div className="text-xs">
                                  <ExternalLink href={s.website}>{domainOf(s.website)}</ExternalLink>
                                </div>
                              )}
                              {s.capabilities.length > 0 && <div className="mt-0.5 max-w-xs break-words text-xs text-slate-500">{s.capabilities.join(", ")}</div>}
                            </div>
                          </div>
                        </Td>
                        <Td className="text-xs">
                          <div className="text-slate-700">{platformLabel(s.platform)}</div>
                          <div className="text-slate-500">{[s.city, s.country].filter(Boolean).join(", ") || t("Location not given")}</div>
                        </Td>
                        <Td>
                          <SupplierVerificationBadge status={s.verification_status} labels={labels} />
                          <div className="mt-1"><QualityStars rating={s.quality_rating} /></div>
                        </Td>
                        <Td className="max-w-[12rem] text-xs text-slate-600">
                          {s.certifications_claimed.length ? (
                            <span title={t("Claimed by the supplier; not verified")}>
                              {tr("Claimed: {list} {note}", { list: s.certifications_claimed.join(", "), note: <span className="text-slate-400">{t("(not verified)")}</span> })}
                            </span>
                          ) : (
                            <span className="text-slate-400">{t("None claimed")}</span>
                          )}
                        </Td>
                        <Td className="text-xs">
                          {s.quotes.length}
                          {best !== null ? <div className="text-slate-500">{t("from {price}/unit", { price: fmtMoney(best) })}</div> : (() => {
                            const listing = s.quotes.find((q) => q.source_url)?.source_url;
                            return listing && <div className="text-slate-500">{tr("Price not shown - {link}", { link: <ExternalLink href={listing}>{t("open listing")}</ExternalLink> })}</div>;
                          })()}
                        </Td>
                        <Td>
                          <Badge tone={s.source === "csv" ? "blue" : "slate"}>{s.source === "csv" ? t("CSV import") : titleCase(s.source)}</Badge>
                        </Td>
                        <Td className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setDetailId(s.id)}>
                            {t("Open")}
                          </Button>
                          <button onClick={() => openEdit(s)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={t("Edit {name}", { name: s.name })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(s)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={t("Delete {name}", { name: s.name })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          </div>
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
        <div className="grid gap-5">
          <div >
            <CsvImportCard
              title={t("Import suppliers & quotes")}
              description={t("One row per quote. Rows with the same supplier name are merged. Imported suppliers always start as Unverified.")}
              templateKind="suppliers"
              uploadPath={`/api/projects/${projectId}/suppliers/import`}
              onDone={refreshAll}
            >
              <p className="text-xs text-slate-600">
                {tr("Columns: {supplier} (required), {columns}.", {
                  supplier: <code className="rounded bg-slate-100 px-1">supplier</code>,
                  columns:
                    "country, city, platform, website, contact_name, contact_email, capabilities, certifications_claimed, product, moq, unit_price, currency, sample_cost, lead_time_days, incoterm, est_freight_per_unit, quote_date, notes",
                })}
              </p>
            </CsvImportCard>
          </div>
          <Card>
            <CardHeader title={t("Sourcing integrations")} icon={<Plug className="h-4 w-4" />} />
            <CardBody className="space-y-3">
              {integrations.loading && !integrations.data && <Spinner />}
              {sourcingIntegrations.map((i) => (
                <div key={i.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{i.name}</span>
                    {i.state === "planned" ? <PlannedBadge /> : <Badge tone="green">{titleCase(i.state)}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{tx(i.detail)}</p>
                </div>
              ))}
              <p className="text-xs text-slate-500">{t("Today, add suppliers manually or by CSV. Future integrations will use authorized partner APIs only.")}</p>
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
