"use client";

import { FileSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EVIDENCE_META, EvidenceLegend, FindingCard, VERIFICATION_META } from "@/components/evidence";
import { Alert, Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { errorText, patch } from "@/lib/api";
import { dateTime, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { EvidenceType, Finding, ResearchRun, VerificationStatus } from "@/lib/types";
import { KIND_LABEL, SECTIONS } from "./shared";

const REVIEWABLE: VerificationStatus[] = ["human_verified", "disputed", "unverified"];

function ReviewModal({ finding, onClose, onSaved }: { finding: Finding | null; onClose: () => void; onSaved: (f: Finding) => void }) {
  const { t, tx } = useT();
  const [status, setStatus] = useState<VerificationStatus>("human_verified");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!finding) return;
    setStatus(finding.verification_status === "human_verified" || finding.verification_status === "disputed" ? finding.verification_status : "human_verified");
    setNote(finding.reviewer_note ?? "");
    setError(null);
  }, [finding]);

  async function save() {
    if (!finding) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await patch<Finding>(`/api/findings/${finding.id}`, { verification_status: status, reviewer_note: note.trim() || null }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!finding} onClose={onClose} title={t("Review finding")} wide>
      {finding && (
        <div className="space-y-4">
          <FindingCard finding={finding} />
          <Alert tone="blue">
            {t("Open the source link and confirm the claim yourself. “{label}” is set only by the automated excerpt check and cannot be chosen here.", { label: tx(VERIFICATION_META.source_linked.label) })}
          </Alert>
          <Field label={t("Your verdict")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus)}>
              {REVIEWABLE.map((s) => (
                <option key={s} value={s}>
                  {t("{label} - {help}", { label: tx(VERIFICATION_META[s].label), help: tx(VERIFICATION_META[s].help) })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Note (optional)")} hint={t("e.g. what you checked, or why the finding is wrong.")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button onClick={save} loading={busy}>
              {t("Save review")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function FindingsExplorer({ projectId, runs, version }: { projectId: string; runs: ResearchRun[] | undefined; version: number }) {
  const { t, tx } = useT();
  const [section, setSection] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [verification, setVerification] = useState("");
  const [runId, setRunId] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [reviewing, setReviewing] = useState<Finding | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  const path = useMemo(() => {
    const sp = new URLSearchParams();
    if (section) sp.set("section", section);
    if (evidenceType) sp.set("evidence_type", evidenceType);
    if (verification) sp.set("verification_status", verification);
    if (runId) sp.set("run_id", runId);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/api/projects/${projectId}/findings${qs ? `?${qs}` : ""}`;
  }, [projectId, section, evidenceType, verification, runId, q]);

  const { data, error, loading, reload, setData } = useApi<Finding[]>(path);

  useEffect(() => {
    if (version) reload();
  }, [version, reload]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (data ?? []).forEach((f) => (c[f.evidence_type] = (c[f.evidence_type] ?? 0) + 1));
    return c;
  }, [data]);

  const filtersActive = section || evidenceType || verification || runId || q;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={t("Search")}>
              <Input placeholder={t("Keyword in claim or detail")} value={qInput} onChange={(e) => setQInput(e.target.value)} />
            </Field>
            <Field label={t("Section")}>
              <Select value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">{t("All sections")}</option>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Evidence type")}>
              <Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
                <option value="">{t("All types")}</option>
                {(Object.keys(EVIDENCE_META) as EvidenceType[]).map((et) => (
                  <option key={et} value={et}>
                    {tx(EVIDENCE_META[et].label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Verification")}>
              <Select value={verification} onChange={(e) => setVerification(e.target.value)}>
                <option value="">{t("Any status")}</option>
                {(Object.keys(VERIFICATION_META) as VerificationStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {tx(VERIFICATION_META[s].label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Research run")}>
              <Select value={runId} onChange={(e) => setRunId(e.target.value)}>
                <option value="">{t("All runs")}</option>
                {runs?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {dateTime(r.created_at)} · {tx(KIND_LABEL[r.kind] ?? r.kind)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <EvidenceLegend />
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSection("");
                  setEvidenceType("");
                  setVerification("");
                  setRunId("");
                  setQInput("");
                }}
              >
                {t("Clear filters")}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {error && <Alert tone="red">{t("Could not load findings: {error}", { error: errorText(error) })}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <span className="font-medium text-slate-700">{t("{n} findings", { n: data.length })}</span>
          {(Object.keys(EVIDENCE_META) as EvidenceType[]).map((et) =>
            counts[et] ? (
              <Badge key={et} tone={EVIDENCE_META[et].tone}>
                {counts[et]} {tx(EVIDENCE_META[et].label).toLowerCase()}
              </Badge>
            ) : null,
          )}
          {loading && <span className="text-slate-400">{t("Updating...")}</span>}
        </div>
      )}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={<FileSearch className="h-5 w-5" />} title={filtersActive ? t("No findings match these filters") : t("No findings yet")}>
            {filtersActive ? t("Try clearing a filter.") : t("Run market research to collect evidence-linked findings.")}
          </EmptyState>
        </Card>
      )}
      <div className="grid gap-3">
        {data?.map((f) => (
          <FindingCard key={f.id} finding={f} onReview={setReviewing} />
        ))}
      </div>

      <ReviewModal
        finding={reviewing}
        onClose={() => setReviewing(null)}
        onSaved={(updated) => {
          setData((prev) => prev?.map((f) => (f.id === updated.id ? updated : f)));
          setReviewing(null);
        }}
      />
    </div>
  );
}
