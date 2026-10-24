"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CloudOff, Redo2, Share, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AIPanel } from "@/components/project/ai-panel";
import { ProjectContext } from "@/components/project/context";
import { MoreMenu, TemplateSheet } from "@/components/project/more-menu";
import { ShareSheet } from "@/components/project/share";
import { StatusMenu } from "@/components/project/status-menu";
import { SummaryBar } from "@/components/project/summary-bar";
import { Button, IconButton, Spinner } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { setOnSaved, useEditor } from "@/lib/editor";
import { useMediaQuery } from "@/lib/focus";
import { qk, useMe, usePlan, useProject } from "@/lib/queries";
import type { Units } from "@/lib/units";

const TABS = [
  { value: "build", label: "Build" },
  { value: "buy", label: "Buy" },
  { value: "sheet", label: "Shop sheet" },
] as const;

export function ProjectWorkspace({ id, children }: { id: string; children: ReactNode }) {
  const project = useProject(id);
  const me = useMe();
  const qc = useQueryClient();
  const pathname = usePathname();
  const tab = (TABS.find((t) => pathname.endsWith(`/${t.value}`))?.value ?? "build") as (typeof TABS)[number]["value"];
  const ed = useEditor();
  const search = useSearchParams();
  const [aiOpen, setAIOpen] = useState(() => search.has("ask"));
  const [sharing, setSharing] = useState(false);
  const [templating, setTemplating] = useState(false);
  const loadedFor = useRef<string | null>(null);
  // On the Build tab the desktop side panel hosts the assistant instead of a separate sidebar.
  const desktop = useMediaQuery("(min-width: 1024px)");
  const aiInPanel = tab === "build" && desktop;

  const role = project.data?.members.find((m) => m.user_id === me.data?.id)?.role;
  const readOnly = !project.data || project.data.status === "done" || (role === "viewer" && me.data?.role !== "admin");

  useEffect(() => {
    if (project.data && me.data && loadedFor.current !== project.data.id) {
      loadedFor.current = project.data.id;
      useEditor.getState().load(project.data, readOnly);
    }
  }, [project.data, me.data, readOnly]);

  useEffect(() => {
    useEditor.setState({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    setOnSaved((p) => qc.setQueryData(qk.project(p.id), p));
    return () => { void useEditor.getState().flush(); };
  }, [qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ready = ed.project?.id === id && !!ed.content;
  const title = ed.content?.name;
  useEffect(() => {
    if (title) document.title = `${title} · Woodchunk`;
  }, [title]);
  const plan = usePlan(id, ed.version, "en", ready);
  const ctx = useMemo(() => ({
    id, units: (me.data?.prefs.units ?? "mm") as Units, readOnly, me: me.data, plan: plan.data,
    planFetching: plan.isFetching, aiOpen, openAI: () => setAIOpen(true), closeAI: () => setAIOpen(false),
  }), [id, me.data, readOnly, plan.data, plan.isFetching, aiOpen]);

  if (project.isError) {
    return <EmptyState title="Project not found" text="It may have been deleted, or you don't have access to it." action={<Link href="/" className="font-semibold text-info">Back to projects</Link>} />;
  }

  return (
    <ProjectContext.Provider value={ctx}>
      <div className="flex min-h-[calc(100dvh-52px)]">
        <div className="min-w-0 flex-1">
          <div className={cn("mx-auto w-full ps-[max(16px,env(safe-area-inset-left))] pe-[max(16px,env(safe-area-inset-right))] pb-28 pt-5 sm:ps-6 sm:pe-6",
            tab === "build" ? "max-w-[1280px]" : tab === "sheet" ? "max-w-[960px]" : "max-w-[1200px]")}>
            {!ready ? (
              <div className="flex flex-col gap-5"><Skeleton className="h-10 w-72" /><Skeleton className="h-9 w-96" /><Skeleton className="h-64 w-full rounded-[16px]" /></div>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="no-print flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Link href="/" aria-label="Back to projects" title="Projects"
                      className="-ms-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"><ArrowLeft size={19} /></Link>
                    <div className="order-last flex min-w-0 basis-full items-center gap-3 sm:order-none sm:basis-auto">
                      <TitleInput />
                      <StatusMenu />
                    </div>
                    <div className="ms-auto flex items-center gap-1.5">
                      <SaveIndicator />
                      {!readOnly ? <>
                        <IconButton label="Undo (⌘Z)" size="sm" disabled={!ed.past.length} onClick={ed.undo}><Undo2 size={17} /></IconButton>
                        <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!ed.future.length} onClick={ed.redo}><Redo2 size={17} /></IconButton>
                      </> : null}
                      {role === "owner" ? <Button size="sm" variant="ghost" icon={<Share size={15} />} onClick={() => setSharing(true)}>Share</Button> : null}
                      <Button size="sm" variant={aiOpen ? "secondary" : "ghost"} icon={<Sparkles size={15} />} onClick={() => setAIOpen((o) => !o)} aria-pressed={aiOpen}>Ask</Button>
                      <MoreMenu owner={role === "owner"} onTemplate={() => setTemplating(true)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <Segmented label="Project view" value={tab} options={TABS.map((t) => ({ ...t, href: `/projects/${id}/${t.value}` }))} />
                    {tab !== "build" ? <SummaryBar /> : null}
                  </div>
                </div>
                {children}
              </div>
            )}
          </div>
        </div>
        {aiOpen && ready && !aiInPanel ? <AIPanel onClose={() => setAIOpen(false)} /> : null}
      </div>
      {sharing && ed.project ? <ShareSheet open={sharing} onOpenChange={setSharing} project={ed.project} /> : null}
      {templating && ed.project ? <TemplateSheet onClose={() => setTemplating(false)} admin={me.data?.role === "admin"} /> : null}
    </ProjectContext.Provider>
  );
}

function TitleInput() {
  const name = useEditor((s) => s.content?.name ?? "");
  const readOnly = useEditor((s) => s.readOnly);
  const edit = useEditor((s) => s.edit);
  return (
    <input key={name} aria-label="Project name" defaultValue={name} readOnly={readOnly} dir="auto"
      onBlur={(e) => { const v = e.target.value.trim() || "Untitled project"; if (v !== name) edit((d) => { d.name = v; }); else e.target.value = name; }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onInput={(e) => { (e.target as HTMLInputElement).size = Math.max(8, (e.target as HTMLInputElement).value.length + 1); }}
      size={Math.max(8, name.length + 1)}
      className="min-w-0 max-w-full rounded-lg bg-transparent px-1.5 text-[24px] font-bold leading-[1.15] tracking-[-0.02em] outline-none hover:bg-surface-2/60 focus:bg-surface-2 sm:text-[30px]" />
  );
}

function SaveIndicator() {
  const save = useEditor((s) => s.save);
  const readOnly = useEditor((s) => s.readOnly);
  if (readOnly) return <span className="me-2 text-[13px] text-ink-3">View only</span>;
  if (save === "saving" || save === "pending") return <span className="me-2 inline-flex items-center gap-1.5 text-[13px] text-ink-3"><Spinner className="h-3.5 w-3.5" />Saving</span>;
  if (save === "error" || save === "conflict") return <span className="me-2 inline-flex items-center gap-1.5 text-[13px] text-kerf"><CloudOff size={14} />{save === "conflict" ? "Out of date" : "Not saved"}</span>;
  if (save === "saved") return <span className="me-2 inline-flex items-center gap-1 text-[13px] text-ink-3"><Check size={14} />Saved</span>;
  return null;
}
