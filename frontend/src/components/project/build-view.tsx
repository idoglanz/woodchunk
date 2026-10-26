"use client";

import { ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AIPanel } from "@/components/project/ai-panel";
import { useProjectCtx } from "@/components/project/context";
import { CuttingSettingsButton } from "@/components/project/cutting-settings";
import { DesignView } from "@/components/project/design-view";
import { PlanContent, PlanSummary } from "@/components/project/plan-view";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { revealPart, useMediaQuery, usePartFocus } from "@/lib/focus";

/**
 * Parts and the cutting plan on one screen. Desktop: parts on the left, the live layout in a
 * sticky panel on the right (or full width). Phones and tablets: parts, with the layout in a
 * bottom drawer that peeks with the totals.
 */
export function BuildView() {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const { aiOpen, closeAI, units, plan } = useProjectCtx();
  const [wide, setWide] = useState(false);

  const pick = (partId: string) => {
    setWide(false);
    usePartFocus.getState().setFocused(partId);
    requestAnimationFrame(() => revealPart(partId));
  };
  const firstIssue = () => { const u = plan?.unplaced[0]; if (u) pick(u.part_id); };

  if (!desktop) {
    return (
      <>
        <DesignView />
        {!aiOpen ? <PlanDrawer onPick={pick} onIssues={firstIssue} /> : null}
      </>
    );
  }

  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PlanSummary onIssues={firstIssue} />
          <div className="flex items-center gap-2">
            <CuttingSettingsButton units={units} />
            <Button size="sm" icon={<Minimize2 size={15} />} onClick={() => setWide(false)}>Show parts</Button>
          </div>
        </div>
        <PlanContent wide onPick={pick} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(360px,38%)] items-start gap-6">
      <DesignView />
      <div role={aiOpen ? undefined : "complementary"} aria-label={aiOpen ? undefined : "Cutting plan"}
        className={cn("sticky top-[68px] flex flex-col overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-card)] dark:border dark:border-line",
          aiOpen ? "h-[calc(100dvh-84px)]" : "max-h-[calc(100dvh-84px)]")}>
        {aiOpen ? <AIPanel embedded onClose={closeAI} /> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
              <PlanSummary onIssues={firstIssue} />
              <div className="ms-auto flex items-center gap-1">
                <CuttingSettingsButton units={units} />
                <IconButton label="Full width" size="sm" onClick={() => setWide(true)}><Maximize2 size={16} /></IconButton>
              </div>
            </div>
            <PanelScroller onPick={pick} />
          </>
        )}
      </div>
    </div>
  );
}

/** Keeps the focused part's pieces in view while you edit it. */
function PanelScroller({ onPick }: { onPick: (partId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = usePartFocus((s) => s.focused);
  const { plan } = useProjectCtx();
  useEffect(() => {
    const sc = ref.current;
    if (!sc || !focused) return;
    const piece = sc.querySelector(`[data-part="${CSS.escape(focused)}"]`);
    if (!piece) return;
    const r = piece.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    if (r.top < s.top + 24 || r.bottom > s.bottom - 24) sc.scrollBy({ top: r.top - s.top - s.height / 3, behavior: "smooth" });
  }, [focused, plan]);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <PlanContent onPick={onPick} />
    </div>
  );
}

const PEEK = 64;

function PlanDrawer({ onPick, onIssues }: { onPick: (partId: string) => void; onIssues: () => void }) {
  const { units } = useProjectCtx();
  const [height, setHeight] = useState(PEEK);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const open = height > PEEK + 8;

  // Room above the phone tab bar (see BottomNav).
  const top = () => window.innerHeight - 72 - (window.innerWidth < 640 ? 56 : 0);
  const snaps = () => [PEEK, Math.round(window.innerHeight * 0.55), top()];
  const snapTo = (h: number) => {
    const s = snaps();
    setHeight(s.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a)));
  };

  const onDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, h: height, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    setHeight(Math.max(PEEK, Math.min(top(), d.h + dy)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved) setHeight(open ? PEEK : snaps()[1]);
    else snapTo(height);
  };

  const pick = (partId: string) => { setHeight(PEEK); onPick(partId); };

  return (
    <div role="region" aria-label="Cutting plan"
      className={cn("no-print fixed inset-x-0 z-30 flex flex-col rounded-t-[20px] border-t border-line bg-surface shadow-[var(--shadow-pop)]",
        !dragging && "transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]")}
      style={{ bottom: "var(--bottom-nav, 0px)", height: `calc(${height}px + var(--bottom-safe, env(safe-area-inset-bottom)))` }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        className="flex shrink-0 cursor-grab touch-none select-none flex-col px-4 pb-2 pt-2" style={{ height: PEEK }}>
        <span aria-hidden="true" className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-line-strong" />
        <div className="flex min-w-0 items-center justify-between gap-3">
          <PlanSummary compact onIssues={() => { setHeight(PEEK); onIssues(); }} />
          <button type="button" onClick={() => setHeight(open ? PEEK : snaps()[1])} aria-expanded={open} aria-label={open ? "Hide cutting plan" : "Show cutting plan"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
            <ChevronUp size={18} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(16px,var(--bottom-safe,env(safe-area-inset-bottom)))]", !open && "invisible")}>
        <div className="flex justify-end pb-3"><CuttingSettingsButton units={units} /></div>
        <PlanContent onPick={pick} />
      </div>
    </div>
  );
}
