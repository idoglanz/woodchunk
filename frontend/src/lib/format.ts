import { useLocale, useTranslations } from "use-intl";
import { dateLocale } from "@/lib/lang";

const SYMBOL: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };

export function money(value: number | null | undefined, currency = "ILS"): string {
  if (value === null || value === undefined) return "—";
  const sym = SYMBOL[currency] ?? `${currency} `;
  return `${sym}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A total that may be missing prices: "No prices yet" (`none`, in the page's language) rather than a misleading ₪0.00. */
export function costText(value: number, currency: string, unpriced: boolean, none = "No prices yet"): string {
  return unpriced && !value ? none : money(value, currency);
}

export function moneyShort(value: number | null | undefined, currency = "ILS"): string {
  if (value === null || value === undefined) return "—";
  const sym = SYMBOL[currency] ?? `${currency} `;
  return `${sym}${Math.round(value).toLocaleString("en-US")}`;
}

export function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** "5 min ago", "3 d ago", then the date: in the app's language. */
export function useRelativeTime(): (iso: string) => string {
  const t = useTranslations("common.time");
  const lang = useLocale();
  return (iso) => {
    const d = new Date(iso);
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return t("justNow");
    if (s < 3600) return t("minutesAgo", { n: Math.floor(s / 60) });
    if (s < 86400) return t("hoursAgo", { n: Math.floor(s / 3600) });
    if (s < 86400 * 7) return t("daysAgo", { n: Math.floor(s / 86400) });
    return d.toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" });
  };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/**
 * Whole-number percentages that add up to 100 (largest remainders get the rounding); a share
 * too small to round to 1 shows as "<1%".
 */
export function shares(values: number[]): string[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => "0%");
  const exact = values.map((v) => (v * 100) / total);
  const whole = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - whole[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < 100 - whole.reduce((a, b) => a + b, 0); k++) whole[order[k % order.length][1]]++;
  return whole.map((w, i) => (w === 0 && values[i] > 0 ? "<1%" : `${w}%`));
}
