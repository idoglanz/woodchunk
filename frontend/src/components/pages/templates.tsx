"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "use-intl";
import { Page } from "@/components/shell/app-shell";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, Ltr, PageTitle, Skeleton } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api/client";
import { qk, useCreateProject, useTemplates } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function TemplatesPage() {
  const tpls = useTemplates();
  const create = useCreateProject();
  const router = useRouter();
  const qc = useQueryClient();
  const tr = useTranslations("pages.templates");
  const other = tr("other");
  const categories = [...new Set((tpls.data ?? []).map((t) => t.category || other))];

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <PageTitle title={tr("title")} subtitle={tr.rich("subtitle", { m: (c) => <Ltr>{c}</Ltr> })} />
        {tpls.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 min-[2400px]:grid-cols-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-[16px]" />)}</div> : !tpls.data?.length ? (
          <Card><EmptyState title={tr("emptyTitle")} text={tr("emptyText")} /></Card>
        ) : categories.map((cat) => (
          <section key={cat} className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold capitalize text-ink-2"><bdi>{cat}</bdi></h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 min-[2400px]:grid-cols-5">
              {tpls.data.filter((t) => (t.category || other) === cat).map((t) => (
                <Card key={t.id} as="article" className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[17px] font-semibold"><bdi>{t.title}</bdi></h3>
                    {t.mine && !t.public ? <IconButton label={tr("delete")} size="sm" onClick={async () => {
                      try { await unwrap(api.DELETE("/api/templates/{template_id}", { params: { path: { template_id: t.id } } })); void qc.invalidateQueries({ queryKey: qk.templates }); }
                      catch (e) { toast.error(e instanceof Error ? e.message : tr("deleteError")); }
                    }}><Trash2 size={15} /></IconButton> : null}
                  </div>
                  <p className="text-[14px] text-ink-2"><bdi>{t.summary}</bdi></p>
                  <div className="flex flex-wrap gap-1.5">{t.assemblies.map((a) => <Badge key={a}><bdi>{a}</bdi></Badge>)}</div>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-[13px] text-ink-3">{tr("parts", { n: t.parts })}{t.mine ? ` · ${tr("yours")}` : ""}</span>
                    <Button size="sm" variant="primary" loading={create.isPending && create.variables?.template_id === t.id}
                      onClick={() => create.mutate({ template_id: t.id, name: t.title }, { onSuccess: (p) => router.push(`/projects/${p.id}/build`) })}>{tr("use")}</Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}
