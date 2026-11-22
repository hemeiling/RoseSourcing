"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { errorText, patch, post } from "@/lib/api";
import type { Product } from "@/lib/types";

const STATUSES: Product["status"][] = ["idea", "sampling", "approved", "listed", "retired"];

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const optNum = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function ProductForm({
  projectId,
  product,
  onSaved,
  onCancel,
}: {
  projectId: string;
  product?: Product | null;
  onSaved: (p: Product) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: product?.name ?? "",
    product_type: product?.product_type ?? "",
    description: product?.description ?? "",
    materials: product?.materials ?? "",
    features: (product?.features ?? []).join(", "),
    sizes: (product?.sizes ?? []).join(", "),
    target_price: product?.target_price?.toString() ?? "",
    sku: product?.sku ?? "",
    status: product?.status ?? ("idea" as Product["status"]),
    inventory_on_hand: product?.inventory_on_hand?.toString() ?? "",
    reorder_point: product?.reorder_point?.toString() ?? "",
    units_per_carton: product?.units_per_carton?.toString() ?? "",
    carton_length_cm: product?.carton_length_cm?.toString() ?? "",
    carton_width_cm: product?.carton_width_cm?.toString() ?? "",
    carton_height_cm: product?.carton_height_cm?.toString() ?? "",
    carton_gross_weight_kg: product?.carton_gross_weight_kg?.toString() ?? "",
    unit_weight_kg: product?.unit_weight_kg?.toString() ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(),
      product_type: f.product_type.trim() || null,
      description: f.description.trim() || null,
      materials: f.materials.trim() || null,
      features: splitList(f.features),
      sizes: splitList(f.sizes),
      target_price: optNum(f.target_price),
      sku: f.sku.trim() || null,
      status: f.status,
      inventory_on_hand: optNum(f.inventory_on_hand),
      reorder_point: optNum(f.reorder_point),
      units_per_carton: optNum(f.units_per_carton),
      carton_length_cm: optNum(f.carton_length_cm),
      carton_width_cm: optNum(f.carton_width_cm),
      carton_height_cm: optNum(f.carton_height_cm),
      carton_gross_weight_kg: optNum(f.carton_gross_weight_kg),
      unit_weight_kg: optNum(f.unit_weight_kg),
    };
    try {
      const saved = product ? await patch<Product>(`/api/products/${product.id}`, body) : await post<Product>(`/api/projects/${projectId}/products`, body);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product name" className="sm:col-span-2">
          <Input required value={f.name} onChange={set("name")} placeholder="e.g. Latin practice dress" />
        </Field>
        <Field label="Product type">
          <Input value={f.product_type} onChange={set("product_type")} placeholder="e.g. dress, skirt, top" />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={set("description")} />
        </Field>
        <Field label="Materials" className="sm:col-span-2">
          <Input value={f.materials} onChange={set("materials")} placeholder="e.g. 85% nylon, 15% spandex" />
        </Field>
        <Field label="Features" hint="Comma-separated">
          <Input value={f.features} onChange={set("features")} placeholder="4-way stretch, built-in shorts" />
        </Field>
        <Field label="Sizes" hint="Comma-separated">
          <Input value={f.sizes} onChange={set("sizes")} placeholder="XS, S, M, L, XL" />
        </Field>
        <Field label="Target retail price (USD)">
          <Input type="number" min={0} step="0.01" value={f.target_price} onChange={set("target_price")} />
        </Field>
        <Field label="SKU">
          <Input value={f.sku} onChange={set("sku")} />
        </Field>
        <Field label="Inventory on hand" hint="Manual count - not synced from any system">
          <Input type="number" min={0} step="1" value={f.inventory_on_hand} onChange={set("inventory_on_hand")} />
        </Field>
        <Field label="Reorder point">
          <Input type="number" min={0} step="1" value={f.reorder_point} onChange={set("reorder_point")} />
        </Field>
      </div>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-600">Packaging (used by the shipping calculator)</legend>
        <p className="mb-2 text-[11px] text-slate-500">Ask your supplier for the export carton size and packed weight.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Units per carton"><Input type="number" min={1} step="1" value={f.units_per_carton} onChange={set("units_per_carton")} /></Field>
          <Field label="Carton gross weight (kg)"><Input type="number" min={0} step="any" value={f.carton_gross_weight_kg} onChange={set("carton_gross_weight_kg")} /></Field>
          <Field label="Unit weight (kg)"><Input type="number" min={0} step="any" value={f.unit_weight_kg} onChange={set("unit_weight_kg")} /></Field>
          <Field label="Carton length (cm)"><Input type="number" min={0} step="any" value={f.carton_length_cm} onChange={set("carton_length_cm")} /></Field>
          <Field label="Carton width (cm)"><Input type="number" min={0} step="any" value={f.carton_width_cm} onChange={set("carton_width_cm")} /></Field>
          <Field label="Carton height (cm)"><Input type="number" min={0} step="any" value={f.carton_height_cm} onChange={set("carton_height_cm")} /></Field>
        </div>
      </fieldset>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {product ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}
