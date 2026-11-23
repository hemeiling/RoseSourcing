"use client";

import { Check, ClipboardCopy, FileText, Mail, Package, Printer, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ExternalLink, Field, Input, Select, Spinner, Textarea, type Tone } from "@/components/ui";
import { del, errorText, patch, post, put } from "@/lib/api";
import { date, domainOf, money } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const LISTS = [
  ["materials", "Materials"], ["dimensions", "Dimensions"], ["colours_patterns", "Colours & patterns"], ["construction", "Construction"],
  ["quality_requirements", "Quality requirements"], ["packaging_labeling", "Packaging & labelling"],
  ["documents_requested", "Documents we will need"], ["questions", "Questions"],
] as const;
type ListKey = (typeof LISTS)[number][0];

type Spec = Record<ListKey, string[]> & {
  product_name: string; summary: string; quantities: number[]; incoterm: string; destination: string | null;
  sample_request: string; target_unit_cost: number | null; edited_at: string | null; generated_by?: { generated_at: string };
};
type SupplierRow = {
  id: string; name: string; platform: string | null; country: string | null; website: string | null; contact_email: string | null;
  listing_url: string | null; status: "not_contacted" | "drafted" | "sent" | "quoted";
  draft: { id: string; subject: string; body: string } | null; sent_at: string | null;
  quotes: { id: string; quantity: number | null; unit_price: number | null; currency: string; sample_cost: number | null; lead_time_days: number | null; source: string }[];
};
type Sample = {
  id: string; supplier_id: string; supplier_name: string; quantity: number; variant: string | null; unit_cost: number | null;
  shipping_cost: number | null; currency: string; status: string; ordered_on: string | null; received_on: string | null;
  tracking: string | null; scores: Record<string, number>; notes: string | null;
};
type Outreach = { spec: { id: string; content: Spec; text: string; created_at: string } | null; suppliers: SupplierRow[]; samples: Sample[] };

const STATUS: Record<SupplierRow["status"], { label: string; tone: Tone }> = {
  not_contacted: { label: "Not contacted", tone: "slate" }, drafted: { label: "Draft ready", tone: "slate" },
  sent: { label: "Waiting for quote", tone: "amber" }, quoted: { label: "Quoted", tone: "green" },
};
const SAMPLE_STATUS = ["requested", "ordered", "shipped", "received", "approved", "rejected"];
const SCORES = ["comfort", "fit", "durability", "look"];
const TARGET_SUPPLIERS = 5;

function copy(text: string, done: () => void) {
  navigator.clipboard?.writeText(text).then(done).catch(() => undefined);
}

function printSpec(title: string, text: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  w.document.write(`<!doctype html><title>${esc(title)} - spec sheet</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#222}pre{white-space:pre-wrap;font:inherit}</style><h1>${esc(title)}</h1><pre>${esc(text)}</pre>`);
  w.document.close();
  w.focus();
  w.print();
}

