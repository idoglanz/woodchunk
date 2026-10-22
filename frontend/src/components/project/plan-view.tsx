"use client";

import { AlertCircle, Check, ChevronDown, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useProjectCtx } from "@/components/project/context";
import { CuttingSettingsButton } from "@/components/project/cutting-settings";
import { LumberBars } from "@/components/diagrams/lumber";
import { SheetDiagram, cutText } from "@/components/diagrams/sheet";
import { AsmChip, Badge, Callout, Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { Tip } from "@/components/ui/overlay";
import type { LumberPlan, SheetPlan } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";
import { money, pct, plural } from "@/lib/format";
import { fmtMeters } from "@/lib/units";

export function PlanView() {
  const { plan, planFetching, units, id } = useProjectCtx();
  const assemblies = useEditor((s) => s.content?.assemblies ?? []);
  if (!plan) return <div className="flex flex-col gap-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-56 rounded-[16px]" /><Skeleton className="h-80 rounded-[16px]" /></div>;
  const empty = !plan.lumber.length && !plan.sheets.length;

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity duration-200", planFetching && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {assemblies.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-2 text-[14px]">
              <AsmChip letter={a.letter} />{a.name}{a.qty > 1 ? <span className="tnum text-ink-2">×{a.qty}</span> : null}
            </span>
          ))}
        </div>
        <CuttingSettingsButton units={units} />
      </div>

      {plan.unplaced.length ? (
        <Callout tone="kerf" icon={<AlertCircle size={18} />} title={`${plural(plan.unplaced.length, "part")} can't be planned yet`}>
          <ul className="mt-1 flex flex-col gap-1">
            {plan.unplaced.map((u) => (
              <li key={u.part_id}><span className="font-semibold">{u.label}</span> {u.name !== u.label ? `${u.name}: ` : ""}{u.reason}</li>
            ))}
          </ul>
          <Link href={`/projects/${id}/design`} className="mt-2 inline-block text-[14px] font-semibold text-kerf">Fix in Design</Link>
        </Callout>
      ) : null}
      {plan.warnings.length ? (
        <Callout tone="warn" icon={<Info size={18} />}>
          <ul className="flex flex-col gap-0.5">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Callout>
      ) : null}

      {empty && !plan.unplaced.length ? (
        <Card><EmptyState title="Nothing to cut yet" text="Add parts in Design and the cutting plan appears here." action={<Link href={`/projects/${id}/design`} className="font-semibold text-info">Go to Design</Link>} /></Card>
      ) : null}

      {plan.lumber.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Lumber</h2>
          {plan.lumber.map((lp) => <LumberCard key={lp.item_id} lp={lp} currency={plan.currency} />)}
        </section>
      ) : null}

      {plan.sheets.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Sheets</h2>
          {plan.sheets.map((sp) => <SheetCard key={sp.item_id} sp={sp} currency={plan.currency} />)}
        </section>
      ) : null}

      {plan.hardware.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Hardware</h2>
          <Card className="divide-y divide-line px-5">
            {plan.hardware.map((h) => (
              <div key={h.key} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <span dir="auto" className="truncate">{h.name}</span>
                  <span className="text-[13px] text-ink-2">{h.assemblies.length ? `for ${h.assemblies.join(", ")}` : "project extras"}</span>
                </div>
                <div className="tnum flex items-baseline gap-4 text-end">
                  <span className="text-[15px]">{h.qty.toLocaleString()}{h.packs ? <span className="text-ink-2"> · {plural(h.packs, "pack")} of {h.pack_size}</span> : null}</span>
                  <span className="w-24 font-semibold">{h.total == null ? <span className="font-normal text-ink-3">no price</span> : money(h.total, plan.currency)}</span>
                </div>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function BuyLine({ lines, sheet }: { lines: LumberPlan["buy"]; sheet?: boolean }) {
  const groups = (["buy", "purchased", "inventory"] as const).map((src) => ({ src, items: lines.filter((b) => b.source === src) })).filter((g) => g.items.length);
  const verb = { buy: "Buy", purchased: "Bought", inventory: "From your workshop" } as const;
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

function LumberCard({ lp, currency }: { lp: LumberPlan; currency: string }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[17px] font-semibold">{lp.name}</h3>
          <BuyLine lines={lp.buy} />
        </div>
        <div className="flex items-center gap-3">
          {lp.optimal ? (
            <Tip content="Proven cheapest for these parts and stock lengths, with the least unusable waste.">
              <span><Badge tone="ok"><Check size={13} strokeWidth={2.6} />Optimal</Badge></span>
            </Tip>
          ) : <Tip content="Best plan found in the time allowed."><span><Badge>Best found</Badge></span></Tip>}
          <div className="tnum flex flex-col items-end leading-tight">
            <span className="text-[17px] font-semibold">{money(lp.cost, currency)}</span>
            <span className="text-[12px] text-ink-3">{pct(lp.waste_pct)} waste · saw {lp.kerf} mm</span>
          </div>
        </div>
      </div>
      <LumberBars plan={lp} />
    </Card>
  );
}

function SheetCard({ sp, currency }: { sp: SheetPlan; currency: string }) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[17px] font-semibold">{sp.name}</h3>
          <BuyLine lines={sp.buy} sheet />
        </div>
        <div className="tnum flex flex-col items-end leading-tight">
          <span className="text-[17px] font-semibold">{money(sp.cost, currency)}</span>
          <span className="text-[12px] text-ink-3">{pct(sp.waste_pct)} waste · saw {sp.kerf} mm{sp.edge_trim ? ` · trim ${sp.edge_trim} mm` : ""}</span>
        </div>
      </div>
      {sp.layouts.map((lay, i) => <SheetLayoutBlock key={i} index={i} total={sp.layouts.length} lay={lay} hasGrain={sp.has_grain} />)}
    </Card>
  );
}

function SheetLayoutBlock({ lay, index, total, hasGrain }: { lay: SheetPlan["layouts"][number]; index: number; total: number; hasGrain: boolean }) {
  const [hl, setHl] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const shown = open ? lay.cuts : lay.cuts.slice(0, 6);
  return (
    <div className="flex flex-col gap-3">
      {total > 1 ? <p className="text-[13px] font-medium text-ink-2">Sheet {index + 1} of {total} · {pct(lay.used_pct)} used{lay.source !== "buy" ? " · from your workshop" : ""}</p> : null}
      <SheetDiagram layout={lay} hasGrain={hasGrain} highlight={hl} />
      {lay.cuts.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold">Cut order <span className="font-normal text-ink-3">· {plural(lay.cuts.length, "cut")}, straight through</span></p>
          <ol className="grid gap-x-6 sm:grid-cols-2">
            {shown.map((c) => (
              <li key={c.n} onMouseEnter={() => setHl(c.n)} onMouseLeave={() => setHl(null)} onFocus={() => setHl(c.n)} onBlur={() => setHl(null)} tabIndex={0}
                className={cn("flex cursor-default items-center gap-2.5 rounded-lg px-1.5 py-1 text-[14px]", hl === c.n && "bg-accent-soft")}>
                <span className="tnum flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-surface">{c.n}</span>
                {cutText(c)}
              </li>
            ))}
          </ol>
          {lay.cuts.length > 6 ? (
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 self-start px-1.5 py-1 text-[14px] font-medium text-info">
              {open ? "Show fewer" : `Show all ${lay.cuts.length}`}<ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
