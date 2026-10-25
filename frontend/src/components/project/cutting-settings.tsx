"use client";

import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, LengthInput, NumberInput, Select, Switch } from "@/components/ui/field";
import { Pop } from "@/components/ui/overlay";
import type { CuttingSettings } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { useEditor } from "@/lib/editor";

const KERFS = [2.2, 3, 3.2];
const CARRY = [null, 2400, 3000, 3600, 4000, 4800];

export function KerfField({ label, hint, value, onChange, id }: { label: string; hint: string; value: number; onChange: (v: number) => void; id: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <NumberInput id={id} ariaLabel={label} value={value} min={0} decimals={1} suffix="mm" className="w-24" onChange={(n) => n != null && n <= 10 && onChange(n)} />
        <div className="flex gap-1">
          {KERFS.map((k) => (
            <button key={k} type="button" onClick={() => onChange(k)}
              className={cn("tnum h-8 rounded-lg px-2.5 text-[13px] font-medium", Math.abs(value - k) < 0.01 ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1.5px_var(--accent)]" : "bg-surface-2 text-ink-2 hover:text-ink")}>
              {k.toFixed(1)}
            </button>
          ))}
        </div>
      </div>
    </Field>
  );
}

export function CuttingSettingsForm({ value, onChange, units }: { value: CuttingSettings; onChange: (fn: (s: CuttingSettings) => void, key?: string) => void; units: "mm" | "cm" }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <h3 className="text-[13px] font-semibold text-ink">Saw blade width</h3>
        <KerfField id="kerf-sheet" label="Sheets (track or table saw)" hint="Lost on every rip and crosscut. Adds up fast on sheets."
          value={value.kerf_sheet_mm} onChange={(v) => onChange((s) => { s.kerf_sheet_mm = v; }, "kerf-sheet")} />
        <KerfField id="kerf-lumber" label="Lumber (miter or circular saw)" hint="Lost between pieces cut from the same board."
          value={value.kerf_lumber_mm} onChange={(v) => onChange((s) => { s.kerf_lumber_mm = v; }, "kerf-lumber")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Longest board I can carry" htmlFor="carry">
          <Select id="carry" value={value.max_stock_length_mm ?? ""} onChange={(e) => onChange((s) => { s.max_stock_length_mm = e.target.value ? Number(e.target.value) : null; })}>
            {CARRY.map((c) => <option key={c ?? "any"} value={c ?? ""}>{c ? `${(c / 1000).toFixed(1)} m` : "Any length"}</option>)}
          </Select>
        </Field>
        <Field label="Square off board ends" htmlFor="trim" hint="Cut from the start of every board.">
          <LengthInput id="trim" ariaLabel="End trim" units={units} value={value.end_trim_mm} onChange={(mm) => onChange((s) => { s.end_trim_mm = mm ?? 0; })} placeholder="0" />
        </Field>
        <Field label="Trim sheet edges" htmlFor="edge" hint="Factory edges are often damaged.">
          <LengthInput id="edge" ariaLabel="Edge trim" units={units} value={value.edge_trim_mm} onChange={(mm) => onChange((s) => { s.edge_trim_mm = mm ?? 0; })} placeholder="0" />
        </Field>
        <Field label="Keep lumber offcuts from" htmlFor="minoff">
          <LengthInput id="minoff" ariaLabel="Minimum lumber offcut" units={units} value={value.min_offcut_mm} onChange={(mm) => onChange((s) => { s.min_offcut_mm = mm ?? 0; })} />
        </Field>
        <Field label="Saw turns up to (miter)" htmlFor="max-miter" hint="Angled cuts beyond this get a warning.">
          <NumberInput id="max-miter" ariaLabel="Largest miter angle" value={value.max_miter_deg} min={0} decimals={1} suffix="°"
            onChange={(n) => { if (n != null && n <= 90) onChange((s) => { s.max_miter_deg = n; }); }} />
        </Field>
        <Field label="Blade tilts up to (bevel)" htmlFor="max-bevel">
          <NumberInput id="max-bevel" ariaLabel="Largest bevel angle" value={value.max_bevel_deg} min={0} decimals={1} suffix="°"
            onChange={(n) => { if (n != null && n <= 90) onChange((s) => { s.max_bevel_deg = n; }); }} />
        </Field>
      </div>
      <div className="flex flex-col gap-4 border-t border-line pt-4">
        <Switch label="Rotate sheet parts" description="Parts without a grain lock may turn 90°." checked={value.allow_rotation}
          onChange={(v) => onChange((s) => { s.allow_rotation = v; })} />
        <Switch label="Use my workshop stock first" description="Offcuts and boards you own cost nothing." checked={value.use_inventory}
          onChange={(v) => onChange((s) => { s.use_inventory = v; })} />
      </div>
    </div>
  );
}

export function CuttingSettingsButton({ units }: { units: "mm" | "cm" }) {
  const settings = useEditor((s) => s.content?.settings);
  const edit = useEditor((s) => s.edit);
  const readOnly = useEditor((s) => s.readOnly);
  if (!settings) return null;
  const label = `Saw ${fmt(settings.kerf_sheet_mm)}${settings.kerf_sheet_mm !== settings.kerf_lumber_mm ? ` / ${fmt(settings.kerf_lumber_mm)}` : ""} mm${settings.max_stock_length_mm ? ` · max ${(settings.max_stock_length_mm / 1000).toFixed(1)} m` : ""}`;
  return (
    <Pop align="end" className="w-[min(94vw,440px)] p-5" trigger={
      <Button size="sm" icon={<SlidersHorizontal size={15} />} disabled={readOnly}>{label}</Button>
    }>
      <CuttingSettingsForm value={settings} units={units} onChange={(fn, key) => edit((d) => fn(d.settings), key)} />
    </Pop>
  );
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
