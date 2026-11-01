"use client";

import { DirectionProvider } from "@radix-ui/react-direction";
import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { IntlProvider, type useTranslations } from "use-intl";
import { dirOf, type Lang } from "@/lib/i18n";
import { en, he as heFiles } from "@/messages";

// Every English message needs its Hebrew: a missing key fails the type check here.
const he: typeof en = heFiles;
const MESSAGES = { en, he };

declare module "use-intl" {
  interface AppConfig {
    Locale: Lang;
    Messages: typeof en;
  }
}

/** A translator for one area, for code outside components (tests make one with createTranslator). */
export type Translator<NS extends keyof typeof en> = ReturnType<typeof useTranslations<NS>>;

/** Dates and numbers in each language. English keeps its "1 Nov 2026" dates and 1,234.5 numbers. */
export function dateLocale(lang: Lang): string {
  return lang === "he" ? "he-IL" : "en-GB";
}

export function numberLocale(lang: Lang): string {
  return lang === "he" ? "he-IL" : "en-US";
}

export const LANG_KEY = "wc.lang";

/** Inline script for <head>: a Hebrew page is right-to-left from the first paint. */
export const langScript = `(function(){try{if(localStorage.getItem("${LANG_KEY}")==="he"){var d=document.documentElement;d.lang="he";d.dir="rtl"}}catch(e){}})()`;

const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "he" ? "he" : "en";
  } catch {
    return "en";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === LANG_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

/** The app's language: the account's choice, remembered on this device for the next first paint. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => "en");
}

export function applyLang(lang: Lang) {
  try {
    if (lang === "he") localStorage.setItem(LANG_KEY, lang);
    else localStorage.removeItem(LANG_KEY);
  } catch {}
  const d = document.documentElement;
  d.lang = lang;
  d.dir = dirOf(lang);
  listeners.forEach((l) => l());
}

/** Follows the account's language once it has loaded. */
export function LangSync({ lang }: { lang?: Lang }) {
  useLayoutEffect(() => {
    if (lang && lang !== readLang()) applyLang(lang);
  }, [lang]);
  return null;
}

const TIME_ZONE = typeof window === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;

export function LangProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  return (
    <IntlProvider locale={lang} messages={MESSAGES[lang]} timeZone={TIME_ZONE}>
      <DirectionProvider dir={dirOf(lang)}>{children}</DirectionProvider>
    </IntlProvider>
  );
}
