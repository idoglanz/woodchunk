"use client";

import { AlertCircle, Check, ChevronDown, Info } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useProjectCtx } from "@/components/project/context";
import { LumberBars } from "@/components/diagrams/lumber";
import { SheetDiagram, cutText } from "@/components/diagrams/sheet";
import { Spinner } from "@/components/ui/button";
import { Badge, Callout, Skeleton } from "@/components/ui/misc";
import { Tip } from "@/components/ui/overlay";
import type { LumberPlan, SheetPlan } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useActivePart } from "@/lib/focus";
import { costText, money, pct, plural, shares } from "@/lib/format";
import { fmtMeters } from "@/lib/units";
import { StockSplit } from "@/components/project/stock-split";

export const materialCardId = (itemId: string) => `mat-${itemId}`;

/** Cost, what to buy and waste, in one line. Shown at the top of the layout panel and on the phone drawer. */
export function PlanSummary({ onIssues, compact }: { onIssues?: () => void; compact?: boolean }) {
  const { plan, planFetching } = useProjectCtx();
  if (!plan) return <span className="flex items-center gap-2 text-[14px] text-ink-3"><Spinner className="h-3.5 w-3.5" />Planning…</span>;
  const t = plan.totals;
  const stock = [t.boards ? plural(t.boards, "board") : "", t.sheets ? plural(t.sheets, "sheet") : ""].filter(Boolean).join(" + ") || "Nothing to buy";
  const [used, offcuts, waste] = shares([t.used_pct, t.offcut_pct, t.waste_pct]);
  return (
    <div className={cn("flex min-w-0 items-baseline gap-x-3 gap-y-1", compact ? "flex-nowrap" : "flex-wrap")}>
      <span className={cn("tnum shrink-0 font-bold tracking-[-0.01em]", t.unpriced_materials && !t.cost ? "text-[16px] text-ink-2" : "text-[20px]")}>
        {costText(t.cost, plan.currency, t.unpriced_materials > 0)}
      </span>
      <span className={cn("tnum text-[14px] text-ink-2", compact && "min-w-0 truncate")}>
        {stock}{t.used_pct ? ` · ${used} used` : ""}{!compact && t.offcut_pct ? ` · ${offcuts} offcuts` : ""}{t.used_pct ? ` · ${waste} waste` : ""}
        {t.unpriced_lines ? <span className="text-warn"> · {t.unpriced_lines} unpriced</span> : null}
      </span>
      {plan.unplaced.length ? (
        <button type="button" onClick={onIssues} aria-label={`${plural(plan.unplaced.length, "part")} to fix`}
          className="inline-flex shrink-0 items-center gap-1.5 self-center rounded-full bg-kerf-soft px-2.5 py-0.5 text-[13px] font-semibold text-kerf">
          <AlertCircle size={14} />{compact ? plan.unplaced.length : `${plural(plan.unplaced.length, "part")} to fix`}
        </button>
      ) : null}
      {planFetching ? <Spinner className="h-3.5 w-3.5 self-center text-ink-3" /> : null}
    </div>
  );
}

/**
 * The cutting plan: what to buy per material, with board and sheet layouts.
 * `wide` is the full-width view; otherwise it fits the side panel or the phone drawer.
 */
