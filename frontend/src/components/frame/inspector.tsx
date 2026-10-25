"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFrameEdit } from "@/components/frame/use-frame-edit";
import { ItemPicker, rememberMaterial } from "@/components/project/material-picker";
import { useProjectCtx } from "@/components/project/context";
import { Button } from "@/components/ui/button";
import { Field, LengthInput, NumberInput, Select, TextInput } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import type { FrameResult } from "@/lib/frame/kernel";
import { commonItem, moveNode, nodePositions, setMemberLength } from "@/lib/frame/edit";
import type { Frame } from "@/lib/frame/types";
import { useFrameUI } from "@/lib/frame/ui";
import { SectionEditor } from "@/components/frame/section-editor";
import { AsmChip } from "@/components/ui/misc";
import { cutSummary } from "@/components/frame/cut-list";

const PARAM_LABELS: Record<string, string> = { W: "Width", D: "Depth", H: "Height", S: "Lower level" };

/** Where you are in the panel, and one step back (Esc does the same). */
function PanelHeader({ title, sub, chip, frame }: { title: string; sub?: string; chip?: { letter: string; text: string }; frame: Frame }) {
  const back = useFrameUI((s) => s.back);
  const goBack = useFrameUI((s) => s.goBack);
  const select = useFrameUI((s) => s.select);
  const backLabel = back?.kind === "member" ? (() => {
    const i = frame.members.findIndex((m) => m.id === back.id);
    return frame.members[i]?.name || `Bar ${i + 1}`;
  })() : back?.kind === "node" ? "Joint" : "Frame";
  return (
    <div className="-mx-1 -mt-1 flex flex-col gap-1">
      <button type="button" onClick={() => (back ? goBack() : select(null))}
        className="inline-flex items-center gap-1 self-start rounded-md px-1 text-[13px] font-medium text-info hover:underline">
        <ChevronLeft size={15} />{backLabel}
      </button>
      <div className="flex items-center gap-2 px-1">
        {chip ? <AsmChip letter={chip.letter}>{chip.text}</AsmChip> : null}
        <h2 className="min-w-0 truncate text-[17px] font-semibold">{title}</h2>
      </div>
      {sub ? <p className="px-1 text-[13px] text-ink-2">{sub}</p> : null}
    </div>
  );
}

export function Inspector({ asm, frame, result, byId }: { asm: Assembly; frame: Frame; result: FrameResult; byId: Map<string, CatalogItem> }) {
  const selected = useFrameUI((s) => s.selected);
  const member = selected?.kind === "member" ? frame.members.find((m) => m.id === selected.id) : undefined;
  const node = selected?.kind === "node" ? frame.nodes.find((n) => n.id === selected.id) : undefined;
  const tool = useFrameUI((s) => s.tool);
  return (
    <div className="flex flex-col gap-4 border-b border-line p-4">
      {tool === "draw" ? <DrawPanel frame={frame} byId={byId} />
        : member ? <MemberPanel asm={asm} memberId={member.id} frame={frame} result={result} byId={byId} />
        : node ? <JointPanel asm={asm} nodeId={node.id} frame={frame} byId={byId} />
        : <FramePanel asm={asm} frame={frame} byId={byId} />}
    </div>
  );
}

