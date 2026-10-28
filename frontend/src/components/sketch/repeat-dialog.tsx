"use client";

import { useMemo, useState } from "react";
import { useProjectCtx } from "@/components/project/context";
import { Button } from "@/components/ui/button";
import { Field, LengthInput, QtyInput, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { newId } from "@/lib/editor";
import { itemNames } from "@/lib/sketch/model";
import { boundaryAt, extent, planSpacing, repeat, type Axis, type Ends, type RepeatPlan } from "@/lib/sketch/repeat";
import { AXES, X_AXIS, Y_AXIS, type Sketch } from "@/lib/sketch/types";
import { toast } from "@/lib/toast";
import { fmtLength } from "@/lib/units";

type Mode = "between" | "length" | "gap";

/**
 * Repeat the selected shapes with even gaps: how many, which way, and what they fill (between two
 * lines, a length, or a set gap). The gap is worked out as you go.
 */
export function RepeatDialog({ sk, ids, open, onOpenChange, onApply }: {
  sk: Sketch; ids: string[]; open: boolean; onOpenChange: (o: boolean) => void;
  onApply: (fn: (d: Sketch) => void) => void;
}) {
  const { units } = useProjectCtx();
  const names = useMemo(() => itemNames(sk), [sk]);
  const [axis, setAxis] = useState<Axis>("x");
  const [count, setCount] = useState(5);
  // Lines square to the repeat that could bound it (the item's own lines aren't), nearest first.
  const bounds = useMemo(() => {
    const ext = extent(sk, ids, axis);
    const own = new Set(ids);
    const list = [...sk.shapes.filter((s) => s.kind === "line" && !own.has(s.id)).map((s) => s.id), axis === "x" ? Y_AXIS : X_AXIS]
      .map((id) => ({ id, at: boundaryAt(sk, id, axis) }))
      .filter((b): b is { id: string; at: number } => b.at !== null);
    const before = list.filter((b) => ext && b.at <= ext.min + 1e-6).sort((p, q) => q.at - p.at);
    const after = list.filter((b) => ext && b.at >= ext.max - 1e-6).sort((p, q) => p.at - q.at);
    return { list, before, after };
  }, [sk, ids, axis]);
  const [mode, setMode] = useState<Mode>(bounds.before.length && bounds.after.length ? "between" : "length");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const a = from ?? bounds.before[0]?.id ?? "";
  const b = to ?? bounds.after[0]?.id ?? "";
  const [length, setLength] = useState<number | null>(1200);
  const [gap, setGap] = useState<number | null>(50);
  const [endsKind, setEndsKind] = useState<"equal" | "flush" | "set">("equal");
  const [endMm, setEndMm] = useState<number | null>(20);

  const ends: Ends = endsKind === "set" ? endMm ?? 0 : endsKind;
  const plan: RepeatPlan | null = mode === "between" ? (a && b ? { axis, count, span: { between: [a, b] }, ends } : null)
    : mode === "length" ? (length ? { axis, count, span: { length }, ends } : null)
    : gap !== null ? { axis, count, span: { gap }, ends: "flush" } : null;
  const result = plan ? planSpacing(sk, ids, plan) : { ok: false as const, reason: "Choose what to fill." };
  const name = (id: string) => (AXES.includes(id) ? names.get(id) : `${names.get(id)} (${fmtLength(Math.round(bounds.list.find((x) => x.id === id)!.at), units)})`);

  const apply = () => {
    if (!plan || !result.ok) return;
    // Try it first: placed, it has to solve with the rest of the sketch.
    const tried = repeat(structuredClone(sk), ids, plan, () => newId().slice(0, 10));
    if (!tried.ok) { toast.error(tried.reason); return; }
    onApply((d) => { repeat(d, ids, plan, () => newId().slice(0, 10)); });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Repeat with even gaps"
      description="Copies of the selection, spaced evenly: slats, shelves, pickets."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={!result.ok} onClick={apply}>Repeat ×{count}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_120px] items-end gap-3">
          <Field label="Direction">
            <Segmented label="Direction" value={axis} onChange={(v) => { setAxis(v); setFrom(null); setTo(null); }}
              options={[{ value: "x", label: "Across (X)" }, { value: "y", label: "Up (Y)" }]} />
          </Field>
          <Field label="How many">
            <QtyInput ariaLabel="How many in all" min={2} max={200} value={count} onChange={setCount} />
          </Field>
        </div>
        <Field label="Spacing">
          <Segmented label="Spacing" value={mode} onChange={setMode}
            options={[{ value: "between", label: "Between lines" }, { value: "length", label: "In a length" }, { value: "gap", label: "Set gap" }]} />
        </Field>
        {mode === "between" ? (
          bounds.before.length && bounds.after.length ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" htmlFor="rp-from">
                <Select id="rp-from" value={a} onChange={(e) => setFrom(e.target.value)} className="w-full">
                  {bounds.before.map((x) => <option key={x.id} value={x.id}>{name(x.id)}</option>)}
                </Select>
              </Field>
              <Field label="To" htmlFor="rp-to">
                <Select id="rp-to" value={b} onChange={(e) => setTo(e.target.value)} className="w-full">
                  {bounds.after.map((x) => <option key={x.id} value={x.id}>{name(x.id)}</option>)}
                </Select>
              </Field>
            </div>
          ) : <p className="text-[14px] text-ink-2">Draw {axis === "x" ? "upright" : "level"} lines on both sides of the selection to fill between, or pick another way.</p>
        ) : mode === "length" ? (
          <Field label="Length to fill, from where the selection starts">
            <LengthInput ariaLabel="Length to fill" units={units} value={length} onChange={setLength} />
          </Field>
        ) : (
          <Field label="Gap between">
            <LengthInput ariaLabel="Gap between" units={units} value={gap} onChange={setGap} allowEmpty />
          </Field>
        )}
        {mode !== "gap" ? (
          <Field label="At the ends">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="At the ends" value={endsKind} onChange={setEndsKind}
                options={[{ value: "equal", label: "Same gap" }, { value: "flush", label: "Flush" }, { value: "set", label: "Set" }]} />
              {endsKind === "set" ? <LengthInput ariaLabel="Gap at each end" units={units} value={endMm} onChange={setEndMm} className="w-28" /> : null}
            </div>
          </Field>
        ) : null}
        <p role="status" className={result.ok ? "tnum rounded-xl bg-surface-2 px-3 py-2 text-[15px]" : "rounded-xl bg-kerf-soft px-3 py-2 text-[14px] text-kerf"}>
          {result.ok
            ? <>Gap between: <b>{fmtLength(Math.round(result.gap * 10) / 10, units)}</b>{mode !== "gap" ? <> · at each end: <b>{fmtLength(Math.round(result.end * 10) / 10, units)}</b></> : null}</>
            : result.reason}
        </p>
      </div>
    </Sheet>
  );
}
