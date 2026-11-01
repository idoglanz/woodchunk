"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "use-intl";
import { BarChart } from "@/components/admin/bar-chart";
import { bucketSize, CHART_COLORS, Stat } from "@/components/admin/overview";
import { LevelBadge } from "@/components/admin/people";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/overlay";
import { aiFeature, bucket, minutes } from "@/lib/admin";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { useRelativeTime } from "@/lib/format";
import { dateLocale } from "@/lib/lang";
import { toast } from "@/lib/toast";

type Detail = Schemas["PersonDetail"];

function date(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** One person's usage over time. Counts only: nothing here says what they're building. */
export function PersonSheet({ userId, days, meId, onClose }: { userId: string | null; days: number; meId?: string; onClose: () => void }) {
  const ago = useRelativeTime();
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = dateLocale(useLocale());
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "user", userId, days], enabled: !!userId,
    queryFn: () => unwrap<Detail>(api.GET("/api/admin/users/{user_id}", { params: { path: { user_id: userId! }, query: { days } } })),
  });
  const d = q.data?.person.id === userId ? q.data : undefined;
  const p = d?.person;
  const size = bucketSize(days);
  const per = size === 1 ? "day" : "week";

  const setRole = async () => {
    if (!p) return;
    try {
      await unwrap(api.PUT("/api/admin/users/{user_id}/role", { params: { path: { user_id: p.id } }, body: { role: p.role === "admin" ? "user" : "admin" } }));
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : t("roleError")); }
  };
  const restore = async (id: string) => {
    try {
      await unwrap(api.POST("/api/admin/projects/{project_id}/restore", { params: { path: { project_id: id } } }));
      void qc.invalidateQueries({ queryKey: ["admin"] });
      toast.info(t("restored"));
    } catch (e) { toast.error(e instanceof Error ? e.message : t("restoreError")); }
  };

  return (
    <Sheet open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }} wide
      title={p ? p.name || p.email : t("person")} description={p ? (p.name ? p.email : t("noName")) : undefined}
      footer={p && p.id !== meId ? (
        <Button size="sm" variant={p.role === "admin" ? "destructive" : "secondary"} onClick={setRole}>
          {p.role === "admin" ? t("removeAdmin") : t("makeAdmin")}
        </Button>
      ) : undefined}>
      {!d || !p ? <div className="flex flex-col gap-3"><Skeleton className="h-20" /><Skeleton className="h-48" /></div> : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
            <LevelBadge p={p} />
            <span>{t("signedUpOn", { date: date(p.created_at, locale) })}</span>
            <span>{t("lastSeenAgo", { ago: ago(p.last_seen) })}</span>
            <span className="capitalize">{t(`role.${p.role}`)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("projects")} value={p.projects} sub={p.shared ? t("sharedWithThem", { n: p.shared }) : t("noneShared")} />
            <Stat label={t("activeDays")} value={p.active_days_30d} sub={t("in30", { n: p.active_days_7d })} />
            <Stat label={t("timeInApp")} value={minutes(p.active_minutes_30d, t)} sub={t("aboutIn30")} />
            <Stat label={t("aiCalls")} value={p.ai_calls_30d} sub={t("in30", { n: p.ai_calls_7d })} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <BarChart title={t("timeInApp")} note={t("timeNote", { per })} unit={t("minUnit")}
              series={[{ name: t("activeSeries"), color: CHART_COLORS[0] }]} points={bucket(d.days, size, (x) => [x.active_minutes])} />
            <BarChart title={t("aiCalls")} note={t("aiNote", { per })}
              series={[{ name: t("succeeded"), color: CHART_COLORS[0] }, { name: t("failed"), color: "var(--kerf)" }]}
              points={bucket(d.days, size, (x) => [x.ai_ok, x.ai_calls - x.ai_ok])} />
            <BarChart title={t("projectsCreated")} note={t("projectsNote", { per })}
              series={[{ name: t("projects"), color: CHART_COLORS[0] }]} points={bucket(d.days, size, (x) => [x.projects_created])} />
            <section className="flex flex-col gap-2 rounded-[16px] bg-surface-2/60 p-5">
              <h3 className="text-[17px] font-semibold">{t("aiFeaturesUsed")}</h3>
              {!d.ai_features.length ? <p className="text-[14px] text-ink-2">{t("noneInRange")}</p> : (
                <ul className="flex flex-col gap-1.5 text-[14px]">
                  {d.ai_features.map((f) => (
                    <li key={f.feature} className="tnum flex justify-between gap-3">
                      <span>{aiFeature(t, f.feature)}</span><span className="text-ink-2">{t("callsCount", { n: f.calls })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="flex flex-col gap-2">
            <h3 className="text-[17px] font-semibold">{t("archivedProjects")}</h3>
            <p className="text-[13px] text-ink-2">{t("archivedNote")}</p>
            {!d.archived.length ? <p className="text-[14px] text-ink-2">{t("none")}</p> : (
              <ul className="divide-y divide-line rounded-[12px] bg-surface-2/60">
                {d.archived.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="flex min-w-0 flex-col text-[14px]">
                      <span className="tnum">{t("assembliesCount", { n: a.assemblies })} · {t("partsCount", { n: a.parts })}</span>
                      <span className="text-[12px] text-ink-2">{t("createdChanged", { date: date(a.created_at, locale), ago: ago(a.updated_at) })}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => restore(a.id)}>{tc("restore")}</Button>
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
