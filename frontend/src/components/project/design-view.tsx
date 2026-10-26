"use client";

import { ArrowDown, ArrowUp, Box, Copy, LayoutTemplate, MoreHorizontal, Plus, Sparkles, Trash2, Unlink, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cutSummary } from "@/components/frame/cut-list";
import { TemplateDialog } from "@/components/frame/template-dialog";
import { useProjectCtx } from "@/components/project/context";
import { ItemPicker, rememberMaterial } from "@/components/project/material-picker";
import { Button, IconButton } from "@/components/ui/button";
import { LengthInput, NumberInput, QtyInput } from "@/components/ui/field";
import { AsmChip, Card, EmptyState } from "@/components/ui/misc";
import { Menu, MenuItem, MenuSeparator, Tip } from "@/components/ui/overlay";
import { Stepper } from "@/components/ui/stepper";
import type { Assembly, CatalogItem, HardwareLine, Part } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { newAssembly, newId, newPart, nextLetter, useEditor } from "@/lib/editor";
import { partRowId, useActivePart, usePartFocus } from "@/lib/focus";
import { money } from "@/lib/format";
import { deriveParts } from "@/lib/frame/parts";
import { useCatalog, useItemMap } from "@/lib/queries";

function useItems() {
  const q = useCatalog({});
  const items = useMemo(() => q.data ?? [], [q.data]);
  // Parts can use items the list hides (retired, or someone's suggestion): look those up by id.
  const content = useEditor((s) => s.content);
  const used = useMemo(() => (content ? [
    ...content.assemblies.flatMap((a) => [...a.parts.map((p) => p.item_id), ...a.hardware.map((h) => h.item_id),
      ...(a.frame?.members.map((m) => m.item_id) ?? [])]),
    ...content.extras.map((h) => h.item_id),
  ] : []), [content]);
  const byId = useItemMap(items, used);
  return { items, byId };
}

export function DesignView() {
  const content = useEditor((s) => s.content);
  const readOnly = useEditor((s) => s.readOnly);
  const edit = useEditor((s) => s.edit);
  const { openAI } = useProjectCtx();
  const { items, byId } = useItems();
  const [drawing, setDrawing] = useState(false);
  if (!content) return null;
  const frameDialog = drawing ? <TemplateDialog open={drawing} onOpenChange={setDrawing} /> : null;

  const addAssembly = () =>
    edit((d) => {
      d.assemblies.push(newAssembly({ letter: nextLetter(d.assemblies.map((a) => a.letter)), name: `Assembly ${d.assemblies.length + 1}` }));
    });

  if (!content.assemblies.length) {
    return (
      <Card>
        <EmptyState title="What are you building?"
          text="Add an assembly for each thing you're making (a table, two sawhorses…), then list the parts it's cut from."
          action={<div className="flex flex-wrap justify-center gap-2">
            {!readOnly ? <Button variant="primary" icon={<Sparkles size={16} />} onClick={openAI}>Describe it</Button> : null}
            {!readOnly ? <Button icon={<Plus size={16} />} onClick={addAssembly}>Add assembly</Button> : null}
            {!readOnly ? <Button icon={<Box size={16} />} onClick={() => setDrawing(true)}>Draw a frame</Button> : null}
            <Link href="/templates" className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-[15px] font-medium text-ink-2 hover:text-ink"><LayoutTemplate size={16} />Templates</Link>
          </div>} />
        {frameDialog}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {content.assemblies.map((a, i) => (
        <AssemblyCard key={a.id} a={a} index={i} count={content.assemblies.length} items={items} byId={byId} />
      ))}
      <ExtrasCard lines={content.extras} items={items} byId={byId} />
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={<Plus size={16} strokeWidth={2.4} />} onClick={addAssembly}>Add assembly</Button>
          <Button variant="ghost" icon={<Box size={16} />} onClick={() => setDrawing(true)}>Draw a frame in 3D</Button>
        </div>
      ) : null}
      {frameDialog}
    </div>
  );
}

