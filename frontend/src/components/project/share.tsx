"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, UserMinus } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { api, unwrap, type Project } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { qk } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function ShareSheet({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const makeLink = async () => {
    setBusy(true);
    try {
      const inv = await unwrap<{ token: string }>(api.POST("/api/projects/{project_id}/invites", { params: { path: { project_id: project.id } }, body: { role } }));
      const url = `${window.location.origin}/join/${inv.token}`;
      setLink(url);
      try { await navigator.clipboard.writeText(url); toast.info("Invite link copied"); } catch {}
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a link.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    try {
      const p = await unwrap<Project>(api.DELETE("/api/projects/{project_id}/members/{member_id}", { params: { path: { project_id: project.id, member_id: userId } } }));
      useEditor.getState().serverUpdate(p);
      qc.setQueryData(qk.project(p.id), p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove them.");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Share project" description="People with the link can join after signing in. Links expire in 14 days.">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Access" value={role} onChange={(v) => { setRole(v); setLink(null); }}
            options={[{ value: "editor", label: "Can edit" }, { value: "viewer", label: "Can view" }]} />
          <Button variant="primary" loading={busy} onClick={makeLink}>Create invite link</Button>
        </div>
        {link ? (
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 ps-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] select-all">{link}</span>
            <IconButton label="Copy link" size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.info("Copied")).catch(() => {})}><Copy size={15} /></IconButton>
          </div>
        ) : null}
        <div className="flex flex-col">
          <h3 className="mb-2 text-[13px] font-semibold text-ink-2">People</h3>
          {project.members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px]">{m.name || m.email}</span>
                <span className="text-[13px] text-ink-2">{m.role === "owner" ? "Owner" : m.role === "editor" ? "Can edit" : "Can view"}</span>
              </div>
              {m.role !== "owner" ? <IconButton label={`Remove ${m.name || m.email}`} size="sm" onClick={() => remove(m.user_id)}><UserMinus size={16} /></IconButton> : null}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
