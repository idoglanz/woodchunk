"use client";

import { RotateCw } from "lucide-react";
import { useFrameEdit } from "@/components/frame/use-frame-edit";
import { ItemPicker, rememberMaterial } from "@/components/project/material-picker";
import { useProjectCtx } from "@/components/project/context";
import { Button } from "@/components/ui/button";
import { Field, LengthInput, Select, TextInput } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { FrameResult } from "@/lib/frame/kernel";
import type { Anchor, Frame } from "@/lib/frame/types";
import { useFrameUI } from "@/lib/frame/ui";
import { cutSummary } from "@/components/frame/cut-list";

const PARAM_LABELS: Record<string, string> = { W: "Width", D: "Depth", H: "Height", S: "Lower level" };
const ANCHOR_GRID: Anchor[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];

export function Inspector({ asm, frame, result, byId }: { asm: Assembly; frame: Frame; result: FrameResult; byId: Map<string, CatalogItem> }) {
  const selected = useFrameUI((s) => s.selected);
  const member = selected?.kind === "member" ? frame.members.find((m) => m.id === selected.id) : undefined;
  const node = selected?.kind === "node" ? frame.nodes.find((n) => n.id === selected.id) : undefined;
  return (
    <div className="flex flex-col gap-4 border-b border-line p-4">
      {member ? <MemberPanel asm={asm} memberId={member.id} frame={frame} result={result} byId={byId} />
        : node ? <JointPanel asm={asm} nodeId={node.id} frame={frame} byId={byId} />
        : <FramePanel asm={asm} frame={frame} byId={byId} />}
    </div>
  );
}

function FramePanel({ asm, frame, byId }: { asm: Assembly; frame: Frame; byId: Map<string, CatalogItem> }) {
  const editFrame = useFrameEdit(asm.id, byId);
  const { units } = useProjectCtx();
  const defaults = { corner: "butt", lines: "outside", ...frame.defaults } as const;
  return (
    <>
      <h2 className="text-[15px] font-semibold">Frame</h2>
      {frame.params?.length ? (
        <div className="grid grid-cols-2 gap-3">
          {frame.params.map((p, i) => (
            <Field key={p.name} label={`${PARAM_LABELS[p.name] ?? p.name} (${p.name})`} htmlFor={`param-${p.name}`}>
              <LengthInput id={`param-${p.name}`} ariaLabel={PARAM_LABELS[p.name] ?? p.name} units={units} value={p.mm}
                onChange={(mm) => { if (mm && mm > 0) editFrame((f) => { f.params![i].mm = mm; }); }} />
            </Field>
          ))}
        </div>
      ) : null}
      <Field label="Corners">
        <Segmented label="Corners" value={defaults.corner} onChange={(v) => editFrame((f) => { f.defaults = { ...defaults, corner: v }; })}
          options={[{ value: "butt", label: "Butt" }, { value: "miter", label: "Miter" }]} />
      </Field>
      <Field label="Dimensions are" hint={defaults.lines === "outside" ? "Bars sit inside the lines: the frame measures exactly these sizes on the outside." : "Lines run through the middle of each bar."}>
        <Segmented label="Dimensions are" value={defaults.lines} onChange={(v) => editFrame((f) => { f.defaults = { ...defaults, lines: v }; })}
          options={[{ value: "outside", label: "Outside" }, { value: "centerline", label: "Centerlines" }]} />
      </Field>
      <p className="text-[13px] text-ink-3">Click a bar to change its material or turn it; click a joint to change how it&apos;s cut.</p>
    </>
  );
}

