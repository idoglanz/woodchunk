"use client";

import { ChevronDown } from "lucide-react";
import { StatusPill } from "@/components/ui/misc";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlay";
import { useProjectCtx } from "@/components/project/context";
import type { Project } from "@/lib/api/client";
import { saveFirst, useEditor } from "@/lib/editor";
import { useProjectAction } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function useSetStatus() {
  const act = useProjectAction();
  const { id } = useProjectCtx();
  return {
    pending: act.status.isPending,
    set: async (status: Project["status"], message?: string) => {
      try { await saveFirst(); } catch (e) { toast.error((e as Error).message); return; }
      act.status.mutate({ id, status }, {
        onSuccess: (p) => { useEditor.getState().serverUpdate(p); if (message) toast.info(message); },
      });
    },
  };
}

export function StatusMenu() {
  const status = useEditor((s) => s.project?.status ?? "planning");
  const role = useEditor((s) => s.project?.members);
  const { plan, me } = useProjectCtx();
  const s = useSetStatus();
  const canEdit = !!me && (me.role === "admin" || role?.some((m) => m.user_id === me.id && m.role !== "viewer"));
  if (!canEdit) return <StatusPill status={status} />;
  const blocked = !!plan?.unplaced.length;
  return (
    <Menu align="start" trigger={
      <button type="button" className="group rounded-full" aria-label="Project status">
        <StatusPill status={status} className="h-7 gap-1.5 pe-2 transition-colors group-hover:bg-surface-3 group-hover:text-ink">
          <ChevronDown size={13} className="text-ink-3" />
        </StatusPill>
      </button>
    }>
      {status === "planning" ? (
        <MenuItem disabled={blocked} onSelect={() => s.set("bought", "Marked as bought. Prices are locked in.")}>
          Mark as bought{blocked ? " (fix parts first)" : ""}
        </MenuItem>
      ) : null}
      {status === "bought" ? <>
        <MenuItem onSelect={() => s.set("cut", "Marked as cut. Leftovers are in your inventory.")}>Mark as cut</MenuItem>
        <MenuItem onSelect={() => s.set("bought", "Extra stock marked as bought.")}>Mark extra stock as bought</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => s.set("planning")}>Back to planning</MenuItem>
      </> : null}
      {status === "cut" ? <MenuItem onSelect={() => s.set("done", "Nice build. The project is now read-only.")}>Mark as done</MenuItem> : null}
      {status === "done" ? <MenuItem onSelect={() => s.set("cut")}>Reopen</MenuItem> : null}
    </Menu>
  );
}
