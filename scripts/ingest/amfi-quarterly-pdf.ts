/**
 * Extract industry- and category-level KPIs from AMFI quarterly PDFs
 * uploaded under `manual-data/amfi-quarterly/pdfs/` and write
 *   - `src/data/snapshots/amfi-quarterly-industry.json`  (one row per quarter)
 *   - `src/data/snapshots/amfi-quarterly-category.json`  (one row per (quarter, category))
 *
 * The publication has the same per-scheme tabular layout as the AMFI
 * Monthly Report (Page 1 carries the per-scheme table with five
 * Sub Total rows + one Grand Total). Important methodological caveat:
 * the "Average Net AUM" column on the quarterly PDF reports the LAST
 * MONTH of the quarter only — NOT a true 3-month average. Every AAUM
 * field on the output schema is therefore named `LastMonthAaum`.
 *
 * Behaviour invariants:
 *   - Pure read-extract. Re-running with the same PDFs is idempotent
 *     (modulo `extractedAt` / `meta.generatedAt` ISO stamps).
 *   - Quarterly PDFs are all manually uploaded and reprocessed
 *     together, so the snapshots are FULLY REWRITTEN on every run
 *     (no merge-with-prior). The PDF directory is the source of truth.
 *   - Empty `pdfs/` directory is a no-op — preserves the existing
 *     snapshot.
 *   - Optional fields are OMITTED when not detected — never zeroed.
 *   - Only OPEN-ENDED rows are extracted. Close-ended and interval
 *     section rows are ignored via a `found` set on category slugs
 *     (open-ended sections come first in document order so first-match
 *     wins) and via the open-ended-only "Sub Total - I/II/III/IV/V"
 *     regex for the major category sub-totals.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type {
  AmfiMonthlyCategorySlug,
  AmfiMonthlyMajorCategorySlug,
  AmfiQuarterlyCategoryFieldSources,
  AmfiQuarterlyCategoryRow,
  AmfiQuarterlyCategorySnapshot,
  AmfiQuarterlyFieldSource,
  AmfiQuarterlyIndustryFieldSources,
  AmfiQuarterlyIndustryRow,
  AmfiQuarterlyIndustrySnapshot,
} from "../../src/data/snapshots/types";
import { info, nowIso, warn, writeSnapshot } from "./utils";

const PDF_DIR = path.resolve(process.cwd(), "manual-data/amfi-quarterly/pdfs");
const INDUSTRY_SNAPSHOT_FILE = "amfi-quarterly-industry.json";
const CATEGORY_SNAPSHOT_FILE = "amfi-quarterly-category.json";

const QUARTERLY_NOTES =
  "Quarterly PDF Average Net AUM columns are last-month AAUM, not true " +
  "quarterly average. Do not use LastMonthAaum fields for QAAUM-share " +
  "charts.";

// ---------------------------------------------------------------------
// Quarter detection — filename map first, text fallback second.
// ---------------------------------------------------------------------

interface QuarterId {
  /** Canonical fiscal-quarter id, e.g. "FY26-Q4". */
  quarter: string;
  /** Display label, e.g. "4QFY26". */
  quarterLabel: string;
  /** First month of the quarter (YYYY-MM). */
  quarterStart: string;
  /** Last month of the quarter (YYYY-MM). */
  quarterEnd: string;
}

/** Filename → quarter mapping. The volume number tracks the calendar
 *  year of the quarter's start date (vol24 = FY25, which begins Apr
 *  2024); issue I-IV are the fiscal quarters Q1-Q4. */
const FILENAME_QUARTER_MAP: Record<string, QuarterId> = {
  "aqu-vol24-issueI.pdf": {
    quarter: "FY25-Q1",
    quarterLabel: "1QFY25",
    quarterStart: "2024-04",
    quarterEnd: "2024-06",
  },
  "aqu-vol24-issueII.pdf": {
    quarter: "FY25-Q2",
    quarterLabel: "2QFY25",
    quarterStart: "2024-07",
    quarterEnd: "2024-09",
  },
  "aqu-vol24-issueIII.pdf": {
    quarter: "FY25-Q3",
    quarterLabel: "3QFY25",
    quarterStart: "2024-10",
    quarterEnd: "2024-12",
  },
  "aqu-vol24-issueIV.pdf": {
    quarter: "FY25-Q4",
    quarterLabel: "4QFY25",
    quarterStart: "2025-01",
    quarterEnd: "2025-03",
  },
  "aqu-vol25-issueI.pdf": {
    quarter: "FY26-Q1",
    quarterLabel: "1QFY26",
    quarterStart: "2025-04",
    quarterEnd: "2025-06",
  },
  "aqu-vol25-issueII.pdf": {
    quarter: "FY26-Q2",
    quarterLabel: "2QFY26",
    quarterStart: "2025-07",
    quarterEnd: "2025-09",
  },
  "aqu-vol25-issueIII.pdf": {
    quarter: "FY26-Q3",
    quarterLabel: "3QFY26",
    quarterStart: "2025-10",
    quarterEnd: "2025-12",
  },
  "aqu-vol25-issueIV.pdf": {
    quarter: "FY26-Q4",
    quarterLabel: "4QFY26",
    quarterStart: "2026-01",
    quarterEnd: "2026-03",
  },
};

