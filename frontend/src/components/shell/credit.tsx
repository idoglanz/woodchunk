"use client";

import { useTranslations } from "use-intl";

/** The quiet line at the bottom of every page. */
export function Credit() {
  const t = useTranslations("nav");
  return (
    <footer className="no-print pb-[max(24px,env(safe-area-inset-bottom))] pt-2 text-center text-[12px] text-ink-3">
      {t("credit")}
    </footer>
  );
}
