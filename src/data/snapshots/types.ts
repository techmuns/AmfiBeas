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
  amcSlug: string;            // curated map (AMFI_NAME_TO_SLUG) when
                              // mappingStatus="mapped"; auto-derived
                              // from `amcNameAsReported` otherwise.
  amcNameAsReported: string;  // verbatim AMC name from source file
  /** How `amcSlug` was resolved:
   *   - "mapped"     : matched the curated AMFI_NAME_TO_SLUG entry
   *                    in src/data/amcs.ts.
   *   - "auto_slug"  : not in the curated map, slug derived
   *                    deterministically from `amcNameAsReported`.
   *   - "unmapped"   : extractor could not derive a stable slug
   *                    (rare; reserved for future fallback paths).
   *  Optional for backwards compatibility — pre-PR rows are
   *  treated as "mapped" by consumers when this is absent.
   */
  mappingStatus?: "mapped" | "auto_slug" | "unmapped";
  /** Friendly display name. When `mappingStatus="mapped"`, this is
   *  the curated short label (e.g. "HDFC AMC") from `AMCS`. When
   *  "auto_slug", this is the AMFI name with the trailing "Mutual
   *  Fund" suffix stripped (e.g. "Quant Mutual Fund" → "Quant"). */
  displayName?: string;
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
  /** Provenance for the IIFL-style active-equity envelope flow.
   *  The single sourceLabel describes the formula. */
  activeEquityNetInflow?: AmfiMonthlyPdfFieldProvenance;
  industryFolios?: AmfiMonthlyPdfFieldProvenance;
  industryNfoCount?: AmfiMonthlyPdfFieldProvenance;
  industryNfoFundsMobilized?: AmfiMonthlyPdfFieldProvenance;
  /** IIFL-style equity breakdown derived from the AMFI Monthly Report.
   *  See AmfiMonthlyPdfRow for the per-field definition. */
  etfIndexAum?: AmfiMonthlyPdfFieldProvenance;
  arbitrageAum?: AmfiMonthlyPdfFieldProvenance;
  /** AAUM-side mirrors of the IIFL active-equity envelope fields.
   *  Used by IIFL-lens charts so QAAUM share is computed against the
   *  period-average envelope, not the closing-balance one. */
  activeEquityAaum?: AmfiMonthlyPdfFieldProvenance;
  etfIndexAaum?: AmfiMonthlyPdfFieldProvenance;
  arbitrageAaum?: AmfiMonthlyPdfFieldProvenance;
  // Major-category AAUM denominators from page-1 Sub Total rows.
  // Used by the /monthly Category Drilldown for QAAUM-share %.
  debtAaum?: AmfiMonthlyPdfFieldProvenance;
  equityAaum?: AmfiMonthlyPdfFieldProvenance;
  hybridAum?: AmfiMonthlyPdfFieldProvenance;
  hybridAaum?: AmfiMonthlyPdfFieldProvenance;
  hybridNetInflow?: AmfiMonthlyPdfFieldProvenance;
  otherSchemesAum?: AmfiMonthlyPdfFieldProvenance;
  otherSchemesAaum?: AmfiMonthlyPdfFieldProvenance;
  otherSchemesNetInflow?: AmfiMonthlyPdfFieldProvenance;
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
  /** IIFL Figure 19-style "Active Equity" AUM (₹ Cr). DERIVED from
   *  the AMFI Monthly Report as:
   *    Sub Total - II (Growth/Equity Oriented Schemes)
   *    + (Sub Total - III  −  Arbitrage Fund row)        // active hybrid, ex-arbitrage
   *    + Sub Total - IV (Solution Oriented Schemes)
   *  Excludes ETFs / Index Funds / Arbitrage Fund. Includes the
   *  active-hybrid rows (Conservative Hybrid, Balanced/Aggressive,
   *  Dynamic Asset Allocation, Multi-Asset Allocation, Equity
   *  Savings) and the Solution-Oriented schemes (Retirement +
   *  Children's). Reconciles to within ~1% of IIFL Figure 19's
   *  Feb 2026 reference (₹44.84 trn) — the residual is consistent
   *  with IIFL using period-average AAUM vs our closing-balance
   *  Net AUM. */
  activeEquityAum?: number;
  debtAum?: number;                    // ₹ Cr (Sub Total - I / Income/Debt Oriented)
  liquidAum?: number;                  // ₹ Cr (Liquid Fund row)
  /** IIFL Figure 19-style "ETF & Index" AUM (₹ Cr). DERIVED from
   *  the AMFI Monthly Report Sub Total - V (Other Schemes) component
   *  rows as: Index Funds + Other ETFs. EXCLUDES Gold ETFs (precious
   *  metal exposure, not equity) and Fund of Funds investing
   *  overseas (foreign-equity exposure). Reconciles to within ~0.4%
   *  of IIFL Figure 19's Feb 2026 reference (₹13.054 trn). */
  etfIndexAum?: number;
  /** Arbitrage Fund AUM (₹ Cr). The single Arbitrage Fund row from
   *  Sub Total - III (Hybrid Schemes). Used to break out arbitrage
   *  from active hybrid for IIFL Figure 19-style separation. NOTE:
   *  IIFL's Feb 2026 reference (₹3.336 trn) is ~18% higher than
   *  this AMFI row alone (₹2.736 trn) — the discrepancy is
   *  unexplained but does NOT affect the Active Equity / ETF & Index
   *  classification, which match IIFL within ~1%. */
  arbitrageAum?: number;
  /** AAUM (period-average) version of `activeEquityAum`, derived as:
   *    Sub Total - II AAUM
   *    + (Sub Total - III AAUM − Arbitrage Fund AAUM)
   *    + Sub Total - IV AAUM
   *  Used by IIFL-lens charts so QAAUM share lines compute against a
   *  period-average envelope rather than the closing-balance one. */
  activeEquityAaum?: number;
  /** AAUM version of `etfIndexAum` = Index Funds AAUM + Other ETFs AAUM. */
  etfIndexAaum?: number;
  /** AAUM version of `arbitrageAum` (Arbitrage Fund Average Net AUM column). */
  arbitrageAaum?: number;
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
  /** Active-equity envelope net inflow (₹ Cr; signed). DERIVED from
   *  the AMFI Monthly Report as:
   *    Sub Total - II net inflow                          (equityNetInflow)
   *    + (Sub Total - III net inflow − Arbitrage Fund net inflow)
   *    + Sub Total - IV net inflow
   *  Mirrors the activeEquityAum formula on the FLOW column. Used
   *  as the denominator for category net-inflow shares so a hybrid-
   *  oriented category (e.g. Multi-Asset Allocation, sitting in
   *  Sub III) compares apples-to-apples with equity-oriented
   *  categories from Sub II. Omitted when any contributing row
   *  is missing — never zero-filled. */
  activeEquityNetInflow?: number;
  /** Industry-wide total folio count (raw count of folios across
   *  all schemes). Sourced from the AMFI Monthly Report's Grand
   *  Total row, "No. of Folios" column. ~27 crore on the latest
   *  month. */
  industryFolios?: number;
  /** Number of NFOs (New Fund Offers) launched in the month.
   *  Sourced from the AMFI Monthly Report's "New Schemes" page —
   *  Grand Total row's "No. of Schemes" columns, summing the
   *  open-ended and close-ended counts. */
  industryNfoCount?: number;
  /** Funds mobilised by NFOs in the month (₹ Cr). Sourced from
   *  the AMFI Monthly Report's "New Schemes" page — Grand Total
   *  row's "Funds mobilized" columns, summing open-ended and
   *  close-ended. */
  industryNfoFundsMobilized?: number;
  // ---- Major-category AAUM / AUM / Net-Inflow denominators ----
  // Sourced from page-1 Sub Total rows. Used by the /monthly
  // Category Drilldown to compute QAAUM share % and net-inflow
  // share % per row, where the denominator is the sub-total of the
  // row's parent group rather than the active-equity envelope.
  /** Sub Total - I (Income/Debt) Average Net AUM (₹ Cr). */
  debtAaum?: number;
  /** Sub Total - II (Growth/Equity) Average Net AUM (₹ Cr). */
  equityAaum?: number;
  /** Sub Total - III (Hybrid) Net AUM (₹ Cr). */
  hybridAum?: number;
  /** Sub Total - III (Hybrid) Average Net AUM (₹ Cr). */
  hybridAaum?: number;
  /** Sub Total - III (Hybrid) Net Inflow / Outflow (₹ Cr, signed). */
  hybridNetInflow?: number;
  /** Sub Total - V (Other Schemes) Net AUM (₹ Cr). */
  otherSchemesAum?: number;
  /** Sub Total - V (Other Schemes) Average Net AUM (₹ Cr). */
  otherSchemesAaum?: number;
  /** Sub Total - V (Other Schemes) Net Inflow / Outflow (₹ Cr, signed). */
  otherSchemesNetInflow?: number;
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

