"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorText, get } from "@/lib/api";
import { BrandMark } from "./app-shell";
import { useAuth } from "./providers";
import { Alert, Button, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState<{ signup_open: boolean; first_user: boolean; google_enabled: boolean } | null>(null);

  useEffect(() => {
    get<{ signup_open: boolean; first_user: boolean; google_enabled: boolean }>("/api/auth/signup-status").then(setSignup).catch(() => {});
    // Google sign-in failures come back as /login?error=...
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setError(err);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", body: mode === "signup" ? { email, password, display_name: name || null } : { email, password } });
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-600 px-12 py-12 text-white lg:flex lg:flex-col">
        <BrandMark light />
        <div className="my-auto max-w-lg">
          <div className="mb-5 h-1 w-14 rounded-full bg-accent-500" aria-hidden />
          <h2 className="text-[2.6rem] font-semibold leading-[1.1]">Launch product businesses on evidence, not guesswork.</h2>
          <p className="mt-4 font-script text-3xl text-mist">sourced, checked, decided</p>
          <ul className="mt-8 space-y-3 text-[15px] text-white/85">
            {[
              "Market research where every finding links to its source",
              "Competitor prices, supplier quotes and landed cost in one place",
              "Unit economics, channels and shipping you can defend",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mist" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rotate-12 rounded-[48px] border-[28px] border-white/5" />
      </aside>
      <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="mb-6 lg:hidden"><BrandMark /></div>
          <div className="mb-3 h-1 w-12 rounded-full bg-accent-600" aria-hidden />
          <h1 className="text-3xl font-semibold text-brand-700">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-1.5 text-[15px] text-slate-600">
            {mode === "login" ? "Sign in to your workspace" : signup?.first_user ? "This first account becomes the workspace owner" : "Join this workspace"}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line border-t-4 border-t-brand-600 bg-white p-6 shadow-sm">
          {mode === "signup" && signup && !signup.signup_open && (
            <Alert>Sign-ups are closed on this workspace. Ask the owner to add your email to the invite list.</Alert>
          )}
          {signup?.google_enabled && (
            <>
              <a
                href="/api/auth/google/login?next=/dashboard"
                className="flex min-h-10 w-full items-center justify-center gap-2.5 rounded-lg border-2 border-brand-600 bg-white px-3.5 py-2 text-[13px] font-bold uppercase tracking-[0.05em] text-brand-700 hover:bg-brand-50"
              >
                <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continue with Google
              </a>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or use email <span className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          )}
          {mode === "signup" && (
            <Field label="Name (optional)">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </Field>
          {error && <Alert tone="red">{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full">
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-brand-700 hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-brand-700 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
      </div>
    </div>
  );
}
