"use client";

import { create } from "zustand";
import { api, ApiError, unwrap, type Assembly, type Part, type Project, type ProjectContent } from "@/lib/api/client";
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
  load: (p: Project, readOnly: boolean) => void;
  edit: (fn: (draft: ProjectContent) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  serverUpdate: (p: Project, keepHistory?: boolean) => void;
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
let lastCoalesce: { key: string; at: number } | null = null;
let onSaved: (p: Project) => void = () => {};

export function setOnSaved(fn: (p: Project) => void) {
  onSaved = fn;
}

export function contentOf(p: Project): ProjectContent {
  return structuredClone({ name: p.name, description: p.description, settings: p.settings, assemblies: p.assemblies, extras: p.extras });
}

export const useEditor = create<Editor>((set, get) => {
  async function doSave(): Promise<boolean> {
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
        // Someone (or another tab) saved first: fetch theirs and let the user choose.
        const latest = await unwrap<Project>(api.GET("/api/projects/{project_id}", { params: { path: { project_id: project.id } } })).catch(() => null);
        set({ save: "conflict", latest });
      } else if (e instanceof ApiError && e.status === 422) {
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
    chain = chain.then(doSave, doSave);
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
    project: null, content: null, version: 0, past: [], future: [], save: "idle", readOnly: false, latest: null,
    load: (p, readOnly) => {
      if (timer) clearTimeout(timer);
      timer = null;
      const content = contentOf(p);
      saved = content;
      set({ project: p, content, version: p.version, past: [], future: [], save: "idle", readOnly, latest: null });
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
        project: p, content, version: p.version, save: "saved", latest: null,
        past: keepHistory && prev ? [...get().past.slice(-80), prev] : get().past, future: [],
      });
    },
    flush: () => {
      if (timer) { clearTimeout(timer); timer = null; }
      return enqueue();
    },
    keepMine: () => {
      const { latest } = get();
      if (!latest) return;
      saved = null; // force a save of our content over theirs
      set({ version: latest.version, project: latest, latest: null, save: "pending" });
      void enqueue();
    },
    takeTheirs: () => {
      const { latest } = get();
      if (latest) get().serverUpdate(latest);
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
