"use client";

import { Briefcase } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorText, get } from "@/lib/api";
import { useAuth } from "./providers";
import { Alert, Button, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState<{ signup_open: boolean; first_user: boolean } | null>(null);

  useEffect(() => {
    get<{ signup_open: boolean; first_user: boolean }>("/api/auth/signup-status").then(setSignup).catch(() => {});
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
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Briefcase className="h-5 w-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">AI Commerce OS</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "login" ? "Sign in to your workspace" : signup?.first_user ? "Create the owner account for this workspace" : "Create your account"}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {mode === "signup" && signup && !signup.signup_open && (
            <Alert>Sign-ups are closed on this workspace. Ask the owner to add your email to the invite list.</Alert>
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
  );
}
