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
  load: (p: Project, readOnly: boolean) => void;
  edit: (fn: (draft: ProjectContent) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  serverUpdate: (p: Project, keepHistory?: boolean) => void;
  flush: () => Promise<void>;
};

const SAVE_DELAY = 600;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let lastCoalesce: { key: string; at: number } | null = null;
let onSaved: (p: Project) => void = () => {};

export function setOnSaved(fn: (p: Project) => void) {
  onSaved = fn;
}

export function contentOf(p: Project): ProjectContent {
  return structuredClone({ name: p.name, description: p.description, settings: p.settings, assemblies: p.assemblies, extras: p.extras });
}

export const useEditor = create<Editor>((set, get) => {
  async function doSave() {
    const { project, content, version } = get();
    if (!project || !content) return;
    set({ save: "saving" });
    try {
      const saved = await unwrap<Project>(api.PUT("/api/projects/{project_id}", {
        params: { path: { project_id: project.id } },
        body: { ...content, version },
      }));
      const stillSame = get().content === content;
      set({ project: saved, version: saved.version, save: stillSame ? "saved" : "pending" });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        set({ save: "conflict" });
        toast.error(e.message);
      } else {
        set({ save: "error" });
        toast.error(e instanceof Error ? `Not saved: ${e.message}` : "Not saved.");
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    set({ save: "pending" });
    timer = setTimeout(async () => {
      timer = null;
      if (inflight) await inflight;
      inflight = doSave().finally(() => { inflight = null; });
      await inflight;
      if (get().save === "pending" && !timer) schedule();
    }, SAVE_DELAY);
  }

  return {
    project: null, content: null, version: 0, past: [], future: [], save: "idle", readOnly: false,
    load: (p, readOnly) => {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ project: p, content: contentOf(p), version: p.version, past: [], future: [], save: "idle", readOnly });
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
      set({
        project: p, content: contentOf(p), version: p.version, save: "saved",
        past: keepHistory && prev ? [...get().past.slice(-80), prev] : get().past, future: [],
      });
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        inflight = doSave().finally(() => { inflight = null; });
      }
      if (inflight) await inflight;
    },
  };
});

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
