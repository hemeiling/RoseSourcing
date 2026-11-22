"use client";

import clsx from "clsx";
import {
  BarChart3,
  Bot,
  Briefcase,
  Factory,
  FolderKanban,
  LayoutDashboard,
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

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
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
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Briefcase className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">AI Commerce OS</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Business intelligence</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
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
      <div className="border-t border-white/10 px-4 py-3 text-[11px] text-slate-400">
        {status ? (
          status.ai.configured ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> AI connected · {status.ai.model}
            </span>
          ) : (
            <Link href="/settings" className="flex items-center gap-1.5 text-amber-300 hover:underline">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> AI not configured
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
      <span className="hidden text-xs font-medium text-slate-500 sm:inline">Project</span>
      <select
        value={project?.id ?? ""}
        onChange={(e) => select(e.target.value)}
        className="min-w-0 max-w-[16rem] truncate rounded-lg border border-slate-300 bg-white py-1.5 pl-2.5 pr-8 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-slate-900 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900">
            <button className="absolute right-2 top-3 rounded p-1.5 text-slate-300 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
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
