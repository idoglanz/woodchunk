"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Page } from "@/components/shell/app-shell";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageTitle, Skeleton } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api/client";
import { plural } from "@/lib/format";
import { qk, useCreateProject, useTemplates } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function TemplatesPage() {
  const tpls = useTemplates();
  const create = useCreateProject();
  const router = useRouter();
  const qc = useQueryClient();
  const categories = [...new Set((tpls.data ?? []).map((t) => t.category || "other"))];

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <PageTitle title="Templates" subtitle="Start from a proven build and change the sizes. Ask Woodchunk to adapt it, e.g. “make it 150 cm wide”." />
        {tpls.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-[16px]" />)}</div> : !tpls.data?.length ? (
          <Card><EmptyState title="No templates yet" text="Save any project as a template from its Design tab." /></Card>
        ) : categories.map((cat) => (
          <section key={cat} className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold capitalize text-ink-2">{cat}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tpls.data.filter((t) => (t.category || "other") === cat).map((t) => (
                <Card key={t.id} as="article" className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[17px] font-semibold">{t.title}</h3>
                    {t.mine && !t.public ? <IconButton label="Delete template" size="sm" onClick={async () => {
                      try { await unwrap(api.DELETE("/api/templates/{template_id}", { params: { path: { template_id: t.id } } })); void qc.invalidateQueries({ queryKey: qk.templates }); }
                      catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete."); }
                    }}><Trash2 size={15} /></IconButton> : null}
                  </div>
                  <p className="text-[14px] text-ink-2">{t.summary}</p>
                  <div className="flex flex-wrap gap-1.5">{t.assemblies.map((a) => <Badge key={a}>{a}</Badge>)}</div>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-[13px] text-ink-3">{plural(t.parts, "part")}{t.mine ? " · yours" : ""}</span>
                    <Button size="sm" variant="primary" loading={create.isPending && create.variables?.template_id === t.id}
                      onClick={() => create.mutate({ template_id: t.id, name: t.title }, { onSuccess: (p) => router.push(`/projects/${p.id}/design`) })}>Use template</Button>
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
