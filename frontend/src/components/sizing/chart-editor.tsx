"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { DIMENSIONS, GARMENT_DIMENSIONS, GARMENT_LABEL, dimLabel, fmtRange, fromCm, parseRange, type Unit } from "@/lib/sizing";
import type { SizeChart } from "@/lib/types";
import { UnitToggle } from "./fit-finder";

type Draft = {
  name: string;
  role: SizeChart["role"];
  garment_type: SizeChart["garment_type"];
  dimensions: string[];
  size_systems: string[];
  rows: { size: string; labels: Record<string, string>; cells: Record<string, string> }[];
  stretch: string;
  fit_notes: string;
  source_url: string;
};

const ROLE_LABEL: Record<SizeChart["role"], string> = {
  published: "Our size guide (customers see this)",
  supplier: "Supplier / factory chart",
  reference: "Competitor or reference chart",
};

function toDraft(c: SizeChart | null, unit: Unit, preset?: Partial<Pick<SizeChart, "role" | "garment_type">>): Draft {
  if (!c) {
    const g = preset?.garment_type ?? "dress";
    return {
      name: "", role: preset?.role ?? "published", garment_type: g, dimensions: GARMENT_DIMENSIONS[g], size_systems: ["US"],
      rows: ["XS", "S", "M", "L", "XL"].map((size) => ({ size: g === "shoes" ? "" : size, labels: {}, cells: {} })),
      stretch: "0", fit_notes: "", source_url: "",
    };
  }
  return {
    name: c.name, role: c.role, garment_type: c.garment_type, dimensions: c.dimensions, size_systems: c.size_systems,
    rows: c.rows.map((r) => ({ size: r.size, labels: { ...r.labels }, cells: Object.fromEntries(c.dimensions.map((d) => [d, r.measurements[d] ? fmtRange(r.measurements[d], unit).replace("–", "-") : ""])) })),
    stretch: String(Math.round(fromCm(c.stretch_allowance_cm, unit) * 10) / 10), fit_notes: c.fit_notes ?? "", source_url: c.source_url ?? "",
  };
}

