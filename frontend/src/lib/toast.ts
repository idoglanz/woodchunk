import { create } from "zustand";

export type Toast = { id: number; text: string; kind: "info" | "error"; action?: { label: string; run: () => void } };

type ToastStore = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let seq = 0;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 6000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = {
  info: (text: string, action?: Toast["action"]) => useToasts.getState().push({ text, kind: "info", action }),
  error: (text: string) => useToasts.getState().push({ text, kind: "error" }),
};