/**
 * Slugs for the category-level rows we extract from the AMFI Monthly
 * Report into the long-form `amfi-monthly-category.json` snapshot.
 * Each slug maps to a specific row label inside Sub Total - II
 * (Growth/Equity Oriented) or Sub Total - III (Hybrid Schemes).
 *
 * The set is INTENTIONALLY closed — the extractor only writes rows
 * for these slugs, so adding a new category requires an explicit
 * code change (and a friendly label + regex). Keeps the long-form
 * data clean and predictable for downstream charts.
 */
export type AmfiMonthlyCategorySlug =
  // Sub I — Income/Debt Oriented Schemes (16 rows)
  | "overnight"
  | "liquid"
  | "ultra-short-duration"
  | "low-duration"
  | "money-market"
  | "short-duration"
  | "medium-duration"
  | "medium-to-long-duration"
  | "long-duration"
  | "dynamic-bond"
  | "corporate-bond"
  | "credit-risk"
  | "banking-psu"
  | "gilt"
  | "gilt-10y-constant"
  | "floater"
  // Sub II — Growth/Equity Oriented (all 11 rows; in active-equity envelope)
  | "multi-cap"
  | "large-cap"
  | "large-mid-cap"
  | "mid-cap"
  | "small-cap"
  | "dividend-yield"
  | "value-contra"
  | "focused"
  | "sectoral-thematic"
  | "elss"
  | "flexi-cap"
  // Sub III — Hybrid (all 6 rows; Arbitrage is in Hybrid major
  // category but excluded from active-equity envelope by formula).
  | "conservative-hybrid"
  | "balanced-aggressive-hybrid"
  | "baf-daa"
  | "multi-asset"
  | "arbitrage"
  | "equity-savings"
  // Sub IV — Solution Oriented (both rows in envelope, but not
  // surfaced in the major-category drilldown UI).
  | "retirement"
  | "childrens"
  // Sub V — Other Schemes (4 rows)
  | "index-funds"
  | "gold-etf"
  | "other-etfs"
  | "fof-overseas";

