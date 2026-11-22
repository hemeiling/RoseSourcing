"use client";

import { FileText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { CompareTab } from "@/components/market/compare";
import { FindingsExplorer } from "@/components/market/findings-explorer";
import { ResearchLauncher } from "@/components/market/launcher";
import { ReportView } from "@/components/market/report-view";
import { RunsList } from "@/components/market/runs";
import { SegmentsTab, SourcesTab } from "@/components/market/segments-sources";
import { AttractivenessBadge, isActive } from "@/components/market/shared";
import { useProjects } from "@/components/providers";
import { Alert, Card, EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui";
import { errorText } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Opportunity, ResearchRun } from "@/lib/types";

type TabKey = "research" | "reports" | "findings" | "segments" | "sources" | "compare";
const TAB_KEYS: TabKey[] = ["research", "reports", "findings", "segments", "sources", "compare"];

function MarketPage({ projectId }: { projectId: string }) {
  const { project } = useProjects();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reportParam = params.get("report");
  const tabParam = params.get("tab") as TabKey | null;

  const [tab, setTab] = useState<TabKey>(reportParam ? "reports" : tabParam && TAB_KEYS.includes(tabParam) ? tabParam : "research");
  const [version, setVersion] = useState(0);

  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const reports = useApi<Opportunity[]>(`/api/projects/${projectId}/opportunities`);
  const { reload: reloadRuns, setData: setRuns } = runs;
  const { reload: reloadReports } = reports;

  useEffect(() => {
    if (reportParam) setTab("reports");
  }, [reportParam]);

  const setUrl = useCallback(
    (next: { report?: string | null; tab?: TabKey }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.report !== undefined) {
        if (next.report) sp.set("report", next.report);
        else sp.delete("report");
      }
      if (next.tab) {
        if (next.tab === "research") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      const qs = sp.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const changeTab = (t: TabKey) => {
    setTab(t);
    setUrl({ tab: t, report: t === "reports" ? undefined : null });
  };

  const openReport = useCallback(
    (id: string) => {
      setTab("reports");
      setUrl({ report: id, tab: "reports" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setUrl],
  );

  const onRunFinished = useCallback(() => {
    reloadRuns();
    reloadReports();
    setVersion((v) => v + 1);
  }, [reloadRuns, reloadReports]);

  const reportByRun = useMemo(() => {
    const m: Record<string, string> = {};
    (reports.data ?? []).forEach((r) => {
      if (r.research_run_id && !m[r.research_run_id]) m[r.research_run_id] = r.id;
    });
    return m;
  }, [reports.data]);

  const hasActiveRun = (runs.data ?? []).some((r) => isActive(r.status));
  const selectedReport = reports.data?.find((r) => r.id === reportParam) ?? reports.data?.[0];

  return (
    <div>
      <PageHeader
        title="Market Opportunity"
        description="Evidence-linked research on market size, customers, competitors, sourcing costs and risks. Every finding records its source, retrieval date, evidence type, confidence and verification status."
      />
      <Tabs<TabKey>
        value={tab}
        onChange={changeTab}
        tabs={[
          { value: "research", label: "Research" },
          { value: "reports", label: `Reports${reports.data ? ` (${reports.data.length})` : ""}` },
          { value: "findings", label: "Findings" },
          { value: "segments", label: "Segments" },
          { value: "sources", label: "Sources" },
          { value: "compare", label: "Compare" },
        ]}
      />

      {tab === "research" && (
        <div className="space-y-6">
          {project && project.id === projectId && (
            <ResearchLauncher
              key={project.id}
              project={project}
              hasActiveRun={hasActiveRun}
              onStarted={(run) => setRuns((prev) => [run, ...(prev ?? []).filter((r) => r.id !== run.id)])}
            />
          )}
          <RunsList
            runs={runs.data}
            loading={runs.loading}
            error={runs.error}
            reportByRun={reportByRun}
            onFinished={onRunFinished}
            onViewReport={openReport}
          />
        </div>
      )}

      {tab === "reports" && (
        <>
          {reports.loading && !reports.data && <Spinner />}
          {reports.error && <Alert tone="red">Could not load reports: {errorText(reports.error)}</Alert>}
          {reports.data && reports.data.length === 0 && (
            <Card>
              <EmptyState icon={<FileText className="h-5 w-5" />} title="No opportunity reports yet">
                A report is produced at the end of each completed market research run.
              </EmptyState>
            </Card>
          )}
          {reports.data && reports.data.length > 0 && selectedReport && (
            <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <nav aria-label="Reports" className="space-y-2">
                {reports.data.map((r) => {
                  const active = r.id === selectedReport.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => openReport(r.id)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${active ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                      aria-current={active ? "true" : undefined}
                    >
                      <div className="truncate text-sm font-medium text-slate-900">{r.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <AttractivenessBadge value={r.attractiveness} />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{date(r.created_at)}</div>
                    </button>
                  );
                })}
              </nav>
              <ReportView
                key={selectedReport.id}
                projectId={projectId}
                report={selectedReport}
                onDeleted={() => {
                  setUrl({ report: null });
                  reloadReports();
                }}
              />
            </div>
          )}
        </>
      )}

      {tab === "findings" && <FindingsExplorer projectId={projectId} runs={runs.data} version={version} />}
      {tab === "segments" && <SegmentsTab projectId={projectId} version={version} />}
      {tab === "sources" && <SourcesTab projectId={projectId} runs={runs.data} version={version} />}
      {tab === "compare" && <CompareTab reports={reports.data} />}
    </div>
  );
}

export default function MarketOpportunityPage() {
  return (
    <RequireProject>
      {(pid) => (
        <Suspense fallback={<Spinner />}>
          <MarketPage key={pid} projectId={pid} />
        </Suspense>
      )}
    </RequireProject>
  );
}
