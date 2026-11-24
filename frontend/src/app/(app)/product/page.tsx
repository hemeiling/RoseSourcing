"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, Bot, ChevronDown, ChevronsDownUp, ChevronsUpDown, ListChecks, Loader2, Pencil, PlayCircle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AiRecommendationLine, DecisionBadge } from "@/components/decision";
import { RunStatusBadge, fmtCost } from "@/components/market/shared";
import { ReviewInsightsSection } from "@/components/listing-insights";
import { MarketSizeSection } from "@/components/market-size";
import { BuyerStyleSection } from "@/components/buyer-style";
import { OutreachSection } from "@/components/outreach";
import { TrendsExplorer } from "@/components/trends-explorer";
import { ComplianceSection, PriceTiersSection } from "@/components/product-insights";
import { AddListingLinks } from "@/components/suppliers/add-links";
import { useProjects } from "@/components/providers";
import { Button, Card, CardHeader, EmbedContext, EmptyState, Modal, Spinner } from "@/components/ui";
import { money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { AGENTS } from "@/lib/agents";
import { errorText, post } from "@/lib/api";
import { ago } from "@/lib/format";
import { SECTIONS, SECTION_BY_ROUTE, TAB_OF, type Part, type SectionId } from "@/lib/sections";
import type { Opportunity, ResearchRun } from "@/lib/types";
import { ActionPlan } from "@/components/action-plan";
import AnalyticsPage from "../analytics/page";
import BrandPage from "../brand/page";
import ChannelsPage from "../channels/page";
import CommercePage from "../commerce/page";
import CompetitorsPage from "../competitors/page";
import DashboardPage from "../dashboard/page";
import MarketPage from "../market/page";
import SizingPage from "../sizing/page";
import SuppliersPage from "../suppliers/page";

// What each tab or part shows. Tabs with parts render each part under its own heading and anchor.
const CUSTOM: Partial<Record<SectionId, (p: { projectId: string }) => ReactNode>> = {
  "market-size": MarketSizeSection, buyers: BuyerStyleSection, trends: TrendsExplorer, pricing: PriceTiersSection, reviews: ReviewInsightsSection, outreach: OutreachSection,
  compliance: ComplianceSection, actions: ActionPlan,
};
const PAGES: Partial<Record<SectionId, () => ReactNode>> = {
  decision: DashboardPage, research: MarketPage, brands: CompetitorsPage, sizing: SizingPage, "supplier-list": SuppliersPage,
  channels: ChannelsPage, economics: AnalyticsPage, "brand-concepts": BrandPage, commerce: CommercePage,
};
const FOLD_KEY = "136sourcing.foldedSections";
const RUN_FINISHED = "136sourcing:run-finished";

type Dashboard = {
  counts: Record<string, number>;
  findings_by_type: Record<string, number>;
  latest_run: { status: string } | null;
  latest_scenario: { contribution_margin: number | null; retail_price: number | null; costs_assumed: boolean } | null;
};

type Todo = { text: string; detail?: string; section: string; tone: "red" | "amber" | "slate" };

type RunAllStep = { kind: ResearchRun["kind"]; action: "done" | "running" | "resume" | "new"; run_id: string | null; estimate_usd: number };
type RunAllPlan = {
  steps: RunAllStep[];
  total_estimate_usd: number;
  progress: { total: number; finished: number; current: string | null; done: boolean; stopped: string | null } | null;
};
const agentName = (kind: string) => AGENTS.find((a) => a.kind === kind)?.name ?? kind;

/** One click runs every agent this product is missing, one after another on the server. Finished agents are skipped
 *  and interrupted ones resume where they stopped, so nothing is paid for twice. */
function RunAll({ projectId, plan, onChange }: { projectId: string; plan: RunAllPlan | undefined; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!plan) return null;
  const todo = plan.steps.filter((s) => s.action === "new" || s.action === "resume");
  const prog = plan.progress;
  const chainRunning = !!prog && !prog.done;
  const anyRunning = chainRunning || plan.steps.some((s) => s.action === "running");
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/projects/${projectId}/research-runs/run-all`);
      setOpen(false);
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {chainRunning ? (
        <span className="flex items-center gap-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" aria-hidden /> Running {Math.min(prog.finished + 1, prog.total)} of {prog.total}{prog.current ? `: ${agentName(prog.current)}` : ""}
        </span>
      ) : todo.length === 0 ? (
        <span className="text-xs text-slate-500">All agents have run</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)} disabled={anyRunning} title={anyRunning ? "An agent is running - wait for it to finish" : undefined}>
          <PlayCircle className="h-3.5 w-3.5" /> Run all missing ({todo.length}, ~{money(todo.reduce((t, s) => t + s.estimate_usd, 0))})
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Run all missing agents">
        <p className="text-sm text-slate-600">
          They run one after another on the server, in an order where later agents use earlier results. Agents that already
          finished are skipped; interrupted or failed ones continue where they stopped, so finished work is not paid for again.
        </p>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {plan.steps.map((s) => (
            <li key={s.kind} className="flex items-center justify-between gap-3 py-1.5">
              <span className={clsx("min-w-0", s.action === "done" ? "text-slate-400" : "text-ink")}>{agentName(s.kind)}</span>
              <span className="whitespace-nowrap text-xs">
                {s.action === "done" ? <span className="text-slate-400">Done - skipped</span>
                  : s.action === "running" ? <span className="text-amber-700">Running now</span>
                  : <span className="text-slate-600">{s.action === "resume" ? "Continue" : "New run"} · ~{money(s.estimate_usd)}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-semibold text-ink">Estimated cost: ~{money(todo.reduce((t, s) => t + s.estimate_usd, 0))}</p>
        <p className="mt-1 text-xs text-slate-500">
          Estimates come from earlier runs; each run stops at the cost cap. If the server restarts or sleeps mid-way, click
          Run all again - it picks up where it stopped. Keep this page open while it runs.
        </p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={start} loading={busy}>Run {todo.length} agent{todo.length === 1 ? "" : "s"}</Button>
        </div>
      </Modal>
    </>
  );
}

const RUNNING = ["queued", "running"];
const RESUMABLE = ["interrupted", "failed", "cancelled"];

/** One agent: Run starts it right here (after showing the cost); an interrupted run continues instead of starting over;
 *  while it runs, a progress bar shows the step it is on. */
function AgentRow({ projectId, agent, last, estimate, otherRunning, onChange }: {
  projectId: string; agent: (typeof AGENTS)[number]; last: ResearchRun | undefined; estimate: number | undefined; otherRunning: boolean;
  onChange: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = !!last && RUNNING.includes(last.status);
  const resume = !!last && RESUMABLE.includes(last.status);
  const steps = last?.steps ?? [];
  const done = steps.filter((st) => st.status === "completed" || st.status === "skipped" || st.status === "failed").length;
  const current = steps.find((st) => st.status === "running") ?? steps.find((st) => st.status === "pending");
  const cost = resume ? estimate : last ? last.cost_usd : estimate;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (resume && last) await post(`/api/research-runs/${last.id}/resume`);
      else await post(`/api/projects/${projectId}/research-runs`, { kind: agent.kind });
      setConfirm(false);
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <a href={`#${agent.section}`} className="font-semibold text-ink hover:text-primary-700 hover:underline" title="Open its results">{agent.name}</a>
        <div className="text-xs text-slate-500">{agent.does}</div>
        {running && (
          <div className="mt-2" aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}
              aria-label={`${agent.name} progress`}>
              <div className="h-1.5 rounded-full bg-primary-500 transition-[width] duration-500"
                style={{ width: `${Math.max(6, Math.round((100 * done) / Math.max(1, steps.length)))}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              Step {Math.min(done + 1, steps.length)} of {steps.length}{current ? ` · ${current.label}` : ""} · {fmtCost(last?.cost_usd)} so far
            </div>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-slate-600 sm:justify-end">
        <span className="whitespace-nowrap">
          {last ? <><RunStatusBadge status={last.status} /> <span className="ml-1">{ago(last.created_at)} · {fmtCost(last.cost_usd)}</span></> : <span className="text-slate-400">Not run yet</span>}
        </span>
        {running ? (
          <span className="flex items-center gap-1 whitespace-nowrap font-semibold text-primary-700"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Running</span>
        ) : confirm ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-slate-700">{resume ? "Continue" : "Run"}{cost !== undefined ? ` (~${fmtCost(cost)})` : ""}?</span>
            <Button size="sm" onClick={start} loading={busy}>Yes</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </span>
        ) : (
          <button onClick={() => setConfirm(true)} disabled={otherRunning}
            title={otherRunning ? "Another agent is running for this product - this one can start when it finishes" : undefined}
            className={clsx("flex items-center gap-1 whitespace-nowrap font-semibold hover:underline disabled:text-slate-300 disabled:no-underline",
              last && !resume ? "text-slate-600" : "text-primary-700")}>
            {last && !resume ? <RotateCw className="h-3.5 w-3.5" aria-hidden /> : <PlayCircle className="h-3.5 w-3.5" aria-hidden />}
            {resume ? "Continue" : last ? "Run again" : "Run"}
          </button>
        )}
      </div>
    </li>
  );
}

/** Every research agent, with its latest run for this product, a Run button and live progress. */
function AgentsPanel({ projectId, extra }: { projectId: string; extra?: ReactNode }) {
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const plan = useApi<RunAllPlan>(`/api/projects/${projectId}/research-runs/run-all`);
  const { reload: reloadRuns } = runs;
  const { reload: reloadPlan } = plan;
  const anyRunning = !!runs.data?.some((r) => RUNNING.includes(r.status));
  const active = (!!plan.data?.progress && !plan.data.progress.done) || anyRunning;
  // While anything runs, refresh every 5 s so the progress bars move.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { reloadRuns(); reloadPlan(); }, 5000);
    return () => clearInterval(t);
  }, [active, reloadRuns, reloadPlan]);
  // When an agent finishes, the report's sections reload to show what it saved.
  const runningIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!runs.data) return;
    const now = new Set(runs.data.filter((r) => RUNNING.includes(r.status)).map((r) => r.id));
    if ([...runningIds.current].some((rid) => !now.has(rid))) window.dispatchEvent(new Event(RUN_FINISHED));
    runningIds.current = now;
  }, [runs.data]);
  return (
    <Card >
      <CardHeader title="Research agents" icon={<Bot className="h-4 w-4" />}
        subtitle="The same agents work on every product. Each run is saved with this product, with its sources and cost."
        actions={<RunAll projectId={projectId} plan={plan.data} onChange={() => { reloadRuns(); reloadPlan(); }} />} />
      {plan.data?.progress?.done && plan.data.progress.stopped && (
        <p className="mx-5 mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{plan.data.progress.stopped}</p>
      )}
      {/* A list rather than a table, so on a phone the status and link wrap under the agent instead of scrolling sideways. */}
      <ul className="divide-y divide-slate-100 text-sm">
        {AGENTS.map((a) => {
          const last = runs.data?.find((r) => r.kind === a.kind);
          const step = plan.data?.steps.find((st) => st.kind === a.kind);
          return (
            <AgentRow key={a.kind} projectId={projectId} agent={a} last={last} estimate={step?.estimate_usd || undefined}
              otherRunning={(anyRunning && !(last && RUNNING.includes(last.status))) || (!!plan.data?.progress && !plan.data.progress.done)}
              onChange={() => { reloadRuns(); reloadPlan(); }} />
          );
        })}
      </ul>
      {extra}
    </Card>
  );
}

/** A short, linked checklist of what is missing or weak for this product. */
function Review({ projectId, decision }: { projectId: string; decision: string }) {
  const dash = useApi<Dashboard>(`/api/projects/${projectId}/dashboard`);
  const reports = useApi<Opportunity[]>(`/api/projects/${projectId}/opportunities`);
  if (!dash.data || !reports.data) return <Spinner />;
  const c = dash.data.counts;
  const unavailable = dash.data.findings_by_type.unavailable ?? 0;
  const todos: Todo[] = [];
  const sc = dash.data.latest_scenario;
  const cm = sc?.contribution_margin;
  if (!sc || sc.costs_assumed)
    todos.push({ text: "Margin not worked out yet", detail: sc ? "The research estimate uses assumed factory, freight and fee costs. Work out the margin in Unit economics with supplier quotes." : "Model cost, price and margin.", section: "economics", tone: "slate" });
  else if (cm !== null && cm !== undefined && cm < 0)
    todos.push({ text: `Unit contribution is negative (${money(cm)})`, detail: `At ${money(sc.retail_price)} retail you lose money on each sale - revisit price or costs.`, section: "economics", tone: "red" });
  if (c.suppliers && !c.spec_sheets) todos.push({ text: "No spec sheet yet", detail: "Draft the spec sheet suppliers will quote against.", section: "outreach", tone: "amber" });
  if (c.suppliers && c.rfqs_sent < 5)
    todos.push({ text: c.rfqs_sent ? `Only ${c.rfqs_sent} supplier${c.rfqs_sent === 1 ? "" : "s"} asked for quotes` : "No supplier asked for quotes yet",
      detail: "Send the spec sheet to 5+ suppliers for prices at 100 / 300 / 500 units.", section: "outreach", tone: "amber" });
  if (c.rfq_quotes && c.sample_orders < 2) todos.push({ text: "Order 2-3 samples", detail: "Pick the best quotes and track each sample until you have scored it.", section: "outreach", tone: "slate" });
  if (unavailable) todos.push({ text: `${unavailable} research questions had no reliable data`, detail: "Listed as 'data unavailable' findings - these are your evidence gaps.", section: "research", tone: "slate" });
  if (decision === "undecided") todos.push({ text: "Record your go / no-go decision", detail: "Your decision is saved with a snapshot of the evidence.", section: "decision", tone: "slate" });

  // One card: the agents (each row shows what is missing and runs it), then the steps no agent covers.
  return (
    <AgentsPanel projectId={projectId} extra={todos.length > 0 && (
      <div className="border-t border-line px-5 py-2.5">
        <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><ListChecks className="h-3.5 w-3.5" aria-hidden />Also to do</h3>
            <ul>
              {todos.map((t) => (
                <li key={t.text} className="border-b border-slate-100 last:border-b-0">
                  <a href={`#${t.section}`} className="group flex items-start gap-2.5 py-2">
                    <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0", t.tone === "red" ? "text-red-600" : t.tone === "amber" ? "text-amber-600" : "text-slate-400")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block text-sm font-medium", t.tone === "red" ? "text-red-700" : "text-ink")}>{t.text}</span>
                      {t.detail && <span className="block text-xs text-slate-500">{t.detail}</span>}
                    </span>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
      </div>
    )} />
  );
}

