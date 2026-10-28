"use client";

import { create } from "zustand";

/** Parts picked for a batch change (material, duplicate, delete) on the Build tab. */
type PartSelection = {
  ids: string[];
  /** The last part clicked: shift-click selects from here. */
  anchor: string | null;
  /** Click: add or remove one. Shift-click: select everything between the anchor and this (in `order`). */
  toggle: (id: string, range: boolean, order: string[]) => void;
  set: (ids: string[]) => void;
  clear: () => void;
};

export const usePartSelection = create<PartSelection>((set, get) => ({
  ids: [],
  anchor: null,
  toggle: (id, range, order) => {
    const { ids, anchor } = get();
    if (range && anchor && order.includes(anchor) && order.includes(id)) {
      const [from, to] = [order.indexOf(anchor), order.indexOf(id)].sort((a, b) => a - b);
      set({ ids: [...new Set([...ids, ...order.slice(from, to + 1)])], anchor: id });
      return;
    }
    set({ ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], anchor: id });
  },
  set: (ids) => set({ ids, anchor: ids.at(-1) ?? null }),
  clear: () => set({ ids: [], anchor: null }),
}));
