"use client";

import { AlertTriangle, Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Th, Td } from "@/components/ui";
import { money } from "@/lib/format";

/* Kind-specific renderers for BrandConcept.content. Shapes mirror backend/app/services/agents/generators.py. */

type Obj = Record<string, unknown>;

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

function List({ items }: { items: unknown[] }) {
  if (!items.length) return <p className="text-sm text-slate-400">None</p>;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
      {items.map((it, i) => (
        <li key={i}>{asStr(it)}</li>
      ))}
    </ul>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      aria-label={`${label}: ${text}`}
    >
      {done ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {done ? "Copied" : label}
    </button>
  );
}

function NamesView({ c }: { c: Obj }) {
  const ideas = asArr(c.ideas).map(asObj);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Trademark and domain availability have not been checked. Search USPTO and domain registrars before using a name.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ideas.map((n, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">{asStr(n.name)}</span>
              {asStr(n.style) && <Badge tone="slate">{asStr(n.style)}</Badge>}
            </div>
            <p className="mt-1 text-[13px] text-slate-600">{asStr(n.rationale)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositioningView({ c }: { c: Obj }) {
  return (
    <div className="space-y-3">
      <blockquote className="rounded-lg border-l-4 border-brand-400 bg-brand-50 px-3 py-2 text-sm text-slate-800">{asStr(c.statement)}</blockquote>
      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Target customer">
          <p className="text-sm text-slate-700">{asStr(c.target_customer)}</p>
        </Section>
        <Section title="Frame of reference">
          <p className="text-sm text-slate-700">{asStr(c.frame_of_reference)}</p>
        </Section>
        <Section title="Points of difference">
          <List items={asArr(c.points_of_difference)} />
        </Section>
        <Section title="Reasons to believe">
          <List items={asArr(c.reasons_to_believe)} />
        </Section>
      </div>
      <Section title="Assumptions to validate">
        <List items={asArr(c.assumptions_to_validate)} />
      </Section>
    </div>
  );
}

function PersonasView({ c }: { c: Obj }) {
  const personas = asArr(c.personas).map(asObj);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {personas.map((p, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="text-sm font-semibold text-slate-900">{asStr(p.name)}</div>
          <div className="mt-0.5 text-[11px] italic text-slate-500">Illustrative composite, not a real customer</div>
          <p className="mt-2 text-[13px] text-slate-700">{asStr(p.summary)}</p>
          {asStr(p.dance_context) && <p className="mt-1 text-xs text-slate-600"><span className="font-medium">Context:</span> {asStr(p.dance_context)}</p>}
          <div className="mt-2 space-y-2">
            <Section title="Goals"><List items={asArr(p.goals)} /></Section>
            <Section title="Frustrations"><List items={asArr(p.frustrations)} /></Section>
            <Section title="Buying triggers"><List items={asArr(p.buying_triggers)} /></Section>
            <Section title="Channels"><List items={asArr(p.channels)} /></Section>
          </div>
          {asStr(p.grounding) && (
            <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              <span className="font-medium">Grounding:</span> {asStr(p.grounding)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function VoiceView({ c }: { c: Obj }) {
  const traits = asArr(c.traits).map(asObj);
  return (
    <div className="space-y-3">
      {asStr(c.summary) && <p className="text-sm text-slate-700">{asStr(c.summary)}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead>
            <tr>
              <Th>Trait</Th>
              <Th>Do</Th>
              <Th>Don&apos;t</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {traits.map((t, i) => (
              <tr key={i}>
                <Td className="font-medium text-slate-900">{asStr(t.trait)}</Td>
                <Td>{asStr(t.do)}</Td>
                <Td>{asStr(t.dont)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Sample lines"><List items={asArr(c.sample_lines)} /></Section>
        <Section title="Words to avoid"><List items={asArr(c.words_to_avoid)} /></Section>
      </div>
    </div>
  );
}

function CollectionsView({ c }: { c: Obj }) {
  const cols = asArr(c.collections).map(asObj);
  return (
    <div className="space-y-3">
      {cols.map((col, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{asStr(col.name)}</span>
            {asStr(col.target_segment) && <Badge tone="blue">{asStr(col.target_segment)}</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-slate-600">{asStr(col.theme)}</p>
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-100">
            {asArr(col.pieces).map(asObj).map((p, j) => (
              <li key={j} className="flex items-start justify-between gap-3 px-2.5 py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{asStr(p.name)}</div>
                  <div className="text-xs text-slate-500">{asStr(p.description)}</div>
                </div>
                <span className="shrink-0 text-xs text-slate-600" title="Target price (assumption)">
                  {typeof p.target_price === "number" ? money(p.target_price) : "-"}
                </span>
              </li>
            ))}
          </ul>
          {asStr(col.rationale) && <p className="mt-2 text-xs text-slate-500"><span className="font-medium">Rationale:</span> {asStr(col.rationale)}</p>}
        </div>
      ))}
    </div>
  );
}

const HEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

function PalettesView({ c }: { c: Obj }) {
  const palettes = asArr(c.palettes).map(asObj);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {palettes.map((p, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="text-sm font-semibold text-slate-900">{asStr(p.name)}</div>
          <p className="text-xs text-slate-500">{asStr(p.mood)}</p>
          <div className="mt-2 flex h-10 overflow-hidden rounded-md ring-1 ring-slate-200">
            {asArr(p.colors).map(asObj).map((s, j) => {
              const hex = asStr(s.hex);
              return <div key={j} className="flex-1" style={{ backgroundColor: HEX.test(hex) ? hex : "#e2e8f0" }} title={`${asStr(s.name)} ${hex}`} />;
            })}
          </div>
          <ul className="mt-2 space-y-1">
            {asArr(p.colors).map(asObj).map((s, j) => {
              const hex = asStr(s.hex);
              return (
                <li key={j} className="flex items-center gap-2 text-xs">
                  <span className="h-4 w-4 shrink-0 rounded ring-1 ring-slate-200" style={{ backgroundColor: HEX.test(hex) ? hex : "#e2e8f0" }} />
                  <span className="font-medium text-slate-800">{asStr(s.name)}</span>
                  <code className="text-slate-500">{hex}</code>
                  <span className="min-w-0 flex-1 break-words text-slate-500" title={asStr(s.usage)}>{asStr(s.usage)}</span>
                  <CopyButton text={hex} label="Hex" />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CopyList({ items }: { items: unknown[] }) {
  if (!items.length) return <p className="text-sm text-slate-400">None</p>;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="flex items-start justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">
          <span>{asStr(it)}</span>
          <CopyButton text={asStr(it)} />
        </li>
      ))}
    </ul>
  );
}

function MessagingView({ c }: { c: Obj }) {
  return (
    <div className="space-y-3">
      {asStr(c.product_page_headline) && (
        <Section title="Product page headline">
          <div className="flex items-start justify-between gap-2 rounded-md bg-brand-50 px-3 py-2 text-base font-semibold text-slate-900">
            <span>{asStr(c.product_page_headline)}</span>
            <CopyButton text={asStr(c.product_page_headline)} />
          </div>
        </Section>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Taglines"><CopyList items={asArr(c.taglines)} /></Section>
        <Section title="Value propositions"><CopyList items={asArr(c.value_propositions)} /></Section>
        <Section title="Ad hooks"><CopyList items={asArr(c.ad_hooks)} /></Section>
        <Section title="Email subject lines"><CopyList items={asArr(c.email_subject_lines)} /></Section>
      </div>
    </div>
  );
}

function JsonView({ c }: { c: Obj }) {
  return <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(c, null, 2)}</pre>;
}

const KNOWN_KEY: Record<string, string> = {
  names: "ideas",
  personas: "personas",
  collections: "collections",
  palettes: "palettes",
};

export function ConceptContent({ kind, content }: { kind: string; content: Record<string, unknown> }) {
  const c = asObj(content);
  // Fall back to JSON when the shape doesn't match what the renderer expects.
  const key = KNOWN_KEY[kind];
  if (key && !Array.isArray(c[key])) return <JsonView c={c} />;
  switch (kind) {
    case "names":
      return <NamesView c={c} />;
    case "positioning":
      return typeof c.statement === "string" ? <PositioningView c={c} /> : <JsonView c={c} />;
    case "personas":
      return <PersonasView c={c} />;
    case "voice":
      return Array.isArray(c.traits) ? <VoiceView c={c} /> : <JsonView c={c} />;
    case "collections":
      return <CollectionsView c={c} />;
    case "palettes":
      return <PalettesView c={c} />;
    case "messaging":
      return Array.isArray(c.taglines) ? <MessagingView c={c} /> : <JsonView c={c} />;
    default:
      return <JsonView c={c} />;
  }
}