function AssemblyCard({ a, index, count, items, byId }: { a: Assembly; index: number; count: number; items: CatalogItem[]; byId: Map<string, CatalogItem> }) {
  const edit = useEditor((s) => s.edit);
  const readOnly = useEditor((s) => s.readOnly);
  const { plan } = useProjectCtx();
  const unplaced = useMemo(() => new Map((plan?.unplaced ?? []).map((u) => [u.part_id, u.reason])), [plan]);
  const upd = (fn: (x: Assembly) => void, key?: string) => edit((d) => { const x = d.assemblies.find((y) => y.id === a.id); if (x) fn(x); }, key);
  const { id: projectId } = useProjectCtx();
  const [drawing, setDrawing] = useState(false);
  const drawn = !!a.frame;

  const addPart = () => upd((x) => {
    const last = x.parts[x.parts.length - 1];
    x.parts.push(newPart({ item_id: last?.item_id ?? null }));
  });

  const move = (dir: -1 | 1) => edit((d) => {
    const i = d.assemblies.findIndex((y) => y.id === a.id);
    const j = i + dir;
    if (j < 0 || j >= d.assemblies.length) return;
    [d.assemblies[i], d.assemblies[j]] = [d.assemblies[j], d.assemblies[i]];
  });

  return (
    <Card className="@container flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2 pt-4 sm:px-5">
        <AsmChip letter={a.letter} className="h-7 min-w-7 text-[13px]" />
        <InlineText value={a.name} placeholder="Assembly name" ariaLabel="Assembly name" readOnly={readOnly}
          onCommit={(v) => upd((x) => { x.name = v || "Assembly"; })} className="text-[17px] font-semibold" />
        <div className="ms-auto flex items-center gap-1">
          {readOnly ? <span className="tnum text-[15px] font-semibold text-ink-2">×{a.qty}</span> : (
            <Tip content="How many of this you're building. Multiplies its parts and hardware.">
              <span><Stepper label="assemblies" value={a.qty} onChange={(n) => upd((x) => { x.qty = n; }, `qty-${a.id}`)} /></span>
            </Tip>
          )}
          {!readOnly ? (
            <Menu trigger={<IconButton label="Assembly options" size="sm"><MoreHorizontal size={18} /></IconButton>}>
              <MenuItem icon={<Copy size={15} />} onSelect={() => edit((d) => {
                const src = d.assemblies.find((y) => y.id === a.id)!;
                const copy: Assembly = { ...structuredClone(src), id: newId(), letter: nextLetter(d.assemblies.map((y) => y.letter)), name: `${src.name} copy` };
                copy.parts = copy.parts.map((p) => ({ ...p, id: newId() }));
                copy.hardware = copy.hardware.map((h) => ({ ...h, id: newId() }));
                deriveParts(copy, byId);
                d.assemblies.splice(index + 1, 0, copy);
              })}>Duplicate</MenuItem>
              {drawn ? (
                <MenuItem icon={<Unlink size={15} />} onSelect={() => upd((x) => { x.frame = null; x.frame_warnings = []; x.parts = x.parts.map((pt) => ({ ...pt, id: newId(), members: [] })); })}>
                  Keep parts, remove 3D frame
                </MenuItem>
              ) : (
                <MenuItem icon={<Box size={15} />} onSelect={() => setDrawing(true)}>Design in 3D…</MenuItem>
              )}
              <MenuItem icon={<ArrowUp size={15} />} disabled={index === 0} onSelect={() => move(-1)}>Move up</MenuItem>
              <MenuItem icon={<ArrowDown size={15} />} disabled={index === count - 1} onSelect={() => move(1)}>Move down</MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => edit((d) => { d.assemblies = d.assemblies.filter((y) => y.id !== a.id); })}>Delete assembly</MenuItem>
            </Menu>
          ) : null}
        </div>
      </div>

      {drawing ? <TemplateDialog open={drawing} onOpenChange={setDrawing} assemblyId={a.id} /> : null}
      {drawn ? <DrawnParts a={a} byId={byId} projectId={projectId} /> : (
      <div className="px-2 sm:px-3">
        {a.parts.length ? (
          <div className={cn(ROW, "hidden px-2 pb-1 pt-1 text-[12px] font-medium text-ink-3 @2xl:grid")}>
            <span className="[grid-area:chip]">Label</span><span className="[grid-area:name] px-2">Part</span><span className="[grid-area:mat]">Material</span>
            <span className={cn(NUMS, "[grid-area:nums]")}><span className="text-end">Qty</span><span className="text-end">Length</span><span className="text-end">Width</span></span>
          </div>
        ) : null}
        <div className="flex flex-col">
          {a.parts.map((p, i) => (
            <PartRow key={p.id} a={a} p={p} label={`${a.letter}${i + 1}`} items={items} byId={byId} problem={unplaced.get(p.id)} />
          ))}
        </div>
        {!a.parts.length ? <p className="px-2 py-3 text-[14px] text-ink-2">No parts yet.</p> : null}
      </div>
      )}

      <HardwareList title={a.qty > 1 ? `Hardware · per ${a.name || "assembly"}, ×${a.qty} in total` : "Hardware"} lines={a.hardware} items={items} byId={byId}
        onEdit={(fn) => upd((x) => fn(x.hardware))} />

      {!readOnly ? (
        <div className="flex flex-wrap gap-1 border-t border-line px-3 py-2 sm:px-4">
          {!drawn ? <Button size="sm" variant="ghost" icon={<Plus size={15} strokeWidth={2.4} />} onClick={addPart}>Add part</Button> : null}
          <Button size="sm" variant="ghost" icon={<Plus size={15} strokeWidth={2.4} />} onClick={() => upd((x) => { x.hardware.push({ id: newId(), item_id: null, name: "", qty: 1, unit_price: null }); })}>Add hardware</Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Parts generated from the assembly's 3D frame: read-only here, edited in the 3D view. */
function DrawnParts({ a, byId, projectId }: { a: Assembly; byId: Map<string, CatalogItem>; projectId: string }) {
  const active = useActivePart();
  const focus = usePartFocus.getState();
  return (
    <div className="flex flex-col gap-1 px-2 sm:px-3">
      {a.frame_warnings.length ? <p className="px-2 text-[13px] text-warn">{a.frame_warnings[0]}{a.frame_warnings.length > 1 ? ` (+${a.frame_warnings.length - 1} more)` : ""}</p> : null}
      {a.parts.map((p, i) => {
        const item = p.item_id ? byId.get(p.item_id) : undefined;
        return (
          <div key={p.id} id={partRowId(p.id)} onPointerEnter={() => focus.setHovered(p.id)} onPointerLeave={() => focus.setHovered(null)}
            className={cn("grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl px-2 py-1.5 transition-colors", active === p.id && "bg-surface-2/70")}>
            <AsmChip letter={a.letter}>{a.letter}{i + 1}</AsmChip>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px]">{p.name || "Bar"}</span>
              <span className="truncate text-[13px] text-ink-2">{item?.name.en ?? "No material"}</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="tnum text-[15px] font-semibold">{p.qty} × {p.length_mm} mm</span>
              <span className="text-[13px] text-ink-2">{cutSummary(p.cuts)}</span>
            </span>
          </div>
        );
      })}
      {!a.parts.length ? <p className="px-2 py-3 text-[14px] text-ink-2">No bars with a material yet.</p> : null}
      <Link href={`/projects/${projectId}/frame/${a.id}`}
        className="mx-2 mb-2 mt-1 inline-flex h-9 items-center gap-2 self-start rounded-xl bg-surface-2 px-3 text-[14px] font-medium hover:bg-surface-3">
        <Box size={15} />Edit in 3D
      </Link>
    </div>
  );
}

// Part rows follow the width of the parts column, not the window: three lines when narrow,
// two when there's room for the material beside the name, one line when wide.
const ROW = "grid gap-x-2 gap-y-1.5 grid-cols-[40px_minmax(0,1fr)_32px] [grid-template-areas:'chip_name_del'_'mat_mat_mat'_'nums_nums_nums'] "
  + "@lg:grid-cols-[40px_minmax(0,1fr)_minmax(0,1.3fr)_32px] @lg:[grid-template-areas:'chip_name_mat_del'_'._nums_nums_nums'] "
  + "@2xl:grid-cols-[34px_minmax(0,0.75fr)_minmax(0,1.5fr)_auto_28px] @2xl:[grid-template-areas:'chip_name_mat_nums_del']";
// The width column also holds the grain toggle, so it gets the extra room for 4-digit sizes.
const NUMS = "grid grid-cols-[112px_1fr_1fr] gap-2 @2xl:grid-cols-[88px_92px_124px]";

function PartRow({ a, p, label, items, byId, problem }: {
  a: Assembly; p: Part; label: string; items: CatalogItem[]; byId: Map<string, CatalogItem>; problem?: string;
}) {
  const edit = useEditor((s) => s.edit);
  const readOnly = useEditor((s) => s.readOnly);
  const { units } = useProjectCtx();
  const active = useActivePart() === p.id;
  const item = p.item_id ? byId.get(p.item_id) : undefined;
  const isSheet = item?.kind === "sheet";
  const upd = (fn: (x: Part) => void, key?: string) => edit((d) => {
    const x = d.assemblies.find((y) => y.id === a.id)?.parts.find((y) => y.id === p.id);
    if (x) fn(x);
  }, key);
  const focus = usePartFocus.getState();

  return (
    <div id={partRowId(p.id)}
      onPointerEnter={() => focus.setHovered(p.id)} onPointerLeave={() => focus.setHovered(null)}
      onFocus={() => focus.setFocused(p.id)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && usePartFocus.getState().focused === p.id) focus.setFocused(null); }}
      className={cn(ROW, "group scroll-mt-24 items-center rounded-xl px-2 py-1.5 transition-colors", problem ? "bg-kerf-soft/50" : active && "bg-surface-2/70")}>
      <div className="flex items-center [grid-area:chip]">
        {problem ? (
          <Tip content={problem}><span><AsmChip letter={a.letter} className="shadow-[0_0_0_1.5px_var(--kerf)]">{label}</AsmChip></span></Tip>
        ) : <AsmChip letter={a.letter}>{label}</AsmChip>}
      </div>
      <div className="min-w-0 [grid-area:name]">
        <InlineText value={p.name} placeholder="Part name" ariaLabel={`${label} name`} readOnly={readOnly} onCommit={(v) => upd((x) => { x.name = v; })} className="w-full text-[15px]" boxed />
      </div>
      <div className="flex justify-end [grid-area:del]">
        {!readOnly ? <IconButton label={`Delete ${label}`} size="sm" className="text-ink-3 opacity-100 @2xl:opacity-40 @2xl:group-hover:opacity-100 @2xl:focus:opacity-100"
          onClick={() => edit((d) => { const x = d.assemblies.find((y) => y.id === a.id); if (x) x.parts = x.parts.filter((y) => y.id !== p.id); })}><X size={16} /></IconButton> : null}
      </div>
      <div className="min-w-0 [grid-area:mat]">
        <ItemPicker items={items} value={p.item_id} kinds={["lumber", "sheet"]} ariaLabel={`${label} material`} disabled={readOnly}
          onChange={(id) => { if (!id) return; rememberMaterial(id); upd((x) => { x.item_id = id; const it = byId.get(id); if (it?.kind !== "sheet") { x.width_mm = null; x.grain_locked = false; } }); }} />
      </div>
      <div className={cn(NUMS, "[grid-area:nums]")}>
        <QtyInput ariaLabel={`${label} quantity`} value={p.qty} disabled={readOnly} onChange={(n) => upd((x) => { x.qty = n; }, `qty-${p.id}`)} />
        <LengthInput ariaLabel={`${label} length`} units={units} value={p.length_mm} placeholder="Length"
          invalid={!!problem && problem.includes("length")} onChange={(mm) => upd((x) => { x.length_mm = mm ?? 0; })} />
        {isSheet ? (
          <LengthInput ariaLabel={`${label} width`} units={units} value={p.width_mm} placeholder="Width" allowEmpty
            invalid={!!problem && problem.includes("width")} onChange={(mm) => upd((x) => { x.width_mm = mm; })}
            start={item?.has_grain ? (
              <Tip content={p.grain_locked ? "Grain runs along the length. Won't be rotated." : "Free to rotate on the sheet. Click to lock grain direction."}>
                <button type="button" aria-pressed={p.grain_locked} aria-label={`${label} grain lock`} disabled={readOnly}
                  onClick={() => upd((x) => { x.grain_locked = !x.grain_locked; })}
                  className={cn("flex h-8 w-8 items-center justify-center rounded-md", p.grain_locked ? "bg-accent-soft text-ink" : "text-ink-3 hover:bg-surface-3 hover:text-ink-2")}>
                  <GrainIcon />
                </button>
              </Tip>
            ) : undefined} />
        ) : <span className="flex h-9 items-center justify-end pe-2.5 text-[14px] text-ink-3" aria-hidden="true">—</span>}
      </div>
    </div>
  );
}

function GrainIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 5c3-1.6 5 1.6 8 0s4-1 6 0M2 9c3-1.6 5 1.6 8 0s4-1 6 0M2 13c3-1.6 5 1.6 8 0s4-1 6 0" />
    </svg>
  );
}

function ExtrasCard({ lines, items, byId }: { lines: HardwareLine[]; items: CatalogItem[]; byId: Map<string, CatalogItem> }) {
  const edit = useEditor((s) => s.edit);
  const readOnly = useEditor((s) => s.readOnly);
  if (readOnly && !lines.length) return null;
  return (
    <Card className="@container flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
        <div className="flex flex-col">
          <h2 className="text-[17px] font-semibold">Extras</h2>
          <p className="text-[13px] text-ink-2">Glue, finish and anything bought once for the whole project.</p>
        </div>
      </div>
      <HardwareList lines={lines} items={items} byId={byId} onEdit={(fn) => edit((d) => fn(d.extras))} />
      {!readOnly ? (
        <div className="border-t border-line px-3 py-2 sm:px-4">
          <Button size="sm" variant="ghost" icon={<Plus size={15} strokeWidth={2.4} />} onClick={() => edit((d) => { d.extras.push({ id: newId(), item_id: null, name: "", qty: 1, unit_price: null }); })}>Add item</Button>
        </div>
      ) : null}
    </Card>
  );
}

