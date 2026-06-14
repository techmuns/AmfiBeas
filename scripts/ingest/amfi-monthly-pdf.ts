/**
 * Extract industry monthly KPIs from AMFI PDFs uploaded under
 * `manual-data/amfi-monthly/pdfs/` and write
 * `src/data/snapshots/amfi-monthly-pdf.json`.
 *
 * AMFI publishes the monthly numbers in TWO different shapes:
 *
 *   1. "Monthly Report"  — per-scheme tabular table with column headers
 *      ("Net Assets Under Management as on …", "Average Net AUM for the
 *      month …"), Sub Totals (I/II/III/IV/V) per scheme category, and a
 *      Grand Total row. Carries totalAum / totalAaum / debtAum /
 *      equityAum / liquidAum / netInflow. Does NOT carry SIP figures.
 *
 *   2. "Note for Press" / "Note for the Press" press release — flat
 *      label-and-number lines with AAUM, SIP Contribution, SIP AUM,
 *      SIP Accounts, etc.
 *
 * The script auto-detects format per file and dispatches to the right
 * parser. Fields the format does not carry stay OMITTED — never zeroed.
 *
 * Behaviour invariants:
 *   - Pure read-extract-merge. Re-running with the same PDFs is
 *     idempotent (modulo `extractedAt` / `meta.generatedAt` ISO stamps).
 *   - Merge by month: a field that the new run did not detect keeps
 *     its previous value; months not in the current run are kept.
 *   - Empty `pdfs/` directory is a no-op — preserves the existing
 *     snapshot.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type {
  AmfiMonthlyCategoryRow,
  AmfiMonthlyCategorySlug,
  AmfiMonthlyCategorySnapshot,
  AmfiMonthlyMajorCategorySlug,
  AmfiMonthlyPdfFieldProvenance,
  AmfiMonthlyPdfFieldSources,
  AmfiMonthlyPdfRow,
  AmfiMonthlyPdfSnapshot,
} from "../../src/data/snapshots/types";
import {
  info,
  nowIso,
  parseMonth,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";

const PDF_DIR = path.resolve(process.cwd(), "manual-data/amfi-monthly/pdfs");
const SNAPSHOT_FILE = "amfi-monthly-pdf.json";
const CATEGORY_SNAPSHOT_FILE = "amfi-monthly-category.json";

/**
 * The closed set of (slug, friendly-label, row-pattern) entries the
 * extractor pulls into the long-form `amfi-monthly-category.json`
 * snapshot. Each pattern matches the EXACT row label as it appears
 * in AMFI Monthly Reports — care taken so e.g. "Large Cap Fund"
 * doesn't false-match "Large & Mid Cap Fund" (which is a different
 * row).
 *
 * Adding a new category here ALSO requires extending
 * `AmfiMonthlyCategorySlug` in the schema.
 */
const MAJOR_CATEGORY_LABELS: Record<
  AmfiMonthlyMajorCategorySlug,
  string
> = {
  "income-debt": "Income/Debt Oriented Schemes",
  "growth-equity": "Growth/Equity Oriented Schemes",
  hybrid: "Hybrid Schemes",
  solution: "Solution Oriented Schemes",
  "other-schemes": "Other Schemes",
};

const CATEGORY_SPECS: {
  slug: AmfiMonthlyCategorySlug;
  label: string;
  majorCategorySlug: AmfiMonthlyMajorCategorySlug;
  re: RegExp;
}[] = [
  // ---- Sub I — Income/Debt Oriented (16 rows). Several pairs need
  // negative lookbehinds / lookaheads to avoid sub-string collisions:
  //   - "Short Duration Fund" appears INSIDE "Ultra Short Duration Fund"
  //   - "Long Duration Fund" appears INSIDE "Medium to Long Duration Fund"
  //   - "Gilt Fund" appears INSIDE "Gilt Fund with 10 year constant duration"
  {
    slug: "overnight",
    label: "Overnight Fund",
    majorCategorySlug: "income-debt",
    re: /\bOvernight\s+Fund\b/i,
  },
  {
    slug: "liquid",
    label: "Liquid Fund",
    majorCategorySlug: "income-debt",
    re: /\bLiquid\s+Fund\b/i,
  },
  {
    slug: "ultra-short-duration",
    label: "Ultra Short Duration Fund",
    majorCategorySlug: "income-debt",
    re: /\bUltra\s+Short\s+Duration\s+Fund\b/i,
  },
  {
    slug: "low-duration",
    label: "Low Duration Fund",
    majorCategorySlug: "income-debt",
    re: /\bLow\s+Duration\s+Fund\b/i,
  },
  {
    slug: "money-market",
    label: "Money Market Fund",
    majorCategorySlug: "income-debt",
    re: /\bMoney\s+Market\s+Fund\b/i,
  },
  {
    // Avoid matching "Ultra Short Duration Fund" — lookbehind rejects
    // "Ultra " (6 chars) and "ra " (3 chars) before "Short".
    slug: "short-duration",
    label: "Short Duration Fund",
    majorCategorySlug: "income-debt",
    re: /(?<!Ultra\s)\bShort\s+Duration\s+Fund\b/i,
  },
  {
    slug: "medium-duration",
    label: "Medium Duration Fund",
    majorCategorySlug: "income-debt",
    re: /\bMedium\s+Duration\s+Fund\b/i,
  },
  {
    slug: "medium-to-long-duration",
    label: "Medium to Long Duration Fund",
    majorCategorySlug: "income-debt",
    re: /\bMedium\s+to\s+Long\s+Duration\s+Fund\b/i,
  },
  {
    // Avoid matching "Medium to Long Duration Fund" — lookbehind
    // rejects "to " (3 chars) before "Long".
    slug: "long-duration",
    label: "Long Duration Fund",
    majorCategorySlug: "income-debt",
    re: /(?<!to\s)\bLong\s+Duration\s+Fund\b/i,
  },
  {
    slug: "dynamic-bond",
    label: "Dynamic Bond Fund",
    majorCategorySlug: "income-debt",
    re: /\bDynamic\s+Bond\s+Fund\b/i,
  },
  {
    slug: "corporate-bond",
    label: "Corporate Bond Fund",
    majorCategorySlug: "income-debt",
    re: /\bCorporate\s+Bond\s+Fund\b/i,
  },
  {
    slug: "credit-risk",
    label: "Credit Risk Fund",
    majorCategorySlug: "income-debt",
    re: /\bCredit\s+Risk\s+Fund\b/i,
  },
  {
    slug: "banking-psu",
    label: "Banking and PSU Fund",
    majorCategorySlug: "income-debt",
    re: /\bBanking\s+and\s+PSU\s+Fund\b/i,
  },
  {
    // Avoid matching "Gilt Fund with 10 year constant duration" by
    // refusing to match when followed by " with".
    slug: "gilt",
    label: "Gilt Fund",
    majorCategorySlug: "income-debt",
    re: /\bGilt\s+Fund\b(?!\s+with)/i,
  },
  {
    slug: "gilt-10y-constant",
    label: "Gilt Fund with 10 year constant duration",
    majorCategorySlug: "income-debt",
    re: /\bGilt\s+Fund\s+with\s+10\s+year\s+constant\s+duration\b/i,
  },
  {
    slug: "floater",
    label: "Floater Fund",
    majorCategorySlug: "income-debt",
    re: /\bFloater\s+Fund\b/i,
  },

  // ---- Sub II — Growth/Equity Oriented (11 rows; all in active-equity
  // envelope). Order matters only when two patterns could match the
  // same line — see the disambiguation comments inline.
  //
  // "Multi Cap Fund" vs "Multi Asset Allocation Fund": both start with
  // "Multi" but the "Cap" vs "Asset" second word makes them disjoint.
  {
    slug: "multi-cap",
    label: "Multi Cap Fund",
    majorCategorySlug: "growth-equity",
    re: /\bMulti\s+Cap\s+Fund\b/i,
  },
  // "Large Cap Fund" must NOT collide with "Large & Mid Cap Fund".
  // The pattern requires "Large" then whitespace then "Cap" — the
  // "& Mid" interrupt rejects the other row.
  {
    slug: "large-cap",
    label: "Large Cap Fund",
    majorCategorySlug: "growth-equity",
    re: /\bLarge\s+Cap\s+Fund\b/i,
  },
  {
    slug: "large-mid-cap",
    label: "Large & Mid Cap Fund",
    majorCategorySlug: "growth-equity",
    re: /\bLarge\s*&\s*Mid\s+Cap\s+Fund\b/i,
  },
  // "Mid Cap Fund" appears as a substring inside "Large & Mid Cap Fund".
  // The negative lookbehind `(?<!&\s)` rejects the "& Mid Cap Fund"
  // case so the standalone Mid Cap row is the only match.
  {
    slug: "mid-cap",
    label: "Mid Cap Fund",
    majorCategorySlug: "growth-equity",
    re: /(?<!&\s)\bMid\s+Cap\s+Fund\b/i,
  },
  {
    slug: "small-cap",
    label: "Small Cap Fund",
    majorCategorySlug: "growth-equity",
    re: /\bSmall\s+Cap\s+Fund\b/i,
  },
  {
    slug: "dividend-yield",
    label: "Dividend Yield Fund",
    majorCategorySlug: "growth-equity",
    re: /\bDividend\s+Yield\s+Fund\b/i,
  },
  {
    slug: "value-contra",
    label: "Value Fund/Contra Fund",
    majorCategorySlug: "growth-equity",
    re: /\bValue\s+Fund\s*\/\s*Contra\s+Fund\b/i,
  },
  {
    slug: "focused",
    label: "Focused Fund",
    majorCategorySlug: "growth-equity",
    re: /\bFocused\s+Fund\b/i,
  },
  {
    slug: "sectoral-thematic",
    label: "Sectoral/Thematic Funds",
    majorCategorySlug: "growth-equity",
    // Match "Sectoral/Thematic Funds" (slash) and tolerate "Sectoral-
    // Thematic Funds" if AMFI ever rewords it.
    re: /\bSectoral\s*[/\-]\s*Thematic\s+Funds?\b/i,
  },
  // ELSS appears in two places: open-ended (Sub II) AND close-ended
  // (Sub B-II). The open-ended row appears first in document order, so
  // first-match-per-category-per-file (the loop's `found` set) ensures
  // we capture the open-ended row.
  {
    slug: "elss",
    label: "ELSS",
    majorCategorySlug: "growth-equity",
    re: /\bELSS\b/i,
  },
  {
    slug: "flexi-cap",
    label: "Flexi Cap Fund",
    majorCategorySlug: "growth-equity",
    re: /\bFlexi\s+Cap\s+Fund\b/i,
  },

  // ---- Sub III — Hybrid (all 6 rows). Arbitrage IS in the Hybrid
  // major category (it's row v under Sub III on the AMFI table) so it
  // belongs here for the drilldown denominator, even though the IIFL-
  // active-equity envelope formula excludes it.
  {
    slug: "conservative-hybrid",
    label: "Conservative Hybrid Fund",
    majorCategorySlug: "hybrid",
    re: /\bConservative\s+Hybrid\s+Fund\b/i,
  },
  {
    slug: "balanced-aggressive-hybrid",
    label: "Balanced Hybrid Fund/Aggressive Hybrid Fund",
    majorCategorySlug: "hybrid",
    re: /\bBalanced\s+Hybrid\s+Fund\s*\/\s*Aggressive\s+Hybrid\s+Fund\b/i,
  },
  {
    slug: "baf-daa",
    label: "Dynamic Asset Allocation/Balanced Advantage Fund",
    majorCategorySlug: "hybrid",
    re: /\bDynamic\s+Asset\s+Allocation\s*\/\s*Balanced\s+Advantage\s+Fund\b/i,
  },
  {
    slug: "multi-asset",
    label: "Multi Asset Allocation Fund",
    majorCategorySlug: "hybrid",
    re: /\bMulti[\s-]+Asset[\s-]+Allocation\s+Fund\b/i,
  },
  {
    slug: "arbitrage",
    label: "Arbitrage Fund",
    majorCategorySlug: "hybrid",
    re: /\bArbitrage\s+Fund\b/i,
  },
  {
    slug: "equity-savings",
    label: "Equity Savings Fund",
    majorCategorySlug: "hybrid",
    re: /\bEquity\s+Savings\s+Fund\b/i,
  },

  // ---- Sub IV — Solution Oriented (both rows). Extracted but not
  // surfaced in the drilldown UI. AMFI writes "Childrens Fund" without
  // an apostrophe in some vintages and "Children's Fund" in others;
  // tolerate both.
  {
    slug: "retirement",
    label: "Retirement Fund",
    majorCategorySlug: "solution",
    re: /\bRetirement\s+Fund\b/i,
  },
  {
    slug: "childrens",
    label: "Childrens Fund",
    majorCategorySlug: "solution",
    re: /\bChildren'?s\s+Fund\b/i,
  },

  // ---- Sub V — Other Schemes (4 rows). The denominator for this
  // group is captured separately as `otherSchemesAaum` /
  // `otherSchemesNetInflow` from the Sub Total - V row.
  {
    slug: "index-funds",
    label: "Index Funds",
    majorCategorySlug: "other-schemes",
    re: /\bIndex\s+Funds?\b/i,
  },
  {
    slug: "gold-etf",
    label: "GOLD ETF",
    majorCategorySlug: "other-schemes",
    // AMFI writes "GOLD ETF" (uppercase) — `i` flag matches both.
    re: /\bGOLD\s+ETF\b/i,
  },
  {
    slug: "other-etfs",
    label: "Other ETFs",
    majorCategorySlug: "other-schemes",
    re: /\bOther\s+ETFs?\b/i,
  },
  {
    slug: "fof-overseas",
    label: "Fund of funds investing overseas",
    majorCategorySlug: "other-schemes",
    re: /\bFund\s+of\s+funds\s+investing\s+overseas\b/i,
  },
];

