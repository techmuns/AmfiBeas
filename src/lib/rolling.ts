/**
 * Rolling-return helpers for the Returns & Ranking tab. Pure, client-safe
 * (no node deps): given a fund's daily [isoDate, value] series, compute the
 * return over a fixed window ending at every day, then summarise.
 *
 * Convention (matches the point-to-point KPIs): ≤1Y windows are absolute
 * returns, multi-year windows are annualised (CAGR). Offered windows are
 * 6M / 1Y / 3Y / 5Y — 1M/3M are too noisy and 10Y has too few windows over a
 * ~10-year history.
 */

export type RollingWindow = "6M" | "1Y" | "3Y" | "5Y";
export const ROLLING_WINDOWS: RollingWindow[] = ["6M", "1Y", "3Y", "5Y"];

interface WindowSpec {
  months: number;
  years: number;
  cagr: boolean;
}
const SPEC: Record<RollingWindow, WindowSpec> = {
  "6M": { months: 6, years: 0, cagr: false },
  "1Y": { months: 0, years: 1, cagr: false },
  "3Y": { months: 0, years: 3, cagr: true },
  "5Y": { months: 0, years: 5, cagr: true },
};

/** True when the window is annualised (CAGR) rather than an absolute return. */
export function isRollingCagr(w: RollingWindow): boolean {
  return SPEC[w].cagr;
}

/** Subtract N months / years from an ISO date (UTC, clamped to month length). */
function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) {
    nm += 12;
    ny -= 1;
  }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Elapsed years between two ISO dates (UTC, 365.25-day years). */
function elapsedYears(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  return (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / (86400_000 * 365.25);
}

export interface RollingPoint {
  date: string; // window END date (ISO)
  value: number; // % return over the window (annualised for multi-year)
}

/**
 * Rolling return over `window`, computed at every day that has a valid anchor
 * `window` ago (nearest-prior). Two-pointer over the ascending series, O(n).
 */
export function rollingReturns(
  series: Array<[string, number]>,
  window: RollingWindow,
): RollingPoint[] {
  const spec = SPEC[window];
  const out: RollingPoint[] = [];
  if (series.length < 2) return out;
  let j = 0; // nearest-prior anchor index, advances monotonically with `target`
  for (let i = 0; i < series.length; i++) {
    const endDate = series[i][0];
    const endVal = series[i][1];
    if (!(endVal > 0)) continue;
    const target = subPeriod(endDate, spec.months, spec.years);
    if (series[0][0] > target) continue; // window predates the history
    while (j + 1 < series.length && series[j + 1][0] <= target) j++;
    if (series[j][0] > target) continue;
    const startVal = series[j][1];
    if (!(startVal > 0)) continue;
    let rr: number;
    if (spec.cagr) {
      const yrs = elapsedYears(series[j][0], endDate);
      if (!(yrs > 0)) continue;
      rr = (Math.pow(endVal / startVal, 1 / yrs) - 1) * 100;
    } else {
      rr = (endVal / startVal - 1) * 100;
    }
    if (Number.isFinite(rr)) out.push({ date: endDate, value: rr });
  }
  return out;
}

export interface RollingStats {
  avg: number;
  median: number;
  min: number;
  max: number;
  pctPositive: number;
  count: number;
}

/** Summary statistics over a rolling-return series. Null when empty. */
export function rollingStats(points: RollingPoint[]): RollingStats | null {
  if (points.length === 0) return null;
  const vals = points.map((p) => p.value);
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = vals.reduce((s, v) => s + v, 0) / n;
  const median =
    n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const pctPositive = (vals.filter((v) => v >= 0).length / n) * 100;
  return { avg, median, min: sorted[0], max: sorted[n - 1], pctPositive, count: n };
}