/** Major category groupings on the AMFI Monthly Report (open-ended).
 *  Each category row is tagged with its parent group so the
 *  dashboard can drill down per group with a group-specific
 *  denominator. "solution" is extracted but not currently surfaced
 *  in the drilldown UI; included here to keep the schema closed. */
export type AmfiMonthlyMajorCategorySlug =
  | "income-debt"
  | "growth-equity"
  | "hybrid"
  | "solution"
  | "other-schemes";

export interface AmfiMonthlyCategoryFieldSources {
  categoryAum?: AmfiMonthlyPdfFieldProvenance;
  categoryAaum?: AmfiMonthlyPdfFieldProvenance;
  categoryNetInflow?: AmfiMonthlyPdfFieldProvenance;
}

/**
 * One row per (month, category) combination. Long-form so the
 * dashboard can filter by category at render-time without reshaping.
 *
 * `categoryAum` is the month-end Net AUM column from the AMFI Monthly
 * Report; `categoryAaum` is the period-average AAUM column on the
 * same row; `categoryNetInflow` is the Net Inflow / Outflow column.
 * All three are optional — a row that's missing any is still useful
 * (e.g. when AMFI's table layout changes for a vintage), never
 * zero-filled.
 *
 * `majorCategorySlug` / `majorCategoryLabel` tag each row with the
 * Sub Total - I / II / III / IV / V parent group so the dashboard's
 * Category Drilldown can filter and use a group-specific denominator
 * without re-grouping at render time.
 */
export interface AmfiMonthlyCategoryRow {
  month: string;                       // YYYY-MM
  categorySlug: AmfiMonthlyCategorySlug;
  /** Friendly name of the category (matches the AMFI row label
   *  exactly), e.g. "Flexi Cap Fund". */
  category: string;
  /** Major-category bucket (Sub Total - I / II / III / IV / V).
   *  Drives drilldown denominator selection and grouping. */
  majorCategorySlug: AmfiMonthlyMajorCategorySlug;
  majorCategoryLabel: string;
  categoryAum?: number;                // ₹ Cr
  categoryAaum?: number;               // ₹ Cr (Average Net AUM)
  categoryNetInflow?: number;          // ₹ Cr (signed; can be negative)
  fieldSources: AmfiMonthlyCategoryFieldSources;
  /** Row-level provenance (always set on category rows since each
   *  row originates from a single AMFI Monthly Report PDF — there's
   *  no last-writer-wins ambiguity here, unlike the per-month
   *  AmfiMonthlyPdfRow which can merge fields from two PDFs). */
  sourcePdf: string;
  sourceFormat: "monthly-report" | "press-release" | "unknown";
  sourcePages: number[];
  extractedAt: string;
}

