"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, Calculator, Compass, Flag, Lightbulb, ListChecks, Tag, Target, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { BasisBadge, EVIDENCE_META, FindingCard } from "@/components/evidence";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Modal, StatCard, Td, Th, useEmbedded } from "@/components/ui";
import { del, errorText } from "@/lib/api";
import { date, dateTime, money, num, pct, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { EvidenceType, Finding, ModelSpec, Opportunity } from "@/lib/types";
import { AttractivenessBadge, ConfirmModal, SEVERITY_TONE } from "./shared";

type FindingIndex = Map<string, { finding: Finding; n: number }>;

const chipTone: Record<EvidenceType, string> = {
  sourced: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  ai_inference: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
  assumption: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
  unavailable: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
};

function FindingChips({ ids, index, loading, onOpen }: { ids: string[] | undefined; index: FindingIndex; loading: boolean; onOpen: (f: Finding) => void }) {
  if (!ids || ids.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-slate-400">Evidence:</span>
      {ids.map((id) => {
        const hit = index.get(id);
        if (!hit) {
          return (
            <span key={id} className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-400" title="Finding not found (it may have been deleted)">
              {loading ? "..." : "missing"}
            </span>
          );
        }
        return (
          <button
            key={id}
            onClick={() => onOpen(hit.finding)}
            title={`${EVIDENCE_META[hit.finding.evidence_type]?.label ?? hit.finding.evidence_type}: ${hit.finding.claim}`}
            className={clsx("rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors", chipTone[hit.finding.evidence_type])}
          >
            F{hit.n}
          </button>
        );
      })}
    </div>
  );
}

function Section({ icon, title, subtitle, children, actions }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} actions={actions} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function fmtInput(key: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  if (key.endsWith("_pct")) return pct(v, 1);
  if (key === "moq" || key === "units_per_order") return num(v);
  return money(v);
}

export function ReportView({ projectId, report, onDeleted }: { projectId: string; report: Opportunity; onDeleted: () => void }) {
  const r = report.report ?? ({} as Opportunity["report"]);
  const runId = report.research_run_id;
  const { data: findings, loading: findingsLoading } = useApi<Finding[]>(runId ? `/api/projects/${projectId}/findings?run_id=${runId}` : null);
  const { data: spec } = useApi<ModelSpec>("/api/analytics/model");
  const [open, setOpen] = useState<Finding | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const index: FindingIndex = useMemo(() => {
    const m: FindingIndex = new Map();
    (findings ?? []).forEach((f, i) => m.set(f.id, { finding: f, n: i + 1 }));
    return m;
  }, [findings]);

  const chips = (ids: string[] | undefined) => <FindingChips ids={ids} index={index} loading={findingsLoading} onOpen={setOpen} />;

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await del(`/api/opportunities/${report.id}`);
      setConfirmDelete(false);
      onDeleted();
    } catch (e) {
      setDeleteError(errorText(e));
    } finally {
      setDeleting(false);
    }
  }

  const ue = r.unit_economics;
  const results = ue?.results;
  const embedded = !!useEmbedded();
  const byType = r.evidence_summary?.by_type ?? {};

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Generated {dateTime(r.generated_by?.generated_at ?? report.created_at)}
                {r.generated_by?.model ? ` · ${r.generated_by.model}` : ""}
                {report.budget_usd !== null ? ` · budget ${money(report.budget_usd)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AttractivenessBadge value={r.attractiveness ?? report.attractiveness} />
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Delete report">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete
              </Button>
            </div>
          </div>
          <Alert tone="blue" title="AI synthesis - check the evidence">
            This report is written by AI from the research findings. Judgments (attractiveness, recommendations) are AI inference, not facts. Click an
            evidence chip (F1, F2...) to see the underlying finding, its evidence type, verification status and source.
          </Alert>
          {r.executive_summary && <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{r.executive_summary}</p>}
          {r.evidence_summary && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <span className="font-medium text-slate-700">{r.evidence_summary.findings} findings:</span>
              {(Object.keys(EVIDENCE_META) as EvidenceType[]).map((t) => (
                <Badge key={t} tone={EVIDENCE_META[t].tone}>
                  {byType[t] ?? 0} {EVIDENCE_META[t].label.toLowerCase()}
                </Badge>
              ))}
              <Badge tone="teal">{r.evidence_summary.source_linked} source-linked</Badge>
            </div>
          )}
        </CardBody>
      </Card>

      <Section icon={<Compass className="h-4 w-4" />} title="Opportunity assessment" subtitle="AI judgment based on the linked findings">
        <div className="flex items-center gap-2">
          <AttractivenessBadge value={r.attractiveness ?? report.attractiveness} />
        </div>
        {r.attractiveness_rationale && <p className="mt-2 text-sm leading-relaxed text-slate-700">{r.attractiveness_rationale}</p>}
        {chips(r.attractiveness_finding_ids)}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<Users className="h-4 w-4" />} title="Recommended first segment">
          {r.recommended_segment?.name ? (
            <p className="text-sm font-medium text-slate-900">{r.recommended_segment.name}</p>
          ) : (
            <p className="text-sm text-slate-500">No segment recommended - evidence was insufficient.</p>
          )}
          {r.recommended_segment?.rationale && <p className="mt-1 text-sm text-slate-700">{r.recommended_segment.rationale}</p>}
          {chips(r.recommended_segment?.finding_ids)}
        </Section>
        <Section icon={<Tag className="h-4 w-4" />} title="Pricing">
          {r.pricing?.summary && <p className="text-sm text-slate-700">{r.pricing.summary}</p>}
          <div className="mt-2 text-sm">
            <span className="text-slate-500">Suggested test price range: </span>
            {r.pricing?.test_price_low !== null && r.pricing?.test_price_low !== undefined ? (
              <span className="font-semibold text-slate-900">
                {money(r.pricing.test_price_low)}
                {r.pricing.test_price_high !== null && r.pricing.test_price_high !== undefined ? ` - ${money(r.pricing.test_price_high)}` : ""}
              </span>
            ) : (
              <span className="text-slate-500">not proposed</span>
            )}
          </div>
          {chips(r.pricing?.finding_ids)}
        </Section>
      </div>

      {r.differentiation?.length > 0 && (
        <Section icon={<Lightbulb className="h-4 w-4" />} title="Differentiation opportunities">
          <ul className="space-y-3">
            {r.differentiation.map((d, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-slate-900">{d.idea}</p>
                <p className="mt-0.5 text-sm text-slate-600">{d.rationale}</p>
                {chips(d.finding_ids)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {ue && (
        <Section
          icon={<Calculator className="h-4 w-4" />}
          title="Estimated unit economics"
          subtitle="Inputs proposed by the synthesis; math done by the deterministic calculator. Assumptions are not verified."
          actions={
            <Link href={ue.cost_scenario_id ? `/analytics?scenario=${ue.cost_scenario_id}` : "/analytics"}>
              <Button size="sm" variant="secondary">
                Open in Analytics <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </Link>
          }
        >
          {results && !results.error && !embedded && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Contribution margin / unit" value={money(results.contribution_margin)} hint="after marketing, returns and fees" />
              <StatCard label="Contribution margin %" value={pct(results.contribution_margin_pct)} hint="of revenue after returns" />
              <StatCard label="Break-even CAC" value={money(results.breakeven_cac)} hint="max marketing spend per order" />
              <StatCard label="Landed cost / unit" value={money(results.landed_cost_breakdown?.landed_cost)} hint={`gross margin ${pct(results.gross_margin_pct)}`} />
            </div>
          )}
          {results?.error && <Alert tone="red">{results.error}</Alert>}
          {embedded && results && !results.error && (
            <p className="mb-3 text-sm text-slate-600">Margins and costs from these inputs are in the <a href="#economics" className="font-semibold text-primary-700 hover:underline">Unit economics</a> tab.</p>
          )}
          {!embedded && results?.warnings?.length > 0 && (
            <div className="mb-4 space-y-2">
              {results.warnings.map((w, i) => (
                <Alert key={i}>{w}</Alert>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead>
                <tr>
                  <Th>Input</Th>
                  <Th>Value</Th>
                  <Th>Basis</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(ue.inputs ?? {}).map(([key, d]) => (
                  <tr key={key}>
                    <Td className="whitespace-nowrap font-medium text-slate-800">{spec?.labels[key] ?? titleCase(key)}</Td>
                    <Td className="whitespace-nowrap">{fmtInput(key, d.value)}</Td>
                    <Td>
                      <BasisBadge basis={d.basis} />
                    </Td>
                    <Td className="text-xs text-slate-600">
                      {d.note}
                      {chips(d.finding_ids)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {r.risks?.length > 0 && (
        <Section icon={<AlertTriangle className="h-4 w-4" />} title="Risks">
          <ul className="divide-y divide-slate-100">
            {r.risks.map((risk, i) => (
              <li key={i} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[risk.severity] ?? "slate"}>{titleCase(risk.severity)} severity</Badge>
                  <span className="text-sm font-medium text-slate-900">{risk.risk}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Mitigation:</span> {risk.mitigation}
                </p>
                {chips(risk.finding_ids)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {r.evidence_gaps?.length > 0 && (
          <Section icon={<Target className="h-4 w-4" />} title="Evidence gaps" subtitle="What you still need to know before investing">
            <ul className="space-y-3">
              {r.evidence_gaps.map((g, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium text-slate-900">{g.gap}</p>
                  <p className="mt-0.5 text-slate-600">
                    <span className="text-slate-500">Why it matters:</span> {g.why_it_matters}
                  </p>
                  <p className="mt-0.5 text-slate-600">
                    <span className="text-slate-500">How to close it:</span> {g.how_to_close}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {r.next_steps?.length > 0 && (
          <Section icon={<ListChecks className="h-4 w-4" />} title="Next steps" subtitle="Also saved to your recommendations list">
            <ol className="space-y-3">
              {r.next_steps.map((n, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <Flag className={clsx("mt-0.5 h-4 w-4 shrink-0", "text-slate-400")} aria-label={`${n.priority} priority`} />
                  <div>
                    <p className="font-medium text-slate-900">{n.action}</p>
                    <p className="mt-0.5 text-slate-600">{n.rationale}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>

      <p className="text-center text-[11px] text-slate-400">
        Report created {date(report.created_at)} · {report.category} · {report.geography}
      </p>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open && index.get(open.id) ? `Finding F${index.get(open.id)!.n}` : "Finding"} wide>
        {open && <FindingCard finding={open} />}
      </Modal>
      <ConfirmModal
        open={confirmDelete}
        title="Delete this report?"
        confirmLabel="Delete report"
        danger
        busy={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      >
        <p>The report will be removed. Its research findings, sources and the generated cost scenario are kept.</p>
        {deleteError && <Alert tone="red">{deleteError}</Alert>}
      </ConfirmModal>
    </div>
  );
}
