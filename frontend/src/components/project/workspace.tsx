"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ClipboardList, CloudOff, Hammer, Redo2, Share, ShoppingCart, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AIPanel } from "@/components/project/ai-panel";
import { ProjectContext, useProjectCtx } from "@/components/project/context";
import { MoreMenu, TemplateSheet } from "@/components/project/more-menu";
import { ShareSheet } from "@/components/project/share";
import { StatusMenu } from "@/components/project/status-menu";
import { SummaryBar } from "@/components/project/summary-bar";
import { Avatars } from "@/components/ui/avatars";
import { Button, IconButton, Spinner } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { api, ApiError, unwrap, type Project, type Schemas } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { hasUnsaved, setOnSaved, useEditor } from "@/lib/editor";
import { useMediaQuery } from "@/lib/focus";
import { relativeTime } from "@/lib/format";
import type { Conflict } from "@/lib/merge";
import { qk, useMe, usePlan, useProject } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { useTypingOnPhone } from "@/lib/typing";
import type { Units } from "@/lib/units";

const SYNC_EVERY_MS = 8000;

/**
 * Keeps an open project current while others work on it: a cheap check every few seconds (and
 * when the tab comes back into view) loads their saves when nothing here is unsaved (unsaved edits
 * are merged when they're saved), and refreshes the shopping list when someone ticks an item.
 */