type Format = "monthly-report" | "press-release" | "unknown";

interface PdfPage {
  num: number;
  text: string;
}

// -------- format detection ---------------------------------------------

/**
 * Format heuristics — keep the Monthly-Report signals STRICT so that
 * a press-release "Monthly Note" isn't misclassified just because it
 * mentions phrases like "Income/Debt Oriented Schemes" in a chart
 * legend. The unambiguous tell of a Monthly Report is the per-scheme
 * sub-totals (Sub Total - I/II/III/IV/V) which never appear in the
 * Crisil-produced press-release notes.
 */
function detectFormat(pages: PdfPage[]): Format {
  const text = pages.map((p) => p.text).join("\n");
  // Monthly Report unambiguously contains explicit "Sub Total - <roman>"
  // labels on its per-scheme rows. Nothing else carries that wording.
  // [IV]+ matches the roman numerals I, II, III, IV, V, VI, VII, VIII
  // that appear as section identifiers in the per-scheme table.
  if (/\bSub\s*Total\s*-\s*[IV]+\b/i.test(text)) return "monthly-report";
  // Press release / Monthly Note signals.
  const pressReleaseSignals = [
    /\bAMFI\s+monthly\s+note\b/i,
    /\bMonthly\s+mutual\s+fund\s+industry\s+update\b/i,
    /\bSIP\s+monthly\s+contribution\b/i,
    /\bNote\s+for\s+(?:the\s+)?Press\b/i,
    /\bSIP\s+Contribution\b/i,
    /\bIndustry\s+snapshot\b/i,
  ];
  if (pressReleaseSignals.some((re) => re.test(text))) return "press-release";
  return "unknown";
}

// -------- month detection ----------------------------------------------

const MONTH_NAMES =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * Generic month + 4-digit year scanner. Crucially, this requires a
 * FOUR-digit year — that's what dropped the bug where "as on March 31,
 * 2026" was being read as "March '31" → 2031. AMFI never abbreviates
 * years to 2 digits without an apostrophe in these documents.
 */
function findMonthYear(text: string): string | null {
  const re = new RegExp(String.raw`\b` + MONTH_NAMES + String.raw`[\s\-,/]+(\d{4})\b`, "i");
  const m = re.exec(text);
  if (!m) return null;
  return parseMonth(`${m[1]} ${m[2]}`);
}

/**
 * Detect the calendar month the PDF reports on.
 * Priority order (highest first):
 *   1. First <Month> <Year> on page 1 — both AMFI publications put the
 *      canonical reporting period prominently on page 1 ("AMFI monthly
 *      note February 2026" for press-release Notes; "Funds Mobilized for
 *      the month of March 2026" for the per-scheme Monthly Report). The
 *      page-1 scan is checked FIRST so a chart caption deeper in the
 *      doc that references a comparison month (e.g. a US-flows panel
 *      saying "for the month of January 2026" inside a February-period
 *      Note) doesn't mis-set the row's month. (See the Feb 2026 Note
 *      audit on this branch — that exact bug.)
 *   2. "for the month of <Month> <Year>" anywhere — fallback when the
 *      first-page text is unusually sparse (some legacy formats had
 *      blank cover pages).
 *   3. "Monthly Report for <Month>-<Year>" anywhere — explicit Monthly
 *      Report footer title.
 *   4. ISO-style filename "<YYYY>-<MM>" or "<YYYY>_<MM>".
 *   5. <Month> <Year> on later pages — last-resort fallback.
 *
 * NEVER matches "as on <Month> 31, <Year>" as "<Month> '31" → 2031,
 * because findMonthYear requires a 4-digit year.
 */
function detectMonth(filename: string, pages: PdfPage[]): string | null {
  const allText = pages.map((p) => p.text).join("\n");

  // Priority 1: first month + 4-digit year on page 1. Wins for both
  // formats because page 1 is the title page (Notes) or the table
  // header where the report period appears first ("for the month of
  // March 2026" on Monthly Reports).
  if (pages.length > 0) {
    const firstPageMonth = findMonthYear(pages[0].text);
    if (firstPageMonth) return firstPageMonth;
  }

  // Priority 2: "for the month of March 2026" anywhere. Fallback only
  // — primary detection is the page-1 scan above.
  const forMonth = new RegExp(
    String.raw`for\s+the\s+month(?:\s+of)?\s+` + MONTH_NAMES + String.raw`[\s\-,/]+(\d{4})\b`,
    "i"
  );
  const forMatch = forMonth.exec(allText);
  if (forMatch) {
    const m = parseMonth(`${forMatch[1]} ${forMatch[2]}`);
    if (m) return m;
  }

  // Priority 3: "Monthly Report for March-2026" or "March-2026"
  const reportFor = new RegExp(
    String.raw`Monthly\s+Report\s+for\s+` + MONTH_NAMES + String.raw`[\s\-]+(\d{4})\b`,
    "i"
  );
  const reportMatch = reportFor.exec(allText);
  if (reportMatch) {
    const m = parseMonth(`${reportMatch[1]} ${reportMatch[2]}`);
    if (m) return m;
  }

  // Priority 4: ISO-style filename
  const stem = filename.replace(/\.[^.]+$/, "");
  const isoMatch = /(\d{4})[-_](\d{2})/.exec(stem);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) return `${isoMatch[1]}-${isoMatch[2]}`;
  }

  // Priority 5: month + year anywhere
  for (const p of pages.slice(1)) {
    const m = findMonthYear(p.text);
    if (m) return m;
  }

  return null;
}

// -------- shared numeric helpers ---------------------------------------

const NUM_TOKEN = /^-?\d[\d,]*(?:\.\d+)?$/;

