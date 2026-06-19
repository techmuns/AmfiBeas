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
 * At/above this magnitude a value reads more clearly in percentage points than
 * in basis points (e.g. a +45.8 pp return lead is "+45.8 pp", not "+4,580 bps").
 * 500 bps = 5 pp: small allocation/share/weight deltas stay in bps; large
 * return / margin gaps fall back to pp.
 */
const PP_OVER_BPS = 500;

/**
 * Format a percentage-point delta, standardised to basis points for normal
 * magnitudes and falling back to percentage points once it gets large:
 *   +0.32 pp → "+32 bps",  −4.3 pp → "−430 bps",  +45.8 pp → "+45.8 pp".
 * Indian-grouped for large bps. Pass { sign: false } to drop the leading "+".
 */
export function fmtBps(pp: number | null | undefined, opts?: { sign?: boolean }): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  const bps = ppToBps(pp);
  const lead = opts?.sign === false ? "" : bps > 0 ? "+" : bps < 0 ? "−" : "";
  if (Math.abs(bps) >= PP_OVER_BPS) {
    return `${lead}${Math.abs(pp).toFixed(1)} pp`;
  }
  return `${lead}${Math.abs(bps).toLocaleString("en-IN")} bps`;
}

