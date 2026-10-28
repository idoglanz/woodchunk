"use client";

import { useToasts } from "@/lib/toast";
import { cn } from "@/lib/cn";

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    // Phones: at the top (the bottom has the tab bar, the plan drawer and the selection bar).
    <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+60px)] z-[60] flex flex-col items-center gap-2 px-4 sm:top-auto sm:bottom-0 sm:pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
      {toasts.map((t) => (
        <div key={t.id} className={cn("animate-in pointer-events-auto flex max-w-[560px] items-center gap-4 rounded-2xl px-4 py-3 text-[14px] shadow-[var(--shadow-pop)]",
          t.kind === "error" ? "bg-kerf text-white" : "bg-ink text-surface")}>
          <span>{t.text}</span>
          {t.action ? (
            <button type="button" className="font-semibold text-accent" onClick={() => { t.action?.run(); dismiss(t.id); }}>
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