export function ChartEditor({ open, chart, projectId, preset, onClose, onSaved }: {
  open: boolean;
  chart: SizeChart | null;
  projectId: string;
  preset?: Partial<Pick<SizeChart, "role" | "garment_type">>;
  onClose: () => void;
  onSaved: (c: SizeChart) => void;
}) {
  const [unit, setUnit] = useState<Unit>("cm");
  const [d, setD] = useState<Draft>(() => toDraft(chart, "cm", preset));
  const [newDim, setNewDim] = useState("");
  const [newSystem, setNewSystem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const presetRole = preset?.role;
  const presetGarment = preset?.garment_type;
  useEffect(() => {
    if (open) {
      setUnit("cm");
      setD(toDraft(chart, "cm", { role: presetRole, garment_type: presetGarment }));
      setError(null);
    }
  }, [open, chart, presetRole, presetGarment]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setRow = (i: number, fn: (r: Draft["rows"][number]) => Draft["rows"][number]) => set({ rows: d.rows.map((r, j) => (j === i ? fn(r) : r)) });

  function changeUnit(u: Unit) {
    if (u === unit) return;
    // Convert what has been typed so the numbers keep their meaning.
    const conv = (t: string) => {
      const r = parseRange(t);
      if (!r) return t;
      const f = (v: number) => String(Math.round((u === "in" ? v / 2.54 : v * 2.54) * (u === "in" ? 4 : 10)) / (u === "in" ? 4 : 10));
      return r[0] === r[1] ? f(r[0]) : `${f(r[0])}-${f(r[1])}`;
    };
    setD((x) => ({ ...x, stretch: conv(x.stretch) || "0", rows: x.rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, conv(v)])) })) }));
    setUnit(u);
  }

  async function save() {
    setError(null);
    const rows = [];
    for (const r of d.rows) {
      if (!d.dimensions.some((dim) => (r.cells[dim] ?? "").trim())) continue; // template rows left blank
      if (!r.size.trim()) return setError("Every row with measurements needs a size label.");
      const measurements: Record<string, [number, number]> = {};
      for (const dim of d.dimensions) {
        const parsed = parseRange(r.cells[dim] ?? "");
        if (parsed === undefined) return setError(`Size ${r.size}: "${r.cells[dim]}" is not a number or range like 82-86.`);
        if (parsed) measurements[dim] = parsed;
      }
      rows.push({ size: r.size.trim(), labels: r.labels, measurements });
    }
    if (!d.name.trim()) return setError("Give the chart a name.");
    if (!rows.length) return setError("Add at least one size.");
    const stretch = Number(d.stretch || 0);
    const body = { name: d.name.trim(), role: d.role, garment_type: d.garment_type, unit, dimensions: d.dimensions, size_systems: d.size_systems,
      rows, stretch_allowance: Number.isFinite(stretch) && stretch >= 0 ? stretch : 0, fit_notes: d.fit_notes.trim() || null, source_url: d.source_url.trim() };
    setBusy(true);
    try {
      const saved = chart
        ? await api<SizeChart>(`/api/size-charts/${chart.id}`, { method: "PUT", body })
        : await api<SizeChart>(`/api/projects/${projectId}/size-charts`, { method: "POST", body });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const addDim = (key: string) => {
    const k = key.trim().toLowerCase().replace(/\s+/g, "_");
    if (k && !d.dimensions.includes(k)) set({ dimensions: [...d.dimensions, k] });
    setNewDim("");
  };

  return (
    <Modal open={open} onClose={onClose} title={chart ? `Edit ${chart.name}` : "New size chart"} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Latin competition dress - women" /></Field>
          <Field label="Whose chart is this?">
            <Select value={d.role} onChange={(e) => set({ role: e.target.value as SizeChart["role"] })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Product type">
            <Select value={d.garment_type} onChange={(e) => {
              const g = e.target.value as SizeChart["garment_type"];
              set({ garment_type: g, dimensions: chart || d.rows.some((r) => Object.values(r.cells).some(Boolean)) ? d.dimensions : GARMENT_DIMENSIONS[g] });
            }}>
              {Object.entries(GARMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label={`Stretch allowance (${unit})`} hint="How far above a size's maximum the fabric still fits comfortably. 0 for non-stretch.">
            <Input inputMode="decimal" value={d.stretch} onChange={(e) => set({ stretch: e.target.value })} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600">Enter <strong>body</strong> measurements, smallest size first. Use a range like <code>82-86</code> or one number like <code>23.5</code>.</p>
          <UnitToggle unit={unit} onChange={changeUnit} />
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-canvas text-left text-xs text-slate-600">
              <tr>
                <th className="px-2 py-2">Size</th>
                {d.size_systems.map((s) => (
                  <th key={s} className="px-2 py-2">
                    <span className="inline-flex items-center gap-1">{s}
                      <button type="button" aria-label={`Remove ${s}`} onClick={() => set({ size_systems: d.size_systems.filter((x) => x !== s) })}><X className="h-3 w-3" /></button>
                    </span>
                  </th>
                ))}
                {d.dimensions.map((dim) => (
                  <th key={dim} className="px-2 py-2">
                    <span className="inline-flex items-center gap-1">{dimLabel(dim)} ({unit})
                      <button type="button" aria-label={`Remove ${dimLabel(dim)}`} onClick={() => set({ dimensions: d.dimensions.filter((x) => x !== dim) })}><X className="h-3 w-3" /></button>
                    </span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5"><Input aria-label="Size" className="w-20" value={r.size} onChange={(e) => setRow(i, (x) => ({ ...x, size: e.target.value }))} /></td>
                  {d.size_systems.map((s) => (
                    <td key={s} className="px-2 py-1.5"><Input aria-label={`${s} size`} className="w-16" value={r.labels[s] ?? ""}
                      onChange={(e) => setRow(i, (x) => ({ ...x, labels: { ...x.labels, [s]: e.target.value } }))} /></td>
                  ))}
                  {d.dimensions.map((dim) => (
                    <td key={dim} className="px-2 py-1.5"><Input aria-label={`${r.size} ${dimLabel(dim)}`} className="w-24" value={r.cells[dim] ?? ""}
                      onChange={(e) => setRow(i, (x) => ({ ...x, cells: { ...x.cells, [dim]: e.target.value } }))} /></td>
                  ))}
                  <td className="px-1"><Button size="sm" variant="ghost" aria-label="Remove size" onClick={() => set({ rows: d.rows.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => set({ rows: [...d.rows, { size: "", labels: {}, cells: {} }] })}><Plus className="h-3.5 w-3.5" /> Add size</Button>
          <Field label="Add measurement" className="w-48">
            <Select value={newDim} onChange={(e) => addDim(e.target.value)}>
              <option value="">Choose...</option>
              {Object.entries(DIMENSIONS).filter(([k]) => !d.dimensions.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Add size system" className="w-40">
            <div className="flex gap-1">
              <Input value={newSystem} onChange={(e) => setNewSystem(e.target.value)} placeholder="EU, UK, CN" />
              <Button size="sm" variant="secondary" disabled={!newSystem.trim()} onClick={() => {
                const s = newSystem.trim().toUpperCase();
                if (s && !d.size_systems.includes(s)) set({ size_systems: [...d.size_systems, s] });
                setNewSystem("");
              }}>Add</Button>
            </div>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fit notes shown with recommendations" hint="e.g. Latin shoes should fit snugly; suede stretches with wear.">
            <Textarea rows={2} value={d.fit_notes} onChange={(e) => set({ fit_notes: e.target.value })} />
          </Field>
          <Field label="Source link (optional)"><Input value={d.source_url} onChange={(e) => set({ source_url: e.target.value })} placeholder="https://" /></Field>
        </div>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save chart</Button>
        </div>
      </div>
    </Modal>
  );
}
