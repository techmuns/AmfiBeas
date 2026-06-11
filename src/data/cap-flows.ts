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
}

export const capFlows: CapFlows = data as CapFlows;
