"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SectionGlyph } from "@/components/project/section-glyph";
import { Pop } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import type { CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { searchItems } from "@/lib/material-search";

const RECENT_KEY = "wc.recentMaterials";

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

export function rememberMaterial(id: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 6))); } catch {}
}

export function itemDetail(it: CatalogItem): string {
  if (it.kind === "lumber") {
    const lengths = it.lumber_stock.map((s) => (s.length_mm / 1000).toFixed(1)).join(" · ");
    return `${lengths} m${it.price_per_m != null ? ` · ₪${it.price_per_m.toFixed(2)}/m` : ""}`;
  }
  if (it.kind === "sheet") {
    const s = it.sheet_stock[0];
    return s ? `${s.width_mm} × ${s.length_mm}${s.price != null ? ` · ₪${s.price}` : ""}${it.has_grain ? "" : " · no grain"}` : "no sizes";
  }
  return it.pack_size > 1 ? `pack of ${it.pack_size}` : it.unit;
}

const KIND_KEY = "wc.pickerKind";
const KIND_LABEL: Record<CatalogItem["kind"], string> = { lumber: "Lumber", sheet: "Sheets", hardware: "Hardware" };

function readKind(): CatalogItem["kind"] | null {
  try { return localStorage.getItem(KIND_KEY) as CatalogItem["kind"] | null; } catch { return null; }
}

export function ItemPicker({ items, value, onChange, kinds, placeholder = "Choose material", disabled, ariaLabel, className, allowFree }: {
  items: CatalogItem[]; value: string | null | undefined; onChange: (id: string | null, freeText?: string) => void;
  kinds: CatalogItem["kind"][]; placeholder?: string; disabled?: boolean; ariaLabel: string; className?: string; allowFree?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<CatalogItem["kind"] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.id === value);
  const tabs = kinds.length > 1;

  const pool = useMemo(() => items.filter((i) => kinds.includes(i.kind) && i.status !== "retired"), [items, kinds]);
  const results = useMemo(() => searchItems(pool, q), [pool, q]);
  const kind: CatalogItem["kind"] = tab ?? (current && kinds.includes(current.kind) ? current.kind : null) ?? (() => {
    const k = readKind();
    return k && kinds.includes(k) ? k : kinds[0];
  })();

  const shown = results.filter((i) => i.kind === kind);
  const recent = q ? [] : readRecent().map((id) => shown.find((i) => i.id === id)).filter(Boolean) as CatalogItem[];
  const rest = recent.length ? shown.filter((i) => !recent.includes(i)) : shown;
  const flat = [...recent, ...rest];
  const elsewhere = tabs ? kinds.filter((k) => k !== kind).map((k) => ({ k, n: results.filter((i) => i.kind === k).length })).filter((x) => x.n) : [];

  const switchTab = (k: CatalogItem["kind"]) => {
    setTab(k);
    setActive(0);
    try { localStorage.setItem(KIND_KEY, k); } catch {}
  };

  const choose = (it: CatalogItem) => {
    rememberMaterial(it.id);
    try { localStorage.setItem(KIND_KEY, it.kind); } catch {}
    onChange(it.id);
    setOpen(false);
    setQ("");
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const row = (it: CatalogItem, idx: number) => (
    <button key={it.id} data-idx={idx} type="button" onClick={() => choose(it)} onMouseEnter={() => setActive(idx)}
      className={cn("flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-start", idx === active && "bg-surface-2")}>
      {kind === "hardware" ? null : <SectionGlyph item={it} size={34} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] leading-snug">{it.name.en}</span>
        <span className="tnum truncate text-[12px] text-ink-2">{itemDetail(it)}{it.supplier_name ? ` · ${it.supplier_name}` : ""}</span>
      </span>
      <span className="w-4 shrink-0">{it.id === value ? <Check size={15} /> : null}</span>
    </button>
  );

  return (
    <Pop open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(""); setTab(null); } setActive(0); }} align="start" className="w-[min(92vw,440px)] p-0"
      trigger={
        <button type="button" disabled={disabled} aria-label={ariaLabel}
          className={cn("flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 text-start text-[14px] transition-colors hover:bg-surface-3 disabled:opacity-60", className)}>
          {current && current.kind !== "hardware" ? <SectionGlyph item={current} size={20} /> : null}
          <span className={cn("min-w-0 flex-1 truncate", !current && "text-ink-3")}>{current ? current.name.en : placeholder}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-3" />
        </button>
      }>
      <div className="flex flex-col gap-2 border-b border-line px-3 pb-2.5 pt-1">
        <div className="mt-1.5 flex h-10 items-center gap-2.5 rounded-[10px] bg-surface-2 px-3 transition-shadow duration-150 focus-within:shadow-[0_0_0_2px_var(--accent)]">
          <Search size={15} className="shrink-0 text-ink-3" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder={allowFree ? "Search or type a name" : kind === "sheet" ? "Search, e.g. 18 birch" : "Search, e.g. 44x100 treated"}
            aria-label="Search catalog" className="ring-on-parent h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Tab" && tabs && !e.shiftKey) { e.preventDefault(); switchTab(kinds[(kinds.indexOf(kind) + 1) % kinds.length]); }
              if (e.key === "Enter") {
                e.preventDefault();
                if (flat[active]) choose(flat[active]);
                else if (allowFree && q.trim()) { onChange(null, q.trim()); setOpen(false); setQ(""); }
              }
            }} />
        </div>
        {tabs ? (
          <Segmented size="sm" label="Material kind" value={kind} onChange={switchTab} className="self-start"
            options={kinds.map((k) => ({ value: k, label: q ? `${KIND_LABEL[k]} ${results.filter((i) => i.kind === k).length}` : KIND_LABEL[k] }))} />
        ) : null}
      </div>
      <div ref={listRef} className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5">
        {recent.length ? <p className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-ink-3">Recent</p> : null}
        <div className="flex flex-col">{recent.map((it, i) => row(it, i))}</div>
        {recent.length && rest.length ? <p className="px-2 pb-1 pt-2.5 text-[12px] font-medium text-ink-3">All {KIND_LABEL[kind].toLowerCase()}</p> : null}
        <div className="flex flex-col">{rest.map((it, i) => row(it, i + recent.length))}</div>
        {!flat.length ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
            <p className="text-[14px] text-ink-2">{q ? `No ${KIND_LABEL[kind].toLowerCase()} matches “${q}”.` : `No ${KIND_LABEL[kind].toLowerCase()} in the catalog yet.`}</p>
            {elsewhere.map((x) => (
              <button key={x.k} type="button" onClick={() => switchTab(x.k)} className="text-[14px] font-semibold text-info">
                {x.n} in {KIND_LABEL[x.k].toLowerCase()} →
              </button>
            ))}
            {allowFree && q.trim() ? (
              <button type="button" className="rounded-[10px] px-3 py-2 text-[14px] hover:bg-surface-2" onClick={() => { onChange(null, q.trim()); setOpen(false); setQ(""); }}>
                Use “{q.trim()}” (not in the catalog)
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Pop>
  );
}
