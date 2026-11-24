"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, Bot, ChevronDown, ChevronsDownUp, ChevronsUpDown, ListChecks, Loader2, Pencil, PlayCircle } from "lucide-react";
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
import { ResearchRunStarter } from "@/components/research-run-starter";
import { AddListingLinks } from "@/components/suppliers/add-links";
import { useProjects } from "@/components/providers";
import { Button, Card, CardBody, CardHeader, EmbedContext, EmptyState, Modal, Spinner } from "@/components/ui";
import { money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { AGENTS } from "@/lib/agents";
import { errorText, post } from "@/lib/api";
import { ago } from "@/lib/format";
import { SECTIONS, SECTION_BY_ROUTE, TAB_OF, type Part, type SectionId } from "@/lib/sections";
import type { Opportunity, ResearchRun } from "@/lib/types";
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
  compliance: ComplianceSection,
};
const PAGES: Partial<Record<SectionId, () => ReactNode>> = {
  decision: DashboardPage, research: MarketPage, brands: CompetitorsPage, sizing: SizingPage, "supplier-list": SuppliersPage,
  channels: ChannelsPage, economics: AnalyticsPage, "brand-concepts": BrandPage, commerce: CommercePage,
};
const FOLD_KEY = "136sourcing.foldedSections";

type Dashboard = {
  counts: Record<string, number>;
  findings_by_type: Record<string, number>;
  latest_run: { status: string } | null;
  latest_scenario: { contribution_margin: number | null; retail_price: number | null } | null;
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

/** Every research agent, with its latest run for this product. "Run" jumps to the section where it is started. */
function AgentsPanel({ projectId }: { projectId: string }) {
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  const plan = useApi<RunAllPlan>(`/api/projects/${projectId}/research-runs/run-all`);
  const { reload: reloadRuns } = runs;
  const { reload: reloadPlan } = plan;
  const active = (!!plan.data?.progress && !plan.data.progress.done) || !!runs.data?.some((r) => r.status === "queued" || r.status === "running");
  // While anything runs, refresh every 10 s (this also keeps a sleeping free server awake).
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { reloadRuns(); reloadPlan(); }, 10000);
    return () => clearInterval(t);
  }, [active, reloadRuns, reloadPlan]);
  return (
    <Card className="lg:col-span-2">
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
          return (
            <li key={a.kind} className="flex flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">{a.name}</div>
                <div className="text-xs text-slate-500">{a.does}</div>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600 sm:justify-end">
                <span className="whitespace-nowrap">
                  {last ? <><RunStatusBadge status={last.status} /> <span className="ml-1">{ago(last.created_at)} · {fmtCost(last.cost_usd)}</span></> : <span className="text-slate-400">Not run yet</span>}
                </span>
                <a href={`#${a.section}`} className="whitespace-nowrap font-semibold text-primary-700 hover:underline">{last ? "Open" : "Run"} →</a>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** A short, linked checklist of what is missing or weak for this product. */
function Review({ projectId, decision }: { projectId: string; decision: string }) {
  const dash = useApi<Dashboard>(`/api/projects/${projectId}/dashboard`);
  const reports = useApi<Opportunity[]>(`/api/projects/${projectId}/opportunities`);
  if (!dash.data || !reports.data) return <Spinner />;
  const c = dash.data.counts;
  const report = reports.data[0]?.report;
  const unavailable = dash.data.findings_by_type.unavailable ?? 0;
  const todos: Todo[] = [];
  const cm = dash.data.latest_scenario?.contribution_margin;
  if (!c.research_runs) todos.push({ text: "Run market research", detail: "Nothing has been researched for this product yet.", section: "research", tone: "amber" });
  if (cm !== null && cm !== undefined && cm < 0)
    todos.push({ text: `Unit contribution is negative (${money(cm)})`, detail: `At ${money(dash.data.latest_scenario?.retail_price)} retail you lose money on each sale - revisit price or costs.`, section: "economics", tone: "red" });
  if (!c.suppliers) todos.push({ text: "No suppliers yet", detail: "Factory cost, MOQ and lead time are still assumptions - search B2B listings to start.", section: "supplier-list", tone: "amber" });
  if (!c.competitors) todos.push({ text: "No competitors tracked", detail: "Add the brands you compete with and their prices.", section: "brands", tone: "amber" });
  if (!c.size_charts) todos.push({ text: "No size chart yet", detail: "Add your size guide or a supplier's chart so customers can find their size.", section: "sizing", tone: "slate" });
  if (!c.channels) todos.push({ text: "Selling channels not compared", detail: "Compare marketplace and store fees for this product.", section: "channels", tone: "slate" });
  if (!c.scenarios) todos.push({ text: "No unit economics yet", detail: "Model cost, price and margin.", section: "economics", tone: "slate" });
  if (!c.price_tier_reports) todos.push({ text: "Price tiers not researched", detail: "See what budget, mid, premium and luxury buyers each want before you pick a price.", section: "pricing", tone: "slate" });
  if (!c.compliance_checks) todos.push({ text: "No compliance check yet", detail: "Design patents, labelling and UFLPA forced-labour rules - and questions for your supplier.", section: "compliance", tone: "amber" });
  if (!c.listing_reports) todos.push({ text: "Comparable listings not tracked", detail: "Log Google Trends plus price, rating, review count and badges for 15-20 directly comparable listings.", section: "listings", tone: "slate" });
  if (!c.buyer_reports) todos.push({ text: "Buyers & style not profiled", detail: "Count who buys (stated ages, who wears it, occasions) and which looks they like from every customer comment collected.", section: "buyers", tone: "slate" });
  if (!c.review_reports) todos.push({ text: "Low-star reviews not tagged", detail: "Find the comfort, fit and durability complaints in competitors' 1-3 star reviews.", section: "reviews", tone: "slate" });
  if (c.suppliers && !c.spec_sheets) todos.push({ text: "No spec sheet yet", detail: "Draft the spec sheet suppliers will quote against.", section: "outreach", tone: "amber" });
  if (c.suppliers && c.rfqs_sent < 5)
    todos.push({ text: c.rfqs_sent ? `Only ${c.rfqs_sent} supplier${c.rfqs_sent === 1 ? "" : "s"} asked for quotes` : "No supplier asked for quotes yet",
      detail: "Send the spec sheet to 5+ suppliers for prices at 100 / 300 / 500 units.", section: "outreach", tone: "amber" });
  if (c.rfq_quotes && c.sample_orders < 2) todos.push({ text: "Order 2-3 samples", detail: "Pick the best quotes and track each sample until you have scored it.", section: "outreach", tone: "slate" });
  if (unavailable) todos.push({ text: `${unavailable} research questions had no reliable data`, detail: "Listed as 'data unavailable' findings - these are your evidence gaps.", section: "research", tone: "slate" });
  if (decision === "undecided") todos.push({ text: "Record your go / no-go decision", detail: "Your decision is saved with a snapshot of the evidence.", section: "decision", tone: "slate" });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AgentsPanel projectId={projectId} />
      <Card>
        <CardHeader title="Checklist" icon={<ListChecks className="h-4 w-4" />} subtitle="What is missing or weak, based on everything saved for this product." />
        <CardBody>
          {todos.length === 0 ? <p className="text-sm text-slate-600">Nothing obvious is missing. Evidence gaps are listed in the market research report.</p> : (
            <ul className="divide-y divide-slate-100">
              {todos.map((t) => (
                <li key={t.text}>
                  <a href={`#${t.section}`} className="group flex items-start gap-2.5 py-2.5">
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
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ProductReport({ id }: { id: string }) {
  const { projects, project, select, loading } = useProjects();
  const router = useRouter();
  const [suppliersVersion, setSuppliersVersion] = useState(0);
  const [competitorsVersion, setCompetitorsVersion] = useState(0);
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
  const [active, setActive] = useState("review");
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
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: "instant", block: "start" }));
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${section}`);
    setActive(tab);
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

  // Highlight the section being read.
  useEffect(() => {
    if (!ready) return;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-170px 0px -55% 0px" });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ready]);

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
    if (sid === "review") return <Review projectId={id} decision={project?.decision ?? "undecided"} />;
    const Custom = CUSTOM[sid];
    if (Custom) return <Custom projectId={id} />;
    const Page = PAGES[sid];
    if (!Page) return null;
    const tab = SECTIONS.find((t) => t.id === sid);
    return (
      <EmbedContext.Provider value={{ id: sid, title: part?.title ?? tab?.title ?? "", description: part?.description ?? tab?.description }}>
        {sid === "supplier-list" && (
          <div className="mb-4">
            <h4 className="mb-2 text-sm font-semibold text-ink">Find suppliers on B2B marketplaces</h4>
            <ResearchRunStarter projectId={id} kind="supplier_listings" label="Search supplier listings"
              onFinished={() => setSuppliersVersion((v) => v + 1)}
              approval="This searches Alibaba.com, 1688, Made-in-China, Global Sources and DHgate listings through web search. Each supplier found is saved as unverified, with its listed price and MOQ as a 'listing price' quote - only numbers shown on the source are kept; a listing whose page showed no price is kept as a lead to open. Nothing is ordered or sent."
              focusPlaceholder="e.g. knotted headbands, custom tweed fabric, MOQ under 500" />
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
        <Page key={sid === "supplier-list" ? suppliersVersion : sid === "brands" ? competitorsVersion : undefined} />
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

      <nav aria-label="Report sections" className="z-10 -mx-4 mb-6 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur sm:sticky sm:top-14 sm:-mx-6 sm:px-6">
        {/* Tabs wrap onto more rows rather than scrolling out of view; Fold all stays on the first row, top right. */}
        <div className="flex items-start gap-3">
          <ul className="flex flex-1 flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); jump(s.id); }} aria-current={active === s.id ? "true" : undefined}
                  className={clsx("block rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                    active === s.id ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300 hover:text-primary-700")}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => saveFolded(allFolded ? new Set() : new Set(SECTIONS.map((s) => s.id)))}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">
            {allFolded ? <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />}
            {allFolded ? "Unfold all" : "Fold all"}
          </button>
        </div>
      </nav>

      {/* A compact list of tabs: a folded tab is one row (title + what is inside); an open tab shows its parts. */}
      <div className="divide-y divide-line border-b border-line">
        {SECTIONS.map((s) => {
          const isFolded = folded.has(s.id);
          return (
          <section key={s.id} id={s.id} className="scroll-mt-20 sm:scroll-mt-36" aria-label={s.title}>
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
                    <div key={part.id} id={part.id} className="scroll-mt-20 sm:scroll-mt-36">
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

