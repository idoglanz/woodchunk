"use client";

import { Archive, ArchiveRestore, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { NewProjectSheet } from "@/components/home/new-project";
import { Page } from "@/components/shell/app-shell";
import { Avatars } from "@/components/ui/avatars";
import { Button, IconButton } from "@/components/ui/button";
import { Card, EmptyState, PageTitle, Skeleton, StatusPill } from "@/components/ui/misc";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import type { ProjectSummary } from "@/lib/api/client";
import { moneyShort, useRelativeTime } from "@/lib/format";
import { useMe, useProjectAction, useProjects } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function ProjectsHome() {
  const [view, setView] = useState<"active" | "archived">("active");
  const [creating, setCreating] = useState(false);
  const projects = useProjects(view === "archived");
  const list = projects.data ?? [];
  const t = useTranslations("home");
  const tc = useTranslations("common");

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <PageTitle
          title={t("title")}
          subtitle={projects.data ? (view === "active" ? t("count", { n: list.length }) : t("archivedCount", { n: list.length })) : " "}
          actions={<>
            <Segmented label={t("show")} value={view} onChange={setView} options={[{ value: "active", label: t("active") }, { value: "archived", label: t("archived") }]} />
            <Button variant="primary" icon={<Plus size={17} strokeWidth={2.4} />} onClick={() => setCreating(true)}>{t("newProject")}</Button>
          </>}
        />
        {projects.isError && !projects.data ? (
          <Card><EmptyState title={t("loadError")} text={t("loadErrorText")}
            action={<Button onClick={() => void projects.refetch()}>{tc("tryAgain")}</Button>} /></Card>
        ) : projects.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 min-[2400px]:grid-cols-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[168px] rounded-[16px]" />)}</div>
        ) : list.length === 0 ? (
          view === "active" ? (
            <Card><EmptyState title={t("emptyTitle")}
              text={t("emptyText")}
              action={<Button variant="primary" icon={<Plus size={17} strokeWidth={2.4} />} onClick={() => setCreating(true)}>{t("newProject")}</Button>} /></Card>
          ) : (
            <Card><EmptyState title={t("archivedEmptyTitle")} text={t("archivedEmptyText")} /></Card>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 min-[2400px]:grid-cols-5">
            {list.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
      <NewProjectSheet open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const ago = useRelativeTime();
  const router = useRouter();
  const act = useProjectAction();
  const owner = p.role === "owner";
  const me = useMe();
  const others = p.people.filter((x) => x.user_id !== me.data?.id);
  const t = useTranslations("home");
  const tc = useTranslations("common");
  return (
    <Card as="article" className="group relative flex flex-col gap-4 p-5 transition-shadow duration-200 hover:shadow-[var(--shadow-pop)]">
      <Link href={`/projects/${p.id}/build`} className="absolute inset-0 rounded-[16px]" aria-label={t("open", { name: p.name })} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-[17px] font-semibold"><bdi>{p.name}</bdi></h2>
          <p className="truncate text-[13px] text-ink-2">{p.description || t("assemblies", { n: p.assemblies })}</p>
        </div>
        <div className="relative z-10 -me-2 -mt-1">
          <Menu trigger={<IconButton label={t("options")} size="sm"><MoreHorizontal size={18} /></IconButton>}>
            <MenuItem icon={<Copy size={15} />} onSelect={() => act.duplicate.mutate(p.id, { onSuccess: (np) => router.push(`/projects/${np!.id}/build`) })}>{t("duplicate")}</MenuItem>
            {owner && !p.archived ? <MenuItem icon={<Archive size={15} />} onSelect={() => act.archive.mutate({ id: p.id, archived: true }, {
              onSuccess: () => toast.info(t("archivedToast", { name: p.name }), { label: tc("undo"), run: () => act.archive.mutate({ id: p.id, archived: false }) }),
            })}>{t("archive")}</MenuItem> : null}
            {owner && p.archived ? <>
              <MenuItem icon={<ArchiveRestore size={15} />} onSelect={() => act.archive.mutate({ id: p.id, archived: false })}>{tc("restore")}</MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => act.remove.mutate(p.id, { onSuccess: () => toast.info(t("deletedToast", { name: p.name })) })}>{t("deleteForever")}</MenuItem>
            </> : null}
          </Menu>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <StatusPill status={p.status} />
            <Avatars people={others} size={22} ring="var(--surface)" />
          </div>
          <span className="text-[12px] text-ink-3">{t("parts", { n: p.parts })} · {ago(p.updated_at)}{p.role !== "owner" ? ` · ${t("sharedBy", { name: p.owner_name })}` : ""}</span>
        </div>
        <span className="tnum text-[22px] font-semibold tracking-[-0.01em]">{p.total_cost ? moneyShort(p.total_cost) : ""}</span>
      </div>
    </Card>
  );
}
