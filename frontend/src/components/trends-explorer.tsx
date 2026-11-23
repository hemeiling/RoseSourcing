"use client";

import { Search, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Button, Card, CardBody, CardHeader, ExternalLink, Field, Input, Select, Spinner } from "@/components/ui";
import { errorText, post } from "@/lib/api";
import { date as fmtDate, monthYear } from "@/lib/format";
import { useApi } from "@/lib/hooks";

// Categorical slots 1-5 (validated for colour-vision deficiency on white). Each line is also named in the legend and table.
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

type Ranked = { name: string; type: string | null; value: string; score: number | null; link: string | null };
type Related = { queries: { top: Ranked[]; rising: Ranked[] }; topics: { top: Ranked[]; rising: Ranked[] }; retrieved_at: string };
type Explore = {
  terms: string[]; date: string; range_label: string; geo: string; url: string;
  dates: string[]; series: Record<string, (number | null)[]>; partial: boolean[]; averages: Record<string, number | null>;
  regions: { location: string; geo: string; values: Record<string, number> }[]; region_mode: "interest" | "share";
  related: Record<string, Related>; serpapi_calls: number; retrieved_at: string;
};
type TrendsState = { snapshot: { id: string; content: Explore; created_at: string } | null; suggested_terms: string[]; ranges: Record<string, string> };

const GEOS: [string, string][] = [["US", "United States"], ["", "Worldwide"], ["CA", "Canada"], ["GB", "United Kingdom"], ["AU", "Australia"]];

