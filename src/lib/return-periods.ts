/**
 * Shared period definitions + return math for the NAV and benchmark engines.
 *
 * Extracted verbatim from scripts/ingest/nav-returns.ts (Phase 3.3A/3.6A/3.8A)
 * so the fund feed, the benchmark feed and the API's comparability checks cannot
 * drift: an alpha number is only meaningful if every side anchors the same way.
 * Lives under src/lib because the runtime API needs it too.
 *
 * Conventions, unchanged:
 *  - The period target is CALENDAR arithmetic on the as-of date, with the
 *    day-of-month clamped to the target month's length (subPeriod).
 *  - The start observation is the NEAREST-PRIOR one — the last available
 *    trading day on/before the target — never an interpolation.
 *  - 1M / 3M / 6M / 1Y are SIMPLE point-to-point returns.
 *  - 3Y / 5Y / 10Y are CAGR over the ACTUAL elapsed years between the resolved
 *    start and end dates (not the nominal 3.0/5.0/10.0), with 365.25-day years.
 */

export type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y";

export type PeriodSpec =
  | { key: "1M" | "3M" | "6M" | "1Y"; months: number; years: number; kind: "simple" }
  | { key: "3Y"; months: 0; years: 3; kind: "cagr" }
  | { key: "5Y"; months: 0; years: 5; kind: "cagr" }
  | { key: "10Y"; months: 0; years: 10; kind: "cagr" };

export const PERIOD_SPECS: PeriodSpec[] = [
  { key: "1M", months: 1, years: 0, kind: "simple" },
  { key: "3M", months: 3, years: 0, kind: "simple" },
  { key: "6M", months: 6, years: 0, kind: "simple" },
  { key: "1Y", months: 0, years: 1, kind: "simple" },
  { key: "3Y", months: 0, years: 3, kind: "cagr" },
  { key: "5Y", months: 0, years: 5, kind: "cagr" },
  { key: "10Y", months: 0, years: 10, kind: "cagr" },
];

export const PERIOD_KEYS: PeriodKey[] = PERIOD_SPECS.map((p) => p.key);

/** Calendar shift back by `months` + `years`, clamping the day to the target
 *  month's length (so 31 Mar − 1M → 28/29 Feb). */
export function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Elapsed years between two ISO dates, computed deterministically in UTC.
 *  365.25 absorbs leap years. */
export function elapsedYears(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return (endMs - startMs) / (86400_000 * 365.25);
}

/** Whole calendar days between two ISO dates (endIso − startIso). */
export function daysBetween(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400_000);
}

export function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** Simple point-to-point return in percent. */
export function simpleReturnPct(startValue: number, endValue: number): number {
  return (endValue / startValue - 1) * 100;
}

/** CAGR in percent over `years` actual elapsed years. */
export function cagrPct(startValue: number, endValue: number, years: number): number {
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

/**
 * Compute one period's return from two observations, applying the period's own
 * convention. Returns null when the inputs can't support an honest number.
 */
export function periodReturnPct(
  spec: PeriodSpec,
  start: { date: string; value: number },
  end: { date: string; value: number }
): { value: number; years?: number } | null {
  if (!(start.value > 0) || !(end.value > 0)) return null;
  if (spec.kind === "simple") {
    const v = simpleReturnPct(start.value, end.value);
    return Number.isFinite(v) ? { value: v } : null;
  }
  const years = elapsedYears(start.date, end.date);
  if (!(years > 0)) return null;
  const v = cagrPct(start.value, end.value, years);
  return Number.isFinite(v) ? { value: v, years } : null;
}
