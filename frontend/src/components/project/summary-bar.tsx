"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useProjectCtx } from "@/components/project/context";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { money, pct, plural } from "@/lib/format";

export function SummaryBar() {
  const { plan, planFetching, id } = useProjectCtx();
  if (!plan) return <div className="flex h-9 items-center text-[14px] text-ink-3"><Spinner className="me-2 h-3.5 w-3.5" />Planning…</div>;
  const t = plan.totals;
  const stock = [t.boards ? plural(t.boards, "board") : "", t.sheets ? plural(t.sheets, "sheet") : ""].filter(Boolean).join(" + ") || "Nothing to buy";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] transition-opacity duration-200", planFetching && "opacity-60")}>
      <Stat label="Total" value={money(t.cost, plan.currency)} strong hint={t.unpriced_lines ? `${t.unpriced_lines} unpriced` : undefined} />
      <Stat label="To buy" value={stock} />
      <Stat label="Waste" value={pct(t.waste_pct)} />
      <Stat label="Parts" value={String(t.parts)} />
      {plan.unplaced.length ? (
        <Link href={`/projects/${id}/build`} className="inline-flex items-center gap-1.5 rounded-full bg-kerf-soft px-2.5 py-1 text-[13px] font-semibold text-kerf">
          <AlertCircle size={14} />{plural(plan.unplaced.length, "part")} to fix
        </Link>
      ) : null}
      {planFetching ? <Spinner className="h-3.5 w-3.5 text-ink-3" /> : null}
    </div>
  );
}

function Stat({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className={cn("tnum", strong ? "font-semibold text-ink" : "text-ink")}>{value}</span>
      {hint ? <span className="text-[12px] text-warn">{hint}</span> : null}
    </span>
  );
}
