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
  /**
   * Revenue from Operations (₹ Cr). Sourced from screener.in's "Sales" row
   * on the consolidated quarterly results table — for AMC issuers this is
   * the management-disclosure equivalent of "Revenue from Operations" and
   * EXCLUDES "Other Income" / treasury / investment income.
   *
   * INVARIANT: Revenue Realization = revenue × 4 × 10,000 / MF QAAUM uses
   * THIS field exactly. Do not substitute Total Income or Sales + Other.
   */
  revenue: number;
  /**
   * Optional: same value as `revenue` but the field name carries the
   * semantic. New rows written by the ingester populate both for forward
   * compatibility; legacy rows have `revenue` only.
   */
  revenueFromOperations?: number;
  /**
   * Optional: "Other Income" row from screener (treasury / investment
   * income, etc.). Stored for display only — never used in Revenue
   * Realization.
   */
  otherIncome?: number;
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

