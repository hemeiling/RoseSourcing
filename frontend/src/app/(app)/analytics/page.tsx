"use client";

import clsx from "clsx";
import { AlertTriangle, Calculator, FlaskConical, Gauge, Pencil, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RequireProject } from "@/components/app-shell";
import { BASIS_META, BasisBadge } from "@/components/evidence";
import { useProjects } from "@/components/providers";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, PlannedBadge, Select, Spinner, Tabs, Td, Textarea, Th,
} from "@/components/ui";
import { del, errorText, post, put } from "@/lib/api";
import { date, money, num, pct, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Experiment, ModelSpec, PriceTarget, Scenario, UEResults } from "@/lib/types";

/** The amount at the end of each bar (left of the bar when it is negative). */
function BarValue(props: { x?: unknown; y?: unknown; width?: unknown; height?: unknown; value?: unknown }) {
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0), w = Number(props.width ?? 0), h = Number(props.height ?? 0), v = Number(props.value ?? 0);
  // Always to the right of the bar's right end (for a loss that is the $0 line), so it never covers the row names.
  return (
    <text x={Math.max(x, x + w) + 4} y={y + h / 2} dy={4} fontSize={11} fill={v < 0 ? "#b0204f" : "#334155"} fontWeight={v < 0 ? 600 : 400}>
      {money(v, { decimals: 2 })}
    </text>
  );
}

const GROUPS: { title: string; fields: string[] }[] = [
  { title: "Pricing", fields: ["retail_price", "avg_discount_pct"] },
  { title: "Product & landed cost", fields: ["factory_cost", "freight_per_unit", "shipment_fixed_costs", "units_per_shipment", "duty_rate_pct", "import_clearance_per_unit", "packaging_per_unit"] },
  { title: "Fulfillment, payments & channel fees", fields: ["fulfillment_per_unit", "payment_fee_pct", "payment_fee_fixed", "channel_commission_pct", "channel_fee_per_order", "units_per_order"] },
  { title: "Marketing & returns", fields: ["marketing_cac", "return_rate_pct", "return_cost_per_unit", "unsellable_return_pct"] },
  { title: "Budget & fixed costs", fields: ["initial_investment", "monthly_fixed_costs", "moq", "sample_costs"] },
];

const SCENARIO_TYPES = ["hypothetical", "quote_based", "actual", "research_estimate"] as const;

// Each input's name and unit: the unit is written under the name and marked inside the box ($ before, % or units after).
const FIELDS: Record<string, { label: string; unit: string; pre?: string; post?: string }> = {
  retail_price: { label: "Retail price", unit: "USD per unit", pre: "$" },
  avg_discount_pct: { label: "Average discount", unit: "% off the retail price", post: "%" },
  factory_cost: { label: "Factory cost", unit: "USD per unit", pre: "$" },
  freight_per_unit: { label: "International freight", unit: "USD per unit", pre: "$" },
  shipment_fixed_costs: { label: "Fixed cost per shipment", unit: "USD per shipment", pre: "$" },
  units_per_shipment: { label: "Units per shipment", unit: "units (0 = the MOQ)" },
  duty_rate_pct: { label: "Customs duty", unit: "% of factory cost", post: "%" },
  import_clearance_per_unit: { label: "Import clearance", unit: "USD per unit", pre: "$" },
  packaging_per_unit: { label: "Packaging", unit: "USD per unit", pre: "$" },
  fulfillment_per_unit: { label: "Domestic fulfillment", unit: "USD per unit", pre: "$" },
  payment_fee_pct: { label: "Payment fee", unit: "% of the sale price", post: "%" },
  payment_fee_fixed: { label: "Payment fee, fixed", unit: "USD per order", pre: "$" },
  channel_commission_pct: { label: "Channel commission", unit: "% of the sale price", post: "%" },
  channel_fee_per_order: { label: "Channel fee", unit: "USD per order", pre: "$" },
  units_per_order: { label: "Units per order", unit: "units" },
  marketing_cac: { label: "Marketing cost (CAC)", unit: "USD per order", pre: "$" },
  return_rate_pct: { label: "Return rate", unit: "% of units sold", post: "%" },
  return_cost_per_unit: { label: "Return cost", unit: "USD per returned unit", pre: "$" },
  unsellable_return_pct: { label: "Unsellable returns", unit: "% of returned units", post: "%" },
  monthly_fixed_costs: { label: "Monthly fixed costs", unit: "USD per month", pre: "$" },
  initial_investment: { label: "Initial investment", unit: "USD in total", pre: "$" },
  moq: { label: "Supplier MOQ", unit: "units" },
  sample_costs: { label: "Sample costs", unit: "USD in total", pre: "$" },
};

