"use client";

import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Field, LengthInput, NumberInput, Select, Switch } from "@/components/ui/field";
import { Ltr } from "@/components/ui/misc";
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
  const t = useTranslations("project.cutting");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <h3 className="text-[13px] font-semibold text-ink">{t("bladeWidth")}</h3>
        <KerfField id="kerf-sheet" label={t("sheets")} hint={t("sheetsHint")}
          value={value.kerf_sheet_mm} onChange={(v) => onChange((s) => { s.kerf_sheet_mm = v; }, "kerf-sheet")} />
        <KerfField id="kerf-lumber" label={t("lumber")} hint={t("lumberHint")}
          value={value.kerf_lumber_mm} onChange={(v) => onChange((s) => { s.kerf_lumber_mm = v; }, "kerf-lumber")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("carry")} htmlFor="carry">
          <Select id="carry" value={value.max_stock_length_mm ?? ""} onChange={(e) => onChange((s) => { s.max_stock_length_mm = e.target.value ? Number(e.target.value) : null; })}>
            {CARRY.map((c) => <option key={c ?? "any"} value={c ?? ""}>{c ? `${(c / 1000).toFixed(1)} m` : t("anyLength")}</option>)}
          </Select>
        </Field>
        <Field label={t("squareEnds")} htmlFor="trim" hint={t("squareEndsHint")}>
          <LengthInput id="trim" ariaLabel={t("endTrim")} units={units} value={value.end_trim_mm} onChange={(mm) => onChange((s) => { s.end_trim_mm = Math.min(200, mm ?? 0); })} placeholder="0" />
        </Field>
        <Field label={t("edgeTrim")} htmlFor="edge" hint={t("edgeTrimHint")}>
          <LengthInput id="edge" ariaLabel={t("edgeTrimAria")} units={units} value={value.edge_trim_mm} onChange={(mm) => onChange((s) => { s.edge_trim_mm = Math.min(100, mm ?? 0); })} placeholder="0" />
        </Field>
        <Field label={t("minOffcut")} htmlFor="minoff">
          <LengthInput id="minoff" ariaLabel={t("minOffcutAria")} units={units} value={value.min_offcut_mm} onChange={(mm) => onChange((s) => { s.min_offcut_mm = mm ?? 0; })} />
        </Field>
        <Field label={t("maxMiter")} htmlFor="max-miter" hint={t("maxMiterHint")}>
          <NumberInput id="max-miter" ariaLabel={t("maxMiterAria")} value={value.max_miter_deg} min={0} decimals={1} suffix="°"
            onChange={(n) => { if (n != null && n <= 90) onChange((s) => { s.max_miter_deg = n; }); }} />
        </Field>
        <Field label={t("maxBevel")} htmlFor="max-bevel">
          <NumberInput id="max-bevel" ariaLabel={t("maxBevelAria")} value={value.max_bevel_deg} min={0} decimals={1} suffix="°"
            onChange={(n) => { if (n != null && n <= 90) onChange((s) => { s.max_bevel_deg = n; }); }} />
        </Field>
      </div>
      <div className="flex flex-col gap-4 border-t border-line pt-4">
        <Switch label={t("rotate")} description={t("rotateText")} checked={value.allow_rotation}
          onChange={(v) => onChange((s) => { s.allow_rotation = v; })} />
        <Switch label={t("useInventory")} description={t("useInventoryText")} checked={value.use_inventory}
          onChange={(v) => onChange((s) => { s.use_inventory = v; })} />
      </div>
    </div>
  );
}

export function CuttingSettingsButton({ units }: { units: "mm" | "cm" }) {
  const settings = useEditor((s) => s.content?.settings);
  const edit = useEditor((s) => s.edit);
  const readOnly = useEditor((s) => s.readOnly);
  const t = useTranslations("project.cutting");
  if (!settings) return null;
  const ltr = (c: ReactNode) => <Ltr>{c}</Ltr>;
  const kerf = `${fmt(settings.kerf_sheet_mm)}${settings.kerf_sheet_mm !== settings.kerf_lumber_mm ? ` / ${fmt(settings.kerf_lumber_mm)}` : ""}`;
  const label = <>{t.rich("saw", { kerf, ltr })}{settings.max_stock_length_mm ? <> · {t.rich("max", { len: (settings.max_stock_length_mm / 1000).toFixed(1), ltr })}</> : null}</>;
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
