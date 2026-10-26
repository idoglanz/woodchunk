"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

type Option<T extends string> = { value: T; label: string; href?: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  label,
}: {
  options: Option<T>[];
  value: T;
  onChange?: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("inline-flex rounded-[11px] bg-surface-2 p-[3px]", size === "sm" ? "h-9 sm:h-8" : "h-10 sm:h-9", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        const cls = cn(
          "relative flex items-center justify-center rounded-[8px] px-3.5 text-[13px] font-semibold transition-colors duration-150",
          active ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]" : "text-ink-2 hover:text-ink",
        );
        return o.href ? (
          <Link key={o.value} href={o.href} role="tab" aria-selected={active} className={cls} scroll={false}>
            {o.label}
          </Link>
        ) : (
          <button key={o.value} type="button" role="tab" aria-selected={active} className={cls} onClick={() => onChange?.(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
