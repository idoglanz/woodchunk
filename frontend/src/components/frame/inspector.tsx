"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
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
import { AsmChip, Ltr } from "@/components/ui/misc";
import { cutSummary } from "@/components/frame/cut-list";

const PARAM_LABELS = { W: "width", D: "depth", H: "height", S: "lowerLevel" } as const;

/** Where you are in the panel, and one step back (Esc does the same). */
function PanelHeader({ title, sub, chip, frame }: { title: string; sub?: ReactNode; chip?: { letter: string; text: string }; frame: Frame }) {
  const t = useTranslations("frame");
  const back = useFrameUI((s) => s.back);
  const goBack = useFrameUI((s) => s.goBack);
  const select = useFrameUI((s) => s.select);
  const backLabel = back?.kind === "member" ? (() => {
    const i = frame.members.findIndex((m) => m.id === back.id);
    return frame.members[i]?.name || t("barN", { n: String(i + 1) });
  })() : back?.kind === "node" ? t("inspector.joint") : t("inspector.frame");
  return (
    <div className="-mx-1 -mt-1 flex flex-col gap-1">
      <button type="button" onClick={() => (back ? goBack() : select(null))}
        className="inline-flex items-center gap-1 self-start rounded-md px-1 text-[13px] font-medium text-info hover:underline">
        <ChevronLeft size={15} className="rtl:-scale-x-100" />{backLabel}
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
  const t = useTranslations("frame");
  const drawItem = useFrameUI((s) => s.drawItem);
  const set = useFrameUI((s) => s.set);
  const items = [...byId.values()].filter((i) => i.kind === "lumber");
  return (
    <>
      <h2 className="text-[15px] font-semibold">{t("inspector.drawBars")}</h2>
      <Field label={t("inspector.newBarsUse")}>
        <ItemPicker items={items} value={drawItem ?? commonItem(frame)} kinds={["lumber"]} ariaLabel={t("inspector.newBarsMaterial")}
          onChange={(id) => { if (id) { rememberMaterial(id); set({ drawItem: id }); } }} />
      </Field>
      <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
        <li>{t("inspector.tipSnaps")}</li>
        <li>{t("inspector.tipClick")}</li>
        <li>{t("inspector.tipFlat")}</li>
      </ul>
    </>
  );
}

function FramePanel({ asm, frame, byId }: { asm: Assembly; frame: Frame; byId: Map<string, CatalogItem> }) {
  const t = useTranslations("frame");
  const editFrame = useFrameEdit(asm.id, byId);
  const { units } = useProjectCtx();
  const paramLabel = (p: { name: string; label?: string }) => p.label || (p.name in PARAM_LABELS ? t(`params.${PARAM_LABELS[p.name as keyof typeof PARAM_LABELS]}`) : p.name);
  const defaults = { corner: "butt", lines: "outside", ...frame.defaults } as const;
  return (
    <>
      <h2 className="text-[15px] font-semibold">{t("inspector.frame")}</h2>
      {frame.params?.length ? (
        <div className="grid grid-cols-2 gap-3">
          {frame.params.map((p, i) => (
            <Field key={p.name} label={t("inspector.paramLabel", { label: paramLabel(p), name: p.name })} htmlFor={`param-${p.name}`}>
              <LengthInput id={`param-${p.name}`} ariaLabel={paramLabel(p)} units={units} value={p.mm}
                onChange={(mm) => { if (mm && mm > 0) editFrame((f) => { f.params![i].mm = mm; }); }} />
            </Field>
          ))}
        </div>
      ) : null}
      <Field label={t("inspector.corners")}>
        <Segmented label={t("inspector.corners")} value={defaults.corner} onChange={(v) => editFrame((f) => { f.defaults = { ...defaults, corner: v }; })}
          options={[{ value: "butt", label: t("inspector.butt") }, { value: "miter", label: t("inspector.miter") }]} />
      </Field>
      <Field label={t("inspector.dimensionsAre")} hint={defaults.lines === "outside" ? t("inspector.outsideHint") : t("inspector.centerlineHint")}>
        <Segmented label={t("inspector.dimensionsAre")} value={defaults.lines} onChange={(v) => editFrame((f) => { f.defaults = { ...defaults, lines: v }; })}
          options={[{ value: "outside", label: t("inspector.outside") }, { value: "centerline", label: t("inspector.centerlines") }]} />
      </Field>
      <p className="text-[13px] text-ink-3">{t("inspector.frameHelp")}</p>
    </>
  );
}

function MemberPanel({ asm, memberId, frame, result, byId }: {
  asm: Assembly; memberId: string; frame: Frame; result: FrameResult; byId: Map<string, CatalogItem>;
}) {
  const t = useTranslations("frame");
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
      <PanelHeader frame={frame} title={m.name || t("barN", { n: String(index + 1) })}
        chip={group >= 0 ? { letter: asm.letter, text: `${asm.letter}${group + 1}` } : undefined}
        sub={solved ? t.rich("inspector.cutSub", { lp: String(solved.lp), cuts: cutSummary(solved.ends, t), ltr: (c) => <Ltr>{c}</Ltr> }) : undefined} />
      <div className="flex items-end gap-3">
        <Field label={t("inspector.length")} htmlFor="member-length" className="flex-1"
          hint={t("inspector.lengthHint")}>
          <LengthInput id="member-length" key={`${m.id}:${lineLength}`} ariaLabel={t("inspector.barLength")} units={units} value={lineLength}
            onChange={(mm) => { if (mm && mm >= 1 && mm !== lineLength) editFrame((f) => setMemberLength(f, m.id, mm)); }} />
        </Field>
      </div>
      <div className="-mt-2 flex items-center gap-2 text-[13px] text-ink-2">
        {t("inspector.ends")}
        <Button size="sm" variant="ghost" onClick={() => open({ kind: "node", id: m.a })}>{t("inspector.startJoint")} <ChevronRight size={13} className="text-ink-3 rtl:rotate-180" /></Button>
        <Button size="sm" variant="ghost" onClick={() => open({ kind: "node", id: m.b })}>{t("inspector.endJoint")} <ChevronRight size={13} className="text-ink-3 rtl:rotate-180" /></Button>
      </div>
      <Field label={t("inspector.name")} htmlFor="member-name">
        <TextInput id="member-name" key={`${m.id}:${m.name ?? ""}`} defaultValue={m.name ?? ""} placeholder={t("inspector.namePlaceholder")} className="h-9 text-[14px]"
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.name ?? "")) upd((x) => { x.name = v; }); }} />
      </Field>
      <Field label={t("inspector.material")}>
        <ItemPicker items={items} value={m.item_id ?? null} kinds={["lumber"]} ariaLabel={t("inspector.barMaterial")}
          onChange={(id) => { if (!id) return; rememberMaterial(id); upd((x) => { x.item_id = id; }); }} />
      </Field>
      {same.length && m.item_id ? (
        <Button size="sm" variant="ghost" className="-mt-2 self-start"
          onClick={() => editFrame((f) => { for (const x of f.members) if (x.name === m.name) x.item_id = m.item_id; })}>
          {t("inspector.useForAll", { n: String(same.length + 1), name: m.name ?? "" })}
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
  const t = useTranslations("frame");
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
    return frame.members[i]?.name || t("barN", { n: String(i + 1) });
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
      <PanelHeader frame={frame} title={t("inspector.joint")}
        sub={t("inspector.jointSub", { n: here.length, names: here.map((m) => label(m.id)).join(", ") })} />
      {at ? (
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis, i) => {
            const src = node[axis];
            const tied = typeof src === "string" && frame.params?.some((p) => p.name === src.trim());
            return (
              <Field key={axis} label={tied ? `${axis.toUpperCase()} = ${src}` : axis.toUpperCase()} htmlFor={`joint-${axis}`}>
                <NumberInput id={`joint-${axis}`} key={`${nodeId}:${axis}:${at[i]}`} ariaLabel={t("inspector.jointAxis", { axis: axis.toUpperCase() })} value={Math.round(at[i] * 10) / 10}
                  min={-100000} decimals={1} suffix="mm" onChange={(n) => { if (n != null) setAxis(i, n); }} />
              </Field>
            );
          })}
        </div>
      ) : null}
      <Field label={t("inspector.cut")}>
        <Segmented label={t("inspector.jointCut")} value={kind} onChange={(v) => set(v === "default" ? null : { kind: v, through: joint?.through ?? null })}
          options={[{ value: "default", label: frame.defaults?.corner === "miter" ? t("inspector.defaultMiter") : t("inspector.defaultButt") }, { value: "miter", label: t("inspector.miter") }, { value: "butt", label: t("inspector.butt") }]} />
      </Field>
      {kind === "butt" ? (
        <Field label={t("inspector.runsThrough")} htmlFor="through" hint={t("inspector.runsThroughHint")}>
          <Select id="through" value={joint?.through ?? ""} onChange={(e) => set({ kind: "butt", through: e.target.value || null })}>
            <option value="">{t("inspector.automaticThrough")}</option>
            {here.map((m) => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
