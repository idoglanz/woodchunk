"use client";

import type { ReactNode } from "react";
import { BarChart, type Series } from "@/components/admin/bar-chart";
import { Card } from "@/components/ui/misc";
import { bucket, percent, shortDay } from "@/lib/admin";
import type { Schemas } from "@/lib/api/client";

type Overview = Schemas["Overview"];

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-0.5 p-4">
      <span className="text-[12px] font-medium tracking-[0.01em] text-ink-2">{label}</span>
      <span className="tnum text-[28px] font-semibold leading-8 tracking-[-0.01em]">{value}</span>
      {sub ? <span className="tnum truncate text-[12px] text-ink-3">{sub}</span> : null}
    </Card>
  );
}

/** Daily bars up to a month; weekly beyond that, so bars stay readable on a phone. */
export function bucketSize(days: number): number {
  return days > 31 ? 7 : 1;
}

export function OverviewView({ o }: { o: Overview }) {
  const size = bucketSize(o.days.length);
  const per = size === 1 ? "a day" : "a week";
  const sum = (k: keyof Overview["days"][number]) => o.days.reduce((a, d) => a + (d[k] as number), 0);
  // Up to four models get their own colour, in the order of use; the rest fold into "Other".
  const top = o.ai_models.slice(0, o.ai_models.length > 4 ? 3 : 4).map((m) => m.model);
  const aiSeries: Series[] = [...top, ...(o.ai_models.length > top.length ? ["Other"] : [])]
    .map((name, i) => ({ name, color: CHART_COLORS[i] }));
  const aiPoints = bucket(o.days, size, (d) => {
    const v = aiSeries.map(() => 0);
    for (const u of o.ai_by_day) {
      if (u.day !== d.day) continue;
      const i = top.indexOf(u.model);
      v[i < 0 ? aiSeries.length - 1 : i] += u.calls;
    }
    return v;
  });
  const aiCalls = sum("ai_calls"), aiOk = sum("ai_ok");
  const trackedLate = o.tracking_since && o.tracking_since > o.days[0].day;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="People" value={o.users.toLocaleString("en-US")} sub={`+${o.new_7d} this week`} />
        <Stat label="Active, last 24 h" value={o.active_1d} sub={`${percent(o.active_1d, o.users)} of everyone`} />
        <Stat label="Active this week" value={o.active_7d} sub={`${percent(o.active_7d, o.users)} of everyone`} />
        <Stat label="Active this month" value={o.active_30d} sub={`${percent(o.active_30d, o.users)} of everyone`} />
        <Stat label="Projects" value={o.projects.toLocaleString("en-US")} sub={`${o.templates} templates`} />
        <Stat label="AI calls today" value={o.ai_calls_today} sub={`${percent(aiOk, aiCalls)} ok in ${o.days.length} d`} />
      </div>
      {o.suggested_items ? (
        <Card className="p-5 text-[15px]"><a href="/catalog" className="font-semibold text-info">{o.suggested_items} catalog suggestions</a> are waiting for review.</Card>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <BarChart title="Active people"
          note={trackedLate ? `People who used the app, ${size === 1 ? "each day" : "average per day"}. Tracked since ${shortDay(o.tracking_since!)}.` : `People who used the app, ${size === 1 ? "each day" : "average per day"}.`}
          series={[{ name: "Active people", color: CHART_COLORS[0] }]}
          points={bucket(o.days, size, (d) => [d.active_users], "avg")} empty="No activity tracked in this range yet." />
        <BarChart title="Signups" headline={`+${sum("signups")}`} note={`New accounts ${per}.`}
          series={[{ name: "Signups", color: CHART_COLORS[0] }]} points={bucket(o.days, size, (d) => [d.signups])} />
        <BarChart title="Projects created" headline={`+${sum("projects_created")}`} note={`New projects ${per}, including copies. Deleted ones aren't counted.`}
          series={[{ name: "Projects", color: CHART_COLORS[0] }]} points={bucket(o.days, size, (d) => [d.projects_created])} />
        <BarChart title="AI calls" headline={aiCalls.toLocaleString("en-US")}
          note={`Model requests ${per}, fallbacks included. ${percent(aiOk, aiCalls)} succeeded.`}
          series={aiSeries} points={aiPoints}
          legend={o.ai_models.length ? (
            <table className="w-full text-[13px]">
              <thead className="sr-only"><tr><th>Model</th><th>Calls</th><th>Succeeded</th></tr></thead>
              <tbody>
                {o.ai_models.map((m) => {
                  const i = top.indexOf(m.model);
                  const color = CHART_COLORS[i < 0 ? aiSeries.length - 1 : i];
                  return (
                    <tr key={m.model} className="tnum">
                      <td className="py-0.5 text-ink-2"><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: color }} />{m.model}{i < 0 ? <span className="text-ink-3"> · other</span> : null}</td>
                      <td className="text-end">{m.calls.toLocaleString("en-US")}</td>
                      <td className="w-24 text-end text-ink-2">{percent(m.ok, m.calls)} ok</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <span />} />
      </div>
    </div>
  );
}
