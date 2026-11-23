"use client";

import { BarChart3, Compass, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiError, errorText, post } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { date, dateTime, domainOf, money, titleCase } from "@/lib/format";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, EmptyState, ExternalLink, Spinner, Td, Th } from "@/components/ui";
import { VerificationBadge } from "@/components/evidence";
import { fmtPrice } from "./competitor-modals";

// ----------------------------------------------------------------------------- price comparison

type PriceRow = {
  competitor: string;
  competitor_id: string;
  product: string;
  price: number;
  currency: string;
  observed_at: string;
  source_url: string | null;
  source_type: string;
  verification_status: string;
  observations: number;
  on_watchlist: boolean;
};
type PriceComparison = {
  rows: PriceRow[];
  usd_stats: { count: number; min: number; max: number; median: number } | null;
  price_hypothesis: { min: number; max: number } | null;
};

const VERIFY_COLOR: Record<string, string> = { source_linked: "#6a48a3", human_verified: "#16a34a", unverified: "#cfc1e6", disputed: "#dc2626" };

export function PriceComparisonCard({ projectId, version }: { projectId: string; version: number }) {
  const { data, error, loading, reload } = useApi<PriceComparison>(`/api/projects/${projectId}/competitors/price-comparison`);
  useEffect(() => {
    if (version) reload();
  }, [version, reload]);

  const usdRows = useMemo(() => (data?.rows ?? []).filter((r) => r.currency === "USD").map((r) => ({ ...r, label: `${r.competitor} – ${r.product}` })), [data]);
  const nonUsd = (data?.rows.length ?? 0) - usdRows.length;
  const hyp = data?.price_hypothesis;

  return (
    <Card>
      <CardHeader
        title="Price comparison"
        subtitle="Latest observed price per competitor product. Colors show how each price was verified."
        icon={<BarChart3 className="h-4 w-4" />}
      />
      <CardBody className="space-y-4">
        {loading && !data && <Spinner />}
        {error && <Alert tone="red">{errorText(error)}</Alert>}
        {data && data.rows.length === 0 && (
          <EmptyState title="No price observations yet">Discover competitors with AI research, import a CSV, or add prices manually from a competitor&apos;s detail view.</EmptyState>
        )}
        {data && data.rows.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  ["Observed (USD)", data.usd_stats ? String(data.usd_stats.count) : "0"],
                  ["Min", data.usd_stats ? money(data.usd_stats.min) : "-"],
                  ["Median", data.usd_stats ? money(data.usd_stats.median) : "-"],
                  ["Max", data.usd_stats ? money(data.usd_stats.max) : "-"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-[11px] font-medium text-slate-500">{k}</div>
                  <div className="text-lg font-semibold text-slate-900">{v}</div>
                </div>
              ))}
            </div>
            {hyp && (
              <p className="text-xs text-slate-600">
                Shaded band: your price hypothesis {money(hyp.min, { decimals: 0 })}-{money(hyp.max, { decimals: 0 })} (an assumption to test, not market data).
              </p>
            )}
            {nonUsd > 0 && <p className="text-xs text-amber-800">{nonUsd} non-USD observation(s) are excluded from the chart and statistics (no FX conversion is applied).</p>}
            {usdRows.length > 0 && (
              <div style={{ height: Math.max(180, usdRows.length * 34 + 50) }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={usdRows} layout="vertical" margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" tickFormatter={(v: number) => `$${v}`} tick={{ fontSize: 11 }} domain={[0, "auto"]} />
                    <YAxis type="category" dataKey="label" width={210} tick={{ fontSize: 11 }} interval={0} />
                    {hyp && <ReferenceArea x1={hyp.min} x2={hyp.max} fill="#4e2a84" fillOpacity={0.08} stroke="#4e2a84" strokeOpacity={0.3} />}
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const r = payload[0].payload as PriceRow & { label: string };
                        return (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                            <div className="font-medium text-slate-900">{r.label}</div>
                            <div>{money(r.price)} · observed {date(r.observed_at)}</div>
                            <div className="text-slate-500">
                              {titleCase(r.verification_status)} · {titleCase(r.source_type)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="price" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {usdRows.map((r) => (
                        <Cell key={`${r.competitor_id}-${r.product}`} fill={VERIFY_COLOR[r.verification_status] ?? "#94a3b8"} />
                      ))}
                      <LabelList dataKey="price" position="right" formatter={(v: unknown) => (typeof v === "number" ? `$${v.toFixed(0)}` : "")} style={{ fontSize: 11, fill: "#334155" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
              {Object.entries(VERIFY_COLOR).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {titleCase(k)}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-slate-200">
                  <tr>
                    <Th>Competitor</Th>
                    <Th>Product</Th>
                    <Th>Latest price</Th>
                    <Th>Observed</Th>
                    <Th>Source</Th>
                    <Th>Verification</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r) => (
                    <tr key={`${r.competitor_id}-${r.product}`}>
                      <Td className="font-medium text-slate-900">
                        {r.competitor}
                        {r.on_watchlist && <span className="ml-1 text-slate-500" title="On watchlist">★</span>}
                      </Td>
                      <Td>
                        {r.product}
                        {r.observations > 1 && <div className="text-[11px] text-slate-400">{r.observations} observations</div>}
                      </Td>
                      <Td className="whitespace-nowrap font-medium">{fmtPrice(r.price, r.currency)}</Td>
                      <Td className="whitespace-nowrap text-xs">{date(r.observed_at)}</Td>
                      <Td className="text-xs">
                        {r.source_url ? <ExternalLink href={r.source_url}>{domainOf(r.source_url)}</ExternalLink> : <span className="text-slate-400">no link</span>}
                        <div className="text-slate-400">{titleCase(r.source_type)}</div>
                      </Td>
                      <Td>
                        <VerificationBadge status={r.verification_status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- positioning

type Position = {
  name: string;
  price_position: number;
  specialization: number;
  basis: "observed_prices" | "stated_positioning" | "inference";
  rationale: string;
};
type PositioningContent = { summary: string; positions: Position[]; white_space: string[]; differentiation_options: string[]; caveats: string[] };
type Snapshot = { id: string; created_at: string; content: PositioningContent };

const BASIS: Record<Position["basis"], { label: string; color: string }> = {
  observed_prices: { label: "Observed prices", color: "#261343" },
  stated_positioning: { label: "Stated positioning", color: "#6a48a3" },
  inference: { label: "AI inference", color: "#cfc1e6" },
};

export function PositioningCard({ projectId, hasCompetitors }: { projectId: string; hasCompetitors: boolean }) {
  const { data, error, loading, setData } = useApi<Snapshot | null>(`/api/projects/${projectId}/competitors/positioning`);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setRunError(null);
    setConfigMsg(null);
    try {
      setData(await post<Snapshot>(`/api/projects/${projectId}/competitors/positioning`));
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else setRunError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Nudge overlapping points apart so every label stays readable.
  const points = useMemo(() => {
    const seen = new Map<string, number>();
    return (data?.content.positions ?? []).map((p) => {
      const key = `${p.price_position}-${p.specialization}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      return { ...p, x: p.price_position + n * 0.12, y: p.specialization - n * 0.12 };
    });
  }, [data]);

  const c = data?.content;
  return (
    <Card>
      <CardHeader
        title="Positioning analysis"
        subtitle="AI analysis of your stored competitor records - not independent market data."
        icon={<Compass className="h-4 w-4" />}
        actions={
          <Button size="sm" onClick={run} loading={busy} disabled={!hasCompetitors}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {data ? "Re-run analysis" : "Run analysis"}
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {!hasCompetitors && <p className="text-sm text-slate-500">Add or discover competitors first - the analysis only uses records you have stored.</p>}
        {configMsg && <ConfigNotice message={configMsg} />}
        {runError && <Alert tone="red">{runError}</Alert>}
        {loading && data === undefined && <Spinner />}
        {error && <Alert tone="red">{errorText(error)}</Alert>}
        {data === null && hasCompetitors && !busy && <p className="text-sm text-slate-500">No analysis yet. Run one to map competitors by price position and specialization.</p>}
        {c && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge tone="violet">AI analysis</Badge> generated {dateTime(data!.created_at)}
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{c.summary}</p>
            {points.length > 0 && (
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Price position"
                      domain={[0.5, 5.5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 11 }}
                      label={{ value: "Price position (1 = lowest, 5 = highest)", position: "bottom", offset: 10, fontSize: 11, fill: "#64748b" }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Specialization"
                      domain={[0.5, 5.5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 11 }}
                      label={{ value: "Specialization", angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b" }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as Position;
                        return (
                          <div className="max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                            <div className="font-medium text-slate-900">{p.name}</div>
                            <div className="text-slate-500">
                              Price {p.price_position}/5 · Specialization {p.specialization}/5 · basis: {BASIS[p.basis]?.label ?? p.basis}
                            </div>
                            <div className="mt-1 text-slate-700">{p.rationale}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={points}>
                      {points.map((p) => (
                        <Cell key={p.name} fill={BASIS[p.basis]?.color ?? "#64748b"} />
                      ))}
                      <LabelList dataKey="name" position="top" style={{ fontSize: 11, fill: "#334155" }} />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
              <span className="font-medium">Basis of each position:</span>
              {Object.values(BASIS).map((b) => (
                <span key={b.label} className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} /> {b.label}
                </span>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <ListBlock title="White space" items={c.white_space} />
              <ListBlock title="Differentiation options" items={c.differentiation_options} />
              <ListBlock title="Caveats & data gaps" items={c.caveats} tone="amber" />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone?: "amber" }) {
  return (
    <div className={tone === "amber" ? "rounded-lg border border-amber-200 bg-amber-50/60 p-3" : "rounded-lg border border-slate-200 p-3"}>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h4>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">None noted.</p>
      )}
    </div>
  );
}