export interface AmfiMonthlyCategorySnapshot {
  meta: SnapshotMeta;
  rows: AmfiMonthlyCategoryRow[];
}

// ---- AMFI Quarterly Report PDFs ------------------------------------
//
// Schema for the AMFI quarterly PDFs uploaded to
// `manual-data/amfi-quarterly/pdfs/`. The publication has the same
// per-scheme tabular layout as the AMFI Monthly Report but anchored
// on a fiscal quarter (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar). Important:
// the "Average Net AUM" column reports the LAST MONTH of the quarter
// only — NOT a true 3-month average. The `LastMonthAaum` naming on
// every AAUM field below is deliberate: any field that read "Aaum" or
// "Qaaum" without "LastMonth" would invite a quiet methodology bug
// where consumers compute QAAUM share off this column. Consumers who
// need a true period-average AAUM must aggregate the monthly snapshot
// at render time.
//
// New / non-monthly columns the quarterly publication does carry:
//   - Funds Mobilized   (gross inflow,  3-month sum)
//   - Repurchase        (gross outflow, 3-month sum)
//   - No. of Schemes / Folios per category
//
// Net Inflow per category in the quarterly PDF is the 3-month sum of
// the monthly Net Inflow values — verified to match the monthly
// snapshot exactly when both sides are present, so the quarterly PDF
// can also serve as a cross-check for the monthly extractor.

/** Per-field provenance for an AMFI quarterly PDF KPI. Every numeric
 *  field on `AmfiQuarterlyIndustryRow` / `AmfiQuarterlyCategoryRow`
 *  carries its OWN provenance entry — same provenance contract as
 *  the monthly schema, narrowed to the single quarterly publication
 *  format. */
export interface AmfiQuarterlyFieldSource {
  sourcePdf: string;
  sourceFormat: "quarterly-report";
  sourcePages: number[];
  extractedAt: string;
  /** Optional human-readable description of the row + column the
   *  value was matched against, e.g. "Sub Total - II row · Net
   *  Inflow column · Apr - Jun 2025". Mirrors the monthly schema's
   *  `sourceLabel`. */
  sourceLabel?: string;
}

/** Map keyed by AmfiQuarterlyIndustryRow numeric field name. Each
 *  present key MUST have a corresponding numeric value on the row
 *  and vice versa (mirrors AmfiMonthlyPdfFieldSources). */
export interface AmfiQuarterlyIndustryFieldSources {
  // Industry totals (Grand Total row, all five sub-totals collapsed).
  grandTotalAum?: AmfiQuarterlyFieldSource;
  grandTotalLastMonthAaum?: AmfiQuarterlyFieldSource;
  grandTotalNetInflow?: AmfiQuarterlyFieldSource;
  grandTotalFundsMobilized?: AmfiQuarterlyFieldSource;
  grandTotalRepurchase?: AmfiQuarterlyFieldSource;
  grandTotalFolios?: AmfiQuarterlyFieldSource;
  // Sub Total - I (Income/Debt Oriented Schemes).
  debtAum?: AmfiQuarterlyFieldSource;
  debtLastMonthAaum?: AmfiQuarterlyFieldSource;
  debtNetInflow?: AmfiQuarterlyFieldSource;
  debtFundsMobilized?: AmfiQuarterlyFieldSource;
  debtRepurchase?: AmfiQuarterlyFieldSource;
  debtFolios?: AmfiQuarterlyFieldSource;
  // Sub Total - II (Growth/Equity Oriented Schemes).
  equityAum?: AmfiQuarterlyFieldSource;
  equityLastMonthAaum?: AmfiQuarterlyFieldSource;
  equityNetInflow?: AmfiQuarterlyFieldSource;
  equityFundsMobilized?: AmfiQuarterlyFieldSource;
  equityRepurchase?: AmfiQuarterlyFieldSource;
  equityFolios?: AmfiQuarterlyFieldSource;
  // Sub Total - III (Hybrid Schemes).
  hybridAum?: AmfiQuarterlyFieldSource;
  hybridLastMonthAaum?: AmfiQuarterlyFieldSource;
  hybridNetInflow?: AmfiQuarterlyFieldSource;
  hybridFundsMobilized?: AmfiQuarterlyFieldSource;
  hybridRepurchase?: AmfiQuarterlyFieldSource;
  hybridFolios?: AmfiQuarterlyFieldSource;
  // Sub Total - V (Other Schemes).
  otherSchemesAum?: AmfiQuarterlyFieldSource;
  otherSchemesLastMonthAaum?: AmfiQuarterlyFieldSource;
  otherSchemesNetInflow?: AmfiQuarterlyFieldSource;
  otherSchemesFundsMobilized?: AmfiQuarterlyFieldSource;
  otherSchemesRepurchase?: AmfiQuarterlyFieldSource;
  otherSchemesFolios?: AmfiQuarterlyFieldSource;
  /** IIFL active-equity envelope flow. DERIVED from
   *    Sub Total - II  +  (Sub Total - III - Arbitrage Fund)  +  Sub Total - IV
   *  computed against the quarter-sum Net Inflow column. The
   *  `sourceLabel` describes the formula. */
  activeEquityNetInflow?: AmfiQuarterlyFieldSource;
}

