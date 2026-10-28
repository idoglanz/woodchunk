import { create } from "zustand";
import type { V2 } from "./solve";

export type Tool = "select" | "line" | "rect" | "circle" | "arc" | "dimension";

/** The first clicks of a shape being drawn: an existing point (the origin too), or a spot, maybe on an axis. */
export type Anchor = { point?: string; axis?: string; at: V2 };

/** What the sketch screen shows and is in the middle of (not saved with the project). */
type SketchUI = {
  tool: Tool;
  selected: string[];
  /** Clicks so far for the shape being drawn, or the items picked for a dimension. */
  anchors: Anchor[];
  picks: string[];
  /** Points being dragged, previewed until release. */
  drag: { point: string; to: V2 }[] | null;
  /** The dimension whose value is being typed. */
  editing: string | null;
  /** Measure every line and circle, not only the selection. */
  showAll: boolean;
  /** Items lit from elsewhere (a row of the dimensions list). */
  hovered: string[];
  /** A length typed while drawing ("600", or "1200x600" for a rectangle), placed with Enter. */
  typed: string;
  setTool: (t: Tool) => void;
  select: (ids: string[]) => void;
  set: (p: Partial<Pick<SketchUI, "anchors" | "picks" | "drag" | "editing" | "showAll" | "hovered" | "typed">>) => void;
  reset: () => void;
};

const fresh = { tool: "select" as Tool, selected: [], anchors: [], picks: [], drag: null, editing: null, hovered: [], typed: "" };

export const useSketchUI = create<SketchUI>((set) => ({
  ...fresh,
  showAll: false,
  setTool: (tool) => set({ tool, anchors: [], picks: [], selected: [], editing: null, typed: "" }),
  select: (selected) => set({ selected }),
  set: (p) => set(p),
  reset: () => set(fresh),
}));
