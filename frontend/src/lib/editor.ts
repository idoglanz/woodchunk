"use client";

import { create } from "zustand";
import { api, ApiError, unwrap, type Assembly, type Part, type Project, type ProjectContent } from "@/lib/api/client";
import { equal, merge3, type Conflict, type MergeResult } from "@/lib/merge";
import { tidy } from "@/lib/sketch/model";
import { solve } from "@/lib/sketch/solve";
import { toast } from "@/lib/toast";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

type Editor = {
  project: Project | null;
  content: ProjectContent | null;
  version: number;
  past: ProjectContent[];
  future: ProjectContent[];
  save: SaveState;
  readOnly: boolean;
  /** The server's version after a save was refused because someone else saved first. */
  latest: Project | null;
  /** What both of you changed, when the two versions couldn't be combined. */
  conflicts: Conflict[];
  load: (p: Project, readOnly: boolean) => void;
  edit: (fn: (draft: ProjectContent) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  serverUpdate: (p: Project, keepHistory?: boolean) => void;
  /** Someone else saved and nothing here is unsaved: show their version (undo can't reach past it). */
  remoteUpdate: (p: Project) => void;
  /** Who's in the project changed: take the new members, leaving the content (and unsaved edits) alone. */
  membersUpdate: (p: Project) => void;
  /** Save now; resolves false if the project couldn't be saved (callers should stop). */
  flush: () => Promise<boolean>;
  keepMine: () => void;
  takeTheirs: () => void;
};

const SAVE_DELAY = 600;
const RETRY_DELAY = 4000;
let timer: ReturnType<typeof setTimeout> | null = null;
// Saves run one after another: an overlapping save would reuse the same version and be refused.
let chain: Promise<boolean> = Promise.resolve(true);
let saved: ProjectContent | null = null; // the content the server has
// After a clash: the version both sides started from, so the choice combines everything else,
// including edits made while the choice was on screen.
let clashBase: ProjectContent | null = null;
let lastCoalesce: { key: string; at: number } | null = null;
let onSaved: (p: Project) => void = () => {};

export function setOnSaved(fn: (p: Project) => void) {
  onSaved = fn;
}

/** Edits made here that the server doesn't have yet. */
export function hasUnsaved(): boolean {
  const { content, save } = useEditor.getState();
  return content !== saved || save === "pending" || save === "saving" || save === "conflict";
}

const MERGE_TRIES = 3;

export function contentOf(p: Project): ProjectContent {
  return structuredClone({ name: p.name, description: p.description, settings: p.settings, assemblies: p.assemblies, extras: p.extras, sketches: p.sketches });
}

/**
 * Combine two people's changes. A combined sketch can refer to points one of them deleted, or
 * have points each moved apart: tidy it and solve it again.
 */
function combine(base: ProjectContent, mine: ProjectContent, theirs: ProjectContent): MergeResult<ProjectContent> {
  const r = merge3(base, mine, theirs);
  const sketches = r.value.sketches.map((sk) => {
    if (mine.sketches.includes(sk) || theirs.sketches.includes(sk)) return sk; // one side's, as it was
    const clean = tidy(sk);
    const solved = solve(clean, { quick: true });
    return solved.ok ? solved.sketch : clean;
  });
  return { ...r, value: { ...r.value, sketches } };
}

export const useEditor = create<Editor>((set, get) => {
  async function doSave(tries = MERGE_TRIES): Promise<boolean> {
    const { project, content, version, save } = get();
    if (!project || !content) return true;
    if (save === "conflict") return false; // waiting for the user to choose
    if (content === saved) {
      if (save === "pending" || save === "error") set({ save: "saved" });
      return true;
    }
    set({ save: "saving" });
    try {
      const res = await unwrap<Project>(api.PUT("/api/projects/{project_id}", {
        params: { path: { project_id: project.id } },
        body: { ...content, version },
      }));
      saved = content;
      set({ project: res, version: res.version, save: get().content === content ? "saved" : "pending" });
      onSaved(res);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone (or another tab) saved first: combine their changes with ours, and save that.
        // Only when both changed the same thing does the user choose.
        const latest = await unwrap<Project>(api.GET("/api/projects/{project_id}", { params: { path: { project_id: project.id } } })).catch(() => null);
        if (!latest || latest.status === "done" || !saved || tries <= 0) {
          set({ save: "conflict", latest, conflicts: [] });
          return false;
        }
        const theirs = contentOf(latest);
        const merged = combine(saved, get().content!, theirs);
        if (merged.conflicts.length) {
          clashBase = saved;
          set({ save: "conflict", latest, conflicts: merged.conflicts });
          return false;
        }
        saved = theirs;
        // Undo steps were taken before their changes: going back would drop them. When theirs
        // already has everything, there's nothing left to save.
        const content = equal(merged.value, theirs) ? theirs : merged.value;
        set({ project: latest, version: latest.version, content, past: [], future: [], save: "pending" });
        onSaved(latest);
        return doSave(tries - 1);
      } else if (e instanceof ApiError && (e.status === 422 || e.status === 403 || e.status === 404)) {
        // Invalid, or no longer allowed (access changed, removed): retrying won't help.
        set({ save: "error" });
        toast.error(`Not saved: ${e.message}`);
      } else {
        // Offline or the server hiccuped: keep the edits and try again shortly.
        set({ save: "error" });
        if (!timer) timer = setTimeout(() => { timer = null; void enqueue(); }, RETRY_DELAY);
      }
      return false;
    }
  }

  function enqueue(): Promise<boolean> {
    chain = chain.then(() => doSave(), () => doSave());
    return chain;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    if (get().save !== "conflict") set({ save: "pending" });
    timer = setTimeout(() => {
      timer = null;
      void enqueue().then((ok) => { if (ok && get().content !== saved && !timer) schedule(); });
    }, SAVE_DELAY);
  }

  return {
    project: null, content: null, version: 0, past: [], future: [], save: "idle", readOnly: false, latest: null, conflicts: [],
    load: (p, readOnly) => {
      if (timer) clearTimeout(timer);
      timer = null;
      clashBase = null;
      const content = contentOf(p);
      saved = content;
      set({ project: p, content, version: p.version, past: [], future: [], save: "idle", readOnly, latest: null, conflicts: [] });
    },
    edit: (fn, coalesce) => {
      const { content, readOnly, past } = get();
      if (!content || readOnly) return;
      const next = structuredClone(content);
      fn(next);
      const now = Date.now();
      const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < 1200;
      lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
      set({ content: next, past: merge ? past : [...past.slice(-80), content], future: [] });
      schedule();
    },
    undo: () => {
      const { past, content, future, readOnly } = get();
      if (!past.length || !content || readOnly) return;
      set({ content: past[past.length - 1], past: past.slice(0, -1), future: [content, ...future] });
      schedule();
    },
    redo: () => {
      const { past, content, future, readOnly } = get();
      if (!future.length || !content || readOnly) return;
      set({ content: future[0], past: [...past, content], future: future.slice(1) });
      schedule();
    },
    serverUpdate: (p, keepHistory) => {
      if (timer) clearTimeout(timer);
      timer = null;
      const prev = get().content;
      const content = contentOf(p);
      saved = content;
      set({
        project: p, content, version: p.version, save: "saved", latest: null, conflicts: [],
        past: keepHistory && prev ? [...get().past.slice(-80), prev] : get().past, future: [],
      });
    },
    remoteUpdate: (p) => {
      if (hasUnsaved() || p.version <= get().version) return;
      const content = contentOf(p);
      saved = content;
      set({ project: p, content, version: p.version, past: [], future: [] });
    },
    flush: () => {
      if (timer) { clearTimeout(timer); timer = null; }
      return enqueue();
    },
    keepMine: () => {
      const { latest, content } = get();
      if (!latest || !content) return;
      if (clashBase) {
        // Everything combined, our values where we both changed something.
        const theirs = contentOf(latest);
        saved = theirs;
        set({ project: latest, version: latest.version, content: combine(clashBase, theirs, content).value, latest: null, conflicts: [], past: [], future: [], save: "pending" });
      } else {
        saved = null; // force a save of our content over theirs
        set({ version: latest.version, project: latest, latest: null, conflicts: [], save: "pending" });
      }
      clashBase = null;
      void enqueue();
    },
    takeTheirs: () => {
      const { latest, content } = get();
      if (!latest || !content) return;
      if (clashBase) {
        // Everything combined, their values where we both changed something.
        const theirs = contentOf(latest);
        saved = theirs;
        set({ project: latest, version: latest.version, content: combine(clashBase, content, theirs).value, latest: null, conflicts: [], past: [], future: [], save: "pending" });
        clashBase = null;
        void enqueue();
      } else {
        get().serverUpdate(latest);
      }
    },
    membersUpdate: (p) => {
      const { project } = get();
      if (project && project.id === p.id) set({ project: { ...project, members: p.members } });
    },
  };
});

/** Save pending edits before an action that reads the project on the server; throws if they can't be saved. */
export async function saveFirst(): Promise<void> {
  if (!(await useEditor.getState().flush())) {
    throw new Error("Your latest changes aren't saved yet, so this was stopped. Check the message at the top and try again.");
  }
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function newPart(fields: Partial<Part> = {}): Part {
  return {
    id: newId(), name: "", item_id: null, qty: 1, length_mm: 0, width_mm: null, grain_locked: false, notes: "",
    members: [], short_mm: null, cuts: [], face_up: "", ...fields,
  };
}

export function newAssembly(fields: Partial<Assembly> = {}): Assembly {
  return { id: newId(), letter: "", name: "", qty: 1, parts: [], hardware: [], notes: "", frame: null, frame_warnings: [], ...fields };
}

export function nextLetter(used: string[]): string {
  const set = new Set(used);
  for (let i = 0; ; i++) {
    let n = i + 1, s = "";
    while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    if (!set.has(s)) return s;
  }
}
