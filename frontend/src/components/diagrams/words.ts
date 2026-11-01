import { useMemo } from "react";
import { createTranslator, useLocale } from "use-intl";
import type { Lang } from "@/lib/i18n";
import { en, he } from "@/messages";

/** The plan's words in an export's own language (the shop sheet, the shopping list), or the app's when none is given. */
export function usePlanWords(lang?: Lang) {
  const app = useLocale();
  const l = lang ?? app;
  return useMemo(() => createTranslator({ locale: l, messages: l === "he" ? he : en, namespace: "plan" }), [l]);
}
