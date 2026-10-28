"use client";

import { Copy, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { ItemPicker, rememberMaterial } from "@/components/project/material-picker";
import { Button, IconButton } from "@/components/ui/button";
import type { CatalogItem, ProjectContent } from "@/lib/api/client";
import { newId, useEditor } from "@/lib/editor";
import { plural } from "@/lib/format";
import { usePartSelection } from "@/lib/selection";
import { toast } from "@/lib/toast";
import { isTyping } from "@/lib/typing";

/** Parts that can be selected, in page order: drawn (3D frame) assemblies' parts come from the frame. */
export function selectableParts(content: ProjectContent | null): string[] {
  return (content?.assemblies ?? []).filter((a) => !a.frame).flatMap((a) => a.parts.map((p) => p.id));
}

/**
 * The selected parts' actions, floating at the bottom: change their material, duplicate them (the
 * copies go right after each original and become the selection) or delete them. Each is one undo
 * step. Esc clears the selection; Delete removes the parts when you're not typing.
 */
export function SelectionBar({ items, byId }: { items: CatalogItem[]; byId: Map<string, CatalogItem> }) {
  const ids = usePartSelection((s) => s.ids);
  const content = useEditor((s) => s.content);
  const edit = useEditor((s) => s.edit);
  const readOnly = useEditor((s) => s.readOnly);

  // Parts that went away (undo, someone else's edit) leave the selection; read-only clears it.
  useEffect(() => {
    const live = new Set(selectableParts(content));
    const kept = ids.filter((id) => live.has(id));
    if (readOnly) { if (ids.length) usePartSelection.getState().clear(); }
    else if (kept.length !== ids.length) usePartSelection.getState().set(kept);
  }, [content, ids, readOnly]);
  useEffect(() => () => usePartSelection.getState().clear(), []);

  const selected = new Set(ids);
  const parts = (content?.assemblies ?? []).flatMap((a) => a.parts.filter((p) => selected.has(p.id)));
  const common = parts.length && parts.every((p) => p.item_id === parts[0].item_id) ? parts[0].item_id : null;

  const setMaterial = (itemId: string) => {
    rememberMaterial(itemId);
    const sheet = byId.get(itemId)?.kind === "sheet";
    edit((d) => {
      for (const a of d.assemblies) for (const p of a.parts) {
        if (!selected.has(p.id)) continue;
        p.item_id = itemId;
        if (!sheet) { p.width_mm = null; p.grain_locked = false; }
      }
    });
    toast.info(`Changed the material of ${plural(parts.length, "part")}`, { label: "Undo", run: () => useEditor.getState().undo() });
  };

  const duplicate = () => {
    const copies: string[] = [];
    edit((d) => {
      for (const a of d.assemblies) {
        a.parts = a.parts.flatMap((p) => {
          if (!selected.has(p.id)) return [p];
          const copy = { ...structuredClone(p), id: newId(), sketch: null }; // copies don't follow the sketch
          copies.push(copy.id);
          return [p, copy];
        });
      }
    });
    usePartSelection.getState().set(copies);
    toast.info(`Duplicated ${plural(copies.length, "part")}: the copies are selected`, { label: "Undo", run: () => useEditor.getState().undo() });
  };

  const remove = () => {
    const n = parts.length;
    edit((d) => { for (const a of d.assemblies) a.parts = a.parts.filter((p) => !selected.has(p.id)); });
    usePartSelection.getState().clear();
    toast.info(`Deleted ${plural(n, "part")}`, { label: "Undo", run: () => useEditor.getState().undo() });
  };

  useEffect(() => {
    if (!ids.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { usePartSelection.getState().clear(); e.preventDefault(); }
      // Delete only from the page or a part's select toggle, never another focused button.
      else if ((e.key === "Delete" || e.key === "Backspace") && onPageOrToggle(e.target)) { remove(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ids.length || readOnly) return null;
  return (
    <>
      {/* Room at the end of the page, so the bar doesn't cover the last row. */}
      <div aria-hidden="true" className="h-16 lg:hidden" />
      <div role="toolbar" aria-label="Selected parts"
        className="no-print animate-sheet fixed inset-x-3 z-[29] mx-auto flex max-w-[560px] items-center gap-1.5 rounded-2xl bg-surface p-1.5 ps-3 shadow-[var(--shadow-pop)] dark:border dark:border-line bottom-[calc(var(--bottom-nav,0px)_+_76px)] lg:bottom-6">
        <span className="tnum shrink-0 text-[14px] font-semibold">{parts.length} <span className="hidden font-normal text-ink-2 sm:inline">selected</span></span>
        <div className="min-w-0 flex-1">
          <ItemPicker items={items} value={common} kinds={["lumber", "sheet"]} ariaLabel="Material for the selected parts" placeholder="Change material"
            className="h-9 bg-surface-2" onChange={(id) => { if (id) setMaterial(id); }} />
        </div>
        <Button size="sm" variant="ghost" icon={<Copy size={15} />} onClick={duplicate} aria-label="Duplicate the selected parts">
          <span className="hidden sm:inline">Duplicate</span>
        </Button>
        <Button size="sm" variant="destructive" icon={<Trash2 size={15} />} onClick={remove} aria-label="Delete the selected parts">
          <span className="hidden sm:inline">Delete</span>
        </Button>
        <IconButton label="Clear the selection (Esc)" size="sm" onClick={() => usePartSelection.getState().clear()}><X size={16} /></IconButton>
      </div>
    </>
  );
}

function onPageOrToggle(target: EventTarget | null): boolean {
  if (!target || target === document.body || target === document.documentElement) return true;
  return target instanceof HTMLElement && !!target.closest("[data-part-toggle]");
}
