"use client";

import { Minus, Plus } from "lucide-react";
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { lengthInput, parseLength, type Units } from "@/lib/units";

export const inputBase =
  "w-full rounded-lg bg-surface-2 text-ink placeholder:text-ink-3 outline-none transition-shadow duration-150 focus:shadow-[0_0_0_2px_var(--accent)] disabled:opacity-50";

export function Field({ label, hint, error, children, htmlFor, className }: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium tracking-[0.01em] text-ink-2">{label}</label>
      {children}
      {error ? <p className="text-[12px] text-kerf">{error}</p> : hint ? <p className="text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest }, ref,
) {
  return <input ref={ref} className={cn(inputBase, "h-10 px-3 text-[15px]", className)} {...rest} />;
});

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "min-h-24 px-3 py-2.5 text-[15px] leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, "h-10 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pe-8 ps-3 text-[15px]", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%238e8e93' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")" }}
      {...rest}>
      {children}
    </select>
  );
}

/** Text field that commits a parsed number on blur/Enter. Keeps the user's text while typing. */
function useCommitted(value: string, onCommit: (raw: string) => boolean) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const text = draft ?? value;
  return {
    text, bad,
    /** Replace the text being edited, e.g. when a key steps the value. */
    setText: (t: string) => { if (draft !== null) setDraft(t); },
    props: {
      value: text,
      onFocus: () => setDraft(value),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setDraft(e.target.value); setBad(false); },
      onBlur: () => { const ok = onCommit(text); setBad(!ok); setDraft(null); },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(value); setTimeout(() => (e.target as HTMLInputElement).blur()); }
      },
    },
  };
}

export function LengthInput({ value, onChange, units, placeholder, className, ariaLabel, invalid, id, allowEmpty = false, start }: {
  value: number | null | undefined; onChange: (mm: number | null) => void; units: Units; placeholder?: string;
  className?: string; ariaLabel: string; invalid?: boolean; id?: string; allowEmpty?: boolean;
  /** A small control inside the field's start edge (e.g. the grain toggle). */
  start?: ReactNode;
}) {
  const c = useCommitted(lengthInput(value, units), (raw) => {
    if (!raw.trim()) { if (allowEmpty) { onChange(null); return true; } onChange(0); return true; }
    const mm = parseLength(raw, units);
    if (mm === null) return false;
    if (mm !== value) onChange(mm);
    return true;
  });
  return (
    <div className={cn("relative", className)}>
      <input id={id} inputMode="decimal" aria-label={ariaLabel} placeholder={placeholder}
        className={cn(inputBase, "tnum h-9 pe-9 text-end text-[14px]", start ? "ps-9" : "ps-2.5", (invalid || c.bad) && "shadow-[0_0_0_1.5px_var(--kerf)]")}
        {...c.props} />
      {start ? <span className="absolute start-1 top-1/2 flex -translate-y-1/2">{start}</span> : null}
      <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">{units}</span>
    </div>
  );
}

export function NumberInput({ value, onChange, min = 0, step, className, ariaLabel, suffix, id, decimals = 0 }: {
  value: number | null | undefined; onChange: (n: number | null) => void; min?: number; step?: number; className?: string;
  ariaLabel: string; suffix?: string; id?: string; decimals?: number;
}) {
  const shown = value === null || value === undefined ? "" : String(Math.round(value * 10 ** decimals) / 10 ** decimals);
  const c = useCommitted(shown, (raw) => {
    if (!raw.trim()) { onChange(null); return true; }
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < min) return false;
    onChange(n);
    return true;
  });
  return (
    <div className={cn("relative", className)}>
      <input id={id} inputMode="decimal" step={step} aria-label={ariaLabel}
        className={cn(inputBase, "tnum h-9 px-2.5 text-end text-[14px]", suffix && "pe-9", c.bad && "shadow-[0_0_0_1.5px_var(--kerf)]")} {...c.props} />
      {suffix ? <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">{suffix}</span> : null}
    </div>
  );
}

/**
 * Quantity with − / + buttons. Type a number (committed on blur or Enter) or use the arrow keys.
 * The buttons are skipped by Tab so moving between fields stays quick.
 */
export function QtyInput({ value, onChange, min = 1, max = 9999, decimals = 0, ariaLabel, className, disabled }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; decimals?: number; ariaLabel: string; className?: string; disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 10 ** decimals) / 10 ** decimals));
  const shown = String(Math.round(value * 10 ** decimals) / 10 ** decimals);
  const c = useCommitted(shown, (raw) => {
    const n = Number(raw.replace(",", "."));
    if (!raw.trim() || !Number.isFinite(n)) return false;
    if (clamp(n) !== value) onChange(clamp(n));
    return true;
  });
  // Whole steps from a fractional value land on the next whole number (1.5 → 2 or 1).
  const step = (dir: 1 | -1) => {
    const typed = Number(c.text.replace(",", "."));
    const from = c.text.trim() && Number.isFinite(typed) ? typed : value;
    const n = clamp(dir > 0 ? Math.floor(from) + 1 : Math.ceil(from) - 1);
    onChange(n);
    c.setText(String(n));
  };
  const btn = "flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:text-ink disabled:opacity-30";
  return (
    <div className={cn("flex h-9 items-center rounded-lg bg-surface-2 transition-shadow duration-150 focus-within:shadow-[0_0_0_2px_var(--accent)]", c.bad && "shadow-[0_0_0_1.5px_var(--kerf)]", className)}>
      <button type="button" tabIndex={-1} aria-label={`Decrease ${ariaLabel}`} disabled={disabled || value <= min} onClick={() => step(-1)} className={btn}>
        <Minus size={14} strokeWidth={2.2} />
      </button>
      <input inputMode={decimals ? "decimal" : "numeric"} aria-label={ariaLabel} readOnly={disabled} {...c.props}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); if (!disabled) step(e.key === "ArrowUp" ? 1 : -1); return; }
          c.props.onKeyDown(e);
        }}
        className="tnum h-9 w-full min-w-0 bg-transparent text-center text-[14px] font-medium outline-none" />
      <button type="button" tabIndex={-1} aria-label={`Increase ${ariaLabel}`} disabled={disabled || value >= max} onClick={() => step(1)} className={btn}>
        <Plus size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex flex-col">
        <span id={`${id}-label`} className="text-[15px]">{label}</span>
        {description ? <span className="text-[13px] text-ink-2">{description}</span> : null}
      </label>
      <button id={id} type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-ok" : "bg-surface-3")}>
        <span className={cn("absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-[inset-inline-start] duration-200", checked ? "start-[20px]" : "start-[2px]")} />
      </button>
    </div>
  );
}