/** One row per fiscal quarter, extracted from the AMFI quarterly
 *  Report PDF for that quarter. Every numeric field is OPTIONAL — if
 *  a value cannot be confidently parsed, the field is omitted, never
 *  zeroed. Per-field provenance lives in `fieldSources`; the row-
 *  level `sourcePdf` / `sourceFormat` / `sourcePages` /
 *  `extractedAt` reflect the single PDF that produced the row. */
export interface AmfiQuarterlyIndustryRow {
  /** Canonical fiscal-quarter id, e.g. "FY26-Q4". Same id space as
   *  the in-page helper used by /quarterly so quarterly-PDF rows
   *  can be joined to the monthly-aggregated quarter buckets. */
  quarter: string;
  /** Display label, e.g. "4QFY26". */
  quarterLabel: string;
  /** First month of the quarter (YYYY-MM), e.g. "2026-01". */
  quarterStart: string;
  /** Last month of the quarter (YYYY-MM), e.g. "2026-03". */
  quarterEnd: string;

  // Industry totals (Grand Total row).
  grandTotalAum?: number;
  grandTotalLastMonthAaum?: number;
  grandTotalNetInflow?: number;
  grandTotalFundsMobilized?: number;
  grandTotalRepurchase?: number;
  grandTotalFolios?: number;

  // Sub Total - I (Income/Debt Oriented Schemes).
  debtAum?: number;
  debtLastMonthAaum?: number;
  debtNetInflow?: number;
  debtFundsMobilized?: number;
  debtRepurchase?: number;
  debtFolios?: number;

  // Sub Total - II (Growth/Equity Oriented Schemes).
  equityAum?: number;
  equityLastMonthAaum?: number;
  equityNetInflow?: number;
  equityFundsMobilized?: number;
  equityRepurchase?: number;
  equityFolios?: number;

  // Sub Total - III (Hybrid Schemes).
  hybridAum?: number;
  hybridLastMonthAaum?: number;
  hybridNetInflow?: number;
  hybridFundsMobilized?: number;
  hybridRepurchase?: number;
  hybridFolios?: number;

  // Sub Total - V (Other Schemes).
  otherSchemesAum?: number;
  otherSchemesLastMonthAaum?: number;
  otherSchemesNetInflow?: number;
  otherSchemesFundsMobilized?: number;
  otherSchemesRepurchase?: number;
  otherSchemesFolios?: number;

  /** IIFL active-equity envelope quarter-sum Net Inflow. DERIVED:
   *    Sub Total - II + (Sub Total - III - Arbitrage Fund) + Sub Total - IV. */
  activeEquityNetInflow?: number;

  fieldSources: AmfiQuarterlyIndustryFieldSources;
  // Row-level provenance — single source PDF per quarterly row.
  sourcePdf: string;
  sourceFormat: "quarterly-report";
  sourcePages: number[];
  extractedAt: string;
}

