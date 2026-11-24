"use client";

import { Badge, ExternalLink, type Tone } from "@/components/ui";
import { date } from "@/lib/format";
import { translate, useT, type MsgKey } from "@/lib/i18n";

// Labels are English dictionary keys: show them with t().
export const MODE_LABEL: Record<string, MsgKey> = {
  express_courier: "Express courier",
  air_freight: "Air freight",
  sea_lcl: "Sea freight (LCL)",
  sea_fcl: "Sea freight (FCL)",
  rail: "Rail",
  truck: "Truck",
  domestic_parcel: "Domestic parcel",
  fulfillment_3pl: "3PL fulfillment",
  marketplace_fulfillment: "Marketplace fulfillment",
};

export const INTERNATIONAL_MODES = ["express_courier", "air_freight", "sea_lcl", "sea_fcl", "rail", "truck"];
export const DOMESTIC_MODES = ["domestic_parcel", "fulfillment_3pl", "marketplace_fulfillment"];

export const RATE_BASIS_LABEL: Record<string, MsgKey> = {
  per_kg: "per kg (chargeable)",
  per_cbm: "per CBM (weight/measure)",
  per_shipment: "per shipment / container",
  per_unit: "per unit",
  per_order: "per order",
};

export const CHANNEL_TYPE_LABEL: Record<string, MsgKey> = {
  own_store: "Own store",
  marketplace: "Marketplace",
  social_commerce: "Social commerce",
  wholesale: "Wholesale",
  retail_partner: "Retail partner",
  events: "Events / pop-ups",
  other: "Other",
};

export const CHANNEL_STATUS_TONE: Record<string, Tone> = {
  considering: "slate",
  testing: "blue",
  active: "green",
  paused: "amber",
  rejected: "red",
};

const SHIP_BASIS: Record<string, { label: MsgKey; tone: Tone; help: MsgKey }> = {
  quote: { label: "Quote", tone: "blue", help: "A rate a forwarder or carrier quoted you" },
  sourced_research: { label: "Sourced benchmark", tone: "teal", help: "Rate found verbatim in a retrieved source - a benchmark, not a quote" },
  assumption: { label: "Assumption", tone: "slate", help: "Your estimate - replace with a quote" },
};

export function ShipBasisBadge({ basis }: { basis: string }) {
  const { t } = useT();
  const m = SHIP_BASIS[basis];
  if (!m) return <Badge tone="slate" title="">{basis}</Badge>;
  return <Badge tone={m.tone} title={t(m.help)}>{t(m.label)}</Badge>;
}

const FEE_BASIS: Record<string, { label: MsgKey; tone: Tone; help: MsgKey }> = {
  verified: { label: "Fees verified by you", tone: "green", help: "You checked the platform's current fee page" },
  sourced_research: { label: "Fees from source", tone: "teal", help: "Fee values found verbatim in a retrieved source. Re-check before launch - fees change." },
  assumption: { label: "Fees assumed", tone: "amber", help: "Unconfirmed - check the platform's fee page" },
};

export function FeeBasisBadge({ basis, url, checked }: { basis: string; url?: string | null; checked?: string | null }) {
  const { t } = useT();
  const m = FEE_BASIS[basis];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {m ? <Badge tone={m.tone} title={t(m.help)}>{t(m.label)}</Badge> : <Badge tone="slate" title="">{basis}</Badge>}
      {url && <ExternalLink href={url} className="text-[11px]">{t("source")}</ExternalLink>}
      {checked && <span className="text-[11px] text-slate-400">{t("checked {date}", { date: date(checked) })}</span>}
    </span>
  );
}

export function rangeText(low: number | null | undefined, high: number | null | undefined, fmt: (n: number) => string): string {
  if (low === null || low === undefined) return "-";
  if (high === null || high === undefined || high === low) return fmt(low);
  return `${fmt(low)} - ${fmt(high)}`;
}

export function daysText(min: number | null, max: number | null): string {
  if (min === null && max === null) return "-";
  if (min !== null && max !== null && min !== max) return translate("{n} days", { n: `${min}-${max}` });
  return translate("{n} days", { n: String(min ?? max) });
}
