"use client";

import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { Badge, Card, CardBody, CardHeader, Select, Spinner, StatCard, Td, Th, type Tone } from "./ui";
import { date, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT } from "@/lib/i18n";

type Usage = {
  period: "30d" | "all";
  totals: { calls: number; cost_usd: number; input_tokens: number; output_tokens: number; cached_tokens: number; cached_share_pct: number | null; search_requests: number };
  by_product: { project_id: string | null; name: string; calls: number; cost_usd: number }[];
  by_agent: { agent: string; label: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number; search_requests: number }[];
  by_day: { date: string; cost_usd: number; calls: number }[];
  recent: { id: string; product: string; agent_label: string; operation: string; status: string; model: string | null; input_tokens: number;
    output_tokens: number; cache_read_tokens: number; cost_usd: number; started_at: string }[];
  products: { id: string; name: string }[];
  note: string;
};

/** One slot per day (days without calls at $0), so a single busy day does not fill the whole chart. */
function timeline(rows: Usage["by_day"], period: "30d" | "all"): Usage["by_day"] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const end = new Date();
  const start = period === "30d" || !rows.length ? new Date(end.getTime() - 29 * 86400000) : new Date(`${rows[0].date}T00:00:00Z`);
  const out: Usage["by_day"] = [];
  for (let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); t <= end.getTime() && out.length < 120; t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(key) ?? { date: key, cost_usd: 0, calls: 0 });
  }
  return out.slice(-120);
}

const STATUS_TONE: Record<string, Tone> = { succeeded: "green", failed: "red", running: "blue" };
const usd = (v: number) => money(v, { decimals: v > 0 && v < 1 ? 3 : 2 });

