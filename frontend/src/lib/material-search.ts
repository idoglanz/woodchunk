/**
 * Catalog search for the material picker.
 *
 * Numbers are matched against an item's real dimensions (thickness, width, sheet sizes and
 * the nominal sizes in its names), not as substrings, so "10" does not match "100" and
 * "44 100", "44x100" and "44/100" all find the 44 × 100 boards. Words match the item's
 * search text (English and Hebrew names, material, treatment, category). The last number
 * may be a prefix while the user is still typing. Every token must match.
 */

import type { CatalogItem } from "@/lib/api/client";

type Token = { kind: "num"; value: string } | { kind: "word"; value: string };

export function tokenize(query: string): Token[] {
  const q = query
    .toLowerCase()
    .replace(/(\d)\s*[x×*/\\]\s*(?=\d)/g, "$1 ")
    .replace(/[,()]/g, " ")
    .trim();
  return q.split(/\s+/).filter(Boolean).map((t) => {
    const num = t.replace(/mm$/, "");
    return /^\d+(\.\d+)?$/.test(num) ? { kind: "num", value: String(Number(num)) } : { kind: "word", value: t };
  });
}

const numberCache = new WeakMap<CatalogItem, Set<string>>();

function numbersOf(it: CatalogItem): Set<string> {
  const hit = numberCache.get(it);
  if (hit) return hit;
  const out = new Set<string>();
  const add = (n: number | null | undefined) => {
    if (n != null && Number.isFinite(n)) out.add(String(Math.round(n * 10) / 10));
  };
  add(it.thickness_mm);
  add(it.width_mm);
  for (const s of it.sheet_stock) {
    add(s.width_mm);
    add(s.length_mm);
  }
  for (const name of [it.name.en, it.name.he]) {
    for (const m of name.matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
  }
  numberCache.set(it, out);
  return out;
}

/** Score an item for the query; null means it doesn't match. Higher is better. */
export function scoreItem(it: CatalogItem, tokens: Token[]): number | null {
  if (!tokens.length) return 0;
  const nums = numbersOf(it);
  let score = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const last = i === tokens.length - 1;
    if (t.kind === "num") {
      if (nums.has(t.value)) {
        score += 4;
        // Exact cross-section hits rank above sizes that only appear in a name.
        if (String(it.thickness_mm) === t.value || String(it.width_mm) === t.value) score += 2;
      } else if (last && [...nums].some((n) => n.startsWith(t.value))) {
        score += 1;
      } else if (it.search.includes(t.value)) {
        score += 0.5; // e.g. a SKU
      } else {
        return null;
      }
    } else {
      const idx = it.search.indexOf(t.value);
      if (idx < 0) return null;
      // Whole-word starts count more than matches inside a word.
      score += idx === 0 || /[\s,(/-]/.test(it.search[idx - 1]) ? 2 : 1;
    }
  }
  return score;
}

export function searchItems(items: CatalogItem[], query: string): CatalogItem[] {
  const tokens = tokenize(query);
  const scored: { it: CatalogItem; s: number }[] = [];
  for (const it of items) {
    const s = scoreItem(it, tokens);
    if (s !== null) scored.push({ it, s });
  }
  return scored
    .sort((a, b) => b.s - a.s || (a.it.thickness_mm ?? 0) - (b.it.thickness_mm ?? 0) || (a.it.width_mm ?? 0) - (b.it.width_mm ?? 0)
      || a.it.name.en.localeCompare(b.it.name.en))
    .map((x) => x.it);
}
