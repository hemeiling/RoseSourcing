"use client";

import clsx from "clsx";
import { Languages } from "lucide-react";
import { LANGS, useT } from "@/lib/i18n";

/** English / 中文: switches the whole interface and remembers the choice in this browser. */
export function LanguageSwitch({ className, showIcon = true }: { className?: string; showIcon?: boolean }) {
  const { lang, setLang, t } = useT();
  return (
    <div role="group" aria-label={t("Language")} title={t("Language")} className={clsx("inline-flex items-center gap-1", className)}>
      {showIcon && <Languages className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />}
      <div className="inline-flex overflow-hidden rounded-md border border-line">
        {LANGS.map((l) => (
          <button
            key={l.value}
            type="button"
            lang={l.htmlLang}
            aria-pressed={lang === l.value}
            onClick={() => setLang(l.value)}
            className={clsx(
              "whitespace-nowrap px-2 py-1 text-[11px] font-semibold leading-none transition-colors",
              lang === l.value ? "bg-primary-600 text-white" : "bg-white text-slate-600 hover:bg-primary-50 hover:text-primary-800",
            )}
          >
            {l.value === "en" ? "EN" : l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
