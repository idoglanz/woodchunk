import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { Vec } from "./kernel";
import type { Axis } from "./snap";

export type Selection = { kind: "member" | "node"; id: string } | null;
export type View = "iso" | "front" | "top" | "side";
export type Tool = "select" | "draw";
/** A drawing in progress: where the next bar starts (an existing joint, or a point). */
export type DrawStart = { node?: string; at: Vec } | null;

/** View state of the 3D frame editor (not saved with the project). */
type FrameUI = {
  selected: Selection;
  hovered: string[]; // member ids lit by a cut-list row or the pointer
  ortho: boolean;
  view: { name: View | "fit"; n: number }; // bump n to re-run the same request
  tool: Tool;
  drawStart: DrawStart;
  typed: string; // length typed while drawing ("750")
  lockAxis: Axis | null; // Shift held while drawing
  drawItem: string | null; // material for new bars (null: the frame's most used)
  drag: { node: string; at: Vec } | null; // a joint being dragged (previewed, not saved yet)
  drawHover: { kind: string; len: number } | null; // what the draw tool points at, for the hint
  select: (s: Selection) => void;
  hover: (ids: string[]) => void;
  setOrtho: (o: boolean) => void;
  look: (name: View | "fit") => void;
  setTool: (t: Tool) => void;
  set: (p: Partial<Pick<FrameUI, "drawStart" | "typed" | "lockAxis" | "drawItem" | "drag" | "drawHover">>) => void;
};

export const useFrameUI = create<FrameUI>((set) => ({
  selected: null,
  hovered: [],
  ortho: false,
  view: { name: "fit", n: 0 },
  select: (selected) => set({ selected }),
  hover: (hovered) => set({ hovered }),
  setOrtho: (ortho) => set({ ortho }),
  look: (name) => set((s) => ({ view: { name, n: s.view.n + 1 } })),
  tool: "select",
  drawStart: null,
  typed: "",
  lockAxis: null,
  drawItem: null,
  drag: null,
  drawHover: null,
  setTool: (tool) => set({ tool, drawStart: null, typed: "", lockAxis: null, selected: null, drawHover: null }),
  set: (p) => set(p),
}));

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
