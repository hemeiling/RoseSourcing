"use client";

import { Calculator, Pencil, Plus, Ship, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ExternalLink, Field, Input, Modal, Select, Spinner, Td, Textarea, Th } from "@/components/ui";
import { del, errorText, post, put } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT, type MsgKey } from "@/lib/i18n";
import type { Product, Scenario, ShippingComparison, ShippingOption, ShippingRow } from "@/lib/types";
import { DOMESTIC_MODES, INTERNATIONAL_MODES, MODE_LABEL, RATE_BASIS_LABEL, ShipBasisBadge, daysText, rangeText } from "./meta";

type OptForm = Record<string, string | boolean>;

const blank: OptForm = {
  name: "", leg: "international", mode: "air_freight", provider: "", origin: "", destination: "", rate_basis: "per_kg", rate: "", rate_high: "",
  currency: "USD", min_charge: "", fixed_fees: "", volumetric_divisor: "", transit_days_min: "", transit_days_max: "", includes_duties: false,
  basis: "quote", source_url: "", quote_date: "", valid_until: "", notes: "",
};

const n = (v: string | boolean) => (typeof v === "string" && v.trim() !== "" ? Number(v) : null);
const str = (v: string | boolean) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function toForm(o: ShippingOption): OptForm {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    name: o.name, leg: o.leg, mode: o.mode, provider: s(o.provider), origin: s(o.origin), destination: s(o.destination), rate_basis: o.rate_basis,
    rate: s(o.rate), rate_high: s(o.rate_high), currency: o.currency, min_charge: s(o.min_charge), fixed_fees: s(o.fixed_fees),
    volumetric_divisor: s(o.volumetric_divisor), transit_days_min: s(o.transit_days_min), transit_days_max: s(o.transit_days_max),
    includes_duties: o.includes_duties, basis: o.basis, source_url: s(o.source_url), quote_date: s(o.quote_date), valid_until: s(o.valid_until), notes: s(o.notes),
  };
}

