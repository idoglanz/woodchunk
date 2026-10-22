"use client";

import { ArrowRight, FilePlus2, LayoutTemplate, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { useAIStatus, useCreateProject } from "@/lib/queries";

const EXAMPLES = [
  "Workbench 180 × 80, 90 cm high, 44 × 100 frame and a birch plywood top",
  "Raised garden bed 2 m × 1 m, 40 cm high, treated boards",
  "ספרייה ברוחב 80 ס״מ וגובה 180 ס״מ עם 5 מדפים",
];

export const PENDING_PROMPT_KEY = "wc.pendingPrompt";

export function NewProjectSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = useState<"describe" | "blank">("describe");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const create = useCreateProject();
  const ai = useAIStatus();
  const router = useRouter();
  const aiOff = ai.data && !ai.data.enabled;

  const start = () => {
    if (mode === "describe") {
      const prompt = text.trim();
      if (!prompt) return;
      const title = prompt.split(/[,.\n]/)[0].slice(0, 60) || "New build";
      create.mutate({ name: title }, {
        onSuccess: (p) => {
          try { sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ id: p.id, prompt })); } catch {}
          onOpenChange(false);
          router.push(`/projects/${p.id}/design?ask=1`);
        },
      });
    } else {
      create.mutate({ name: name.trim() || "Untitled project" }, {
        onSuccess: (p) => { onOpenChange(false); router.push(`/projects/${p.id}/design`); },
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New project"
      footer={<>
        <Button variant="plain" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={create.isPending} disabled={mode === "describe" && (!text.trim() || !!aiOff)} onClick={start}>
          {mode === "describe" ? "Plan it" : "Create"}
        </Button>
      </>}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-2">
          <Choice active={mode === "describe"} onClick={() => setMode("describe")} icon={<Sparkles size={18} />} title="Describe it" />
          <Link href="/templates" onClick={() => onOpenChange(false)}
            className="flex flex-col items-start gap-2 rounded-[14px] bg-surface-2 p-3.5 text-start transition-colors hover:bg-surface-3">
            <LayoutTemplate size={18} className="text-ink-2" />
            <span className="flex items-center gap-1 text-[14px] font-semibold">Template <ArrowRight size={13} /></span>
          </Link>
          <Choice active={mode === "blank"} onClick={() => setMode("blank")} icon={<FilePlus2 size={18} />} title="Blank" />
        </div>
        {mode === "describe" ? (
          <div className="flex flex-col gap-3">
            <Field label="What are you building?" htmlFor="describe"
              hint={aiOff ? "The AI assistant isn't set up on this server. Start blank instead." : "Sizes, materials, how many. English or Hebrew."}>
              <TextArea id="describe" dir="auto" autoFocus value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start(); }}
                placeholder="e.g. Two sawhorses, 75 cm high, from 44 × 100 lumber" className="min-h-28" />
            </Field>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" dir="auto" onClick={() => setText(ex)}
                  className="rounded-full bg-surface-2 px-3 py-1.5 text-start text-[13px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Field label="Name" htmlFor="pname">
            <TextInput id="pname" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Garden table"
              onKeyDown={(e) => { if (e.key === "Enter") start(); }} />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function Choice({ active, onClick, icon, title }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("flex flex-col items-start gap-2 rounded-[14px] p-3.5 text-start transition-colors",
        active ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]" : "bg-surface-2 hover:bg-surface-3")}>
      <span className={active ? "text-ink" : "text-ink-2"}>{icon}</span>
      <span className="text-[14px] font-semibold">{title}</span>
    </button>
  );
}
