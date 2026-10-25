import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { Vec } from "./kernel";
import type { Axis, DragSnap, DrawPlane } from "./snap";

export type Selection = { kind: "member" | "node"; id: string } | null;
export type View = "iso" | "front" | "top" | "side";
export type Tool = "select" | "draw";
/** 3D: orbit and look. Front/Side/Top: flat views you draw and drag in. */
export type Mode = "3d" | "front" | "side" | "top";
export type FlatMode = Exclude<Mode, "3d">;

/** Each flat view looks along one axis (its normal) and draws in the other two. */
export const FLAT: Record<FlatMode, { normal: Axis; inPlane: [Axis, Axis]; label: string; face: (min: number, max: number) => number; faceName: [string, string] }> = {
  front: { normal: 1, inPlane: [0, 2], label: "y", face: (min) => min, faceName: ["front", "back"] },
  side: { normal: 0, inPlane: [1, 2], label: "x", face: (_, max) => max, faceName: ["left", "right"] },
  top: { normal: 2, inPlane: [0, 1], label: "z", face: (_, max) => max, faceName: ["bottom", "top"] },
};

/** The plane a flat view draws on: the chosen depth, else the face nearest the viewer. */
export function flatPlane(mode: FlatMode, depth: number | null, nodes: Iterable<Vec>): DrawPlane {
  const f = FLAT[mode];
  if (depth !== null) return { axis: f.normal, at: depth };
  const vals = [...nodes].map((p) => p[f.normal]);
  return { axis: f.normal, at: vals.length ? f.face(Math.min(...vals), Math.max(...vals)) : 0 };
}
/** A drawing in progress: where the next bar starts (an existing joint, or a point). */
export type DrawStart = { node?: string; at: Vec } | null;

/** View state of the 3D frame editor (not saved with the project). */
type FrameUI = {
  selected: Selection;
  /** Where "back" goes from the current selection (a bar, when its joint was opened from it). */
  back: Selection;
  hovered: string[]; // member ids lit by a cut-list row or the pointer
  ortho: boolean;
  view: { name: View | "fit" | "along"; n: number; along?: { a: Vec; b: Vec } }; // bump n to re-run the same request
  tool: Tool;
  mode: Mode;
  depth: Record<FlatMode, number | null>; // drawing depth per flat view (null: the nearest face)
  drawStart: DrawStart;
  typed: string; // length typed while drawing ("750")
  lockAxis: Axis | null; // Shift held while drawing
  drawItem: string | null; // material for new bars (null: the frame's most used)
  drag: { node: string; at: Vec; snap?: DragSnap } | null; // a joint being dragged (previewed, not saved yet)
  drawHover: { kind: string; len: number } | null; // what the draw tool points at, for the hint
  select: (s: Selection) => void;
  /** Open something from the current selection, so "back" returns to it. */
  open: (s: Selection) => void;
  goBack: () => void;
  /** Point the 3D camera down a bar (from its start), to see its section in place. */
  lookAlong: (a: Vec, b: Vec) => void;
  hover: (ids: string[]) => void;
  setOrtho: (o: boolean) => void;
  look: (name: View | "fit") => void;
  setTool: (t: Tool) => void;
  set: (p: Partial<Pick<FrameUI, "drawStart" | "typed" | "lockAxis" | "drawItem" | "drag" | "drawHover" | "depth">>) => void;
};

export const useFrameUI = create<FrameUI>((set) => ({
  selected: null,
  back: null,
  hovered: [],
  ortho: false,
  view: { name: "fit", n: 0 },
  select: (selected) => set({ selected, back: null }),
  open: (selected) => set((s) => ({ selected, back: s.selected })),
  goBack: () => set((s) => ({ selected: s.back, back: null })),
  lookAlong: (a, b) => set((s) => ({ view: { name: "along", n: s.view.n + 1, along: { a, b } }, mode: "3d" })),
  hover: (hovered) => set({ hovered }),
  setOrtho: (ortho) => set({ ortho }),
  look: (name) => set((s) => ({
    view: { name, n: s.view.n + 1 },
    mode: name === "iso" ? "3d" : name === "fit" ? s.mode : name,
    drawStart: null, typed: "", lockAxis: null,
  })),
  tool: "select",
  mode: "3d",
  depth: { front: null, side: null, top: null },
  drawStart: null,
  typed: "",
  lockAxis: null,
  drawItem: null,
  drag: null,
  drawHover: null,
  setTool: (tool) => set({ tool, drawStart: null, typed: "", lockAxis: null, selected: null, drawHover: null }),
  set: (p) => set(p),
}));

/** Back to a fresh editor: Select tool, nothing selected or pending, the next view fitted. */
export function resetFrameUI() {
  useFrameUI.setState({
    selected: null, back: null, hovered: [], ortho: false, view: { name: "fit", n: 0 }, tool: "select", mode: "3d",
    depth: { front: null, side: null, top: null }, drawStart: null, typed: "",
    lockAxis: null, drawItem: null, drag: null, drawHover: null,
  });
  if (typeof document !== "undefined") document.body.style.cursor = "";
}

/** Read CSS colour tokens for three.js, re-reading when the theme changes. */
export function useCssVars<T extends string>(names: readonly T[]): Record<T, string> {
  const key = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      const mo = new MutationObserver(cb);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
      return () => { mq.removeEventListener("change", cb); mo.disconnect(); };
    },
    () => {
      const cs = getComputedStyle(document.documentElement);
      return names.map((n) => cs.getPropertyValue(n).trim()).join("|");
    },
    () => names.map(() => "").join("|"),
  );
  const values = key.split("|");
  return Object.fromEntries(names.map((n, i) => [n, values[i] || "#888888"])) as Record<T, string>;
}
