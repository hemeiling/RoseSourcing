"use client";

import clsx from "clsx";
import { useT } from "@/lib/i18n";

/**
 * 136Sourcing mark: a friendly parcel - the product you source - with a sparkle for the winning find.
 * Humble flat shapes, a few cheerful colours, and a small smile.
 */
export function BoxMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx("shrink-0", className)} aria-hidden>
      <path d="M31 3.5 L32.1 6.9 L35.5 8 L32.1 9.1 L31 12.5 L29.9 9.1 L26.5 8 L29.9 6.9 Z" fill="#14a89b" />
      <circle cx="8.5" cy="8" r="1.6" fill="#f25f8b" />
      <circle cx="13" cy="4.5" r="1" fill="#ffc53d" />
      <rect x="7" y="17" width="26" height="17.5" rx="4.5" fill="#ffd166" stroke="#4e2a84" strokeWidth="1.6" />
      <rect x="5" y="12.2" width="30" height="7" rx="2.6" fill="#8b6cf0" stroke="#4e2a84" strokeWidth="1.6" />
      <rect x="17.2" y="13" width="5.6" height="5.4" fill="#f25f8b" />
      <circle cx="15.6" cy="24.6" r="1.45" fill="#2d2d2d" />
      <circle cx="24.4" cy="24.6" r="1.45" fill="#2d2d2d" />
      <path d="M17.4 27.6 Q20 30.4 22.6 27.6" fill="none" stroke="#2d2d2d" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="12.6" cy="28" rx="1.7" ry="1.05" fill="#f25f8b" opacity="0.75" />
      <ellipse cx="27.4" cy="28" rx="1.7" ry="1.05" fill="#f25f8b" opacity="0.75" />
    </svg>
  );
}

/** Mark plus wordmark: the colourful "136" house name, then the product name - 136Sourcing (and e.g. 136CRM). */
export function BrandMark({ light, compact }: { light?: boolean; compact?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2.5">
      <BoxMark className="h-10 w-10" />
      {!compact && (
        <div className="leading-none">
          <div className="text-[22px] font-bold tracking-[-0.015em]">
            <span className={light ? "text-white" : "text-[#5b3bc9]"}>1</span>
            <span className={light ? "text-[#ffc2d4]" : "text-[#e8467c]"}>3</span>
            <span className={light ? "text-[#9ff0e6]" : "text-[#0f9e90]"}>6</span>
            <span className={clsx("font-semibold", light ? "text-white" : "text-ink")}>Sourcing</span>
          </div>
          <div className={clsx("mt-1 text-[11px] font-medium", light ? "text-white/75" : "text-slate-500")}>{t("Product research & sourcing")}</div>
        </div>
      )}
    </div>
  );
}
