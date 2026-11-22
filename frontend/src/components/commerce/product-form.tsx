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