/** What the AI has cost across every product (or one): totals, a daily chart, by product, by agent, and every call. */
export function UsageDashboard() {
  const { t, tx } = useT();
  const [period, setPeriod] = useState<"30d" | "all">("30d");
  const [product, setProduct] = useState("");
  const [shown, setShown] = useState(15);
  const u = useApi<Usage>(`/api/usage?period=${period}${product ? `&project_id=${product}` : ""}&limit=200`);
  const d = u.data;
  const days = timeline(d?.by_day ?? [], period);
  const maxDay = Math.max(0.0001, ...days.map((x) => x.cost_usd));
  const maxProduct = Math.max(0.0001, ...(d?.by_product ?? []).map((x) => x.cost_usd));

  return (
    <Card>
      <CardHeader title={t("Usage")} icon={<BarChart3 className="h-4 w-4" />} subtitle={d?.note ? tx(d.note) : t("What the AI has cost, across your products.")}
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select aria-label={t("Period")} value={period} onChange={(e) => setPeriod(e.target.value as "30d" | "all")} className="h-8 py-0!">
                <option value="30d">{t("Last 30 days")}</option>
                <option value="all">{t("All time")}</option>
              </Select>
            </div>
            <div className="w-56">
              <Select aria-label={t("Product")} value={product} onChange={(e) => setProduct(e.target.value)} className="h-8 py-0!">
                <option value="">{t("All products")}</option>
                {(d?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
          </div>
        } />
      {!d ? <CardBody><Spinner /></CardBody> : (
        <CardBody className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("AI spend")} value={usd(d.totals.cost_usd)} hint={period === "30d" ? t("last 30 days") : t("all time")} />
            <StatCard label={t("AI calls")} value={num(d.totals.calls)} hint={t("{n} tokens written", { n: num(d.totals.output_tokens) })} />
            <StatCard label={t("Web searches")} value={num(d.totals.search_requests)} hint={t("by the research agents")} />
            <StatCard label={t("Read from cache")} value={d.totals.cached_share_pct === null ? "-" : `${d.totals.cached_share_pct}%`}
              hint={t("{n} input tokens at a fraction of the price", { n: num(d.totals.cached_tokens) })} />
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("Daily spend")}</h3>
            {d.totals.calls === 0 ? <p className="text-xs text-slate-500">{t("No AI calls in this period.")}</p> : (
              <>
                <div className="flex h-24 items-end gap-0.5 border-b border-line" role="img" aria-label={t("AI spend per day")}>
                  {days.map((x) => (
                    <div key={x.date} className="flex h-full flex-1 items-end" title={t("{date}: {cost} ({n} calls)", { date: date(x.date), cost: usd(x.cost_usd), n: x.calls })}>
                      <div className="w-full rounded-t-sm bg-primary-300 hover:bg-primary-500" style={{ height: x.cost_usd ? `${Math.max(3, (100 * x.cost_usd) / maxDay)}%` : "1px" }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>{date(days[0].date)}</span><span>{t("Highest day {cost}", { cost: usd(maxDay) })}</span><span>{date(days[days.length - 1].date)}</span>
                </div>
              </>
            )}
          </section>

          {!product && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink">{t("By product")}</h3>
              <ul className="space-y-1.5">
                {d.by_product.map((p) => (
                  <li key={p.project_id ?? "none"} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_5rem] items-center gap-3 text-sm">
                    <button className="text-left text-primary-700 hover:underline disabled:text-slate-600 disabled:no-underline" disabled={!p.project_id}
                      onClick={() => p.project_id && setProduct(p.project_id)} title={t("Show only this product")}>{p.name === "No product" ? t("No product") : p.name}</button>
                    <span className="h-2.5 rounded-sm bg-canvas"><span className="block h-2.5 rounded-sm bg-primary-300" style={{ width: `${(100 * p.cost_usd) / maxProduct}%` }} /></span>
                    <span className="text-right font-semibold text-ink">{usd(p.cost_usd)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("By agent")}</h3>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-slate-50/60"><tr><Th>{t("Agent")}</Th><Th>{t("Calls")}</Th><Th>{t("Input tokens")}</Th><Th>{t("Output tokens")}</Th><Th>{t("Web searches")}</Th><Th className="text-right">{t("Cost")}</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {d.by_agent.map((a) => (
                    <tr key={a.agent}><Td>{tx(a.label)}</Td><Td>{a.calls}</Td><Td>{num(a.input_tokens)}</Td><Td>{num(a.output_tokens)}</Td><Td>{a.search_requests}</Td>
                      <Td className="text-right font-medium">{usd(a.cost_usd)}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("Every AI call")}</h3>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-slate-50/60">
                  <tr><Th>{t("When")}</Th><Th>{t("Product")}</Th><Th>{t("Agent")}</Th><Th>{t("Operation")}</Th><Th>{t("Status")}</Th><Th>{t("Tokens in / cached / out")}</Th><Th className="text-right">{t("Cost")}</Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.recent.slice(0, shown).map((e) => (
                    <tr key={e.id}>
                      <Td className="whitespace-nowrap text-xs">{date(e.started_at)}</Td>
                      <Td className="text-xs">{e.product === "No product" ? t("No product") : e.product}</Td>
                      <Td className="text-xs">{tx(e.agent_label)}</Td>
                      <Td className="break-all text-xs text-slate-600">{e.operation}</Td>
                      <Td><Badge tone={STATUS_TONE[e.status] ?? "slate"}>{tx(e.status)}</Badge></Td>
                      <Td className="whitespace-nowrap text-xs">{num(e.input_tokens)} / {num(e.cache_read_tokens)} / {num(e.output_tokens)}</Td>
                      <Td className="text-right text-xs font-medium">{usd(e.cost_usd)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.recent.length > shown && (
              <button onClick={() => setShown((n) => n + 25)} className="mt-2 text-xs font-semibold text-primary-700 hover:underline">
                {t("Show more ({n} more)", { n: d.recent.length - shown })}
              </button>
            )}
          </section>
        </CardBody>
      )}
    </Card>
  );
}
