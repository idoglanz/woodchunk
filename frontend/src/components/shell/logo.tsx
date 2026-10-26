import { useId } from "react";

const RINGS = [7, 14, 21.5, 29.5, 38];

/** End grain: growth rings on a tape-yellow tile. */
export function Logo({ size = 26 }: { size?: number }) {
  const clip = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs><clipPath id={clip}><rect width="64" height="64" rx="15" /></clipPath></defs>
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <g clipPath={`url(#${clip})`} fill="none" stroke="var(--accent-ink)" strokeWidth="2.4">
        {RINGS.map((r) => <circle key={r} cx="22" cy="44" r={r} />)}
      </g>
      <circle cx="22" cy="44" r="2.2" fill="var(--accent-ink)" />
    </svg>
  );
}
