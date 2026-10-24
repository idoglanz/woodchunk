"use client";

import { CuttingSettingsForm } from "@/components/project/cutting-settings";
import { Page } from "@/components/shell/app-shell";
import { Field, TextInput } from "@/components/ui/field";
import { Card, PageTitle, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Prefs } from "@/lib/api/client";
import { useMe, useUpdateMe } from "@/lib/queries";
import { applyTheme, type Theme } from "@/lib/theme";

export function SettingsPage() {
  const me = useMe();
  const update = useUpdateMe();
  if (!me.data) return <Page><Skeleton className="h-96 rounded-[16px]" /></Page>;
  const prefs = me.data.prefs;
  const save = (patch: Partial<Prefs>, name?: string) => update.mutate({ name: name ?? null, prefs: { ...prefs, ...patch } });

  return (
    <Page>
      <div className="flex max-w-[720px] flex-col gap-6">
        <PageTitle title="Settings" subtitle="Changes save as you go." />
        <Card className="flex flex-col gap-5 p-6">
          <Field label="Your name" htmlFor="uname">
            <TextInput id="uname" defaultValue={me.data.name} onBlur={(e) => e.target.value.trim() !== me.data!.name && save({}, e.target.value.trim())} />
          </Field>
          <Row label="Appearance">
            <Segmented label="Appearance" value={prefs.theme} onChange={(v) => { applyTheme(v as Theme); save({ theme: v }); }}
              options={[{ value: "system", label: "Automatic" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Row>
          <Row label="Lengths in">
            <Segmented label="Units" value={prefs.units} onChange={(v) => save({ units: v })} options={[{ value: "mm", label: "Millimetres" }, { value: "cm", label: "Centimetres" }]} />
          </Row>
          <Row label="Shopping list and shop sheet">
            <Segmented label="Export language" value={prefs.export_lang} onChange={(v) => save({ export_lang: v })} options={[{ value: "en", label: "English" }, { value: "he", label: "עברית" }]} />
          </Row>
        </Card>
        <Card className="flex flex-col gap-2 p-6">
          <h2 className="text-[17px] font-semibold">Cutting defaults for new projects</h2>
          <p className="mb-3 text-[14px] text-ink-2">Each project can override these from its Build tab.</p>
          <CuttingSettingsForm value={prefs.cutting} units={prefs.units}
            onChange={(fn) => { const c = structuredClone(prefs.cutting); fn(c); save({ cutting: c }); }} />
        </Card>
      </div>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-[15px]">{label}</span>
      {children}
    </div>
  );
}
