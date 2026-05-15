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
  historicalSignalStats,
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
