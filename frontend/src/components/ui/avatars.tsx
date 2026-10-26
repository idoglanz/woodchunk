import { cn } from "@/lib/cn";

const TONES = ["a", "b", "c", "d", "e", "f"];

/** "Dana Levi" → "DL", "dana@x.com" → "DX". */
export function initialsOf(name: string): string {
  return name.split(/[\s@._-]/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("") || "?";
}

/** The same colour for a person everywhere. */
function toneOf(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/**
 * Overlapping initials for the people in a project, the first few and "+N". `ring` is the colour
 * around each circle, matching what they sit on.
 */
export function Avatars({ people, max = 4, size = 26, ring = "var(--bg)", className }: {
  people: { user_id: string; name: string }[]; max?: number; size?: number; ring?: string; className?: string;
}) {
  if (!people.length) return null;
  const shown = people.slice(0, people.length > max ? max - 1 : max);
  const more = people.length - shown.length;
  const circle = "flex shrink-0 items-center justify-center rounded-full font-semibold";
  const style = (bg: string, fg: string) => ({
    width: size, height: size, fontSize: Math.round(size * 0.4), background: bg, color: fg, boxShadow: `0 0 0 2px ${ring}`,
  });
  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((p, i) => (
        <span key={p.user_id} title={p.name} className={cn(circle, i > 0 && "-ms-1.5")}
          style={style(`var(--asm-${toneOf(p.user_id)})`, `var(--asm-${toneOf(p.user_id)}-ink)`)}>
          {initialsOf(p.name)}
        </span>
      ))}
      {more > 0 ? <span className={cn(circle, "-ms-1.5")} style={style("var(--surface-2)", "var(--ink-2)")}>+{more}</span> : null}
    </span>
  );
}
