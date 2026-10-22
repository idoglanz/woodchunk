"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "plain" | "destructive" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-[0.97] active:brightness-95 font-semibold",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 font-semibold",
  plain: "bg-transparent text-ink-2 hover:text-ink font-medium",
  destructive: "bg-surface-2 text-kerf hover:bg-kerf-soft font-semibold",
  ghost: "bg-transparent text-ink hover:bg-surface-2 font-medium",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-[10px] gap-1.5",
  md: "h-11 px-4 text-[15px] rounded-xl gap-2",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap transition-[background,color,filter,opacity] duration-150 disabled:opacity-45 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, size = "md", variant = "ghost", ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn(size === "sm" ? "w-8 px-0" : "w-11 px-0", className)}
      {...rest}
    />
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
