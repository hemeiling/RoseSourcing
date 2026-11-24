"use client";

// The interface in English or Simplified Chinese. The English text is the key: t("Products") shows "Products" in English
// and the Chinese dictionary's entry ("产品") in Chinese, falling back to the English when an entry is missing. Keys are
// typed from the Chinese dictionary, so `npx tsc --noEmit` fails on any t() text that has no Chinese yet.
// Research the agents wrote (findings, reports, supplier names) is shown as stored; only the interface is translated.

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { zh } from "./zh";

export type Lang = "en" | "zh";
export type MsgKey = keyof typeof zh;
export type Vars = Record<string, string | number>;

export const LANGS: { value: Lang; label: string; htmlLang: string }[] = [
  { value: "en", label: "English", htmlLang: "en" },
  { value: "zh", label: "中文", htmlLang: "zh-CN" },
];

const STORAGE_KEY = "136sourcing.lang";
const ZH: Record<string, string> = zh;

// The language on screen, for code outside React (API error messages, date formatting). Set while the provider renders,
// so everything below it reads the new language in the same render.
let current: Lang = "en";
export const getLang = (): Lang => current;

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

function lookup(lang: Lang, key: string): string {
  return lang === "zh" ? (ZH[key] ?? key) : key;
}

/** t() for code outside components. Components use `useT().t`, which also re-renders them when the language changes. */
export function translate(key: MsgKey, vars?: Vars): string {
  return fill(lookup(current, key), vars);
}

/** Text known only at run time (a status from the server, a stored label): translated when the dictionary has it. */
export function translateAny(s: string | null | undefined, vars?: Vars): string {
  return s ? fill(lookup(current, s), vars) : "";
}

/** Splits a translated sentence on {name} and puts each part (a link, a bold word...) in its place. */
function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  const out = text.split(/\{(\w+)\}/g);
  return out.map((piece, i) => (i % 2 ? <Fragment key={i}>{piece in parts ? parts[piece] : `{${piece}}`}</Fragment> : piece || null));
}

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Interface text: t("{n} products", { n: 3 }). */
  t: (key: MsgKey, vars?: Vars) => string;
  /** Run-time text (server statuses, stored labels): translated when the dictionary has it, else shown as is. */
  tx: (s: string | null | undefined, vars?: Vars) => string;
  /** A sentence with elements inside: tr("Open {link} to connect", { link: <Link>Settings</Link> }). */
  tr: (key: MsgKey, parts: Record<string, ReactNode>) => ReactNode;
};

const make = (lang: Lang, setLang: (l: Lang) => void): I18n => ({
  lang,
  setLang,
  t: (key, vars) => fill(lookup(lang, key), vars),
  tx: (s, vars) => (s ? fill(lookup(lang, s), vars) : ""),
  tr: (key, parts) => rich(lookup(lang, key), parts),
});

const I18nContext = createContext<I18n>(make("en", () => {}));

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Pages are pre-rendered in English; the saved choice is applied once the page is running.
  const [lang, setLangState] = useState<Lang>("en");
  current = lang;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "zh") setLangState(saved);
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = LANGS.find((l) => l.value === lang)?.htmlLang ?? "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch { /* storage unavailable */ }
  }, []);

  const value = useMemo(() => make(lang, setLang), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext);
