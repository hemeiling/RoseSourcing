"use client";

import type { ReactNode } from "react";
import { Badge, Button, Modal, type Tone } from "@/components/ui";
import type { ResearchRun } from "@/lib/types";
import { AGENTS } from "@/lib/agents";
import { useT, type MsgKey } from "@/lib/i18n";

export const isActive = (s: string) => s === "queued" || s === "running";
export const RESUMABLE_STATUSES = ["interrupted", "failed", "completed_with_errors", "cancelled"];

export const RUN_STATUS_META: Record<ResearchRun["status"], { label: MsgKey; tone: Tone }> = {
  queued: { label: "Queued", tone: "slate" },
  running: { label: "Running", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  completed_with_errors: { label: "Completed with errors", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
  interrupted: { label: "Interrupted", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

export function RunStatusBadge({ status }: { status: ResearchRun["status"] }) {
  const { tx } = useT();
  const m = RUN_STATUS_META[status] ?? { label: status, tone: "slate" as Tone };
  return <Badge tone={m.tone}>{tx(m.label)}</Badge>;
}

/** A run's agent, by the same name the agents list uses. */
export const KIND_LABEL: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.kind, a.name]));

export const ATTRACTIVENESS_META: Record<string, { label: MsgKey; tone: Tone; help: MsgKey }> = {
  promising: { label: "Promising", tone: "green", help: "AI judgment based on the linked findings" },
  mixed: { label: "Mixed", tone: "amber", help: "AI judgment based on the linked findings" },
  weak: { label: "Weak", tone: "red", help: "AI judgment based on the linked findings" },
  insufficient_evidence: { label: "Insufficient evidence", tone: "slate", help: "Not enough evidence to judge attractiveness" },
};

export function AttractivenessBadge({ value }: { value: string | null | undefined }) {
  const { tx, t } = useT();
  if (!value) return <Badge tone="slate">{t("Not assessed")}</Badge>;
  const m = ATTRACTIVENESS_META[value] ?? { label: value, tone: "slate" as Tone, help: "" };
  return (
    <Badge tone={m.tone} title={tx(m.help)}>
      {tx(m.label)} <span className="font-normal opacity-70">{t("· AI judgment")}</span>
    </Badge>
  );
}

export const SEVERITY_TONE: Record<string, Tone> = { high: "red", medium: "amber", low: "slate" };

export const SECTIONS = [
  "demand",
  "market_size",
  "growth",
  "customer_segments",
  "unmet_needs",
  "competitors",
  "pricing",
  "differentiation",
  "sourcing_costs",
  "channels",
  "risks",
  "regulatory",
  "logistics",
  "fit",
  "other",
];

export function fmtCost(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `$${v.toFixed(v > 0 && v < 1 ? 3 : 2)}`;
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
  danger,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const { t } = useT();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4 text-sm text-slate-700">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