function parseLooseNumber(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull all numeric tokens out of a single line. Trailing "-" cells in
 * the AMFI Monthly Report tables (segregated portfolios columns when
 * empty) are preserved as null so column indices stay aligned with
 * the table header. LEADING "-" tokens — e.g. the separator dash in a
 * label like "Sub Total - II" — are skipped so they don't shift all
 * downstream column indices by one.
 */
function numericColumns(line: string): (number | null)[] {
  const tokens = line.trim().split(/\s+/);
  const out: (number | null)[] = [];
  let started = false;
  for (const t of tokens) {
    if (t === "-" || t === "—") {
      if (started) out.push(null);
      continue;
    }
    if (NUM_TOKEN.test(t)) {
      out.push(parseLooseNumber(t));
      started = true;
    }
  }
  return out;
}

// -------- Monthly Report parser ----------------------------------------

/**
 * Monthly Report column ordering, per the AMFI table headers:
 *   0. No. of Schemes
 *   1. No. of Folios
 *   2. Funds Mobilized (₹ Cr)
 *   3. Repurchase / Redemption (₹ Cr)
 *   4. Net Inflow (+ve) / Outflow (-ve) (₹ Cr)
 *   5. Net AUM as on month-end (₹ Cr)
 *   6. Average Net AUM for the month (₹ Cr)
 *   7. No. of segregated portfolios
 *   8. Net AUM in segregated portfolio
 *
 * Sub-totals and Grand Total share this column ordering. Per-scheme
 * rows like "Liquid Fund" use the same ordering but with the label
 * inline at the start of the line.
 */
const COL_NET_INFLOW = 4;
const COL_NET_AUM = 5;
const COL_AAUM = 6;

interface FieldHit {
  value: number;
  page: number;
  /** Human-readable label for which row/column produced this value.
   *  Surfaced via `fieldSources[field].sourceLabel` so the dashboard
   *  can show "Sub Total - II row · Net AUM column" in tooltips. */
  label: string;
}

interface MonthlyReportHits {
  totalAum?: FieldHit;
  totalAaum?: FieldHit;
  netInflow?: FieldHit;
  equityAum?: FieldHit;
  debtAum?: FieldHit;
  liquidAum?: FieldHit;
  // Category-level net flows. Sub Total - I (Income/Debt) → debtNetInflow,
  // Sub Total - II (Growth/Equity) → equityNetInflow, Liquid Fund row →
  // liquidNetInflow. liquidNetInflow is a SUB-component of debtNetInflow
  // (Liquid Fund is a row inside the Income/Debt section), exposed
  // separately so the dashboard can plot it as its own series.
  equityNetInflow?: FieldHit;
  debtNetInflow?: FieldHit;
  liquidNetInflow?: FieldHit;
  // IIFL Figure 19-style equity breakdown derived from AMFI rows.
  // See AmfiMonthlyPdfRow docstring for the per-field formula.
  activeEquityAum?: FieldHit;
  etfIndexAum?: FieldHit;
  arbitrageAum?: FieldHit;
  // Active-equity-envelope net inflow (signed). Derived from
  // Sub II + (Sub III − Arbitrage) + Sub IV netInflows. Mirrors
  // activeEquityAum but on the flow column.
  activeEquityNetInflow?: FieldHit;
  // Industry totals: total folios from page-1 Grand Total row's
  // "No. of Folios" column; NFO count + funds-mobilised from
  // the New Schemes Report on page 2.
  industryFolios?: FieldHit;
  industryNfoCount?: FieldHit;
  industryNfoFundsMobilized?: FieldHit;
  // Major-category AAUM / Net AUM / Net Inflow denominators —
  // used by the /monthly Category Drilldown. All sourced from
  // page-1 Sub Total - I / II / III / V rows. Sub Total - I and
  // Sub Total - II Net AUM and net inflow already exist as
  // debtAum / equityAum / debtNetInflow / equityNetInflow above.
  debtAaum?: FieldHit;
  equityAaum?: FieldHit;
  hybridAum?: FieldHit;
  hybridAaum?: FieldHit;
  hybridNetInflow?: FieldHit;
  otherSchemesAum?: FieldHit;
  otherSchemesAaum?: FieldHit;
  otherSchemesNetInflow?: FieldHit;
  // AAUM mirrors of the IIFL active-equity envelope fields.
  activeEquityAaum?: FieldHit;
  etfIndexAaum?: FieldHit;
  arbitrageAaum?: FieldHit;
}

/** Internal scratch — intermediate row values that feed the IIFL-
 *  derived fields. NOT stored on the row schema (which carries only
 *  the final derived values), but tracked through parsing so we can
 *  reject the derivation if ANY contributing row is missing.
 *
 *  Each Sub Total / row-level entry has TWO companion slots: the
 *  Net AUM column (no suffix) and the Net Inflow / Outflow column
 *  (suffix `Flow`). The AUM slots feed activeEquityAum / etfIndexAum
 *  / arbitrageAum; the Flow slots feed activeEquityNetInflow. */
interface MonthlyReportIntermediates {
  subTotalII?: FieldHit;       // Growth/Equity Oriented Schemes total — Net AUM
  subTotalIII?: FieldHit;      // Hybrid Schemes total — Net AUM
  subTotalIV?: FieldHit;       // Solution Oriented Schemes total — Net AUM
  arbitrageRow?: FieldHit;     // Arbitrage Fund row (sub of Sub III) — Net AUM
  indexFundsRow?: FieldHit;    // Index Funds row (sub of Sub V) — Net AUM
  otherEtfsRow?: FieldHit;     // Other ETFs row (sub of Sub V) — Net AUM
  // Net Inflow / Outflow column counterparts for the active-equity
  // envelope flow derivation. equityNetInflow (Sub II flow) is
  // captured directly on `hits` and reused; we only need the three
  // below as new intermediates.
  subTotalIIIflow?: FieldHit;
  subTotalIVflow?: FieldHit;
  arbitrageRowFlow?: FieldHit;
  // AAUM-side intermediates — Sub II AAUM and Sub III AAUM are captured
  // directly on hits (equityAaum / hybridAaum). The four below feed the
  // AAUM-based derived fields (activeEquityAaum / etfIndexAaum /
  // arbitrageAaum) without bloating the public schema.
  subTotalIVaaum?: FieldHit;
  arbitrageRowAaum?: FieldHit;
  indexFundsRowAaum?: FieldHit;
  otherEtfsRowAaum?: FieldHit;
}

/**
 * Find the FIRST data line at or after `startIdx` whose first numeric
 * token is at index `expectedNumericIndex` of the tokenised line. We
 * use this to find the data row that follows a Sub Total / Grand Total
 * label that may span multiple lines (the formula "(i+ii+iii+...)" is
 * sometimes wrapped). Returns the columns of that row.
 */
function findDataRow(
  lines: string[],
  startIdx: number,
  /** Stop searching after this many lines past `startIdx`. */
  windowLines = 6
): (number | null)[] | null {
  for (let i = startIdx; i < Math.min(lines.length, startIdx + windowLines); i++) {
    const cols = numericColumns(lines[i]);
    // Heuristic: a real data row has at least 7 numeric/null tokens in
    // a row (schemes, folios, funds, repurchase, netInflow, netAum,
    // aaum). Lines like "(i+ii+iii+...)" decompose to 0 numeric tokens.
    if (cols.length >= 7 && lines[i].trim().length > 0) {
      // Reject lines that are clearly the formula "(i+ii+...)" or
      // bare scheme names — neither contains comma-separated thousand
      // groups, so an additional check on the netAum cell suffices:
      // a real netAum is a comma-formatted number > 0.
      const candidate = cols[COL_NET_AUM];
      if (candidate !== null && candidate > 0) return cols;
      // Some Sub Totals have segregatedPortfolios=- so cols[7]/[8] are
      // null but we still want them. The data-row check above already
      // accepts that.
      if (cols.length >= 9) return cols;
    }
  }
  return null;
}

function parseMonthlyReport(pages: PdfPage[]): {
  hits: MonthlyReportHits;
  pagesUsed: Set<number>;
} {
  const hits: MonthlyReportHits = {};
  const pagesUsed = new Set<number>();
  // Scratch for intermediate rows (Sub Total - II/III/IV, Arbitrage,
  // Index Funds, Other ETFs) used to derive the IIFL Figure 19-style
  // activeEquityAum / etfIndexAum / arbitrageAum after parsing.
  const inter: MonthlyReportIntermediates = {};

  // Match the row labels we care about. For block-style sub totals,
  // the label sits on its own line(s) and the data row comes 1-3 lines
  // later. For the Liquid Fund / Active Equity rows, the label and
  // data are on the SAME line, with the label prefixed by a roman
  // numeral.
  //
  // `interKey` (when set) ALSO captures the row's Net AUM into the
  // intermediates object — used by rows that don't directly map to a
  // public field but feed a derived field (e.g. Sub Total - III feeds
  // activeEquityAum but isn't itself a public KPI).
  const blockLabels: {
    key: keyof MonthlyReportHits | null;
    interKey?: keyof MonthlyReportIntermediates;
    re: RegExp;
    label: string;
  }[] = [
    {
      key: "debtAum",
      re: /^\s*Sub\s*Total\s*-\s*I\b(?!\s*[IV])/i, // Sub Total - I, NOT II/III/IV
      label: "Sub Total - I row · Net AUM column",
    },
    {
      key: "equityAum",
      interKey: "subTotalII",
      re: /^\s*Sub\s*Total\s*-\s*II\b(?!\s*[IV])/i,
      label: "Sub Total - II row · Net AUM column",
    },
    {
      key: null,
      interKey: "subTotalIII",
      re: /^\s*Sub\s*Total\s*-\s*III\b/i,
      label: "Sub Total - III row · Net AUM column",
    },
    {
      key: null,
      interKey: "subTotalIV",
      re: /^\s*Sub\s*Total\s*-\s*IV\b/i,
      label: "Sub Total - IV row · Net AUM column",
    },
    {
      // Sub Total - V (Other Schemes) — denominator for the Other
      // Schemes drilldown. Captures Net AUM here; AAUM and net
      // inflow are captured in the netInflow/aaum side branch
      // below using `spec.key === "otherSchemesAum"`.
      key: "otherSchemesAum",
      re: /^\s*Sub\s*Total\s*-\s*V\b/i,
      label: "Sub Total - V row · Net AUM column",
    },
    {
      key: "totalAum",
      re: /^\s*Grand\s+Total\b/i,
      label: "Grand Total row · Net AUM column",
    },
  ];

  // Inline rows: label and numbers on the same line.
  // `interKey` works the same way as on blockLabels.
  const inlineLabels: {
    key: keyof MonthlyReportHits | null;
    interKey?: keyof MonthlyReportIntermediates;
    re: RegExp;
    targetCol: number;
    label: string;
  }[] = [
    {
      key: "liquidAum",
      // "ii Liquid Fund 42 27,19,972 4,55,110.25 ..."
      re: /\bLiquid\s+Fund\b/i,
      targetCol: COL_NET_AUM,
      label: "Liquid Fund row · Net AUM column",
    },
    {
      key: null,
      interKey: "arbitrageRow",
      re: /\bArbitrage\s+Fund\b/i,
      targetCol: COL_NET_AUM,
      label: "Arbitrage Fund row · Net AUM column",
    },
    {
      key: null,
      interKey: "indexFundsRow",
      re: /\bIndex\s+Funds?\b/i,
      targetCol: COL_NET_AUM,
      label: "Index Funds row · Net AUM column",
    },
    {
      key: null,
      interKey: "otherEtfsRow",
      re: /\bOther\s+ETFs?\b/i,
      targetCol: COL_NET_AUM,
      label: "Other ETFs row · Net AUM column",
    },
  ];

  for (const page of pages) {
    const lines = page.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Block labels. The data row may be either:
      //   - INLINE on the same line as the label (most rows, e.g.
      //     "Sub Total - II (i+ii+...) 568 ... 31,97,698.15 ..."
      //     and "Grand Total 1958 ... 73,73,376.98 ..."), or
      //   - 1-3 lines below the label when the formula breaks across
      //     lines (e.g. Sub Total - I has 16 sub-items and overflows).
      // findDataRow accepts both because we start at the label line.
      for (const spec of blockLabels) {
        // Skip if either the public hit (when key is set) or the
        // intermediate (when interKey is set) is already filled.
        if (spec.key && hits[spec.key]) continue;
        if (spec.interKey && inter[spec.interKey]) continue;
        if (!spec.re.test(line)) continue;
        const dataCols = findDataRow(lines, i, 6);
        if (!dataCols) continue;
        const aum = dataCols[COL_NET_AUM];
        if (aum === null || aum <= 0) continue;
        const hit: FieldHit = { value: aum, page: page.num, label: spec.label };
        if (spec.key) hits[spec.key] = hit;
        if (spec.interKey) inter[spec.interKey] = hit;
        pagesUsed.add(page.num);
        // Each Sub Total / Grand Total row also carries a net-flow
        // column for the SAME category. Capture it alongside the
        // AUM so callers can render category-level monthly flow
        // charts (Figure 22 in the IIFL deck). Net flows can be
        // positive OR negative, so the only guard is "not null".
        const netInflow = dataCols[COL_NET_INFLOW];
        if (spec.key === "totalAum") {
          const aaum = dataCols[COL_AAUM];
          if (aaum !== null && aaum > 0 && !hits.totalAaum) {
            hits.totalAaum = {
              value: aaum,
              page: page.num,
              label: "Grand Total row · Average Net AUM column",
            };
          }
          if (netInflow !== null && !hits.netInflow) {
            hits.netInflow = {
              value: netInflow,
              page: page.num,
              label: "Grand Total row · Net Inflow / Outflow column",
            };
          }
          // Industry-wide folio count = column 1 of the Grand Total
          // row (No. of Folios). Stored as a raw integer count.
          const folios = dataCols[1];
          if (folios !== null && folios > 0 && !hits.industryFolios) {
            hits.industryFolios = {
              value: Math.round(folios),
              page: page.num,
              label: "Grand Total row · No. of Folios column",
            };
          }
        } else if (spec.key === "debtAum") {
          if (netInflow !== null && !hits.debtNetInflow) {
            hits.debtNetInflow = {
              value: netInflow,
              page: page.num,
              label: "Sub Total - I row · Net Inflow / Outflow column",
            };
          }
          const aaum = dataCols[COL_AAUM];
          if (aaum !== null && aaum > 0 && !hits.debtAaum) {
            hits.debtAaum = {
              value: aaum,
              page: page.num,
              label: "Sub Total - I row · Average Net AUM column",
            };
          }
        } else if (spec.key === "equityAum") {
          if (netInflow !== null && !hits.equityNetInflow) {
            hits.equityNetInflow = {
              value: netInflow,
              page: page.num,
              label: "Sub Total - II row · Net Inflow / Outflow column",
            };
          }
          const aaum = dataCols[COL_AAUM];
          if (aaum !== null && aaum > 0 && !hits.equityAaum) {
            hits.equityAaum = {
              value: aaum,
              page: page.num,
              label: "Sub Total - II row · Average Net AUM column",
            };
          }
        } else if (spec.key === "otherSchemesAum") {
          if (netInflow !== null && !hits.otherSchemesNetInflow) {
            hits.otherSchemesNetInflow = {
              value: netInflow,
              page: page.num,
              label: "Sub Total - V row · Net Inflow / Outflow column",
            };
          }
          const aaum = dataCols[COL_AAUM];
          if (aaum !== null && aaum > 0 && !hits.otherSchemesAaum) {
            hits.otherSchemesAaum = {
              value: aaum,
              page: page.num,
              label: "Sub Total - V row · Average Net AUM column",
            };
          }
        }
        // Capture the Net Inflow / Outflow column on Sub III and Sub
        // IV so we can derive activeEquityNetInflow downstream. (Sub
        // II's flow is already captured above as equityNetInflow.)
        if (spec.interKey === "subTotalIII") {
          if (netInflow !== null && !inter.subTotalIIIflow) {
            inter.subTotalIIIflow = {
              value: netInflow,
              page: page.num,
              label: "Sub Total - III row · Net Inflow / Outflow column",
            };
          }
          // Sub III is the Hybrid major-category denominator. Mirror
          // the Sub I/II/V handlers above to expose Hybrid's Net AUM,
          // AAUM, and Net Inflow as public hits.
          if (!hits.hybridAum) {
            hits.hybridAum = {
              value: aum,
              page: page.num,
              label: "Sub Total - III row · Net AUM column",
            };
          }
          if (netInflow !== null && !hits.hybridNetInflow) {
            hits.hybridNetInflow = {
              value: netInflow,
              page: page.num,
              label: "Sub Total - III row · Net Inflow / Outflow column",
            };
          }
          const aaum = dataCols[COL_AAUM];
          if (aaum !== null && aaum > 0 && !hits.hybridAaum) {
            hits.hybridAaum = {
              value: aaum,
              page: page.num,
              label: "Sub Total - III row · Average Net AUM column",
            };
          }
        } else if (spec.interKey === "subTotalIV") {
          if (netInflow !== null && !inter.subTotalIVflow) {
            inter.subTotalIVflow = {
              value: netInflow,
              page: page.num,
              label: "Sub Total - IV row · Net Inflow / Outflow column",
            };
          }
          const aaum = dataCols[COL_AAUM];
          if (aaum !== null && aaum > 0 && !inter.subTotalIVaaum) {
            inter.subTotalIVaaum = {
              value: aaum,
              page: page.num,
              label: "Sub Total - IV row · Average Net AUM column",
            };
          }
        }
      }

      // Inline labels (data on the same line as the label).
      for (const spec of inlineLabels) {
        if (spec.key && hits[spec.key]) continue;
        if (spec.interKey && inter[spec.interKey]) continue;
        if (!spec.re.test(line)) continue;
        const cols = numericColumns(line);
        // For inline rows the row label may consume 1-2 leading
        // tokens (roman numeral, scheme name); the numeric columns
        // start whenever the first numeric token appears.
        if (cols.length < 7) continue;
        const aum = cols[spec.targetCol];
        if (aum === null || aum <= 0) continue;
        const hit: FieldHit = { value: aum, page: page.num, label: spec.label };
        if (spec.key) hits[spec.key] = hit;
        if (spec.interKey) inter[spec.interKey] = hit;
        pagesUsed.add(page.num);
        // The Liquid Fund inline row also carries a net-flow
        // column. Capture as liquidNetInflow (signed; can be
        // negative on outflow months). This is itself a sub-
        // component of debtNetInflow — see schema docstring.
        if (spec.key === "liquidAum") {
          const netInflow = cols[COL_NET_INFLOW];
          if (netInflow !== null && !hits.liquidNetInflow) {
            hits.liquidNetInflow = {
              value: netInflow,
              page: page.num,
              label: "Liquid Fund row · Net Inflow / Outflow column",
            };
          }
        }
        // Arbitrage Fund inline row also carries a net-flow column.
        // Captured as the third intermediate piece of the active-
        // equity envelope flow (Sub II + Sub III ex-arb + Sub IV).
        if (spec.interKey === "arbitrageRow") {
          const netInflow = cols[COL_NET_INFLOW];
          if (netInflow !== null && !inter.arbitrageRowFlow) {
            inter.arbitrageRowFlow = {
              value: netInflow,
              page: page.num,
              label: "Arbitrage Fund row · Net Inflow / Outflow column",
            };
          }
        }
        // AAUM-side intermediates for the IIFL active-equity envelope
        // (AAUM mirror of arbitrageRow / indexFundsRow / otherEtfsRow).
        const aaum = cols[COL_AAUM];
        if (aaum !== null && aaum > 0) {
          if (spec.interKey === "arbitrageRow" && !inter.arbitrageRowAaum) {
            inter.arbitrageRowAaum = {
              value: aaum,
              page: page.num,
              label: "Arbitrage Fund row · Average Net AUM column",
            };
          } else if (
            spec.interKey === "indexFundsRow" &&
            !inter.indexFundsRowAaum
          ) {
            inter.indexFundsRowAaum = {
              value: aaum,
              page: page.num,
              label: "Index Funds row · Average Net AUM column",
            };
          } else if (
            spec.interKey === "otherEtfsRow" &&
            !inter.otherEtfsRowAaum
          ) {
            inter.otherEtfsRowAaum = {
              value: aaum,
              page: page.num,
              label: "Other ETFs row · Average Net AUM column",
            };
          }
        }
      }
    }
  }

  // ---- Derive IIFL Figure 19-style fields from intermediate rows ---
  //
  // arbitrageAum = the Arbitrage Fund row alone (Sub Total - III's
  // sub-row). Direct mapping; no math.
  if (inter.arbitrageRow) {
    hits.arbitrageAum = {
      value: inter.arbitrageRow.value,
      page: inter.arbitrageRow.page,
      label: "Arbitrage Fund row · Net AUM column",
    };
  }

  // etfIndexAum = Index Funds + Other ETFs (excludes Gold ETFs and
  // Fund of Funds investing overseas). Reconciles to within ~0.4% of
  // IIFL Figure 19 reference for Feb 2026.
  if (inter.indexFundsRow && inter.otherEtfsRow) {
    hits.etfIndexAum = {
      value: inter.indexFundsRow.value + inter.otherEtfsRow.value,
      page: inter.indexFundsRow.page,
      label:
        "Index Funds row + Other ETFs row · Net AUM column · " +
        "(IIFL Figure 19-style; excludes Gold ETFs and Fund of Funds " +
        "investing overseas)",
    };
  }

  // activeEquityAum = Sub Total - II + (Sub Total - III - Arbitrage
  // Fund row) + Sub Total - IV. Captures the active equity-oriented
  // component (Growth/Equity Schemes) plus all active hybrid rows
  // (Conservative, Balanced/Aggressive, Dynamic Allocation, Multi-
  // Asset, Equity Savings) plus Solution-Oriented schemes (Retirement
  // and Children's). Excludes the Arbitrage Fund row (IIFL splits it
  // out as its own bucket). Reconciles to within ~1% of IIFL Figure
  // 19 reference for Feb 2026; the residual is consistent with IIFL
  // using period-average AAUM vs our closing-balance Net AUM.
  if (inter.subTotalII && inter.subTotalIII && inter.subTotalIV && inter.arbitrageRow) {
    const v =
      inter.subTotalII.value +
      (inter.subTotalIII.value - inter.arbitrageRow.value) +
      inter.subTotalIV.value;
    hits.activeEquityAum = {
      value: v,
      page: inter.subTotalII.page,
      label:
        "Sub Total - II + (Sub Total - III − Arbitrage Fund row) + " +
        "Sub Total - IV · Net AUM column · " +
        "(IIFL Figure 19-style active equity)",
    };
  }

  // ---- AAUM-side derivations (IIFL active-equity envelope, AAUM) ---
  // arbitrageAaum = Arbitrage Fund row · Average Net AUM column.
  if (inter.arbitrageRowAaum) {
    hits.arbitrageAaum = {
      value: inter.arbitrageRowAaum.value,
      page: inter.arbitrageRowAaum.page,
      label: "Arbitrage Fund row · Average Net AUM column",
    };
  }
  // etfIndexAaum = Index Funds AAUM + Other ETFs AAUM. Same exclusions
  // as etfIndexAum (no Gold ETFs / FoF Overseas).
  if (inter.indexFundsRowAaum && inter.otherEtfsRowAaum) {
    hits.etfIndexAaum = {
      value:
        inter.indexFundsRowAaum.value + inter.otherEtfsRowAaum.value,
      page: inter.indexFundsRowAaum.page,
      label:
        "Index Funds AAUM + Other ETFs AAUM · " +
        "(IIFL Figure 19-style; excludes Gold ETFs and Fund of Funds " +
        "investing overseas)",
    };
  }
  // activeEquityAaum = Sub II AAUM + (Sub III AAUM − Arbitrage AAUM) +
  // Sub IV AAUM. AAUM mirror of activeEquityAum.
  if (
    hits.equityAaum &&
    hits.hybridAaum &&
    inter.subTotalIVaaum &&
    inter.arbitrageRowAaum
  ) {
    const v =
      hits.equityAaum.value +
      (hits.hybridAaum.value - inter.arbitrageRowAaum.value) +
      inter.subTotalIVaaum.value;
    hits.activeEquityAaum = {
      value: v,
      page: hits.equityAaum.page,
      label:
        "Sub II AAUM + Sub III ex-Arbitrage AAUM + Sub IV AAUM · " +
        "(IIFL Figure 19-style active-equity envelope, period-average)",
    };
  }

  // activeEquityNetInflow — flow-side mirror of activeEquityAum:
  //   Sub II net inflow                                  (= equityNetInflow)
  //   + (Sub III net inflow − Arbitrage Fund net inflow)
  //   + Sub IV net inflow
  // Used as the denominator for IIFL Figure 31-34 net-inflow shares
  // so a hybrid-oriented category like Multi-Asset Allocation
  // compares apples-to-apples with Sub-II equity-oriented categories.
  // Signed; can be positive or negative on any given month.
  if (
    hits.equityNetInflow &&
    inter.subTotalIIIflow &&
    inter.arbitrageRowFlow &&
    inter.subTotalIVflow
  ) {
    const v =
      hits.equityNetInflow.value +
      (inter.subTotalIIIflow.value - inter.arbitrageRowFlow.value) +
      inter.subTotalIVflow.value;
    hits.activeEquityNetInflow = {
      value: v,
      page: hits.equityNetInflow.page,
      label:
        "Sub II net inflow + Sub III ex-Arbitrage net inflow + " +
        "Sub IV net inflow · (IIFL Figure 19-style active-equity " +
        "envelope flow)",
    };
  }

  // ---- New Schemes Report (industry NFO totals) ---------------------
  //
  // The AMFI Monthly Report's New Schemes Report (typically page 2)
  // has a "Grand Total" / "Total A + B + C [+ D]" row with 4 numeric
  // columns: open-ended count, open-ended funds, close-ended count,
  // close-ended funds (older PDFs follow with 2 redundant total
  // columns; we only consume the first 4 and compute totals
  // ourselves so the parser is independent of layout drift).
  //
  // Layout variants seen across vintages (each captures 2 mandatory
  // numbers — count, funds — and an OPTIONAL second pair for layouts
  // that split open-ended vs close-ended):
  //   - Mar 2026 / Feb 2026   "Grand Total (A+B+C+D) 23 3743 1 242"
  //                            (4 numbers: open count/funds + close count/funds)
  //   - Apr 2025 / Apr 2024   "Total A + B + C [+ D] 7 350 - - 7 350"
  //                            (4 numbers + 2 redundant total cols; we use
  //                             only the first 4)
  //   - Dec 2025 / Jan 2026   "Total (A + B + C + D) 23 4,074"
  //                            (2 numbers: combined count + funds; no split)
  // NO `i` flag and `[A-E]` only (uppercase) — keeps the regex away
  // from lowercase Roman numerals like "(i+ii+iii+iv)" used by the
  // close-ended Sub Total rows on page 1, which would otherwise yield
  // wrong NFO totals. A-E covers 4-cat (A+B+C+D) and 5-cat
  // (A+B+C+D+E, e.g. Dec 2024 "Other Schemes") layouts.
  const NSR_GRAND_TOTAL = new RegExp(
    String.raw`(?:Grand\s+Total\s*\(\s*[A-E](?:\s*\+\s*[A-E])+\s*\)|Total\s*(?:\(\s*[A-E](?:\s*\+\s*[A-E])+\s*\)|[A-E](?:\s*\+\s*[A-E]){1,4}))` +
      String.raw`\s+(\d[\d,]*)\s+(-|\d[\d,]*)` +
      String.raw`(?:\s+(-|\d[\d,]*)\s+(-|\d[\d,]*))?`
  );
  for (const page of pages) {
    if (hits.industryNfoCount && hits.industryNfoFundsMobilized) break;
    const m = NSR_GRAND_TOTAL.exec(page.text);
    if (!m) continue;
    const parseTok = (t: string | undefined) => {
      if (!t || t === "-" || t === "—") return 0;
      return Number(t.replace(/,/g, ""));
    };
    const count1 = parseTok(m[1]);
    const funds1 = parseTok(m[2]);
    const count2 = parseTok(m[3]);
    const funds2 = parseTok(m[4]);
    if (![count1, funds1, count2, funds2].every((n) => Number.isFinite(n))) {
      continue;
    }
    // 2-col layout (m[3]/m[4] absent) → count1/funds1 ARE the total.
    // 4-col layout → sum open+close.
    const splitLayout = m[3] !== undefined && m[4] !== undefined;
    const totalCount = splitLayout ? count1 + count2 : count1;
    const totalFunds = splitLayout ? funds1 + funds2 : funds1;
    if (!hits.industryNfoCount && totalCount > 0) {
      hits.industryNfoCount = {
        value: totalCount,
        page: page.num,
        label:
          "New Schemes Report · Grand Total row · No. of schemes" +
          (splitLayout ? " (open + close-ended)" : ""),
      };
    }
    if (!hits.industryNfoFundsMobilized && totalFunds > 0) {
      hits.industryNfoFundsMobilized = {
        value: totalFunds,
        page: page.num,
        label:
          "New Schemes Report · Grand Total row · Funds mobilized" +
          (splitLayout ? " (open + close-ended)" : ""),
      };
    }
    pagesUsed.add(page.num);
  }

  // ---- New Schemes Report fallback ---------------------------------
  //
  // April 2026's Monthly Report PDF (and likely later AMFI vintages)
  // splits the New Schemes table across separate text objects, so
  // pdf-parse no longer extracts "Grand Total (A+B+C) <count> <funds>"
  // on a single line. The label arrives without numbers, and the
  // per-section sub-totals + the grand total emerge later as
  // stand-alone "<count> <funds>" lines.
  //
  // When the inline regex above didn't fire but the page is clearly a
  // New-Schemes-Report page, fall back to scanning the page for line-
  // shaped digit pairs and picking the one with the highest count.
  // Per-scheme rows (count=1) are filtered out so single-scheme rows
  // don't masquerade as the grand total — the genuine grand total has
  // count = sum-of-sub-totals which is strictly > each individual
  // scheme's count of 1 for any month with multiple NFOs.
  if (!hits.industryNfoCount || !hits.industryNfoFundsMobilized) {
    const NEW_SCHEMES_ANCHOR = /NEW\s+SCHEMES\s+REPORT|New\s+Schemes\s+Report/;
    // Multiline mode so `^` / `$` anchor at line boundaries without
    // consuming the newline between consecutive matches.
    const PAIR_LINE = /^\s*(\d{1,4})\s+(\d[\d,]+)\s*$/gm;
    for (const page of pages) {
      if (hits.industryNfoCount && hits.industryNfoFundsMobilized) break;
      if (!NEW_SCHEMES_ANCHOR.test(page.text)) continue;
      let bestCount = 0;
      let bestFunds = 0;
      let match: RegExpExecArray | null;
      const re = new RegExp(PAIR_LINE.source, PAIR_LINE.flags);
      while ((match = re.exec(page.text)) !== null) {
        const count = Number(match[1]);
        const funds = Number(match[2].replace(/,/g, ""));
        if (!Number.isFinite(count) || !Number.isFinite(funds)) continue;
        // Drop per-scheme single-row entries (count=1) that aren't
        // aggregated totals.
        if (count <= 1) continue;
        if (count > bestCount) {
          bestCount = count;
          bestFunds = funds;
        }
      }
      if (bestCount === 0) continue;
      if (!hits.industryNfoCount) {
        hits.industryNfoCount = {
          value: bestCount,
          page: page.num,
          label:
            "New Schemes Report · Grand Total row (fallback · largest count pair)",
        };
      }
      if (!hits.industryNfoFundsMobilized) {
        hits.industryNfoFundsMobilized = {
          value: bestFunds,
          page: page.num,
          label:
            "New Schemes Report · Grand Total row (fallback · largest count pair)",
        };
      }
      pagesUsed.add(page.num);
    }
  }

  return { hits, pagesUsed };
}

