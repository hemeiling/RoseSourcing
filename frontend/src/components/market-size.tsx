"use client";

import { Building2, Globe2 } from "lucide-react";
import { EvidenceBadge } from "./evidence";
import { Card, CardBody, CardHeader, ExternalLink, Spinner } from "./ui";
import { domainOf } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Competitor, Finding } from "@/lib/types";

type Figure = { value_low: number | null; value_high: number | null; unit: string };

const SCALE: Record<string, [string, number]> = { billion: ["B", 1e9], bn: ["B", 1e9], million: ["M", 1e6], mn: ["M", 1e6], thousand: ["K", 1e3] };

/** 1.2-1.5 "USD billion" -> "$1.2B-$1.5B"; other units are shown as the source stated them ("5.2% CAGR"). */
export function fmtFigure(m: Figure): string {
  const usd = /^(?:usd|us\$|\$)\s*([a-z]+)?$/i.exec(m.unit.trim());
  const suffix = usd ? (SCALE[usd[1]?.toLowerCase() ?? ""]?.[0] ?? "") : "";
  const one = (x: number) => (usd ? "$" : "") + x.toLocaleString("en-US", { maximumFractionDigits: 2 }) + suffix;
  const lo = m.value_low ?? m.value_high;
  const range = lo === null ? "?" : m.value_high !== null && m.value_high !== lo ? `${one(lo)}-${one(m.value_high)}` : one(lo);
  return usd ? range : `${range}${m.unit.trim().startsWith("%") ? "" : " "}${m.unit.trim()}`;
}

/** USD value for sorting (0 when the unit is not a USD amount). */
const usdValue = (m: Figure) => {
  const usd = /^(?:usd|us\$|\$)\s*([a-z]+)?$/i.exec(m.unit.trim());
  return usd ? (m.value_low ?? m.value_high ?? 0) * (SCALE[usd[1]?.toLowerCase() ?? ""]?.[1] ?? 1) : 0;
};

/** How big the industry and the category are, and what competitors sell - only figures a retrieved source states. */
export function MarketSizeSection({ projectId }: { projectId: string }) {
  const size = useApi<Finding[]>(`/api/projects/${projectId}/findings?section=market_size`);
  const growth = useApi<Finding[]>(`/api/projects/${projectId}/findings?section=growth`);
  const comps = useApi<Competitor[]>(`/api/projects/${projectId}/competitors`);
  if (!size.data || !growth.data || !comps.data) return <Spinner />;

  const seen = new Set<string>();
  // Size before growth, newest first within each.
  const figures = [...[...size.data].reverse(), ...[...growth.data].reverse()].filter((f) => {
    const m = f.metric;
    if (!m || (m.value_low === null && m.value_high === null) || f.evidence_type === "unavailable" || f.verification_status === "disputed") return false;
    const key = `${m.name.toLowerCase()}|${m.value_low}|${m.value_high}|${m.year}`; // the same figure from two runs shows once
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const gaps = [...size.data, ...growth.data].filter((f) => f.evidence_type === "unavailable");
  const revenues = comps.data.filter((c) => c.revenue).sort((a, b) => usdValue(b.revenue!) - usdValue(a.revenue!));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Industry & category size" icon={<Globe2 className="h-4 w-4" />}
          subtitle="From the Market Analyst. Each figure says what it covers, its year and who published it." />
        <CardBody>
          {figures.length === 0 ? (
            <p className="text-sm text-slate-500">
              No market-size figures yet. The Market Analyst looks for them (<a href="#research" className="font-semibold text-primary-700 underline">Market research</a>).
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {figures.map((f) => {
                const src = f.sources.find((s) => s.source.url)?.source;
                return (
                  <li key={f.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-lg font-semibold text-ink">{fmtFigure(f.metric!)}</span>
                      <span className="min-w-0 text-sm text-slate-700">{f.metric!.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{f.metric!.year || "Year not stated"}</span>
                      {src?.url && <><span aria-hidden>·</span><ExternalLink href={src.url}>{src.domain || domainOf(src.url)}</ExternalLink></>}
                      <EvidenceBadge type={f.evidence_type} />
                    </div>
                    {f.claim && f.claim !== f.metric!.name && <p className="mt-1 text-xs text-slate-600">{f.claim}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {gaps.length > 0 && (
            <div className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold">Not found:</span> {gaps.map((g) => g.claim).join(" · ")}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Competitor revenue" icon={<Building2 className="h-4 w-4" />}
          subtitle="From the Competitor Finder - only a figure a filing, press article or named estimate states." />
        <CardBody>
          {revenues.length === 0 ? (
            <p className="text-sm text-slate-500">
              No competitor revenue found yet. Most small brands do not publish it; competitor research saves it when a source
              states it (<a href="#brands" className="font-semibold text-primary-700 underline">Competitors</a>).
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {revenues.map((c) => {
                const r = c.revenue!;
                return (
                  <li key={c.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-lg font-semibold text-ink">{fmtFigure(r)}</span>
                      <span className="text-sm font-medium text-slate-800">{c.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{r.name}</span>
                      <span aria-hidden>·</span>
                      <span>{r.year || "Year not stated"}</span>
                      {r.source_url && <><span aria-hidden>·</span><ExternalLink href={r.source_url}>{domainOf(r.source_url)}</ExternalLink></>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