/** A number box that can be cleared and retyped: it keeps what you type and reports the number (empty = 0). */
function NumberInput({ id, value, onValue, pre, post }: { id: string; value: number; onValue: (v: number) => void; pre?: string; post?: string }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  // Follow outside changes (a loaded scenario, "Use this price") without fighting what is being typed.
  useEffect(() => {
    setText((t) => (Number(t || 0) === value ? t : String(value)));
  }, [value]);
  return (
    <div className="relative min-w-[5.5rem] flex-1">
      {pre && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500" aria-hidden>{pre}</span>}
      <Input id={id} type="number" step="any" min={0} inputMode="decimal" className={clsx("h-9 w-full py-1.5", pre && "pl-7", post && "pr-8")} value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); onValue(e.target.value === "" || !Number.isFinite(n) ? 0 : n); }} />
      {post && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500" aria-hidden>{post}</span>}
    </div>
  );
}

type Recommended = {
  id: string; created_at: string;
  content: {
    summary: string; price_note?: string | null; based_on_scenario: string; evidence_count: number;
    inputs: { field: string; value: number; basis: string; why: string; exact_in_source: boolean; sources: { ref: string; label: string; url: string | null }[] }[];
    results: { retail_price: number; landed_cost: number; contribution_margin: number; contribution_margin_pct: number | null; gross_margin_pct: number | null; breakeven_cac: number };
    generated_by: { generated_at: string; cost_usd?: number };
  };
};

function fmtField(k: string, v: number): string {
  const f = FIELDS[k];
  if (f?.pre === "$") return money(v, { decimals: 2 });
  if (f?.post === "%") return `${v}%`;
  if (f?.post === "units") return `${num(v)} units`;
  return String(v);
}