/**
 * Long-form per-(month, category) extractor. Scans an AMFI Monthly
 * Report PDF for the rows in CATEGORY_SPECS and returns one row per
 * category found. Used to populate `amfi-monthly-category.json`,
 * which is consumed by category-level dashboard charts (IIFL
 * Figures 31-34).
 *
 * Behavior:
 *   - First-match-per-category wins per file (the data row is
 *     unambiguous once we've matched the label).
 *   - `categoryAum` requires netAum > 0; if absent on the row the
 *     entire category record is skipped (no half-baked rows).
 *   - `categoryNetInflow` is captured separately and may be null
 *     if the row's net-inflow cell is "-" (rare on these
 *     categories, but the extractor honours it).
 *   - Each row carries its own per-field provenance, with the
 *     `sourceLabel` describing which row + column produced the
 *     value.
 */
function parseCategoriesFromMonthlyReport(
  pages: PdfPage[],
  filename: string,
  format: AmfiMonthlyCategoryRow["sourceFormat"],
  extractedAt: string,
  month: string
): AmfiMonthlyCategoryRow[] {
  const found = new Set<AmfiMonthlyCategorySlug>();
  const out: AmfiMonthlyCategoryRow[] = [];

  for (const page of pages) {
    const lines = page.text.split("\n");
    for (const line of lines) {
      for (const spec of CATEGORY_SPECS) {
        if (found.has(spec.slug)) continue;
        const labelMatch = spec.re.exec(line);
        if (!labelMatch) continue;
        // Tokenise only the substring AFTER the label match, so numeric
        // tokens INSIDE the label (e.g. the "10" in "Gilt Fund with 10
        // year constant duration") don't shift the column indices.
        const tail = line.slice(labelMatch.index + labelMatch[0].length);
        // Reject column-collision artifacts where pdf-parse merges two
        // adjacent cells onto a single line, e.g. Aug 2025's
        //   "Equity Savings Fund\tCredit Risk Fund 14 1,86,961 ..."
        // where the label is followed by ANOTHER label rather than the
        // numeric data row. A legitimate category data row's tail
        // ALWAYS starts with whitespace then a digit (or `-` for a
        // negative number); anything else means the matched label is
        // a stray header that has collided with a different row's data.
        if (!/^\s+-?\d/.test(tail)) continue;
        const cols = numericColumns(tail);
        if (cols.length < 7) continue;
        const aum = cols[COL_NET_AUM];
        if (aum === null || aum <= 0) continue;
        const flow = cols[COL_NET_INFLOW];
        const provenanceBase = {
          sourcePdf: filename,
          sourceFormat: format,
          sourcePages: [page.num],
          extractedAt,
        };
        const aaum = cols[COL_AAUM];
        const row: AmfiMonthlyCategoryRow = {
          month,
          categorySlug: spec.slug,
          category: spec.label,
          majorCategorySlug: spec.majorCategorySlug,
          majorCategoryLabel: MAJOR_CATEGORY_LABELS[spec.majorCategorySlug],
          categoryAum: aum,
          fieldSources: {
            categoryAum: {
              ...provenanceBase,
              sourceLabel: `${spec.label} row · Net AUM column`,
            },
          },
          ...provenanceBase,
        };
        if (aaum !== null && aaum > 0) {
          row.categoryAaum = aaum;
          row.fieldSources.categoryAaum = {
            ...provenanceBase,
            sourceLabel: `${spec.label} row · Average Net AUM column`,
          };
        }
        if (flow !== null) {
          row.categoryNetInflow = flow;
          row.fieldSources.categoryNetInflow = {
            ...provenanceBase,
            sourceLabel: `${spec.label} row · Net Inflow / Outflow column`,
          };
        }
        out.push(row);
        found.add(spec.slug);
      }
    }
  }

  return out;
}

