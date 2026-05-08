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
  /**
   * Optional: when set, this row was NOT scraped directly from screener
   * but **derived** from arithmetic on other published figures (e.g. a
   * 9M number minus two reported quarters). Surfaced in the dashboard so
   * the user can tell at a glance which value is direct vs derived.
   * Null / absent = direct screener "Sales" / "Net Profit" row.
   */
  derivedFrom?: string;
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
 * Per-field provenance for an AMFI monthly PDF KPI. Every numeric
 * field on `AmfiMonthlyPdfRow` carries its OWN provenance entry —
 * because a single month's row is typically merged from two PDFs
 * (Monthly Report + Monthly Note) and each KPI comes from exactly
 * one of them.
 *
 *   - sourcePdf: filename of the PDF this field's value came from.
 *   - sourceFormat: which AMFI publication ("monthly-report" /
 *     "press-release" / "unknown") it was extracted from.
 *   - sourcePages: 1-indexed page numbers within that PDF where
 *     the value was found. Usually one page; included as an array
 *     because some fields could be cross-referenced in future.
 *   - extractedAt: ISO timestamp of the extraction run that wrote
 *     this field. Distinct from row-level extractedAt because a
 *     row may have fields written by different runs over time.
 *   - sourceLabel: optional human-readable description of the row
 *     or label the value was matched against (e.g. "Sub Total - II
 *     row · Net AUM column", "SIP monthly contribution (crore)").
 *     Lets the dashboard surface "where in the PDF" for tooltips.
 */
export interface AmfiMonthlyPdfFieldProvenance {
  sourcePdf: string;
  sourceFormat: "monthly-report" | "press-release" | "unknown";
  sourcePages: number[];
  extractedAt: string;
  sourceLabel?: string;
}

/** Map keyed by AmfiMonthlyPdfRow numeric field name. Each present
 *  key MUST have a corresponding numeric value on the row, and vice
 *  versa — the merger keeps these aligned so the dashboard can rely
 *  on `row.fieldSources[k]` whenever `row[k]` is set. */
export interface AmfiMonthlyPdfFieldSources {
  totalAum?: AmfiMonthlyPdfFieldProvenance;
  totalAaum?: AmfiMonthlyPdfFieldProvenance;
  equityAum?: AmfiMonthlyPdfFieldProvenance;
  activeEquityAum?: AmfiMonthlyPdfFieldProvenance;
  debtAum?: AmfiMonthlyPdfFieldProvenance;
  liquidAum?: AmfiMonthlyPdfFieldProvenance;
  sipContribution?: AmfiMonthlyPdfFieldProvenance;
  sipAum?: AmfiMonthlyPdfFieldProvenance;
  sipAccounts?: AmfiMonthlyPdfFieldProvenance;
  netInflow?: AmfiMonthlyPdfFieldProvenance;
  /** Category-level net flows for the month (₹ Cr). Sourced from the
   *  AMFI Monthly Report. Sub Total - I (Income/Debt Oriented) feeds
   *  debtNetInflow; Sub Total - II (Growth/Equity Oriented) feeds
   *  equityNetInflow; the Liquid Fund row feeds liquidNetInflow. */
  equityNetInflow?: AmfiMonthlyPdfFieldProvenance;
  debtNetInflow?: AmfiMonthlyPdfFieldProvenance;
  liquidNetInflow?: AmfiMonthlyPdfFieldProvenance;
}

/**
 * Monthly industry KPIs extracted from AMFI PDFs the user uploads
 * under `manual-data/amfi-monthly/pdfs/`. Every numeric field is
 * OPTIONAL — if a value cannot be confidently parsed from any PDF,
 * the field is omitted, never zeroed.
 *
 * A row is built up from one or more PDFs for the same month (Monthly
 * Report contributes AUM totals + sub-category AUM; Monthly Note
 * contributes SIP figures). Per-field provenance lives in
 * `fieldSources` — that's what the dashboard should consume. The
 * row-level `sourcePdf` / `sourceFormat` / `sourcePages` /
 * `extractedAt` remain as a convenience reflecting the LATEST PDF
 * that touched this row, but they no longer tell you which PDF a
 * specific KPI came from once two PDFs have merged.
 *
 * Not yet wired into the /monthly UI.
 */
export interface AmfiMonthlyPdfRow {
  month: string;                       // YYYY-MM
  /** Net AUM as on month-end (₹ Cr). Closing-balance figure from the
   *  Monthly Report's Grand Total row. */
  totalAum?: number;
  /** Average AUM for the month (₹ Cr). Period-average figure
   *  ("AAUM") — comparable to investor-disclosure denominators. */
  totalAaum?: number;
  equityAum?: number;                  // ₹ Cr (Sub Total - II / Growth/Equity Oriented)
  activeEquityAum?: number;            // ₹ Cr (when AMFI splits active vs passive)
  debtAum?: number;                    // ₹ Cr (Sub Total - I / Income/Debt Oriented)
  liquidAum?: number;                  // ₹ Cr (Liquid Fund row)
  sipContribution?: number;            // ₹ Cr (monthly inflow, press release only)
  sipAum?: number;                     // ₹ Cr (press release only)
  sipAccounts?: number;                // count of live SIP accounts (press release only)
  netInflow?: number;                  // ₹ Cr (industry net inflow / outflow — Grand Total row)
  /** Net inflow for Growth/Equity Oriented Schemes (₹ Cr).
   *  From Sub Total - II row of the AMFI Monthly Report. */
  equityNetInflow?: number;
  /** Net inflow for Income/Debt Oriented Schemes (₹ Cr).
   *  From Sub Total - I row of the AMFI Monthly Report. NOTE: this
   *  value INCLUDES Liquid Fund's net flow (Liquid is a sub-row of
   *  Sub Total - I); see liquidNetInflow for the standalone Liquid
   *  Fund flow. */
  debtNetInflow?: number;
  /** Net inflow for the Liquid Fund category (₹ Cr).
   *  From the inline Liquid Fund row of the AMFI Monthly Report.
   *  Already counted within debtNetInflow. */
  liquidNetInflow?: number;
  /** Per-field provenance. Always present (may be empty {}). The
   *  dashboard should prefer this over the row-level fields below
   *  when surfacing which PDF a specific KPI came from. */
  fieldSources: AmfiMonthlyPdfFieldSources;
  /** Row-level convenience: format / file / pages of the LATEST PDF
   *  that wrote into this row. Kept for backwards compatibility and
   *  for rows where only one PDF has contributed. The merged row's
   *  fields may have come from a different PDF — see fieldSources. */
  sourceFormat: "monthly-report" | "press-release" | "unknown";
  sourcePdf: string;
  sourcePages: number[];
  extractedAt: string;
}

export interface AmfiMonthlyPdfSnapshot {
  meta: SnapshotMeta;
  rows: AmfiMonthlyPdfRow[];
}


