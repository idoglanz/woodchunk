"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Page } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { api, unwrap, type Project, type Schemas } from "@/lib/api/client";
import { toast } from "@/lib/toast";

export function JoinPage({ token }: { token: string }) {
  const inv = useQuery({ queryKey: ["invite", token], retry: false, queryFn: () => unwrap<Schemas["InviteOut"]>(api.GET("/api/invites/{token}", { params: { path: { token } } })) });
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const t = useTranslations("pages.join");
  if (inv.isError) return <Page><Card><EmptyState title={t("expired")} text={inv.error.message} /></Card></Page>;
  if (!inv.data) return <Page><Skeleton className="h-56 rounded-[16px]" /></Page>;
  return (
    <Page>
      <Card className="mx-auto flex max-w-[480px] flex-col items-center gap-4 p-8 text-center">
        <p className="text-[14px] text-ink-2">{t("invitedBy", { name: inv.data.invited_by })}</p>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">{inv.data.project_name}</h1>
        <p className="text-[15px] text-ink-2">{t("access", { role: inv.data.role })}</p>
        <Button variant="primary" loading={busy} onClick={async () => {
          setBusy(true);
          try { const p = await unwrap<Project>(api.POST("/api/invites/{token}/accept", { params: { path: { token } } })); router.replace(`/projects/${p.id}/build`); }
          catch (e) { toast.error(e instanceof Error ? e.message : t("error")); setBusy(false); }
        }}>{t("join")}</Button>
      </Card>
    </Page>
  );
}