// -------- Press Release parser -----------------------------------------

/**
 * Press-release / Monthly Note layouts mix three quoting conventions
 * for numbers:
 *   - cr           — already in ₹ Cr (e.g. "SIP monthly contribution
 *                    (crore) 32,087"). No scaling.
 *   - lakh-cr      — value is in ₹ lakh crore; multiply by 100,000 to
 *                    get ₹ Cr (e.g. "SIP assets (Rs lakh crore) 15.11"
 *                    → 15,11,000 Cr).
 *   - crore-count  — value is in crore (10⁷); multiply by 10,000,000
 *                    to get a raw count (e.g. "Number of contributing
 *                    SIP accounts (crore) 9.72" → 97,200,000).
 *   - lakh-count   — value is in lakh (10⁵); multiply by 100,000 to
 *                    get a raw count (e.g. "No. of SIP Accounts (in
 *                    lakh) 9,943.55" → 994,355,000).
 */
type PressReleaseUnit = "cr" | "lakh-cr" | "crore-count" | "lakh-count";

interface PressReleaseLineSpec {
  field: keyof Pick<
    AmfiMonthlyPdfRow,
    | "totalAum"
    | "totalAaum"
    | "equityAum"
    | "activeEquityAum"
    | "debtAum"
    | "liquidAum"
    | "sipContribution"
    | "sipAum"
    | "sipAccounts"
    | "netInflow"
  >;
  /** Patterns are tried in order; the FIRST match per page wins. */
  patterns: RegExp[];
  unit: PressReleaseUnit;
  /** Human-readable description of the row/label this pattern matches.
   *  Recorded as `fieldSources[field].sourceLabel` for the dashboard. */
  label: string;
  /**
   * Optional: rejection threshold applied AFTER scaling. Used to
   * disambiguate the AUM-trend "Total" / "Equity" / "Debt" rows from
   * the flow-trend rows for the same category, where the AUM value
   * is always ≥ 100× the absolute flow value. e.g. equityAum needs
   * a > 100,000 ₹ Cr threshold to avoid matching "Equity 40,450" in
   * the flow table.
   */
  minScaledValue?: number;
}