function OptionForm({ projectId, editing, onSaved, onCancel }: { projectId: string; editing: ShippingOption | null; onSaved: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [f, setF] = useState<OptForm>(editing ? toForm(editing) : blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  const modes = f.leg === "international" ? INTERNATIONAL_MODES : DOMESTIC_MODES;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: String(f.name).trim(), leg: f.leg, mode: f.mode, provider: str(f.provider), origin: str(f.origin), destination: str(f.destination),
      rate_basis: f.rate_basis, rate: n(f.rate), rate_high: n(f.rate_high), currency: String(f.currency || "USD").toUpperCase(),
      min_charge: n(f.min_charge), fixed_fees: n(f.fixed_fees), volumetric_divisor: n(f.volumetric_divisor),
      transit_days_min: n(f.transit_days_min), transit_days_max: n(f.transit_days_max), includes_duties: !!f.includes_duties,
      basis: f.basis, source_url: str(f.source_url), quote_date: str(f.quote_date), valid_until: str(f.valid_until), notes: str(f.notes),
    };
    try {
      if (editing) await put(`/api/shipping-options/${editing.id}`, body);
      else await post(`/api/projects/${projectId}/shipping-options`, body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Name")} className="sm:col-span-2"><Input required value={String(f.name)} onChange={set("name")} placeholder={t("e.g. Forwarder X air freight quote")} /></Field>
        <Field label={t("Leg")}>
          <Select value={String(f.leg)} onChange={(e) => {
            const leg = e.target.value;
            setF((c) => ({ ...c, leg, mode: leg === "international" ? "air_freight" : "domestic_parcel", rate_basis: leg === "international" ? "per_kg" : "per_order" }));
          }}>
            <option value="international">{t("International freight (factory to warehouse)")}</option>
            <option value="domestic">{t("Domestic delivery / fulfillment (to customer)")}</option>
          </Select>
        </Field>
        <Field label={t("Mode")}>
          <Select value={String(f.mode)} onChange={set("mode")}>{modes.map((m) => <option key={m} value={m}>{t(MODE_LABEL[m])}</option>)}</Select>
        </Field>
        <Field label={t("Provider")}><Input value={String(f.provider)} onChange={set("provider")} placeholder={t("Forwarder, carrier or 3PL")} /></Field>
        <Field label={t("Where the number came from")}>
          <Select value={String(f.basis)} onChange={set("basis")}>
            <option value="quote">{t("Quote I received")}</option>
            <option value="assumption">{t("My assumption / estimate")}</option>
            {editing?.basis === "sourced_research" && <option value="sourced_research">{t("Sourced benchmark (from research)")}</option>}
          </Select>
        </Field>
        <Field label={t("Origin")}><Input value={String(f.origin)} onChange={set("origin")} /></Field>
        <Field label={t("Destination")}><Input value={String(f.destination)} onChange={set("destination")} /></Field>
        <Field label={t("Rate basis")}>
          <Select value={String(f.rate_basis)} onChange={set("rate_basis")}>{Object.entries(RATE_BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select>
        </Field>
        <Field label={t("Currency")}><Input value={String(f.currency)} onChange={set("currency")} maxLength={3} /></Field>
        <Field label={t("Rate")} hint={t("Or the low end of a range")}><Input type="number" min={0} step="any" value={String(f.rate)} onChange={set("rate")} /></Field>
        <Field label={t("Rate - high end (optional)")}><Input type="number" min={0} step="any" value={String(f.rate_high)} onChange={set("rate_high")} /></Field>
        <Field label={t("Minimum charge")}><Input type="number" min={0} step="any" value={String(f.min_charge)} onChange={set("min_charge")} /></Field>
        <Field label={t("Fixed fees per shipment")} hint={t("Customs brokerage, documents, delivery")}><Input type="number" min={0} step="any" value={String(f.fixed_fees)} onChange={set("fixed_fees")} /></Field>
        {f.rate_basis === "per_kg" && (
          <Field label={t("Volumetric divisor (cm³/kg)")} hint={t("Blank = 5000 express / 6000 air (common defaults; confirm with your carrier)")}>
            <Input type="number" min={1000} max={10000} step="1" value={String(f.volumetric_divisor)} onChange={set("volumetric_divisor")} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Transit min (days)")}><Input type="number" min={0} value={String(f.transit_days_min)} onChange={set("transit_days_min")} /></Field>
          <Field label={t("Transit max (days)")}><Input type="number" min={0} value={String(f.transit_days_max)} onChange={set("transit_days_max")} /></Field>
        </div>
        <Field label={t("Quote date")}><Input type="date" value={String(f.quote_date)} onChange={set("quote_date")} /></Field>
        <Field label={t("Valid until")}><Input type="date" value={String(f.valid_until)} onChange={set("valid_until")} /></Field>
        <Field label={t("Source URL (optional)")} className="sm:col-span-2"><Input type="url" value={String(f.source_url)} onChange={set("source_url")} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={!!f.includes_duties} onChange={(e) => setF((c) => ({ ...c, includes_duties: e.target.checked }))} />
          {t("Quoted DDP (duties and taxes included)")}
        </label>
        <Field label={t("Notes")} className="sm:col-span-2"><Textarea rows={2} value={String(f.notes)} onChange={set("notes")} /></Field>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("Cancel")}</Button>
        <Button type="submit" loading={busy}>{editing ? t("Save") : t("Add option")}</Button>
      </div>
    </form>
  );
}

// Manual carton fields: [field, label (a dictionary key)].
const PACK_FIELDS = [
  ["units_per_carton", "Units / carton"], ["carton_length_cm", "Length cm"], ["carton_width_cm", "Width cm"], ["carton_height_cm", "Height cm"], ["carton_gross_weight_kg", "Carton kg"],
] as const satisfies readonly (readonly [string, MsgKey])[];

function ShippingCalculator({ projectId, options, version }: { projectId: string; options: ShippingOption[]; version: number }) {
  const { t, tx, tr, lang } = useT();
  const products = useApi<Product[]>(`/api/projects/${projectId}/products`);
  const withSpecs = (products.data ?? []).filter((p) => p.units_per_carton && p.carton_length_cm && p.carton_width_cm && p.carton_height_cm && p.carton_gross_weight_kg);
  const [productId, setProductId] = useState<string>("");
  const [units, setUnits] = useState("100");
  const [pack, setPack] = useState({ units_per_carton: "", carton_length_cm: "", carton_width_cm: "", carton_height_cm: "", carton_gross_weight_kg: "" });
  const [result, setResult] = useState<ShippingComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!productId && withSpecs.length) setProductId(withSpecs[0].id);
  }, [withSpecs, productId]);

  async function compare() {
    setBusy(true);
    setError(null);
    try {
      const manual = productId === "manual";
      const body = {
        units: Number(units),
        product_id: manual ? null : productId || null,
        packaging: manual ? Object.fromEntries(Object.entries(pack).map(([k, v]) => [k, Number(v)])) : null,
      };
      setResult(await post<ShippingComparison>(`/api/projects/${projectId}/shipping/compare`, body));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (result) compare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function saveFreightScenario(r: ShippingRow) {
    const value = r.per_unit_high ?? r.per_unit_low;
    if (value === null) return;
    const basis = r.basis === "quote" ? "supplier_quote" : r.basis === "sourced_research" ? "sourced_research" : "assumption";
    try {
      const sc = await post<Scenario>(`/api/projects/${projectId}/scenarios/with-overrides`, {
        name: `${r.name} freight (${result?.shipment.units} units)`,
        overrides: { freight_per_unit: value },
        input_basis: { freight_per_unit: basis },
        notes: `Freight per unit from the shipping calculator (${r.per_unit_high !== null && r.per_unit_high !== r.per_unit_low ? "high end of range" : "single rate"}).`,
      });
      setSaved((c) => ({ ...c, [r.option_id]: sc.id }));
    } catch (e) {
      setError(errorText(e));
    }
  }

  const manual = productId === "manual";
  return (
    <Card>
      <CardHeader title={t("Shipping cost calculator")} icon={<Calculator className="h-4 w-4" />}
        subtitle={t("Cartons, chargeable weight (actual vs volumetric) and weight/measure for sea freight are computed for each option.")} />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("Packaging from")}>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {withSpecs.map((p) => <option key={p.id} value={p.id}>{t("{name} ({n}/carton)", { name: p.name, n: p.units_per_carton ?? "" })}</option>)}
              <option value="manual">{t("Enter carton specs manually")}</option>
            </Select>
          </Field>
          <Field label={t("Units in shipment")}><Input type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
          <div className="flex items-end"><Button onClick={compare} loading={busy} disabled={!options.length || !Number(units) || (!productId)}>{t("Compare options")}</Button></div>
        </div>
        {products.data && withSpecs.length === 0 && !manual && (
          <p className="text-xs text-slate-500">{tr("No product has carton specs yet. Add them to a product in {link}, or choose manual entry.", {
            link: <Link href="/commerce" className="text-primary-700 underline">{t(lang === "zh" ? "Inventory & listings" : "Commerce")}</Link>,
          })}</p>
        )}
        {manual && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PACK_FIELDS.map(([k, label]) => (
              <Field key={k} label={t(label)}><Input type="number" min={0} step="any" value={pack[k]} onChange={(e) => setPack((c) => ({ ...c, [k]: e.target.value }))} /></Field>
            ))}
          </div>
        )}
        {!options.length && <p className="text-xs text-slate-500">{t("Add at least one shipping option below to compare.")}</p>}
        {error && <Alert tone="red">{error}</Alert>}
        {result && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span><span className="text-slate-500">{t("Cartons:")}</span> <strong>{result.shipment.cartons}</strong></span>
              <span><span className="text-slate-500">{t("Gross weight:")}</span> <strong>{num(result.shipment.gross_weight_kg, 1)} kg</strong></span>
              <span><span className="text-slate-500">{t("Volume:")}</span> <strong>{num(result.shipment.volume_cbm, 3)} CBM</strong></span>
              <span className="text-slate-500">{t("Current scenario '{name}' assumes {price}/unit freight", { name: result.base_scenario.name, price: money(result.base_scenario.freight_per_unit) })}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-slate-100 bg-slate-50"><tr><Th>{t("Option")}</Th><Th>{t("Source")}</Th><Th>{t("Chargeable")}</Th><Th>{t("Total")}</Th><Th>{t("Per unit")}</Th><Th>{t("Transit")}</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {result.rows.map((r, i) => (
                    <tr key={r.option_id} className={i === 0 && r.leg === "international" ? "bg-slate-50" : undefined}>
                      <Td>
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500">{r.leg === "domestic" ? `${t("Domestic")} · ` : ""}{tx(MODE_LABEL[r.mode] ?? r.mode)}{r.provider ? ` · ${r.provider}` : ""}</div>
                        {/* Notes are written by the server in English; tx() translates the fixed ones the dictionary has. */}
                        {r.notes.map((nt) => <div key={nt} className="text-[11px] text-amber-700">{tx(nt)}</div>)}
                      </Td>
                      <Td><ShipBasisBadge basis={r.basis} />{r.source_url && <div><ExternalLink href={r.source_url} className="text-[11px]">{t("source")}</ExternalLink></div>}</Td>
                      <Td className="text-xs">{r.chargeable !== null ? `${num(r.chargeable, 2)} ${r.chargeable_unit}` : "-"}</Td>
                      <Td>{rangeText(r.total_low, r.total_high, (x) => money(x, { currency: r.currency }))}</Td>
                      <Td className="font-medium">{rangeText(r.per_unit_low, r.per_unit_high, (x) => money(x, { currency: r.currency }))}</Td>
                      <Td className="text-xs">{daysText(r.transit_days_min, r.transit_days_max)}</Td>
                      <Td>
                        {r.leg === "international" && r.per_unit_low !== null && r.currency === "USD" && (saved[r.option_id] ? (
                          <Link href={`/analytics?scenario=${saved[r.option_id]}`} className="text-xs font-medium text-primary-700 hover:underline">{t("Scenario saved →")}</Link>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => saveFreightScenario(r)} title={t("Save a scenario using this freight cost (high end of a range)")}>{t("Use in scenario")}</Button>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500">{t("Domestic per-order options assume one unit per order. Benchmarks are not quotes - confirm with a forwarder before ordering.")}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function ShippingTab({ projectId, version }: { projectId: string; version: number }) {
  const { t, tx } = useT();
  const opts = useApi<ShippingOption[]>(`/api/projects/${projectId}/shipping-options`);
  const [editing, setEditing] = useState<ShippingOption | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    opts.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function remove(o: ShippingOption) {
    try {
      await del(`/api/shipping-options/${o.id}`);
      opts.reload();
      setLocalVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const list = opts.data ?? [];
  return (
    <div className="space-y-5">
      <ShippingCalculator projectId={projectId} options={list} version={version + localVersion} />
      <Card>
        <CardHeader title={t("Shipping & fulfillment options")} icon={<Ship className="h-4 w-4" />}
          subtitle={t("Forwarder quotes, carrier rates, 3PL fees, and sourced benchmarks from research. Benchmarks are for planning only.")}
          actions={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> {t("Add option")}</Button>} />
        {error && <div className="px-5 pt-3"><Alert tone="red">{error}</Alert></div>}
        {opts.loading && !opts.data ? <CardBody><Spinner /></CardBody> : list.length === 0 ? (
          <EmptyState icon={<Ship className="h-5 w-5" />} title={t("No shipping options yet")}
            action={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>{t("Add a quote")}</Button>}>
            {t("Add quotes from freight forwarders (air, sea, express) and domestic delivery/3PL rates, or run the channels & shipping research on the Plan tab to collect sourced benchmarks.")}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-100 bg-slate-50"><tr><Th>{t("Option")}</Th><Th>{t("Leg / mode")}</Th><Th>{t("Rate")}</Th><Th>{t("Fees")}</Th><Th>{t("Transit")}</Th><Th>{t("Source")}</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <div className="font-medium text-slate-900">{o.name}</div>
                      <div className="text-xs text-slate-500">{[o.provider, o.origin && o.destination ? `${o.origin} → ${o.destination}` : null].filter(Boolean).join(" · ")}</div>
                      {o.notes && <div className="mt-0.5 max-w-xs text-[11px] text-slate-500">{o.notes}</div>}
                    </Td>
                    <Td className="text-xs">
                      <Badge tone={o.leg === "international" ? "blue" : "slate"}>{o.leg === "international" ? t("International") : t("Domestic")}</Badge>
                      <div className="mt-1">{tx(MODE_LABEL[o.mode] ?? o.mode)}</div>
                    </Td>
                    <Td className="text-xs">{rangeText(o.rate, o.rate_high, (x) => money(x, { currency: o.currency }))} <span className="text-slate-500">{tx(RATE_BASIS_LABEL[o.rate_basis])}</span>{o.includes_duties && <div><Badge tone="violet">DDP</Badge></div>}</Td>
                    <Td className="text-xs">{o.min_charge !== null && <div>{t("Min {price}", { price: money(o.min_charge) })}</div>}{o.fixed_fees !== null && <div>{t("+{price}/shipment", { price: money(o.fixed_fees) })}</div>}{o.min_charge === null && o.fixed_fees === null && "-"}</Td>
                    <Td className="text-xs">{daysText(o.transit_days_min, o.transit_days_max)}</Td>
                    <Td><ShipBasisBadge basis={o.basis} />{o.source_url && <div><ExternalLink href={o.source_url} className="text-[11px]">{t("link")}</ExternalLink></div>}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" aria-label={t("Edit option")} onClick={() => { setEditing(o); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" aria-label={t("Delete option")} onClick={() => remove(o)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t("Edit shipping option") : t("Add shipping option")} wide>
        {open && <OptionForm key={editing?.id ?? "new"} projectId={projectId} editing={editing}
          onSaved={() => { setOpen(false); opts.reload(); setLocalVersion((v) => v + 1); }} onCancel={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}
