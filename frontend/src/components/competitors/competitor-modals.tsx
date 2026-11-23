"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { del, errorText, patch, post } from "@/lib/api";
import type { Competitor, CompetitorProduct } from "@/lib/types";
import { date, domainOf, money, titleCase } from "@/lib/format";
import { Alert, Badge, Button, ExternalLink, Field, Input, Modal, Select, Td, Textarea, Th } from "@/components/ui";
import { VerificationBadge } from "@/components/evidence";

export const TIERS = ["budget", "mid", "premium", "luxury"] as const;

export function DiscoveredByBadge({ by }: { by: string }) {
  if (by === "ai_research") return <Badge tone="violet">AI research</Badge>;
  if (by === "csv") return <Badge tone="blue">CSV import</Badge>;
  return <Badge tone="slate">Manual</Badge>;
}

/** Format a price in its own currency; falls back to plain text for unusual codes. */
export function fmtPrice(price: number, currency: string): string {
  try {
    return money(price, { currency: currency || "USD" });
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
}

export function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const splitList = (s: string) =>
  s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

// ----------------------------------------------------------------------------- add / edit

export function CompetitorFormModal({
  open,
  onClose,
  projectId,
  competitor,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  competitor: Competitor | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", website: "", country: "", positioning: "", price_tier: "", channels: "", notes: "", on_watchlist: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      name: competitor?.name ?? "",
      website: competitor?.website ?? "",
      country: competitor?.country ?? "",
      positioning: competitor?.positioning ?? "",
      price_tier: competitor?.price_tier ?? "",
      channels: (competitor?.channels ?? []).join(", "),
      notes: competitor?.notes ?? "",
      on_watchlist: competitor?.on_watchlist ?? false,
    });
  }, [open, competitor]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      website: form.website.trim() || null,
      country: form.country.trim() || null,
      positioning: form.positioning.trim() || null,
      price_tier: form.price_tier || null,
      channels: splitList(form.channels),
      notes: form.notes.trim() || null,
      on_watchlist: form.on_watchlist,
    };
    try {
      if (competitor) await patch(`/api/competitors/${competitor.id}`, body);
      else await post(`/api/projects/${projectId}/competitors`, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={competitor ? `Edit ${competitor.name}` : "Add competitor"}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <Input required value={form.name} onChange={set("name")} maxLength={200} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Website">
            <Input type="url" value={form.website} onChange={set("website")} placeholder="https://" />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={set("country")} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price tier">
            <Select value={form.price_tier} onChange={set("price_tier")}>
              <option value="">Unknown</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sales channels" hint="Comma-separated, e.g. own website, Amazon, studios">
            <Input value={form.channels} onChange={set("channels")} />
          </Field>
        </div>
        <Field label="Positioning">
          <Textarea value={form.positioning} onChange={set("positioning")} rows={2} placeholder="How the brand presents itself" />
        </Field>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set("notes")} rows={2} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.on_watchlist} onChange={(e) => setForm((f) => ({ ...f, on_watchlist: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
          Add to watchlist
        </label>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {competitor ? "Save changes" : "Add competitor"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- detail

function AddPriceForm({ product, onSaved }: { product: CompetitorProduct; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [observed, setObserved] = useState("");
  const [url, setUrl] = useState(product.url ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = numOrNull(price);
    if (p === null || p <= 0) {
      setError("Enter a price greater than 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/api/competitor-products/${product.id}/prices`, {
        price: p,
        currency: currency.trim() || "USD",
        observed_at: observed ? new Date(observed).toISOString() : null,
        source_url: url.trim() || null,
        note: note.trim() || null,
      });
      setPrice("");
      setNote("");
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add price observation
      </Button>
    );
  return (
    <form onSubmit={submit} className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-6">
      <Field label="Price" className="sm:col-span-1">
        <Input inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field label="Currency" className="sm:col-span-1">
        <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} />
      </Field>
      <Field label="Observed on" className="sm:col-span-2">
        <Input type="date" value={observed} onChange={(e) => setObserved(e.target.value)} />
      </Field>
      <Field label="Source URL" className="sm:col-span-2" hint="With a URL, this is recorded as observed by you.">
        <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </Field>
      <Field label="Note" className="sm:col-span-4">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. sale price, size XS" />
      </Field>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          Save price
        </Button>
      </div>
      {error && (
        <div className="sm:col-span-6">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
    </form>
  );
}

function AddProductForm({ competitorId, onSaved }: { competitorId: string; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", url: "", product_type: "", material: "", price: "", currency: "USD", source_url: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const price = numOrNull(form.price);
    if (form.price.trim() && (price === null || price <= 0)) {
      setError("Initial price must be a number greater than 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/api/competitors/${competitorId}/products`, {
        name: form.name.trim(),
        url: form.url.trim() || null,
        product_type: form.product_type.trim() || null,
        material: form.material.trim() || null,
        initial_price: price !== null ? { price, currency: form.currency || "USD", source_url: form.source_url.trim() || form.url.trim() || null } : null,
      });
      setForm({ name: "", url: "", product_type: "", material: "", price: "", currency: "USD", source_url: "" });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
      <div className="text-xs font-semibold text-slate-700">Add product</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Product name">
          <Input required value={form.name} onChange={set("name")} maxLength={300} />
        </Field>
        <Field label="Product URL">
          <Input type="url" value={form.url} onChange={set("url")} placeholder="https://" />
        </Field>
        <Field label="Type">
          <Input value={form.product_type} onChange={set("product_type")} placeholder="e.g. Latin practice dress" />
        </Field>
        <Field label="Material">
          <Input value={form.material} onChange={set("material")} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Initial price (optional)">
          <Input inputMode="decimal" value={form.price} onChange={set("price")} />
        </Field>
        <Field label="Currency">
          <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={8} />
        </Field>
        <Field label="Price source URL" className="sm:col-span-2" hint="Defaults to the product URL.">
          <Input type="url" value={form.source_url} onChange={set("source_url")} placeholder="https://" />
        </Field>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add product
        </Button>
      </div>
    </form>
  );
}

export function CompetitorDetailModal({ competitor, onClose, onChanged }: { competitor: Competitor | null; onClose: () => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (!competitor) return null;
  const c = competitor;

  async function remove(path: string, what: string) {
    if (!window.confirm(`Delete this ${what}? This cannot be undone.`)) return;
    setError(null);
    try {
      await del(path);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal open onClose={onClose} title={c.name} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <DiscoveredByBadge by={c.discovered_by} />
          {c.price_tier && <Badge tone="blue">{titleCase(c.price_tier)}</Badge>}
          {c.on_watchlist && <Badge tone="slate">Watchlist</Badge>}
          {c.website && <ExternalLink href={c.website}>{domainOf(c.website)}</ExternalLink>}
          {c.country && <span className="text-xs text-slate-500">{c.country}</span>}
        </div>
        {c.positioning && <p className="text-sm text-slate-700"><span className="font-medium">Positioning:</span> {c.positioning}</p>}
        {c.channels.length > 0 && <p className="text-sm text-slate-700"><span className="font-medium">Channels:</span> {c.channels.join(", ")}</p>}
        {c.notes && <p className="text-sm text-slate-700"><span className="font-medium">Notes:</span> {c.notes}</p>}
        {error && <Alert tone="red">{error}</Alert>}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Products &amp; price history</h3>
          {c.products.length === 0 && <p className="text-sm text-slate-500">No products recorded yet.</p>}
          <div className="space-y-3">
            {c.products.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">
                      {p.url ? <ExternalLink href={p.url}>{p.name}</ExternalLink> : p.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[p.product_type, p.material, p.notes].filter(Boolean).join(" · ") || "No details"}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(`/api/competitor-products/${p.id}`, "product and its price history")} aria-label={`Delete ${p.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {p.price_observations.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                      <thead className="border-b border-slate-100">
                        <tr>
                          <Th>Observed</Th>
                          <Th>Price</Th>
                          <Th>Source</Th>
                          <Th>Verification</Th>
                          <Th>Note</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {[...p.price_observations]
                          .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
                          .map((o) => (
                            <tr key={o.id}>
                              <Td className="whitespace-nowrap text-xs">{date(o.observed_at)}</Td>
                              <Td className="whitespace-nowrap font-medium text-slate-900">{fmtPrice(o.price, o.currency)}</Td>
                              <Td className="text-xs">
                                {o.source_url ? <ExternalLink href={o.source_url}>{domainOf(o.source_url)}</ExternalLink> : <span className="text-slate-400">no link</span>}
                                <div className="text-slate-400">{titleCase(o.source_type)}</div>
                              </Td>
                              <Td>
                                <VerificationBadge status={o.verification_status} />
                              </Td>
                              <Td className="text-xs text-slate-600">{o.note ?? ""}</Td>
                              <Td>
                                <button
                                  onClick={() => remove(`/api/price-observations/${o.id}`, "price observation")}
                                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  aria-label="Delete price observation"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </Td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No price observations.</p>
                )}
                <AddPriceForm product={p} onSaved={onChanged} />
              </div>
            ))}
          </div>
        </div>
        <AddProductForm competitorId={c.id} onSaved={onChanged} />
      </div>
    </Modal>
  );
}
