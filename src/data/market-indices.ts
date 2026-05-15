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

// ---- Historical Episodes (Cycle Replay) -------------------------------
//
// Mines the overlapping AMFI + Nifty 500 history for distinct
// drawdown "episodes": contiguous stretches where the rolling
// drawdown stayed below a threshold (default −7%). Each episode is
// summarised with depth, length, and the active-equity flow
// behaviour during it. Used by the replay strip to show how
// investors behaved across multiple cycles in a single image.

export interface HistoricalEpisode {
  /** Friendly title (e.g. "COVID 2020"). */
  title: string;
  startMonth: string;
  endMonth: string;
  /** Months covered by the episode (length of the contiguous stretch). */
  monthCount: number;
  /** Maximum drawdown (most negative) reached during the episode. */
  maxDrawdownPct: number;
  /** Sum of active-equity net inflows during the episode (₹ Cr). */
  totalActiveEquityFlow: number;
  /** Average active-equity flow z-score during the episode. */
  avgFlowZScore: number | null;
  /** One-line investor-behaviour read. */
  read: string;
}

const KNOWN_EPISODE_TITLES: { startMonth: string; title: string }[] = [
  { startMonth: "2020-02", title: "COVID 2020" },
  { startMonth: "2020-03", title: "COVID 2020" },
  { startMonth: "2022-04", title: "FY23 correction" },
  { startMonth: "2022-05", title: "FY23 correction" },
  { startMonth: "2022-06", title: "FY23 correction" },
  { startMonth: "2024-08", title: "FY25 mid-cycle" },
  { startMonth: "2024-09", title: "FY25 mid-cycle" },
  { startMonth: "2024-10", title: "FY25 mid-cycle" },
  { startMonth: "2025-12", title: "FY26 correction" },
  { startMonth: "2026-01", title: "FY26 correction" },
  { startMonth: "2026-02", title: "FY26 correction" },
  { startMonth: "2026-03", title: "FY26 correction" },
];

function defaultEpisodeTitle(start: string, end: string): string {
  const [y1] = start.split("-");
  const [y2] = end.split("-");
  return y1 === y2 ? `Drawdown ${y1}` : `Drawdown ${y1}–${y2}`;
}

/**
 * Slice the cycle-phase history into contiguous "drawdown episodes"
 * — stretches where the Nifty 500 drawdown stayed at or below the
 * threshold for at least `minLength` months.
 */
export function historicalEpisodes(
  thresholdPct = -7,
  minLength = 2
): HistoricalEpisode[] {
  const points = cyclePhaseHistory();
  if (points.length === 0) return [];
  // Build a quick map of active-equity flow z-score per month.
  const zByMonth = new Map<string, number | null>();
  for (const p of points) zByMonth.set(p.month, p.flowZScore);
  // Also pull raw active-equity flow values for the totals column.
  const flowByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (typeof r.activeEquityNetInflow === "number") {
      flowByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }

  const episodes: HistoricalEpisode[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const inDrawdown = p.drawdownPct <= thresholdPct;
    if (inDrawdown && runStart === null) {
      runStart = i;
    } else if (!inDrawdown && runStart !== null) {
      const slice = points.slice(runStart, i);
      if (slice.length >= minLength) {
        episodes.push(buildEpisode(slice, flowByMonth, zByMonth));
      }
      runStart = null;
    }
  }
  // Close trailing run.
  if (runStart !== null) {
    const slice = points.slice(runStart);
    if (slice.length >= minLength) {
      episodes.push(buildEpisode(slice, flowByMonth, zByMonth));
    }
  }
  // Sort by max drawdown (deepest first), keep top 6.
  episodes.sort((a, b) => a.maxDrawdownPct - b.maxDrawdownPct);
  return episodes.slice(0, 6);
}

function buildEpisode(
  slice: CyclePhasePoint[],
  flowByMonth: Map<string, number>,
  zByMonth: Map<string, number | null>
): HistoricalEpisode {
  const startMonth = slice[0].month;
  const endMonth = slice[slice.length - 1].month;
  const maxDrawdownPct = slice.reduce(
    (acc, p) => (p.drawdownPct < acc ? p.drawdownPct : acc),
    0
  );
  const totalFlow = slice.reduce(
    (s, p) => s + (flowByMonth.get(p.month) ?? 0),
    0
  );
  const zValues = slice
    .map((p) => zByMonth.get(p.month))
    .filter((v): v is number => typeof v === "number");
  const avgZ =
    zValues.length > 0
      ? zValues.reduce((s, v) => s + v, 0) / zValues.length
      : null;
  const knownTitle = KNOWN_EPISODE_TITLES.find(
    (k) => k.startMonth === startMonth
  );
  const title = knownTitle
    ? knownTitle.title
    : defaultEpisodeTitle(startMonth, endMonth);
  // Behavioural read.
  let read: string;
  if (avgZ !== null && avgZ >= 0.5) {
    read = "Investors leaned in — flows above norm despite the drawdown";
  } else if (avgZ !== null && avgZ <= -0.5) {
    read = "Investors pulled back — flows ran below norm during the drawdown";
  } else {
    read = "Investors stayed steady — flows close to long-run norm";
  }
  return {
    title,
    startMonth,
    endMonth,
    monthCount: slice.length,
    maxDrawdownPct,
    totalActiveEquityFlow: totalFlow,
    avgFlowZScore: avgZ,
    read,
  };
}

