"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, Bot, ListChecks, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { DecisionBadge } from "@/components/decision";
import { RunStatusBadge, fmtCost } from "@/components/market/shared";
import { ComplianceSection, PriceTiersSection } from "@/components/product-insights";
import { ResearchRunStarter } from "@/components/research-run-starter";
import { useProjects } from "@/components/providers";
import { Button, Card, CardBody, CardHeader, EmbedContext, EmptyState, Spinner } from "@/components/ui";
import { money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { AGENTS } from "@/lib/agents";
import { errorText, post } from "@/lib/api";
import { ago } from "@/lib/format";
import { SECTIONS, SECTION_BY_ROUTE, type SectionId } from "@/lib/sections";
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

const CUSTOM: Partial<Record<SectionId, (p: { projectId: string }) => ReactNode>> = { pricing: PriceTiersSection, compliance: ComplianceSection };

const PAGES: Partial<Record<SectionId, () => ReactNode>> = {
  overview: DashboardPage, market: MarketPage, competitors: CompetitorsPage, sizing: SizingPage, suppliers: SuppliersPage,
  channels: ChannelsPage, economics: AnalyticsPage, brand: BrandPage, commerce: CommercePage,
};

type Dashboard = {
  counts: Record<string, number>;
  findings_by_type: Record<string, number>;
  latest_run: { status: string } | null;
  latest_scenario: { contribution_margin: number | null; retail_price: number | null } | null;
};

type Todo = { text: string; detail?: string; section: string; tone: "red" | "amber" | "slate" };

/** Every research agent, with its latest run for this product. "Run" jumps to the section where it is started. */
function AgentsPanel({ projectId }: { projectId: string }) {
  const runs = useApi<ResearchRun[]>(`/api/projects/${projectId}/research-runs`);
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Research agents" icon={<Bot className="h-4 w-4" />}
        subtitle="The same agents work on every product. Each run is saved with this product, with its sources and cost." />
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
  if (!c.research_runs) todos.push({ text: "Run market research", detail: "Nothing has been researched for this product yet.", section: "market", tone: "amber" });
  if (cm !== null && cm !== undefined && cm < 0)
    todos.push({ text: `Unit contribution is negative (${money(cm)})`, detail: `At ${money(dash.data.latest_scenario?.retail_price)} retail you lose money on each sale - revisit price or costs.`, section: "economics", tone: "red" });
  if (!c.suppliers) todos.push({ text: "No suppliers yet", detail: "Factory cost, MOQ and lead time are still assumptions - search B2B listings to start.", section: "suppliers", tone: "amber" });
  if (!c.competitors) todos.push({ text: "No competitors tracked", detail: "Add the brands you compete with and their prices.", section: "competitors", tone: "amber" });
  if (!c.size_charts) todos.push({ text: "No size chart yet", detail: "Add your size guide or a supplier's chart so customers can find their size.", section: "sizing", tone: "slate" });
  if (!c.channels) todos.push({ text: "Selling channels not compared", detail: "Compare marketplace and store fees for this product.", section: "channels", tone: "slate" });
  if (!c.scenarios) todos.push({ text: "No unit economics yet", detail: "Model cost, price and margin.", section: "economics", tone: "slate" });
  if (!c.price_tier_reports) todos.push({ text: "Price tiers not researched", detail: "See what budget, mid, premium and luxury buyers each want before you pick a price.", section: "pricing", tone: "slate" });
  if (!c.compliance_checks) todos.push({ text: "No compliance check yet", detail: "Design patents, labelling and UFLPA forced-labour rules - and questions for your supplier.", section: "compliance", tone: "amber" });
  if (unavailable) todos.push({ text: `${unavailable} research questions had no reliable data`, detail: "Listed as 'data unavailable' findings - these are your evidence gaps.", section: "market", tone: "slate" });
  if (decision === "undecided") todos.push({ text: "Record your go / no-go decision", detail: "Your decision is saved with a snapshot of the evidence.", section: "overview", tone: "slate" });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AgentsPanel projectId={projectId} />
      <Card>
        <CardHeader title="Checklist" icon={<ListChecks className="h-4 w-4" />} subtitle="What is missing or weak, based on everything saved for this product." />
        <CardBody>
          {todos.length === 0 ? <p className="text-sm text-slate-600">Nothing obvious is missing. Review the evidence gaps on the right.</p> : (
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
      <Card>
        <CardHeader title="From the latest research report" subtitle={report ? "Evidence gaps and the suggested next steps." : "Run market research to get evidence gaps and next steps."} />
        <CardBody className="space-y-4">
          {!report ? <a href="#market" className="text-sm font-medium text-primary-700 hover:underline">Go to market research</a> : (
            <>
              {report.evidence_gaps.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Evidence gaps</h3>
                  <ul className="space-y-2">
                    {report.evidence_gaps.slice(0, 5).map((g) => (
                      <li key={g.gap} className="text-sm"><span className="font-medium text-ink">{g.gap}.</span> <span className="text-slate-600">{g.how_to_close}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {report.next_steps.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Next steps</h3>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
                    {report.next_steps.slice(0, 4).map((s) => <li key={s.action}>{s.action}</li>)}
                  </ol>
                </div>
              )}
              <a href="#market" className="inline-block text-sm font-medium text-primary-700 hover:underline">Read the full report</a>
            </>
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
  const exists = projects.some((p) => p.id === id);

  useEffect(() => {
    if (exists && project?.id !== id) select(id);
  }, [exists, project?.id, id, select]);

  const jump = useCallback((section: string, smooth = true) => {
    document.getElementById(section)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${section}`);
    setActive(section);
  }, []);

  // Deep links (#market): sections above load their data asynchronously, so re-align a few times unless the user scrolls.
  const ready = project?.id === id;
  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash.slice(1);
    if (!hash || !SECTIONS.some((s) => s.id === hash)) return;
    userScrolled.current = false;
    const stop = () => { userScrolled.current = true; };
    window.addEventListener("wheel", stop, { once: true });
    window.addEventListener("touchmove", stop, { once: true });
    window.addEventListener("keydown", stop, { once: true });
    window.addEventListener("pointerdown", stop, { once: true });
    const timers = [50, 700, 1600, 3000].map((ms) => setTimeout(() => { if (!userScrolled.current) jump(hash, false); }, ms));
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
    }, { rootMargin: "-130px 0px -55% 0px" });
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

  if (loading) return <Spinner />;
  if (!exists)
    return <EmptyState title="Product not found" action={<Link href="/products"><Button>See all products</Button></Link>}>It may have been deleted, or the link is incomplete.</EmptyState>;
  if (!ready || !project) return <Spinner />;

  return (
    <div onClickCapture={onClickCapture}>
      <div className="mb-4">
        <Link href="/products" className="text-xs font-semibold text-primary-700 hover:underline">← All products</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-[2.15rem]">{project.name}</h1>
            <p className="mt-1 text-[15px] text-slate-600">
              {project.product_category} · {project.target_country}{project.sourcing_country ? ` · sourcing from ${project.sourcing_country}` : ""}
              {project.budget_usd !== null ? ` · budget ${money(project.budget_usd, { decimals: 0 })}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><DecisionBadge decision={project.decision} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/copilot"><Button variant="secondary"><Bot className="h-4 w-4" /> Ask the copilot</Button></Link>
            <Link href="/projects"><Button variant="ghost"><Pencil className="h-4 w-4" /> Edit details</Button></Link>
          </div>
        </div>
      </div>

      <nav aria-label="Report sections" className="sticky top-14 z-10 -mx-4 mb-6 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <ul className="flex gap-1.5 overflow-x-auto">
          {SECTIONS.map((s) => (
            <li key={s.id} className="shrink-0">
              <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); jump(s.id); }} aria-current={active === s.id ? "true" : undefined}
                className={clsx("block rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  active === s.id ? "border-primary-600 bg-primary-600 text-white" : "border-line bg-white text-slate-700 hover:border-primary-300 hover:text-primary-700")}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-12">
        {SECTIONS.map((s) => {
          const Page = PAGES[s.id];
          const Custom = CUSTOM[s.id];
          return (
          <section key={s.id} id={s.id} className="scroll-mt-32" aria-label={s.title}>
            {Custom ? (
              <>
                <div className="mb-4 border-b border-line pb-3">
                  <h2 className="text-2xl font-semibold leading-tight text-ink">{s.title}</h2>
                  {s.description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{s.description}</p>}
                </div>
                <Custom projectId={id} />
              </>
            ) : Page ? (
              <EmbedContext.Provider value={{ id: s.id, title: s.title, description: s.description }}>
                {s.id === "suppliers" && (
                  <div className="mb-4">
                    <h3 className="mb-2 text-sm font-semibold text-ink">Find suppliers on B2B marketplaces</h3>
                    <ResearchRunStarter projectId={id} kind="supplier_listings" label="Search supplier listings"
                      onFinished={() => setSuppliersVersion((v) => v + 1)}
                      approval="This searches Alibaba.com, 1688, Made-in-China, Global Sources and DHgate listings through web search. Each supplier found is saved as unverified, with its listed price and MOQ as a 'listing price' quote - only numbers shown on the source are kept. Nothing is ordered or sent."
                      focusPlaceholder="e.g. knotted headbands, custom tweed fabric, MOQ under 500" />
                  </div>
                )}
                {s.id === "competitors" && (
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm">
                    <span className="text-slate-600">Place each competitor in the budget / mid / premium / luxury tiers found by the Price Tier Agent, using its prices or matching listings.</span>
                    <Button size="sm" variant="secondary" onClick={assignTiers}>Assign price tiers</Button>
                    {tierNote && <span className="w-full text-xs text-slate-500">{tierNote}</span>}
                  </div>
                )}
                <Page key={s.id === "suppliers" ? suppliersVersion : s.id === "competitors" ? competitorsVersion : undefined} />
              </EmbedContext.Provider>
            ) : (
              <>
                <div className="mb-4 border-b border-line pb-3">
                  <h2 className="text-2xl font-semibold leading-tight text-ink">{s.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">A quick read of what is missing or weak. Each item jumps to the section to fix it.</p>
                </div>
                <Review projectId={id} decision={project.decision} />
              </>
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

