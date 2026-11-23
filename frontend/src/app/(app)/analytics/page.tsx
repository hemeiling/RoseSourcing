"use client";

import { AlertTriangle, Calculator, FlaskConical, Gauge, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RequireProject } from "@/components/app-shell";
import { BASIS_META, BasisBadge } from "@/components/evidence";
import { useProjects } from "@/components/providers";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, PlannedBadge, Select, Spinner, Tabs, Td, Textarea, Th,
} from "@/components/ui";
import { del, errorText, post, put } from "@/lib/api";
import { date, money, num, pct, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AgentExecution, Experiment, ModelSpec, Scenario, UEResults } from "@/lib/types";

const GROUPS: { title: string; fields: string[] }[] = [
  { title: "Pricing", fields: ["retail_price", "avg_discount_pct"] },
  { title: "Product & landed cost", fields: ["factory_cost", "freight_per_unit", "duty_rate_pct", "import_clearance_per_unit", "packaging_per_unit"] },
  { title: "Fulfillment, payments & channel fees", fields: ["fulfillment_per_unit", "payment_fee_pct", "payment_fee_fixed", "channel_commission_pct", "channel_fee_per_order", "units_per_order"] },
  { title: "Marketing & returns", fields: ["marketing_cac", "return_rate_pct", "return_cost_per_unit", "unsellable_return_pct"] },
  { title: "Budget & fixed costs", fields: ["initial_investment", "monthly_fixed_costs", "moq", "sample_costs"] },
];

const SCENARIO_TYPES = ["hypothetical", "quote_based", "actual", "research_estimate"] as const;

