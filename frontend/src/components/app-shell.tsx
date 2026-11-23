"use client";

import clsx from "clsx";
import {
  BarChart3,
  Bot,
  Factory,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Palette,
  Settings,
  ShoppingBag,
  Swords,
  TrendingUp,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAuth, useProjects, useStatus } from "./providers";
import { Button, EmptyState, Spinner } from "./ui";

/** Original wordmark: a geometric monogram tile plus the product name set in the display serif. */
export function BrandMark({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0" aria-hidden>
        <rect width="36" height="36" rx="5" fill={light ? "#ffffff" : "#4e2a84"} />
        <path d="M9 27 L18 8 L27 27" fill="none" stroke={light ? "#4e2a84" : "#ffffff"} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="12.5" y="20" width="11" height="3" rx="1.5" fill="#e05329" />
      </svg>
      <div className="leading-tight">
        <div className={clsx("font-serif text-[19px] font-semibold", light ? "text-white" : "text-brand-700")}>AI Commerce OS</div>
        <div className={clsx("text-[10px] font-bold uppercase tracking-[0.14em]", light ? "text-white/70" : "text-slate-500")}>Evidence-led launches</div>
      </div>
    </div>
  );
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Product Pipeline", icon: LayoutGrid },
  { href: "/projects", label: "Business Projects", icon: FolderKanban },
  { href: "/market", label: "Market Opportunity", icon: TrendingUp },
  { href: "/competitors", label: "Competitor Intelligence", icon: Swords },
  { href: "/brand", label: "Brand Studio", icon: Palette },
  { href: "/suppliers", label: "Supplier Intelligence", icon: Factory },
  { href: "/channels", label: "Shipping & Channels", icon: Truck },
  { href: "/commerce", label: "Commerce", icon: ShoppingBag },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/copilot", label: "AI Business Copilot", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { status } = useStatus();
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="border-b border-white/15 px-5 pb-4 pt-5">
        <BrandMark light />
      </div>
      <ul className="flex-1 space-y-0.5 px-2.5 py-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg border-l-4 px-3 py-2 text-[13.5px] transition-colors",
                  active ? "border-accent-500 bg-white/10 font-semibold text-white" : "border-transparent text-white/80 hover:bg-white/5 hover:text-white",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/15 px-5 py-3 text-[11px] text-white/70">
        {status ? (
          status.ai.configured ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> AI connected · {status.ai.model}
            </span>
          ) : (
            <Link href="/settings" className="flex items-center gap-1.5 text-accent-100 hover:underline">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" /> AI not configured
            </Link>
          )
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </nav>
  );
}

function ProjectSwitcher() {
  const { projects, project, select } = useProjects();
  if (!projects.length) {
    return (
      <Link href="/projects" className="text-sm font-medium text-brand-700 hover:underline">
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
  const [open, setOpen] = useState(false);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-brand-600 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-brand-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-brand-600">
            <button className="absolute right-2 top-3 rounded p-1.5 text-slate-300 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <ProjectSwitcher />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 md:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
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
          <Link href="/projects?new=1">
            <Button>Create a project</Button>
          </Link>
        }
      >
        Projects hold your category, target market, budget and assumptions. Every module works inside a project.
      </EmptyState>
    );
  return <>{children(project.id)}</>;
}