const NUM = String.raw`([0-9][0-9,]*\.?[0-9]*)`;
const NEAR_NUM = String.raw`(?:[^\n]{0,160}?)` + NUM;

const PRESS_RELEASE_PATTERNS: PressReleaseLineSpec[] = [
  // ---- SIP trend table — unique row labels, ordered by specificity.
  {
    field: "sipAccounts",
    patterns: [
      // "Number of contributing SIP accounts (crore) 9.72 ..."
      new RegExp(
        String.raw`Number\s+of\s+contributing\s+SIP\s+accounts\s*\(\s*crore\s*\)\s+` +
          NUM,
        "i"
      ),
    ],
    unit: "crore-count",
    // SIP-account counts are tens of millions; reject anything below
    // 1M to filter out percentages / counts on the wrong scale.
    minScaledValue: 1_000_000,
    label: "SIP trend table · Number of contributing SIP accounts row (crore)",
  },
  {
    // The "(in lakh)" wording carries a lakh-denominated count, so it
    // needs the lakh-count unit (×100,000) — NOT crore-count (×10⁷),
    // which would over-count by 100×. Kept as a separate spec (same
    // field) because each spec carries a single unit; the consumer
    // dedups by field, so this only fires for months whose Note uses
    // the lakh wording and the crore pattern above didn't match.
    field: "sipAccounts",
    patterns: [
      // "No. of SIP Accounts (in lakh) 9,943.55"
      new RegExp(
        String.raw`(?:No\.?\s+of\s+)?SIP\s+Accounts(?:[^\n]{0,40}\bin\s+lakh\b)` +
          NEAR_NUM,
        "i"
      ),
    ],
    unit: "lakh-count",
    minScaledValue: 1_000_000,
    label: "SIP trend table · No. of SIP Accounts row (in lakh)",
  },
  {
    field: "sipContribution",
    patterns: [
      // "SIP monthly contribution (crore) 32,087 ..."
      new RegExp(
        String.raw`SIP\s+monthly\s+contribution\s*\(\s*crore\s*\)\s+` + NUM,
        "i"
      ),
      // Older / generic press-release wordings.
      new RegExp(String.raw`SIP\s+Contribution[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Monthly\s+SIP(?:\s+Contribution)?[^\n]{0,80}?` + NUM, "i"),
    ],
    unit: "cr",
    // Monthly SIP contribution at industry scale is in the ₹15K-₹35K
    // Cr band; reject anything below ₹5K Cr so loose patterns can't
    // accidentally store a YoY percentage (e.g. "grew by 34.53%").
    minScaledValue: 5_000,
    label: "SIP trend table · SIP monthly contribution row",
  },
  {
    field: "sipAum",
    patterns: [
      // "SIP assets (Rs lakh crore) 15.11 ..."
      new RegExp(
        String.raw`SIP\s+assets\s*\(\s*Rs\s+lakh\s+crore\s*\)\s+` + NUM,
        "i"
      ),
    ],
    unit: "lakh-cr",
    // SIP AUM in ₹ Cr is always > 1 lakh Cr; reject anything below
    // (filters scale mismatches).
    minScaledValue: 100_000,
    label: "SIP trend table · SIP assets (Rs lakh crore) row",
  },
  // Older direct "SIP AUM <N>" fallback in ₹ Cr (no lakh-crore wrapper).
  {
    field: "sipAum",
    patterns: [new RegExp(String.raw`SIP\s+AUM[^\n]{0,80}?` + NUM, "i")],
    unit: "cr",
    // Same threshold as the lakh-cr spec — SIP AUM is always > ₹1L Cr.
    // Without this, "SIP AUM share stood at ~20%" stored 20 ₹ Cr.
    minScaledValue: 100_000,
    label: "SIP AUM (flat-key fallback)",
  },

  // ---- Older / prose Monthly Note variants ----------------------------
  //
  // These specs run AFTER the canonical-tabular ones above. They only
  // fire when the existing patterns missed (e.g. older Notes with
  // different table headers or with prose-only SIP figures). Each new
  // spec carries its own label so the dashboard tooltip can show
  // whether the value came from a table or a prose mention.
  //
  // Constraint: SIP-prose patterns explicitly REJECT "lakh crore"
  // tails so a sentence like "SIP assets stood at Rs 15.11 lakh crore"
  // doesn't accidentally fill sipContribution with the lakh-crore AUM.
  // The negative lookahead `(?!\s+lakh)` does that.

  // sipAccounts — older table layouts: "(in crore)" / "(crore)" with
  // "Contributing" / "No. of Contributing" prefixes that the existing
  // exact-phrase pattern doesn't cover.
  {
    field: "sipAccounts",
    patterns: [
      new RegExp(
        String.raw`(?:No\.?\s+of\s+)?(?:Contributing\s+)?SIP\s+accounts\s*\(\s*(?:in\s+)?crore\s*\)\s+` +
          NUM,
        "i"
      ),
    ],
    unit: "crore-count",
    minScaledValue: 1_000_000,
    label: "SIP trend table · SIP accounts row (older format)",
  },
  // sipAccounts — prose: "SIP accounts totalled / crossed / reached <N> crore"
  // and "(contributing) SIP accounts has increased to <N> crore". Both
  // give the absolute count (in crore) for the report period.
  {
    field: "sipAccounts",
    patterns: [
      new RegExp(
        String.raw`SIP\s+accounts\s+(?:totalled|crossed|reached|stood\s+at)\s+` +
          String.raw`(\d[\d,]*(?:\.\d+)?)\s+crores?`,
        "i"
      ),
      new RegExp(
        String.raw`(?:contributing|active)\s+SIP\s+accounts[^\n.]{0,80}?` +
          String.raw`(?:reaching|stood\s+at|to)\s+(\d[\d,]*(?:\.\d+)?)\s+crores?`,
        "i"
      ),
    ],
    unit: "crore-count",
    minScaledValue: 1_000_000,
    label: "Prose · SIP accounts in crore",
  },

  // sipContribution — older table layout: "SIP monthly contributions
  // (in crore) <N>" (note plural and "in" prefix vs the canonical one).
  {
    field: "sipContribution",
    patterns: [
      new RegExp(
        String.raw`SIP\s+monthly\s+contributions\s*\(\s*in\s+crore\s*\)\s+` + NUM,
        "i"
      ),
    ],
    unit: "cr",
    minScaledValue: 5_000,
    label: "SIP trend table · SIP monthly contributions row (older format)",
  },
  // sipContribution — prose: SIP keyword + flows/contribution(s)/inflows
  // within a short window of "Rs <N> crore". The (?!\s+lakh) lookahead
  // rejects matches where the value is in lakh-crore (those are SIP AUM,
  // not contribution).
  {
    field: "sipContribution",
    patterns: [
      // SIP appears BEFORE the keyword: "SIP flows were at Rs <N> crore",
      // "Systematic investment plan (SIP) flows touched a new high of Rs <N> crore",
      // "monthly SIP contributions reached an all-time high of Rs <N> crore".
      new RegExp(
        String.raw`(?:SIP|systematic\s+investment\s+plan)[^\n.]{0,80}?` +
          String.raw`(?:flows|contributions?|inflows?)[^\n.]{0,120}?Rs\.?\s+` +
          String.raw`(\d[\d,]*(?:\.\d+)?)\s+crores?\b(?!\s+lakh)`,
        "i"
      ),
      // Keyword appears BEFORE SIP: "Flows into SIPs rose ... to Rs <N> crore".
      new RegExp(
        String.raw`(?:flows|contributions?|inflows?)\s+(?:into\s+)?SIPs?[^\n.]{0,120}?Rs\.?\s+` +
          String.raw`(\d[\d,]*(?:\.\d+)?)\s+crores?\b(?!\s+lakh)`,
        "i"
      ),
    ],
    unit: "cr",
    minScaledValue: 5_000,
    label: "Prose · SIP flows / contribution mention",
  },

  // sipAum — older table layout: "SIP assets (Rs in lakh crore) <N>"
  // (the existing pattern requires "(Rs lakh crore)" without "in").
  {
    field: "sipAum",
    patterns: [
      new RegExp(
        String.raw`SIP\s+assets\s*\(\s*Rs\s+in\s+lakh\s+crore\s*\)\s+` + NUM,
        "i"
      ),
    ],
    unit: "lakh-cr",
    minScaledValue: 100_000,
    label: "SIP trend table · SIP assets (Rs in lakh crore) row (older format)",
  },
  // sipAum — prose: "SIP assets ... Rs <N> lakh crore". Requires "lakh
  // crore" tail so we never accidentally pick a non-AUM value or
  // collide with the sipContribution prose pattern.
  // Uses [^\n] (NOT [^\n.]) because typical wording has decimals in
  // the gap, e.g. "SIP assets increased 5.3% to Rs 13.09 lakh crore" —
  // the period in "5.3" would otherwise break the match. Bound the
  // gap to 80 chars so the lazy match can't span a sentence break.
  {
    field: "sipAum",
    patterns: [
      new RegExp(
        String.raw`SIP\s+assets[^\n]{0,80}?Rs\.?\s+` +
          String.raw`(\d[\d,]*(?:\.\d+)?)\s+lakh\s+crores?`,
        "i"
      ),
    ],
    unit: "lakh-cr",
    minScaledValue: 100_000,
    label: "Prose · SIP assets in Rs lakh crore",
  },

  // ---- Industry AUM — tabular rows. Each category appears in two
  //      tables on different pages (AUM trend, then flow trend); the
  //      AUM-trend table comes FIRST in document order, so the first
  //      match per page is the AUM value. The minScaledValue check
  //      additionally rejects flow-table values whose magnitude is
  //      orders smaller than the AUM.
  {
    field: "totalAum",
    patterns: [new RegExp(String.raw`^\s*Total\s+` + NUM, "im")],
    unit: "cr",
    // Industry-wide totalAum is always ≥ 50 lakh Cr (~5,000,000); flow-table
    // totals are ≤ a few lakh Cr in absolute terms.
    minScaledValue: 5_000_000,
    label: "Monthly AUM trend table · Total row",
  },
  {
    field: "equityAum",
    patterns: [new RegExp(String.raw`^\s*Equity\s+` + NUM, "im")],
    unit: "cr",
    minScaledValue: 100_000,
    label: "Monthly AUM trend table · Equity row",
  },
  {
    field: "debtAum",
    patterns: [new RegExp(String.raw`^\s*Debt\s+` + NUM, "im")],
    unit: "cr",
    minScaledValue: 100_000,
    label: "Monthly AUM trend table · Debt row",
  },
  {
    field: "liquidAum",
    patterns: [
      // Press-release subcategory table: "Liquid funds 4,66,498 ..."
      new RegExp(String.raw`^\s*Liquid\s+funds?\s+` + NUM, "im"),
      // Older flat-key wordings.
      new RegExp(String.raw`Liquid\s*/\s*Money\s*Market[^\n]{0,80}?` + NUM, "i"),
    ],
    unit: "cr",
    minScaledValue: 10_000,
    label: "Monthly AUM trend of income/debt-oriented schemes · Liquid funds row",
  },

  // ---- AAUM — older flat-key press-release wording. The Crisil
  //      Monthly Note doesn't carry an AAUM number directly; this
  //      pattern stays as a fallback for any future PDF that does.
  {
    field: "totalAaum",
    patterns: [
      new RegExp(
        String.raw`Average\s+Assets\s+Under\s+Management[^\n]{0,80}?` + NUM,
        "i"
      ),
      new RegExp(String.raw`\bAAUM\b[^\n]{0,80}?` + NUM, "i"),
    ],
    unit: "cr",
    label: "Average Assets Under Management (flat-key fallback)",
  },

  // ---- Active equity / older flat-key fallbacks.
  {
    field: "activeEquityAum",
    patterns: [new RegExp(String.raw`Active\s+Equity[^\n]{0,80}?` + NUM, "i")],
    unit: "cr",
    label: "Active Equity (flat-key fallback)",
  },
];