/** Per-field provenance for an AmfiQuarterlyCategoryRow. */
export interface AmfiQuarterlyCategoryFieldSources {
  categorySchemes?: AmfiQuarterlyFieldSource;
  categoryFolios?: AmfiQuarterlyFieldSource;
  categoryFundsMobilized?: AmfiQuarterlyFieldSource;
  categoryRepurchase?: AmfiQuarterlyFieldSource;
  categoryNetInflow?: AmfiQuarterlyFieldSource;
  categoryAum?: AmfiQuarterlyFieldSource;
  categoryLastMonthAaum?: AmfiQuarterlyFieldSource;
}

/** One row per (quarter, category). Long-form so the dashboard can
 *  filter without reshaping. Reuses the existing `AmfiMonthlyCategorySlug`
 *  / `AmfiMonthlyMajorCategorySlug` so the same category set works
 *  across monthly + quarterly surfaces.
 *
 *  Note on `categoryLastMonthAaum`: the AMFI quarterly PDF's
 *  "Average Net AUM" column reports only the last month of the
 *  quarter, NOT a true period-average. Any consumer that needs a
 *  3-month average AAUM must aggregate from the monthly snapshot. */
export interface AmfiQuarterlyCategoryRow {
  quarter: string;
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;

  categorySlug: AmfiMonthlyCategorySlug;
  /** Friendly name of the category (matches the AMFI row label
   *  exactly), e.g. "Flexi Cap Fund". */
  category: string;
  majorCategorySlug: AmfiMonthlyMajorCategorySlug;
  majorCategoryLabel: string;

  categorySchemes?: number;
  categoryFolios?: number;
  categoryFundsMobilized?: number;             // ₹ Cr (gross inflow,  3-month sum)
  categoryRepurchase?: number;                 // ₹ Cr (gross outflow, 3-month sum)
  categoryNetInflow?: number;                  // ₹ Cr (signed,        3-month sum)
  categoryAum?: number;                        // ₹ Cr (closing as of quarter-end)
  categoryLastMonthAaum?: number;              // ₹ Cr (LAST MONTH only)

  fieldSources: AmfiQuarterlyCategoryFieldSources;
  sourcePdf: string;
  sourceFormat: "quarterly-report";
  sourcePages: number[];
  extractedAt: string;
}

/** Wrapper for `src/data/snapshots/amfi-quarterly-industry.json` and
 *  `src/data/snapshots/amfi-quarterly-category.json`.
 *
 *  `meta.generatedAt` is `null` until the extractor runs for the
 *  first time, then becomes the ISO timestamp of the latest run.
 *  `meta.rowCount` mirrors `rows.length` after each run so consumers
 *  can detect a still-empty seed snapshot without inspecting the
 *  array. */
export interface AmfiQuarterlySnapshotMeta {
  source: string;
  generatedAt: string | null;
  rowCount: number;
  notes?: string;
}

export interface AmfiQuarterlyIndustrySnapshot {
  meta: AmfiQuarterlySnapshotMeta;
  rows: AmfiQuarterlyIndustryRow[];
}

export interface AmfiQuarterlyCategorySnapshot {
  meta: AmfiQuarterlySnapshotMeta;
  rows: AmfiQuarterlyCategoryRow[];
}

/**
 * Month-end snapshot of a market index level + derived rolling returns.
 * Built by `scripts/ingest/market-indices.ts` from manually-uploaded
 * daily-level CSVs under `manual-data/market/`. Every derived field is
 * NULL when there isn't enough history for the rolling window — we
 * never fake a value. Status is "ok" for cleanly parsed rows;
 * unparseable rows are simply omitted rather than carried as bad data.
 */
export interface MarketIndexMonthlyRow {
  /** Index identifier, e.g. "NIFTY_500". */
  index: string;
  /** Month-end the level corresponds to (YYYY-MM). */
  month: string;
  /** Closing index level on the last trading day of `month`. */
  level: number;
  /** 1-month price return as a percentage. Null when no prior month. */
  return1mPct: number | null;
  /** 3-month price return as a percentage. */
  return3mPct: number | null;
  /** 6-month price return as a percentage. */
  return6mPct: number | null;
  /** 12-month price return as a percentage. */
  return12mPct: number | null;
  /** Drawdown from the rolling all-time high of `level` to date (≤ 0). */
  drawdownPct: number | null;
  /** Always "ok" when the row is emitted — fragile rows are dropped. */
  status: "ok";
  /** Free-form source attribution, e.g. "manual upload". */
  source: string;
}

export interface MarketIndexMonthlySnapshot {
  meta: SnapshotMeta;
  rows: MarketIndexMonthlyRow[];
}