// ---- Live Narrative Composer ------------------------------------------
//
// Three-paragraph executive summary generated from the same five
// signals + cycle phase the rest of the dashboard already uses. No
// model — just rules. Designed to read like a markets column
// opening: what changed, what it means, what to watch.

export interface ComposedNarrative {
  /** Opening paragraph: what changed this month. */
  opening: string;
  /** Middle paragraph: what it means in context (cycle, history). */
  middle: string;
  /** Closing paragraph: what to watch next. */
  closing: string;
}

export function narrativeComposer(input: {
  latestMonth: string | null;
  activeEquity: { value: number | null; zScore: number | null; percentile: number | null } | null;
  nfo: { zScore: number | null; percentile: number | null } | null;
  passive: { latestSharePct: number | null; percentile: number | null } | null;
  sip: { latestSharePct: number | null; percentile: number | null } | null;
  drawdownPct: number | null;
  cyclePhase: CyclePhase | null;
}): ComposedNarrative | null {
  if (!input.latestMonth) return null;
  const ae = input.activeEquity;
  const nfo = input.nfo;
  const passive = input.passive;
  const sip = input.sip;
  const dd = input.drawdownPct;
  const phase = input.cyclePhase;

  // Opening: lead with the active-equity flow + cycle headline.
  const open: string[] = [];
  if (ae && ae.value !== null && ae.percentile !== null) {
    const flowStrength =
      ae.percentile >= 90
        ? "ran exceptionally hot"
        : ae.percentile >= 70
          ? "ran above the long-run norm"
          : ae.percentile <= 10
            ? "ran exceptionally cold"
            : ae.percentile <= 30
              ? "ran below the long-run norm"
              : "stayed close to its historical norm";
    open.push(
      `In ${input.latestMonth}, active-equity inflows ${flowStrength}` +
        (ae.percentile !== null
          ? ` — ${ae.percentile.toFixed(0)}th percentile of months on record.`
          : ".")
    );
  }
  if (dd !== null) {
    if (dd <= -10) {
      open.push(
        `Markets entered the month under pressure, with the Nifty 500 ${Math.abs(dd).toFixed(1)}% off its peak.`
      );
    } else if (dd <= -3) {
      open.push(
        `The Nifty 500 sat ${Math.abs(dd).toFixed(1)}% off its all-time high, hovering between expansion and pullback.`
      );
    } else {
      open.push(
        `The Nifty 500 traded within ${Math.abs(dd).toFixed(1)}% of its all-time high.`
      );
    }
  }
  if (open.length === 0) {
    open.push(`Latest data point: ${input.latestMonth}.`);
  }

  // Middle: historical context + secondary signals.
  const mid: string[] = [];
  if (phase) {
    mid.push(`The composite rules place the cycle in **${phase}** territory.`);
  }
  if (passive && passive.latestSharePct !== null && passive.percentile !== null) {
    if (passive.percentile >= 80) {
      mid.push(
        `Passive funds command ${passive.latestSharePct.toFixed(1)}% of equity AUM — near the high end of the available history.`
      );
    } else if (passive.percentile <= 20) {
      mid.push(
        `Passive funds account for ${passive.latestSharePct.toFixed(1)}% of equity AUM — toward the low end of recent history.`
      );
    } else {
      mid.push(
        `Passive funds command ${passive.latestSharePct.toFixed(1)}% of equity AUM, broadly in line with recent norms.`
      );
    }
  }
  if (nfo && nfo.percentile !== null) {
    if (nfo.percentile >= 80) {
      mid.push(
        "NFO mobilisation is at the high end of history — historically a bull-market cue, not a buy signal in itself."
      );
    } else if (nfo.percentile <= 20) {
      mid.push(
        "NFO mobilisation is subdued — investors are favouring existing schemes over new launches."
      );
    }
  }
  if (sip && sip.percentile !== null && sip.percentile >= 70) {
    mid.push(
      `SIP-anchored AUM share continues to grind higher (${sip.percentile.toFixed(0)}th percentile of available history) — the structural base keeps strengthening.`
    );
  }
  if (mid.length === 0) {
    mid.push("Secondary signals were close to historical norms this month.");
  }

  // Closing: forward-looking watch list.
  const close: string[] = [];
  if (dd !== null && dd <= -10 && ae && ae.zScore !== null && ae.zScore >= 0) {
    close.push(
      "Watch for the duration of the inflow strength: sustained buying through a drawdown is a positive structural signal, but the market needs to confirm with a recovery."
    );
  } else if (dd !== null && dd <= -10) {
    close.push(
      "Watch for the next month's flow read: if active-equity flows turn higher while the index remains under pressure, that flips the signal toward Recovery."
    );
  } else if (ae && ae.zScore !== null && ae.zScore >= 1.5 && nfo && nfo.zScore !== null && nfo.zScore >= 1) {
    close.push(
      "Watch for froth signs: when both flow and NFO sit above +1σ simultaneously, the cycle has historically been close to a peak."
    );
  } else {
    close.push(
      "Watch for cross-signal moves next month: a flip in flow direction or a step-change in passive share would be the first cue that the cycle is rotating."
    );
  }

  return {
    opening: open.join(" "),
    middle: mid.join(" "),
    closing: close.join(" "),
  };
}
