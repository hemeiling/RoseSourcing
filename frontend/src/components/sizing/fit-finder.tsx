"use client";

import clsx from "clsx";
import { CheckCircle2, Info, Ruler, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { errorText } from "@/lib/api";
import { HOW_TO_MEASURE, dimLabel, fmtLen, fmtRange, type Unit } from "@/lib/sizing";
import type { FitResult, PublicSizeGuide } from "@/lib/types";

type Guide = Pick<PublicSizeGuide, "dimensions" | "dimension_labels" | "size_systems" | "rows">;

export function UnitToggle({ unit, onChange }: { unit: Unit; onChange: (u: Unit) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-white p-0.5 text-xs font-semibold" role="group" aria-label="Units">
      {(["in", "cm"] as Unit[]).map((u) => (
        <button key={u} type="button" onClick={() => onChange(u)} aria-pressed={unit === u}
          className={clsx("rounded px-2.5 py-1", unit === u ? "bg-primary-600 text-white" : "text-slate-600 hover:bg-canvas")}>
          {u === "in" ? "Inches" : "Centimetres"}
        </button>
      ))}
    </div>
  );
}

/** Read-only size scale: one row per size, body-measurement ranges per column. */
export function SizeTable({ chart, unit, highlight }: { chart: Guide; unit: Unit; highlight?: string | null }) {
  const dims = chart.dimensions.filter((d) => chart.rows.some((r) => r.measurements[d]));
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2">Size</th>
            {chart.size_systems.map((s) => <th key={s} className="px-3 py-2">{s}</th>)}
            {dims.map((d) => <th key={d} className="px-3 py-2">{dimLabel(d, chart.dimension_labels)} <span className="font-normal normal-case">({unit})</span></th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {chart.rows.map((r) => (
            <tr key={r.size} className={clsx(highlight === r.size && "bg-brand-50 font-semibold text-brand-800")}>
              <td className="px-3 py-2 font-semibold">{r.size}</td>
              {chart.size_systems.map((s) => <td key={s} className="px-3 py-2">{r.labels[s] ?? "–"}</td>)}
              {dims.map((d) => <td key={d} className="px-3 py-2 tabular-nums">{fmtRange(r.measurements[d], unit)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RESULT_TEXT: Record<string, string> = { fits: "Fits", snug: "Snug", loose: "Roomy", too_small: "Too small" };

export function FitResultView({ result, unit }: { result: FitResult; unit: Unit }) {
  if (result.status === "insufficient") return <Alert tone="blue">{result.notes.join(" ")}</Alert>;
  const rec = result.per_size.find((s) => s.size === result.recommended);
  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-4" aria-live="polite">
      {result.recommended ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm text-slate-600">Recommended size</span>
          <span className="font-serif text-3xl font-semibold text-brand-700">{result.recommended}</span>
          {Object.entries(result.recommended_labels ?? {}).map(([k, v]) => <span key={k} className="text-sm text-slate-600">{k} {v}</span>)}
          <span className={clsx("text-xs font-semibold", result.status === "fits" ? "text-emerald-700" : "text-amber-700")}>
            {result.status === "fits" ? "Within the chart on every measurement" : "Best match - see notes"}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 font-semibold text-red-700"><XCircle className="h-4 w-4" /> No size on this chart fits every measurement</div>
      )}
      {rec && (
        <ul className="grid gap-1.5">
          {rec.checks.map((c) => (
            <li key={c.dimension} className="flex items-center gap-2 text-sm">
              {c.result === "fits" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Info className="h-4 w-4 text-amber-600" />}
              <span className="text-slate-700">{c.label}: {fmtLen(c.customer, unit)}</span>
              <span className="text-xs text-slate-500">(size {rec.size}: {fmtRange([c.min, c.max], unit)}) · {RESULT_TEXT[c.result]}</span>
            </li>
          ))}
        </ul>
      )}
      {result.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
}

/** Measurement form + recommendation. `recommend` calls the server (owner or public endpoint). */
export function FitFinder({ chart, unit, onUnitChange, recommend, showTips = true }: {
  chart: Guide;
  unit: Unit;
  onUnitChange: (u: Unit) => void;
  recommend: (measurements: Record<string, number>, unit: Unit) => Promise<FitResult>;
  showTips?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<FitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dims = chart.dimensions.filter((d) => chart.rows.some((r) => r.measurements[d]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const n = Number(v);
      if (v.trim() && Number.isFinite(n) && n > 0) m[k] = n;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await recommend(m, unit));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Enter your body measurements (not garment measurements).</p>
        <UnitToggle unit={unit} onChange={(u) => { onUnitChange(u); setValues({}); setResult(null); }} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {dims.map((d) => (
          <Field key={d} label={`${dimLabel(d, chart.dimension_labels)} (${unit})`} hint={showTips ? HOW_TO_MEASURE[d] : undefined}>
            <Input inputMode="decimal" value={values[d] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [d]: e.target.value }))}
              placeholder={unit === "in" ? "e.g. 34.5" : "e.g. 88"} />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={busy} disabled={!Object.values(values).some((v) => v.trim())}><Ruler className="h-4 w-4" /> Find my size</Button>
      {error && <Alert tone="red">{error}</Alert>}
      {result && <FitResultView result={result} unit={unit} />}
    </form>
  );
}
