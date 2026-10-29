"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart } from "@/components/admin/bar-chart";
import { bucketSize, CHART_COLORS, Stat } from "@/components/admin/overview";
import { LevelBadge } from "@/components/admin/people";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/overlay";
import { AI_FEATURES, bucket, minutes } from "@/lib/admin";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { plural, relativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

type Detail = Schemas["PersonDetail"];

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One person's usage over time. Counts only: nothing here says what they're building. */
export function PersonSheet({ userId, days, meId, onClose }: { userId: string | null; days: number; meId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "user", userId, days], enabled: !!userId,
    queryFn: () => unwrap<Detail>(api.GET("/api/admin/users/{user_id}", { params: { path: { user_id: userId! }, query: { days } } })),
  });
  const d = q.data?.person.id === userId ? q.data : undefined;
  const p = d?.person;
  const size = bucketSize(days);
  const per = size === 1 ? "each day" : "each week";

  const setRole = async () => {
    if (!p) return;
    try {
      await unwrap(api.PUT("/api/admin/users/{user_id}/role", { params: { path: { user_id: p.id } }, body: { role: p.role === "admin" ? "user" : "admin" } }));
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't change the role."); }
  };
  const restore = async (id: string) => {
    try {
      await unwrap(api.POST("/api/admin/projects/{project_id}/restore", { params: { path: { project_id: id } } }));
      void qc.invalidateQueries({ queryKey: ["admin"] });
      toast.info("Restored. It's back in their projects.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't restore the project."); }
  };

  return (
    <Sheet open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }} wide
      title={p ? p.name || p.email : "Person"} description={p ? (p.name ? p.email : "No name set") : undefined}
      footer={p && p.id !== meId ? (
        <Button size="sm" variant={p.role === "admin" ? "destructive" : "secondary"} onClick={setRole}>
          {p.role === "admin" ? "Remove admin" : "Make admin"}
        </Button>
      ) : undefined}>
      {!d || !p ? <div className="flex flex-col gap-3"><Skeleton className="h-20" /><Skeleton className="h-48" /></div> : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
            <LevelBadge p={p} />
            <span>Signed up {date(p.created_at)}</span>
            <span>Last seen {relativeTime(p.last_seen)}</span>
            <span className="capitalize">{p.role}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Projects" value={p.projects} sub={p.shared ? `+${p.shared} shared with them` : "none shared with them"} />
            <Stat label="Active days" value={p.active_days_30d} sub={`in 30 d · ${p.active_days_7d} in 7 d`} />
            <Stat label="Time in app" value={minutes(p.active_minutes_30d)} sub="about, in 30 d" />
            <Stat label="AI calls" value={p.ai_calls_30d} sub={`in 30 d · ${p.ai_calls_7d} in 7 d`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <BarChart title="Time in app" note={`About how long they were active ${per}, in 5-minute steps.`} unit=" min"
              series={[{ name: "Active", color: CHART_COLORS[0] }]} points={bucket(d.days, size, (x) => [x.active_minutes])} />
            <BarChart title="AI calls" note={`Requests ${per}.`}
              series={[{ name: "Succeeded", color: CHART_COLORS[0] }, { name: "Failed", color: "var(--kerf)" }]}
              points={bucket(d.days, size, (x) => [x.ai_ok, x.ai_calls - x.ai_ok])} />
            <BarChart title="Projects created" note={`New projects ${per}, including copies.`}
              series={[{ name: "Projects", color: CHART_COLORS[0] }]} points={bucket(d.days, size, (x) => [x.projects_created])} />
            <section className="flex flex-col gap-2 rounded-[16px] bg-surface-2/60 p-5">
              <h3 className="text-[17px] font-semibold">AI features used</h3>
              {!d.ai_features.length ? <p className="text-[14px] text-ink-2">None in this range.</p> : (
                <ul className="flex flex-col gap-1.5 text-[14px]">
                  {d.ai_features.map((f) => (
                    <li key={f.feature} className="tnum flex justify-between gap-3">
                      <span>{AI_FEATURES[f.feature] ?? f.feature}</span><span className="text-ink-2">{plural(f.calls, "call")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="flex flex-col gap-2">
            <h3 className="text-[17px] font-semibold">Archived projects</h3>
            <p className="text-[13px] text-ink-2">Shown by size and dates only. Restore one if they ask for it back.</p>
            {!d.archived.length ? <p className="text-[14px] text-ink-2">None.</p> : (
              <ul className="divide-y divide-line rounded-[12px] bg-surface-2/60">
                {d.archived.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="flex min-w-0 flex-col text-[14px]">
                      <span className="tnum">{plural(a.assemblies, "assembly", "assemblies")} · {plural(a.parts, "part")}</span>
                      <span className="text-[12px] text-ink-2">Created {date(a.created_at)} · last changed {relativeTime(a.updated_at)}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => restore(a.id)}>Restore</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
