/** Lengths are stored in millimetres; people type whatever they like. */

export type Units = "mm" | "cm";

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4, ft: 304.8, "'": 304.8 };

/**
 * Parse "800", "80cm", "0.8 m", "31.5in", '31.5"', "80,5" into millimetres.
 * A bare number is read in the user's display unit. Returns null when not a length.
 */
export function parseLength(input: string, units: Units = "mm"): number | null {
  const s = input.trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)(mm|cm|m|in|"|ft|')?$/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2] ?? units;
  const mm = value * (UNIT_MM[unit] ?? 1);
  if (!Number.isFinite(mm) || mm < 0) return null;
  return Math.round(mm * 10) / 10;
}

/** Value to show in an input, in the user's unit, without the unit. */
export function lengthInput(mm: number | null | undefined, units: Units = "mm"): string {
  if (mm === null || mm === undefined || mm === 0) return "";
  const v = units === "cm" ? mm / 10 : mm;
  return String(Math.round(v * 10) / 10);
}

/** Display a length with its unit, e.g. "800 mm" or "80 cm". */
export function fmtLength(mm: number, units: Units = "mm"): string {
  return `${lengthInput(mm, units) || "0"} ${units}`;
}

/** Stock lengths read best in metres: "3.0 m". */
export function fmtMeters(mm: number): string {
  return `${(mm / 1000).toFixed(1)} m`;
}

export function fmtDims(a: number, b?: number | null): string {
  return b ? `${trim(a)} × ${trim(b)}` : trim(a);
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}
