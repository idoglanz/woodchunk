"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Centered dialog on desktop, bottom sheet on phones. */
export function Sheet({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode;
  footer?: ReactNode; wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-in fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "animate-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[20px] bg-surface shadow-[var(--shadow-pop)] outline-none",
            "sm:inset-x-auto sm:bottom-auto sm:start-1/2 sm:top-[10vh] sm:max-h-[80vh] sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:rounded-[20px] rtl:sm:translate-x-1/2",
            wide && "sm:w-[min(94vw,880px)]",
          )}
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-[20px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {description ? <Dialog.Description className="text-[14px] text-ink-2">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close aria-label="Close" className="-me-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:text-ink">
              <X size={16} strokeWidth={2.2} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-2">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Pop({ trigger, children, align = "start", className, open, onOpenChange }: {
  trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; className?: string;
  open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={12}
          className={cn("animate-in z-50 rounded-[14px] bg-surface p-2 shadow-[var(--shadow-pop)] outline-none dark:border dark:border-line", className)}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const PopClose = Popover.Close;

export function Menu({ trigger, children, align = "end" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={12}
          className="animate-in z-50 min-w-[200px] rounded-[14px] bg-surface p-1.5 shadow-[var(--shadow-pop)] outline-none dark:border dark:border-line">
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled }: {
  children: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item disabled={disabled} onSelect={onSelect}
      className={cn("flex h-9 cursor-default select-none items-center gap-2.5 rounded-[9px] px-2.5 text-[14px] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40", danger ? "text-kerf" : "text-ink")}>
      <span className="w-4 text-ink-2">{icon}</span>
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} collisionPadding={8}
          className="animate-in z-50 max-w-[280px] rounded-[10px] bg-ink px-2.5 py-1.5 text-[12px] leading-snug text-surface shadow-[var(--shadow-pop)]">
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TipProvider = Tooltip.Provider;
