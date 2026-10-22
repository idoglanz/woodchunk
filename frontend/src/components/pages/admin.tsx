"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageTitle, Skeleton } from "@/components/ui/misc";
import { api, unwrap, type ProjectSummary, type Schemas, type User } from "@/lib/api/client";
import { moneyShort, relativeTime } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function AdminPage() {
  const me = useMe();
  const admin = me.data?.role === "admin";
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ["admin", "stats"], enabled: admin, queryFn: () => unwrap<Schemas["Stats"]>(api.GET("/api/admin/stats")) });
  const users = useQuery({ queryKey: ["admin", "users"], enabled: admin, queryFn: () => unwrap<User[]>(api.GET("/api/admin/users")) });
  const archived = useQuery({ queryKey: ["admin", "archived"], enabled: admin, queryFn: () => unwrap<ProjectSummary[]>(api.GET("/api/admin/archived")) });

  if (me.data && !admin) return <Page><EmptyState title="Admins only" text="Ask an admin if you need access." /></Page>;
  const s = stats.data;

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <PageTitle title="Admin" />
        {!s ? <Skeleton className="h-28 rounded-[16px]" /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[["Users", s.users], ["Active this week", s.active_users_7d], ["Projects", s.projects], ["Templates", s.templates], ["Catalog items", s.catalog_items], ["AI calls today", s.ai_calls_today]].map(([k, v]) => (
              <Card key={k as string} className="flex flex-col gap-1 p-4"><span className="text-[12px] text-ink-3">{k}</span><span className="tnum text-[26px] font-semibold">{v}</span></Card>
            ))}
          </div>
        )}
        {s?.suggested_items ? <Card className="p-5 text-[15px]"><a href="/catalog" className="font-semibold text-info">{s.suggested_items} catalog suggestions</a> are waiting for review.</Card> : null}
        {s?.ai_usage.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[17px] font-semibold">AI usage (14 days)</h2>
            <Card className="divide-y divide-line">
              {s.ai_usage.map((u) => (
                <div key={`${u.day}-${u.model}`} className="tnum flex justify-between px-5 py-2.5 text-[14px]">
                  <span>{u.day}</span><span className="text-ink-2">{u.model}</span><span>{u.ok}/{u.calls} ok</span>
                </div>
              ))}
            </Card>
          </section>
        ) : null}
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold">People</h2>
          <Card className="divide-y divide-line">
            {users.data?.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-col"><span>{u.name || u.email}</span><span className="text-[13px] text-ink-2">{u.email} · seen {relativeTime(u.last_seen)}</span></div>
                <div className="flex items-center gap-2">
                  {u.role === "admin" ? <Badge tone="accent">Admin</Badge> : null}
                  {u.id !== me.data?.id ? (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      try { await unwrap(api.PUT("/api/admin/users/{user_id}/role", { params: { path: { user_id: u.id } }, body: { role: u.role === "admin" ? "user" : "admin" } })); void qc.invalidateQueries({ queryKey: ["admin", "users"] }); }
                      catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't change the role."); }
                    }}>{u.role === "admin" ? "Remove admin" : "Make admin"}</Button>
                  ) : null}
                </div>
              </div>
            ))}
          </Card>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold">Archived projects</h2>
          {!archived.data?.length ? <p className="text-[14px] text-ink-2">None.</p> : (
            <Card className="divide-y divide-line">
              {archived.data.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex flex-col"><span>{p.name}</span><span className="text-[13px] text-ink-2">{p.owner_name} · {relativeTime(p.updated_at)} · {moneyShort(p.total_cost)}</span></div>
                  <Button size="sm" variant="ghost" onClick={async () => { await unwrap(api.POST("/api/admin/projects/{project_id}/restore", { params: { path: { project_id: p.id } } })); void qc.invalidateQueries({ queryKey: ["admin", "archived"] }); toast.info("Restored"); }}>Restore</Button>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>
    </Page>
  );
}
