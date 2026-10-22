"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Pop } from "@/components/ui/overlay";
import type { CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";

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

export function ItemPicker({ items, value, onChange, kinds, placeholder = "Choose material", disabled, ariaLabel, className, allowFree }: {
  items: CatalogItem[]; value: string | null | undefined; onChange: (id: string | null, freeText?: string) => void;
  kinds: CatalogItem["kind"][]; placeholder?: string; disabled?: boolean; ariaLabel: string; className?: string; allowFree?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.id === value);

  const groups = useMemo(() => {
    const words = q.toLowerCase().replace(/×/g, "x").split(/\s+/).filter(Boolean);
    const pool = items.filter((i) => kinds.includes(i.kind) && i.status !== "retired" && words.every((w) => i.search.includes(w)));
    const recent = q ? [] : readRecent().map((id) => pool.find((i) => i.id === id)).filter(Boolean) as CatalogItem[];
    const out: { title: string; items: CatalogItem[] }[] = [];
    if (recent.length) out.push({ title: "Recent", items: recent });
    for (const k of kinds) {
      const list = pool.filter((i) => i.kind === k);
      if (list.length) out.push({ title: k === "lumber" ? "Lumber" : k === "sheet" ? "Sheets" : "Hardware", items: list });
    }
    return out;
  }, [items, kinds, q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const flat = groups.flatMap((g) => g.items);

  const choose = (it: CatalogItem) => {
    rememberMaterial(it.id);
    onChange(it.id);
    setOpen(false);
    setQ("");
  };

  return (
    <Pop open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); setActive(0); }} align="start" className="w-[min(92vw,420px)] p-0"
      trigger={
        <button type="button" disabled={disabled} aria-label={ariaLabel}
          className={cn("flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 text-start text-[14px] transition-colors hover:bg-surface-3 disabled:opacity-60", className)}>
          <span className={cn("min-w-0 flex-1 truncate", !current && "text-ink-3")}>{current ? current.name.en : placeholder}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-3" />
        </button>
      }>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search size={15} className="text-ink-3" />
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder={allowFree ? "Search or type a name" : "Search, e.g. 44 100 treated"}
          aria-label="Search catalog" className="h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter") {
              e.preventDefault();
              if (flat[active]) choose(flat[active]);
              else if (allowFree && q.trim()) { onChange(null, q.trim()); setOpen(false); setQ(""); }
            }
          }} />
      </div>
      <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col">
            <p className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-ink-3">{g.title}</p>
            {g.items.map((it) => {
              const idx = flat.indexOf(it);
              return (
                <button key={`${g.title}-${it.id}`} type="button" onClick={() => choose(it)} onMouseEnter={() => setActive(idx)}
                  className={cn("flex items-start gap-2 rounded-[10px] px-2.5 py-2 text-start", idx === active && "bg-surface-2")}>
                  <span className="mt-0.5 w-4 shrink-0">{it.id === value ? <Check size={15} /> : null}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[14px] leading-snug">{it.name.en}</span>
                    <span className="tnum text-[12px] text-ink-2">{itemDetail(it)}{it.supplier_name ? ` · ${it.supplier_name}` : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length ? (
          allowFree && q.trim() ? (
            <button type="button" className="w-full rounded-[10px] px-3 py-2.5 text-start text-[14px] hover:bg-surface-2" onClick={() => { onChange(null, q.trim()); setOpen(false); setQ(""); }}>
              Use “{q.trim()}” (not in the catalog)
            </button>
          ) : <p className="px-3 py-6 text-center text-[14px] text-ink-2">Nothing matches “{q}”.</p>
        ) : null}
      </div>
    </Pop>
  );
}
