export interface SnapshotMeta {
  generatedAt: string;
  source: string;
  notes?: string;
}

export interface AmfiAmcEntry {
  amcCode: number;
  name: string;
  schemeCount: number;
}

export interface AmcMasterSnapshot {
  meta: SnapshotMeta;
  amcs: AmfiAmcEntry[];
}

export interface SchemeNav {
  schemeCode: number;
  amcCode: number;
  amcName: string;
  category: string;
  schemeName: string;
  isin?: string;
  nav: number;
  date: string;
}

export interface SchemeNavsSnapshot {
  meta: SnapshotMeta;
  navs: SchemeNav[];
}

export interface IndustryMonthlyRow {
  month: string;
  totalAum: number;
  equityAum: number;
  sipFlow: number;
  folios: number;
  nfoCount?: number;
}

export interface IndustryMonthlySnapshot {
  meta: SnapshotMeta;
  rows: IndustryMonthlyRow[];
}

export interface AmcMonthlyRow {
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
  nfoCount: number;
  nfoAumCollected: number;
}

export interface AmcMonthlySnapshot {
  meta: SnapshotMeta;
  rows: AmcMonthlyRow[];
}

export interface AmcQuarterlyRow {
  amcSlug: string;
  quarter: string;
  revenue: number;
  operatingProfit: number;
  pat: number;
  avgAum: number;
}

export interface AmcQuarterlySnapshot {
  meta: SnapshotMeta;
  rows: AmcQuarterlyRow[];
}

/**
 * Per-AMC quarterly Average AUM (AAUM) row.
 * Sourced from AMFI's quarterly "Disclosure of Average AUM" file.
 * Each row carries its own provenance fields so we never lose source
 * traceability for a single value.
 */
export interface AmcAaumQuarterlyRow {
  amcSlug: string;            // mapped via AMFI_NAME_TO_SLUG
  amcNameAsReported: string;  // verbatim AMC name from source file
  quarter: string;            // calendar quarter, YYYY-Qx
  avgAum: number;             // ₹ Cr
  source: string;             // exact URL fetched
  fetchedAt: string;          // ISO timestamp of the fetch
  status: "ok" | "approximate" | "stale";
}

export interface AmcAaumQuarterlySnapshot {
  meta: SnapshotMeta;
  rows: AmcAaumQuarterlyRow[];
}

/**
 * Morningstar India fallback / comparison snapshot for AMC-wise Average AUM.
 * Always treated as a SECONDARY source — never replaces the AMFI snapshot.
 * `status` distinguishes a clean fetch from blocked / failed / empty so the
 * dashboard can decide whether to surface the data at all.
 */
export type MorningstarStatus = "ok" | "blocked" | "failed" | "empty";

export interface MorningstarAumRow {
  date: string;          // YYYY-MM-DD (month-end the AUM corresponds to)
  quarter: string;       // calendar quarter, YYYY-Qx
  amcId: string;         // dashboard slug (HDFC → "hdfc" etc.)
  originalName: string;  // verbatim AMC name from Morningstar
  averageAum: number;    // ₹ Cr
  sourceUrl: string;
  confidence: "high" | "medium" | "low";
}

export interface MorningstarAumSnapshot {
  meta: {
    source: "Morningstar India";
    sourceUrl: string;
    fetchedAt: string;
    status: MorningstarStatus;
    notes?: string;
  };
  rows: MorningstarAumRow[];
}

export interface OtherSchemesMonthlyRow {
  month: string;
  category: string;
  schemes: number;
  folios: number;
  fundsMobilized: number;
  redemption: number;
  netFlow: number;
  aum: number;
}

export interface OtherSchemesMonthlySnapshot {
  meta: SnapshotMeta;
  rows: OtherSchemesMonthlyRow[];
}

/**
 * Management-disclosed yield / realisation metrics scraped from public
 * investor relations sources (presentations, concall transcripts, exchange
 * filings). Stored separately from calculated yields so the dashboard can
 * surface a calculated-vs-disclosed comparison without losing provenance.
 */
export type ManagementYieldMetric =
  | "revenue_realization_bps_of_aaum"
  | "operating_expense_bps_of_aaum"
  | "operating_margin_bps_of_aaum"
  | "profit_yield_bps_of_aaum"
  | "blended_yield_bps"
  | "equity_yield_bps"
  | "active_equity_yield_bps"
  | "debt_yield_bps"
  | "liquid_yield_bps";

export type ManagementYieldSourceType =
  | "investor_presentation"
  | "concall_transcript"
  | "exchange_filing"
  | "company_ir"
  | "fallback_public_portal";

export interface ManagementYieldRow {
  amcSlug: string;
  quarter: string;            // calendar quarter id, YYYY-Qx
  periodLabel: string;        // verbatim management label, e.g. "Q1 FY26"
  metric: ManagementYieldMetric;
  /** Single point estimate. Required. */
  valueBps: number;
  /** When management discloses a range, retain the bounds. */
  lowBps?: number;
  highBps?: number;
  sourceName: string;         // e.g. "HDFC AMC Investor Presentation"
  sourceUrl: string;
  sourceType: ManagementYieldSourceType;
  page?: number;              // page in PDF where value was extracted
  rawText: string;            // verbatim snippet from the source
  confidence: "high" | "medium" | "low";
  fetchedAt: string;          // ISO timestamp
}

export interface ManagementYieldsSnapshot {
  meta: SnapshotMeta & {
    status: "ok" | "partial" | "empty" | "failed";
    rowCount: number;
    amcsCovered: string[];
    quartersCovered: string[];
  };
  rows: ManagementYieldRow[];
}
