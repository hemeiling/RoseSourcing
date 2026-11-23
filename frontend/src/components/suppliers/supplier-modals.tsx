"use client";

import { Calculator, Check, Copy, Mail, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, del, errorText, patch, post } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Communication, Product, Quote, Scenario, Supplier } from "@/lib/types";
import { date, dateTime, domainOf, money, num, titleCase } from "@/lib/format";
import { Alert, Badge, Button, ConfigNotice, ExternalLink, Field, Input, Modal, Select, Spinner, Tabs, Td, Textarea, Th, type Tone } from "@/components/ui";

export const VERIFICATION_TONE: Record<string, Tone> = {
  unverified: "slate",
  documents_received: "slate",
  sample_approved: "blue",
  audited: "green",
};

/** Short label from the backend's full label ("Unverified - no checks done" -> "Unverified"). */
export function shortLabel(full: string): string {
  return full.split(/ - | \(/)[0];
}

export function SupplierVerificationBadge({ status, labels }: { status: string; labels: Record<string, string> | undefined }) {
  const full = labels?.[status] ?? titleCase(status);
  return (
    <Badge tone={VERIFICATION_TONE[status] ?? "slate"} title={full}>
      {shortLabel(full)}
    </Badge>
  );
}

export function QualityStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-xs text-slate-400">Not rated</span>;
  return (
    <span className="whitespace-nowrap text-sm text-slate-500" aria-label={`${rating} out of 5`} title="Your quality evaluation">
      {"★".repeat(rating)}
      <span className="text-slate-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function fmtMoney(v: number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined) return "-";
  try {
    return money(v, { currency, decimals: 2 });
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

const nOrNull = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const splitList = (s: string) =>
  s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

export const PLATFORMS = ["alibaba", "1688", "direct", "trade_show", "referral", "other"];

// ----------------------------------------------------------------------------- supplier form

export function SupplierFormModal({
  open,
  onClose,
  projectId,
  supplier,
  labels,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  supplier: Supplier | null;
  labels: Record<string, string> | undefined;
  onSaved: () => void;
}) {
  const empty = {
    name: "",
    country: "",
    city: "",
    website: "",
    platform: "",
    contact_name: "",
    contact_email: "",
    capabilities: "",
    certifications_claimed: "",
    verification_status: "unverified",
    quality_rating: "",
    quality_notes: "",
    notes: "",
  };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      supplier
        ? {
            name: supplier.name,
            country: supplier.country ?? "",
            city: supplier.city ?? "",
            website: supplier.website ?? "",
            platform: supplier.platform ?? "",
            contact_name: supplier.contact_name ?? "",
            contact_email: supplier.contact_email ?? "",
            capabilities: supplier.capabilities.join(", "),
            certifications_claimed: supplier.certifications_claimed.join(", "),
            verification_status: supplier.verification_status,
            quality_rating: supplier.quality_rating ? String(supplier.quality_rating) : "",
            quality_notes: supplier.quality_notes ?? "",
            notes: supplier.notes ?? "",
          }
        : empty,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      country: form.country.trim() || null,
      city: form.city.trim() || null,
      website: form.website.trim() || null,
      platform: form.platform || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      capabilities: splitList(form.capabilities),
      certifications_claimed: splitList(form.certifications_claimed),
      verification_status: form.verification_status,
      quality_rating: form.quality_rating ? Number(form.quality_rating) : null,
      quality_notes: form.quality_notes.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (supplier) await patch(`/api/suppliers/${supplier.id}`, body);
      else await post(`/api/projects/${projectId}/suppliers`, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const levels = labels ? Object.entries(labels) : [["unverified", "Unverified - no checks done"]];

  return (
    <Modal open={open} onClose={onClose} title={supplier ? `Edit ${supplier.name}` : "Add supplier"} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier name">
            <Input required value={form.name} onChange={set("name")} maxLength={300} />
          </Field>
          <Field label="Platform / how you found them">
            <Select value={form.platform} onChange={set("platform")}>
              <option value="">Not specified</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p === "1688" ? "1688.com" : p === "alibaba" ? "Alibaba.com" : titleCase(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={set("country")} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={set("city")} />
          </Field>
          <Field label="Website / store page">
            <Input type="url" value={form.website} onChange={set("website")} placeholder="https://" />
          </Field>
          <Field label="Contact name">
            <Input value={form.contact_name} onChange={set("contact_name")} />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={form.contact_email} onChange={set("contact_email")} />
          </Field>
          <Field label="Manufacturing capabilities" hint="Comma-separated, e.g. knit dresses, sublimation printing">
            <Input value={form.capabilities} onChange={set("capabilities")} />
          </Field>
        </div>
        <Field label="Certifications the supplier claims" hint="Recorded as claims only. 136Sourcing never shows these as verified.">
          <Input value={form.certifications_claimed} onChange={set("certifications_claimed")} placeholder="e.g. ISO 9001, BSCI, OEKO-TEX" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Verification status (set by you)" hint={labels?.[form.verification_status]}>
            <Select value={form.verification_status} onChange={set("verification_status")}>
              {levels.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your quality rating">
            <Select value={form.quality_rating} onChange={set("quality_rating")}>
              <option value="">Not rated</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Quality notes" hint="e.g. sample stitching, fabric weight, communication responsiveness">
          <Textarea value={form.quality_notes} onChange={set("quality_notes")} rows={2} />
        </Field>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set("notes")} rows={2} />
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {supplier ? "Save changes" : "Add supplier"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- quotes

const INCOTERMS = ["EXW", "FOB", "FCA", "CIF", "CFR", "DAP", "DDP"];

function QuoteForm({
  supplierId,
  quote,
  products,
  onDone,
  onCancel,
}: {
  supplierId: string;
  quote: Quote | null;
  products: Product[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    product_name: quote?.product_name ?? "",
    product_concept_id: quote?.product_concept_id ?? "",
    moq: quote?.moq?.toString() ?? "",
    unit_price: quote?.unit_price?.toString() ?? "",
    currency: quote?.currency ?? "USD",
    sample_cost: quote?.sample_cost?.toString() ?? "",
    lead_time_days: quote?.lead_time_days?.toString() ?? "",
    incoterm: quote?.incoterm ?? "",
    est_freight_per_unit: quote?.est_freight_per_unit?.toString() ?? "",
    quote_date: quote?.quote_date ?? "",
    valid_until: quote?.valid_until ?? "",
    notes: quote?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const numeric = { moq: f.moq, unit_price: f.unit_price, sample_cost: f.sample_cost, lead_time_days: f.lead_time_days, est_freight_per_unit: f.est_freight_per_unit };
    for (const [k, v] of Object.entries(numeric)) {
      if (v.trim() && nOrNull(v) === null) {
        setError(`${titleCase(k)} must be a number.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const moq = nOrNull(f.moq);
    const lead = nOrNull(f.lead_time_days);
    const body = {
      product_name: f.product_name.trim(),
      product_concept_id: f.product_concept_id || null,
      moq: moq === null ? null : Math.round(moq),
      unit_price: nOrNull(f.unit_price),
      currency: f.currency.trim().toUpperCase() || "USD",
      sample_cost: nOrNull(f.sample_cost),
      lead_time_days: lead === null ? null : Math.round(lead),
      incoterm: f.incoterm || null,
      est_freight_per_unit: nOrNull(f.est_freight_per_unit),
      quote_date: f.quote_date || null,
      valid_until: f.valid_until || null,
      notes: f.notes.trim() || null,
    };
    try {
      if (quote) await patch(`/api/supplier-quotes/${quote.id}`, body);
      else await post(`/api/suppliers/${supplierId}/quotes`, body);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-700">{quote ? "Edit quote" : "Add quote"}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Product">
          <Input required value={f.product_name} onChange={set("product_name")} maxLength={300} />
        </Field>
        <Field label="Linked product concept (optional)">
          <Select value={f.product_concept_id} onChange={set("product_concept_id")}>
            <option value="">None</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Unit price">
          <Input inputMode="decimal" value={f.unit_price} onChange={set("unit_price")} />
        </Field>
        <Field label="Currency">
          <Input value={f.currency} onChange={set("currency")} maxLength={8} />
        </Field>
        <Field label="MOQ (units)">
          <Input inputMode="numeric" value={f.moq} onChange={set("moq")} />
        </Field>
        <Field label="Sample cost">
          <Input inputMode="decimal" value={f.sample_cost} onChange={set("sample_cost")} />
        </Field>
        <Field label="Lead time (days)">
          <Input inputMode="numeric" value={f.lead_time_days} onChange={set("lead_time_days")} />
        </Field>
        <Field label="Incoterm">
          <Select value={f.incoterm} onChange={set("incoterm")}>
            <option value="">Not stated</option>
            {INCOTERMS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Est. freight / unit" hint="Leave blank to use your scenario's assumption.">
          <Input inputMode="decimal" value={f.est_freight_per_unit} onChange={set("est_freight_per_unit")} />
        </Field>
        <Field label="Quote date">
          <Input type="date" value={f.quote_date} onChange={set("quote_date")} />
        </Field>
        <Field label="Valid until">
          <Input type="date" value={f.valid_until} onChange={set("valid_until")} />
        </Field>
        <Field label="Notes" className="sm:col-span-3">
          <Input value={f.notes} onChange={set("notes")} />
        </Field>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          {quote ? "Save quote" : "Add quote"}
        </Button>
      </div>
    </form>
  );
}

function QuotesTab({ supplier, projectId, products, onChanged }: { supplier: Supplier; projectId: string; products: Product[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Quote | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [building, setBuilding] = useState<string | null>(null);

  async function remove(q: Quote) {
    if (!window.confirm(`Delete the quote for ${q.product_name}?`)) return;
    setError(null);
    try {
      await del(`/api/supplier-quotes/${q.id}`);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function buildScenario(q: Quote) {
    setBuilding(q.id);
    setError(null);
    setScenario(null);
    try {
      setScenario(await post<Scenario>(`/api/projects/${projectId}/scenarios/from-quote/${q.id}`));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBuilding(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="red">{error}</Alert>}
      {scenario && (
        <Alert tone="blue" title="Cost scenario created">
          &ldquo;{scenario.name}&rdquo; uses this quote&apos;s factory cost/MOQ; other inputs come from your latest scenario and remain assumptions until you replace them.{" "}
          <Link href="/analytics" className="font-medium underline">
            Open in Analytics
          </Link>
        </Alert>
      )}
      {supplier.quotes.length === 0 && editing === null && <p className="text-sm text-slate-500">No quotes recorded for this supplier.</p>}
      {supplier.quotes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200">
              <tr>
                <Th>Product</Th>
                <Th>Unit price</Th>
                <Th>MOQ</Th>
                <Th>Sample</Th>
                <Th>Lead time</Th>
                <Th>Incoterm</Th>
                <Th>Freight/unit</Th>
                <Th>Quoted</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplier.quotes.map((q) => (
                <tr key={q.id}>
                  <Td className="font-medium text-slate-900">
                    {q.source_url ? <ExternalLink href={q.source_url}>{q.product_name}</ExternalLink> : q.product_name}
                    <div className="text-[11px] font-normal text-slate-400">
                      {titleCase(q.source)}
                      {q.source_url && <> · listing on {domainOf(q.source_url)}</>}
                      {/* The listing link is shown above, so the "Source: <url>" tail of research notes is dropped. */}
                      {q.notes ? ` · ${q.source_url ? q.notes.replace(/\s*Source: \S+$/, "") : q.notes}` : ""}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtMoney(q.unit_price, q.currency)}</Td>
                  <Td>{num(q.moq)}</Td>
                  <Td className="whitespace-nowrap">{fmtMoney(q.sample_cost, q.currency)}</Td>
                  <Td className="whitespace-nowrap">{q.lead_time_days !== null ? `${q.lead_time_days} days` : "-"}</Td>
                  <Td>{q.incoterm ?? "-"}</Td>
                  <Td className="whitespace-nowrap">{q.est_freight_per_unit !== null ? fmtMoney(q.est_freight_per_unit, q.currency) : <span className="text-xs text-slate-400">assumed</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    {date(q.quote_date)}
                    {q.valid_until && <div className="text-slate-400">valid to {date(q.valid_until)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="secondary" onClick={() => buildScenario(q)} loading={building === q.id} title="Create a quote-based unit economics scenario">
                      <Calculator className="h-3.5 w-3.5" aria-hidden /> Build cost scenario
                    </Button>
                    <button onClick={() => setEditing(q)} className="ml-1 rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Edit quote for ${q.product_name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(q)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete quote for ${q.product_name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <QuoteForm
          key={editing === "new" ? "new" : editing.id}
          supplierId={supplier.id}
          quote={editing === "new" ? null : editing}
          products={products}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add quote
        </Button>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- communications

const CHANNELS = ["email", "alibaba_chat", "wechat", "whatsapp", "call", "video", "in_person", "other"];
const DIRECTION_TONE: Record<string, Tone> = { inbound: "slate", outbound: "slate", draft: "slate" };

function CommunicationsTab({ supplier, onChanged }: { supplier: Supplier; onChanged: () => void }) {
  const [f, setF] = useState({ occurred_at: "", channel: "email", direction: "outbound", subject: "", summary: "", next_action: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/api/suppliers/${supplier.id}/communications`, {
        occurred_at: f.occurred_at ? new Date(f.occurred_at).toISOString() : null,
        channel: f.channel,
        direction: f.direction,
        subject: f.subject.trim() || null,
        summary: f.summary.trim(),
        next_action: f.next_action.trim() || null,
      });
      setF({ occurred_at: "", channel: "email", direction: "outbound", subject: "", summary: "", next_action: "" });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Communication) {
    if (!window.confirm("Delete this communication entry?")) return;
    try {
      await del(`/api/supplier-communications/${c.id}`);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="red">{error}</Alert>}
      {open ? (
        <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="When">
              <Input type="datetime-local" value={f.occurred_at} onChange={set("occurred_at")} />
            </Field>
            <Field label="Channel">
              <Select value={f.channel} onChange={set("channel")}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Direction">
              <Select value={f.direction} onChange={set("direction")}>
                <option value="outbound">Outbound (you sent)</option>
                <option value="inbound">Inbound (they sent)</option>
                <option value="draft">Draft (not sent)</option>
              </Select>
            </Field>
          </div>
          <Field label="Subject">
            <Input value={f.subject} onChange={set("subject")} maxLength={300} />
          </Field>
          <Field label="Summary">
            <Textarea required value={f.summary} onChange={set("summary")} rows={3} />
          </Field>
          <Field label="Next action">
            <Input value={f.next_action} onChange={set("next_action")} placeholder="e.g. Follow up on sample lead time by Friday" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              Save entry
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Log communication
        </Button>
      )}
      {supplier.communications.length === 0 && <p className="text-sm text-slate-500">No communication history yet.</p>}
      <ul className="space-y-2">
        {supplier.communications.map((c) => (
          <li key={c.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge tone={DIRECTION_TONE[c.direction] ?? "slate"}>{c.direction === "draft" ? "Draft - not sent" : titleCase(c.direction)}</Badge>
              <span>{titleCase(c.channel)}</span>
              <span>· {dateTime(c.occurred_at)}</span>
              <button onClick={() => remove(c)} className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete communication">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {c.subject && <div className="mt-1 text-sm font-medium text-slate-900">{c.subject}</div>}
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.summary}</p>
            {c.next_action && (
              <p className="mt-1.5 text-xs text-slate-600">
                <span className="font-medium">Next:</span> {c.next_action}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------- RFQ draft

function RfqTab({ supplier, products, onChanged }: { supplier: Supplier; products: Product[]; onChanged: () => void }) {
  const [productId, setProductId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Communication | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setConfigMsg(null);
    setCopied(false);
    try {
      const d = await post<Communication>(`/api/suppliers/${supplier.id}/rfq-draft`, { product_concept_id: productId || null, notes: notes.trim() || null });
      setDraft(d);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject ?? ""}\n\n${draft.summary}`);
      setCopied(true);
    } catch {
      setError("Could not access the clipboard. Select the text and copy it manually.");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        The Sourcing Agent drafts a request-for-quotation email using your project and product details. It is saved to the communications log as a draft.{" "}
        <span className="font-medium">136Sourcing never sends messages to suppliers.</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Product (optional)">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">General inquiry for the project category</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes for the draft (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ask for quotes at 100 and 300 units" />
        </Field>
      </div>
      <Button onClick={generate} loading={busy}>
        <Sparkles className="h-4 w-4" aria-hidden /> Draft RFQ with AI
      </Button>
      {configMsg && <ConfigNotice message={configMsg} />}
      {error && <Alert tone="red">{error}</Alert>}
      {draft && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone="amber">
              <Mail className="h-3 w-3" aria-hidden /> Not sent - copy and send it yourself
            </Badge>
            <Badge tone="violet">AI draft</Badge>
            <Button size="sm" variant="secondary" className="ml-auto" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {draft.subject && <div className="text-sm font-medium text-slate-900">Subject: {draft.subject}</div>}
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-800">{draft.summary}</pre>
          <p className="mt-2 text-xs text-slate-500">Review every detail before sending - the draft must not state volumes, budgets or facts you have not confirmed.</p>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- detail modal

type DetailTab = "quotes" | "comms" | "rfq";

export function SupplierDetailModal({
  supplierId,
  projectId,
  labels,
  onClose,
  onChanged,
  onEdit,
}: {
  supplierId: string | null;
  projectId: string;
  labels: Record<string, string> | undefined;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (s: Supplier) => void;
}) {
  const { data: s, error, loading, reload } = useApi<Supplier>(supplierId ? `/api/suppliers/${supplierId}` : null);
  const products = useApi<Product[]>(supplierId ? `/api/projects/${projectId}/products` : null);
  const [tab, setTab] = useState<DetailTab>("quotes");

  useEffect(() => {
    if (supplierId) setTab("quotes");
  }, [supplierId]);

  if (!supplierId) return null;
  const changed = () => {
    reload();
    onChanged();
  };

  return (
    <Modal open onClose={onClose} title={s?.name ?? "Supplier"} wide>
      {loading && !s && <Spinner />}
      {error && <Alert tone="red">{errorText(error)}</Alert>}
      {s && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <SupplierVerificationBadge status={s.verification_status} labels={labels} />
            <QualityStars rating={s.quality_rating} />
            {s.platform && <Badge tone="slate">{s.platform === "1688" ? "1688.com" : s.platform === "alibaba" ? "Alibaba.com" : titleCase(s.platform)}</Badge>}
            <span className="text-xs text-slate-500">{[s.city, s.country].filter(Boolean).join(", ")}</span>
            {s.website && <ExternalLink href={s.website}>{domainOf(s.website)}</ExternalLink>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onEdit(s)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit supplier
            </Button>
          </div>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <span className="font-medium">Verification:</span> {labels?.[s.verification_status] ?? titleCase(s.verification_status)}
            </div>
            <div>
              <span className="font-medium">Contact:</span> {[s.contact_name, s.contact_email].filter(Boolean).join(" · ") || "-"}
            </div>
            <div>
              <span className="font-medium">Capabilities:</span> {s.capabilities.join(", ") || "-"}
            </div>
            <div>
              <span className="font-medium">Certifications:</span>{" "}
              {s.certifications_claimed.length ? `Claimed: ${s.certifications_claimed.join(", ")} (not verified)` : "None claimed"}
            </div>
            {s.quality_notes && (
              <div className="sm:col-span-2">
                <span className="font-medium">Quality notes:</span> {s.quality_notes}
              </div>
            )}
            {s.notes && (
              <div className="sm:col-span-2">
                <span className="font-medium">Notes:</span> {s.notes}
              </div>
            )}
          </div>
          <Tabs<DetailTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "quotes", label: `Quotes (${s.quotes.length})` },
              { value: "comms", label: `Communications (${s.communications.length})` },
              { value: "rfq", label: "Draft RFQ" },
            ]}
          />
          {tab === "quotes" && <QuotesTab supplier={s} projectId={projectId} products={products.data ?? []} onChanged={changed} />}
          {tab === "comms" && <CommunicationsTab supplier={s} onChanged={changed} />}
          {tab === "rfq" && <RfqTab supplier={s} products={products.data ?? []} onChanged={changed} />}
        </div>
      )}
    </Modal>
  );
}
