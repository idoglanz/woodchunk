"use client";

import { Eye, RotateCcw, RotateCw } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/misc";
import { UPRIGHT_Z, type MemberResult } from "@/lib/frame/kernel";
import type { Anchor, FrameMember } from "@/lib/frame/types";

const POINTS: { key: Exclude<Anchor, "auto">; ku: number; kv: number }[] = [
  { key: "tl", ku: -1, kv: 1 }, { key: "t", ku: 0, kv: 1 }, { key: "tr", ku: 1, kv: 1 },
  { key: "l", ku: -1, kv: 0 }, { key: "c", ku: 0, kv: 0 }, { key: "r", ku: 1, kv: 0 },
  { key: "bl", ku: -1, kv: -1 }, { key: "b", ku: 0, kv: -1 }, { key: "br", ku: 1, kv: -1 },
];

const BOX = 180; // drawing size in px
const PAD = 30;

/**
 * The bar's cross-section, to scale and the way it sits in the frame (turned by its roll; up is
 * world up, or "back" for uprights). Click one of the nine points to put the drawn line there.
 */
export function SectionEditor({ member, solved, readOnly, onAnchor, onRoll, onLookAlong }: {
  member: FrameMember; solved: MemberResult | undefined; readOnly?: boolean;
  onAnchor: (a: Anchor) => void; onRoll: (deg: number) => void; onLookAlong: () => void;
}) {
  const t = useTranslations("frame");
  if (!solved) return null;
  const pointName = (key: Exclude<Anchor, "auto">) => t(`section.points.${key}`);
  const p = solved.profile;
  const roll = ((member.roll_deg ?? 0) * Math.PI) / 180;
  const anchor = member.anchor ?? "auto";
  const upright = Math.abs(solved.x[2]) > UPRIGHT_Z;
  // A profile point (u, v) seen in the bar's unturned frame: rotate by the roll.
  const turn = (u: number, v: number): [number, number] => [u * Math.cos(roll) - v * Math.sin(roll), u * Math.sin(roll) + v * Math.cos(roll)];
  const w2 = p.w / 2, h2 = p.h / 2;
  const extent = Math.max(...[[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]].map(([u, v]) => Math.max(...turn(u, v).map(Math.abs))));
  const k = (BOX / 2 - PAD) / extent;
  const toSvg = (u: number, v: number) => { const [x, y] = turn(u, v); return [BOX / 2 + x * k, BOX / 2 - y * k] as const; };
  const path = p.loops().map((loop) => "M" + loop.map(([u, v]) => toSvg(u, v).map((n) => n.toFixed(1)).join(",")).join("L") + "Z").join("");
  // Where the line runs now (the automatic choice included).
  const [cu, cv] = solved.anchor_uv;
  const current = POINTS.find((pt) => Math.abs(pt.ku * w2 - cu) < 0.01 && Math.abs(pt.kv * h2 - cv) < 0.01);
  const deg = Math.round(member.roll_deg ?? 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium tracking-[0.01em] text-ink-2">{t("section.title")}</span>
        <span className="tnum text-[12px] text-ink-3"><Ltr>{p.w} × {p.h}{p.t ? ` × ${p.t}` : ""}</Ltr></span>
      </div>
      <div className="flex items-center gap-3">
        <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} role="group" aria-label={t("section.aria")} className="shrink-0 rounded-[12px] bg-surface-2">
          <text x={BOX / 2} y={13} textAnchor="middle" fontSize="10" fill="var(--ink-3)">↑ {upright ? t("section.back") : t("section.up")}</text>
          <path d={path} fillRule="evenodd" fill="var(--steel-3d)" stroke="var(--line-strong)" strokeWidth={1} />
          {POINTS.map((pt) => {
            const [x, y] = toSvg(pt.ku * w2, pt.kv * h2);
            const on = current?.key === pt.key;
            const chosen = anchor === pt.key;
            return (
              <g key={pt.key}>
                <circle cx={x} cy={y} r={on ? 7 : 5} fill={on ? "var(--accent)" : "var(--surface)"}
                  stroke={on ? "var(--ink)" : "var(--line-strong)"} strokeWidth={on ? 1.5 : 1} strokeDasharray={on && !chosen ? "2 2" : undefined} />
                {on ? <path d={`M${x - 3} ${y - 3}L${x + 3} ${y + 3}M${x + 3} ${y - 3}L${x - 3} ${y + 3}`} stroke="var(--ink)" strokeWidth={1.3} /> : null}
                {!readOnly ? (
                  <circle cx={x} cy={y} r={12} fill="transparent" className="cursor-pointer" role="button" tabIndex={0}
                    aria-label={t("section.runAlong", { point: pointName(pt.key) })} aria-pressed={chosen}
                    onClick={() => onAnchor(pt.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAnchor(pt.key); } }}>
                    <title>{t("section.lineAlong", { point: pointName(pt.key) })}</title>
                  </circle>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-[12px] leading-snug text-ink-2">
            {anchor === "auto" ? t.rich("section.automatic", { point: pointName(current?.key ?? "c"), b: (c) => <b className="font-medium text-ink">{c}</b> })
              : t.rich("section.lineAlongRich", { point: current ? pointName(current.key) : "", b: (c) => <b className="font-medium text-ink">{c}</b> })}
          </p>
          {!readOnly ? <>
            {anchor !== "auto" ? <Button size="sm" variant="ghost" className="self-start" onClick={() => onAnchor("auto")}>{t("section.backToAuto")}</Button> : null}
            <div className="flex items-center gap-1">
              <Button size="sm" icon={<RotateCcw size={14} />} aria-label={t("section.turnBack")} onClick={() => onRoll(deg - 90)} />
              <span className="tnum w-12 text-center text-[13px] font-medium">{(((deg % 360) + 360) % 360)}°</span>
              <Button size="sm" icon={<RotateCw size={14} />} aria-label={t("section.turn")} onClick={() => onRoll(deg + 90)} />
            </div>
          </> : null}
          <Button size="sm" variant="ghost" icon={<Eye size={14} />} className="self-start" onClick={onLookAlong}>{t("section.lookAlong")}</Button>
        </div>
      </div>
    </div>
  );
}
