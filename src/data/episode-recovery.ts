/**
 * Episode Recovery Tracker
 *
 * For each historical drawdown episode (COVID 2020, FY23 correction,
 * FY25 mid-cycle, FY26 correction) compute how active-equity flow
 * behaved around the event:
 *   - the pre-episode baseline (trailing-3M average flow BEFORE the
 *     episode started)
 *   - the trough month (lowest flow inside the episode window)
 *   - the recovery month (first month AFTER the trough where flow
 *     ≥ baseline)
 *   - recovery duration in months (null when not yet recovered)
 *
 * Surfaces the question: "how long did it take investors to come
 * back?" — backs up the dashboard's regime narrative with hard
 * recovery latencies.
 *
 * Pure data layer — no UI imports.
 */
import { amfiMonthlyRows } from "./amfi-monthly";
import { historicalEpisodes } from "./market-indices";

export interface EpisodeRecoveryRow {
  title: string;
  startMonth: string;
  endMonth: string;
  /** Trailing-3M average active-equity net inflow BEFORE the episode
   *  started — the baseline the recovery must clear. May be negative
   *  if the lead-in was already running at outflow. */
  preBaselineFlow: number;
  /** Lowest active-equity net inflow during the episode window. */
  troughMonth: string;
  troughFlow: number;
  /** Trough flow expressed as a % of the baseline — typically a
   *  large negative number. Null when the baseline is ≤ 0 (the %
   *  comparison wouldn't be meaningful). */
  troughVsBaselinePct: number | null;
  /** First month strictly AFTER the trough where the flow returned
   *  to or above the pre-baseline. Null if recovery hasn't happened
   *  yet on the current snapshot. */
  recoveryMonth: string | null;
  /** Months between trough and recovery. Null when recovery hasn't
   *  happened yet. */
  recoveryMonths: number | null;
}

const BASELINE_WINDOW = 3;

/** Compute month difference between two YYYY-MM strings. Returns
 *  a >= 0 when `b` is at or after `a`. */
function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function episodeRecoveryRows(): EpisodeRecoveryRow[] {
  const rows = amfiMonthlyRows();
  const flowByMonth = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.activeEquityNetInflow === "number") {
      flowByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }
  if (flowByMonth.size === 0) return [];
  // Sorted month list — lets us walk forward from the trough.
  const sortedMonths = Array.from(flowByMonth.keys()).sort();

  const out: EpisodeRecoveryRow[] = [];
  for (const ep of historicalEpisodes()) {
    // Pre-baseline = avg of the BASELINE_WINDOW months immediately
    // before startMonth. Skip the episode if we can't form a
    // baseline.
    const startIdx = sortedMonths.indexOf(ep.startMonth);
    if (startIdx === -1) continue;
    const baselineSlice = sortedMonths.slice(
      Math.max(0, startIdx - BASELINE_WINDOW),
      startIdx
    );
    if (baselineSlice.length === 0) continue;
    const baselineValues = baselineSlice
      .map((m) => flowByMonth.get(m))
      .filter((v): v is number => typeof v === "number");
    if (baselineValues.length === 0) continue;
    const preBaselineFlow =
      baselineValues.reduce((s, v) => s + v, 0) / baselineValues.length;

    // Walk episode window to find the trough.
    let troughMonth: string | null = null;
    let troughFlow = Infinity;
    for (
      let i = sortedMonths.indexOf(ep.startMonth);
      i <= sortedMonths.indexOf(ep.endMonth) && i >= 0 && i < sortedMonths.length;
      i++
    ) {
      const m = sortedMonths[i];
      const v = flowByMonth.get(m);
      if (typeof v !== "number") continue;
      if (v < troughFlow) {
        troughFlow = v;
        troughMonth = m;
      }
    }
    if (troughMonth === null) continue;

    // Walk forward from the month AFTER the trough until flow
    // returns to or above the baseline.
    let recoveryMonth: string | null = null;
    const troughIdx = sortedMonths.indexOf(troughMonth);
    for (let i = troughIdx + 1; i < sortedMonths.length; i++) {
      const v = flowByMonth.get(sortedMonths[i]);
      if (typeof v !== "number") continue;
      if (v >= preBaselineFlow) {
        recoveryMonth = sortedMonths[i];
        break;
      }
    }
    const recoveryMonths =
      recoveryMonth !== null ? monthDiff(troughMonth, recoveryMonth) : null;

    out.push({
      title: ep.title,
      startMonth: ep.startMonth,
      endMonth: ep.endMonth,
      preBaselineFlow,
      troughMonth,
      troughFlow,
      troughVsBaselinePct:
        preBaselineFlow > 0
          ? ((troughFlow - preBaselineFlow) / preBaselineFlow) * 100
          : null,
      recoveryMonth,
      recoveryMonths,
    });
  }
  // Newest episode first so the reader sees the most relevant
  // recovery at the top.
  out.sort((a, b) => b.startMonth.localeCompare(a.startMonth));
  return out;
}
