export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="var(--ink)" />
      <rect x="10" y="22" width="44" height="20" rx="4" fill="var(--accent)" />
      <path d="M18 22v8M26 22v5M34 22v8M42 22v5M50 22v8" stroke="#1d1d1f" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