function ProductReport({ id }: { id: string }) {
  const { projects, project, select, loading } = useProjects();
  const router = useRouter();
  const [suppliersVersion, setSuppliersVersion] = useState(0);
  const [competitorsVersion, setCompetitorsVersion] = useState(0);
  // Research parts show once their agent has saved something (`shownWhen` in sections.ts); until the counts load, all show.
  const dash = useApi<{ counts: Record<string, number> }>(`/api/projects/${id}/dashboard`);
  const { reload: reloadCounts } = dash;
  const has = (when?: string[]) => !when || !dash.data || when.some((k) => (dash.data!.counts[k] ?? 0) > 0);
  const shown = SECTIONS.map((t) => ({ ...t, parts: t.parts?.filter((p) => has(p.shownWhen)) }))
    .filter((t) => has(t.shownWhen) && (!t.parts || t.parts.length > 0));
  // Bumped when any agent finishes, so every open section re-reads its data (runs are started from the agents card).
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    const bump = () => { setDataVersion((v) => v + 1); reloadCounts(); };
    window.addEventListener(RUN_FINISHED, bump);
    return () => window.removeEventListener(RUN_FINISHED, bump);
  }, [reloadCounts]);
  const [tierNote, setTierNote] = useState<string | null>(null);
  const assignTiers = async () => {
    try {
      const r = await post<{ updated: number; prices_added: number }>(`/api/projects/${id}/competitors/assign-tiers`);
      setTierNote(r.updated || r.prices_added
        ? `Placed ${r.updated} competitor${r.updated === 1 ? "" : "s"} in a price tier; added ${r.prices_added} price${r.prices_added === 1 ? "" : "s"} from marketplace listings.`
        : "No changes: competitors without prices did not match any listing found by the Price Tier Agent.");
      setCompetitorsVersion((v) => v + 1);
    } catch (e) {
      setTierNote(errorText(e));
    }
  };
  const userScrolled = useRef(false);
  // Folded sections are remembered in this browser, for every product.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const foldedRef = useRef(folded);
  foldedRef.current = folded;
  useEffect(() => {
    try { setFolded(new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]") as string[])); } catch { /* storage unavailable */ }
  }, []);
  const saveFolded = useCallback((next: Set<string>) => {
    setFolded(next);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ }
  }, []);
  const toggle = (sid: string) => {
    const next = new Set(folded);
    if (next.has(sid)) next.delete(sid); else next.add(sid);
    saveFolded(next);
  };
  const allFolded = SECTIONS.every((s) => folded.has(s.id));
  const exists = projects.some((p) => p.id === id);

  useEffect(() => {
    if (exists && project?.id !== id) select(id);
  }, [exists, project?.id, id, select]);

  // Jump to a tab or a part inside one; a folded tab opens first.
  const jump = useCallback((section: string) => {
    const tab = TAB_OF[section] ?? section;
    if (foldedRef.current.has(tab)) {
      const next = new Set(foldedRef.current);
      next.delete(tab);
      saveFolded(next);
    }
    // Jump straight there: a smooth scroll would play the whole report past on the way.
    // A part with no data yet is not shown; land on its tab instead.
    requestAnimationFrame(() => (document.getElementById(section) ?? document.getElementById(tab))?.scrollIntoView({ behavior: "instant", block: "start" }));
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${section}`);
  }, [saveFolded]);

  // Deep links (#market): sections above load their data asynchronously, so re-align a few times unless the user scrolls.
  const ready = project?.id === id;
  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash.slice(1);
    if (!hash || !TAB_OF[hash]) return;
    userScrolled.current = false;
    const stop = () => { userScrolled.current = true; };
    window.addEventListener("wheel", stop, { once: true });
    window.addEventListener("touchmove", stop, { once: true });
    window.addEventListener("keydown", stop, { once: true });
    window.addEventListener("pointerdown", stop, { once: true });
    const timers = [50, 700, 1600, 3000].map((ms) => setTimeout(() => { if (!userScrolled.current) jump(hash); }, ms));
    return () => {
      timers.forEach(clearTimeout);
      ["wheel", "touchmove", "keydown", "pointerdown"].forEach((ev) => window.removeEventListener(ev, stop));
    };
  }, [ready, jump]);

  // Links inside sections that point at an old standalone page scroll to that section instead.
  const onClickCapture = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
    const url = new URL(a.href, window.location.href);
    const section = url.origin === window.location.origin ? SECTION_BY_ROUTE[url.pathname] : undefined;
    if (!section) return;
    e.preventDefault();
    const sp = new URLSearchParams(window.location.search);
    url.searchParams.forEach((v, k) => sp.set(k, v));
    router.replace(`/product?${sp.toString()}#${section}`, { scroll: false });
    setTimeout(() => jump(section), 50);
  };

  // The content of one tab (without parts) or part.
  const body = (sid: SectionId, part?: Part): ReactNode => {
    if (sid === "review") return <Review key={dataVersion} projectId={id} decision={project?.decision ?? "undecided"} />;
    const Custom = CUSTOM[sid];
    if (Custom) return <Custom key={dataVersion} projectId={id} />;
    const Page = PAGES[sid];
    if (!Page) return null;
    const tab = SECTIONS.find((t) => t.id === sid);
    return (
      <EmbedContext.Provider value={{ id: sid, title: part?.title ?? tab?.title ?? "", description: part?.description ?? tab?.description }}>
        {sid === "supplier-list" && (
          <div className="mb-4">
            <AddListingLinks projectId={id} onAdded={() => setSuppliersVersion((v) => v + 1)} />
          </div>
        )}
        {sid === "brands" && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <span className="text-slate-600">Place each competitor in the budget / mid / premium / luxury tiers found by the Price Tier Agent, using its prices or matching listings.</span>
            <Button size="sm" variant="secondary" onClick={assignTiers}>Assign price tiers</Button>
            {tierNote && <span className="w-full text-xs text-slate-500">{tierNote}</span>}
          </div>
        )}
        <Page key={`${dataVersion}-${sid === "supplier-list" ? suppliersVersion : sid === "brands" ? competitorsVersion : 0}`} />
      </EmbedContext.Provider>
    );
  };

  if (loading) return <Spinner />;
  if (!exists)
    return <EmptyState title="Product not found" action={<Link href="/products"><Button>See all products</Button></Link>}>It may have been deleted, or the link is incomplete.</EmptyState>;
  if (!ready || !project) return <Spinner />;

  return (
    <div onClickCapture={onClickCapture}>
      <div className="mb-4">
        <Link href="/products" className="text-xs font-semibold text-primary-700 hover:underline">← All products</Link>
        {/* Title row: name and actions share the top line; the facts and decision sit underneath, all on one left edge. */}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-2xl font-semibold leading-tight text-ink sm:text-[1.75rem]">{project.name}</h1>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/copilot"><Button size="sm" variant="secondary"><Bot className="h-3.5 w-3.5" /> Ask the copilot</Button></Link>
            <Link href="/projects"><Button size="sm" variant="ghost"><Pencil className="h-3.5 w-3.5" /> Edit details</Button></Link>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-600">
          <DecisionBadge decision={project.decision} />
          <span>
            {project.product_category} · {project.target_country}{project.sourcing_country ? ` · sourcing from ${project.sourcing_country}` : ""}
            {project.budget_usd !== null ? ` · budget ${money(project.budget_usd, { decimals: 0 })}` : ""}
          </span>
        </div>
        <AiRecommendationLine projectId={id} />
      </div>

      {/* The list below is the navigation: each tab folds to one row. */}
      <div className="mb-1 flex justify-end">
        <button type="button" onClick={() => saveFolded(allFolded ? new Set() : new Set(SECTIONS.map((s) => s.id)))}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">
          {allFolded ? <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />}
          {allFolded ? "Unfold all" : "Fold all"}
        </button>
      </div>

      {/* A compact list of tabs: a folded tab is one row (title + what is inside); an open tab shows its parts. */}
      <div className="divide-y divide-line border-b border-line">
        {shown.map((s) => {
          const isFolded = folded.has(s.id);
          return (
          <section key={s.id} id={s.id} className="scroll-mt-16" aria-label={s.title}>
            <div className={clsx("flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5", !isFolded && "pb-1")}>
              <h2 className="text-xl font-semibold leading-tight text-ink">
                <button type="button" onClick={() => toggle(s.id)} aria-expanded={!isFolded} aria-controls={`${s.id}-body`}
                  className="group flex items-center gap-1.5 text-left hover:text-primary-700">
                  <span>{s.title}</span>
                  <ChevronDown className={clsx("h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:text-primary-700", isFolded && "-rotate-90")} aria-hidden />
                </button>
              </h2>
              <span className="text-sm text-slate-500">{s.parts ? s.parts.map((p) => p.title).join(" · ") : isFolded ? "" : s.description}</span>
            </div>
            {!isFolded && (
              <div id={`${s.id}-body`} className="space-y-8 pb-8 pt-3">
                {s.parts
                  ? s.parts.map((part) => (
                    <div key={part.id} id={part.id} className="scroll-mt-16">
                      <h3 className="text-base font-semibold text-ink">{part.title}</h3>
                      {part.description && <p className="mb-3 mt-0.5 max-w-3xl text-sm text-slate-600">{part.description}</p>}
                      {body(part.id, part)}
                    </div>
                  ))
                  : body(s.id)}
              </div>
            )}
          </section>
          );
        })}
      </div>
    </div>
  );
}

function ProductFromUrl() {
  const id = useSearchParams().get("id");
  if (!id) return <EmptyState title="Choose a product" action={<Link href="/products"><Button>See all products</Button></Link>}>Open a product from the list to see its full report.</EmptyState>;
  return <ProductReport key={id} id={id} />;
}

export default function ProductPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProductFromUrl />
    </Suspense>
  );
}

