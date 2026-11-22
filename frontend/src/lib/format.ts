export function money(v: number | null | undefined, opts: { decimals?: number; currency?: string } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const decimals = opts.decimals ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: opts.currency ?? "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

export function pct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v.toFixed(decimals)}%`;
}

export function num(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(v);
}

export function date(v: string | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ago(v: string | null | undefined): string {
  if (!v) return "-";
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
