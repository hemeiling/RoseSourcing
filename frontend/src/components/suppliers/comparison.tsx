"use client";

import { Scale, Trophy } from "lucide-react";
import { useEffect } from "react";
import { errorText } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { ComparisonRow } from "@/lib/types";
import { date, domainOf, money, num, titleCase } from "@/lib/format";
import { useT, type MsgKey } from "@/lib/i18n";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, ExternalLink, Spinner, Td, Th } from "@/components/ui";
import { QualityStars, SupplierVerificationBadge, fmtMoney } from "./supplier-modals";

const PARTS: [string, MsgKey][] = [
  ["factory_cost", "Factory"],
  ["freight", "Freight"],
  ["duty", "Duty"],
  ["shipment_fees", "Shipment fees"],
  ["clearance", "Clearance"],
  ["packaging", "Packaging"],
];

export function SupplierComparison({ projectId, labels, version }: { projectId: string; labels: Record<string, string> | undefined; version: number }) {
  const { t, tx } = useT();
  const { data, error, loading, reload } = useApi<{ rows: ComparisonRow[] }>(`/api/projects/${projectId}/suppliers/comparison`);
  useEffect(() => {
    if (version) reload();
  }, [version, reload]);

  const rows = data?.rows ?? [];
  const lowestId = rows.find((r) => r.landed_cost)?.quote_id;

  return (
    <Card>
      <CardHeader
        title={t("Supplier quote comparison")}
        subtitle={t("Sorted by estimated landed cost per unit (factory + freight + duty + clearance + packaging).")}
        icon={<Scale className="h-4 w-4" />}
      />
      <CardBody className="space-y-3">
        <Alert tone="blue">
          {t(
            "Where a quote has no freight estimate, freight comes from your latest cost scenario; duty, clearance and packaging always do. Those values may be assumptions - check the notes on each row. Verification status is set by you; “Unverified” means no checks have been done.",
          )}
        </Alert>
        {loading && !data && <Spinner />}
        {error && <Alert tone="red">{errorText(error)}</Alert>}
        {data && rows.length === 0 && <EmptyState title={t("No quotes to compare")}>{t("Add suppliers and their quotes, or import them from CSV.")}</EmptyState>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="border-b border-slate-200 bg-slate-50/60">
                <tr>
                  <Th>{t("Supplier")}</Th>
                  <Th>{t("Product")}</Th>
                  <Th>{t("Unit price")}</Th>
                  <Th>{t("MOQ")}</Th>
                  <Th>{t("Sample")}</Th>
                  <Th>{t("Lead time")}</Th>
                  <Th>{t("Incoterm")}</Th>
                  <Th>{t("Landed cost / unit")}</Th>
                  <Th>{t("MOQ total (landed)")}</Th>
                  <Th>{t("Budget")}</Th>
                  <Th>{t("Notes")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const lc = r.landed_cost;
                  const breakdown = lc ? PARTS.map(([k, label]) => `${t(label)} ${money(lc[k] ?? 0, { decimals: 2 })}`).join(" + ") : "";
                  return (
                    <tr key={r.quote_id} className={r.quote_id === lowestId ? "bg-slate-50" : undefined}>
                      <Td>
                        <div className="font-medium text-slate-900">
                          {r.website ? <ExternalLink href={r.website}>{r.supplier_name}</ExternalLink> : r.supplier_name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <SupplierVerificationBadge status={r.verification_status} labels={labels} />
                          <QualityStars rating={r.quality_rating} />
                        </div>
                        <div className="text-[11px] text-slate-400">{[r.country, r.platform ? titleCase(r.platform) : null].filter(Boolean).join(" · ")}</div>
                      </Td>
                      <Td>
                        {r.source_url ? <ExternalLink href={r.source_url}>{r.product_name}</ExternalLink> : r.product_name}
                        {r.source_url && <div className="text-[11px] text-slate-400">{t("listing on {domain}", { domain: domainOf(r.source_url) })}</div>}
                        {r.quote_date && <div className="text-[11px] text-slate-400">{t("quoted {date}", { date: date(r.quote_date) })}</div>}
                      </Td>
                      <Td className="whitespace-nowrap">{fmtMoney(r.unit_price, r.currency)}</Td>
                      <Td>{num(r.moq)}</Td>
                      <Td className="whitespace-nowrap">{fmtMoney(r.sample_cost, r.currency)}</Td>
                      <Td className="whitespace-nowrap">{r.lead_time_days !== null ? t("{n} d", { n: r.lead_time_days }) : "-"}</Td>
                      <Td>{r.incoterm ?? "-"}</Td>
                      <Td className="whitespace-nowrap">
                        {lc ? (
                          <span title={breakdown}>
                            <span className="font-semibold text-slate-900">{money(lc.landed_cost, { decimals: 2 })}</span>
                            {r.quote_id === lowestId && (
                              <Badge tone="green" className="ml-1.5" title={t("Lowest estimate given current assumptions")}>
                                <Trophy className="h-3 w-3" aria-hidden /> {t("Lowest*")}
                              </Badge>
                            )}
                            <div className="max-w-[14rem] whitespace-normal text-[11px] text-slate-500">{breakdown}</div>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">{t("Not computed")}</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{r.moq_landed_cost_total !== null ? money(r.moq_landed_cost_total, { decimals: 0 }) : "-"}</Td>
                      <Td>
                        {r.within_budget === null ? (
                          <span className="text-xs text-slate-400">-</span>
                        ) : r.within_budget ? (
                          <Badge tone="green">{t("Within budget")}</Badge>
                        ) : (
                          <Badge tone="red">{t("Exceeds budget")}</Badge>
                        )}
                      </Td>
                      <Td>
                        <ul className="max-w-xs space-y-0.5 text-[11px] text-slate-600">
                          {r.notes.map((n, i) => (
                            <li key={i}>{tx(n)}</li>
                          ))}
                        </ul>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {lowestId && (
          <p className="text-xs text-slate-500">
            {t(
              "* Lowest landed cost under the current freight/duty assumptions only. It says nothing about quality or reliability - confirm samples, documents and duty classification before committing.",
            )}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
