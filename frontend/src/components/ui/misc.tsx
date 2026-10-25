"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const ASM = ["a", "b", "c", "d", "e", "f"] as const;

/** Index of an assembly letter in the 6-colour cycle (A→0 … F→5, G→0, AA→…). */
export function asmIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return (Math.max(1, n) - 1) % ASM.length;
}

export function asmColors(letter: string) {
  const k = ASM[asmIndex(letter)];
  return { background: `var(--asm-${k})`, color: `var(--asm-${k}-ink)` };
}

export function AsmChip({ letter, className, children }: { letter: string; className?: string; children?: ReactNode }) {
  return (
    <span style={asmColors(letter)} className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[12px] font-bold tnum", className)}>
      {children ?? letter}
    </span>
  );
}

export function Card({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" }) {
  return (
    <As className={cn("rounded-[16px] bg-surface shadow-[var(--shadow-card)] dark:border dark:border-line", className)}>
      {children}
    </As>
  );
}

const STATUS: Record<string, { label: string; dot: string }> = {
  planning: { label: "Planning", dot: "bg-accent" },
  bought: { label: "Bought", dot: "bg-info" },
  cut: { label: "Cut", dot: "bg-kerf" },
  done: { label: "Done", dot: "bg-ok" },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.planning;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[12px] font-semibold text-ink-2", className)}>
      <span className={cn("h-[7px] w-[7px] rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "kerf" | "info" | "accent"; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    kerf: "bg-kerf-soft text-kerf",
    info: "bg-info-soft text-info",
    accent: "bg-accent-soft text-ink",
  };
  return <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[12px] font-semibold", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, text, action, icon }: { title: string; text: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="max-w-[46ch] text-[15px] text-ink-2">{text}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.02em]">{title}</h1>
        {subtitle ? <p className="text-[15px] text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">{children}</h2>
      {actions}
    </div>
  );
}

export function Callout({ tone = "warn", title, children, icon }: { tone?: "warn" | "kerf" | "info" | "ok"; title?: string; children: ReactNode; icon?: ReactNode }) {
  const tones = { warn: "bg-warn-soft", kerf: "bg-kerf-soft", info: "bg-info-soft", ok: "bg-ok-soft" };
  const ink = { warn: "text-warn", kerf: "text-kerf", info: "text-info", ok: "text-ok" };
  return (
    <div className={cn("flex gap-3 rounded-xl px-4 py-3 text-[14px]", tones[tone])}>
      {icon ? <div className={cn("mt-0.5 shrink-0", ink[tone])}>{icon}</div> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className={cn("font-semibold", ink[tone])}>{title}</p> : null}
        <div className="text-ink">{children}</div>
      </div>
    </div>
  );
}
