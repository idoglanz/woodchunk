"use client";

import { ChevronDown } from "lucide-react";
import { StatusPill } from "@/components/ui/misc";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlay";
import { useProjectCtx } from "@/components/project/context";
import type { Project } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { useProjectAction } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function useSetStatus() {
  const act = useProjectAction();
  const { id } = useProjectCtx();
  return {
    pending: act.status.isPending,
    set: async (status: Project["status"], message?: string) => {
      await useEditor.getState().flush();
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
      <button type="button" className="inline-flex items-center gap-1 rounded-full" aria-label="Project status">
        <StatusPill status={status} className="pe-1.5" />
        <ChevronDown size={14} className="-ms-2 me-1 text-ink-3" />
      </button>
    }>
      {status === "planning" ? (
        <MenuItem disabled={blocked} onSelect={() => s.set("bought", "Marked as bought. Prices are locked in.")}>
          Mark as bought{blocked ? " (fix parts first)" : ""}
        </MenuItem>
      ) : null}
      {status === "bought" ? <>
        <MenuItem onSelect={() => s.set("cut", "Marked as cut. Leftovers are in your workshop.")}>Mark as cut</MenuItem>
        <MenuItem onSelect={() => s.set("bought", "Extra stock marked as bought.")}>Mark extra stock as bought</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => s.set("planning")}>Back to planning</MenuItem>
      </> : null}
      {status === "cut" ? <MenuItem onSelect={() => s.set("done", "Nice build. The project is now read-only.")}>Mark as done</MenuItem> : null}
      {status === "done" ? <MenuItem onSelect={() => s.set("cut")}>Reopen</MenuItem> : null}
    </Menu>
  );
}