function MemberPanel({ asm, memberId, frame, result, byId }: {
  asm: Assembly; memberId: string; frame: Frame; result: FrameResult; byId: Map<string, CatalogItem>;
}) {
  const editFrame = useFrameEdit(asm.id, byId);
  const m = frame.members.find((x) => x.id === memberId)!;
  const solved = result.members.find((x) => x.id === memberId);
  const items = [...byId.values()].filter((i) => i.kind === "lumber");
  const same = frame.members.filter((x) => x.id !== m.id && m.name && x.name === m.name);
  const upd = (fn: (x: typeof m) => void, key?: string) => editFrame((f) => { const x = f.members.find((y) => y.id === memberId); if (x) fn(x); }, key);
  const anchor = m.anchor ?? "auto";
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Bar</h2>
        {solved ? <span className="tnum text-[13px] text-ink-2">{solved.lp} mm · {cutSummary(solved.ends)}</span> : null}
      </div>
      <Field label="Name" htmlFor="member-name">
        <TextInput id="member-name" key={m.id} defaultValue={m.name ?? ""} placeholder="Leg, rail…" className="h-9 text-[14px]"
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.name ?? "")) upd((x) => { x.name = v; }); }} />
      </Field>
      <Field label="Material">
        <ItemPicker items={items} value={m.item_id ?? null} kinds={["lumber"]} ariaLabel="Bar material"
          onChange={(id) => { if (!id) return; rememberMaterial(id); upd((x) => { x.item_id = id; }); }} />
      </Field>
      {same.length && m.item_id ? (
        <Button size="sm" variant="ghost" className="-mt-2 self-start"
          onClick={() => editFrame((f) => { for (const x of f.members) if (x.name === m.name) x.item_id = m.item_id; })}>
          Use for all {same.length + 1} “{m.name}” bars
        </Button>
      ) : null}
      <div className="flex items-end gap-4">
        <Field label="Turn">
          <Button size="sm" icon={<RotateCw size={15} />} onClick={() => upd((x) => { x.roll_deg = (((x.roll_deg ?? 0) + 90) % 360); })}>
            {Math.round(m.roll_deg ?? 0)}°
          </Button>
        </Field>
        <Field label="Line sits at" hint={anchor === "auto" ? "Automatic: on the outside edge." : undefined}>
          <div className="flex items-center gap-2">
            <div role="radiogroup" aria-label="Line position on the bar" className="grid grid-cols-3 gap-0.5 rounded-lg bg-surface-2 p-1">
              {ANCHOR_GRID.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={anchor === a} aria-label={`Line at ${a}`}
                  onClick={() => upd((x) => { x.anchor = a; })}
                  className={cn("h-4 w-4 rounded-[4px]", anchor === a ? "bg-ink" : "bg-surface hover:bg-line-strong")} />
              ))}
            </div>
            <Button size="sm" variant={anchor === "auto" ? "secondary" : "ghost"} onClick={() => upd((x) => { x.anchor = "auto"; })}>Auto</Button>
          </div>
        </Field>
      </div>
    </>
  );
}

function JointPanel({ asm, nodeId, frame, byId }: { asm: Assembly; nodeId: string; frame: Frame; byId: Map<string, CatalogItem> }) {
  const editFrame = useFrameEdit(asm.id, byId);
  const here = frame.members.filter((m) => m.a === nodeId || m.b === nodeId);
  const joint = frame.joints?.find((j) => j.node === nodeId);
  const kind = joint?.kind ?? "default";
  const set = (next: { kind: "miter" | "butt"; through?: string | null } | null) => editFrame((f) => {
    f.joints = (f.joints ?? []).filter((j) => j.node !== nodeId);
    if (next) f.joints.push({ node: nodeId, ...next });
  });
  const label = (id: string) => { const m = frame.members.find((x) => x.id === id); return m?.name || "Bar"; };
  return (
    <>
      <h2 className="text-[15px] font-semibold">Joint</h2>
      <p className="-mt-2 text-[13px] text-ink-2">{here.length} bars meet here: {here.map((m) => m.name || "bar").join(", ")}.</p>
      <Field label="Cut">
        <Segmented label="Joint cut" value={kind} onChange={(v) => set(v === "default" ? null : { kind: v, through: joint?.through ?? null })}
          options={[{ value: "default", label: `Frame default (${frame.defaults?.corner ?? "butt"})` }, { value: "miter", label: "Miter" }, { value: "butt", label: "Butt" }]} />
      </Field>
      {kind === "butt" ? (
        <Field label="Runs through" htmlFor="through" hint="The other bars stop at its face.">
          <Select id="through" value={joint?.through ?? ""} onChange={(e) => set({ kind: "butt", through: e.target.value || null })}>
            <option value="">Automatic (uprights, then the longest)</option>
            {here.map((m, i) => <option key={m.id} value={m.id}>{label(m.id)} {i + 1}</option>)}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