function HardwareList({ title, lines, items, byId, onEdit }: {
  title?: string; lines: HardwareLine[]; items: CatalogItem[]; byId: Map<string, CatalogItem>;
  onEdit: (fn: (list: HardwareLine[]) => void) => void;
}) {
  const readOnly = useEditor((s) => s.readOnly);
  if (!lines.length) return null;
  const upd = (id: string, fn: (h: HardwareLine) => void) => onEdit((list) => { const h = list.find((x) => x.id === id); if (h) fn(h); });
  return (
    <div className="flex flex-col px-2 pb-2 sm:px-3">
      {title ? <p className="px-2 pb-1 pt-3 text-[12px] font-medium text-ink-3">{title}</p> : <div className="h-2" />}
      {lines.map((h) => {
        const item = h.item_id ? byId.get(h.item_id) : undefined;
        return (
          <div key={h.id} className="group grid grid-cols-[minmax(0,1fr)_112px_32px] items-center gap-2 rounded-xl px-2 py-1 @lg:grid-cols-[minmax(0,1fr)_112px_104px_32px]">
            <ItemPicker items={items} value={h.item_id} kinds={["hardware"]} ariaLabel="Hardware item" disabled={readOnly} allowFree
              placeholder={h.name || "Choose or type hardware"}
              onChange={(id, free) => upd(h.id, (x) => { if (id) { x.item_id = id; x.name = byId.get(id)?.name.en ?? x.name; } else if (free) { x.item_id = null; x.name = free; } })} />
            <QtyInput ariaLabel="Hardware quantity" value={h.qty} min={0} decimals={1} disabled={readOnly} onChange={(n) => upd(h.id, (x) => { x.qty = n; })} />
            <div className="hidden @lg:block">
              {item?.price != null ? (
                <span className="tnum flex h-9 items-center justify-end text-[13px] text-ink-2">{money(item.price)}{item.pack_size > 1 ? ` / ${item.pack_size}` : ""}</span>
              ) : (
                <NumberInput ariaLabel="Price each" value={h.unit_price} min={0} decimals={2} suffix="₪" onChange={(n) => upd(h.id, (x) => { x.unit_price = n; })} />
              )}
            </div>
            {!readOnly ? <IconButton label="Remove hardware" size="sm" className="text-ink-3 @2xl:opacity-40 @2xl:group-hover:opacity-100 @2xl:focus:opacity-100"
              onClick={() => onEdit((list) => { const i = list.findIndex((x) => x.id === h.id); if (i >= 0) list.splice(i, 1); })}><X size={16} /></IconButton> : <span />}
          </div>
        );
      })}
    </div>
  );
}

function InlineText({ value, onCommit, placeholder, ariaLabel, readOnly, className, boxed }: {
  value: string; onCommit: (v: string) => void; placeholder: string; ariaLabel: string; readOnly: boolean; className?: string; boxed?: boolean;
}) {
  return (
    <input key={value} defaultValue={value} placeholder={placeholder} aria-label={ariaLabel} readOnly={readOnly} dir="auto"
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { (e.target as HTMLInputElement).value = value; (e.target as HTMLInputElement).blur(); } }}
      className={cn("h-9 min-w-0 rounded-lg bg-transparent px-2 outline-none placeholder:text-ink-3 focus:bg-surface-2", boxed ? "hover:bg-surface-2/70" : "hover:bg-surface-2/60", className)} />
  );
}
