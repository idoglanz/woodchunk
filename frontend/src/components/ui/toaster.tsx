"use client";

import { useToasts } from "@/lib/toast";
import { cn } from "@/lib/cn";

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
      {toasts.map((t) => (
        <div key={t.id} className={cn("animate-sheet pointer-events-auto flex max-w-[560px] items-center gap-4 rounded-2xl px-4 py-3 text-[14px] shadow-[var(--shadow-pop)]",
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
