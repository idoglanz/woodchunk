import type { Translator } from "./lang";
import type { Schemas } from "./api/client";

export type Person = Schemas["PersonUsage"];
export type Level = Person["level"];

export const LEVELS: Record<Level, { tone: "ok" | "info" | "neutral"; rank: number }> = {
  high: { tone: "ok", rank: 3 },
  regular: { tone: "info", rank: 2 },
  light: { tone: "neutral", rank: 1 },
  inactive: { tone: "neutral", rank: 0 },
};

/** A level's name and what it means, in the page's language. */
export function levelText(t: Translator<"admin">, level: Level): { label: string; hint: string } {
  return { label: t(`level.${level}`), hint: t(`levelHint.${level}`) };
}

const AI_FEATURES = {
  "project.chat": "projectChat",
  "project.import": "projectImport",
  "catalog.import": "catalogImport",
  "catalog.organize": "catalogOrganize",
  translate: "translate",
} as const;

/** An AI feature's name; one this page doesn't know shows as its id. */
export function aiFeature(t: Translator<"admin">, feature: string): string {
  const key = AI_FEATURES[feature as keyof typeof AI_FEATURES];
  return key ? t(`feature.${key}`) : feature;
}

export type SortKey = "last_seen" | "created_at" | "name" | "projects" | "ai_calls_30d" | "level";
export type SortDir = "asc" | "desc";

/** Every word of the query must appear in the name, email or role. */
export function filterPeople(people: Person[], query: string): Person[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return people;
  return people.filter((p) => {
    const hay = `${p.name} ${p.email} ${p.role}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const KEY: Record<SortKey, (p: Person) => number | string> = {
  last_seen: (p) => p.last_seen,
  created_at: (p) => p.created_at,
  name: (p) => (p.name || p.email).toLowerCase(),
  projects: (p) => p.projects,
  ai_calls_30d: (p) => p.ai_calls_30d,
  level: (p) => LEVELS[p.level].rank * 1000 + p.active_days_30d,
};

/** Sorted copy; ties fall back to the most recently seen. */
export function sortPeople(people: Person[], key: SortKey, dir: SortDir): Person[] {
  const get = KEY[key];
  const sign = dir === "asc" ? 1 : -1;
  return [...people].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0;
  });
}

export type Point = { from: string; to: string; values: number[] };

/**
 * Groups daily rows into buckets of `size` days, aligned so the last bucket ends on the last day.
 * "sum" adds counts up; "avg" gives the daily average (for things like active people, which can't be summed).
 */
export function bucket<T extends { day: string }>(rows: T[], size: number, pick: (r: T) => number[], mode: "sum" | "avg" = "sum"): Point[] {
  const out: Point[] = [];
  for (let end = rows.length; end > 0; end -= size) {
    const group = rows.slice(Math.max(0, end - size), end);
    const sums = group.map(pick).reduce((acc, v) => acc.map((a, i) => a + v[i]));
    out.unshift({
      from: group[0].day,
      to: group[group.length - 1].day,
      values: mode === "avg" ? sums.map((v) => Math.round((v / group.length) * 10) / 10) : sums,
    });
  }
  return out;
}

/** A round axis maximum at or above `n`: 1, 2, 5 × 10^k. */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n) ?? 10 * p;
}

/** "1 Nov", in `locale` (from dateLocale). */
export function shortDay(day: string, locale: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** "45 min", "3 h 20 min". */
export function minutes(n: number, t: Translator<"admin">): string {
  if (n < 60) return t("minutes", { n });
  const h = Math.floor(n / 60), m = n % 60;
  return m ? t("hoursMinutes", { h, m }) : t("hours", { h });
}