const MONTH_ABBR_TO_NUM: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Build a QuarterId from the (start month, year) of the quarter.
 *  FY25 = Apr 2024 – Mar 2025: e.g. start Apr 2024 → FY25-Q1, start
 *  Jan 2025 → FY25-Q4. Jan-Mar of calendar year y closes FY ending
 *  in y; the other three quarters open FY ending in y+1. */
function quarterIdFromStart(
  startMonth: number,
  startYear: number
): QuarterId | null {
  let fyYear: number;
  let fyQ: number;
  let endMonth: number;
  const endYear = startYear;
  if (startMonth === 4) {
    fyYear = startYear + 1;
    fyQ = 1;
    endMonth = 6;
  } else if (startMonth === 7) {
    fyYear = startYear + 1;
    fyQ = 2;
    endMonth = 9;
  } else if (startMonth === 10) {
    fyYear = startYear + 1;
    fyQ = 3;
    endMonth = 12;
  } else if (startMonth === 1) {
    fyYear = startYear;
    fyQ = 4;
    endMonth = 3;
  } else {
    return null;
  }
  const fyShort = String(fyYear).slice(-2);
  return {
    quarter: `FY${fyYear}-Q${fyQ}`,
    quarterLabel: `${fyQ}QFY${fyShort}`,
    quarterStart: `${startYear}-${String(startMonth).padStart(2, "0")}`,
    quarterEnd: `${endYear}-${String(endMonth).padStart(2, "0")}`,
  };
}

const MONTH_RE_BODY =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Text-based fallback. Looks for "<startMonth> - <endMonth> <year>"
 *  patterns found in the column headers and footer of the AMFI
 *  quarterly PDF. The first valid pair wins. */
function detectQuarterFromText(pages: { text: string }[]): QuarterId | null {
  const text = pages.map((p) => p.text).join("\n");
  const re = new RegExp(
    String.raw`\b` +
      MONTH_RE_BODY +
      String.raw`\s*[\-–]\s*` +
      MONTH_RE_BODY +
      String.raw`[\s,]+(\d{4})\b`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const startMonth = MONTH_ABBR_TO_NUM[m[1].toLowerCase()];
    const endMonth = MONTH_ABBR_TO_NUM[m[2].toLowerCase()];
    const year = Number(m[3]);
    if (!startMonth || !endMonth || !Number.isFinite(year)) continue;
    // Only accept a fiscal-quarter-aligned start/end pair so chart
    // captions like "Apr 2024" don't get mistaken for a quarter span.
    const validPairs: [number, number][] = [
      [4, 6],
      [7, 9],
      [10, 12],
      [1, 3],
    ];
    if (!validPairs.some(([a, b]) => a === startMonth && b === endMonth)) {
      continue;
    }
    const q = quarterIdFromStart(startMonth, year);
    if (q) return q;
  }
  return null;
}

function detectQuarter(
  filename: string,
  pages: { text: string }[]
): QuarterId | null {
  const mapped = FILENAME_QUARTER_MAP[filename];
  if (mapped) return mapped;
  return detectQuarterFromText(pages);
}

// ---------------------------------------------------------------------
// Category specs (slug → label, parent group, label regex).
//
// Duplicated from `amfi-monthly-pdf.ts` so the quarterly extractor is
// self-contained — same closed set of (slug, label, regex) entries the
// monthly extractor uses, so the same categorySlug values match across
// surfaces. Each pattern matches the EXACT row label as it appears in
// AMFI publications; care taken so e.g. "Large Cap Fund" doesn't
// false-match "Large & Mid Cap Fund" (which is a different row).
// ---------------------------------------------------------------------

