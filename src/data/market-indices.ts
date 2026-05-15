/**
 * Read accessor for the NSE-derived monthly market-index snapshot
 * (`src/data/snapshots/market-indices-monthly.json`).
 *
 * Built by `scripts/ingest/market-indices.ts` from manually-uploaded
 * NSE daily-history CSVs under `manual-data/market/`. The snapshot
 * carries month-end levels with derived 1M / 3M / 6M / 12M returns
 * and rolling drawdown vs the historical peak.
 *
 * Helpers here are the read-only surface the dashboard consumes; they
 * never mutate the snapshot.
 */

import marketIndicesRaw from "./snapshots/market-indices-monthly.json";
import type { MarketIndexMonthlySnapshot } from "./snapshots/types";
import {
  activeEquityNetInflowSignal,
  amfiMonthlyRows,
  classifyPhase,
  historicalSignalStats,
  type CyclePhase,
} from "./amfi-monthly";

const snapshot = marketIndicesRaw as MarketIndexMonthlySnapshot;

const NIFTY_500 = "NIFTY_500";

/** Month-end rows for the requested index, sorted ascending by month.
 *  Default index is the NIFTY 500 — the only series we currently
 *  ingest. */
export function marketIndexRows(index: string = NIFTY_500) {
  return snapshot.rows
    .filter((r) => r.index === index)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Latest NIFTY 500 month-end row, or null when the snapshot is
 *  empty. */
export function latestNifty500Row() {
  const rows = marketIndexRows(NIFTY_500);
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/**
 * Market Stress Flow signal.
 *
 *   - Latest Nifty 500 month-end drawdown (from rolling all-time high)
 *   - Active-equity net inflow percentile for the same month
 *
 * The join uses the latest month present in BOTH datasets. The market
 * snapshot may lag the AMFI monthly snapshot by a month (because the
 * NSE daily file for the current month is only uploaded after
 * month-end); the AMFI net inflow for that same month is used so the
 * two halves of the signal stay aligned.
 *
 *   - "Buy-the-dip flow" — drawdown ≤ -10% AND flow percentile ≥ 60
 *   - "Flow stress"      — drawdown ≤ -10% AND flow percentile ≤ 40
 *   - "Normal"           — otherwise (or no meaningful drawdown)
 *
 * Returns null when either side is empty so the panel can drop the
 * tile rather than render placeholder values.
 */
export type MarketStressLabel =
  | "Buy-the-dip flow"
  | "Flow stress"
  | "Normal"
  | "Insufficient history";

export interface MarketStressSignal {
  alignedMonth: string;
  drawdownPct: number;
  flowValue: number;
  flowPercentileRank: number | null;
  label: MarketStressLabel;
  historyStart: string;
}

const MARKET_STRESS_DRAWDOWN_THRESHOLD_PCT = -10;
const HIGH_FLOW_PERCENTILE = 60;
const LOW_FLOW_PERCENTILE = 40;

export function marketStressFlowSignal(): MarketStressSignal | null {
  const marketRows = marketIndexRows(NIFTY_500);
  if (marketRows.length === 0) return null;

  // Build a quick lookup of active-equity flow by month so we can
  // anchor on the latest month that exists in BOTH series.
  const flowByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (typeof r.activeEquityNetInflow === "number") {
      flowByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }
  if (flowByMonth.size === 0) return null;

  // Walk market rows latest-first; pick the first one that has a
  // matching active-equity flow row.
  let aligned: { month: string; drawdownPct: number; flow: number } | null = null;
  for (let i = marketRows.length - 1; i >= 0; i--) {
    const r = marketRows[i];
    const flow = flowByMonth.get(r.month);
    if (typeof flow === "number" && typeof r.drawdownPct === "number") {
      aligned = { month: r.month, drawdownPct: r.drawdownPct, flow };
      break;
    }
  }
  if (!aligned) return null;

  // Percentile of the aligned-month flow against the full history of
  // active-equity flows (not just the prefix up to the aligned month),
  // matching the rest of the panel.
  const sig = activeEquityNetInflowSignal();
  // Use the same statistical lens as the standalone helper so the
  // numbers line up across the panel.
  const flowValues = Array.from(flowByMonth.values());
  const stats = historicalSignalStats(flowValues, aligned.flow);
  const flowPct = stats.percentileRank;

  let label: MarketStressLabel = "Normal";
  if (flowPct === null) {
    label = "Insufficient history";
  } else if (aligned.drawdownPct <= MARKET_STRESS_DRAWDOWN_THRESHOLD_PCT) {
    if (flowPct >= HIGH_FLOW_PERCENTILE) label = "Buy-the-dip flow";
    else if (flowPct <= LOW_FLOW_PERCENTILE) label = "Flow stress";
  }

  return {
    alignedMonth: aligned.month,
    drawdownPct: aligned.drawdownPct,
    flowValue: aligned.flow,
    flowPercentileRank: flowPct,
    label,
    historyStart: sig?.historyStart ?? marketRows[0].month,
  };
}

/**
 * Replay the Market Stress Flow rule across the full overlapping
 * history so the dashboard can visualise the signal across cycles
 * rather than as a single-month read. For every month where BOTH a
 * Nifty 500 drawdown and an active-equity net inflow are present,
 * emit:
 *
 *   { month, drawdownPct, flowValue, flowPercentile, label }
 *
 * Flow percentile is computed against the FULL series each month
 * (not a trailing window) so a month's label here matches the panel
 * tile's reading for that month exactly. The label uses the same
 * thresholds as `marketStressFlowSignal`.
 *
 * Returns null when there's no overlap at all.
 */
export interface FlowStressHistoryPoint {
  month: string;
  drawdownPct: number;
  flowValue: number;
  flowPercentile: number;
  label: MarketStressLabel;
}

export function flowStressHistory(): FlowStressHistoryPoint[] {
  const marketRows = marketIndexRows(NIFTY_500);
  if (marketRows.length === 0) return [];
  const flowByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (typeof r.activeEquityNetInflow === "number") {
      flowByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }
  if (flowByMonth.size === 0) return [];
  const allFlows = Array.from(flowByMonth.values());
  const out: FlowStressHistoryPoint[] = [];
  for (const r of marketRows) {
    const flow = flowByMonth.get(r.month);
    if (typeof flow !== "number" || typeof r.drawdownPct !== "number") continue;
    const stats = historicalSignalStats(allFlows, flow);
    const pct = stats.percentileRank ?? 50;
    let label: MarketStressLabel = "Normal";
    if (r.drawdownPct <= MARKET_STRESS_DRAWDOWN_THRESHOLD_PCT) {
      if (pct >= HIGH_FLOW_PERCENTILE) label = "Buy-the-dip flow";
      else if (pct <= LOW_FLOW_PERCENTILE) label = "Flow stress";
    }
    out.push({
      month: r.month,
      drawdownPct: r.drawdownPct,
      flowValue: flow,
      flowPercentile: pct,
      label,
    });
  }
  return out;
}

/**
 * Per-month cycle-phase history.
 *
 * For every month with both an active-equity net inflow and a Nifty
 * 500 drawdown reading we classify the phase using the same
 * rule-based `classifyPhase` engine the Investor Read uses. The
 * monthly active-equity flow's z-score is computed against the FULL
 * available active-equity series (so the labelling at any given
 * month uses the same statistical lens as the rest of the panel).
 *
 * Returned in chronological order. Months without overlap are
 * skipped — never imputed. Used by the Cycle Ribbon to colour
 * time-series charts and section headers by regime.
 */
export interface CyclePhasePoint {
  month: string;
  phase: CyclePhase;
  drawdownPct: number;
  flowZScore: number | null;
}

export function cyclePhaseHistory(): CyclePhasePoint[] {
  const marketRows = marketIndexRows(NIFTY_500);
  if (marketRows.length === 0) return [];
  const flowByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (typeof r.activeEquityNetInflow === "number") {
      flowByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }
  if (flowByMonth.size === 0) return [];
  // NFO mobilisation z-score is also part of the classifier so the
  // Peak label can fire. Look up by month with a sanity-filtered
  // history (same filter the NFO Heat signal uses).
  const nfoValues: number[] = [];
  const nfoByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (
      typeof r.industryNfoFundsMobilized === "number" &&
      r.industryNfoFundsMobilized <= 50_000
    ) {
      nfoByMonth.set(r.month, r.industryNfoFundsMobilized);
      nfoValues.push(r.industryNfoFundsMobilized);
    }
  }
  const allFlows = Array.from(flowByMonth.values());
  const out: CyclePhasePoint[] = [];
  for (const r of marketRows) {
    const flow = flowByMonth.get(r.month);
    if (typeof flow !== "number" || typeof r.drawdownPct !== "number") continue;
    const flowStats = historicalSignalStats(allFlows, flow);
    const nfoVal = nfoByMonth.get(r.month);
    const nfoStats =
      typeof nfoVal === "number" && nfoValues.length > 0
        ? historicalSignalStats(nfoValues, nfoVal)
        : null;
    const phase = classifyPhase({
      activeEquityZ: flowStats.zScore,
      activeEquityPercentile: flowStats.percentileRank,
      nfoZ: nfoStats?.zScore ?? null,
      passivePercentile: null,
      passiveLatestSharePct: null,
      sipPercentile: null,
      drawdownPct: r.drawdownPct,
      marketMonth: r.month,
    });
    out.push({
      month: r.month,
      phase,
      drawdownPct: r.drawdownPct,
      flowZScore: flowStats.zScore,
    });
  }
  return out;
}

/** Compact run-length encoding of the phase history for chart
 *  overlays. Adjacent same-phase months are merged into a single
 *  `{ startMonth, endMonth, phase }` run so a ribbon can render a
 *  small number of ReferenceArea/segment bands instead of one
 *  per month. */
export interface CyclePhaseRun {
  startMonth: string;
  endMonth: string;
  phase: CyclePhase;
}

export function cyclePhaseRuns(): CyclePhaseRun[] {
  const points = cyclePhaseHistory();
  if (points.length === 0) return [];
  const runs: CyclePhaseRun[] = [];
  let current: CyclePhaseRun = {
    startMonth: points[0].month,
    endMonth: points[0].month,
    phase: points[0].phase,
  };
  for (let i = 1; i < points.length; i++) {
    if (points[i].phase === current.phase) {
      current.endMonth = points[i].month;
    } else {
      runs.push(current);
      current = {
        startMonth: points[i].month,
        endMonth: points[i].month,
        phase: points[i].phase,
      };
    }
  }
  runs.push(current);
  return runs;
}

// ---- Mood Gauge + Weather Badge ---------------------------------------
//
// Two compact composite indicators built from the same five Investor
// Signals + Nifty 500 drawdown the rest of the dashboard already
// uses. The mood index returns a 0-100 value that the gauge renders
// as a needle position; the weather badge emits a 1-3 word forecast.
// Both are rule-based — no model.

export interface InvestorMood {
  /** 0 = maximally fearful, 50 = neutral, 100 = maximally greedy. */
  index: number;
  /** Plain-English label tied to the index band. */
  label:
    | "Extreme Fear"
    | "Fear"
    | "Neutral"
    | "Greed"
    | "Extreme Greed"
    | "Insufficient data";
  /** Tooltip-grade explainer. */
  methodology: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Composite Investor Mood index (0-100).
 *
 * Inputs (each contributes one of five sub-scores in 0-100):
 *   1. Active-equity flow percentile (0-100)            — direct
 *   2. NFO Heat percentile  (0-100)                     — direct (high = greedy)
 *   3. Passive Shift percentile (0-100)                 — direct
 *   4. Nifty 500 drawdown                               — mapped:
 *        0% drawdown        → 100  (max greed)
 *        −20% drawdown      → 0    (max fear)
 *        linear in between
 *   5. SIP Stickiness percentile (0-100)                — direct
 *
 * The composite is the equal-weight average of the available
 * sub-scores. Returns "Insufficient data" if no sub-score is
 * available.
 *
 * Bands:
 *   ≤ 20: Extreme Fear     21-40: Fear     41-60: Neutral
 *   61-80: Greed           ≥ 81: Extreme Greed
 */
export function investorMood(input: {
  activeEquityPercentile: number | null;
  nfoPercentile: number | null;
  passivePercentile: number | null;
  sipPercentile: number | null;
  drawdownPct: number | null;
}): InvestorMood {
  const subs: number[] = [];
  if (input.activeEquityPercentile !== null) subs.push(input.activeEquityPercentile);
  if (input.nfoPercentile !== null) subs.push(input.nfoPercentile);
  if (input.passivePercentile !== null) subs.push(input.passivePercentile);
  if (input.sipPercentile !== null) subs.push(input.sipPercentile);
  if (input.drawdownPct !== null) {
    // 0% drawdown → 100, −20% → 0, clamp anywhere outside.
    const dd = clamp(input.drawdownPct, -20, 0);
    subs.push(((dd + 20) / 20) * 100);
  }
  if (subs.length === 0) {
    return {
      index: 50,
      label: "Insufficient data",
      methodology: "Not enough data yet to score the mood index.",
    };
  }
  const index = Math.round(subs.reduce((s, v) => s + v, 0) / subs.length);
  let label: InvestorMood["label"];
  if (index <= 20) label = "Extreme Fear";
  else if (index <= 40) label = "Fear";
  else if (index <= 60) label = "Neutral";
  else if (index <= 80) label = "Greed";
  else label = "Extreme Greed";
  return {
    index,
    label,
    methodology:
      "Equal-weight composite of: active-equity flow percentile · NFO Heat percentile · Passive Shift percentile · SIP Stickiness percentile · Nifty 500 drawdown (0% = 100, −20% = 0). Bands: ≤20 Extreme Fear · 21-40 Fear · 41-60 Neutral · 61-80 Greed · ≥81 Extreme Greed.",
  };
}

/** Three-word weather-style forecast for the page header. */
export function weatherBadge(input: {
  drawdownPct: number | null;
  flowZScore: number | null;
  cyclePhase: CyclePhase | null;
}): { headline: string; tone: "sunny" | "stormy" | "neutral" } {
  const dd = input.drawdownPct;
  const z = input.flowZScore;
  const phase = input.cyclePhase;
  if (dd === null && z === null) {
    return { headline: "Awaiting data", tone: "neutral" };
  }
  // Stormy: meaningful drawdown OR weak flow.
  if ((dd !== null && dd <= -10) && (z !== null && z < 0)) {
    return { headline: `Stormy · Risk-off · ${phase ?? "Correction"}`, tone: "stormy" };
  }
  if ((dd !== null && dd <= -10) && (z !== null && z >= 0)) {
    return { headline: `Cloudy · Buying the dip · ${phase ?? "Recovery"}`, tone: "neutral" };
  }
  if (z !== null && z >= 1.5) {
    return { headline: `Sunny · Risk-on · ${phase ?? "Expansion"}`, tone: "sunny" };
  }
  if (z !== null && z >= 0) {
    return { headline: `Fair · Steady · ${phase ?? "Expansion"}`, tone: "sunny" };
  }
  return { headline: `Overcast · Mixed · ${phase ?? "Base"}`, tone: "neutral" };
}