/** One AI call proposes every input from the product's research; each value shows why and where it came from. */
function RecommendPanel({ rec, busy, error, onRun, onUseAll }: {
  rec: Recommended | null | undefined; busy: boolean; error: string | null; onRun: () => void; onUseAll: () => void;
}) {
  const r = rec?.content;
  return (
    <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-primary-800"><Sparkles className="h-4 w-4" aria-hidden /> Recommended numbers from your research</div>
        <div className="flex flex-wrap gap-2">
          {r && <Button size="sm" onClick={onUseAll}>Use all</Button>}
          <Button size="sm" variant={r ? "ghost" : "primary"} loading={busy} onClick={onRun}>{r ? "Recommend again" : "Recommend numbers"}</Button>
        </div>
      </div>
      {!r ? (
        <p className="mt-1 text-xs text-slate-600">Reads this product&apos;s price tiers, tracked listings, supplier prices, channel fees, shipping benchmarks, reviews and findings, then suggests each input with its reason and source. One AI call (usually under $0.50); nothing changes until you click Use.</p>
      ) : (
        <div className="mt-1 space-y-1 text-xs text-slate-700">
          <p>{r.summary}</p>
          {r.price_note && <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">{r.price_note}</p>}
          <p>
            With all of them: retail <b>{money(r.results.retail_price)}</b>, landed cost <b>{money(r.results.landed_cost)}</b> per unit,
            contribution <b className={r.results.contribution_margin < 0 ? "text-red-700" : "text-green-700"}>{money(r.results.contribution_margin)}</b> per unit
            ({pct(r.results.contribution_margin_pct)}), gross margin {pct(r.results.gross_margin_pct)}.
          </p>
          <p className="text-slate-500">From {r.evidence_count} pieces of evidence · {date(rec!.created_at)}{r.generated_by.cost_usd ? ` · AI cost ${money(r.generated_by.cost_usd, { decimals: 2 })}` : ""}</p>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function Suggestion({ item, current, onUse }: { item: Recommended["content"]["inputs"][number]; current: number; onUse: () => void }) {
  const same = Math.abs((current ?? 0) - item.value) < 1e-9;
  return (
    <div className="mt-1 text-[11px] leading-snug text-slate-600">
      <span className="font-semibold text-primary-800">Suggested {fmtField(item.field, item.value)}</span>
      <span className="text-slate-500"> · {BASIS_META[item.basis]?.label ?? item.basis}{item.basis !== "assumption" && !item.exact_in_source ? " (estimated from the source)" : ""}</span>
      {" "}{same ? <span className="text-green-700">· in use</span> : <button className="font-semibold text-primary-700 hover:underline" onClick={onUse}>Use</button>}
      <div>{item.why}{item.sources.map((s, i) => (
        <span key={s.ref}>{" "}{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline" title={s.label}>[{i + 1}]</a> : <span title={s.label}>[{i + 1}]</span>}</span>
      ))}</div>
    </div>
  );
}

const TARGETS = [10, 20, 30, 40, 50];

function PriceTargets({ r, inputs, onUsePrice }: { r: UEResults; inputs: Record<string, number>; onUsePrice: (p: number) => void }) {
  const [custom, setCustom] = useState("");
  const [customRow, setCustomRow] = useState<PriceTarget | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = Number(custom);
    if (custom === "" || !Number.isFinite(t)) { setCustomRow(null); setErr(null); return; }
    const timer = setTimeout(() => {
      post<PriceTarget>("/api/analytics/price-for-margin", { inputs, target_margin_pct: t })
        .then((row) => { setCustomRow(row); setErr(null); }).catch((e) => { setCustomRow(null); setErr(errorText(e)); });
    }, 300);
    return () => clearTimeout(timer);
  }, [custom, inputs]);
  const rows = [...(r.price_targets ?? []).filter((x) => TARGETS.includes(x.target_pct)), ...(customRow ? [customRow] : [])];
  const cell = (p: number | null, note?: string | null) => p === null
    ? <span className="text-xs text-slate-500" title={note ?? undefined}>Not reachable</span>
    : <button className="font-semibold tabular-nums text-primary-700 hover:underline" title="Use this retail price" onClick={() => onUsePrice(p)}>{money(p)}</button>;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-600">Retail price for a target margin</div>
      <p className="mb-2 text-xs text-slate-500">
        Gross margin = (price after discount - landed cost) / price after discount. Contribution margin also takes off fulfillment,
        fees, returns and marketing. Click a price to use it.
      </p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Target margin (%)</th><th className="py-1 font-medium">Price for gross margin (USD)</th><th className="py-1 font-medium">Price for contribution margin (USD)</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((x, i) => (
            <tr key={`${x.target_pct}-${i}`}>
              <td className="py-1.5 text-slate-700">{x.target_pct}%</td>
              <td className="py-1.5">{cell(x.gross_margin_price)}</td>
              <td className="py-1.5">{cell(x.contribution_margin_price, x.contribution_note)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        Custom target
        <Input type="number" min={0} max={99} step="any" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} className="w-24" placeholder="e.g. 35" />
        %
      </label>
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      {rows.some((x) => x.contribution_margin_price === null && x.contribution_note) && (
        <p className="mt-1 text-xs text-slate-500">{rows.find((x) => x.contribution_margin_price === null && x.contribution_note)?.contribution_note}</p>
      )}
    </div>
  );
}

function ShipmentSizes({ r, fixed, onUse, onFixed }: { r: UEResults; fixed: number; onUse: (units: number) => void; onFixed: (v: number) => void }) {
  if (!r.by_shipment_size?.length) return null;
  if (!fixed)
    return (
      <div className="rounded-lg border border-line p-3">
        <div className="mb-1 text-xs font-medium text-slate-600">Per-unit cost by shipment size</div>
        <p className="text-xs text-slate-600">
          Shipment size changes the cost per unit once you enter a <b>fixed cost per shipment</b> - the fees paid once however many
          units ship: customs broker and entry, documents, delivery to your warehouse, the carrier&apos;s minimum charge. Ask your
          forwarder to list them in the quote.
        </p>
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => onFixed(200)}>Try an example: $200 per shipment</Button>
      </div>
    );
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-600">Per-unit cost by shipment size</div>
      <p className="mb-2 text-xs text-slate-500">
        The fixed cost per shipment (broker, customs entry, documents, delivery, minimum charges) is shared by every unit, so
        bigger shipments cost less per unit. Carriers also charge less per kg above weight breaks, and sea freight becomes
        worth it at larger volumes - enter that quote&apos;s freight per unit to see it. Bigger orders need more cash up front.
      </p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500">
          <th className="py-1 font-medium">Shipment (units)</th><th className="py-1 font-medium">Shipping (USD/unit)</th><th className="py-1 font-medium">Landed (USD/unit)</th>
          <th className="py-1 font-medium">Contribution (USD/unit)</th><th className="py-1 font-medium">Order cost (USD)</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {r.by_shipment_size.map((s) => (
            <tr key={s.units} className={s.current ? "bg-slate-50 font-semibold" : undefined}>
              <td className="py-1.5">
                {s.current ? <span>{num(s.units)} (now)</span>
                  : <button className="text-primary-700 hover:underline" title="Use this shipment size" onClick={() => onUse(s.units)}>{num(s.units)}</button>}
              </td>
              <td className="py-1.5 tabular-nums">{money(s.shipping_per_unit)}</td>
              <td className="py-1.5 tabular-nums">{money(s.landed_cost)}</td>
              <td className={`py-1.5 tabular-nums ${s.contribution_margin < 0 ? "text-red-700" : ""}`}>{money(s.contribution_margin)}</td>
              <td className="py-1.5 tabular-nums">{money(s.order_cost, { decimals: 0 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsPanel({ r, inputs, onSet }: { r: UEResults | null; inputs: Record<string, number>; onSet: (k: string, v: number) => void }) {
  if (!r) return <Spinner label="Calculating..." />;
  const pu = r.per_unit;
  const lc = r.landed_cost_breakdown;
  // Costs in the logo's soft lavender; the result carries meaning (teal = each sale earns, pink = each sale loses).
  const COST = "#b9a7f6";
  const waterfall = [
    { name: "Factory", value: lc.factory_cost, color: COST },
    { name: "Freight", value: (lc.freight ?? 0) + (lc.shipment_fees ?? 0), color: COST },
    { name: "Duty", value: lc.duty, color: COST },
    { name: "Clearance+pkg", value: (lc.clearance ?? 0) + (lc.packaging ?? 0), color: COST },
    { name: "Fulfillment", value: pu.fulfillment, color: COST },
    { name: "Payment fees", value: pu.payment_fees, color: COST },
    { name: "Channel fees", value: pu.channel_fees ?? 0, color: COST },
    { name: "Returns", value: (pu.return_handling ?? 0) + (pu.unsellable_loss ?? 0), color: COST },
    { name: "Marketing", value: pu.marketing, color: COST },
    { name: "Contribution", value: r.contribution_margin, color: r.contribution_margin >= 0 ? "#0f9e90" : "#e8467c" },
  ];
  const lo = Math.min(0, ...waterfall.map((d) => d.value));
  const hi = Math.max(0, ...waterfall.map((d) => d.value));
  const step = hi - lo > 100 ? 25 : hi - lo > 40 ? 10 : 5;
  const domain: [number, number] = [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Contribution (USD per unit)</div>
          <div className={`text-2xl font-semibold ${r.contribution_margin >= 0 ? "text-ink" : "text-red-700"}`}>{money(r.contribution_margin)}</div>
          <div className="text-xs text-slate-500">{pct(r.contribution_margin_pct)} of net revenue</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Landed cost (USD per unit)</div>
          <div className="text-2xl font-semibold text-slate-900">{money(lc.landed_cost)}</div>
          <div className="text-xs text-slate-500">Gross margin {pct(r.gross_margin_pct)}</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-slate-500">Break-even CAC</dt><dd className="font-medium">{money(r.breakeven_cac)} <span className="text-xs font-normal text-slate-500">per order</span></dd></div>
        <div><dt className="text-xs text-slate-500">Sales needed to cover fixed costs</dt><dd className="font-medium">{r.breakeven_units_per_month === null ? "-" : <>{num(r.breakeven_units_per_month, 1)} <span className="text-xs font-normal text-slate-500">units per month</span></>}</dd></div>
        <div><dt className="text-xs text-slate-500">MOQ inventory cost (landed)</dt><dd className="font-medium">{money(r.moq_inventory_cost)}</dd></div>
        <div><dt className="text-xs text-slate-500">Units affordable with budget</dt><dd className="font-medium">{num(r.affordable_units_with_budget)} <span className="text-xs font-normal text-slate-500">units</span></dd></div>
        <div className="col-span-2"><dt className="text-xs text-slate-500">Sales to recover the initial investment</dt><dd className="font-medium">{r.units_to_recover_investment === null ? "-" : <>{num(r.units_to_recover_investment, 0)} <span className="text-xs font-normal text-slate-500">units</span></>}</dd></div>
      </dl>
      {r.warnings.length > 0 && (
        <ul className="space-y-1">
          {r.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>
          ))}
        </ul>
      )}
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Where each sale&apos;s revenue goes (USD per unit)</div>
        <div style={{ height: waterfall.length * 28 + 30 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waterfall} layout="vertical" margin={{ left: 4, right: 56, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => money(v, { decimals: 0 })} fontSize={11} domain={domain} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={92} fontSize={11} interval={0} />
              <ReferenceLine x={0} stroke="#64748b" />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Bar dataKey="value" radius={[3, 3, 3, 3]} barSize={16}>
                {waterfall.map((d) => <Cell key={d.name} fill={d.color} />)}
                <LabelList dataKey="value" content={BarValue} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <PriceTargets r={r} inputs={inputs} onUsePrice={(p) => onSet("retail_price", p)} />
      <ShipmentSizes r={r} fixed={inputs.shipment_fixed_costs ?? 0} onUse={(n) => onSet("units_per_shipment", n)} onFixed={(v) => onSet("shipment_fixed_costs", v)} />
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Price sensitivity: contribution (USD per unit) at each retail price (USD)</div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={r.price_sensitivity} margin={{ left: 0, right: 20, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="price" tickFormatter={(v) => `$${v}`} fontSize={11} />
              <YAxis tickFormatter={(v) => `$${v}`} fontSize={11} />
              <ReferenceLine y={0} stroke="#e8467c" strokeDasharray="4 4" />
              <Tooltip formatter={(v, n) => (n === "margin_pct" ? pct(Number(v)) : money(Number(v)))} labelFormatter={(l) => `Price ${money(Number(l))}`} />
              <Line type="monotone" dataKey="contribution_margin" name="Contribution" stroke="#5b3bc9" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CalculatorTab({ projectId, spec, scenarios, reload, loadId, onLoaded }: {
  projectId: string; spec: ModelSpec; scenarios: Scenario[]; reload: () => void; loadId: string | null; onLoaded: () => void;
}) {
  const { project } = useProjects();
  const [inputs, setInputs] = useState<Record<string, number>>(() => ({
    ...spec.defaults,
    ...(project?.budget_usd != null ? { initial_investment: project.budget_usd } : {}),
    ...(project?.price_min != null && project?.price_max != null ? { retail_price: Math.round((project.price_min + project.price_max) / 2) } : {}),
  }));
  const [basis, setBasis] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(spec.defaults).map((k) => [k, k === "initial_investment" && project?.budget_usd != null ? "actual" : "assumption"])),
  );
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [results, setResults] = useState<UEResults | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [stype, setStype] = useState<string>("hypothetical");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rec = useApi<Recommended | null>(`/api/projects/${projectId}/analytics/recommended-inputs`);
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const recBy = Object.fromEntries((rec.data?.content.inputs ?? []).map((i) => [i.field, i]));
  const basisOf = (b: string) => (b in BASIS_META ? b : "assumption");
  async function runRecommend() {
    setRecBusy(true); setRecError(null);
    try { rec.setData(await post<Recommended>(`/api/projects/${projectId}/analytics/recommended-inputs`)); }
    catch (e) { setRecError(errorText(e)); } finally { setRecBusy(false); }
  }
  function applyAll() {
    const items = rec.data?.content.inputs ?? [];
    setInputs((cur) => ({ ...cur, ...Object.fromEntries(items.map((i) => [i.field, i.value])) }));
    setBasis((b) => ({ ...b, ...Object.fromEntries(items.map((i) => [i.field, basisOf(i.basis)])) }));
  }

  useEffect(() => {
    if (!loadId) return;
    const s = scenarios.find((x) => x.id === loadId);
    if (!s) return; // scenarios may still be loading
    setInputs({ ...spec.defaults, ...s.inputs });
    setBasis({ ...Object.fromEntries(Object.keys(spec.defaults).map((k) => [k, "assumption"])), ...s.input_basis });
    setEditing(s);
    setName(s.name);
    setStype(s.scenario_type);
    setNotes(s.notes ?? "");
    onLoaded();
  }, [loadId, scenarios, spec.defaults, onLoaded]);

  // Open with this product's own numbers: its latest saved scenario (research-based when market research saved one),
  // otherwise the numbers recommended from its research. Example values are used only when neither exists.
  const [source, setSource] = useState<"scenario" | "recommended" | "example">("example");
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current || loadId || editing || rec.loading) return;
    const s = scenarios[0];
    if (s) {
      autoLoaded.current = true;
      setInputs({ ...spec.defaults, ...s.inputs });
      setBasis({ ...Object.fromEntries(Object.keys(spec.defaults).map((k) => [k, "assumption"])), ...s.input_basis });
      setEditing(s); setName(s.name); setStype(s.scenario_type); setNotes(s.notes ?? "");
      setSource("scenario");
    } else if (rec.data) {
      autoLoaded.current = true;
      applyAll();
      setSource("recommended");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, rec.data, rec.loading, loadId, editing]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        setResults(await post<UEResults>("/api/analytics/calculate", inputs));
        setCalcError(null);
      } catch (e) {
        setCalcError(errorText(e));
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [inputs]);

  const assumptionCount = Object.keys(spec.defaults).filter((k) => (basis[k] ?? "assumption") === "assumption").length;

  async function save(asNew: boolean) {
    setBusy(true);
    setSaveError(null);
    try {
      const body = { name: name.trim() || "Untitled scenario", scenario_type: stype, inputs, input_basis: basis, notes: notes || null };
      const s = editing && !asNew ? await put<Scenario>(`/api/scenarios/${editing.id}`, body) : await post<Scenario>(`/api/projects/${projectId}/scenarios`, body);
      setEditing(s);
      setSaveOpen(false);
      reload();
    } catch (e) {
      setSaveError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card >
        <CardHeader
          title={editing ? `Editing: ${editing.name}` : "Unit economics calculator"}
          subtitle={`${assumptionCount} of ${Object.keys(spec.defaults).length} inputs are assumptions. Tag each input with where the number came from. Channels, suppliers and plans use your latest saved scenario - save to use these numbers there.`}
          icon={<Calculator className="h-4 w-4" />}
          actions={
            <>
              {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setName(""); }}>Start new</Button>}
              <Button size="sm" onClick={() => setSaveOpen(true)}><Save className="h-3.5 w-3.5" /> {editing ? "Save" : "Save scenario"}</Button>
            </>
          }
        />
        <CardBody className="space-y-4">
          {!editing && (source === "recommended"
            ? <Alert tone="blue">Showing the numbers recommended from this product&apos;s research. Save them as a scenario to use them in the other tabs.</Alert>
            : <Alert tone="blue">No saved numbers for this product yet, so these are example values. Click <b>Recommend numbers</b> to fill them from its research, or run market research first.</Alert>)}
          <RecommendPanel rec={rec.data} busy={recBusy} error={recError} onRun={runRecommend} onUseAll={applyAll} />
          {GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</legend>
              <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
                {g.fields.map((k) => (
                  <div key={k}>
                    {/* Name on one line, unit on the next: every label is two lines, so the boxes in a row line up. */}
                    <label className="mb-1 block leading-tight" htmlFor={`in-${k}`} title={spec.descriptions[k]}>
                      <span className="block text-xs font-medium text-slate-700">{FIELDS[k]?.label ?? spec.labels[k] ?? titleCase(k)}</span>
                      <span className="block text-[11px] text-slate-500">{FIELDS[k]?.unit ?? "\u00a0"}</span>
                    </label>
                    <div className="flex gap-1.5">
                      <NumberInput id={`in-${k}`} value={inputs[k]} pre={FIELDS[k]?.pre} post={FIELDS[k]?.post} onValue={(v) => setInputs((cur) => ({ ...cur, [k]: v }))} />
                      <select aria-label={`Source of ${spec.labels[k]}`} title="Where this number came from" value={basis[k] ?? "assumption"}
                        onChange={(e) => setBasis((b) => ({ ...b, [k]: e.target.value }))}
                        className="h-9 w-[7.25rem] shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[11px] text-slate-600">
                        {Object.entries(BASIS_META).map(([v, m]) => <option key={v} value={v} title={m.label}>{v === "sourced_research" ? "Research" : m.label}</option>)}
                      </select>
                    </div>
                    {recBy[k] && <Suggestion item={recBy[k]} current={inputs[k]} onUse={() => {
                      setInputs((cur) => ({ ...cur, [k]: recBy[k].value }));
                      setBasis((b) => ({ ...b, [k]: basisOf(recBy[k].basis) }));
                    }} />}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </CardBody>
      </Card>
      <Card >
        <CardHeader title="Results" subtitle="Deterministic model - same math the AI copilot uses" icon={<Gauge className="h-4 w-4" />} />
        <CardBody>{calcError ? <Alert tone="red">{calcError}</Alert>
          : <ResultsPanel r={results} inputs={inputs} onSet={(k, v) => setInputs((cur) => ({ ...cur, [k]: v }))} />}</CardBody>
      </Card>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={editing ? "Save scenario" : "Save new scenario"}>
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. $69 price, sea freight" /></Field>
          <Field label="Scenario type" hint="Use 'actual' only when the inputs come from real orders and invoices.">
            <Select value={stype} onChange={(e) => setStype(e.target.value)}>
              {SCENARIO_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
          {saveError && <Alert tone="red">{saveError}</Alert>}
          <div className="flex justify-end gap-2">
            {editing && <Button variant="secondary" loading={busy} onClick={() => save(true)}>Save as new</Button>}
            <Button loading={busy} onClick={() => save(false)}>{editing ? "Update scenario" : "Save"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CompareTab({ scenarios, spec, onLoad, reload }: { scenarios: Scenario[]; spec: ModelSpec; onLoad: (id: string) => void; reload: () => void }) {
  const [selected, setSelected] = useState<string[]>(() => scenarios.slice(0, 3).map((s) => s.id));
  const [error, setError] = useState<string | null>(null);
  const chosen = scenarios.filter((s) => selected.includes(s.id));
  const chart = chosen.map((s) => ({ name: s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name, landed: s.results.landed_cost_breakdown.landed_cost, contribution: s.results.contribution_margin }));

  async function remove(id: string) {
    try {
      await del(`/api/scenarios/${id}`);
      setSelected((cur) => cur.filter((x) => x !== id));
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!scenarios.length) return <Card><EmptyState icon={<Calculator className="h-5 w-5" />} title="No saved scenarios">Save scenarios from the calculator, a supplier quote, or a research report to compare them here.</EmptyState></Card>;

  const rows: { label: string; get: (s: Scenario) => string; key?: string }[] = [
    { label: "Type", get: (s) => titleCase(s.scenario_type) },
    { label: "Retail price", get: (s) => money(s.inputs.retail_price), key: "retail_price" },
    { label: "Factory cost", get: (s) => money(s.inputs.factory_cost), key: "factory_cost" },
    { label: "Duty %", get: (s) => pct(s.inputs.duty_rate_pct), key: "duty_rate_pct" },
    { label: "Marketing CAC", get: (s) => money(s.inputs.marketing_cac), key: "marketing_cac" },
    { label: "Return rate", get: (s) => pct(s.inputs.return_rate_pct), key: "return_rate_pct" },
    { label: "Landed cost", get: (s) => money(s.results.landed_cost_breakdown.landed_cost) },
    { label: "Contribution / unit", get: (s) => money(s.results.contribution_margin) },
    { label: "Contribution %", get: (s) => pct(s.results.contribution_margin_pct) },
    { label: "Break-even CAC", get: (s) => money(s.results.breakeven_cac) },
    { label: "MOQ inventory cost", get: (s) => money(s.results.moq_inventory_cost) },
  ];

  return (
    <div className="space-y-5">
      {error && <Alert tone="red">{error}</Alert>}
      <Card>
        <CardHeader title="Saved scenarios" subtitle="Select up to 4 to compare" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-slate-100 bg-slate-50"><tr><Th /><Th>Name</Th><Th>Type</Th><Th>Assumptions</Th><Th>Contribution</Th><Th>Updated</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {scenarios.map((s) => {
                const nAssume = Object.keys(spec.defaults).filter((k) => (s.input_basis[k] ?? "assumption").startsWith("assumption")).length;
                return (
                  <tr key={s.id}>
                    <Td><input type="checkbox" aria-label={`Compare ${s.name}`} checked={selected.includes(s.id)}
                      onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id].slice(-4) : cur.filter((x) => x !== s.id)))} /></Td>
                    <Td className="font-medium text-slate-900">{s.name}{s.created_by !== "user" && <span className="ml-1.5 text-[11px] font-normal text-slate-400">by {titleCase(s.created_by)}</span>}</Td>
                    <Td><Badge tone={s.scenario_type === "actual" ? "green" : "slate"}>{titleCase(s.scenario_type)}</Badge></Td>
                    <Td>{nAssume} of {Object.keys(spec.defaults).length}</Td>
                    <Td className={s.results.contribution_margin >= 0 ? "text-ink" : "text-red-700"}>{money(s.results.contribution_margin)}</Td>
                    <Td className="text-xs text-slate-500">{date(s.updated_at)}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => onLoad(s.id)} aria-label="Open in calculator"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(s.id)} aria-label="Delete scenario"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {chosen.length > 0 && (
        <Card>
          <CardHeader title="Comparison" subtitle="Badges show where each input came from" />
          <CardBody>
            <div className="mb-5 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v) => `$${v}`} fontSize={11} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Bar dataKey="landed" name="Landed cost (USD/unit)" fill="#b9a7f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="contribution" name="Contribution (USD/unit)" fill="#0f9e90" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-slate-100"><tr><Th>Metric</Th>{chosen.map((s) => <Th key={s.id}>{s.name}</Th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <Td className="text-xs font-medium text-slate-500">{row.label}</Td>
                      {chosen.map((s) => (
                        <Td key={s.id}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.get(s)}
                            {row.key && <BasisBadge basis={s.input_basis[row.key] ?? "assumption"} />}
                          </div>
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ExperimentsTab({ projectId }: { projectId: string }) {
  const { data, reload, loading } = useApi<Experiment[]>(`/api/projects/${projectId}/experiments`);
  const blank = { name: "", hypothesis: "", method: "", success_metric: "", status: "planned", result: "", start_date: "", end_date: "" };
  const [form, setForm] = useState<typeof blank & { id?: string }>(blank);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const body = { ...form, method: form.method || null, success_metric: form.success_metric || null, result: form.result || null,
      start_date: form.start_date || null, end_date: form.end_date || null };
    delete (body as { id?: string }).id;
    try {
      if (form.id) await put(`/api/experiments/${form.id}`, body);
      else await post(`/api/projects/${projectId}/experiments`, body);
      setOpen(false);
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Card>
      <CardHeader title="Validation experiments" icon={<FlaskConical className="h-4 w-4" />}
        subtitle="Track the cheap tests that turn assumptions into evidence (landing pages, pre-orders, sample feedback, pricing tests)."
        actions={<Button size="sm" onClick={() => { setForm(blank); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> New experiment</Button>} />
      {loading && !data ? <CardBody><Spinner /></CardBody> : !data?.length ? (
        <EmptyState icon={<FlaskConical className="h-5 w-5" />} title="No experiments yet">Record what you will test, how you will measure it, and what happened.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((x) => (
            <li key={x.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{x.name}</span>
                <Badge tone={x.status === "completed" ? "green" : x.status === "running" ? "blue" : x.status === "abandoned" ? "slate" : "amber"}>{titleCase(x.status)}</Badge>
                {(x.start_date || x.end_date) && <span className="text-xs text-slate-400">{date(x.start_date)} → {date(x.end_date)}</span>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Edit experiment" onClick={() => { setForm({ ...blank, ...x, method: x.method ?? "", success_metric: x.success_metric ?? "", result: x.result ?? "", start_date: x.start_date ?? "", end_date: x.end_date ?? "" }); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Delete experiment" onClick={async () => { await del(`/api/experiments/${x.id}`).catch(() => {}); reload(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-700"><span className="text-slate-500">Hypothesis:</span> {x.hypothesis}</p>
              {x.success_metric && <p className="text-xs text-slate-600"><span className="text-slate-500">Success metric:</span> {x.success_metric}</p>}
              {x.result && <p className="mt-1 text-xs text-slate-700"><span className="font-medium">Result:</span> {x.result}</p>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? "Edit experiment" : "New experiment"}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Hypothesis"><Textarea rows={2} value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })} /></Field>
          <Field label="Method"><Textarea rows={2} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} /></Field>
          <Field label="Success metric"><Input value={form.success_metric} onChange={(e) => setForm({ ...form, success_metric: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {["planned", "running", "completed", "abandoned"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </Field>
            <Field label="Start"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="End"><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          </div>
          <Field label="Result"><Textarea rows={2} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} /></Field>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex justify-end"><Button onClick={save} disabled={!form.name.trim() || !form.hypothesis.trim()}>Save</Button></div>
        </div>
      </Modal>
    </Card>
  );
}

type Tab = "calculator" | "compare" | "experiments";

function AnalyticsView({ projectId }: { projectId: string }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("calculator");
  // ?scenario=<id> (e.g. from a research report or supplier quote) opens that scenario in the calculator.
  const [loadId, setLoadId] = useState<string | null>(() => params.get("scenario"));
  const spec = useApi<ModelSpec>("/api/analytics/model");
  const scenarios = useApi<Scenario[]>(`/api/projects/${projectId}/scenarios`);
  const list = useMemo(() => scenarios.data ?? [], [scenarios.data]);

  return (
    <>
      <PageHeader title="Analytics" description="Model unit economics with clearly labelled inputs, save and compare scenarios, and track validation experiments and AI spend."
        badge={<Badge tone="slate" title="Sales performance analytics need a connected store">Sales analytics: <PlannedBadge /></Badge>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "calculator", label: "Unit economics" },
        { value: "compare", label: `Scenarios (${list.length})` },
        { value: "experiments", label: "Experiments" },
      ]} />
      {!spec.data ? <Spinner /> : (
        <>
          <div hidden={tab !== "calculator"}>
            <CalculatorTab key={projectId} projectId={projectId} spec={spec.data} scenarios={list} reload={scenarios.reload} loadId={loadId} onLoaded={() => setLoadId(null)} />
          </div>
          {tab === "compare" && <CompareTab scenarios={list} spec={spec.data} reload={scenarios.reload} onLoad={(id) => { setLoadId(id); setTab("calculator"); }} />}
          {tab === "experiments" && <ExperimentsTab projectId={projectId} />}
        </>
      )}
    </>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RequireProject>{(pid) => <AnalyticsView projectId={pid} />}</RequireProject>
    </Suspense>
  );
}
