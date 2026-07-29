import data from "./portfolio-tracker/insights-plus.json";

/**
 * The "deep read" Insights blocks, precomputed by scripts/build-insights-plus.ts
 * from the AMC-direct monthly disclosures plus the NAV snapshots:
 *
 *   convictionLedger — position changes split NEW / ADDED / TRIMMED / EXITED,
 *                      by cap tier, with ₹ value AND company counts.
 *   contested        — names fund houses disagreed on in the same month.
 *   churn            — per-AMC portfolio turnover, min(buys, sells) ÷ avg book.
 *   flowsVsPerf      — 3Y category percentile vs implied net flow, four quadrants.
 *   persistence      — quartile transition matrix over two 3-year blocks.
 *
 * Every month-over-month figure is anchored to the latest month any fund
 * disclosed, with each fund compared against its OWN prior disclosure (AMC
 * filings don't share a reporting month).
 */

export type CapTier = "large" | "mid" | "small";

export interface LedgerTierCell {
  valueCr: number;
  positions: number;
  companies: number;
}
export interface LedgerTopName {
  company: string;
  valueCr: number;
  amcs: string[];
}
export interface LedgerQuadrant {
  /** ₹ Cr traded in this quadrant (absolute, unsigned). */
  totalCr: number;
  /** Number of (fund house, stock) position changes. */
  positions: number;
  /** Distinct companies involved. */
  companies: number;
  byTier: Record<CapTier, LedgerTierCell>;
  top: LedgerTopName[];
}
export interface ConvictionLedger {
  monthCur: string;
  monthPrev: string;
  funds: number;
  amcs: number;
  quadrants: {
    new: LedgerQuadrant;
    increased: LedgerQuadrant;
    decreased: LedgerQuadrant;
    exited: LedgerQuadrant;
  };
}

export interface ContestedRow {
  company: string;
  tier: CapTier;
  buyers: number;
  sellers: number;
  buyCr: number;
  sellCr: number;
  netCr: number;
  grossCr: number;
  topBuyer: string;
  topSeller: string;
}

export interface ChurnRow {
  amc: string;
  turnoverPct: number;
  buyCr: number;
  sellCr: number;
  bookCr: number;
  schemes: number;
  holdings: number;
}

export interface FlowPerfRow {
  fund: string;
  amc: string;
  classification: string;
  percentile: number;
  quartile: string;
  perfReturn: number | null;
  bookGrowthPct: number;
  navReturnPct: number;
  impliedFlowPct: number;
  bookCr: number;
  /** Months between the two book observations for this scheme. */
  monthsBack?: number;
}
export interface FlowPerfBucket {
  count: number;
  rows: FlowPerfRow[];
}

export interface InsightsPlus {
  meta: {
    generatedAt: string;
    monthCur: string;
    monthPrev: string;
    universe: string;
    anchoring: string;
  };
  convictionLedger: ConvictionLedger;
  contested: { month: string; monthPrev: string; rows: ContestedRow[] };
  churn: {
    month: string;
    monthPrev: string;
    minBookCr: number;
    medianTurnoverPct: number;
    rows: ChurnRow[];
  };
  flowsVsPerf: {
    month: string;
    windowLabel: string;
    /** Modal lookback in months across the schemes in the universe. */
    windowMonths: number;
    period: string;
    universe: number;
    medianFlowPct: number;
    quadrants: {
      winning: FlowPerfBucket;
      coasting: FlowPerfBucket;
      falling: FlowPerfBucket;
      undiscovered: FlowPerfBucket;
    };
  };
  persistence: {
    asOf: string;
    priorWindow: { from: string; to: string };
    recentWindow: { from: string; to: string };
    cohorts: number;
    funds: number;
    minCohort: number;
    /** matrix[priorQuartile][recentQuartile] = fund count. 0-based (0 = Q1). */
    matrix: number[][];
    rowTotals: number[];
    q1StayPct: number;
    q1ToBottomHalfPct: number;
    topStayers: { fund: string; classification: string; prior: number; recent: number }[];
  };
}

export const insightsPlus = data as unknown as InsightsPlus;

/** "Jun-26" → "June 2026" for prose. */
export const TIER_LABEL: Record<CapTier, string> = {
  large: "Large-cap",
  mid: "Mid-cap",
  small: "Small-cap",
};
