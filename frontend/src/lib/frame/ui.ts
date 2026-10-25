import { useSyncExternalStore } from "react";
import { create } from "zustand";

export type Selection = { kind: "member" | "node"; id: string } | null;
export type View = "iso" | "front" | "top" | "side";

/** View state of the 3D frame editor (not saved with the project). */
type FrameUI = {
  selected: Selection;
  hovered: string[]; // member ids lit by a cut-list row or the pointer
  ortho: boolean;
  view: { name: View | "fit"; n: number }; // bump n to re-run the same request
  select: (s: Selection) => void;
  hover: (ids: string[]) => void;
  setOrtho: (o: boolean) => void;
  look: (name: View | "fit") => void;
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
