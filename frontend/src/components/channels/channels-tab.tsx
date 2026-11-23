"use client";

import { AlertTriangle, Pencil, Plus, Store, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Td, Textarea, Th } from "@/components/ui";
import { del, errorText, post, put } from "@/lib/api";
import { money, pct, titleCase } from "@/lib/format";
import { useApi, useNarrow, truncate } from "@/lib/hooks";
import type { ChannelEconomicsRow, SalesChannel, Scenario } from "@/lib/types";
import { CHANNEL_STATUS_TONE, CHANNEL_TYPE_LABEL, FeeBasisBadge } from "./meta";

// Presets set only the name and type. Fees are left blank on purpose: enter them from the platform's fee page or run research.
const PRESETS: { name: string; channel_type: string; platform?: string }[] = [
  { name: "Own Shopify store", channel_type: "own_store", platform: "Shopify" },
  { name: "Amazon", channel_type: "marketplace", platform: "Amazon" },
  { name: "Etsy", channel_type: "marketplace", platform: "Etsy" },
  { name: "eBay", channel_type: "marketplace", platform: "eBay" },
  { name: "TikTok Shop", channel_type: "social_commerce", platform: "TikTok" },
  { name: "Instagram / Facebook Shops", channel_type: "social_commerce", platform: "Meta" },
  { name: "Wholesale to dance studios & instructors", channel_type: "wholesale" },
  { name: "Competitions & events", channel_type: "events" },
];

const NUM_FIELDS: [keyof SalesChannel, string, string][] = [
  ["price", "Selling price on this channel", "Wholesale price for wholesale channels"],
  ["commission_pct", "Commission / referral %", "From the platform's fee page"],
  ["per_order_fee", "Per-order / transaction fee", ""],
  ["payment_fee_pct", "Payment processing %", ""],
  ["payment_fee_fixed", "Payment fee fixed / order", ""],
  ["monthly_fee", "Monthly plan / subscription", ""],
  ["expected_monthly_units", "Expected units / month", "Spreads the monthly fee per unit"],
  ["fulfillment_per_order", "Fulfillment / order", "Pick, pack and postage"],
  ["marketing_cac", "Marketing cost / order", ""],
  ["return_rate_pct", "Return rate %", ""],
];

type Form = Record<string, string>;

function toForm(c: Partial<SalesChannel>): Form {
  const f: Form = {
    name: c.name ?? "", channel_type: c.channel_type ?? "marketplace", platform: c.platform ?? "", status: c.status ?? "considering",
    fee_basis: c.fee_basis ?? "assumption", fee_source_url: c.fee_source_url ?? "", fees_checked_at: c.fees_checked_at ?? "",
    audience_fit: c.audience_fit ?? "", requirements: c.requirements ?? "", pros: (c.pros ?? []).join("\n"), cons: (c.cons ?? []).join("\n"), notes: c.notes ?? "",
  };
  for (const [k] of NUM_FIELDS) f[k] = c[k] === null || c[k] === undefined ? "" : String(c[k]);
  return f;
}

