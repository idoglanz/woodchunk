"use client";

import { Archive, ArchiveRestore, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NewProjectSheet } from "@/components/home/new-project";
import { Page } from "@/components/shell/app-shell";
import { Button, IconButton } from "@/components/ui/button";
import { Card, EmptyState, PageTitle, Skeleton, StatusPill } from "@/components/ui/misc";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import type { ProjectSummary } from "@/lib/api/client";
import { moneyShort, plural, relativeTime } from "@/lib/format";
import { useProjectAction, useProjects } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function ProjectsHome() {
  const [view, setView] = useState<"active" | "archived">("active");
  const [creating, setCreating] = useState(false);
  const projects = useProjects(view === "archived");
  const list = projects.data ?? [];

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <PageTitle
          title="Projects"
          subtitle={projects.data ? (view === "active" ? plural(list.length, "project") : plural(list.length, "archived project")) : " "}
          actions={<>
            <Segmented label="Show" value={view} onChange={setView} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
            <Button variant="primary" icon={<Plus size={17} strokeWidth={2.4} />} onClick={() => setCreating(true)}>New project</Button>
          </>}
        />
        {projects.isError && !projects.data ? (
          <Card><EmptyState title="Couldn't load your projects" text="Check your connection and try again."
            action={<Button onClick={() => void projects.refetch()}>Try again</Button>} /></Card>
        ) : projects.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 min-[2400px]:grid-cols-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[168px] rounded-[16px]" />)}</div>
        ) : list.length === 0 ? (
          view === "active" ? (
            <Card><EmptyState title="Plan your first build"
              text="Describe what you're building, or start from a template. Woodchunk works out what to buy and how to cut every board."
              action={<Button variant="primary" icon={<Plus size={17} strokeWidth={2.4} />} onClick={() => setCreating(true)}>New project</Button>} /></Card>
          ) : (
            <Card><EmptyState title="Nothing archived" text="Projects you archive land here. You can restore them any time." /></Card>
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
  const router = useRouter();
  const act = useProjectAction();
  const owner = p.role === "owner";
  return (
    <Card as="article" className="group relative flex flex-col gap-4 p-5 transition-shadow duration-200 hover:shadow-[var(--shadow-pop)]">
      <Link href={`/projects/${p.id}/build`} className="absolute inset-0 rounded-[16px]" aria-label={`Open ${p.name}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-[17px] font-semibold">{p.name}</h2>
          <p className="truncate text-[13px] text-ink-2">{p.description || plural(p.assemblies, "assembly", "assemblies")}</p>
        </div>
        <div className="relative z-10 -me-2 -mt-1">
          <Menu trigger={<IconButton label="Project options" size="sm"><MoreHorizontal size={18} /></IconButton>}>
            <MenuItem icon={<Copy size={15} />} onSelect={() => act.duplicate.mutate(p.id, { onSuccess: (np) => router.push(`/projects/${np!.id}/build`) })}>Duplicate</MenuItem>
            {owner && !p.archived ? <MenuItem icon={<Archive size={15} />} onSelect={() => act.archive.mutate({ id: p.id, archived: true }, {
              onSuccess: () => toast.info(`Archived ${p.name}`, { label: "Undo", run: () => act.archive.mutate({ id: p.id, archived: false }) }),
            })}>Archive</MenuItem> : null}
            {owner && p.archived ? <>
              <MenuItem icon={<ArchiveRestore size={15} />} onSelect={() => act.archive.mutate({ id: p.id, archived: false })}>Restore</MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => act.remove.mutate(p.id, { onSuccess: () => toast.info(`Deleted ${p.name}`) })}>Delete forever</MenuItem>
            </> : null}
          </Menu>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <StatusPill status={p.status} />
          <span className="text-[12px] text-ink-3">{plural(p.parts, "part")} · {relativeTime(p.updated_at)}{p.role !== "owner" ? ` · shared by ${p.owner_name}` : ""}</span>
        </div>
        <span className="tnum text-[22px] font-semibold tracking-[-0.01em]">{p.total_cost ? moneyShort(p.total_cost) : ""}</span>
      </div>
    </Card>
  );
}