function useLiveSync(id: string, enabled: boolean) {
  const qc = useQueryClient();
  const router = useRouter();
  const seen = useRef<{ checks: number; members: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    let gone = false;
    const fetchProject = () => unwrap<Project>(api.GET("/api/projects/{project_id}", { params: { path: { project_id: id } } }));
    const check = async () => {
      if (busy || gone || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const s = await unwrap<Schemas["SyncOut"]>(api.GET("/api/projects/{project_id}/sync", { params: { path: { project_id: id } } }));
        // Compare with the last check, or on the first one with the project as this page loaded it.
        const loaded = useEditor.getState().project;
        const last = seen.current ?? (loaded ? { checks: loaded.checks_rev, members: loaded.members_rev } : null);
        seen.current = { checks: s.checks_rev, members: s.members_rev };
        if (last && s.checks_rev !== last.checks) void qc.invalidateQueries({ queryKey: ["shopping", id] });
        if (s.version > useEditor.getState().version && !hasUnsaved()) {
          const p = await fetchProject();
          useEditor.getState().remoteUpdate(p);
          qc.setQueryData(qk.project(p.id), p);
        } else if (last && s.members_rev !== last.members) {
          // Someone joined, left or changed access (maybe ours: the page turns read-only or editable).
          const p = await fetchProject();
          useEditor.getState().membersUpdate(p);
          qc.setQueryData<Project>(qk.project(p.id), (old) => (old ? { ...old, members: p.members } : p));
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          // Removed from the project (or it was deleted): nothing more to sync.
          gone = true;
          toast.info("You no longer have access to this project.");
          router.replace("/");
        }
        // Otherwise offline or signed out: the next check tries again.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, SYNC_EVERY_MS);
    const onShow = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [id, enabled, qc, router]);
}

const TABS = [
  { value: "build", label: "Build", icon: Hammer },
  { value: "buy", label: "Buy", icon: ShoppingCart },
  { value: "sheet", label: "Shop sheet", icon: ClipboardList },
] as const;

/**
 * Phones: the project's views as a tab bar along the bottom, in thumb reach. Bars pinned to the
 * bottom (the cutting plan, the shopping total) sit on top of it via --bottom-nav.
 */
function BottomNav({ id, tab }: { id: string; tab: string }) {
  if (useTypingOnPhone()) return null; // the keyboard is up: out of its way
  return (
    <nav aria-label="Project view" className="no-print fixed inset-x-0 bottom-0 z-[35] flex border-t border-line backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", background: "color-mix(in srgb, var(--surface) 96%, transparent)" }}>
      {TABS.map((t) => {
        const active = t.value === tab;
        return (
          <Link key={t.value} href={`/projects/${id}/${t.value}`} scroll={false} aria-current={active ? "page" : undefined}
            className={cn("flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "font-semibold text-ink" : "font-medium text-ink-3")}>
            <span className={cn("flex h-7 w-14 items-center justify-center rounded-full transition-colors", active && "bg-accent-soft")}>
              <t.icon size={19} strokeWidth={active ? 2.2 : 1.8} />
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

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
  // Everyone else in the project: shown as avatars beside Share.
  const others = (project.data?.members ?? []).filter((m) => m.user_id !== me.data?.id);
  const readOnly = !project.data || project.data.status === "done" || (role === "viewer" && me.data?.role !== "admin");

  useEffect(() => {
    if (project.data && me.data && loadedFor.current !== project.data.id) {
      loadedFor.current = project.data.id;
      useEditor.getState().load(project.data, readOnly);
    }
  }, [project.data, me.data, readOnly]);

  // A project opens at its top, whatever page (and scroll position) it was opened from.
  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  useEffect(() => {
    useEditor.setState({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    setOnSaved((p) => qc.setQueryData(qk.project(p.id), p));
    return () => { void useEditor.getState().flush(); };
  }, [qc]);

  // Warn before leaving the page with edits the server doesn't have yet.
  const unsaved = ed.save === "pending" || ed.save === "saving" || ed.save === "error" || ed.save === "conflict";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

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
  useLiveSync(id, ready);
  const title = ed.content?.name;
  useEffect(() => {
    if (title) document.title = `${title} · Woodchunk`;
  }, [title]);
  const plan = usePlan(id, ed.version, "en", ready);
  const ctx = useMemo(() => ({
    id, units: (me.data?.prefs.units ?? "mm") as Units, readOnly, me: me.data, plan: plan.data,
    planFetching: plan.isFetching, aiOpen, openAI: () => setAIOpen(true), closeAI: () => setAIOpen(false),
  }), [id, me.data, readOnly, plan.data, plan.isFetching, aiOpen]);

  // The 3D frame editor takes the whole page below the app bar.
  const fullBleed = pathname.includes("/frame/");

  if (project.isError) {
    return <EmptyState title="Project not found" text="It may have been deleted, or you don't have access to it." action={<Link href="/" className="font-semibold text-info">Back to projects</Link>} />;
  }

  if (fullBleed) {
    return (
      <ProjectContext.Provider value={ctx}>
        <ConflictBanner />
        {ready ? children : <div className="p-6"><Skeleton className="h-[70dvh] w-full rounded-[16px]" /></div>}
      </ProjectContext.Provider>
    );
  }

  return (
    <ProjectContext.Provider value={ctx}>
      {/* Phones have the bottom tab bar: what's pinned to the bottom sits above it, and it covers the safe area. */}
      <div className="flex min-h-[calc(100dvh-52px)] [--bottom-nav:calc(56px_+_env(safe-area-inset-bottom))] [--bottom-safe:0px] sm:[--bottom-nav:0px] sm:[--bottom-safe:env(safe-area-inset-bottom)]">
        <div className="min-w-0 flex-1">
          {/* The full window width on every tab, so switching tabs doesn't move the page. */}
          <div className="w-full ps-[max(16px,env(safe-area-inset-left))] pe-[max(16px,env(safe-area-inset-right))] pb-[calc(var(--bottom-nav)_+_96px)] pt-5 sm:ps-6 sm:pe-6 sm:pb-28 lg:ps-8 lg:pe-8">
            {!ready ? (
              <div className="flex flex-col gap-5"><Skeleton className="h-10 w-72" /><Skeleton className="h-9 w-96" /><Skeleton className="h-64 w-full rounded-[16px]" /></div>
            ) : (
              <div className="flex flex-col gap-5">
                <ConflictBanner />
                <div className="no-print flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Link href="/" aria-label="Back to projects" title="Projects"
                      className="-ms-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"><ArrowLeft size={19} /></Link>
                    <div className="order-last flex min-w-0 basis-full items-center gap-3 sm:order-none sm:basis-auto">
                      <TitleInput />
                      {/* Phones: the title has its own row, with the status beside it. Wider: with the actions. */}
                      <span className="shrink-0 sm:hidden"><StatusMenu /></span>
                    </div>
                    <div className="ms-auto flex items-center gap-1.5">
                      <span className="me-1.5 hidden sm:inline-flex"><StatusMenu /></span>
                      <SaveIndicator />
                      {!readOnly ? <>
                        <IconButton label="Undo (⌘Z)" size="sm" disabled={!ed.past.length} onClick={ed.undo}><Undo2 size={17} /></IconButton>
                        <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!ed.future.length} onClick={ed.redo}><Redo2 size={17} /></IconButton>
                      </> : null}
                      {others.length ? (
                        <button type="button" onClick={() => setSharing(true)} className="me-1 rounded-full"
                          aria-label={`Shared with ${others.map((m) => m.name || m.email).join(", ")}`}>
                          <Avatars people={others.map((m) => ({ user_id: m.user_id, name: m.name || m.email }))} size={26} />
                        </button>
                      ) : null}
                      {role ? <Button size="sm" variant="ghost" icon={<Share size={15} />} onClick={() => setSharing(true)}>{role === "owner" ? "Share" : "People"}</Button> : null}
                      <Button size="sm" variant={aiOpen ? "secondary" : "ghost"} icon={<Sparkles size={15} />} onClick={() => setAIOpen((o) => !o)} aria-pressed={aiOpen}>Ask</Button>
                      <MoreMenu owner={role === "owner"} onTemplate={() => setTemplating(true)} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Phones switch views from the bottom tab bar instead. */}
                    <div className="hidden sm:block">
                      <Segmented label="Project view" value={tab} options={TABS.map((t) => ({ value: t.value, label: t.label, href: `/projects/${id}/${t.value}` }))} />
                    </div>
                    {tab !== "build" ? <SummaryBar /> : null}
                  </div>
                </div>
                {children}
              </div>
            )}
          </div>
        </div>
        {aiOpen && ready && !aiInPanel ? <AIPanel onClose={() => setAIOpen(false)} /> : null}
        <BottomNav id={id} tab={tab} />
      </div>
      {sharing && ed.project ? <ShareSheet open={sharing} onOpenChange={setSharing} project={ed.project} /> : null}
      {templating && ed.project ? <TemplateSheet onClose={() => setTemplating(false)} admin={me.data?.role === "admin"} /> : null}
    </ProjectContext.Provider>
  );
}

/** Someone else saved while this tab was editing: choose whose version wins. */
function ConflictBanner() {
  const save = useEditor((s) => s.save);
  const latest = useEditor((s) => s.latest);
  const conflicts = useEditor((s) => s.conflicts);
  if (save !== "conflict") return null;
  const who = latest?.updated_by_name || "Someone else";
  const what = conflicts.slice(0, 3).map(conflictLabel).join("; ");
  return (
    <div role="alert" className="no-print flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-kerf-soft px-4 py-3 text-[14px]">
      <span className="font-medium text-ink">
        {conflicts.length
          ? <>You and {who} both changed {what}{conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ""}. Everything else is combined. Which value should win?</>
          : <>{who} changed this project while you were editing, so your last changes aren&apos;t saved.</>}
      </span>
      <span className="flex gap-2">
        <Button size="sm" onClick={() => useEditor.getState().takeTheirs()} disabled={!latest}>{conflicts.length ? "Theirs" : "Load their version"}</Button>
        <Button size="sm" variant="primary" onClick={() => useEditor.getState().keepMine()} disabled={!latest}>{conflicts.length ? "Mine" : "Keep mine"}</Button>
      </span>
    </div>
  );
}

const FIELD_NAMES: Record<string, string> = {
  qty: "quantity", length_mm: "length", width_mm: "width", item_id: "material", name: "name", notes: "notes",
  grain_locked: "grain", settings: "cutting settings", description: "description",
};
const CONTAINERS = new Set(["assemblies", "parts", "hardware", "extras", "frame", "nodes", "members", "joints"]);

/** "Frame › Leg › quantity" from a merge path. */
function conflictLabel(c: Conflict): string {
  const parts = c.path.filter((p) => !CONTAINERS.has(p)).map((p) => FIELD_NAMES[p] ?? p.replace(/_mm$/, "").replace(/_/g, " "));
  return parts.join(" › ") || "the project";
}

function TitleInput() {
  const name = useEditor((s) => s.content?.name ?? "");
  const readOnly = useEditor((s) => s.readOnly);
  const edit = useEditor((s) => s.edit);
  return (
    <input key={name} aria-label="Project name" defaultValue={name} readOnly={readOnly} dir="auto" maxLength={120}
      onBlur={(e) => { const v = e.target.value.trim() || "Untitled project"; if (v !== name) edit((d) => { d.name = v; }); else e.target.value = name; }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onInput={(e) => { (e.target as HTMLInputElement).size = Math.max(8, (e.target as HTMLInputElement).value.length + 1); }}
      size={Math.max(8, name.length + 1)}
      className="keep-font-size min-w-0 max-w-full rounded-lg bg-transparent px-1.5 text-[24px] font-bold leading-[1.15] tracking-[-0.02em] outline-none hover:bg-surface-2/60 focus:bg-surface-2 sm:text-[30px]" />
  );
}

function SaveIndicator() {
  const save = useEditor((s) => s.save);
  const readOnly = useEditor((s) => s.readOnly);
  const project = useEditor((s) => s.project);
  const { me } = useProjectCtx();
  // Someone else made the latest change: say who, so a shared project's changes aren't a mystery.
  const byOther = project?.updated_by && project.updated_by !== me?.id && (save === "saved" || save === "idle");
  if (readOnly) return <span className="me-2 text-[13px] text-ink-3">View only</span>;
  if (byOther) return <span className="me-2 text-[13px] text-ink-3 max-sm:hidden" title={new Date(project.updated_at).toLocaleString()}>{project.updated_by_name} edited · {relativeTime(project.updated_at)}</span>;
  // Phones: icons only, so the header's actions fit beside the back arrow.
  if (save === "saving" || save === "pending") return <span className="me-2 inline-flex items-center gap-1.5 text-[13px] text-ink-3"><Spinner className="h-3.5 w-3.5" /><span className="max-sm:sr-only">Saving</span></span>;
  if (save === "error" || save === "conflict") return <span className="me-2 inline-flex items-center gap-1.5 text-[13px] text-kerf"><CloudOff size={14} />{save === "conflict" ? "Out of date" : "Not saved, retrying"}</span>;
  if (save === "saved") return <span className="me-2 inline-flex items-center gap-1 text-[13px] text-ink-3"><Check size={14} /><span className="max-sm:sr-only">Saved</span></span>;
  return null;
}
