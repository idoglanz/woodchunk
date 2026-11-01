"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "use-intl";
import { useProjectCtx } from "@/components/project/context";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { costText, shares } from "@/lib/format";

export function SummaryBar() {
  const { plan, planFetching, id } = useProjectCtx();
  const m = useTranslations("plan");
  if (!plan) return <div className="flex h-9 items-center text-[14px] text-ink-3"><Spinner className="me-2 h-3.5 w-3.5" />{m("planning")}</div>;
  const t = plan.totals;
  const [used, offcuts, waste] = shares([t.used_pct, t.offcut_pct, t.waste_pct]);
  const stock = [t.boards ? m("boards", { n: t.boards }) : "", t.sheets ? m("sheets", { n: t.sheets }) : ""].filter(Boolean).join(" + ") || m("nothingToBuy");
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] transition-opacity duration-200", planFetching && "opacity-60")}>
      <Stat label={m("summary.total")} value={costText(t.cost, plan.currency, t.unpriced_materials > 0, m("noPrices"))} strong
        hint={t.unpriced_lines || (t.unpriced_materials && t.cost) ? m("summary.someUnpriced") : undefined} />
      <Stat label={m("summary.toBuy")} value={stock} />
      {t.used_pct ? <>
        <Stat label={m("summary.used")} value={used} />
        <Stat label={m("summary.offcuts")} value={offcuts} />
        <Stat label={m("summary.waste")} value={waste} />
      </> : null}
      <Stat label={m("summary.parts")} value={String(t.parts)} />
      {plan.unplaced.length ? (
        <Link href={`/projects/${id}/build`} className="inline-flex items-center gap-1.5 rounded-full bg-kerf-soft px-2.5 py-1 text-[13px] font-semibold text-kerf">
          <AlertCircle size={14} />{m("partsToFix", { n: plan.unplaced.length })}
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
