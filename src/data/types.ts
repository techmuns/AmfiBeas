export interface AMC {
  slug: string;
  name: string;
  ticker?: string;
  listed: boolean;
}

/**
 * Monthly operating metrics for one AMC.
 *
 * AUM-by-category fields use SEBI's scheme-group taxonomy:
 *  - activeEquityAum  Active equity-oriented schemes ONLY (Multi-cap, Large/Mid/Small/
 *                     Flexi-cap, ELSS, Sectoral/Thematic, Dividend Yield, Value, etc.).
 *                     Excludes index funds, ETFs, and any passive product.
 *  - passiveAum       Index funds + ETFs (Group V Sub-classification: Equity Index
 *                     Funds, Equity ETFs, Debt Index Funds, Gold/Silver ETFs, FoFs that
 *                     track an index). Includes both equity and non-equity passives.
 *  - debtAum          Active debt schemes (Liquid is NOT included here — see liquidAum).
 *  - liquidAum        Overnight + Liquid schemes (kept separate due to size and treasury usage).
 *  - hybridAum        Hybrid schemes (Aggressive, Balanced Advantage, Multi-Asset, Conservative,
 *                     Equity Savings, Arbitrage, etc.).
 *  - otherSchemesAum  SEBI Group V residual after excluding index/ETF: Solution-oriented
 *                     (Retirement / Children's), Active FoFs, etc. Used as the "Other" bucket
 *                     in AUM mix charts.
 *
 * Sum of the six category fields ≈ totalAum (small drift from rounding is expected).
 *
 * SIP / investor / NFO fields:
 *  - sipContribution     Gross monthly SIP inflow (₹ Cr).
 *  - investorAdditions   New folios added in this month.
 *  - folios              Total folios outstanding at month end.
 *  - uniqueInvestors     PAN-level distinct investor count. Rarely available; left optional.
 *  - schemeOutperformanceRatio  % of schemes beating their benchmark (rolling 3y typical).
 *  - quartileRankSummary        Distribution of an AMC's funds across performance quartiles.
 *  - nfoCount            Number of NFOs launched this month.
 *  - nfoAumCollected     ₹ Cr raised across those NFOs.
 */
export interface MonthlyOperating {
  amcSlug: string;
  month: string;

  totalAum: number;
  activeEquityAum: number;
  passiveAum: number;
  debtAum: number;
  liquidAum: number;
  hybridAum: number;
  otherSchemesAum: number;

  sipContribution: number;

  investorAdditions: number;
  folios: number;
  uniqueInvestors?: number;

  schemeOutperformanceRatio?: number;
  quartileRankSummary?: QuartileRankSummary;

  nfoCount: number;
  nfoAumCollected: number;
}

export interface QuartileRankSummary {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

export interface QuarterlyFinancial {
  amcSlug: string;
  quarter: string;
  revenue: number;
  operatingProfit: number;
  pat: number;
  avgAum: number;
  /** Provenance note when the row is derived (e.g. 9M minus quarters)
   *  rather than scraped directly. Optional; absent = direct source. */
  derivedFrom?: string;
}
