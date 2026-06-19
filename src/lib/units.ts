/**
 * Unit helpers for the percentage-point → basis-point standardisation.
 * 1 percentage point (pp) = 100 basis points (bps), so converting a pp value to
 * bps means multiplying by 100 (e.g. −4.3 pp → −430 bps, +0.32 pp → +32 bps).
 */

/** Integer basis points from a percentage-point value. */
export function ppToBps(pp: number): number {
  return Math.round(pp * 100);
}

/**
 * Format a percentage-point delta as signed basis points:
 *   +4.3 pp → "+430 bps",  −0.32 pp → "−32 bps",  0 → "0 bps".
 * Indian-grouped for large values. Pass { sign: false } to drop the leading "+".
 */
export function fmtBps(pp: number | null | undefined, opts?: { sign?: boolean }): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  const bps = ppToBps(pp);
  const lead = opts?.sign === false ? "" : bps > 0 ? "+" : bps < 0 ? "−" : "";
  return `${lead}${Math.abs(bps).toLocaleString("en-IN")} bps`;
}