function ChannelForm({ projectId, editing, preset, onSaved, onCancel }: {
  projectId: string; editing: SalesChannel | null; preset: Partial<SalesChannel> | null; onSaved: () => void; onCancel: () => void;
}) {
  const [f, setF] = useState<Form>(toForm(editing ?? preset ?? {}));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: f.name.trim(), channel_type: f.channel_type, platform: f.platform.trim() || null, status: f.status, fee_basis: f.fee_basis,
      fee_source_url: f.fee_source_url.trim() || null, fees_checked_at: f.fees_checked_at || null, audience_fit: f.audience_fit.trim() || null,
      requirements: f.requirements.trim() || null, notes: f.notes.trim() || null,
      pros: f.pros.split("\n").map((x) => x.trim()).filter(Boolean), cons: f.cons.split("\n").map((x) => x.trim()).filter(Boolean),
    };
    for (const [k] of NUM_FIELDS) body[k] = f[k].trim() === "" ? null : Number(f[k]);
    try {
      if (editing) await put(`/api/channels/${editing.id}`, body);
      else await post(`/api/projects/${projectId}/channels`, body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Channel name" className="sm:col-span-2"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label="Type">
          <Select value={f.channel_type} onChange={set("channel_type")}>{Object.entries(CHANNEL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>{["considering", "testing", "active", "paused", "rejected"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        </Field>
      </div>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-600">Economics - leave blank to use your latest cost scenario</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {NUM_FIELDS.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint || undefined}><Input type="number" min={0} step="any" value={f[k]} onChange={set(k)} /></Field>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where the fees came from">
          <Select value={f.fee_basis} onChange={set("fee_basis")}>
            <option value="assumption">Assumption - not checked</option>
            <option value="verified">Verified - I checked the current fee page</option>
            {editing?.fee_basis === "sourced_research" && <option value="sourced_research">From research source</option>}
          </Select>
        </Field>
        <Field label="Fees checked on"><Input type="date" value={f.fees_checked_at} onChange={set("fees_checked_at")} /></Field>
        <Field label="Fee page URL" className="sm:col-span-2"><Input type="url" value={f.fee_source_url} onChange={set("fee_source_url")} /></Field>
        <Field label="Audience fit" className="sm:col-span-2"><Textarea rows={2} value={f.audience_fit} onChange={set("audience_fit")} /></Field>
        <Field label="Requirements / restrictions" className="sm:col-span-2"><Textarea rows={2} value={f.requirements} onChange={set("requirements")} /></Field>
        <Field label="Pros" hint="One per line"><Textarea rows={3} value={f.pros} onChange={set("pros")} /></Field>
        <Field label="Cons" hint="One per line"><Textarea rows={3} value={f.cons} onChange={set("cons")} /></Field>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>{editing ? "Save channel" : "Add channel"}</Button>
      </div>
    </form>
  );
}

export function ChannelsTab({ projectId, version }: { projectId: string; version: number }) {
  const channels = useApi<SalesChannel[]>(`/api/projects/${projectId}/channels`);
  const econ = useApi<{ base_scenario: string; base_price: number; rows: ChannelEconomicsRow[] }>(`/api/projects/${projectId}/channels/compare`);
  const [editing, setEditing] = useState<SalesChannel | null>(null);
  const [preset, setPreset] = useState<Partial<SalesChannel> | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenarioFor, setScenarioFor] = useState<Record<string, string>>({});

  const reload = () => {
    channels.reload();
    econ.reload();
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function remove(c: SalesChannel) {
    try {
      await del(`/api/channels/${c.id}`);
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function model(id: string) {
    try {
      const sc = await post<Scenario>(`/api/projects/${projectId}/scenarios/from-channel/${id}`);
      setScenarioFor((c) => ({ ...c, [id]: sc.id }));
    } catch (e) {
      setError(errorText(e));
    }
  }

  const byId = Object.fromEntries((channels.data ?? []).map((c) => [c.id, c]));
  const existing = new Set((channels.data ?? []).map((c) => c.name.toLowerCase()));
  const rows = econ.data?.rows ?? [];
  const narrow = useNarrow();
  const chart = rows.map((r) => ({ name: r.name, value: r.contribution_margin_after_monthly_fee ?? r.contribution_margin }));

  return (
    <div className="space-y-5">
      {error && <Alert tone="red">{error}</Alert>}
      <Card>
        <CardHeader title="Channel economics" icon={<Store className="h-4 w-4" />}
          subtitle={econ.data ? `Per-unit contribution on each channel at ${money(econ.data.base_price)} retail. Price and blank channel fields come from your latest saved cost scenario ('${econ.data.base_scenario}') - change them in Unit economics and save.` : undefined}
          actions={<Button size="sm" onClick={() => { setEditing(null); setPreset(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add channel</Button>} />
        {econ.loading && !econ.data ? <CardBody><Spinner /></CardBody> : rows.length === 0 ? (
          <CardBody>
            <EmptyState icon={<Store className="h-5 w-5" />} title="No sales channels yet">
              Add the places you might sell. Fees are left blank until you enter them from the platform&apos;s fee page or the research finds them in a source.
            </EmptyState>
          </CardBody>
        ) : (
          <CardBody className="space-y-4">
            {/* Horizontal bars: channel names sit on the left, so they never overlap however many channels there are. */}
            <div style={{ height: Math.max(140, chart.length * 30 + 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `$${Number(v).toFixed(2)}`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={narrow ? 112 : 200} fontSize={11} interval={0}
                    tickFormatter={(s: string) => truncate(s, narrow ? 17 : 32)} />
                  <ReferenceLine x={0} stroke="#94a3b8" />
                  <Tooltip formatter={(v) => [money(Number(v)), "Contribution / unit"]} />
                  <Bar dataKey="value" barSize={16} radius={[0, 3, 3, 0]}>{chart.map((d) => <Cell key={d.name} fill={d.value >= 0 ? "#0f9e90" : "#e8467c"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="border-b border-slate-100 bg-slate-50">
                  <tr><Th>Channel</Th><Th>Price</Th><Th>Channel fees</Th><Th>Payment fees</Th><Th>Contribution / unit</Th><Th>Break-even CAC</Th><Th>Fees</Th><Th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const c = byId[r.channel_id];
                    // The fee-basis badge already flags assumed fees, so don't repeat that warning here.
                    const warnings = r.warnings.filter((w) => !w.startsWith("Fees are assumptions"));
                    return (
                      <tr key={r.channel_id}>
                        <Td className="min-w-[14rem]">
                          <div className="font-medium text-slate-900">{r.name}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            <Badge>{CHANNEL_TYPE_LABEL[r.channel_type] ?? r.channel_type}</Badge>
                            <Badge tone={CHANNEL_STATUS_TONE[r.status] ?? "slate"}>{titleCase(r.status)}</Badge>
                            {r.fees_on_file === false && <Badge tone="amber">No fees on file</Badge>}
                          </div>
                          {warnings.length > 0 && (
                            <div className="mt-1 flex gap-1 text-[11px] text-amber-700" title={warnings.join("\n")}>
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>{warnings[0]}{warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}</span>
                            </div>
                          )}
                        </Td>
                        <Td>{money(r.price)}</Td>
                        <Td className={r.fees_on_file === false ? "text-slate-400" : undefined}>{money(r.channel_fees_per_unit)}{r.fees_on_file === false && " ?"}</Td>
                        <Td className={r.fees_on_file === false ? "text-slate-400" : undefined}>{money(r.payment_fees_per_unit)}{r.fees_on_file === false && " ?"}</Td>
                        <Td>
                          <span className={r.contribution_margin >= 0 ? "font-medium text-ink" : "font-medium text-red-700"}>{money(r.contribution_margin)}</span>
                          <span className="ml-1 text-xs text-slate-500">{pct(r.contribution_margin_pct)}</span>
                          {r.contribution_margin_after_monthly_fee !== null && <div className="text-[11px] text-slate-500">{money(r.contribution_margin_after_monthly_fee)} after monthly fee</div>}
                        </Td>
                        <Td>{money(r.breakeven_cac)}</Td>
                        <Td><FeeBasisBadge basis={r.fee_basis} url={r.fee_source_url} checked={r.fees_checked_at} /></Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            {scenarioFor[r.channel_id] ? (
                              <Link href={`/analytics?scenario=${scenarioFor[r.channel_id]}`} className="text-xs font-medium text-primary-700 hover:underline">Open scenario →</Link>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => model(r.channel_id)} title="Save these channel economics as a cost scenario">Model</Button>
                            )}
                            {c && <Button size="sm" variant="ghost" aria-label="Edit channel" onClick={() => { setEditing(c); setPreset(null); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                            {c && <Button size="sm" variant="ghost" aria-label="Delete channel" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Quick add" subtitle="Adds the channel with name and type only - no fees are filled in for you." />
        <CardBody className="flex flex-wrap gap-2">
          {PRESETS.filter((p) => !existing.has(p.name.toLowerCase())).map((p) => (
            <Button key={p.name} size="sm" variant="secondary" onClick={() => { setEditing(null); setPreset(p as Partial<SalesChannel>); setOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> {p.name}
            </Button>
          ))}
        </CardBody>
      </Card>

      {(channels.data ?? []).some((c) => c.audience_fit || c.requirements || c.pros.length || c.cons.length) && (
        <Card>
          <CardHeader title="Channel notes" subtitle="Audience fit, requirements, pros and cons" />
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            {(channels.data ?? []).filter((c) => c.audience_fit || c.requirements || c.pros.length || c.cons.length).map((c) => (
              <div key={c.id} className="bg-white px-5 py-3.5 text-sm">
                <div className="font-medium text-slate-900">{c.name}</div>
                {c.audience_fit && <p className="mt-1 text-xs text-slate-600"><span className="font-medium">Audience:</span> {c.audience_fit}</p>}
                {c.requirements && <p className="mt-1 text-xs text-slate-600"><span className="font-medium">Requirements:</span> {c.requirements}</p>}
                {c.pros.length > 0 && <ul className="mt-1 text-xs text-emerald-800">{c.pros.map((p) => <li key={p}>+ {p}</li>)}</ul>}
                {c.cons.length > 0 && <ul className="mt-1 text-xs text-red-700">{c.cons.map((p) => <li key={p}>− {p}</li>)}</ul>}
                {c.notes && <p className="mt-1 text-[11px] text-slate-500">{c.notes}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.name}` : "Add sales channel"} wide>
        {open && <ChannelForm key={editing?.id ?? preset?.name ?? "new"} projectId={projectId} editing={editing} preset={preset}
          onSaved={() => { setOpen(false); reload(); }} onCancel={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}