const MAJOR_CATEGORY_LABELS: Record<AmfiMonthlyMajorCategorySlug, string> = {
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
  // Sub I — Income/Debt Oriented (16 rows). Several pairs need negative
  // lookbehinds / lookaheads to avoid sub-string collisions.
  { slug: "overnight", label: "Overnight Fund", majorCategorySlug: "income-debt", re: /\bOvernight\s+Fund\b/i },
  { slug: "liquid", label: "Liquid Fund", majorCategorySlug: "income-debt", re: /\bLiquid\s+Fund\b/i },
  { slug: "ultra-short-duration", label: "Ultra Short Duration Fund", majorCategorySlug: "income-debt", re: /\bUltra\s+Short\s+Duration\s+Fund\b/i },
  { slug: "low-duration", label: "Low Duration Fund", majorCategorySlug: "income-debt", re: /\bLow\s+Duration\s+Fund\b/i },
  { slug: "money-market", label: "Money Market Fund", majorCategorySlug: "income-debt", re: /\bMoney\s+Market\s+Fund\b/i },
  // Avoid matching "Ultra Short Duration Fund".
  { slug: "short-duration", label: "Short Duration Fund", majorCategorySlug: "income-debt", re: /(?<!Ultra\s)\bShort\s+Duration\s+Fund\b/i },
  { slug: "medium-duration", label: "Medium Duration Fund", majorCategorySlug: "income-debt", re: /\bMedium\s+Duration\s+Fund\b/i },
  { slug: "medium-to-long-duration", label: "Medium to Long Duration Fund", majorCategorySlug: "income-debt", re: /\bMedium\s+to\s+Long\s+Duration\s+Fund\b/i },
  // Avoid matching "Medium to Long Duration Fund".
  { slug: "long-duration", label: "Long Duration Fund", majorCategorySlug: "income-debt", re: /(?<!to\s)\bLong\s+Duration\s+Fund\b/i },
  { slug: "dynamic-bond", label: "Dynamic Bond Fund", majorCategorySlug: "income-debt", re: /\bDynamic\s+Bond\s+Fund\b/i },
  { slug: "corporate-bond", label: "Corporate Bond Fund", majorCategorySlug: "income-debt", re: /\bCorporate\s+Bond\s+Fund\b/i },
  { slug: "credit-risk", label: "Credit Risk Fund", majorCategorySlug: "income-debt", re: /\bCredit\s+Risk\s+Fund\b/i },
  { slug: "banking-psu", label: "Banking and PSU Fund", majorCategorySlug: "income-debt", re: /\bBanking\s+and\s+PSU\s+Fund\b/i },
  // Avoid matching "Gilt Fund with 10 year constant duration".
  { slug: "gilt", label: "Gilt Fund", majorCategorySlug: "income-debt", re: /\bGilt\s+Fund\b(?!\s+with)/i },
  { slug: "gilt-10y-constant", label: "Gilt Fund with 10 year constant duration", majorCategorySlug: "income-debt", re: /\bGilt\s+Fund\s+with\s+10\s+year\s+constant\s+duration\b/i },
  { slug: "floater", label: "Floater Fund", majorCategorySlug: "income-debt", re: /\bFloater\s+Fund\b/i },

  // Sub II — Growth/Equity Oriented (11 rows).
  { slug: "multi-cap", label: "Multi Cap Fund", majorCategorySlug: "growth-equity", re: /\bMulti\s+Cap\s+Fund\b/i },
  { slug: "large-cap", label: "Large Cap Fund", majorCategorySlug: "growth-equity", re: /\bLarge\s+Cap\s+Fund\b/i },
  { slug: "large-mid-cap", label: "Large & Mid Cap Fund", majorCategorySlug: "growth-equity", re: /\bLarge\s*&\s*Mid\s+Cap\s+Fund\b/i },
  // Avoid matching "Large & Mid Cap Fund".
  { slug: "mid-cap", label: "Mid Cap Fund", majorCategorySlug: "growth-equity", re: /(?<!&\s)\bMid\s+Cap\s+Fund\b/i },
  { slug: "small-cap", label: "Small Cap Fund", majorCategorySlug: "growth-equity", re: /\bSmall\s+Cap\s+Fund\b/i },
  { slug: "dividend-yield", label: "Dividend Yield Fund", majorCategorySlug: "growth-equity", re: /\bDividend\s+Yield\s+Fund\b/i },
  { slug: "value-contra", label: "Value Fund/Contra Fund", majorCategorySlug: "growth-equity", re: /\bValue\s+Fund\s*\/\s*Contra\s+Fund\b/i },
  { slug: "focused", label: "Focused Fund", majorCategorySlug: "growth-equity", re: /\bFocused\s+Fund\b/i },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds", majorCategorySlug: "growth-equity", re: /\bSectoral\s*[/\-]\s*Thematic\s+Funds?\b/i },
  // ELSS appears in BOTH open-ended (Sub II) AND close-ended (Sub B-II).
  // The `found` set ensures the open-ended row wins (it appears first
  // in document order).
  { slug: "elss", label: "ELSS", majorCategorySlug: "growth-equity", re: /\bELSS\b/i },
  { slug: "flexi-cap", label: "Flexi Cap Fund", majorCategorySlug: "growth-equity", re: /\bFlexi\s+Cap\s+Fund\b/i },

  // Sub III — Hybrid (6 rows).
  { slug: "conservative-hybrid", label: "Conservative Hybrid Fund", majorCategorySlug: "hybrid", re: /\bConservative\s+Hybrid\s+Fund\b/i },
  { slug: "balanced-aggressive-hybrid", label: "Balanced Hybrid Fund/Aggressive Hybrid Fund", majorCategorySlug: "hybrid", re: /\bBalanced\s+Hybrid\s+Fund\s*\/\s*Aggressive\s+Hybrid\s+Fund\b/i },
  { slug: "baf-daa", label: "Dynamic Asset Allocation/Balanced Advantage Fund", majorCategorySlug: "hybrid", re: /\bDynamic\s+Asset\s+Allocation\s*\/\s*Balanced\s+Advantage\s+Fund\b/i },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund", majorCategorySlug: "hybrid", re: /\bMulti[\s-]+Asset[\s-]+Allocation\s+Fund\b/i },
  { slug: "arbitrage", label: "Arbitrage Fund", majorCategorySlug: "hybrid", re: /\bArbitrage\s+Fund\b/i },
  { slug: "equity-savings", label: "Equity Savings Fund", majorCategorySlug: "hybrid", re: /\bEquity\s+Savings\s+Fund\b/i },

  // Sub IV — Solution Oriented (2 rows).
  { slug: "retirement", label: "Retirement Fund", majorCategorySlug: "solution", re: /\bRetirement\s+Fund\b/i },
  { slug: "childrens", label: "Childrens Fund", majorCategorySlug: "solution", re: /\bChildren'?s\s+Fund\b/i },

  // Sub V — Other Schemes (4 rows).
  { slug: "index-funds", label: "Index Funds", majorCategorySlug: "other-schemes", re: /\bIndex\s+Funds?\b/i },
  { slug: "gold-etf", label: "GOLD ETF", majorCategorySlug: "other-schemes", re: /\bGOLD\s+ETF\b/i },
  { slug: "other-etfs", label: "Other ETFs", majorCategorySlug: "other-schemes", re: /\bOther\s+ETFs?\b/i },
  { slug: "fof-overseas", label: "Fund of funds investing overseas", majorCategorySlug: "other-schemes", re: /\bFund\s+of\s+funds\s+investing\s+overseas\b/i },
];

// ---------------------------------------------------------------------
// PDF parsing helpers (mirrors the monthly extractor's).
// ---------------------------------------------------------------------

interface PdfPage {
  num: number;
  text: string;
}

const NUM_TOKEN = /^-?\d[\d,]*(?:\.\d+)?$/;

function parseLooseNumber(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull all numeric tokens out of a single line. Trailing "-" cells in
 * the AMFI table (segregated portfolios columns when empty) are
 * preserved as null so column indices stay aligned with the table
 * header. LEADING "-" tokens — e.g. the separator dash in a label like
 * "Sub Total - II" — are skipped so they don't shift downstream column
 * indices by one.
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

// AMFI quarterly per-scheme table column ordering (same layout as the
// Monthly Report). The "Average Net AUM" column carries LAST MONTH
// only — see schema docstring for the methodological caveat.
//   0. No. of Schemes
//   1. No. of Folios
//   2. Funds Mobilized                  (₹ Cr, 3-month sum)
//   3. Repurchase / Redemption          (₹ Cr, 3-month sum)
//   4. Net Inflow (+ve) / Outflow (-ve) (₹ Cr, signed, 3-month sum)
//   5. Net AUM as on quarter-end        (₹ Cr)
//   6. Average Net AUM for LAST MONTH   (₹ Cr)
//   7. No. of segregated portfolios
//   8. Net AUM in segregated portfolio
const COL_SCHEMES = 0;
const COL_FOLIOS = 1;
const COL_FUNDS_MOBILIZED = 2;
const COL_REPURCHASE = 3;
const COL_NET_INFLOW = 4;
const COL_NET_AUM = 5;
const COL_LAST_MONTH_AAUM = 6;

/** Find the FIRST data line at or after `startIdx` whose AUM cell is
 *  > 0 and which has at least 7 numeric/null tokens. Used to bridge
 *  multi-line label rows like Sub Total - I, where the "(i+ii+...)"
 *  formula wraps across 2-3 lines before the data row appears. */
function findDataRow(
  lines: string[],
  startIdx: number,
  windowLines = 6
): (number | null)[] | null {
  for (
    let i = startIdx;
    i < Math.min(lines.length, startIdx + windowLines);
    i++
  ) {
    const cols = numericColumns(lines[i]);
    if (cols.length < 7) continue;
    if (lines[i].trim().length === 0) continue;
    const candidate = cols[COL_NET_AUM];
    if (candidate !== null && candidate > 0) return cols;
    if (cols.length >= 9) return cols;
  }
  return null;
}

// ---------------------------------------------------------------------
// Industry-row extraction.
// ---------------------------------------------------------------------

interface FieldHit {
  value: number;
  page: number;
  /** Human-readable description of the row + column the value came
   *  from, e.g. "Sub Total - II row · Net Inflow / Outflow column". */
  label: string;
}

/** Set of fields we capture per (Sub Total / Grand Total) row. Each
 *  bucket carries six columns: schemes (intermediate, not stored on
 *  the schema for sub-rows), folios, fundsMobilized, repurchase,
 *  netInflow, netAum, lastMonthAaum. */
interface BucketHits {
  folios?: FieldHit;
  fundsMobilized?: FieldHit;
  repurchase?: FieldHit;
  netInflow?: FieldHit;
  netAum?: FieldHit;
  lastMonthAaum?: FieldHit;
}

interface IndustryHits {
  grandTotal: BucketHits;
  debt: BucketHits;
  equity: BucketHits;
  hybrid: BucketHits;
  otherSchemes: BucketHits;
  /** Sub Total - IV (Solution Oriented Schemes) — net inflow only,
   *  used to derive activeEquityNetInflow. Solution AUM/AAUM/folios
   *  etc. are not surfaced on the schema. */
  solutionNetInflow?: FieldHit;
  /** Arbitrage Fund row's net inflow — used to subtract from the
   *  Hybrid envelope when deriving activeEquityNetInflow. */
  arbitrageNetInflow?: FieldHit;
  /** DERIVED: equityNetInflow + (hybridNetInflow - arbitrageNetInflow)
   *  + solutionNetInflow. Computed after parsing; null when any
   *  contributing field is missing (never zero-filled). */
  activeEquityNetInflow?: FieldHit;
}

/**
 * Capture six numeric columns from a Sub Total / Grand Total data row
 * into the supplied bucket. Only writes fields when the underlying
 * cell is non-null; folios is also required to be > 0 (a 0-folio row
 * is meaningless).
 */
function fillBucketFromRow(
  bucket: BucketHits,
  cols: (number | null)[],
  page: number,
  rowLabel: string
): void {
  const folios = cols[COL_FOLIOS];
  if (folios !== null && folios > 0 && !bucket.folios) {
    bucket.folios = {
      value: Math.round(folios),
      page,
      label: `${rowLabel} · No. of Folios column`,
    };
  }
  const fundsMobilized = cols[COL_FUNDS_MOBILIZED];
  if (fundsMobilized !== null && !bucket.fundsMobilized) {
    bucket.fundsMobilized = {
      value: fundsMobilized,
      page,
      label: `${rowLabel} · Funds Mobilized column`,
    };
  }
  const repurchase = cols[COL_REPURCHASE];
  if (repurchase !== null && !bucket.repurchase) {
    bucket.repurchase = {
      value: repurchase,
      page,
      label: `${rowLabel} · Repurchase / Redemption column`,
    };
  }
  const netInflow = cols[COL_NET_INFLOW];
  if (netInflow !== null && !bucket.netInflow) {
    bucket.netInflow = {
      value: netInflow,
      page,
      label: `${rowLabel} · Net Inflow / Outflow column`,
    };
  }
  const netAum = cols[COL_NET_AUM];
  if (netAum !== null && netAum > 0 && !bucket.netAum) {
    bucket.netAum = {
      value: netAum,
      page,
      label: `${rowLabel} · Net AUM column`,
    };
  }
  const aaum = cols[COL_LAST_MONTH_AAUM];
  if (aaum !== null && aaum > 0 && !bucket.lastMonthAaum) {
    bucket.lastMonthAaum = {
      value: aaum,
      page,
      label: `${rowLabel} · Average Net AUM (last-month) column`,
    };
  }
}

/** Block-style label specs: the label sits on its own line(s) and the
 *  data row may be inline OR wrapped 1-3 lines below. Open-ended
 *  Sub Totals only — close-ended sub-totals are written as
 *  "Sub Total (i+...)" without the roman numeral suffix and DO NOT
 *  match these regexes. */
interface BlockSpec {
  bucket: keyof Pick<
    IndustryHits,
    "grandTotal" | "debt" | "equity" | "hybrid" | "otherSchemes"
  > | null;
  /** When set, capture only the netInflow into `solutionNetInflow`
   *  (Sub Total - IV does not surface as a public bucket). */
  solutionFlow?: boolean;
  re: RegExp;
  rowLabel: string;
}

const BLOCK_SPECS: BlockSpec[] = [
  // Sub Total - I, NOT II/III/IV (negative lookahead for [IV]).
  { bucket: "debt", re: /^\s*Sub\s*Total\s*-\s*I\b(?!\s*[IV])/i, rowLabel: "Sub Total - I row" },
  { bucket: "equity", re: /^\s*Sub\s*Total\s*-\s*II\b(?!\s*[IV])/i, rowLabel: "Sub Total - II row" },
  { bucket: "hybrid", re: /^\s*Sub\s*Total\s*-\s*III\b/i, rowLabel: "Sub Total - III row" },
  { bucket: null, solutionFlow: true, re: /^\s*Sub\s*Total\s*-\s*IV\b/i, rowLabel: "Sub Total - IV row" },
  { bucket: "otherSchemes", re: /^\s*Sub\s*Total\s*-\s*V\b/i, rowLabel: "Sub Total - V row" },
  { bucket: "grandTotal", re: /^\s*Grand\s+Total\b/i, rowLabel: "Grand Total row" },
];

function parseIndustry(pages: PdfPage[]): {
  hits: IndustryHits;
  pagesUsed: Set<number>;
} {
  const hits: IndustryHits = {
    grandTotal: {},
    debt: {},
    equity: {},
    hybrid: {},
    otherSchemes: {},
  };
  const pagesUsed = new Set<number>();

  for (const page of pages) {
    const lines = page.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Block labels (Sub Total - I/II/III/IV/V, Grand Total).
      for (const spec of BLOCK_SPECS) {
        if (spec.bucket && hits[spec.bucket].netAum) continue;
        if (spec.solutionFlow && hits.solutionNetInflow) continue;
        if (!spec.re.test(line)) continue;
        const cols = findDataRow(lines, i, 6);
        if (!cols) continue;
        if (spec.bucket) {
          fillBucketFromRow(hits[spec.bucket], cols, page.num, spec.rowLabel);
          pagesUsed.add(page.num);
        }
        if (spec.solutionFlow) {
          const netInflow = cols[COL_NET_INFLOW];
          if (netInflow !== null) {
            hits.solutionNetInflow = {
              value: netInflow,
              page: page.num,
              label: `${spec.rowLabel} · Net Inflow / Outflow column`,
            };
            pagesUsed.add(page.num);
          }
        }
      }

      // Inline Arbitrage Fund row — captured ONLY for its net-inflow
      // column, which feeds the activeEquityNetInflow derivation.
      if (!hits.arbitrageNetInflow && /\bArbitrage\s+Fund\b/i.test(line)) {
        const cols = numericColumns(line);
        if (cols.length >= 7) {
          const aum = cols[COL_NET_AUM];
          const netInflow = cols[COL_NET_INFLOW];
          if (aum !== null && aum > 0 && netInflow !== null) {
            hits.arbitrageNetInflow = {
              value: netInflow,
              page: page.num,
              label: "Arbitrage Fund row · Net Inflow / Outflow column",
            };
            pagesUsed.add(page.num);
          }
        }
      }
    }
  }

  // activeEquityNetInflow = equityNetInflow
  //                       + (hybridNetInflow - arbitrageNetInflow)
  //                       + solutionNetInflow
  // Omitted (never zero-filled) when any contributing row is missing.
  const eq = hits.equity.netInflow;
  const hy = hits.hybrid.netInflow;
  const arb = hits.arbitrageNetInflow;
  const sol = hits.solutionNetInflow;
  if (eq && hy && arb && sol) {
    hits.activeEquityNetInflow = {
      value: eq.value + (hy.value - arb.value) + sol.value,
      page: eq.page,
      label:
        "Sub II net inflow + (Sub III net inflow − Arbitrage Fund net inflow) + " +
        "Sub IV net inflow · (IIFL active-equity envelope flow, quarter-sum)",
    };
  }

  return { hits, pagesUsed };
}

// ---------------------------------------------------------------------
// Category-row extraction.
// ---------------------------------------------------------------------

function parseCategories(
  pages: PdfPage[],
  filename: string,
  quarterId: QuarterId,
  extractedAt: string
): { rows: AmfiQuarterlyCategoryRow[]; pagesUsed: Set<number> } {
  const found = new Set<AmfiMonthlyCategorySlug>();
  const rows: AmfiQuarterlyCategoryRow[] = [];
  const pagesUsed = new Set<number>();

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
        // Column-collision guard: a legitimate category data row's tail
        // ALWAYS starts with whitespace then a digit (or `-` for a
        // negative number); anything else means the matched label is a
        // stray header that has collided with a different row's data.
        if (!/^\s+-?\d/.test(tail)) continue;
        const cols = numericColumns(tail);
        if (cols.length < 7) continue;
        const aum = cols[COL_NET_AUM];
        if (aum === null || aum <= 0) continue;

        const fieldSourceBase: Omit<AmfiQuarterlyFieldSource, "sourceLabel"> = {
          sourcePdf: filename,
          sourceFormat: "quarterly-report",
          sourcePages: [page.num],
          extractedAt,
        };
        const fieldSources: AmfiQuarterlyCategoryFieldSources = {};
        const row: AmfiQuarterlyCategoryRow = {
          quarter: quarterId.quarter,
          quarterLabel: quarterId.quarterLabel,
          quarterStart: quarterId.quarterStart,
          quarterEnd: quarterId.quarterEnd,
          categorySlug: spec.slug,
          category: spec.label,
          majorCategorySlug: spec.majorCategorySlug,
          majorCategoryLabel: MAJOR_CATEGORY_LABELS[spec.majorCategorySlug],
          categoryAum: aum,
          fieldSources,
          sourcePdf: filename,
          sourceFormat: "quarterly-report",
          sourcePages: [page.num],
          extractedAt,
        };
        fieldSources.categoryAum = {
          ...fieldSourceBase,
          sourceLabel: `${spec.label} row · Net AUM column`,
        };

        const schemes = cols[COL_SCHEMES];
        if (schemes !== null && schemes > 0) {
          row.categorySchemes = Math.round(schemes);
          fieldSources.categorySchemes = {
            ...fieldSourceBase,
            sourceLabel: `${spec.label} row · No. of Schemes column`,
          };
        }
        const folios = cols[COL_FOLIOS];
        if (folios !== null && folios > 0) {
          row.categoryFolios = Math.round(folios);
          fieldSources.categoryFolios = {
            ...fieldSourceBase,
            sourceLabel: `${spec.label} row · No. of Folios column`,
          };
        }
        const fundsMobilized = cols[COL_FUNDS_MOBILIZED];
        if (fundsMobilized !== null) {
          row.categoryFundsMobilized = fundsMobilized;
          fieldSources.categoryFundsMobilized = {
            ...fieldSourceBase,
            sourceLabel: `${spec.label} row · Funds Mobilized column`,
          };
        }
        const repurchase = cols[COL_REPURCHASE];
        if (repurchase !== null) {
          row.categoryRepurchase = repurchase;
          fieldSources.categoryRepurchase = {
            ...fieldSourceBase,
            sourceLabel: `${spec.label} row · Repurchase / Redemption column`,
          };
        }
        const netInflow = cols[COL_NET_INFLOW];
        if (netInflow !== null) {
          row.categoryNetInflow = netInflow;
          fieldSources.categoryNetInflow = {
            ...fieldSourceBase,
            sourceLabel: `${spec.label} row · Net Inflow / Outflow column`,
          };
        }
        const aaum = cols[COL_LAST_MONTH_AAUM];
        if (aaum !== null && aaum > 0) {
          row.categoryLastMonthAaum = aaum;
          fieldSources.categoryLastMonthAaum = {
            ...fieldSourceBase,
            sourceLabel: `${spec.label} row · Average Net AUM (last-month) column`,
          };
        }

        rows.push(row);
        found.add(spec.slug);
        pagesUsed.add(page.num);
      }
    }
  }

  return { rows, pagesUsed };
}

