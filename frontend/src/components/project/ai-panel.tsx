"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Paperclip, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { PENDING_PROMPT_KEY } from "@/components/home/new-project";
import { useProjectCtx } from "@/components/project/context";
import { Button, IconButton, Spinner } from "@/components/ui/button";
import { api, postForm, unwrap, type Conversation, type Project, type Proposal } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { saveFirst, useEditor } from "@/lib/editor";
import { money } from "@/lib/format";
import { qk, useAIStatus, useConversation } from "@/lib/queries";
import { toast } from "@/lib/toast";

const IDEAS = ["idea1", "idea2", "idea3", "idea4"] as const;

/** `embedded` fills the Build tab's side panel; otherwise it's a sidebar (desktop) or full screen (phone). */
export function AIPanel({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  const { id, readOnly } = useProjectCtx();
  const convo = useConversation(id);
  const ai = useAIStatus();
  const qc = useQueryClient();
  const t = useTranslations("project.ai");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoSent = useRef(false);

  const messages = convo.data?.messages ?? [];
  const proposals = new Map((convo.data?.proposals ?? []).map((p) => [p.id, p]));

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(m);
    setText("");
    try {
      await saveFirst();
      const c = await unwrap<Conversation>(api.POST("/api/ai/projects/{project_id}/chat", { params: { path: { project_id: id } }, body: { message: m } }));
      qc.setQueryData(qk.conversation(id), c);
      void qc.invalidateQueries({ queryKey: qk.aiStatus });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("noAnswer"));
      setText(m);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (autoSent.current || !convo.data) return;
    try {
      const raw = sessionStorage.getItem(PENDING_PROMPT_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw) as { id: string; prompt: string };
      if (pending.id !== id) return;
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
      autoSent.current = true;
      queueMicrotask(() => void send(pending.prompt));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo.data, id]);

  const importFile = async (file: File) => {
    setBusy(t("importing", { name: file.name }));
    try {
      await saveFirst();
      const form = new FormData();
      form.append("file", file);
      const c = await postForm<Conversation>(`/api/ai/projects/${id}/import`, form);
      qc.setQueryData(qk.conversation(id), c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("importFailed"));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    await api.DELETE("/api/ai/projects/{project_id}/conversation", { params: { path: { project_id: id } } });
    void qc.invalidateQueries({ queryKey: qk.conversation(id) });
  };

  const disabled = readOnly || ai.data?.enabled === false;

  return (
    <aside aria-label={t("title")}
      className={cn("no-print animate-slide flex flex-col bg-surface", embedded ? "h-full min-h-0"
        : "fixed inset-0 z-40 md:sticky md:inset-auto md:top-[52px] md:z-auto md:h-[calc(100dvh-52px)] md:w-[400px] md:shrink-0 md:border-s md:border-line")}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink"><Sparkles size={15} /></span>
          <span className="text-[16px] font-semibold">{t("title")}</span>
        </div>
        <div className="flex items-center">
          {messages.length ? <IconButton label={t("startOver")} size="sm" onClick={clear}><RotateCcw size={15} /></IconButton> : null}
          <IconButton label={t("close")} size="sm" onClick={onClose}><X size={18} /></IconButton>
        </div>
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {!messages.length && !busy ? (
          <div className="flex flex-col gap-4 pt-2">
            <p className="text-[15px] text-ink-2">{t("intro")}</p>
            <div className="flex flex-col gap-2">
              {IDEAS.map((k) => t(k)).map((i) => (
                <button key={i} type="button" dir="auto" disabled={disabled} onClick={() => send(i)}
                  className="rounded-xl bg-surface-2 px-3 py-2.5 text-start text-[14px] text-ink transition-colors hover:bg-surface-3 disabled:opacity-50">{i}</button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
            <p dir="auto" className={cn("max-w-[92%] whitespace-pre-wrap rounded-[18px] px-3.5 py-2 text-[15px] leading-snug",
              m.role === "user" ? "rounded-ee-md bg-accent text-accent-ink" : "rounded-es-md bg-surface-2 text-ink")}>{m.text}</p>
            {m.proposal_id && proposals.get(m.proposal_id) ? <ProposalCard p={proposals.get(m.proposal_id)!} /> : null}
          </div>
        ))}
        {busy ? (
          <div className="flex flex-col items-end gap-2">
            <p dir="auto" className="max-w-[92%] rounded-[18px] rounded-ee-md bg-accent px-3.5 py-2 text-[15px] text-accent-ink">{busy}</p>
            <div className="flex items-center gap-2 self-start rounded-[18px] bg-surface-2 px-3.5 py-2.5 text-[14px] text-ink-2"><Spinner className="h-3.5 w-3.5" />{t("working")}</div>
          </div>
        ) : null}
      </div>

      <form className="flex flex-col gap-2 border-t border-line px-3 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        {ai.data?.enabled === false ? <p className="px-1 text-[13px] text-warn">{t("notSetUp")}</p> : null}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          <IconButton label={t("import")} disabled={disabled || !!busy} onClick={() => fileRef.current?.click()}><Paperclip size={18} /></IconButton>
          <label htmlFor="ask-input" className="sr-only">{t("message")}</label>
          <textarea id="ask-input" dir="auto" rows={1} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
            placeholder={t("placeholder")}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] bg-surface-2 px-4 py-2.5 text-[15px] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--accent)]" />
          <IconButton label={t("send")} type="submit" variant="primary" className="rounded-full" disabled={disabled || !text.trim() || !!busy}><ArrowUp size={19} strokeWidth={2.4} /></IconButton>
        </div>
      </form>
    </aside>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const { id } = useProjectCtx();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const t = useTranslations("project.ai");
  const delta = (p.cost_after ?? 0) - (p.cost_before ?? 0);

  const act = async (what: "apply" | "discard") => {
    setBusy(true);
    try {
      await saveFirst();
      if (what === "apply") {
        const proj = await unwrap<Project>(api.POST("/api/ai/proposals/{proposal_id}/apply", { params: { path: { proposal_id: p.id } } }));
        useEditor.getState().serverUpdate(proj, true);
        qc.setQueryData(qk.project(proj.id), proj);
        toast.info(t("applied"), { label: t("undo"), run: () => useEditor.getState().undo() });
      } else {
        await unwrap(api.POST("/api/ai/proposals/{proposal_id}/discard", { params: { path: { proposal_id: p.id } } }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: qk.conversation(id) });
    }
  };

  const tone = { add: "text-ok", change: "text-warn", remove: "text-kerf", note: "text-ink-2" } as const;
  const sign = { add: "+", change: "~", remove: "−", note: "!" } as const;

  return (
    <div className="w-[92%] overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-[14px] font-semibold">{p.summary || t("suggested")}</span>
        {p.status !== "pending" ? <span className="text-[12px] font-medium text-ink-3">{p.status === "applied" ? t("applied") : p.status === "stale" ? t("outOfDate") : t("discarded")}</span> : null}
      </div>
      <ul className="flex flex-col gap-1 px-3.5 py-2.5">
        {p.diff.map((d, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug">
            <span className={cn("w-3 shrink-0 font-mono font-bold", tone[d.kind])}>{sign[d.kind]}</span>
            <span className={d.kind === "note" ? "text-ink-2" : "text-ink"}>{d.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5">
        <span className="tnum text-[13px] text-ink-2">
          {money(p.cost_before)} → <span className="font-semibold text-ink">{money(p.cost_after)}</span>
          <span className={cn("ms-1", delta > 0.005 ? "text-ink" : "text-ok")}>({delta >= 0 ? "+" : "−"}{money(Math.abs(delta)).replace("₪", "₪")})</span>
        </span>
        {p.status === "pending" ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="plain" disabled={busy} onClick={() => act("discard")}>{t("discard")}</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => act("apply")}>{t("apply")}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
