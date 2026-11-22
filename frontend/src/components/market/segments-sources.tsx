"use client";

import { Globe, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfidenceBadge, EvidenceBadge } from "@/components/evidence";
import { Alert, Badge, Card, CardBody, EmptyState, ExternalLink, Field, Input, Select, Spinner } from "@/components/ui";
import { errorText } from "@/lib/api";
import { date, domainOf, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { EvidenceSource, ResearchRun, Segment } from "@/lib/types";
import { KIND_LABEL } from "./shared";

export function SegmentsTab({ projectId, version }: { projectId: string; version: number }) {
  const segs = useApi<Segment[]>(`/api/projects/${projectId}/segments`);
  const sources = useApi<EvidenceSource[]>(`/api/projects/${projectId}/sources`);
  const { reload: reloadSegs } = segs;
  const { reload: reloadSources } = sources;

  useEffect(() => {
    if (version) {
      reloadSegs();
      reloadSources();
    }
  }, [version, reloadSegs, reloadSources]);

  const sourceById = useMemo(() => new Map((sources.data ?? []).map((s) => [s.id, s])), [sources.data]);

  if (segs.loading && !segs.data) return <Spinner />;
  if (segs.error) return <Alert tone="red">Could not load segments: {errorText(segs.error)}</Alert>;
  if (!segs.data?.length)
    return (
      <Card>
        <EmptyState icon={<Users className="h-5 w-5" />} title="No customer segments yet">
          Segments are identified during the &ldquo;Customer segments &amp; unmet needs&rdquo; research step.
        </EmptyState>
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {segs.data.map((s) => (
        <Card key={s.id}>
          <CardBody className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <EvidenceBadge type={s.evidence_type} />
              <ConfidenceBadge level={s.confidence} />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{s.name}</h3>
            {s.description && <p className="text-sm text-slate-600">{s.description}</p>}
            {s.needs.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Needs</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                  {s.needs.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.unmet_needs.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Unmet needs</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                  {s.unmet_needs.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-slate-600">
              <span className="font-medium text-slate-700">Size indicator:</span> {s.size_indicator ?? "No size evidence found"}
            </p>
            {s.source_ids.length > 0 ? (
              <div className="space-y-0.5 border-t border-slate-100 pt-2 text-xs">
                {s.source_ids.map((id) => {
                  const src = sourceById.get(id);
                  if (!src) return null;
                  return (
                    <div key={id} className="text-slate-500">
                      {src.url ? <ExternalLink href={src.url}>{src.title || domainOf(src.url)}</ExternalLink> : src.title}
                      <span className="ml-1.5">· retrieved {date(src.retrieved_at)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">No sources linked - treat as a hypothesis.</p>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function SourcesTab({ projectId, runs, version }: { projectId: string; runs: ResearchRun[] | undefined; version: number }) {
  const [runId, setRunId] = useState("");
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useApi<EvidenceSource[]>(`/api/projects/${projectId}/sources${runId ? `?run_id=${runId}` : ""}`);

  useEffect(() => {
    if (version) reload();
  }, [version, reload]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((s) => `${s.title ?? ""} ${s.url ?? ""} ${s.excerpts.join(" ")}`.toLowerCase().includes(needle));
  }, [data, q]);

  const withExcerpts = filtered.filter((s) => s.excerpts.length > 0).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Search sources">
            <Input placeholder="Title, URL or excerpt text" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label="Research run">
            <Select value={runId} onChange={(e) => setRunId(e.target.value)}>
              <option value="">All runs</option>
              {runs?.map((r) => (
                <option key={r.id} value={r.id}>
                  {date(r.created_at)} · {KIND_LABEL[r.kind] ?? r.kind}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
      {error && <Alert tone="red">Could not load sources: {errorText(error)}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <p className="text-xs text-slate-600">
          {filtered.length} sources · {withExcerpts} with verbatim excerpts. Excerpts are exactly what the provider returned - not written by the model.
        </p>
      )}
      {data && filtered.length === 0 && (
        <Card>
          <EmptyState icon={<Globe className="h-5 w-5" />} title="No sources">
            {q || runId ? "No sources match these filters." : "Sources appear here after a research run retrieves them."}
          </EmptyState>
        </Card>
      )}
      <div className="space-y-3">
        {filtered.map((s) => (
          <Card key={s.id}>
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {s.url ? (
                    <ExternalLink href={s.url} className="text-sm font-medium">
                      {s.title || s.url}
                    </ExternalLink>
                  ) : (
                    <span className="text-sm font-medium text-slate-900">{s.title ?? "Untitled source"}</span>
                  )}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {domainOf(s.url)} · retrieved {date(s.retrieved_at)}
                    {s.published_hint ? ` · page age: ${s.published_hint}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone="slate">{titleCase(s.source_type)}</Badge>
                  {s.provider && <Badge tone="blue">{s.provider}</Badge>}
                </div>
              </div>
              {s.excerpts.length > 0 ? (
                <div className="space-y-1.5">
                  {s.excerpts.map((ex, i) => (
                    <blockquote key={i} className="border-l-2 border-teal-300 pl-2.5 text-[13px] italic leading-relaxed text-slate-700">
                      &ldquo;{ex}&rdquo;
                    </blockquote>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No excerpt captured (search result title only).</p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
