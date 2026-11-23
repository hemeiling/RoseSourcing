"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, get } from "@/lib/api";
import type { Project, SystemStatus, User } from "@/lib/types";

// ----------------------------------------------------------------------------- auth

type AuthCtx = { user: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthContext = createContext<AuthCtx>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });

const PUBLIC = ["/login", "/signup"];
/** Pages anyone can open, signed in or not (the customer-facing size guide). */
const OPEN = ["/fit"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      setUser(await get<User>("/api/auth/me"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      if (!OPEN.some((p) => window.location.pathname.startsWith(p))) router.replace("/login");
    };
    window.addEventListener("aicos:unauthorized", onUnauthorized);
    return () => window.removeEventListener("aicos:unauthorized", onUnauthorized);
  }, [router]);

  useEffect(() => {
    if (loading || OPEN.some((p) => pathname?.startsWith(p))) return;
    const isPublic = PUBLIC.some((p) => pathname?.startsWith(p));
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/dashboard");
  }, [user, loading, pathname, router]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.replace("/login");
  }, [router]);

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// ----------------------------------------------------------------------------- projects

type ProjectCtx = {
  projects: Project[];
  project: Project | null;
  loading: boolean;
  select: (id: string) => void;
  reload: () => Promise<Project[]>;
};
const ProjectContext = createContext<ProjectCtx>({ projects: [], project: null, loading: true, select: () => {}, reload: async () => [] });
const STORAGE_KEY = "aicos.currentProject";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const list = await get<Project[]>("/api/projects");
    setProjects(list);
    setCurrentId((cur) => {
      const stored = cur ?? (typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null);
      const found = list.find((p) => p.id === stored);
      return found ? found.id : (list[0]?.id ?? null);
    });
    setLoading(false);
    return list;
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    reload().catch(() => setLoading(false));
  }, [user, reload]);

  const select = useCallback((id: string) => {
    setCurrentId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const project = useMemo(() => projects.find((p) => p.id === currentId) ?? null, [projects, currentId]);
  return <ProjectContext.Provider value={{ projects, project, loading, select, reload }}>{children}</ProjectContext.Provider>;
}

export const useProjects = () => useContext(ProjectContext);

// ----------------------------------------------------------------------------- system status

type StatusCtx = { status: SystemStatus | null; reload: () => void };
const StatusContext = createContext<StatusCtx>({ status: null, reload: () => {} });

export function StatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const reload = useCallback(() => {
    get<SystemStatus>("/api/system/status").then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    if (user) reload();
  }, [user, reload]);
  return <StatusContext.Provider value={{ status, reload }}>{children}</StatusContext.Provider>;
}

export const useStatus = () => useContext(StatusContext);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <StatusProvider>
        <ProjectProvider>{children}</ProjectProvider>
      </StatusProvider>
    </AuthProvider>
  );
}