// ---------------------------------------------------------------------
// Per-PDF extraction + top-level orchestration.
// ---------------------------------------------------------------------

interface ExtractedFile {
  industry: AmfiQuarterlyIndustryRow;
  categoryRows: AmfiQuarterlyCategoryRow[];
}

/** Project a `BucketHits` into the AmfiQuarterlyIndustryRow numeric
 *  fields + their fieldSources entries, prefixed with `bucket`
 *  (e.g. "debt" → debtAum, debtFolios, etc.). */
function applyBucketToRow(
  row: AmfiQuarterlyIndustryRow,
  fieldSources: AmfiQuarterlyIndustryFieldSources,
  prefix: "grandTotal" | "debt" | "equity" | "hybrid" | "otherSchemes",
  bucket: BucketHits,
  filename: string,
  extractedAt: string
): number {
  let count = 0;
  const baseProvenance: Omit<AmfiQuarterlyFieldSource, "sourceLabel"> = {
    sourcePdf: filename,
    sourceFormat: "quarterly-report",
    sourcePages: [],
    extractedAt,
  };
  const set = (
    suffix: "Aum" | "LastMonthAaum" | "NetInflow" | "FundsMobilized" | "Repurchase" | "Folios",
    hit: FieldHit | undefined
  ) => {
    if (!hit) return;
    const field = `${prefix}${suffix}` as keyof AmfiQuarterlyIndustryRow;
    (row as unknown as Record<string, number>)[field] = hit.value;
    (fieldSources as Record<string, AmfiQuarterlyFieldSource>)[field] = {
      ...baseProvenance,
      sourcePages: [hit.page],
      sourceLabel: hit.label,
    };
    count += 1;
  };
  set("Aum", bucket.netAum);
  set("LastMonthAaum", bucket.lastMonthAaum);
  set("NetInflow", bucket.netInflow);
  set("FundsMobilized", bucket.fundsMobilized);
  set("Repurchase", bucket.repurchase);
  set("Folios", bucket.folios);
  return count;
}

