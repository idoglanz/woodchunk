"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button, IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { api, unwrap, type Project, type Schemas } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { useRelativeTime } from "@/lib/format";
import { dateLocale } from "@/lib/lang";
import { qk, useMe } from "@/lib/queries";
import { toast } from "@/lib/toast";

type Role = "editor" | "viewer";
const ROLE_LABEL = { owner: "owner", editor: "canEdit", viewer: "canView" } as const;
const linkUrl = (token: string) => `${window.location.origin}/join/${token}`;

/**
 * Who's in the project. The owner invites people (a link per access level), sees and revokes the
 * links still out there, and changes or removes someone's access; everyone else can leave.
 */
export function ShareSheet({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const ago = useRelativeTime();
  const t = useTranslations("project.share");
  const lang = useLocale();
  const me = useMe();
  const owner = project.members.find((m) => m.role === "owner");
  const isOwner = !!me.data && (owner?.user_id === me.data.id || me.data.role === "admin");
  const qc = useQueryClient();
  const router = useRouter();
  const invitesKey = ["invites", project.id] as const;
  const invites = useQuery({
    queryKey: invitesKey, enabled: open && isOwner,
    queryFn: () => unwrap<Schemas["InviteLink"][]>(api.GET("/api/projects/{project_id}/invites", { params: { path: { project_id: project.id } } })),
  });
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); // the link just made, shown to copy by hand too

  // Only who's in the project changed: the content (and any unsaved edits) stays as it is.
  const updated = (p: Project) => {
    useEditor.getState().membersUpdate(p);
    qc.setQueryData<Project>(qk.project(p.id), (old) => (old ? { ...old, members: p.members } : p));
  };
  // Some browsers refuse the clipboard after a network wait: then the link is on screen to copy.
  const copy = (token: string) => navigator.clipboard.writeText(linkUrl(token))
    .then(() => toast.info(t("linkCopied")))
    .catch(() => toast.info(t("copyBelow")));

  const makeLink = async () => {
    setBusy(true);
    try {
      const inv = await unwrap<{ token: string }>(api.POST("/api/projects/{project_id}/invites", { params: { path: { project_id: project.id } }, body: { role } }));
      setFresh(linkUrl(inv.token));
      await qc.invalidateQueries({ queryKey: invitesKey });
      await copy(inv.token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inviteId: string) => {
    const r = await api.DELETE("/api/projects/{project_id}/invites/{invite_id}", { params: { path: { project_id: project.id, invite_id: inviteId } } });
    if (!r.response.ok) toast.error(t("revokeFailed"));
    void qc.invalidateQueries({ queryKey: invitesKey });
  };

  const setAccess = async (userId: string, next: Role) => {
    try {
      updated(await unwrap<Project>(api.PUT("/api/projects/{project_id}/members/{member_id}", {
        params: { path: { project_id: project.id, member_id: userId } }, body: { role: next } })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("accessFailed"));
    }
  };

  const remove = async (userId: string) => {
    const leaving = userId === me.data?.id;
    try {
      const p = await unwrap<Project>(api.DELETE("/api/projects/{project_id}/members/{member_id}", { params: { path: { project_id: project.id, member_id: userId } } }));
      if (leaving) {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        toast.info(t("left", { name: project.name }));
        router.push("/");
        return;
      }
      updated(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : leaving ? t("leaveFailed") : t("removeFailed"));
    }
  };

  const links = invites.data ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={isOwner ? t("titleOwner") : t("people")}
      description={isOwner ? t("ownerText") : t("sharedBy", { name: owner?.name || owner?.email || t("theOwner") })}>
      <div className="flex flex-col gap-7">
        {isOwner ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented label={t("newLinkAccess")} value={role} onChange={(v) => { setRole(v); setFresh(null); }}
                options={[{ value: "editor", label: t("canEdit") }, { value: "viewer", label: t("canView") }]} />
              <Button variant="primary" icon={<Link2 size={16} />} loading={busy} onClick={makeLink}>{t("createLink")}</Button>
            </div>
            {fresh ? (
              <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 ps-3">
                <input readOnly value={fresh} aria-label={t("newLink")} onFocus={(e) => e.target.select()}
                  className="h-8 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none" />
                <Button size="sm" icon={<Copy size={14} />} onClick={() => copy(fresh.slice(fresh.lastIndexOf("/") + 1))}>{t("copy")}</Button>
              </div>
            ) : null}
            {links.length ? (
              <ul className="flex flex-col rounded-xl bg-surface-2 px-3">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[14px] font-medium">{t("roleLink", { role: l.role })}</span>
                      <span className="text-[12px] text-ink-2">
                        {t("linkMeta", { ago: ago(l.created_at), joined: l.joined ? t("joined", { n: l.joined }) : t("nobodyJoined"),
                          date: new Date(l.expires_at).toLocaleDateString(lang === "en" ? undefined : dateLocale(lang)) })}
                      </span>
                    </div>
                    <IconButton label={t("copyLink")} size="sm" onClick={() => copy(l.token)}><Copy size={15} /></IconButton>
                    <Button size="sm" variant="plain" onClick={() => revoke(l.id)}>{t("revoke")}</Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col">
          <h3 className="mb-1 text-[13px] font-semibold text-ink-2">{t("people")}</h3>
          {project.members.map((m) => {
            const self = m.user_id === me.data?.id;
            return (
              <div key={m.user_id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px]">{m.name || m.email}{self ? <span className="text-ink-3"> {t("you")}</span> : null}</span>
                  {m.name && m.email ? <span className="truncate text-[12px] text-ink-3"><bdi>{m.email}</bdi></span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isOwner && m.role !== "owner" ? <>
                    <Select aria-label={t("accessFor", { name: m.name || m.email })} value={m.role} onChange={(e) => setAccess(m.user_id, e.target.value as Role)}
                      className="h-8 w-auto text-[13px]">
                      <option value="editor">{t("canEdit")}</option>
                      <option value="viewer">{t("canView")}</option>
                    </Select>
                    <Button size="sm" variant="plain" onClick={() => remove(m.user_id)}>{t("remove")}</Button>
                  </> : <span className="text-[13px] text-ink-2">{t(ROLE_LABEL[m.role])}</span>}
                </div>
              </div>
            );
          })}
        </section>

        <p className="text-[12px] leading-relaxed text-ink-3">
          {isOwner ? t("inventoryOwner") : t("inventoryOther", { name: owner?.name || t("theOwnerLower") })}
        </p>

        {!isOwner && project.members.some((m) => m.user_id === me.data?.id) ? (
          <Button variant="destructive" className="self-start" onClick={() => remove(me.data!.id)}>{t("leave")}</Button>
        ) : null}
      </div>
    </Sheet>
  );
}
