import { useSyncExternalStore } from "react";
import { create } from "zustand";

/**
 * Links the parts list and the cutting layout on the Build tab: the part being edited or
 * hovered lights up in the layout, and clicking a piece in the layout jumps to its row.
 */
type PartFocus = {
  focused: string | null;
  hovered: string | null;
  setFocused: (id: string | null) => void;
  setHovered: (id: string | null) => void;
};

export const usePartFocus = create<PartFocus>((set) => ({
  focused: null,
  hovered: null,
  setFocused: (focused) => set({ focused }),
  setHovered: (hovered) => set({ hovered }),
}));

export function useActivePart(): string | null {
  return usePartFocus((s) => s.hovered ?? s.focused);
}

export const partRowId = (partId: string) => `part-${partId}`;

/** Scroll a part's row into view, flash it, and focus its name when there's a mouse. */
export function revealPart(partId: string) {
  const row = document.getElementById(partRowId(partId));
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  // Focusing on a touch screen would pop the keyboard up; there the highlight is enough.
  if (window.matchMedia("(pointer: fine)").matches) row.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
