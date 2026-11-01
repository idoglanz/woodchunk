"use client";

import { useTranslations } from "use-intl";
import { CuttingSettingsForm } from "@/components/project/cutting-settings";
import { Page } from "@/components/shell/app-shell";
import { Field, TextInput } from "@/components/ui/field";
import { Card, PageTitle, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Prefs } from "@/lib/api/client";
import { applyLang } from "@/lib/lang";
import { useMe, useUpdateMe } from "@/lib/queries";
import { applyTheme, type Theme } from "@/lib/theme";

export function SettingsPage() {
  const me = useMe();
  const update = useUpdateMe();
  const t = useTranslations("settings");
  if (!me.data) return <Page><Skeleton className="h-96 rounded-[16px]" /></Page>;
  const prefs = me.data.prefs;
  const save = (patch: Partial<Prefs>, name?: string) => update.mutate({ name: name ?? null, prefs: { ...prefs, ...patch } });

  return (
    <Page>
      <div className="flex max-w-[720px] flex-col gap-6">
        <PageTitle title={t("title")} subtitle={t("subtitle")} />
        <Card className="flex flex-col gap-5 p-6">
          <Field label={t("name")} htmlFor="uname">
            <TextInput id="uname" defaultValue={me.data.name} onBlur={(e) => e.target.value.trim() !== me.data!.name && save({}, e.target.value.trim())} />
          </Field>
          {/* The Hebrew interface is still being translated: only admins can switch to it for now. */}
          {me.data.role === "admin" ? (
            <Row label={t("language")} hint={t("languagePreview")}>
              <Segmented label={t("language")} value={prefs.lang} onChange={(v) => { applyLang(v); save({ lang: v }); }} options={LANGS} />
            </Row>
          ) : null}
          <Row label={t("appearance")}>
            <Segmented label={t("appearance")} value={prefs.theme} onChange={(v) => { applyTheme(v as Theme); save({ theme: v }); }}
              options={[{ value: "system", label: t("automatic") }, { value: "light", label: t("light") }, { value: "dark", label: t("dark") }]} />
          </Row>
          <Row label={t("lengthsIn")}>
            <Segmented label={t("units")} value={prefs.units} onChange={(v) => save({ units: v })} options={[{ value: "mm", label: t("millimetres") }, { value: "cm", label: t("centimetres") }]} />
          </Row>
          <Row label={t("exports")}>
            <Segmented label={t("exportLanguage")} value={prefs.export_lang} onChange={(v) => save({ export_lang: v })} options={LANGS} />
          </Row>
        </Card>
        <Card className="flex flex-col gap-2 p-6">
          <h2 className="text-[17px] font-semibold">{t("cuttingTitle")}</h2>
          <p className="mb-3 text-[14px] text-ink-2">{t("cuttingHint")}</p>
          <CuttingSettingsForm value={prefs.cutting} units={prefs.units}
            onChange={(fn) => { const c = structuredClone(prefs.cutting); fn(c); save({ cutting: c }); }} />
        </Card>
      </div>
    </Page>
  );
}

// Each language is named in its own script, whichever language the page is in.
const LANGS = [{ value: "en" as const, label: "English" }, { value: "he" as const, label: "עברית" }];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {hint ? (
        <span className="flex flex-col">
          <span className="text-[15px]">{label}</span>
          <span className="text-[13px] text-ink-2">{hint}</span>
        </span>
      ) : <span className="text-[15px]">{label}</span>}
      {children}
    </div>
  );
}