interface PressReleaseHits {
  [field: string]: FieldHit;
}

function scaleByUnit(n: number, unit: PressReleaseUnit): number {
  switch (unit) {
    case "lakh-cr":
      return n * 100_000;
    case "crore-count":
      return Math.round(n * 10_000_000);
    case "lakh-count":
      return Math.round(n * 100_000);
    case "cr":
      return n;
  }
}

function parsePressRelease(pages: PdfPage[]): {
  hits: PressReleaseHits;
  pagesUsed: Set<number>;
} {
  const hits: PressReleaseHits = {};
  const pagesUsed = new Set<number>();

  // Iterate pages in order so first-match-wins resolves to the
  // earliest occurrence (AUM tables before flow tables, etc.).
  for (const page of pages) {
    for (const spec of PRESS_RELEASE_PATTERNS) {
      if (hits[spec.field]) continue;
      for (const re of spec.patterns) {
        const m = re.exec(page.text);
        if (!m) continue;
        const cleaned = m[1].replace(/,/g, "");
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n <= 0) continue;
        const scaled = scaleByUnit(n, spec.unit);
        if (
          spec.minScaledValue !== undefined &&
          scaled < spec.minScaledValue
        ) {
          continue;
        }
        hits[spec.field] = {
          value: scaled,
          page: page.num,
          label: spec.label,
        };
        pagesUsed.add(page.num);
        break;
      }
    }
  }

  return { hits, pagesUsed };
}

// -------- top-level extraction -----------------------------------------

