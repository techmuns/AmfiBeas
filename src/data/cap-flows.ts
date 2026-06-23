import data from "./portfolio-tracker/cap-flows.json";

/**
 * Cap-bucketed MF buy/sell snapshot: for the latest month vs the prior month,
 * the stocks active-equity mutual funds bought/sold the most (net Rs Cr) in
 * each Large/Mid/Small bucket, with the AMCs driving the move. Built by
 * scripts/build-cap-flows.ts from the per-fund equity holdings.
 */

export interface CapFlowRow {
  company: string;
  /** RupeeVest financial code — the join key into the shares-outstanding
   *  feed; not displayed. */
  fincode: string;
  netCr: number;
  /** Net shares MFs traded this month as a % of the company's total shares
   *  outstanding (unsigned magnitude; the card applies the bought/sold sign).
   *  null when no shares-outstanding figure is available for the fincode. */
  pctOutstanding: number | null;
  amcs: string[];
}

export interface CapFlowCard {
  bought: CapFlowRow[];
  sold: CapFlowRow[];
}

/** A name driving a sector's allocation shift (signed net ₹ Cr; + bought). */
export interface SectorShiftStock {
  company: string;
  netCr: number;
  amcs: string[];
  /** Top schemes (fund names) that bought/sold this stock — for the zoom. */
  schemes?: SectorShiftScheme[];
}
/** A scheme that bought/sold a sector or stock this month. `netCr` is the pure
 *  trade flow (Σ share change × price); `valueChgCr` is the holding-value change
 *  (incl. price moves). Both signed (+ bought). */
export interface SectorShiftScheme {
  fund: string;
  amc: string;
  netCr: number;
  valueChgCr: number;
}
/** One sector whose share of active-equity MF AUM moved notably this month. */
export interface SectorShiftRow {
  sector: string;
  direction: "up" | "down";
  /** Sector's share of total active-equity holdings value, latest / prior (%). */
  pctCur: number;
  pctPrev: number;
  /** Change in that share, in percentage points (signed). */
  changePp: number;
  stocks: SectorShiftStock[];
  /** Top schemes (not just AMCs) that drove the sector move — for the zoom. */
  schemes?: SectorShiftScheme[];
}
export interface SectorShifts {
  monthCur: string;
  monthPrev: string;
  /** The biggest share gainers then losers (up to 2 + 2). */
  rows: SectorShiftRow[];
}

export interface CapFlows {
  meta: {
    monthCur: string;
    monthPrev: string;
    generatedAt: string;
    universe: string;
    activeEquityFunds: number;
    metric: string;
    topN: number;
  };
  large: CapFlowCard;
  mid: CapFlowCard;
  small: CapFlowCard;
  /** Optional — present once build-cap-flows has emitted it. */
  sectorShifts?: SectorShifts;
}

export const capFlows: CapFlows = data as CapFlows;