async function extractFromPdf(pdfPath: string): Promise<ExtractedFile | null> {
  const filename = path.basename(pdfPath);
  const buffer = await fs.readFile(pdfPath);

  let pages: PdfPage[];
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    pages = result.pages.map((p) => ({ num: p.num, text: p.text ?? "" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`amfi-quarterly-pdf: ${filename}: pdf-parse failed — ${msg}`);
    return null;
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const quarterId = detectQuarter(filename, pages);
  if (!quarterId) {
    warn(
      `amfi-quarterly-pdf: ${filename}: could not infer quarter from filename or text — skipped`
    );
    return null;
  }

  const extractedAt = nowIso();
  const { hits, pagesUsed: industryPages } = parseIndustry(pages);
  const { rows: categoryRows, pagesUsed: categoryPages } = parseCategories(
    pages,
    filename,
    quarterId,
    extractedAt
  );

  const fieldSources: AmfiQuarterlyIndustryFieldSources = {};
  const row: AmfiQuarterlyIndustryRow = {
    quarter: quarterId.quarter,
    quarterLabel: quarterId.quarterLabel,
    quarterStart: quarterId.quarterStart,
    quarterEnd: quarterId.quarterEnd,
    fieldSources,
    sourcePdf: filename,
    sourceFormat: "quarterly-report",
    sourcePages: [],
    extractedAt,
  };

  let hitCount = 0;
  hitCount += applyBucketToRow(row, fieldSources, "grandTotal", hits.grandTotal, filename, extractedAt);
  hitCount += applyBucketToRow(row, fieldSources, "debt", hits.debt, filename, extractedAt);
  hitCount += applyBucketToRow(row, fieldSources, "equity", hits.equity, filename, extractedAt);
  hitCount += applyBucketToRow(row, fieldSources, "hybrid", hits.hybrid, filename, extractedAt);
  hitCount += applyBucketToRow(row, fieldSources, "otherSchemes", hits.otherSchemes, filename, extractedAt);

  if (hits.activeEquityNetInflow) {
    row.activeEquityNetInflow = hits.activeEquityNetInflow.value;
    fieldSources.activeEquityNetInflow = {
      sourcePdf: filename,
      sourceFormat: "quarterly-report",
      sourcePages: [hits.activeEquityNetInflow.page],
      extractedAt,
      sourceLabel: hits.activeEquityNetInflow.label,
    };
    hitCount += 1;
  }

  const allPages = new Set<number>([...industryPages, ...categoryPages]);
  row.sourcePages = Array.from(allPages).sort((a, b) => a - b);

  if (hitCount === 0 && categoryRows.length === 0) {
    warn(
      `amfi-quarterly-pdf: ${filename}: quarter=${quarterId.quarterLabel} — no values matched`
    );
  } else {
    info(
      `amfi-quarterly-pdf: ${filename}: quarter=${quarterId.quarterLabel}, fields=${hitCount}, pages=${row.sourcePages.join(",") || "-"}, categoryRows=${categoryRows.length}`
    );
  }

  return { industry: row, categoryRows };
}

async function listPdfs(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`amfi-quarterly-pdf: cannot read ${dir}: ${msg}`);
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function ingestAmfiQuarterlyPdf(): Promise<void> {
  const pdfs = await listPdfs(PDF_DIR);
  if (pdfs.length === 0) {
    info(
      `amfi-quarterly-pdf: no PDFs in ${PDF_DIR} — preserving prior snapshots`
    );
    return;
  }

  const industryRows: AmfiQuarterlyIndustryRow[] = [];
  const categoryRows: AmfiQuarterlyCategoryRow[] = [];
  let processed = 0;
  for (const pdfPath of pdfs) {
    const result = await extractFromPdf(pdfPath);
    if (!result) continue;
    processed += 1;
    industryRows.push(result.industry);
    categoryRows.push(...result.categoryRows);
  }

  industryRows.sort((a, b) => a.quarter.localeCompare(b.quarter));
  categoryRows.sort((a, b) => {
    if (a.quarter !== b.quarter) return a.quarter.localeCompare(b.quarter);
    return a.categorySlug.localeCompare(b.categorySlug);
  });

  const industrySnapshot: AmfiQuarterlyIndustrySnapshot = {
    meta: {
      source: "AMFI Quarterly Report PDFs",
      generatedAt: nowIso(),
      rowCount: industryRows.length,
      notes: QUARTERLY_NOTES,
    },
    rows: industryRows,
  };
  await writeSnapshot(INDUSTRY_SNAPSHOT_FILE, industrySnapshot);
  info(
    `amfi-quarterly-pdf: wrote ${industryRows.length} industry row(s) to src/data/snapshots/${INDUSTRY_SNAPSHOT_FILE} from ${processed}/${pdfs.length} PDFs`
  );

  const categorySnapshot: AmfiQuarterlyCategorySnapshot = {
    meta: {
      source: "AMFI Quarterly Report PDFs",
      generatedAt: nowIso(),
      rowCount: categoryRows.length,
      notes: QUARTERLY_NOTES,
    },
    rows: categoryRows,
  };
  await writeSnapshot(CATEGORY_SNAPSHOT_FILE, categorySnapshot);
  info(
    `amfi-quarterly-pdf: wrote ${categoryRows.length} category row(s) to src/data/snapshots/${CATEGORY_SNAPSHOT_FILE}`
  );
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (invokedDirectly) {
  ingestAmfiQuarterlyPdf().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ingest][fatal] amfi-quarterly-pdf: ${msg}\n`);
    process.exit(1);
  });
}