interface ExtractedRow {
  row: AmfiMonthlyPdfRow;
  /** Long-form per-(month, category) rows extracted from the same
   *  PDF. Empty for press-release files (only the Monthly Report
   *  has the per-scheme table). */
  categoryRows: AmfiMonthlyCategoryRow[];
}

async function extractFromPdf(pdfPath: string): Promise<ExtractedRow | null> {
  const filename = path.basename(pdfPath);
  const buffer = await fs.readFile(pdfPath);

  let pages: PdfPage[];
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    pages = result.pages.map((p) => ({ num: p.num, text: p.text ?? "" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`amfi-monthly-pdf: ${filename}: pdf-parse failed — ${msg}`);
    return null;
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const month = detectMonth(filename, pages);
  if (!month) {
    warn(
      `amfi-monthly-pdf: ${filename}: could not infer month from text or filename — skipped`
    );
    return null;
  }

  const format = detectFormat(pages);
  const extractedAt = nowIso();
  const row: AmfiMonthlyPdfRow = {
    month,
    sourceFormat: format,
    sourcePdf: filename,
    sourcePages: [],
    extractedAt,
    fieldSources: {},
  };

  let pagesUsed = new Set<number>();
  let hitCount = 0;

  // Each parser returns `{ value, page, label }` per matched field.
  // We project that into BOTH the numeric field on the row AND a
  // per-field provenance entry on `row.fieldSources`. The per-field
  // pages array is recorded as a single-element array — most KPIs
  // come from one specific row on one page; the array shape leaves
  // room for future cross-referenced KPIs without a schema change.
  const recordHits = (hits: Record<string, FieldHit | undefined>) => {
    for (const [field, hit] of Object.entries(hits)) {
      if (!hit) continue;
      (row as unknown as Record<string, number>)[field] = hit.value;
      const provenance: AmfiMonthlyPdfFieldProvenance = {
        sourcePdf: filename,
        sourceFormat: format,
        sourcePages: [hit.page],
        extractedAt,
        sourceLabel: hit.label,
      };
      (row.fieldSources as Record<string, AmfiMonthlyPdfFieldProvenance>)[
        field
      ] = provenance;
      hitCount += 1;
    }
  };

  let categoryRows: AmfiMonthlyCategoryRow[] = [];
  if (format === "monthly-report") {
    const { hits, pagesUsed: pu } = parseMonthlyReport(pages);
    pagesUsed = pu;
    recordHits(hits as Record<string, FieldHit | undefined>);
    // Long-form per-category rows. Only run on Monthly Report PDFs —
    // press-release Notes don't have the per-scheme tabular layout.
    categoryRows = parseCategoriesFromMonthlyReport(
      pages,
      filename,
      format,
      extractedAt,
      month
    );
  } else if (format === "press-release") {
    const { hits, pagesUsed: pu } = parsePressRelease(pages);
    pagesUsed = pu;
    recordHits(hits);
  }

  row.sourcePages = Array.from(pagesUsed).sort((a, b) => a - b);

  if (hitCount === 0) {
    warn(
      `amfi-monthly-pdf: ${filename}: format=${format}, month=${month} — no labelled values matched`
    );
  } else {
    info(
      `amfi-monthly-pdf: ${filename}: format=${format}, month=${month}, fields=${hitCount}, pages=${row.sourcePages.join(",") || "-"}, categoryRows=${categoryRows.length}`
    );
  }

  return { row, categoryRows };
}

// -------- merge + write ------------------------------------------------

const NUMERIC_FIELDS: (keyof AmfiMonthlyPdfRow)[] = [
  "totalAum",
  "totalAaum",
  "equityAum",
  "equityAaum",
  "activeEquityAum",
  "debtAum",
  "debtAaum",
  "liquidAum",
  "hybridAum",
  "hybridAaum",
  "hybridNetInflow",
  "otherSchemesAum",
  "otherSchemesAaum",
  "otherSchemesNetInflow",
  "sipContribution",
  "sipAum",
  "sipAccounts",
  "netInflow",
  "equityNetInflow",
  "debtNetInflow",
  "liquidNetInflow",
  "etfIndexAum",
  "etfIndexAaum",
  "arbitrageAum",
  "arbitrageAaum",
  "activeEquityAaum",
  "activeEquityNetInflow",
  "industryFolios",
  "industryNfoCount",
  "industryNfoFundsMobilized",
];

/**
 * Merge by month. Each numeric field is preserved together with its
 * provenance:
 *   - If `next` has the field, BOTH the value and `next.fieldSources`
 *     entry overwrite the prev row's.
 *   - If `next` does NOT have the field but `prev` does, BOTH the
 *     prev value and the prev fieldSources entry are preserved.
 * The row-level `sourcePdf` / `sourceFormat` / `sourcePages` /
 * `extractedAt` always reflect the latest write — they are a
 * convenience for "last-writer-wins" and are NOT authoritative for
 * which PDF a specific KPI came from. The dashboard should consult
 * `row.fieldSources[field]` for that.
 */
function mergeRow(
  prev: AmfiMonthlyPdfRow | undefined,
  next: AmfiMonthlyPdfRow
): AmfiMonthlyPdfRow {
  if (!prev) return next;
  const merged: AmfiMonthlyPdfRow = { ...prev, ...next };
  // Start from prev's fieldSources, overlay anything next supplied —
  // skipping undefined entries so they don't blank a prev provenance.
  const mergedSources: AmfiMonthlyPdfFieldSources = { ...prev.fieldSources };
  for (const field of NUMERIC_FIELDS) {
    const nv = next[field];
    const pv = prev[field];
    if (typeof nv === "number") {
      // next has the field — keep next's value (already on `merged`
      // via spread) and adopt next's provenance for this field.
      const ns = next.fieldSources?.[field as keyof AmfiMonthlyPdfFieldSources];
      if (ns) {
        (mergedSources as Record<string, AmfiMonthlyPdfFieldProvenance>)[
          field
        ] = ns;
      }
    } else if (typeof pv === "number") {
      // next did NOT detect this field; keep prev's value AND keep
      // prev's provenance (already in mergedSources from the spread).
      (merged as unknown as Record<string, number>)[field] = pv;
    }
  }
  merged.fieldSources = mergedSources;
  return merged;
}

async function listPdfs(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`amfi-monthly-pdf: cannot read ${dir}: ${msg}`);
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function ingestAmfiMonthlyPdf(): Promise<void> {
  const pdfs = await listPdfs(PDF_DIR);
  if (pdfs.length === 0) {
    info(`amfi-monthly-pdf: no PDFs in ${PDF_DIR} — preserving prior snapshot`);
    return;
  }

  const prior = await readSnapshot<AmfiMonthlyPdfSnapshot>(SNAPSHOT_FILE);
  const priorByMonth = new Map<string, AmfiMonthlyPdfRow>();
  for (const r of prior?.rows ?? []) priorByMonth.set(r.month, r);

  // Long-form (month, categorySlug) snapshot. Merged identically to
  // the per-month snapshot — prior rows are preserved unless this run
  // produced a (month, slug) that overwrites them.
  const priorCategorySnapshot = await readSnapshot<AmfiMonthlyCategorySnapshot>(
    CATEGORY_SNAPSHOT_FILE
  );
  const priorCategoryByKey = new Map<string, AmfiMonthlyCategoryRow>();
  for (const r of priorCategorySnapshot?.rows ?? []) {
    priorCategoryByKey.set(`${r.month}::${r.categorySlug}`, r);
  }

  let processed = 0;
  let categoryHitCount = 0;
  for (const pdfPath of pdfs) {
    const result = await extractFromPdf(pdfPath);
    if (!result) continue;
    processed += 1;
    const merged = mergeRow(priorByMonth.get(result.row.month), result.row);
    priorByMonth.set(result.row.month, merged);
    for (const cat of result.categoryRows) {
      priorCategoryByKey.set(`${cat.month}::${cat.categorySlug}`, cat);
      categoryHitCount += 1;
    }
  }

  const rows = Array.from(priorByMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  const snapshot: AmfiMonthlyPdfSnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: "manual-data/amfi-monthly/pdfs/",
      notes: `Industry-level monthly KPIs extracted from manually-uploaded AMFI PDFs. Auto-detects Monthly Report vs press release per file. Optional fields are OMITTED when not detected — never zeroed. Rows merged by month; prior values preserved when the latest PDF doesn't carry them. processedPdfs=${processed} / ${pdfs.length}, totalRows=${rows.length}.`,
    },
    rows,
  };

  await writeSnapshot(SNAPSHOT_FILE, snapshot);
  info(
    `amfi-monthly-pdf: wrote ${rows.length} row(s) to src/data/snapshots/${SNAPSHOT_FILE} from ${processed}/${pdfs.length} PDFs`
  );

  // Long-form per-(month, category) snapshot. Sort deterministically
  // (month asc, then slug asc) for stable diffs.
  const categoryRows = Array.from(priorCategoryByKey.values()).sort((a, b) => {
    if (a.month !== b.month) return a.month.localeCompare(b.month);
    return a.categorySlug.localeCompare(b.categorySlug);
  });
  const categorySnapshot: AmfiMonthlyCategorySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: "AMFI Monthly Report PDFs (manual-data/amfi-monthly/pdfs/)",
      notes: `Long-form per-(month, category) rows extracted from AMFI Monthly Reports. Categories: ${CATEGORY_SPECS.map((c) => c.slug).join(", ")}. Optional fields are OMITTED when not detected — never zeroed. Rows merged by (month, categorySlug); prior rows preserved when the current run doesn't re-extract them. categoryHitsThisRun=${categoryHitCount}, totalCategoryRows=${categoryRows.length}.`,
    },
    rows: categoryRows,
  };
  await writeSnapshot(CATEGORY_SNAPSHOT_FILE, categorySnapshot);
  info(
    `amfi-monthly-pdf: wrote ${categoryRows.length} category row(s) to src/data/snapshots/${CATEGORY_SNAPSHOT_FILE}`
  );
}

// Entry point when run via `npm run ingest:amfi-pdf`. ESM-safe self-
// detection: only run when this file is the script's main entry, not
// when imported.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (invokedDirectly) {
  ingestAmfiMonthlyPdf().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ingest][fatal] amfi-monthly-pdf: ${msg}\n`);
    process.exit(1);
  });
}
