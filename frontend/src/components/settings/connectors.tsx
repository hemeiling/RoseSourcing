"use client";

import { CheckCircle2, CircleDashed, ExternalLink as ExtIcon, KeyRound, PlugZap, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAuth, useStatus } from "@/components/providers";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, PlannedBadge, Spinner } from "@/components/ui";
import { api, errorText, post } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ConnectorStatus } from "@/lib/types";

const GROUPS: { key: string; title: string; blurb: string }[] = [
  { key: "demand", title: "Demand & popularity", blurb: "Google Trends, Google Shopping and Amazon signals that show how popular a product is." },
  { key: "research", title: "Web research", blurb: "Search providers used by every research step." },
  { key: "marketplaces", title: "Marketplaces", blurb: "Your own seller accounts." },
  { key: "social", title: "Social commerce & messaging", blurb: "TikTok, Xiaohongshu and WeChat gateways." },
  { key: "sourcing", title: "Sourcing platforms", blurb: "Alibaba.com and 1688 gateways." },
  { key: "commerce", title: "Store", blurb: "Your online store." },
];

function StateBadge({ c }: { c: ConnectorStatus }) {
  if (!c.active) return c.state === "credentials_saved" ? <Badge tone="blue">Credentials saved</Badge> : <PlannedBadge />;
  if (c.configured) return <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Connected{c.source === "environment" ? " (server env)" : ""}</Badge>;
  return <Badge tone="amber"><CircleDashed className="h-3 w-3" /> Not connected</Badge>;
}

function ConnectorCard({ c, owner, onChanged }: { c: ConnectorStatus; owner: boolean; onChanged: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean | null; text: string } | null>(null);

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const r = await api<{ test_ok: boolean | null; test_message: string | null }>(`/api/connectors/${c.key}`, { method: "PUT", body: { fields: values } });
      setValues({});
      setMsg({ ok: r.test_ok, text: r.test_message ?? (c.active ? "Saved." : "Saved. This gateway's data adapter is not active yet.") });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    setBusy("test");
    try {
      const r = await post<{ ok: boolean; message: string }>(`/api/connectors/${c.key}/test`);
      setMsg({ ok: r.ok, text: r.message });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    setBusy("remove");
    try {
      await api(`/api/connectors/${c.key}`, { method: "DELETE" });
      setMsg({ ok: null, text: "Removed." });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const hasStored = c.source === "app";
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-serif text-base font-semibold text-ink">{c.name}</div>
          <p className="mt-0.5 text-[13px] text-slate-600">{c.provides}</p>
        </div>
        <StateBadge c={c} />
      </div>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        <div><dt className="inline font-semibold text-slate-700">You need: </dt><dd className="inline">{c.requirements}</dd></div>
        <div><dt className="inline font-semibold text-slate-700">Cost: </dt><dd className="inline">{c.cost}</dd></div>
        {c.login_note && <div><dt className="inline font-semibold text-slate-700">Sign-in: </dt><dd className="inline">{c.login_note}</dd></div>}
      </dl>
      {c.setup_url && (
        <a href={c.setup_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800">
          Where to get credentials <ExtIcon className="h-3 w-3" />
        </a>
      )}
      {c.fields.length > 0 && owner && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {c.fields.map((f) => (
            <Field key={f.name} label={f.label} hint={f.hint ? `Saved: ${f.hint} (leave blank to keep)` : f.env ? `Or set ${f.env} on the server` : undefined}>
              <Input type={f.secret ? "password" : "text"} autoComplete="off" value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} placeholder={f.hint ? "••••••••" : ""} />
            </Field>
          ))}
        </div>
      )}
      {c.fields.length > 0 && !owner && <p className="mt-3 text-xs text-slate-500">Only the workspace owner can change connector credentials.</p>}
      {owner && (c.fields.length > 0 || c.active) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.fields.length > 0 && <Button size="sm" loading={busy === "save"} disabled={!Object.values(values).some((v) => v.trim())} onClick={save}><KeyRound className="h-3.5 w-3.5" /> Save</Button>}
          {c.active && <Button size="sm" variant="secondary" loading={busy === "test"} onClick={test}><PlugZap className="h-3.5 w-3.5" /> Test</Button>}
          {hasStored && <Button size="sm" variant="ghost" loading={busy === "remove"} onClick={remove}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>}
        </div>
      )}
      {(msg || c.last_test_message) && (
        <p className={`mt-2 text-xs ${(msg ? msg.ok : c.last_test_ok) === false ? "text-red-700" : (msg ? msg.ok : c.last_test_ok) ? "text-emerald-700" : "text-slate-600"}`}>
          {msg ? msg.text : `${c.last_test_message} (${dateTime(c.last_tested_at)})`}
        </p>
      )}
    </div>
  );
}

export function ConnectorsSection() {
  const { user } = useAuth();
  const { reload: reloadStatus } = useStatus();
  const { data, loading, error, reload } = useApi<ConnectorStatus[]>("/api/connectors");
  const owner = user?.role === "owner";
  const changed = () => { reload(); reloadStatus(); };

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Data sources & connectors" icon={<PlugZap className="h-4 w-4" />}
        subtitle="Connect the platforms research and the copilot can use. Keys are encrypted and never shown again; the last 4 characters identify them. Platforms marked Planned are gateways: credentials can be stored now, and their data sync will switch on when the adapter ships." />
      <CardBody className="space-y-6">
        {error && <Alert tone="red">{errorText(error)}</Alert>}
        {loading && !data ? <Spinner /> : GROUPS.map((g) => {
          const items = (data ?? []).filter((c) => c.group === g.key);
          if (!items.length) return null;
          return (
            <section key={g.key}>
              <h3 className="font-serif text-lg font-semibold text-brand-700">{g.title}</h3>
              <p className="mb-2 text-xs text-slate-500">{g.blurb}</p>
              <div className="grid gap-3 md:grid-cols-2">{items.map((c) => <ConnectorCard key={c.key} c={c} owner={owner} onChanged={changed} />)}</div>
            </section>
          );
        })}
      </CardBody>
    </Card>
  );
}
