"use client";

import { GitCompare } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EVIDENCE_META } from "@/components/evidence";
import { Badge, Card, CardBody, CardHeader, EmptyState, Td, Th } from "@/components/ui";
import { date, money, pct, titleCase } from "@/lib/format";
import type { EvidenceType, Opportunity } from "@/lib/types";
import { AttractivenessBadge, SEVERITY_TONE } from "./shared";

const MAX = 3;

export function CompareTab({ reports }: { reports: Opportunity[] | undefined }) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!reports) return;
    setSelected((cur) => {
      const valid = cur.filter((id) => reports.some((r) => r.id === id));
      return valid.length ? valid : reports.slice(0, 2).map((r) => r.id);
    });
  }, [reports]);

  if (!reports || reports.length < 2)
    return (
      <Card>
        <EmptyState icon={<GitCompare className="h-5 w-5" />} title="Need at least two reports">
          Run market research more than once (for example with a different category, market or budget) to compare reports side by side.
        </EmptyState>
      </Card>
    );

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX ? cur : [...cur, id]));
  const cols = reports.filter((r) => selected.includes(r.id));

  const rows: { label: string; render: (o: Opportunity) => ReactNode }[] = [
    { label: "Created", render: (o) => date(o.created_at) },
    { label: "Category / market", render: (o) => `${o.category} · ${o.geography}` },
    { label: "Budget", render: (o) => money(o.budget_usd) },
    { label: "Attractiveness (AI judgment)", render: (o) => <AttractivenessBadge value={o.report?.attractiveness ?? o.attractiveness} /> },
    { label: "Recommended segment", render: (o) => o.report?.recommended_segment?.name ?? <span className="text-slate-400">None</span> },
    {
      label: "Test price range",
      render: (o) =>
        o.report?.pricing?.test_price_low !== null && o.report?.pricing?.test_price_low !== undefined
          ? `${money(o.report.pricing.test_price_low)}${o.report.pricing.test_price_high !== null && o.report.pricing.test_price_high !== undefined ? ` - ${money(o.report.pricing.test_price_high)}` : ""}`
          : "-",
    },
    { label: "Contribution margin / unit", render: (o) => money(o.report?.unit_economics?.results?.contribution_margin) },
    { label: "Contribution margin %", render: (o) => pct(o.report?.unit_economics?.results?.contribution_margin_pct) },
    {
      label: "Assumption-based UE inputs",
      render: (o) => {
        const inputs = Object.values(o.report?.unit_economics?.inputs ?? {});
        if (!inputs.length) return "-";
        return `${inputs.filter((i) => i.basis === "assumption").length} of ${inputs.length}`;
      },
    },
    {
      label: "Evidence",
      render: (o) => {
        const s = o.report?.evidence_summary;
        if (!s) return "-";
        return (
          <div className="flex flex-wrap gap-1">
            {(Object.keys(EVIDENCE_META) as EvidenceType[]).map((t) => (
              <Badge key={t} tone={EVIDENCE_META[t].tone}>
                {s.by_type?.[t] ?? 0} {EVIDENCE_META[t].label.toLowerCase()}
              </Badge>
            ))}
            <Badge tone="teal">{s.source_linked} source-linked</Badge>
          </div>
        );
      },
    },
    {
      label: "Top risks",
      render: (o) => {
        const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
        const risks = [...(o.report?.risks ?? [])].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3)).slice(0, 3);
        if (!risks.length) return "-";
        return (
          <ul className="space-y-1">
            {risks.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Badge tone={SEVERITY_TONE[r.severity] ?? "slate"}>{titleCase(r.severity)}</Badge>
                <span className="text-xs">{r.risk}</span>
              </li>
            ))}
          </ul>
        );
      },
    },
    { label: "Evidence gaps", render: (o) => String(o.report?.evidence_gaps?.length ?? 0) },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Choose reports to compare" subtitle={`Select up to ${MAX}.`} />
        <CardBody className="flex flex-wrap gap-2">
          {reports.map((r) => {
            const on = selected.includes(r.id);
            const disabled = !on && selected.length >= MAX;
            return (
              <label
                key={r.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${on ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(r.id)} />
                <span className="font-medium text-slate-800">{r.title}</span>
                <span className="text-xs text-slate-500">{date(r.created_at)}</span>
              </label>
            );
          })}
        </CardBody>
      </Card>
      {cols.length < 2 ? (
        <p className="text-sm text-slate-500">Select at least two reports.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <Th className="w-48">Metric</Th>
                {cols.map((c) => (
                  <Th key={c.id} className="min-w-[14rem] normal-case tracking-normal text-slate-700">
                    {c.title}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.label}>
                  <Td className="whitespace-nowrap text-xs font-medium text-slate-500">{row.label}</Td>
                  {cols.map((c) => (
                    <Td key={c.id}>{row.render(c)}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-[11px] text-slate-500">Values come from each saved report. Attractiveness and recommendations are AI judgments; assumption-based inputs are unverified.</p>
    </div>
  );
}