function RankedList({ title, items, rising }: { title: string; items: Ranked[]; rising?: boolean }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      {items.length === 0 ? <p className="text-sm text-slate-400">Not enough data.</p> : (
        <ol className="space-y-1 text-sm">
          {items.slice(0, 12).map((x, i) => (
            <li key={x.name + i} className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
              <span className="min-w-0 flex-1 text-ink">{x.name}{x.type && <span className="text-xs text-slate-500"> · {x.type}</span>}</span>
              <span className={`shrink-0 text-xs tabular-nums ${rising ? "font-semibold text-green-700" : "text-slate-600"}`}>{x.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Google Trends, as on trends.google.com/explore: compare phrases over time, by region, and their related searches and topics. */
export function TrendsExplorer({ projectId }: { projectId: string }) {
  const state = useApi<TrendsState>(`/api/projects/${projectId}/trends`);
  const [data, setData] = useState<Explore | null>(null);
  const [terms, setTerms] = useState("");
  const [range, setRange] = useState("today 5-y");
  const [geo, setGeo] = useState("US");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [relTerm, setRelTerm] = useState<string | null>(null);
  const [allRegions, setAllRegions] = useState(false);

  useEffect(() => {
    if (!state.data) return;
    const snap = state.data.snapshot?.content ?? null;
    setData(snap);
    setTerms((snap?.terms ?? state.data.suggested_terms).join(", "));
    if (snap) { setRange(snap.date); setGeo(snap.geo); setRelTerm(snap.terms[0]); }
  }, [state.data]);

  const compare = async () => {
    const list = terms.split(",").map((t) => t.trim()).filter(Boolean);
    if (!list.length) return setErr("Enter at least one search phrase.");
    if (list.length > 5) return setErr("Google Trends compares up to 5 phrases at a time.");
    setBusy("compare"); setErr(null);
    try {
      const r = await post<{ content: Explore }>(`/api/projects/${projectId}/trends`, { terms: list, date: range, geo });
      setData(r.content); setRelTerm(r.content.terms[0]); setAllRegions(false);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };
  const loadRelated = async (term: string) => {
    setBusy(term); setErr(null);
    try { const r = await post<{ content: Explore }>(`/api/projects/${projectId}/trends/related`, { term }); setData(r.content); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };

  const chart = useMemo(() => data ? data.dates.map((d, i) => ({ d, ...Object.fromEntries(data.terms.map((t) => [t, data.series[t]?.[i] ?? null])) })) : [], [data]);
  const regions = useMemo(() => {
    if (!data) return [];
    const first = data.terms[0];
    return [...data.regions].sort((a, b) => (b.values[first] ?? 0) - (a.values[first] ?? 0));
  }, [data]);
  const shownRegions = allRegions ? regions : regions.slice(0, 12);
  const rel = data && relTerm ? data.related[relTerm] : undefined;

  if (state.loading && !state.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_11rem_auto] md:items-end">
            <Field label="Search phrases (up to 5, comma-separated)">
              <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. headband, yoga sock, facial mask" />
            </Field>
            <Field label="Time range">
              <Select value={range} onChange={(e) => setRange(e.target.value)}>
                {Object.entries(state.data?.ranges ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Region">
              <Select value={geo} onChange={(e) => setGeo(e.target.value)}>
                {GEOS.map(([k, v]) => <option key={k || "world"} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Button onClick={compare} loading={busy === "compare"}><Search className="h-4 w-4" /> Compare</Button>
          </div>
          <p className="text-xs text-slate-500">Each comparison uses 2 SerpApi searches; related searches for a phrase use 2 more. Results are saved with this product.</p>
          {err && <Alert tone="red">{err}</Alert>}
        </CardBody>
      </Card>

      {data && (
        <>
          <Card>
            <CardHeader icon={<TrendingUp className="h-4 w-4" />} title="Interest over time"
              subtitle={<>{data.range_label}, {GEOS.find(([k]) => k === data.geo)?.[1] ?? data.geo}. 100 = the busiest point for the most-searched phrase; values are relative, not search volumes. Retrieved {fmtDate(data.retrieved_at)} · <ExternalLink href={data.url}>Open in Google Trends</ExternalLink></>} />
            <CardBody className="space-y-3">
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" aria-label="Phrases and their average interest">
                {data.terms.map((t, i) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="h-0.5 w-5 rounded" style={{ background: COLORS[i], height: 3 }} aria-hidden />
                    <span className="text-ink">{t}</span>
                    <span className="text-slate-500">avg {data.averages[t] ?? "-"}</span>
                  </li>
                ))}
              </ul>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="d" tick={{ fontSize: 11, fill: "#64748b" }} interval="preserveStartEnd" minTickGap={56}
                      tickFormatter={monthYear} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <Tooltip cursor={{ stroke: "#94a3b8" }}
                      content={({ active, payload, label }) => active && payload?.length ? (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                          <div className="mb-1 text-slate-500">{label}</div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)} className="flex items-center gap-2">
                              <span className="inline-block h-0.5 w-3" style={{ background: p.color, height: 3 }} />
                              <span className="text-slate-700">{String(p.dataKey)}</span>
                              <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{p.value as number}</span>
                            </div>
                          ))}
                        </div>
                      ) : null} />
                    {data.terms.map((t, i) => (
                      <Line key={t} type="monotone" dataKey={t} stroke={COLORS[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {data.partial.some(Boolean) && <p className="text-xs text-slate-500">The last point is partial: Google is still collecting data for it.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={data.region_mode === "share" ? "Compared breakdown by region" : "Interest by region"}
              subtitle={data.region_mode === "share"
                ? "In each region, how searches split between the phrases (each row adds up to 100%)."
                : "Where this phrase is most popular, as a share of all searches in each region (100 = the highest)."} />
            <CardBody className="space-y-2">
              {regions.length === 0 ? <p className="text-sm text-slate-500">Not enough search volume for a regional breakdown.</p> : (
                <>
                  <ul className="space-y-1.5 text-sm">
                    {shownRegions.map((r) => (
                      <li key={r.geo || r.location} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                        <span className="break-words text-ink">{r.location}</span>
                        <div className="flex h-3 overflow-hidden rounded bg-slate-100" role="img"
                          aria-label={data.terms.map((t) => `${t} ${r.values[t] ?? 0}`).join(", ")}>
                          {data.terms.map((t, i) => {
                            const v = r.values[t] ?? 0;
                            return v > 0 ? <span key={t} style={{ width: `${v}%`, background: COLORS[i] }} className="h-full border-r-2 border-white last:border-r-0" /> : null;
                          })}
                        </div>
                        <span className="col-span-2 text-xs tabular-nums text-slate-600 sm:col-span-1">
                          {data.terms.map((t) => `${r.values[t] ?? 0}${data.region_mode === "share" ? "%" : ""}`).join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {regions.length > 12 && (
                    <button className="text-sm font-semibold text-primary-700 hover:underline" onClick={() => setAllRegions(!allRegions)}>
                      {allRegions ? "Show top 12" : `Show all ${regions.length} regions`}
                    </button>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Related searches and topics" subtitle="What else people search for with each phrase. Rising = biggest growth in the period ('Breakout' = more than 5,000%)." />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Phrase">
                {data.terms.map((t, i) => (
                  <button key={t} role="tab" aria-selected={relTerm === t} onClick={() => setRelTerm(t)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${relTerm === t ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300"}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} aria-hidden />{t}
                  </button>
                ))}
              </div>
              {relTerm && !rel && (
                <Button size="sm" variant="secondary" onClick={() => loadRelated(relTerm)} loading={busy === relTerm}>Load related searches for “{relTerm}”</Button>
              )}
              {rel && (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                  <RankedList title="Top searches" items={rel.queries.top} />
                  <RankedList title="Rising searches" items={rel.queries.rising} rising />
                  <RankedList title="Top topics" items={rel.topics.top} />
                  <RankedList title="Rising topics" items={rel.topics.rising} rising />
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
