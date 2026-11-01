"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, LayoutTemplate, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Switch, TextArea, TextInput } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator, Sheet } from "@/components/ui/overlay";
import { api, unwrap } from "@/lib/api/client";
import { saveFirst, useEditor } from "@/lib/editor";
import { qk, useProjectAction } from "@/lib/queries";
import { toast } from "@/lib/toast";

export function MoreMenu({ owner, onTemplate }: { owner: boolean; onTemplate: () => void }) {
  const project = useEditor((s) => s.project);
  const act = useProjectAction();
  const router = useRouter();
  const t = useTranslations("project.more");
  if (!project) return null;
  return (
    <Menu trigger={<IconButton label={t("more")} size="sm"><MoreHorizontal size={18} /></IconButton>}>
      <MenuItem icon={<Copy size={15} />} onSelect={async () => {
        try { await saveFirst(); } catch (e) { toast.error((e as Error).message); return; }
        act.duplicate.mutate(project.id, { onSuccess: (p) => { toast.info(t("duplicated")); router.push(`/projects/${p!.id}/build`); } });
      }}>{t("duplicate")}</MenuItem>
      <MenuItem icon={<LayoutTemplate size={15} />} onSelect={onTemplate}>{t("saveAsTemplate")}</MenuItem>
      {owner ? <>
        <MenuSeparator />
        <MenuItem icon={<Archive size={15} />} onSelect={() => act.archive.mutate({ id: project.id, archived: true }, {
          onSuccess: () => { toast.info(t("archived", { name: project.name })); router.push("/"); },
        })}>{t("archive")}</MenuItem>
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
  const t = useTranslations("project.more");
  if (!project) return null;
  const save = async () => {
    setBusy(true);
    try {
      await saveFirst();
      await unwrap(api.POST("/api/projects/{project_id}/template", { params: { path: { project_id: project.id } }, body: { title: title.trim() || project.name, summary, category: "", public: pub } }));
      void qc.invalidateQueries({ queryKey: qk.templates });
      toast.info(t("savedTemplate"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("templateFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={t("saveAsTemplate")} description={t("templateText")}
      footer={<><Button variant="plain" onClick={onClose}>{t("cancel")}</Button><Button variant="primary" loading={busy} onClick={save}>{t("saveTemplate")}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label={t("title")} htmlFor="tt"><TextInput id="tt" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={t("summary")} htmlFor="ts"><TextArea id="ts" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t("summaryHint")} /></Field>
        {admin ? <Switch label={t("shareAll")} description={t("shareAllText")} checked={pub} onChange={setPub} /> : null}
      </div>
    </Sheet>
  );
}