function DrawPanel({ frame, byId }: { frame: Frame; byId: Map<string, CatalogItem> }) {
  const drawItem = useFrameUI((s) => s.drawItem);
  const set = useFrameUI((s) => s.set);
  const items = [...byId.values()].filter((i) => i.kind === "lumber");
  return (
    <>
      <h2 className="text-[15px] font-semibold">Draw bars</h2>
      <Field label="New bars use">
        <ItemPicker items={items} value={drawItem ?? commonItem(frame)} kinds={["lumber"]} ariaLabel="Material for new bars"
          onChange={(id) => { if (id) { rememberMaterial(id); set({ drawItem: id }); } }} />
      </Field>
      <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
        <li>Snaps to joints, the middle of a bar, along a bar (a T-joint) and the X / Y / Z directions.</li>
        <li>A click places a point; dragging moves the view (turns it in 3D, pans in Front / Side / Top).</li>
        <li>Front, Side and Top are the easiest to draw in: everything stays on one flat plane.</li>
      </ul>
    </>
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
            <Field key={p.name} label={`${p.label || PARAM_LABELS[p.name] || p.name} (${p.name})`} htmlFor={`param-${p.name}`}>
              <LengthInput id={`param-${p.name}`} ariaLabel={p.label || PARAM_LABELS[p.name] || p.name} units={units} value={p.mm}
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
      <p className="text-[13px] text-ink-3">Click a bar to change it, a joint to drag it or change how it&apos;s cut, or a size on the model to type a new one. Press L to draw bars.</p>
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
  const { units } = useProjectCtx();
  const pos = nodePositions(frame);
  const [pa, pb] = [pos.get(m.a), pos.get(m.b)];
  const lineLength = pa && pb ? Math.round(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) * 10) / 10 : null;
  const open = useFrameUI((s) => s.open);
  const lookAlong = useFrameUI((s) => s.lookAlong);
  const index = frame.members.findIndex((x) => x.id === m.id);
  const group = result.groups.findIndex((g) => g.members.includes(m.id));
  return (
    <>
      <PanelHeader frame={frame} title={m.name || `Bar ${index + 1}`}
        chip={group >= 0 ? { letter: asm.letter, text: `${asm.letter}${group + 1}` } : undefined}
        sub={solved ? `Cut ${solved.lp} mm · ${cutSummary(solved.ends)}` : undefined} />
      <div className="flex items-end gap-3">
        <Field label="Length, joint to joint" htmlFor="member-length" className="flex-1"
          hint="Moves the end with fewer bars on it. An end tied to a size (W, H…) changes that size.">
          <LengthInput id="member-length" key={`${m.id}:${lineLength}`} ariaLabel="Bar length" units={units} value={lineLength}
            onChange={(mm) => { if (mm && mm >= 1 && mm !== lineLength) editFrame((f) => setMemberLength(f, m.id, mm)); }} />
        </Field>
      </div>
      <div className="-mt-2 flex items-center gap-2 text-[13px] text-ink-2">
        Ends:
        <Button size="sm" variant="ghost" onClick={() => open({ kind: "node", id: m.a })}>Start joint <ChevronRight size={13} className="text-ink-3 rtl:rotate-180" /></Button>
        <Button size="sm" variant="ghost" onClick={() => open({ kind: "node", id: m.b })}>End joint <ChevronRight size={13} className="text-ink-3 rtl:rotate-180" /></Button>
      </div>
      <Field label="Name" htmlFor="member-name">
        <TextInput id="member-name" key={`${m.id}:${m.name ?? ""}`} defaultValue={m.name ?? ""} placeholder="Leg, rail…" className="h-9 text-[14px]"
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
      <SectionEditor member={m} solved={solved}
        onAnchor={(an) => upd((x) => { x.anchor = an; })}
        onRoll={(deg) => upd((x) => { x.roll_deg = ((deg % 360) + 360) % 360; })}
        onLookAlong={() => { if (pa && pb) lookAlong(pa, pb); }} />
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
  const label = (id: string) => {
    const i = frame.members.findIndex((x) => x.id === id);
    return frame.members[i]?.name || `Bar ${i + 1}`;
  };
  const node = frame.nodes.find((n) => n.id === nodeId)!;
  const at = nodePositions(frame).get(nodeId);
  const setAxis = (i: number, v: number) => {
    if (!at || v === at[i]) return;
    const next = [...at] as [number, number, number];
    next[i] = v;
    editFrame((f) => moveNode(f, nodeId, next));
  };
  return (
    <>
      <PanelHeader frame={frame} title="Joint"
        sub={`${here.length} ${here.length === 1 ? "bar ends" : "bars meet"} here: ${here.map((m) => label(m.id)).join(", ")}.`} />
      {at ? (
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis, i) => {
            const src = node[axis];
            const tied = typeof src === "string" && frame.params?.some((p) => p.name === src.trim());
            return (
              <Field key={axis} label={tied ? `${axis.toUpperCase()} = ${src}` : axis.toUpperCase()} htmlFor={`joint-${axis}`}>
                <NumberInput id={`joint-${axis}`} key={`${nodeId}:${axis}:${at[i]}`} ariaLabel={`Joint ${axis.toUpperCase()}`} value={Math.round(at[i] * 10) / 10}
                  min={-100000} decimals={1} suffix="mm" onChange={(n) => { if (n != null) setAxis(i, n); }} />
              </Field>
            );
          })}
        </div>
      ) : null}
      <Field label="Cut">
        <Segmented label="Joint cut" value={kind} onChange={(v) => set(v === "default" ? null : { kind: v, through: joint?.through ?? null })}
          options={[{ value: "default", label: `Frame default (${frame.defaults?.corner ?? "butt"})` }, { value: "miter", label: "Miter" }, { value: "butt", label: "Butt" }]} />
      </Field>
      {kind === "butt" ? (
        <Field label="Runs through" htmlFor="through" hint="The other bars stop at its face.">
          <Select id="through" value={joint?.through ?? ""} onChange={(e) => set({ kind: "butt", through: e.target.value || null })}>
            <option value="">Automatic (uprights, then the longest)</option>
            {here.map((m) => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
