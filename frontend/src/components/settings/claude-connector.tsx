"use client";

import { Bot, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Spinner, Td, Th } from "@/components/ui";
import { api, errorText, post } from "@/lib/api";
import { ago, date } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Tokens = { mcp_url: string; tokens: { id: string; name: string; last4: string; created_at: string; last_used_at: string | null }[] };
type Created = { token: string; mcp_url: string; connector_url: string };

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-700">{label}</div>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line bg-canvas px-2.5 py-2 text-xs">{value}</code>
        <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function ClaudeConnectorSection() {
  const { data, loading, reload } = useApi<Tokens>("/api/tokens");
  const [name, setName] = useState("Claude");
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setCreated(await post<Created>("/api/tokens", { name }));
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card >
      <CardHeader title="Claude connector" icon={<Bot className="h-4 w-4" />}
        subtitle="Work on any product from Claude (claude.ai, desktop or Claude Code) alongside your other Claude connectors. Claude can list your product projects, start research, add competitors and suppliers, draft RFQs, compare channels and shipping, generate decision briefs and record your go / no-go decisions." />
      <CardBody className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Create a personal token below. It is shown once; treat it like a password.</li>
          <li>In Claude: <strong>Settings → Connectors → Add custom connector</strong>, and paste the <em>connector URL</em> (it includes your token).</li>
          <li>For Claude Code or tools that support headers, use the MCP URL with <code>Authorization: Bearer &lt;token&gt;</code>.</li>
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Token name" className="w-56"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button loading={busy} onClick={create}><Plus className="h-4 w-4" /> Create token</Button>
        </div>
        {error && <Alert tone="red">{error}</Alert>}
        {created && (
          <div className="space-y-3 rounded-lg border-2 border-accent-500 bg-accent-50 p-4">
            <p className="text-sm font-semibold text-accent-700">Copy these now - the token will not be shown again.</p>
            <Copyable label="Connector URL for Claude (Add custom connector)" value={created.connector_url} />
            <Copyable label="Claude Code command" value={`claude mcp add --transport http ai-commerce-os ${created.mcp_url} --header "Authorization: Bearer ${created.token}"`} />
          </div>
        )}
        {loading && !data ? <Spinner /> : data && data.tokens.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead className="border-b border-line"><tr><Th>Name</Th><Th>Token</Th><Th>Created</Th><Th>Last used</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.tokens.map((t) => (
                  <tr key={t.id}>
                    <Td>{t.name}</Td><Td className="font-mono text-xs">aicos_…{t.last4}</Td><Td className="text-xs">{date(t.created_at)}</Td>
                    <Td className="text-xs">{t.last_used_at ? ago(t.last_used_at) : "never"}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={async () => { await api(`/api/tokens/${t.id}`, { method: "DELETE" }).catch(() => {}); reload(); }}>
                      <Trash2 className="h-3.5 w-3.5" /> Revoke</Button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
