import type { CatalogItem } from "@/lib/api/client";
import { Profile } from "@/lib/frame/kernel";

/**
 * A to-scale end view of a material: a lumber cross-section (70 × 70 is a square,
 * 22 × 200 a thin plank), a metal bar's real section (tube, angle, channel), or a sheet seen
 * edge-on (ply layers for plywood, solid for MDF).
 */
export function SectionGlyph({ item, size = 30 }: { item: Pick<CatalogItem, "kind" | "thickness_mm" | "width_mm" | "has_grain" | "material" | "profile">; size?: number }) {
  const pad = 2;
  const box = size - pad * 2;
  if (item.kind === "lumber" && item.profile) {
    const p = Profile.from(item.profile);
    const k = box / Math.max(p.w, p.h);
    // Profile v is up; SVG y runs down.
    const d = p.loops().map((loop) => "M" + loop.map(([u, v]) => `${(size / 2 + u * k).toFixed(2)},${(size / 2 - v * k).toFixed(2)}`).join("L") + "Z").join("");
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
        <path d={d} fillRule="evenodd" fill="var(--steel-3d)" stroke="var(--line-strong)" strokeWidth={0.8} />
      </svg>
    );
  }
  if (item.kind === "lumber" && item.thickness_mm && item.width_mm) {
    const t = item.thickness_mm;
    const w = item.width_mm;
    const scale = box / Math.max(t, w);
    const rw = Math.max(2.5, w * scale);
    const rh = Math.max(2.5, t * scale);
    const x = (size - rw) / 2;
    const y = (size - rh) / 2;
    const id = `sg-${Math.round(t)}-${Math.round(w)}`;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
        <defs><clipPath id={id}><rect x={x} y={y} width={rw} height={rh} rx={1} /></clipPath></defs>
        <rect x={x} y={y} width={rw} height={rh} rx={1} fill="var(--asm-a)" />
        <g clipPath={`url(#${id})`} fill="none" stroke="var(--asm-a-ink)" strokeOpacity={0.22} strokeWidth={0.8}>
          {[0.45, 0.9, 1.4, 2].map((k) => (
            <circle key={k} cx={x + rw * 0.35} cy={y + rh * 1.15} r={Math.max(rw, rh) * k * 0.55} />
          ))}
        </g>
        <rect x={x} y={y} width={rw} height={rh} rx={1} fill="none" stroke="var(--line-strong)" strokeWidth={0.8} />
      </svg>
    );
  }
  if (item.kind === "sheet") {
    const t = item.thickness_mm ?? 12;
    const rh = Math.max(2.5, Math.min(box * 0.6, (t / 30) * box));
    const y = (size - rh) / 2;
    const plywood = item.has_grain && (item.material ?? "").includes("ply");
    const plies = plywood ? Math.max(2, Math.min(7, Math.round(t / 3))) : 0;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
        <rect x={pad} y={y} width={box} height={rh} rx={0.8} fill={item.has_grain ? "var(--asm-a)" : "var(--surface-3)"} />
        {Array.from({ length: Math.max(0, plies - 1) }, (_, i) => (
          <line key={i} x1={pad} x2={pad + box} y1={y + ((i + 1) * rh) / plies} y2={y + ((i + 1) * rh) / plies}
            stroke="var(--asm-a-ink)" strokeOpacity={0.3} strokeWidth={0.6} />
        ))}
        <rect x={pad} y={y} width={box} height={rh} rx={0.8} fill="none" stroke="var(--line-strong)" strokeWidth={0.8} />
      </svg>
    );
  }
  return <span aria-hidden="true" style={{ width: size, height: size }} className="shrink-0" />;
}

export function sectionLabel(item: Pick<CatalogItem, "kind" | "thickness_mm" | "width_mm">): string {
  const f = (n: number) => String(Math.round(n * 10) / 10);
  if (item.kind === "lumber" && item.thickness_mm && item.width_mm) return `${f(item.thickness_mm)} × ${f(item.width_mm)}`;
  if (item.kind === "sheet" && item.thickness_mm) return `${f(item.thickness_mm)} mm`;
  return "";
}
