"use client";

import clsx from "clsx";
import { FolderKanban, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SECTION_BY_ROUTE, productHref } from "@/lib/sections";
import { useAuth, useProjects, useStatus } from "./providers";
import { BrandMark } from "./brand-logo";
import { Button, EmptyState, Spinner } from "./ui";

export { BrandMark } from "./brand-logo";

const DECISION_LABEL: Record<string, string> = { go: "Go", no_go: "No-go", on_hold: "On hold", undecided: "" };

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  const { status } = useStatus();
  const { projects, project } = useProjects();
  const [q, setQ] = useState("");
  const shown = projects.filter((p) => !q.trim() || `${p.name} ${p.product_category}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className={clsx("flex items-center border-b border-line pb-4 pt-5", collapsed ? "flex-col gap-3 px-2" : "justify-between gap-2 px-4")}>
        <Link href="/products" onClick={onNavigate} aria-label="136sourcing home"><BrandMark compact={collapsed} /></Link>
        {onToggle && (
          <button onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-md p-1.5 text-primary-700 hover:bg-primary-50">
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className={clsx("flex min-h-0 flex-1 flex-col py-3", collapsed ? "px-2" : "px-2.5")}>
        <Link
          href="/products"
          onClick={onNavigate}
          title="Products"
          className={clsx(
            "flex items-center gap-2.5 rounded-lg border-l-4 py-2 text-[14px] font-semibold transition-colors",
            collapsed ? "justify-center px-0" : "px-3",
            pathname === "/products" ? "border-primary-600 bg-primary-50 text-primary-800" : "border-transparent text-primary-700 hover:bg-primary-50",
          )}
          aria-current={pathname === "/products" ? "page" : undefined}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && <>Products<span className="ml-auto text-[11px] font-normal text-primary-400">{projects.length || ""}</span></>}
        </Link>
        {!collapsed && projects.length > 4 && (
          <label className="mx-1 mt-2 flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1.5 text-primary-400 focus-within:border-primary-400">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product" aria-label="Find a product"
              className="w-full bg-transparent text-[13px] text-primary-800 placeholder:text-primary-300 focus:outline-none" />
          </label>
        )}
        <ul className={clsx("mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto", collapsed && "flex flex-col items-center")}>
          {shown.map((p) => {
            const active = pathname === "/product" && project?.id === p.id;
            return (
              <li key={p.id} className={collapsed ? "w-full" : undefined}>
                <Link
                  href={productHref(p.id)}
                  onClick={onNavigate}
                  title={p.name}
                  className={clsx(
                    "flex items-center gap-2 rounded-md text-[13.5px] transition-colors",
                    collapsed ? "justify-center py-1.5" : "px-3 py-1.5",
                    active ? "bg-primary-50 font-semibold text-primary-800" : "text-primary-700 hover:bg-primary-50",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {collapsed ? (
                    <span className={clsx("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold",
                      active ? "bg-primary-600 text-white" : "bg-primary-50 text-primary-700")}>{initials(p.name)}</span>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-300" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {DECISION_LABEL[p.decision] && <span className="shrink-0 text-[10px] font-semibold text-primary-400">{DECISION_LABEL[p.decision]}</span>}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
          {!collapsed && q && shown.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No product matches "{q}".</li>}
        </ul>
      </div>
      <div className={clsx("border-t border-line py-3 text-[11px] text-slate-500", collapsed ? "flex justify-center px-2" : "px-5")}>
        {status ? (
          status.ai.configured ? (
            <span className="flex items-center gap-1.5" title={`AI connected · ${status.ai.model}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{!collapsed && <>AI connected · {status.ai.model}</>}
            </span>
          ) : (
            <Link href="/settings" className="flex items-center gap-1.5 text-primary-700 hover:underline" title="AI not configured">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{!collapsed && "AI not configured"}
            </Link>
          )
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </nav>
  );
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s&]/gu, " ").split(/\s+/).filter((w) => w && !["and", "&", "the", "of", "women's", "men's", "womens", "mens"].includes(w.toLowerCase()));
  return (words.slice(0, 2).map((w) => w[0]).join("") || name.slice(0, 2)).toUpperCase();
}

const COLLAPSE_KEY = "136sourcing.sidebarCollapsed";

function ProjectSwitcher() {
  const { projects, project, select } = useProjects();
  if (!projects.length) {
    return (
      <Link href="/projects" className="text-sm font-medium text-primary-700 hover:underline">
        Create your first project
      </Link>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="hidden text-[11px] font-bold uppercase tracking-[0.06em] text-brand-700 sm:inline">Project</span>
      <select
        value={project?.id ?? ""}
        onChange={(e) => select(e.target.value)}
        className="min-w-0 max-w-[16rem] truncate rounded-md border border-slate-400/70 bg-white py-1.5 pl-2.5 pr-8 text-sm font-medium text-ink focus:border-brand-600 focus:outline-none"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { project, loading: projectsLoading } = useProjects();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const section = pathname ? SECTION_BY_ROUTE[pathname] : undefined;

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage unavailable */ }
  }, []);
  const toggle = () => setCollapsed((c) => {
    try { window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* storage unavailable */ }
    return !c;
  });

  // The old per-area pages now live as sections of the product report.
  useEffect(() => {
    if (!user || projectsLoading) return;
    if (pathname === "/pipeline") return router.replace("/products");
    if (!section) return;
    if (!project) return router.replace("/products");
    const qs = window.location.search.replace(/^\?/, "");
    router.replace(`/product?id=${project.id}${qs ? `&${qs}` : ""}#${section}`);
  }, [user, projectsLoading, pathname, section, project, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <aside className={clsx("fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-white transition-[width] duration-200 lg:block", collapsed ? "w-16" : "w-64")}>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-white">
            <button className="absolute right-2 top-3 z-10 rounded p-1.5 text-primary-700 hover:bg-primary-50" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className={clsx("transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          {pathname !== "/product" && pathname !== "/products" && <ProjectSwitcher />}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 md:inline">{user.email}</span>
            <Link href="/settings" aria-label="Settings"
              className={clsx("inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-ink", pathname === "/settings" && "bg-slate-100 text-ink")}>
              <Settings className="h-4 w-4" /><span className="hidden sm:inline">Settings</span>
            </Link>
            <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{section || pathname === "/pipeline" ? <Spinner /> : children}</main>
      </div>
    </div>
  );
}

/** Renders children only when a project is selected; otherwise guides the user to create one. */
export function RequireProject({ children }: { children: (projectId: string) => ReactNode }) {
  const { project, loading } = useProjects();
  if (loading) return <Spinner />;
  if (!project)
    return (
      <EmptyState
        icon={<FolderKanban className="h-5 w-5" />}
        title="No business project yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/products">
              <Button>Snap a product photo</Button>
            </Link>
            <Link href="/projects?new=1">
              <Button variant="secondary">Create a project</Button>
            </Link>
          </div>
        }
      >
        Projects hold your category, target market, budget and assumptions. Every module works inside a project. Snap a photo of something you might sell and a project is created for you.
      </EmptyState>
    );
  return <>{children(project.id)}</>;
}