export function PlanContent({ wide, onPick }: { wide?: boolean; onPick: (partId: string) => void }) {
  const { plan, planFetching } = useProjectCtx();
  if (!plan) return <div className="flex flex-col gap-4"><Skeleton className="h-48 rounded-[16px]" /><Skeleton className="h-72 rounded-[16px]" /></div>;
  const empty = !plan.lumber.length && !plan.sheets.length && !plan.hardware.length;
  const h2 = "text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3";

  return (
    <div className={cn("flex flex-col gap-5 transition-opacity duration-200", planFetching && "opacity-60")}>
      {plan.unplaced.length ? (
        <Callout tone="kerf" icon={<AlertCircle size={18} />} title={`${plural(plan.unplaced.length, "part")} can't be planned yet`}>
          <ul className="mt-1 flex flex-col gap-1">
            {plan.unplaced.map((u) => (
              <li key={u.part_id}>
                <button type="button" onClick={() => onPick(u.part_id)} className="text-start hover:underline">
                  <span className="font-semibold">{u.label}</span> {u.name !== u.label ? `${u.name}: ` : ""}{u.reason}
                </button>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {plan.warnings.length ? (
        <Callout tone="warn" icon={<Info size={18} />}>
          <ul className="flex flex-col gap-0.5">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Callout>
      ) : null}

      {empty && !plan.unplaced.length ? (
        <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
          <p className="text-[16px] font-semibold">Nothing to cut yet</p>
          <p className="max-w-[300px] text-[14px] text-ink-2">Add parts with a material and size. The cheapest way to cut them shows up here as you type.</p>
        </div>
      ) : null}

      {plan.lumber.length ? (
        <section className="flex flex-col gap-3">
          <h2 className={h2}>Lumber</h2>
          {plan.lumber.map((lp) => <LumberCard key={lp.item_id} lp={lp} currency={plan.currency} onPick={onPick} />)}
        </section>
      ) : null}

      {plan.sheets.length ? (
        <section className="flex flex-col gap-3">
          <h2 className={h2}>Sheets</h2>
          {plan.sheets.map((sp) => <SheetCard key={sp.item_id} sp={sp} currency={plan.currency} wide={wide} onPick={onPick} />)}
        </section>
      ) : null}

      {plan.hardware.length ? (
        <section className="flex flex-col gap-2">
          <h2 className={h2}>Hardware</h2>
          <div className="divide-y divide-line rounded-[14px] border border-line px-4">
            {plan.hardware.map((h) => (
              <div key={h.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span dir="auto" className="truncate text-[15px]">{h.name}</span>
                  <span className="text-[13px] text-ink-2">
                    {h.qty.toLocaleString()}{h.packs ? ` · ${plural(h.packs, "pack")} of ${h.pack_size}` : ""}
                    {h.assemblies.length ? ` · for ${h.assemblies.join(", ")}` : " · project extras"}
                  </span>
                </div>
                <span className="tnum shrink-0 text-[15px] font-semibold">{h.total == null ? <span className="font-normal text-ink-3">no price</span> : money(h.total, plan.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BuyLine({ lines, sheet }: { lines: LumberPlan["buy"]; sheet?: boolean }) {
  const groups = (["buy", "purchased", "inventory"] as const).map((src) => ({ src, items: lines.filter((b) => b.source === src) })).filter((g) => g.items.length);
  const verb = { buy: "Buy", purchased: "Bought", inventory: "From your inventory" } as const;
  return (
    <span className="tnum text-[14px] text-ink-2">
      {groups.map((g, gi) => (
        <span key={g.src}>
          {gi ? "  ·  " : ""}{verb[g.src]}{" "}
          {g.items.map((b, i) => (
            <span key={i} className="font-semibold text-ink">{i ? <span className="font-normal text-ink-3"> · </span> : null}{b.qty} × {sheet ? `${b.width_mm} × ${b.length_mm}` : fmtMeters(b.length_mm)}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

function MaterialCard({ id, name, buy, cost, priced, currency, meta, badge, sheet, split, children }: {
  id: string; name: string; buy: LumberPlan["buy"]; cost: number; priced: boolean; currency: string; meta: string; badge?: ReactNode; sheet?: boolean;
  split: { used_pct: number; offcut_pct: number; waste_pct: number }; children: ReactNode;
}) {
  return (
    <div id={materialCardId(id)} className="flex scroll-mt-4 flex-col gap-4 rounded-[16px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[16px] font-semibold">{name}</h3>
          <BuyLine lines={buy} sheet={sheet} />
        </div>
        <div className="ms-auto flex items-center gap-3">
          {badge}
          <div className="tnum flex flex-col items-end leading-tight">
            <span className={cn("text-[16px] font-semibold", !priced && !cost && "text-[14px] text-ink-3")}>{priced || cost ? money(cost, currency) : "No price"}</span>
            <span className="text-[12px] text-ink-3">{meta}</span>
          </div>
        </div>
      </div>
      {split.used_pct + split.offcut_pct + split.waste_pct > 0 ? <StockSplit used={split.used_pct} offcut={split.offcut_pct} waste={split.waste_pct} /> : null}
      {children}
    </div>
  );
}

function LumberCard({ lp, currency, onPick }: { lp: LumberPlan; currency: string; onPick: (partId: string) => void }) {
  const active = useActivePart();
  const badge = lp.optimal ? (
    <Tip content="Proven cheapest for these parts and stock lengths, with the least unusable waste.">
      <span><Badge tone="ok"><Check size={13} strokeWidth={2.6} />Optimal</Badge></span>
    </Tip>
  ) : <Tip content="Best plan found in the time allowed."><span><Badge>Best found</Badge></span></Tip>;
  return (
    <MaterialCard id={lp.item_id} name={lp.name} buy={lp.buy} cost={lp.cost} priced={lp.priced} currency={currency} meta={`saw ${lp.kerf} mm`} badge={badge} split={lp}>
      <LumberBars plan={lp} active={active} onPick={onPick} />
    </MaterialCard>
  );
}

function SheetCard({ sp, currency, wide, onPick }: { sp: SheetPlan; currency: string; wide?: boolean; onPick: (partId: string) => void }) {
  return (
    <MaterialCard id={sp.item_id} name={sp.name} buy={sp.buy} cost={sp.cost} priced={sp.priced} currency={currency} sheet
      meta={`saw ${sp.kerf} mm${sp.edge_trim ? ` · trim ${sp.edge_trim} mm` : ""}`} split={sp}>
      {sp.layouts.map((lay, i) => <SheetLayoutBlock key={i} index={i} total={sp.layouts.length} lay={lay} hasGrain={sp.has_grain} wide={wide} onPick={onPick} />)}
    </MaterialCard>
  );
}

function SheetLayoutBlock({ lay, index, total, hasGrain, wide, onPick }: {
  lay: SheetPlan["layouts"][number]; index: number; total: number; hasGrain: boolean; wide?: boolean; onPick: (partId: string) => void;
}) {
  const active = useActivePart();
  const [hl, setHl] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="flex flex-col gap-3">
      {total > 1 ? <p className="text-[13px] font-medium text-ink-2">Sheet {index + 1} of {total} · {pct(lay.used_pct)} used{lay.source !== "buy" ? " · from your inventory" : ""}</p> : null}
      <SheetDiagram layout={lay} hasGrain={hasGrain} highlight={hl} active={hl ? null : active} onPick={onPick} />
      {lay.cuts.length ? (
        <div className="flex flex-col gap-1">
          <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}
            className="-mx-1.5 inline-flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1 text-[13px] font-semibold hover:bg-surface-2">
            <ChevronDown size={15} className={cn("text-ink-3 transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
            Cut order <span className="font-normal text-ink-3">· {plural(lay.cuts.length, "cut")}, straight through</span>
          </button>
          {open ? (
            <ol id={listId} className={cn("grid gap-x-6", wide && "sm:grid-cols-2")}>
              {lay.cuts.map((c) => (
                <li key={c.n} onMouseEnter={() => setHl(c.n)} onMouseLeave={() => setHl(null)} onFocus={() => setHl(c.n)} onBlur={() => setHl(null)} tabIndex={0}
                  className={cn("flex cursor-default items-center gap-2.5 rounded-lg px-1.5 py-1 text-[14px]", hl === c.n && "bg-accent-soft")}>
                  <span className="tnum flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-surface">{c.n}</span>
                  {cutText(c)}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
