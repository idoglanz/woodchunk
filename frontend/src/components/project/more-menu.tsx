"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, LayoutTemplate, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Switch, TextArea, TextInput } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator, Sheet } from "@/components/ui/overlay";
import { api, unwrap } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { qk, useProjectAction } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function MoreMenu({ owner, onTemplate }: { owner: boolean; onTemplate: () => void }) {
  const project = useEditor((s) => s.project);
  const act = useProjectAction();
  const router = useRouter();
  if (!project) return null;
  return (
    <Menu trigger={<IconButton label="More" size="sm"><MoreHorizontal size={18} /></IconButton>}>
      <MenuItem icon={<Copy size={15} />} onSelect={async () => {
        await useEditor.getState().flush();
        act.duplicate.mutate(project.id, { onSuccess: (p) => { toast.info("Duplicated"); router.push(`/projects/${p!.id}/build`); } });
      }}>Duplicate</MenuItem>
      <MenuItem icon={<LayoutTemplate size={15} />} onSelect={onTemplate}>Save as template</MenuItem>
      {owner ? <>
        <MenuSeparator />
        <MenuItem icon={<Archive size={15} />} onSelect={() => act.archive.mutate({ id: project.id, archived: true }, {
          onSuccess: () => { toast.info(`Archived ${project.name}`); router.push("/"); },
        })}>Archive</MenuItem>
      </> : null}
    </Menu>
  );
}

export function TemplateSheet({ onClose, admin }: { onClose: () => void; admin: boolean }) {
  const project = useEditor((s) => s.project);
  const [title, setTitle] = useState(project?.name ?? "");
  const [summary, setSummary] = useState(project?.description ?? "");
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  if (!project) return null;
  const save = async () => {
    setBusy(true);
    try {
      await useEditor.getState().flush();
      await unwrap(api.POST("/api/projects/{project_id}/template", { params: { path: { project_id: project.id } }, body: { title: title.trim() || project.name, summary, category: "", public: pub } }));
      void qc.invalidateQueries({ queryKey: qk.templates });
      toast.info("Saved as a template");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Save as template" description="A copy of this design you can start new projects from. Later changes to this project don't affect it."
      footer={<><Button variant="plain" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save template</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="tt"><TextInput id="tt" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Summary" htmlFor="ts"><TextArea id="ts" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What it is, main sizes and materials." /></Field>
        {admin ? <Switch label="Share with everyone" description="Public templates appear for all users." checked={pub} onChange={setPub} /> : null}
      </div>
    </Sheet>
  );
}
