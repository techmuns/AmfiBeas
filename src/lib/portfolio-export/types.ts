/**
 * Consolidated, presentation-ready data shapes for the Portfolio Tracker
 * master exports. The gather layer (gather.ts) assembles these from the loaded
 * holdings + the runtime nav-data snapshots; the excel/pdf builders render them.
 */

export type Arrow = "up" | "down" | "none" | "missing";

export interface HoldingMonthCell {
  label: string;
  aumPct: number | null;
  shares: number | null;
  /** Market value in ₹ Cr (AMC-direct all-asset-class scheme export). */
  valueCr?: number | null;
  arrow: Arrow;
}
export interface HoldingExportRow {
  company: string;
  /** Asset class (AMC-direct all-class scheme export): Equity/Debt/Gold/… */
  assetClass?: string | null;
  /** AMC-disclosed industry (equity) or credit rating (debt). */
  industry?: string | null;
  months: HoldingMonthCell[];
}

/** Latest-month asset-class weight (% of NAV), residual attributed to cash. */
export interface AssetMixRow {
  class: string;
  pct: number;
}

export interface ReturnRow {
  period: string; // "1M" … "10Y"
  cagr: boolean;
  fundPct: number | null;
  categoryAvgPct: number | null;
  rank: number | null;
  peerCount: number | null;
  quartile: string | null;
  percentile: number | null;
}

export interface RatioRow {
  label: string; // "Std Dev" …
  fund: number;
  categoryAvg: number;
  rank: number;
  count: number;
  /** "%" for Std Dev / Alpha, "" otherwise. */
  unit: "%" | "";
  /** true → higher is better (used for tone vs category average). */
  higherBetter: boolean;
  signed: boolean; // Alpha shows a sign
}

export interface PlanProfile {
  plan: "Regular" | "Direct";
  navLatest: number | null;
  navDate: string | null;
  returns: ReturnRow[];
  ratios: RatioRow[] | null;
}

export interface SectorRow {
  sector: string;
  fundPct: number;
  categoryAvgPct: number | null;
}

export interface PeerRow {
  fund: string;
  /** Trailing return per period, aligned to SchemeExport.peerPeriods. */
  returns: (number | null)[];
  rank: number | null;
  peerCount: number | null;
  quartile: string | null;
  vsMedianBps: number | null;
  selected: boolean;
}

export interface SchemeExport {
  kind: "scheme";
  fundName: string;
  category: string | null;
  amc: string;
  aumCr: number | null;
  navAsOf: string | null; // AMFI feed date label
  asOfMonth: string; // holdings latest month label
  generatedAt: string;
  monthLabels: string[];
  monthBooksCr: (number | null)[];
  plans: PlanProfile[];
  ratiosMeta: {
    benchmark: string;
    windowMonths: number;
    riskFreeRate: number;
    marketReturn: number;
  } | null;
  sectors: SectorRow[];
  /** Latest-month asset-class mix for the holdings section (AMC-direct). */
  assetMix: AssetMixRow[];
  peerCohortLabel: string;
  /** The period the peer set is ranked by (drives Rank / Quartile / vs-median). */
  peerPeriod: string;
  /** All periods shown as return columns in the peer table (empty ones dropped). */
  peerPeriods: string[];
  peers: PeerRow[];
  holdings: HoldingExportRow[];
  holdingsSource: string;
}

export interface FundHousePeerRow {
  amc: string;
  schemes: number;
  equityBookCr: number;
  top10Pct: number;
  top10DeltaBps: number | null;
  biggestBuyBps: number | null;
  biggestBuyName: string;
  biggestSellBps: number | null;
  biggestSellName: string;
  selected: boolean;
}

export interface FundHouseExport {
  kind: "fund-house";
  amc: string;
  schemeCount: number;
  holdingsCount: number;
  equityValueCr: number;
  latestMonth: string;
  generatedAt: string;
  monthLabels: string[];
  monthBooksCr: (number | null)[];
  capMix: { large: number; mid: number; small: number } | null;
  sectorMix: { sector: string; pct: number }[];
  peers: FundHousePeerRow[];
  holdings: HoldingExportRow[];
  holdingsSource: string;
}
