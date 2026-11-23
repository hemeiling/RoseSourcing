"use client";

import { CheckCircle2, CircleHelp, FlaskConical, Link2, Search, ShieldAlert, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { Badge, ExternalLink, type Tone } from "./ui";
import type { Confidence, EvidenceType, Finding, VerificationStatus } from "@/lib/types";
import { date, domainOf, titleCase } from "@/lib/format";

export const EVIDENCE_META: Record<EvidenceType, { label: string; tone: Tone; help: string }> = {
  sourced: { label: "Sourced evidence", tone: "green", help: "Backed by a retrieved source excerpt." },
  ai_inference: { label: "AI inference", tone: "violet", help: "The model's reasoning - not directly stated by a source." },
  assumption: { label: "Assumption", tone: "slate", help: "A business premise that still needs testing." },
  unavailable: { label: "Data unavailable", tone: "slate", help: "Searched for, but no reliable data was found." },
};

export const VERIFICATION_META: Record<VerificationStatus, { label: string; tone: Tone; help: string }> = {
  source_linked: {
    label: "Source-linked",
    tone: "teal",
    help: "Automated check: the claim's figures/quote appear in a verbatim excerpt from the cited source. Not human-verified.",
  },
  human_verified: { label: "Verified by you", tone: "green", help: "You reviewed the source and confirmed this finding." },
  unverified: { label: "Unverified", tone: "slate", help: "No automated or human verification." },
  disputed: { label: "Disputed", tone: "red", help: "You marked this finding as wrong or unreliable." },
};

const evidenceIcon = { sourced: Link2, ai_inference: Sparkles, assumption: FlaskConical, unavailable: Search };

export function EvidenceBadge({ type }: { type: EvidenceType }) {
  const m = EVIDENCE_META[type] ?? { label: titleCase(type), tone: "slate" as Tone, help: "" };
  const Icon = evidenceIcon[type] ?? CircleHelp;
  return (
    <Badge tone={m.tone} title={m.help}>
      <Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </Badge>
  );
}

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const tone: Tone = "slate";
  return (
    <Badge tone={tone} title="Confidence reflects source quality and how directly it supports the claim">
      {titleCase(level)} confidence
    </Badge>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus | string }) {
  const m = VERIFICATION_META[status as VerificationStatus] ?? { label: titleCase(status), tone: "slate" as Tone, help: "" };
  const Icon = status === "human_verified" ? ShieldCheck : status === "source_linked" ? CheckCircle2 : status === "disputed" ? XCircle : ShieldAlert;
  return (
    <Badge tone={m.tone} title={m.help}>
      <Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </Badge>
  );
}

export function EvidenceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
      {(Object.keys(EVIDENCE_META) as EvidenceType[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <EvidenceBadge type={k} />
          <span className="hidden sm:inline">{EVIDENCE_META[k].help}</span>
        </span>
      ))}
    </div>
  );
}

export function FindingCard({ finding, onReview, compact }: { finding: Finding; onReview?: (f: Finding) => void; compact?: boolean }) {
  const f = finding;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <EvidenceBadge type={f.evidence_type} />
        <ConfidenceBadge level={f.confidence} />
        <VerificationBadge status={f.verification_status} />
        <Badge tone="slate">{titleCase(f.section)}</Badge>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-slate-900">{f.claim}</p>
      {f.detail && !compact && <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{f.detail}</p>}
      {f.metric && (f.metric.value_low !== null || f.metric.value_high !== null) && (
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-medium">{f.metric.name}:</span> {f.metric.value_low ?? ""}
          {f.metric.value_high !== null && f.metric.value_high !== f.metric.value_low ? `-${f.metric.value_high}` : ""} {f.metric.unit}
          {f.metric.year ? ` (${f.metric.year})` : ""}
        </p>
      )}
      {f.flags.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {f.flags.map((fl, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-amber-800">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {fl}
            </li>
          ))}
        </ul>
      )}
      {f.sources.length > 0 && (
        <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2">
          {f.sources.map(({ source, quote }) => (
            <div key={source.id} className="text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-x-2">
                {source.url ? (
                  <ExternalLink href={source.url}>{source.title || domainOf(source.url)}</ExternalLink>
                ) : (
                  <span>{source.title}</span>
                )}
                <span className="text-slate-400">
                  {domainOf(source.url)} · retrieved {date(source.retrieved_at)} · {titleCase(source.source_type)}
                  {source.published_hint ? ` · page age: ${source.published_hint}` : ""}
                </span>
              </div>
              {quote && !compact && <blockquote className="mt-1 border-l-2 border-teal-300 pl-2 italic text-slate-600">&ldquo;{quote}&rdquo;</blockquote>}
            </div>
          ))}
        </div>
      )}
      {f.reviewer_note && <p className="mt-2 text-xs text-slate-600"><span className="font-medium">Your note:</span> {f.reviewer_note}</p>}
      {onReview && (
        <div className="mt-2.5 flex justify-end">
          <button onClick={() => onReview(f)} className="text-xs font-medium text-primary-700 hover:underline">
            Review
          </button>
        </div>
      )}
    </div>
  );
}

export const BASIS_META: Record<string, { label: string; tone: Tone }> = {
  assumption: { label: "Assumption", tone: "slate" },
  supplier_quote: { label: "Supplier quote", tone: "blue" },
  actual: { label: "Actual", tone: "green" },
  sourced_research: { label: "Sourced research", tone: "teal" },
};

export function BasisBadge({ basis }: { basis: string }) {
  const m = BASIS_META[basis] ?? { label: titleCase(basis), tone: "slate" as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