function SpecSheet({ projectId, spec, onChange }: { projectId: string; spec: Outreach["spec"]; onChange: () => void }) {
  const [notes, setNotes] = useState("");
  const [form, setForm] = useState<Spec | null>(spec?.content ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setForm(spec?.content ?? null), [spec]);

  const generate = async () => {
    if (spec && !window.confirm("Redraft the spec sheet from the latest research? Your edits will be replaced.")) return;
    setBusy("gen"); setMsg(null);
    try { await post(`/api/projects/${projectId}/spec-sheet`, { notes: notes.trim() || undefined }); onChange(); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!form) return;
    setBusy("save"); setMsg(null);
    try { await put(`/api/projects/${projectId}/spec-sheet`, form); setMsg("Saved."); onChange(); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  };

  if (!spec || !form)
    return (
      <Card>
        <CardHeader icon={<FileText className="h-4 w-4" />} title="1. Spec sheet" subtitle="Drafted from this product's research - review complaints become quality requirements, compliance rules become labelling lines. You edit it before anything goes to a supplier." />
        <CardBody className="space-y-3">
          <Field label="Anything the draft should include (optional)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. tweed and plaid fabrics, 2 colourways, padded band, retail target $28" />
          </Field>
          <Button onClick={generate} loading={busy === "gen"}><Sparkles className="h-4 w-4" /> Draft spec sheet</Button>
          {msg && <Alert tone="red">{msg}</Alert>}
        </CardBody>
      </Card>
    );

  const set = <K extends keyof Spec>(k: K, v: Spec[K]) => setForm({ ...form, [k]: v });
  return (
    <Card>
      <CardHeader icon={<FileText className="h-4 w-4" />} title="1. Spec sheet"
        subtitle={form.edited_at ? `Edited ${date(form.edited_at)}` : "AI draft - check every line, especially values marked '(to confirm)'."}
        actions={<div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => printSpec(form.product_name, spec.text)}><Printer className="h-3.5 w-3.5" /> Print / PDF</Button>
          <Button size="sm" variant="ghost" onClick={generate} loading={busy === "gen"}><Sparkles className="h-3.5 w-3.5" /> Redraft</Button>
        </div>} />
      <CardBody className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Product name"><Input value={form.product_name} onChange={(e) => set("product_name", e.target.value)} /></Field>
          <Field label="Summary"><Textarea rows={2} value={form.summary} onChange={(e) => set("summary", e.target.value)} /></Field>
          {LISTS.map(([k, label]) => (
            <Field key={k} label={label} hint="One per line">
              <Textarea rows={Math.min(8, Math.max(3, (form[k]?.length ?? 0) + 1))} value={(form[k] ?? []).join("\n")}
                onChange={(e) => set(k, e.target.value.split("\n"))} />
            </Field>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Quote quantities"><Input value={form.quantities.join(", ")}
            onChange={(e) => set("quantities", e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0))} /></Field>
          <Field label="Incoterm"><Input value={form.incoterm} onChange={(e) => set("incoterm", e.target.value)} /></Field>
          <Field label="Ship to"><Input value={form.destination ?? ""} onChange={(e) => set("destination", e.target.value || null)} /></Field>
          <Field label="Samples to ask about"><Input value={form.sample_request} onChange={(e) => set("sample_request", e.target.value)} /></Field>
          <Field label="Target unit cost (USD)"><Input type="number" min={0} step="0.01" value={form.target_unit_cost ?? ""}
            onChange={(e) => set("target_unit_cost", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} loading={busy === "save"}>Save spec sheet</Button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

function QuoteForm({ row, quantities, onDone }: { row: SupplierRow; quantities: number[]; onDone: () => void }) {
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [sample, setSample] = useState("");
  const [lead, setLead] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const list = quantities.filter((q) => prices[q]?.trim()).map((q) => ({ quantity: q, unit_price: Number(prices[q]) }));
    if (!list.length) return setErr("Enter at least one unit price.");
    setBusy(true); setErr(null);
    try {
      await post(`/api/suppliers/${row.id}/rfq-quotes`, { prices: list, sample_cost: sample ? Number(sample) : null, lead_time_days: lead ? Number(lead) : null, incoterm: "FOB" });
      onDone();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-canvas p-3 sm:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] sm:items-end">
      {quantities.map((q) => (
        <Field key={q} label={`Unit price at ${q}`}><Input type="number" min={0} step="0.01" value={prices[q] ?? ""} onChange={(e) => setPrices({ ...prices, [q]: e.target.value })} /></Field>
      ))}
      <Field label="Sample cost"><Input type="number" min={0} step="0.01" value={sample} onChange={(e) => setSample(e.target.value)} /></Field>
      <Field label="Lead time (days)"><Input type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
      <Button size="sm" onClick={submit} loading={busy}>Save quote</Button>
      {err && <p className="text-xs text-red-700 sm:col-span-full">{err}</p>}
    </div>
  );
}

function SupplierRfq({ row, quantities, onChange }: { row: SupplierRow; quantities: number[]; onChange: () => void }) {
  const [open, setOpen] = useState<"draft" | "quote" | null>(null);
  const [copied, setCopied] = useState(false);
  const s = STATUS[row.status];
  const rfqQuotes = row.quotes.filter((q) => q.source === "rfq");
  const markSent = async () => { if (row.draft) { await post(`/api/supplier-communications/${row.draft.id}/sent`); onChange(); } };
  const mailto = row.draft && row.contact_email
    ? `mailto:${row.contact_email}?subject=${encodeURIComponent(row.draft.subject)}&body=${encodeURIComponent(row.draft.body)}` : null;
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium text-ink">{row.name}</div>
          <div className="text-xs text-slate-500">
            {[row.platform, row.country].filter(Boolean).join(" · ")}
            {row.listing_url && <> · <ExternalLink href={row.listing_url}>listing on {domainOf(row.listing_url)}</ExternalLink></>}
            {row.website && !row.listing_url && <> · <ExternalLink href={row.website}>{domainOf(row.website)}</ExternalLink></>}
          </div>
          {rfqQuotes.length > 0 && (
            <div className="mt-1 text-xs text-slate-700">
              {rfqQuotes.map((q) => `${q.quantity}: ${money(q.unit_price, { decimals: 2, currency: q.currency })}`).join(" · ")}
              {rfqQuotes[0].sample_cost !== null && ` · sample ${money(rfqQuotes[0].sample_cost, { decimals: 2 })}`}
              {rfqQuotes[0].lead_time_days !== null && ` · ${rfqQuotes[0].lead_time_days} days`}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.tone}>{s.label}{row.sent_at && row.status === "sent" ? ` since ${date(row.sent_at)}` : ""}</Badge>
          {row.draft && <Button size="sm" variant="secondary" onClick={() => setOpen(open === "draft" ? null : "draft")}>Message</Button>}
          {(row.status === "sent" || row.status === "quoted") && <Button size="sm" variant="ghost" onClick={() => setOpen(open === "quote" ? null : "quote")}>Log quote</Button>}
        </div>
      </div>
      {open === "draft" && row.draft && (
        <div className="mt-2 space-y-2 rounded-lg bg-canvas p-3">
          <div className="text-xs font-semibold text-slate-700">{row.draft.subject}</div>
          <Textarea rows={10} readOnly value={row.draft.body} className="text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => copy(`${row.draft!.subject}\n\n${row.draft!.body}`, () => setCopied(true))}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy message"}
            </Button>
            {mailto && <a href={mailto}><Button size="sm" variant="secondary"><Mail className="h-3.5 w-3.5" /> Open in email</Button></a>}
            {row.listing_url && <a href={row.listing_url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary">Message on {domainOf(row.listing_url)}</Button></a>}
            <Button size="sm" onClick={markSent}><Send className="h-3.5 w-3.5" /> I sent it</Button>
          </div>
          <p className="text-xs text-slate-500">136Sourcing does not send messages: send it by email or through the supplier&apos;s marketplace page, then mark it as sent.</p>
        </div>
      )}
      {open === "quote" && <QuoteForm row={row} quantities={quantities} onDone={() => { setOpen(null); onChange(); }} />}
    </li>
  );
}

function Rfqs({ projectId, data, onChange }: { projectId: string; data: Outreach; onChange: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const contacted = data.suppliers.filter((s) => s.status === "sent" || s.status === "quoted").length;
  const fresh = data.suppliers.filter((s) => s.status === "not_contacted");
  const quantities = data.spec?.content.quantities ?? [100, 300, 500];
  const draft = async () => {
    setBusy(true); setErr(null);
    try { await post(`/api/projects/${projectId}/rfq`, { supplier_ids: picked }); setPicked([]); onChange(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader icon={<Send className="h-4 w-4" />} title={`2. Requests for quotation - ${quantities.join(" / ")} units`}
        subtitle="Each message carries the saved spec sheet and asks for a unit price at every quantity, sample cost and lead time."
        actions={<Badge tone={contacted >= TARGET_SUPPLIERS ? "green" : "amber"}>{contacted} of {TARGET_SUPPLIERS}+ suppliers asked</Badge>} />
      <CardBody className="space-y-3">
        {!data.suppliers.length ? (
          <p className="text-sm text-slate-500">No suppliers yet. Use <a href="#suppliers" className="font-semibold text-primary-700 underline">Search supplier listings</a> in Suppliers, or add them there.</p>
        ) : (
          <>
            {fresh.length > 0 && (
              <div className="rounded-lg border border-line p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">Choose suppliers to ask</span>
                  <button className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => setPicked(fresh.map((s) => s.id))}>Select all {fresh.length}</button>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {fresh.map((s) => (
                    <label key={s.id} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1 accent-primary-600" checked={picked.includes(s.id)}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                      <span className="min-w-0">{s.name}<span className="text-xs text-slate-500"> {s.platform ? `· ${s.platform}` : ""}</span></span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={draft} loading={busy} disabled={!picked.length || !data.spec}>Draft {picked.length || ""} RFQ{picked.length === 1 ? "" : "s"}</Button>
                  {!data.spec && <span className="text-xs text-slate-500">Save the spec sheet first.</span>}
                </div>
              </div>
            )}
            {err && <Alert tone="red">{err}</Alert>}
            <ul className="divide-y divide-slate-100 rounded-lg border border-line">
              {data.suppliers.filter((s) => s.status !== "not_contacted").map((s) => <SupplierRfq key={s.id} row={s} quantities={quantities} onChange={onChange} />)}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

const blankSample = { supplier_id: "", quantity: 1, variant: "", unit_cost: "", shipping_cost: "", status: "requested", ordered_on: "", tracking: "" };

function Samples({ projectId, data, onChange }: { projectId: string; data: Outreach; onChange: () => void }) {
  const [form, setForm] = useState(blankSample);
  const [err, setErr] = useState<string | null>(null);
  const quoted = [...data.suppliers].filter((s) => s.quotes.some((q) => q.source === "rfq"))
    .sort((a, b) => Math.min(...a.quotes.map((q) => q.unit_price ?? 1e9)) - Math.min(...b.quotes.map((q) => q.unit_price ?? 1e9)));
  const body = (s: Sample, changes: Partial<Sample>) => ({ ...s, ...changes });
  const add = async () => {
    if (!form.supplier_id) return setErr("Choose a supplier.");
    setErr(null);
    try {
      await post(`/api/projects/${projectId}/samples`, {
        supplier_id: form.supplier_id, quantity: Number(form.quantity) || 1, variant: form.variant || null,
        unit_cost: form.unit_cost === "" ? null : Number(form.unit_cost), shipping_cost: form.shipping_cost === "" ? null : Number(form.shipping_cost),
        status: form.status, ordered_on: form.ordered_on || null, tracking: form.tracking || null,
      });
      setForm(blankSample); onChange();
    } catch (e) { setErr(errorText(e)); }
  };
  const update = async (s: Sample, changes: Partial<Sample>) => { await patch(`/api/samples/${s.id}`, body(s, changes)); onChange(); };
  const active = data.samples.filter((s) => s.status !== "rejected").length;
  return (
    <Card>
      <CardHeader icon={<Package className="h-4 w-4" />} title="3. Samples"
        subtitle="Order and pay on the supplier's platform; track each sample here and score it when it arrives."
        actions={<Badge tone={active >= 2 ? "green" : "amber"}>{active} of 2-3 samples</Badge>} />
      <CardBody className="space-y-3">
        {quoted.length > 0 && active < 2 && (
          <p className="text-sm text-slate-600">Lowest quotes so far: {quoted.slice(0, 3).map((s) => s.name).join(", ")}.</p>
        )}
        {data.samples.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-line">
            {data.samples.map((s) => (
              <li key={s.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{s.supplier_name}{s.variant ? ` · ${s.variant}` : ""}</div>
                    <div className="text-xs text-slate-500">
                      {s.quantity} pc{s.unit_cost !== null ? ` · ${money(s.unit_cost, { decimals: 2 })} each` : ""}
                      {s.shipping_cost !== null ? ` · shipping ${money(s.shipping_cost, { decimals: 2 })}` : ""}
                      {s.ordered_on ? ` · ordered ${date(s.ordered_on)}` : ""}{s.tracking ? ` · tracking ${s.tracking}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select aria-label="Sample status" value={s.status} onChange={(e) => update(s, { status: e.target.value })} className="w-36">
                      {SAMPLE_STATUS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                    </Select>
                    <button className="text-xs text-slate-400 hover:text-red-600" onClick={async () => { if (window.confirm("Delete this sample record?")) { await del(`/api/samples/${s.id}`); onChange(); } }}>Delete</button>
                  </div>
                </div>
                {["received", "approved", "rejected"].includes(s.status) && (
                  <div className="flex flex-wrap gap-3">
                    {SCORES.map((k) => (
                      <label key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
                        {k[0].toUpperCase() + k.slice(1)}
                        <Select aria-label={`${k} score`} value={s.scores[k] ?? ""} className="w-16 py-1 text-xs"
                          onChange={(e) => update(s, { scores: { ...s.scores, [k]: Number(e.target.value) } })}>
                          <option value="">-</option>
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                      </label>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.suppliers.length > 0 && (
          <div className="grid gap-2 rounded-lg bg-canvas p-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Supplier">
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Choose…</option>
                {(quoted.length ? [...quoted, ...data.suppliers.filter((s) => !quoted.includes(s))] : data.suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Variant"><Input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} placeholder="e.g. tweed, black plaid" /></Field>
            <Field label="Pieces"><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {SAMPLE_STATUS.slice(0, 3).map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Cost each (USD)"><Input type="number" min={0} step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></Field>
            <Field label="Shipping (USD)"><Input type="number" min={0} step="0.01" value={form.shipping_cost} onChange={(e) => setForm({ ...form, shipping_cost: e.target.value })} /></Field>
            <Field label="Ordered on"><Input type="date" value={form.ordered_on} onChange={(e) => setForm({ ...form, ordered_on: e.target.value })} /></Field>
            <Button onClick={add}>Add sample</Button>
            {err && <p className="text-xs text-red-700 sm:col-span-full">{err}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Spec sheet -> RFQs to 5+ suppliers at 100/300/500 units -> 2-3 samples. */
export function OutreachSection({ projectId }: { projectId: string }) {
  const data = useApi<Outreach>(`/api/projects/${projectId}/outreach`);
  if (data.loading && !data.data) return <Spinner />;
  if (!data.data) return <Alert tone="red">{data.error ? errorText(data.error) : "Could not load quotes and samples."}</Alert>;
  return (
    <div className="space-y-4">
      <SpecSheet projectId={projectId} spec={data.data.spec} onChange={data.reload} />
      <Rfqs projectId={projectId} data={data.data} onChange={data.reload} />
      <Samples projectId={projectId} data={data.data} onChange={data.reload} />
    </div>
  );
}