function ResultsPanel({ r }: { r: UEResults | null }) {
  if (!r) return <Spinner label="Calculating..." />;
  const pu = r.per_unit;
  const lc = r.landed_cost_breakdown;
  const waterfall = [
    { name: "Factory", value: lc.factory_cost, color: "#1e293b" },
    { name: "Freight", value: lc.freight, color: "#334155" },
    { name: "Duty", value: lc.duty, color: "#475569" },
    { name: "Clearance+pkg", value: (lc.clearance ?? 0) + (lc.packaging ?? 0), color: "#64748b" },
    { name: "Fulfillment", value: pu.fulfillment, color: "#94a3b8" },
    { name: "Payment fees", value: pu.payment_fees, color: "#a8b3c4" },
    { name: "Channel fees", value: pu.channel_fees ?? 0, color: "#cbd5e1" },
    { name: "Returns", value: (pu.return_handling ?? 0) + (pu.unsellable_loss ?? 0), color: "#d9dee6" },
    { name: "Marketing", value: pu.marketing, color: "#e2e8f0" },
    { name: "Contribution", value: r.contribution_margin, color: r.contribution_margin >= 0 ? "#0f172a" : "#94a3b8" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Contribution / unit</div>
          <div className={`text-2xl font-semibold ${r.contribution_margin >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(r.contribution_margin)}</div>
          <div className="text-xs text-slate-500">{pct(r.contribution_margin_pct)} of net revenue</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Landed cost / unit</div>
          <div className="text-2xl font-semibold text-slate-900">{money(lc.landed_cost)}</div>
          <div className="text-xs text-slate-500">Gross margin {pct(r.gross_margin_pct)}</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-slate-500">Break-even CAC</dt><dd className="font-medium">{money(r.breakeven_cac)}</dd></div>
        <div><dt className="text-xs text-slate-500">Units/month to cover fixed costs</dt><dd className="font-medium">{num(r.breakeven_units_per_month, 1)}</dd></div>
        <div><dt className="text-xs text-slate-500">MOQ inventory cost (landed)</dt><dd className="font-medium">{money(r.moq_inventory_cost)}</dd></div>
        <div><dt className="text-xs text-slate-500">Units affordable with budget</dt><dd className="font-medium">{num(r.affordable_units_with_budget)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-slate-500">Units to recover the initial investment</dt><dd className="font-medium">{num(r.units_to_recover_investment, 0)}</dd></div>
      </dl>
      {r.warnings.length > 0 && (
        <ul className="space-y-1">
          {r.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>
          ))}
        </ul>
      )}
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Where each sale&apos;s revenue goes (per unit)</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waterfall} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `$${v}`} fontSize={11} />
              <YAxis type="category" dataKey="name" width={92} fontSize={11} />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {waterfall.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Price sensitivity: contribution per unit</div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={r.price_sensitivity} margin={{ left: 0, right: 20, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="price" tickFormatter={(v) => `$${v}`} fontSize={11} />
              <YAxis tickFormatter={(v) => `$${v}`} fontSize={11} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              <Tooltip formatter={(v, n) => (n === "margin_pct" ? pct(Number(v)) : money(Number(v)))} labelFormatter={(l) => `Price ${money(Number(l))}`} />
              <Line type="monotone" dataKey="contribution_margin" name="Contribution" stroke="#334155" strokeWidth={2} dot />
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
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader
          title={editing ? `Editing: ${editing.name}` : "Unit economics calculator"}
          subtitle={`${assumptionCount} of ${Object.keys(spec.defaults).length} inputs are assumptions. Tag each input with where the number came from.`}
          icon={<Calculator className="h-4 w-4" />}
          actions={
            <>
              {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setName(""); }}>Start new</Button>}
              <Button size="sm" onClick={() => setSaveOpen(true)}><Save className="h-3.5 w-3.5" /> {editing ? "Save" : "Save scenario"}</Button>
            </>
          }
        />
        <CardBody className="space-y-5">
          {!editing && <Alert tone="blue">{spec.note}</Alert>}
          {GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.fields.map((k) => (
                  <div key={k}>
                    <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor={`in-${k}`} title={spec.descriptions[k]}>
                      {spec.labels[k] ?? titleCase(k)}
                    </label>
                    <div className="flex gap-1.5">
                      <Input id={`in-${k}`} type="number" step="any" min={0} className="min-w-0 flex-1" value={Number.isFinite(inputs[k]) ? inputs[k] : ""}
                        onChange={(e) => setInputs((cur) => ({ ...cur, [k]: e.target.value === "" ? 0 : Number(e.target.value) }))} />
                      <select aria-label={`Source of ${spec.labels[k]}`} title="Where this number came from" value={basis[k] ?? "assumption"}
                        onChange={(e) => setBasis((b) => ({ ...b, [k]: e.target.value }))}
                        className="w-[7.5rem] shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-[11px] text-slate-600">
                        {Object.entries(BASIS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
        <CardHeader title="Results" subtitle="Deterministic model - same math the AI copilot uses" icon={<Gauge className="h-4 w-4" />} />
        <CardBody>{calcError ? <Alert tone="red">{calcError}</Alert> : <ResultsPanel r={results} />}</CardBody>
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
                    <Td><Badge tone={s.scenario_type === "actual" ? "green" : s.scenario_type === "quote_based" ? "blue" : "amber"}>{titleCase(s.scenario_type)}</Badge></Td>
                    <Td>{nAssume} of {Object.keys(spec.defaults).length}</Td>
                    <Td className={s.results.contribution_margin >= 0 ? "text-emerald-700" : "text-red-700"}>{money(s.results.contribution_margin)}</Td>
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
                  <Bar dataKey="landed" name="Landed cost / unit" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="contribution" name="Contribution / unit" fill="#1e293b" radius={[3, 3, 0, 0]} />
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

function UsageTab({ projectId }: { projectId: string }) {
  const usage = useApi<{ by_agent: { agent: string; label: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number; search_requests: number }[]; total_cost_usd: number; note: string }>(`/api/projects/${projectId}/usage`);
  const execs = useApi<AgentExecution[]>(`/api/projects/${projectId}/agent-executions?limit=50`);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="AI usage & cost tracking" subtitle={usage.data?.note} />
        {!usage.data ? <CardBody><Spinner /></CardBody> : usage.data.by_agent.length === 0 ? (
          <CardBody><p className="text-sm text-slate-500">No AI calls yet for this project.</p></CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-slate-100 bg-slate-50"><tr><Th>Agent</Th><Th>Calls</Th><Th>Input tokens</Th><Th>Output tokens</Th><Th>Web searches</Th><Th>Est. cost</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {usage.data.by_agent.map((a) => (
                  <tr key={a.agent}><Td className="font-medium">{a.label}</Td><Td>{a.calls}</Td><Td>{num(a.input_tokens)}</Td><Td>{num(a.output_tokens)}</Td><Td>{a.search_requests}</Td><Td>{money(a.cost_usd, { decimals: 2 })}</Td></tr>
                ))}
                <tr className="bg-slate-50"><Td className="font-semibold">Total</Td><Td /><Td /><Td /><Td /><Td className="font-semibold">{money(usage.data.total_cost_usd, { decimals: 2 })}</Td></tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Agent execution log" subtitle="Every AI operation is recorded with its model, status, tokens and errors." />
        {!execs.data ? <CardBody><Spinner /></CardBody> : execs.data.length === 0 ? <CardBody><p className="text-sm text-slate-500">No executions yet.</p></CardBody> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-100 bg-slate-50"><tr><Th>When</Th><Th>Agent</Th><Th>Operation</Th><Th>Status</Th><Th>Model</Th><Th>Tokens in/out</Th><Th>Cost</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {execs.data.map((e) => (
                  <tr key={e.id} title={e.error ?? e.input_summary ?? ""}>
                    <Td className="text-xs text-slate-500">{date(e.started_at)}</Td>
                    <Td>{titleCase(e.agent)}</Td>
                    <Td className="text-xs">{e.operation}</Td>
                    <Td><Badge tone={e.status === "succeeded" ? "green" : e.status === "failed" ? "red" : "blue"}>{titleCase(e.status)}</Badge></Td>
                    <Td className="text-xs">{e.model}</Td>
                    <Td className="text-xs">{num(e.input_tokens)} / {num(e.output_tokens)}</Td>
                    <Td className="text-xs">{money(e.cost_usd, { decimals: 3 })}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

type Tab = "calculator" | "compare" | "experiments" | "usage";

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
        { value: "usage", label: "AI usage" },
      ]} />
      {!spec.data ? <Spinner /> : (
        <>
          <div hidden={tab !== "calculator"}>
            <CalculatorTab key={projectId} projectId={projectId} spec={spec.data} scenarios={list} reload={scenarios.reload} loadId={loadId} onLoaded={() => setLoadId(null)} />
          </div>
          {tab === "compare" && <CompareTab scenarios={list} spec={spec.data} reload={scenarios.reload} onLoad={(id) => { setLoadId(id); setTab("calculator"); }} />}
          {tab === "experiments" && <ExperimentsTab projectId={projectId} />}
          {tab === "usage" && <UsageTab projectId={projectId} />}
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
