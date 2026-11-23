"use client";

import clsx from "clsx";
import { AlertTriangle, Info, KeyRound, Loader2, X } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        variant !== "ghost" && "font-bold uppercase tracking-[0.05em]",
        variant === "ghost" && "font-medium",
        size === "sm" ? "min-h-8 px-3 py-1.5 text-[11px]" : "min-h-10 px-4 py-2 text-[13px]",
        variant === "primary" && "bg-primary-600 text-white hover:bg-primary-700",
        variant === "secondary" && "border-2 border-primary-600 bg-white text-primary-700 hover:bg-primary-600 hover:text-white",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-ink",
        variant === "danger" && "border-2 border-red-700 bg-white text-red-700 hover:bg-red-700 hover:text-white",
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("overflow-hidden rounded-xl border border-line bg-white", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-1 text-brand-600">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("px-5 py-4", className)}>{children}</div>;
}

const tones = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "slate", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

export function PlannedBadge() {
  return <Badge tone="violet" title="Designed in the architecture; not available in this release">Planned</Badge>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-slate-400/70 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputCls, "min-h-[80px]", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputCls, "pr-8", props.className)} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label ?? "Loading..."}
    </div>
  );
}

/** Set by the product report: pages rendered inside it show a compact section header instead of a page title. */
export const EmbedContext = createContext<{ id: string; title: string; description?: string } | null>(null);
export const useEmbedded = () => useContext(EmbedContext);

export function PageHeader({ title, description, actions, badge }: { title: string; description?: ReactNode; actions?: ReactNode; badge?: ReactNode }) {
  const embed = useEmbedded();
  if (embed)
    return (
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold leading-tight text-ink">{embed.title}</h2>
            {badge}
          </div>
          {(embed.description ?? description) && <p className="mt-1 max-w-3xl text-sm text-slate-600">{embed.description ?? description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    );
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-3 h-1 w-12 rounded-full bg-accent-600" aria-hidden />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold leading-tight text-brand-700 sm:text-[2.15rem]">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-700">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">{icon}</div>}
      <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "amber", title, children, className }: { tone?: "amber" | "red" | "blue"; title?: string; children: ReactNode; className?: string }) {
  const Icon = tone === "blue" ? Info : AlertTriangle;
  return (
    <div
      className={clsx(
        "flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "red" && "border-red-200 bg-red-50 text-red-800",
        tone === "blue" && "border-brand-200 bg-brand-50 text-brand-900",
        className,
      )}
      role={tone === "red" ? "alert" : undefined}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        <div className={clsx(title && "mt-0.5", "text-[13px] leading-relaxed")}>{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <Alert tone="red">{error}</Alert>;
}

/** Shown wherever an AI feature is unavailable because the server lacks credentials. */
export function ConfigNotice({ message }: { message?: string | null }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-l-4 border-line border-l-accent-600 bg-white px-3.5 py-3 text-sm text-slate-700">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
      <div>
        <div className="font-medium text-slate-900">Configuration required</div>
        <div className="mt-0.5 text-[13px]">
          {message ?? "This feature needs an AI provider key on the server."} No results are generated or simulated until it is configured.{" "}
          <Link href="/settings" className="font-medium text-primary-700 underline">
            View settings
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-900/50 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx("w-full overflow-hidden rounded-2xl border-t-4 border-brand-600 bg-white shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-xl font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-[3px] px-3.5 py-2.5 text-[13px] font-bold uppercase tracking-[0.05em] transition-colors",
            value === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-brand-700",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="border-t-4 border-t-brand-600 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">{label}</span>
        {icon && <span className="text-brand-400">{icon}</span>}
      </div>
      <div className="mt-1 font-serif text-4xl font-semibold text-brand-700">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-brand-700", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("px-3 py-2.5 align-top text-sm text-slate-700", className)}>{children}</td>;
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={clsx("text-primary-600 underline decoration-primary-300 underline-offset-2 hover:text-primary-800 hover:decoration-primary-800", className)}>
      {children}
    </a>
  );
}
