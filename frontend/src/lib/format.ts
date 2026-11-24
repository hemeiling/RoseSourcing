import { getLang, translate, translateAny } from "./i18n";

// Money and numbers read the same in both languages; dates, "5m ago" and status words follow the chosen language.
const dateLocale = () => (getLang() === "zh" ? "zh-CN" : "en-US");

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
  return new Date(v).toLocaleDateString(dateLocale(), { year: "numeric", month: "short", day: "numeric" });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleString(dateLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ago(v: string | null | undefined): string {
  if (!v) return "-";
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return translate("just now");
  if (s < 3600) return translate("{n}m ago", { n: Math.floor(s / 60) });
  if (s < 86400) return translate("{n}h ago", { n: Math.floor(s / 3600) });
  return translate("{n}d ago", { n: Math.floor(s / 86400) });
}

/** A stored value ("completed_with_errors") as a label ("Completed With Errors"), in Chinese when the dictionary has it. */
export function titleCase(s: string): string {
  return translateAny(s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
}

export function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Google Trends week labels ("Nov 21 – 27, 2021", "Dec 28, 2025 – Jan 3, 2026") as "Nov 2021" for chart axes. */
export function monthYear(label: string): string {
  const m = label.match(/^([A-Z][a-z]{2})\b.*?(\d{4})/);
  if (!m) return label;
  if (getLang() === "zh") {
    const month = MONTHS.indexOf(m[1]) + 1;
    if (month) return `${m[2]}年${month}月`;
  }
  return `${m[1]} ${m[2]}`;
}
