/**
 * Starting frames. Node positions are expressions of the template's parameters, so editing W, D or H
 * later moves every node that depends on it. Structural options (shelf count, lower frame) apply
 * when the frame is created.
 */

import type { Assembly } from "@/lib/api/client";
import type { ProfileSpec } from "./types";

const newId = () => crypto.randomUUID().replace(/-/g, "");

/** A frame as stored on an assembly (every field present). */
export type StoredFrame = NonNullable<Assembly["frame"]>;
type StoredNode = StoredFrame["nodes"][number];
type StoredMember = StoredFrame["members"][number];

export type TemplateRole = "legs" | "rails";
/** A size. `option`: only used (and shown) when that option is on. */
export type TemplateParam = { name: string; label: string; mm: number; option?: string };
export type TemplateOption = { key: string; label: string; kind: "toggle" | "count"; value: number; min?: number; max?: number };

export type FrameTemplate = {
  id: string;
  name: string;
  summary: string;
  params: TemplateParam[];
  roles: { key: TemplateRole; label: string }[];
  options: TemplateOption[];
  build: (ctx: BuildCtx) => StoredFrame;
};

export type BuildCtx = {
  params: Record<string, number>;
  options: Record<string, number>;
  items: Partial<Record<TemplateRole, string | null>>;
  sections: Partial<Record<TemplateRole, ProfileSpec | null>>;
};

/** Collects nodes and members while a template builds. */
class Builder {
  nodes: StoredNode[] = [];
  members: StoredMember[] = [];
  constructor(private ctx: BuildCtx) {}

  node(x: number | string, y: number | string, z: number | string): string {
    const id = newId().slice(0, 10);
    this.nodes.push({ id, x, y, z });
    return id;
  }

  member(a: string, b: string, role: TemplateRole, name: string) {
    const sec = this.ctx.sections[role];
    // Rectangular rails stand on edge (taller than wide) — stiffer, and how frames are usually built.
    const onEdge = role === "rails" && sec && sec.w > sec.h * 1.2;
    this.members.push({ id: newId().slice(0, 10), a, b, item_id: this.ctx.items[role] ?? null, roll_deg: onEdge ? 90 : 0, anchor: "auto", name });
  }

  /** Four rails around a W × D rectangle at height z, between existing corner nodes. */
  ring(corners: string[], name = "Rail") {
    for (let i = 0; i < 4; i++) this.member(corners[i], corners[(i + 1) % 4], "rails", name);
  }

  frame(params: TemplateParam[], corner: "butt" | "miter" = "butt"): StoredFrame {
    return {
      version: 1,
      params: params.filter((p) => !p.option || this.ctx.options[p.option])
        .map((p) => ({ name: p.name, label: p.label, mm: this.ctx.params[p.name] ?? p.mm })),
      defaults: { corner, lines: "outside" },
      nodes: this.nodes, members: this.members, joints: [],
    };
  }
}

const XY: [string | number, string | number][] = [[0, 0], ["W", 0], ["W", "D"], [0, "D"]];

function legsAndRings(t: FrameTemplate, ctx: BuildCtx, levels: (string | number)[], lowerName = "Stretcher"): StoredFrame {
  const b = new Builder(ctx);
  const columns = XY.map(([x, y]) => levels.map((z) => b.node(x, y, z)));
  // Legs from the floor to the top, through every level (levels sit on the legs' spans: T-joints).
  const floor = XY.map(([x, y]) => b.node(x, y, 0));
  for (let i = 0; i < 4; i++) b.member(floor[i], columns[i][levels.length - 1], "legs", "Leg");
  levels.forEach((_, k) => b.ring(columns.map((c) => c[k]), k === levels.length - 1 ? "Apron" : lowerName));
  return b.frame(t.params);
}

const table: FrameTemplate = {
  id: "table", name: "Table", summary: "Four legs with aprons under the top; optional lower frame.",
  params: [{ name: "W", label: "Width", mm: 1200 }, { name: "D", label: "Depth", mm: 600 }, { name: "H", label: "Height", mm: 750 }, { name: "S", label: "Lower frame height", mm: 150, option: "lower" }],
  roles: [{ key: "legs", label: "Legs" }, { key: "rails", label: "Aprons and rails" }],
  options: [{ key: "lower", label: "Lower frame", kind: "toggle", value: 0 }],
  build(ctx) { return legsAndRings(this, ctx, ctx.options.lower ? ["S", "H"] : ["H"]); },
};

const workbench: FrameTemplate = {
  ...table, id: "workbench", name: "Workbench", summary: "Sturdy bench frame with a lower shelf frame.",
  params: [{ name: "W", label: "Width", mm: 1500 }, { name: "D", label: "Depth", mm: 700 }, { name: "H", label: "Height", mm: 900 }, { name: "S", label: "Shelf height", mm: 200, option: "lower" }],
  options: [{ key: "lower", label: "Lower shelf frame", kind: "toggle", value: 1 }],
  build(ctx) { return legsAndRings(this, ctx, ctx.options.lower ? ["S", "H"] : ["H"], "Shelf rail"); },
};

const cart: FrameTemplate = {
  id: "cart", name: "Cart / box frame", summary: "A box of 12 bars: a frame at the bottom and at the top.",
  params: [{ name: "W", label: "Width", mm: 900 }, { name: "D", label: "Depth", mm: 500 }, { name: "H", label: "Height", mm: 800 }, { name: "S", label: "Middle shelf height", mm: 400, option: "middle" }],
  roles: [{ key: "legs", label: "Uprights" }, { key: "rails", label: "Rails" }],
  options: [{ key: "middle", label: "Middle shelf frame", kind: "toggle", value: 0 }],
  build(ctx) {
    const b = new Builder(ctx);
    const levels: (string | number)[] = ctx.options.middle ? [0, "S", "H"] : [0, "H"];
    const columns = XY.map(([x, y]) => levels.map((z) => b.node(x, y, z)));
    for (let i = 0; i < 4; i++) b.member(columns[i][0], columns[i][levels.length - 1], "legs", "Upright");
    levels.forEach((_, k) => b.ring(columns.map((c) => c[k]), k === 0 ? "Bottom rail" : k === levels.length - 1 ? "Top rail" : "Shelf rail"));
    return b.frame(this.params);
  },
};

const shelf: FrameTemplate = {
  id: "shelf", name: "Shelf unit", summary: "Four uprights with a frame for every shelf.",
  params: [{ name: "W", label: "Width", mm: 800 }, { name: "D", label: "Depth", mm: 350 }, { name: "H", label: "Height", mm: 1800 }, { name: "S", label: "Bottom shelf height", mm: 100 }],
  roles: [{ key: "legs", label: "Uprights" }, { key: "rails", label: "Shelf rails" }],
  options: [{ key: "shelves", label: "Shelves", kind: "count", value: 4, min: 2, max: 8 }],
  build(ctx) {
    const n = Math.max(2, Math.min(8, Math.round(ctx.options.shelves || 4)));
    const levels = Array.from({ length: n }, (_, k) => (k === 0 ? "S" : k === n - 1 ? "H" : `S + (H - S) * ${k} / ${n - 1}`));
    return legsAndRings(this, ctx, levels, "Shelf rail");
  },
};

const gate: FrameTemplate = {
  id: "gate", name: "Gate / panel", summary: "A flat W × H frame standing up, with optional middle rails.",
  params: [{ name: "W", label: "Width", mm: 1000 }, { name: "H", label: "Height", mm: 1200 }],
  roles: [{ key: "legs", label: "Stiles (sides)" }, { key: "rails", label: "Rails" }],
  options: [{ key: "middle", label: "Middle rails", kind: "count", value: 1, min: 0, max: 4 }],
  build(ctx) {
    const b = new Builder(ctx);
    const bl = b.node(0, 0, 0), br = b.node("W", 0, 0), tl = b.node(0, 0, "H"), tr = b.node("W", 0, "H");
    b.member(bl, tl, "legs", "Stile");
    b.member(br, tr, "legs", "Stile");
    b.member(bl, br, "rails", "Bottom rail");
    b.member(tl, tr, "rails", "Top rail");
    const m = Math.max(0, Math.min(4, Math.round(ctx.options.middle ?? 0)));
    for (let k = 1; k <= m; k++) {
      const z = `H * ${k} / ${m + 1}`;
      b.member(b.node(0, 0, z), b.node("W", 0, z), "rails", "Middle rail");
    }
    return b.frame(this.params);
  },
};

const empty: FrameTemplate = {
  id: "empty", name: "Start empty", summary: "Draw every bar yourself, snapping to joints and axes.",
  params: [], roles: [{ key: "rails", label: "Bars" }], options: [],
  build(ctx) { return new Builder(ctx).frame([]); },
};

export const TEMPLATES: FrameTemplate[] = [table, workbench, cart, shelf, gate, empty];
