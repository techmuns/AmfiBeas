/**
 * AMC factsheet performance — shared parser strategy.
 *
 * This module is the generalised version of the per-AMC scheme-
 * outperformance parser proven in PRs #82 → #87 (HDFC PoC). The
 * parser internals are AMC-agnostic — every SEBI-regulated mutual
 * fund factsheet shares the same disclosure shape:
 *
 *   1. Per-scheme page with a header containing the scheme name
 *      and the SEBI scheme-objective line.
 *   2. A "PERFORMANCE ^ - Regular Plan - Growth Option" block
 *      containing time-period rows (Last 1 Year / Last 3 Years /
 *      Last 5 Years / Since Inception) with scheme + benchmark +
 *      additional benchmark CAGR.
 *   3. A SIP-PERFORMANCE twin block, ignored.
 *   4. A "#BENCHMARK INDEX" / "##ADDL. BENCHMARK INDEX" legend at
 *      the page level naming the benchmarks.
 *
 * The AMC-specific bits are:
 *   - Listing-page URL where monthly factsheet PDFs are published.
 *   - PDF-link href pattern.
 *   - URL-to-period mapping (e.g. HDFC: /<YYYY-MM>/HDFC...pdf).
 *   - Brand prefix that scheme names start with ("HDFC ", "SBI ",
 *     "ICICI Prudential ", etc.).
 *   - Boilerplate filter (lines starting with the brand that are
 *     NOT scheme names, e.g. "HDFC Asset Management Company").
 *
 * Per-AMC strategy files in scripts/ingest/factsheet-strategies/
 * supply those config pieces and call into this module's
 * runFactsheetStrategy() for the heavy lifting.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type { Browser, Page } from "playwright";
import { info, nowIso, parseNumberLoose, warn } from "./utils";

// ---------------------------------------------------------------------------
// Config interfaces — supplied by per-AMC strategy modules.
// ---------------------------------------------------------------------------

export interface AmcStrategy {
  amcSlug: string;
  amcName: string;
  /** Public listing page where monthly factsheets are linked. */
  listingUrl: string;
  /** RE that identifies a factsheet PDF link's href. */
  pdfHrefPattern: RegExp;
  /** Extract a YYYY-MM period from a PDF href, if encoded there.
   *  Used both to pick the LATEST PDF and to emit periodEnd. Return
   *  null when the href has no period segment. */
  periodFromHref: (href: string) => string | null;
  /** Optional: extract a YYYY-MM period from the link text (used as
   *  a fallback when href lacks a date). */
  periodFromLinkText?: (text: string) => string | null;
  /** RE that matches a line starting with the AMC's brand. The
   *  scheme-title walker uses this to find the scheme name in the
   *  page header. Anchor with ^ and require the trailing space so
   *  brand names embedded inside other words don't match. */
  schemeBrandPrefix: RegExp;
  /** Returns true if a brand-prefixed line is AMC boilerplate
   *  (e.g. "HDFC Asset Management Company") rather than a real
   *  scheme name. */
  isBoilerplate: (line: string) => boolean;
  /** Optional: a CSS selector to wait for on the listing page
   *  before scraping links. Defaults to a generic anchor selector
   *  matching pdfHrefPattern. */
  waitListingSelector?: string;
  /** Optional: regex(es) used to anchor the per-scheme PERFORMANCE
   *  section. Each regex is compiled with the global flag and run
   *  across each page; the union of hits (deduplicated) is the
   *  candidate marker set. When undefined, defaults to HDFC's
   *  `\bPERFORMANCE\s*\^` (which requires the SEBI footnote `^`).
   *  Other AMCs use different section header phrasing — supply
   *  their patterns here so this strategy can find the right
   *  sections without forcing a one-size-fits-all change. */
  performanceMarkerPatterns?: RegExp[];
  /** How the per-scheme performance table is laid out. Default
   *  ("row-by-period", HDFC) means each row is a TIME PERIOD and
   *  the row's first 3 numbers are (scheme%, benchmark%,
   *  additional%). "row-by-entity" (Nippon) means each row is an
   *  ENTITY (Fund / Benchmark / Additional) and the row's first 3
   *  decimal numbers are (1Y%, 3Y%, 5Y%) — periods are the columns. */
  tableOrientation?: "row-by-period" | "row-by-entity";
  /** Where the scheme name lives. Default ("page-header", HDFC)
   *  walks the page text BEFORE the marker. "after-marker" (Nippon)
   *  takes the first non-header line AFTER the marker that starts
   *  with the brand prefix. */
  schemeTitleSource?: "page-header" | "after-marker";
  /** Optional: extra page range to capture in PdfDiagnostics when
   *  the parser finds 0 sections. ICICI's regular-plan annexure
   *  lives at pages 115-125 — including those snippets in the
   *  diagnostics lets the next strategy iteration target the
   *  right section without a re-run. */
  diagnosticsPageRange?: [number, number];
}

// ---------------------------------------------------------------------------
// Eligibility — IIFL active-equity envelope (Sub II + Sub III ex-Arbitrage
// + Sub IV; 18 SEBI categories). Shared across all AMCs.
// ---------------------------------------------------------------------------

export type CategorySlug =
  // Sub II — Growth/Equity (all 11)
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
  // Sub III — Hybrid (all 6; Arbitrage is excluded from envelope below)
  | "conservative-hybrid"
  | "balanced-aggressive-hybrid"
  | "baf-daa"
  | "multi-asset"
  | "arbitrage"
  | "equity-savings"
  // Sub IV — Solution
  | "retirement"
  | "childrens"
  // Excluded categories — kept in the slug map so excluded reasons
  // are precise instead of "unknown".
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
  | "index-funds"
  | "gold-etf"
  | "other-etfs"
  | "fof-overseas";

export const ELIGIBLE_SLUGS = new Set<CategorySlug>([
  "multi-cap",
  "large-cap",
  "large-mid-cap",
  "mid-cap",
  "small-cap",
  "dividend-yield",
  "value-contra",
  "focused",
  "sectoral-thematic",
  "elss",
  "flexi-cap",
  "conservative-hybrid",
  "balanced-aggressive-hybrid",
  "baf-daa",
  "multi-asset",
  "equity-savings",
  "retirement",
  "childrens",
]);

interface CategorySpec {
  slug: CategorySlug;
  label: string;
  re: RegExp;
}

// Order matters — more-specific patterns first. See PR #86 for the
// priority rationale (Solution → ELSS → BAF/DAA → other hybrid →
// Growth/Equity → sectoral-thematic last).
const CATEGORY_SPECS: CategorySpec[] = [
  { slug: "ultra-short-duration", label: "Ultra Short Duration Fund", re: /\bUltra\s+Short\s+Duration\b/i },
  { slug: "low-duration", label: "Low Duration Fund", re: /\bLow\s+Duration\b/i },
  { slug: "medium-to-long-duration", label: "Medium to Long Duration Fund", re: /\bMedium\s+to\s+Long\s+Duration\b/i },
  { slug: "medium-duration", label: "Medium Duration Fund", re: /\bMedium\s+Duration\b(?!\s+to)/i },
  { slug: "short-duration", label: "Short Duration Fund", re: /\bShort\s+Duration\b/i },
  { slug: "long-duration", label: "Long Duration Fund", re: /\bLong\s+Duration\b/i },
  { slug: "money-market", label: "Money Market Fund", re: /\bMoney\s+Market\b/i },
  { slug: "overnight", label: "Overnight Fund", re: /\bOvernight\s+Fund\b/i },
  { slug: "liquid", label: "Liquid Fund", re: /\bLiquid\s+Fund\b/i },
  { slug: "dynamic-bond", label: "Dynamic Bond Fund", re: /\bDynamic\s+Bond\b/i },
  { slug: "corporate-bond", label: "Corporate Bond Fund", re: /\bCorporate\s+Bond\b/i },
  { slug: "credit-risk", label: "Credit Risk Fund", re: /\bCredit\s+Risk\b/i },
  { slug: "banking-psu", label: "Banking and PSU Fund", re: /\bBanking\s+(?:and|&)\s+PSU\b/i },
  { slug: "gilt-10y-constant", label: "Gilt Fund with 10 year constant duration", re: /\bGilt\s+Fund\s+with\s+10\s+year\b/i },
  { slug: "gilt", label: "Gilt Fund", re: /\bGilt\s+Fund\b/i },
  { slug: "floater", label: "Floater Fund", re: /\bFloater\b/i },
  { slug: "arbitrage", label: "Arbitrage Fund", re: /\bArbitrage\b/i },
  { slug: "index-funds", label: "Index Fund", re: /\bIndex\s+Fund\b/i },
  { slug: "gold-etf", label: "Gold ETF", re: /\bGold\s+ETF\b/i },
  { slug: "other-etfs", label: "Other ETF", re: /\bETF\b/i },
  { slug: "fof-overseas", label: "Fund of Funds (Overseas)", re: /\bFund\s+of\s+Funds?\b.*\b(?:overseas|international)\b/i },
  { slug: "retirement", label: "Retirement Fund", re: /\bRetirement\b/i },
  { slug: "childrens", label: "Children's Fund", re: /\bChildren'?s?\b.*\b(?:Fund|Gift)\b/i },
  { slug: "elss", label: "ELSS", re: /\b(?:ELSS|Tax[\s-]?Saver)\b/i },
  { slug: "baf-daa", label: "Dynamic Asset Allocation / BAF", re: /\b(?:Balanced\s+Advantage|Dynamic\s+Asset\s+Allocation|Dynamic\s+PE)\b/i },
  { slug: "balanced-aggressive-hybrid", label: "Balanced / Aggressive Hybrid Fund", re: /\b(?:Aggressive\s+Hybrid|Balanced\s+Hybrid|Hybrid\s+Equity(?!\s+Debt))\b/i },
  { slug: "conservative-hybrid", label: "Conservative Hybrid Fund", re: /\b(?:Conservative\s+Hybrid|Hybrid\s+Debt|Hybrid\s+Equity\s+Debt)\b/i },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund", re: /\bMulti[\s-]?Asset\b/i },
  { slug: "equity-savings", label: "Equity Savings Fund", re: /\bEquity\s+Savings?\b/i },
  { slug: "large-mid-cap", label: "Large & Mid Cap Fund", re: /\bLarge\s*(?:&|and)\s*Mid\s+Cap\b/i },
  { slug: "flexi-cap", label: "Flexi Cap Fund", re: /\bFlexi\s+Cap\b/i },
  { slug: "multi-cap", label: "Multi Cap Fund", re: /\bMulti\s+Cap\b/i },
  { slug: "large-cap", label: "Large Cap Fund", re: /\bLarge\s+Cap\b/i },
  { slug: "mid-cap", label: "Mid Cap Fund", re: /\bMid[\s-]?Cap\s+(?:Opportunit|Fund)/i },
  { slug: "small-cap", label: "Small Cap Fund", re: /\bSmall[\s-]?Cap\b/i },
  { slug: "dividend-yield", label: "Dividend Yield Fund", re: /\bDividend\s+Yield\b/i },
  { slug: "value-contra", label: "Value Fund / Contra Fund", re: /\b(?:Value\s+Fund|Contra\s+Fund|Capital\s+Builder\s+Value)\b/i },
  { slug: "focused", label: "Focused Fund", re: /\bFocused\b/i },
  { slug: "sectoral-thematic", label: "Sectoral / Thematic Fund", re: /\b(?:Banking\s+(?:&|and)\s+Financial|Pharma|Healthcare|Technology|Infrastructure|Defence|MNC|FMCG|Energy|Transportation|Logistics|Consumption|Business\s+Cycle|Manufacturing|PSU|Housing)\b/i },
];

export function classifyCategory(
  schemeName: string
): { slug: CategorySlug; label: string } | null {
  for (const spec of CATEGORY_SPECS) {
    if (spec.re.test(schemeName)) return { slug: spec.slug, label: spec.label };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Universal regex: benchmark tokens, CAGR numbers, PERFORMANCE marker
// ---------------------------------------------------------------------------

const RE_BENCHMARK_TOKEN =
  /\b(?:NIFTY|S&P\s*BSE|BSE\s+\d|BSE\s+(?:100|200|500|TECK|Sensex)|CRISIL|MSCI|FTSE|Sensex|TRI)\b/i;

const RE_CAGR = /-?\d{1,3}(?:,\d{3})*\.\d{1,2}\s*%?/g;

// Strict: requires `^` after PERFORMANCE so we don't match
// "PERFORMANCE OF OTHER SCHEMES MANAGED BY..." appendices.
const RE_PERFORMANCE_MARKER = /\bPERFORMANCE\s*\^/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfPage {
  num: number;
  text: string;
}

export interface ParsedSchemeRow {
  schemeName: string;
  schemeNameRaw: string;
  category: string | null;
  categorySlug: CategorySlug | null;
  benchmarkName: string | null;
  schemeReturn1Y: number | null;
  schemeReturn3Y: number | null;
  schemeReturn5Y: number | null;
  benchmarkReturn1Y: number | null;
  benchmarkReturn3Y: number | null;
  benchmarkReturn5Y: number | null;
  outperformed1Y: boolean | null;
  outperformed3Y: boolean | null;
  outperformed5Y: boolean | null;
  pageNum: number;
  textSnippet: string;
}

export interface ExcludedScheme {
  schemeName: string;
  reason:
    | "category-excluded"
    | "category-unknown"
    | "missing-returns"
    | "missing-benchmark";
  categorySlug?: CategorySlug;
  category?: string;
  pageNum?: number;
  detectedSchemeTitleCandidate?: string;
  pageHeaderSnippet?: string;
  benchmarkHeaderSnippet?: string;
  detectedPrimaryBenchmarkCandidate?: string | null;
  detectedAdditionalBenchmarkCandidate?: string | null;
}

export interface ParseWarning {
  pageNum?: number;
  message: string;
}

export interface RejectedCandidate {
  pageNum: number;
  reason:
    | "sip-performance"
    | "no-hdfc-scheme-line"
    | "no-benchmark-line"
    | "no-scheme-numbers"
    | "no-period-rows"
    | "scheme-name-too-long"
    | "scheme-name-paragraph";
  textSnippet: string;
  pageHeaderSnippet?: string;
  textBeforePerformance?: string;
  detectedSchemeTitleCandidate?: string | null;
  detectedCategoryCandidate?: string | null;
}

interface PerformanceSection {
  pageNum: number;
  text: string;
  pageHeaderText: string;
  pageFullText: string;
  isSip: boolean;
}

interface ParsedSection {
  row?: ParsedSchemeRow;
  rejection?: RejectedCandidate;
  context?: SectionContext;
}

interface SectionContext {
  pageHeaderSnippet: string;
  benchmarkHeaderSnippet: string;
  detectedSchemeTitleCandidate: string | null;
  detectedPrimaryBenchmarkCandidate: string | null;
  detectedAdditionalBenchmarkCandidate: string | null;
}

interface BenchmarkDetection {
  primary: string | null;
  additional: string | null;
  headerSnippet: string;
}

interface ParsedSchemeRowWithContext {
  row: ParsedSchemeRow;
  context: SectionContext;
}

// ---------------------------------------------------------------------------
// Per-AMC audit result shape (returned by runFactsheetStrategy).
// ---------------------------------------------------------------------------

/** PDF parser diagnostics. Populated when the PDF was fetched and
 *  pdf-parse returned pages, BUT findPerformanceSections found zero
 *  PERFORMANCE markers — i.e. the strategy's marker patterns don't
 *  match the AMC's section headers. Lets the next iteration see
 *  what's actually in the PDF without re-running. */
export interface PdfDiagnostics {
  pageCount: number;
  textExtractionStatus: "ok" | "empty";
  /** First 800 chars of the first 3 pages — usually enough to spot
   *  the layout and the section header phrasing. */
  firstPageSnippets: { pageNum: number; snippet: string }[];
  /** Lines (across all pages) containing "performance" — first 20
   *  hits, trimmed to 200 chars. Reveals the AMC's section header
   *  phrasing ("Scheme Performance", "Performance of the Fund", etc). */
  performanceLines: string[];
  /** Same for "benchmark" — reveals the AMC's benchmark legend
   *  format. */
  benchmarkLines: string[];
  /** Same for "returns". */
  returnsLines: string[];
  /** Lines starting with the AMC's brand prefix that are NOT
   *  flagged as boilerplate — likely scheme titles. First 20 hits. */
  schemeTitleCandidates: string[];
}

export interface AmcAuditResult {
  amcSlug: string;
  amcName: string;
  source: "AMC factsheet";
  sourceUrl: string | null;
  sourceFile: string | null;
  periodEnd: string | null;
  fetchedAt: string;
  status: "ok" | "partial" | "failed";
  parsedSchemeCount: number;
  eligibleSchemeCount1Y: number;
  eligibleSchemeCount3Y: number;
  eligibleSchemeCount5Y: number;
  outperformingSchemeCount1Y: number;
  outperformingSchemeCount3Y: number;
  outperformingSchemeCount5Y: number;
  outperformancePct1Y: number | null;
  outperformancePct3Y: number | null;
  outperformancePct5Y: number | null;
  candidateBlocksScanned: number;
  performancePagesDetected: number[];
  rejectedCandidateSamples: RejectedCandidate[];
  includedSchemes: ParsedSchemeRow[];
  excludedSchemes: ExcludedScheme[];
  warnings: ParseWarning[];
  notes: string[];
  failureReason?: string;
  diagnostics?: PdfDiagnostics;
}

// ---------------------------------------------------------------------------
// Section finder (universal — uses RE_PERFORMANCE_MARKER + isSipMarker)
// ---------------------------------------------------------------------------

function isSipMarker(text: string, idx: number): boolean {
  const lineStart = text.lastIndexOf("\n", idx) + 1;
  const lineEndRaw = text.indexOf("\n", idx);
  const lineEnd = lineEndRaw === -1 ? Math.min(text.length, idx + 80) : lineEndRaw;
  const markerLine = text.slice(lineStart, lineEnd);
  if (/\bSIP\s*PERFORMANCE\b/i.test(markerLine)) return true;
  const before = text.slice(Math.max(0, idx - 40), idx);
  const tokens = before.match(/\S+/g) ?? [];
  const lastToken = tokens[tokens.length - 1] ?? "";
  if (/^SIP\.?$/i.test(lastToken)) return true;
  if (/^IP\.?$/i.test(lastToken)) return true;
  return false;
}

/** Default PERFORMANCE section marker — HDFC's literal "PERFORMANCE ^"
 *  with the SEBI footnote `^`. Other AMCs use different phrasing
 *  (e.g. "Scheme Performance", "Performance of the Fund"); they
 *  override this via strategy.performanceMarkerPatterns. */
const DEFAULT_PERFORMANCE_MARKER_PATTERNS: RegExp[] = [RE_PERFORMANCE_MARKER];

function findPerformanceSections(
  pages: PdfPage[],
  strategy: AmcStrategy
): PerformanceSection[] {
  const rawPatterns =
    strategy.performanceMarkerPatterns ?? DEFAULT_PERFORMANCE_MARKER_PATTERNS;
  // Ensure each pattern has the global flag — required for stateful
  // .exec() in the walking loop below.
  const patterns = rawPatterns.map((re) =>
    re.flags.includes("g") ? re : new RegExp(re.source, re.flags + "g")
  );

  const out: PerformanceSection[] = [];
  for (const p of pages) {
    const text = p.text;
    const markers: { idx: number; isSip: boolean }[] = [];
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        markers.push({ idx: m.index, isSip: isSipMarker(text, m.index) });
      }
    }
    // Sort by position + dedupe near-duplicate hits (multiple
    // patterns can match the same header — e.g. "Scheme Performance"
    // and "Performance" both fire on the same line).
    markers.sort((a, b) => a.idx - b.idx);
    const dedupedMarkers: typeof markers = [];
    let prevIdx = -1;
    for (const mk of markers) {
      if (mk.idx - prevIdx < 8) continue;
      dedupedMarkers.push(mk);
      prevIdx = mk.idx;
    }
    const firstRegularPos = dedupedMarkers.findIndex((mk) => !mk.isSip);
    for (let i = 0; i < dedupedMarkers.length; i++) {
      const start = dedupedMarkers[i].idx;
      const end =
        i + 1 < dedupedMarkers.length ? dedupedMarkers[i + 1].idx : text.length;
      const isPrimaryRegular = i === firstRegularPos;
      out.push({
        pageNum: p.num,
        text: text.slice(start, end),
        pageHeaderText: text.slice(0, start),
        pageFullText: text,
        isSip: !isPrimaryRegular,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-section parser — parameterised by AMC strategy.
// ---------------------------------------------------------------------------

const PERIOD_LABELS = {
  "1Y": /^Last\s+1\s+Year\b/i,
  "3Y": /^Last\s+3\s+Years?\b/i,
  "5Y": /^Last\s+5\s+Years?\b/i,
} as const;

type Period = "1Y" | "3Y" | "5Y";

function parsePerformanceSection(
  section: PerformanceSection,
  strategy: AmcStrategy
): ParsedSection {
  if (section.isSip) {
    return {
      rejection: {
        pageNum: section.pageNum,
        reason: "sip-performance",
        textSnippet: section.text.slice(0, 240),
      },
    };
  }

  const titleSource = strategy.schemeTitleSource ?? "page-header";
  const titleCandidate =
    titleSource === "after-marker"
      ? detectSchemeTitleAfterMarker(section.text, strategy)
      : detectSchemeTitleCandidate(section.pageHeaderText, strategy);

  const baseRejection = (
    reason: RejectedCandidate["reason"]
  ): RejectedCandidate => ({
    pageNum: section.pageNum,
    reason,
    textSnippet: section.text.slice(0, 240),
    pageHeaderSnippet: section.pageHeaderText.slice(-800),
    textBeforePerformance: section.pageHeaderText.slice(-800),
    detectedSchemeTitleCandidate: titleCandidate,
    detectedCategoryCandidate: titleCandidate
      ? classifyCategory(titleCandidate)?.label ?? null
      : null,
  });

  if (!titleCandidate) return { rejection: baseRejection("no-hdfc-scheme-line") };
  if (titleCandidate.length > 80) return { rejection: baseRejection("scheme-name-too-long") };
  if (looksLikeParagraph(titleCandidate)) return { rejection: baseRejection("scheme-name-paragraph") };

  const orientation = strategy.tableOrientation ?? "row-by-period";
  const extracted =
    orientation === "row-by-entity"
      ? extractRowByEntity(section)
      : extractRowByPeriod(section);
  if (!extracted) return { rejection: baseRejection("no-period-rows") };
  const { s1Y, s3Y, s5Y, b1Y, b3Y, b5Y } = extracted;

  if (s1Y === null && s3Y === null && s5Y === null) {
    return { rejection: baseRejection("no-scheme-numbers") };
  }
  if (b1Y === null && b3Y === null && b5Y === null) {
    return { rejection: baseRejection("no-benchmark-line") };
  }

  const bench = detectBenchmarkName(section.pageFullText);
  const cls =
    classifyCategory(titleCandidate) ??
    classifyCategory(detectCategoryHintLine(section.pageHeaderText) ?? "");

  const row: ParsedSchemeRow = {
    schemeName: titleCandidate,
    schemeNameRaw: titleCandidate,
    category: cls?.label ?? null,
    categorySlug: cls?.slug ?? null,
    benchmarkName: bench.primary,
    schemeReturn1Y: s1Y,
    schemeReturn3Y: s3Y,
    schemeReturn5Y: s5Y,
    benchmarkReturn1Y: b1Y,
    benchmarkReturn3Y: b3Y,
    benchmarkReturn5Y: b5Y,
    outperformed1Y: outperformed(s1Y, b1Y),
    outperformed3Y: outperformed(s3Y, b3Y),
    outperformed5Y: outperformed(s5Y, b5Y),
    pageNum: section.pageNum,
    textSnippet: `${titleCandidate} | ${section.text.slice(0, 320)}`,
  };
  const context: SectionContext = {
    pageHeaderSnippet: section.pageHeaderText.slice(-800),
    benchmarkHeaderSnippet: bench.headerSnippet,
    detectedSchemeTitleCandidate: titleCandidate,
    detectedPrimaryBenchmarkCandidate: bench.primary,
    detectedAdditionalBenchmarkCandidate: bench.additional,
  };
  return { row, context };
}

interface ExtractedReturns {
  s1Y: number | null;
  s3Y: number | null;
  s5Y: number | null;
  b1Y: number | null;
  b3Y: number | null;
  b5Y: number | null;
}

/** HDFC layout — each table row is a TIME PERIOD ("Last 1 Year",
 *  "Last 3 Years", "Last 5 Years"); the row's first 3 numbers are
 *  (scheme%, benchmark%, additional%). Returns null when none of
 *  the period rows were found. */
function extractRowByPeriod(
  section: PerformanceSection
): ExtractedReturns | null {
  const lines = section.text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const periodRows: Partial<
    Record<Period, { line: string; nums: (number | null)[] }>
  > = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const stripped = l.replace(/^[A-Z][a-z]{2}\s+\d{1,2},\s*\d{2,4}\s+/, "");
    for (const [period, re] of Object.entries(PERIOD_LABELS) as [
      Period,
      RegExp,
    ][]) {
      if (periodRows[period]) continue;
      if (!re.test(stripped)) continue;
      const merged = [l, lines[i + 1] ?? "", lines[i + 2] ?? ""]
        .join(" ")
        .replace(/\s+/g, " ");
      const nums = extractNumbers(merged);
      if (nums.length === 0) continue;
      periodRows[period] = { line: merged, nums };
      break;
    }
  }
  if (!periodRows["1Y"] && !periodRows["3Y"] && !periodRows["5Y"]) {
    return null;
  }
  const pickPair = (
    nums: (number | null)[]
  ): [number | null, number | null] =>
    nums.length >= 3 ? [nums[0] ?? null, nums[1] ?? null] : [null, null];
  const [s1Y, b1Y] = pickPair(periodRows["1Y"]?.nums ?? []);
  const [s3Y, b3Y] = pickPair(periodRows["3Y"]?.nums ?? []);
  const [s5Y, b5Y] = pickPair(periodRows["5Y"]?.nums ?? []);
  return { s1Y, s3Y, s5Y, b1Y, b3Y, b5Y };
}

/** Nippon layout — each row is an ENTITY (Fund / Benchmark /
 *  Additional Benchmark); periods are the COLUMNS. Each period
 *  column has two sub-columns (Amount in ₹ + Returns %). RE_CAGR
 *  requires a decimal so amounts (whole-rupee comma figures) are
 *  filtered out — the first 3 decimal numbers per row are reliably
 *  (1Y, 3Y, 5Y) returns.
 *
 *  Heuristic: walk lines after the section header. The Fund row is
 *  the first decimal-bearing line whose label-portion contains the
 *  brand prefix or "Fund" / "Scheme". The Benchmark row is the
 *  next decimal-bearing line carrying a benchmark token (NIFTY,
 *  BSE, CRISIL, …) or starting with "Benchmark". "Additional"
 *  benchmark rows are skipped. */
function extractRowByEntity(
  section: PerformanceSection
): ExtractedReturns | null {
  const lines = section.text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let fundNums: (number | null)[] = [];
  let benchmarkNums: (number | null)[] = [];
  let foundFund = false;
  let foundBenchmark = false;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Skip column header lines explicitly — they often contain
    // "1 Year", "3 Year" etc which we don't want to classify as data.
    if (/Amount\s+in\s+₹|Value\s+of\s+₹\s*10|1\s+Year\s+3\s+Year|Inception\s+Date/i.test(l)) {
      continue;
    }
    // Merge with next line — Nippon often wraps long fund names + numbers.
    const merged = [l, lines[i + 1] ?? ""].join(" ").replace(/\s+/g, " ");
    const nums = extractNumbers(merged);
    if (nums.length < 3) continue;

    const isAdditional =
      /\bAdditional\s+Benchmark\b/i.test(merged) ||
      /\bAdd['’]?l\.?\s+Benchmark\b/i.test(merged);
    if (isAdditional) continue;

    const isBenchmark =
      !foundFund || foundFund
        ? /\b(?:Benchmark|S&P|BSE|NIFTY|Nifty|CRISIL|MSCI|FTSE|Sensex|TRI)\b/i.test(
            merged
          ) && !/\bFund\s+Manager\b/i.test(merged)
        : false;
    const isFundLine =
      !foundFund &&
      (/\bNAV\b/i.test(merged) ||
        /\bFund\b/i.test(merged) ||
        /\bScheme\b/i.test(merged));

    if (!foundFund && isFundLine && !isBenchmark) {
      fundNums = nums;
      foundFund = true;
      continue;
    }
    if (foundFund && !foundBenchmark && isBenchmark) {
      benchmarkNums = nums;
      foundBenchmark = true;
      break;
    }
  }

  if (!foundFund && !foundBenchmark) return null;

  return {
    s1Y: fundNums[0] ?? null,
    s3Y: fundNums[1] ?? null,
    s5Y: fundNums[2] ?? null,
    b1Y: benchmarkNums[0] ?? null,
    b3Y: benchmarkNums[1] ?? null,
    b5Y: benchmarkNums[2] ?? null,
  };
}

/** Walk the section text from the marker forward and find the
 *  scheme title — the first non-header line starting with the
 *  brand prefix that isn't boilerplate. Used by AMCs that print
 *  the scheme name INSIDE the performance section (Nippon style)
 *  rather than in the page header (HDFC style). */
function detectSchemeTitleAfterMarker(
  sectionText: string,
  strategy: AmcStrategy
): string | null {
  const lines = sectionText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Skip the marker line itself (usually first line of the section).
  for (let i = 1; i < Math.min(lines.length, 12); i++) {
    const l = lines[i];
    if (!strategy.schemeBrandPrefix.test(l)) continue;
    if (strategy.isBoilerplate(l)) continue;
    if (looksLikeParagraph(l)) continue;
    const cleaned = l
      .replace(/\(An\s+open[-\s]ended.*$/i, "")
      .replace(/\(Open[-\s]ended.*$/i, "")
      .replace(/[\^*#$]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned || cleaned.length > 80) continue;
    if (
      !/\b(?:Fund|Scheme|Plan|ELSS|Advantage|Opportunit|Saver|Pension|FoF)\b/i.test(
        cleaned
      )
    )
      continue;
    return cleaned;
  }
  return null;
}

function detectSchemeTitleCandidate(
  headerText: string,
  strategy: AmcStrategy
): string | null {
  const lines = headerText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!strategy.schemeBrandPrefix.test(l)) continue;
    if (strategy.isBoilerplate(l)) continue;
    if (looksLikeParagraph(l)) continue;
    const cleaned = l
      .replace(/\(An\s+open[-\s]ended.*$/i, "")
      .replace(/\(Open[-\s]ended.*$/i, "")
      .replace(/[\^*#$]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned) continue;
    if (cleaned.length > 80) continue;
    if (
      !/\b(?:Fund|Scheme|Plan|ELSS|Advantage|Opportunit|Saver|Pension)\b/i.test(
        cleaned
      )
    )
      continue;
    return cleaned;
  }
  return null;
}

function detectCategoryHintLine(headerText: string): string | null {
  const lines = headerText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/An\s+open[-\s]ended/i.test(l)) return l;
    if (
      /\b(?:large|mid|small|flexi|multi|focused|sectoral|thematic|elss|hybrid|arbitrage|conservative|aggressive|equity\s+saving|balanced|advantage|retirement|children|liquid|overnight|gilt|corporate\s+bond|credit\s+risk|index|etf|fund\s+of\s+fund|low\s+duration|short\s+duration|medium\s+duration|long\s+duration|ultra\s+short|money\s+market|floater|banking\s+(?:and|&)\s+psu|dynamic\s+(?:bond|asset))\b/i.test(
        l
      )
    ) {
      return l;
    }
  }
  return null;
}

function detectBenchmarkName(pageText: string): BenchmarkDetection {
  const lines = pageText.split(/\n+/).map((l) => l.trim());
  const RE_PRIMARY_HASH = /^#(?!#)\s*BENCHMARK(?:\s+INDEX)?\b/i;
  const RE_PRIMARY_NO_HASH = /^BENCHMARK\s+INDEX\b/i;
  const RE_ADDITIONAL_HASH =
    /^##\s*(?:ADDL\.?|ADDITIONAL)\s*\.?\s*BENCHMARK(?:\s+INDEX)?\b/i;
  const RE_ADDITIONAL_NO_HASH =
    /^(?:ADDL\.?|ADDITIONAL)\s*\.?\s*BENCHMARK(?:\s+INDEX)?\b/i;
  const RE_LEGACY_PRIMARY =
    /^#(?!#)\s+(?=.*\b(?:NIFTY|Nifty|S&P|BSE|CRISIL|MSCI|FTSE|Sensex)\b)/;
  const RE_LEGACY_ADDITIONAL =
    /^##\s+(?=.*\b(?:NIFTY|Nifty|S&P|BSE|CRISIL|MSCI|FTSE|Sensex)\b)/;
  const RE_PROSE_PRIMARY =
    /^(?:Benchmark\s+Index|Scheme\s+Benchmark)\s*[:\-]\s*/i;

  let primary: string | null = null;
  let additional: string | null = null;
  let snippetStart = -1;
  let snippetEnd = -1;

  const trackSnippet = (i: number) => {
    if (snippetStart === -1) snippetStart = Math.max(0, i - 1);
    snippetEnd = Math.max(snippetEnd, Math.min(lines.length, i + 4));
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const prev1 = lines[i - 1] ?? "";

    if (
      !additional &&
      (RE_ADDITIONAL_HASH.test(l) ||
        RE_LEGACY_ADDITIONAL.test(l) ||
        RE_ADDITIONAL_NO_HASH.test(l))
    ) {
      let stripped: string;
      if (RE_ADDITIONAL_HASH.test(l)) stripped = l.replace(RE_ADDITIONAL_HASH, "");
      else if (RE_ADDITIONAL_NO_HASH.test(l))
        stripped = l.replace(RE_ADDITIONAL_NO_HASH, "");
      else stripped = l.replace(/^##\s+/, "");
      additional = extractBenchmarkAfterMarker(stripped, lines, i);
      trackSnippet(i);
      continue;
    }

    if (!primary) {
      let stripped: string | null = null;
      if (RE_PRIMARY_HASH.test(l)) {
        stripped = l.replace(RE_PRIMARY_HASH, "");
      } else if (RE_PRIMARY_NO_HASH.test(l)) {
        const prev2 = lines[i - 2] ?? "";
        const additionalCueAbove =
          /^##/.test(prev1) ||
          /\b(?:ADDL\.?|ADDITIONAL)\b/i.test(prev1) ||
          /^##/.test(prev2) ||
          /\b(?:ADDL\.?|ADDITIONAL)\b/i.test(prev2);
        if (!additionalCueAbove) stripped = l.replace(RE_PRIMARY_NO_HASH, "");
      } else if (RE_LEGACY_PRIMARY.test(l)) {
        stripped = l.replace(/^#\s+/, "");
      } else if (RE_PROSE_PRIMARY.test(l)) {
        stripped = l.replace(RE_PROSE_PRIMARY, "");
      }
      if (stripped !== null) {
        primary = extractBenchmarkAfterMarker(stripped, lines, i);
        trackSnippet(i);
      }
    }

    if (primary && additional) break;
  }

  const headerSnippet =
    snippetStart === -1
      ? ""
      : lines.slice(snippetStart, snippetEnd).join("\n").slice(0, 600);

  return { primary, additional, headerSnippet };
}

function extractBenchmarkAfterMarker(
  inline: string,
  lines: string[],
  idx: number
): string | null {
  const inlineRest = inline.replace(/##.*$/, "").replace(/[:\-]\s*/, "").trim();
  if (inlineRest && RE_BENCHMARK_TOKEN.test(inlineRest)) {
    return cleanBenchmarkLabel(inlineRest);
  }
  for (let j = idx + 1; j < Math.min(idx + 4, lines.length); j++) {
    const next = lines[j];
    if (!next) continue;
    if (/^#/.test(next)) break;
    if (RE_BENCHMARK_TOKEN.test(next)) return cleanBenchmarkLabel(next);
  }
  return null;
}

function cleanBenchmarkLabel(s: string): string {
  return s
    .replace(/^[-–:]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeParagraph(name: string): boolean {
  if (
    /\b(?:however|due\s+to|moderated|widened|narrowed|outflows|increased|decreased)\b/i.test(
      name
    )
  )
    return true;
  if (/\bFY\d{2}\b|\bUSD\b|\bBoP\b|\bYoY\b|\b9MFY/i.test(name)) return true;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 12;
}

function extractNumbers(line: string): (number | null)[] {
  const matches = line.match(RE_CAGR) ?? [];
  return matches.map((m) => parseNumberLoose(m.replace("%", "")));
}

function outperformed(
  scheme: number | null,
  benchmark: number | null
): boolean | null {
  if (scheme === null || benchmark === null) return null;
  return scheme > benchmark;
}

function dedupeRows(
  entries: ParsedSchemeRowWithContext[]
): ParsedSchemeRowWithContext[] {
  const stemFor = (n: string) =>
    n
      .replace(/[\s-]*(?:Direct|Regular)\s*Plan?[\s-]*/i, " ")
      .replace(/[\s-]*(?:Growth|IDCW|Dividend)\s*Option?[\s-]*/i, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const seen = new Map<string, ParsedSchemeRowWithContext>();
  for (const entry of entries) {
    const stem = stemFor(entry.row.schemeName);
    const prev = seen.get(stem);
    if (!prev) {
      seen.set(stem, entry);
      continue;
    }
    const score = (x: ParsedSchemeRow) =>
      [x.schemeReturn1Y, x.schemeReturn3Y, x.schemeReturn5Y].filter(
        (v) => v !== null
      ).length + (/\bDirect\b/i.test(x.schemeName) ? 0.5 : 0);
    if (score(entry.row) > score(prev.row)) seen.set(stem, entry);
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Fetcher — Playwright-driven listing-page scrape + PDF download.
// Universal: parameterised by the strategy's pdfHrefPattern + period
// extractor. Each AMC's listing page is shaped slightly differently
// but they all surface a list of <a href="...factsheet....pdf"> links.
// ---------------------------------------------------------------------------

interface FetchResult {
  buffer: Buffer;
  sourceUrl: string;
  sourceFile: string;
  periodHint: string | null;
}

const T = {
  totalKill: 600_000,
  pageGoto: 25_000,
  waitListing: 12_000,
  pdfDownload: 60_000,
};

export async function fetchLatestFactsheetPdf(
  strategy: AmcStrategy,
  browser: Browser,
  cacheDir: string,
  requestedPeriod: string | null = null
): Promise<FetchResult | null> {
  let ctx;
  try {
    ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
  } catch (err) {
    warn(`${strategy.amcSlug}: browser.newContext failed: ${(err as Error).message}`);
    return null;
  }
  const page: Page = await ctx.newPage();

  try {
    info(`${strategy.amcSlug}: opening listing ${strategy.listingUrl}`);
    const resp = await page.goto(strategy.listingUrl, {
      waitUntil: "domcontentloaded",
      timeout: T.pageGoto,
    });
    if (!resp || !resp.ok()) {
      warn(
        `${strategy.amcSlug}: listing HTTP ${resp?.status() ?? "no-response"}`
      );
      return null;
    }
    if (strategy.waitListingSelector) {
      await page
        .waitForSelector(strategy.waitListingSelector, {
          timeout: T.waitListing,
        })
        .catch(() => {});
    } else {
      // Generic wait — let any anchor tag render.
      await page.waitForSelector("a[href]", { timeout: T.waitListing }).catch(() => {});
    }

    const links = await page.evaluate((patternSrc: string) => {
      const re = new RegExp(patternSrc, "i");
      const out: { href: string; text: string }[] = [];
      const els = document.querySelectorAll("a[href]");
      els.forEach((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href;
        if (!re.test(href)) return;
        if (!/\.pdf(?:$|\?)/i.test(href)) return;
        out.push({ href, text: (a.textContent || "").trim() });
      });
      return out;
    }, strategy.pdfHrefPattern.source);

    info(`${strategy.amcSlug}: ${links.length} factsheet PDF link(s) found`);
    if (links.length === 0) {
      warn(`${strategy.amcSlug}: no factsheet PDF links on listing page`);
      return null;
    }

    const dated = links
      .map((l) => {
        const fromHref = strategy.periodFromHref(l.href);
        const fromText = strategy.periodFromLinkText
          ? strategy.periodFromLinkText(l.text)
          : null;
        return { ...l, period: fromHref ?? fromText ?? null };
      })
      .sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));

    let candidate: (typeof dated)[number] | undefined;
    if (requestedPeriod) {
      candidate = dated.find((l) => l.period === requestedPeriod);
      if (!candidate) {
        warn(
          `${strategy.amcSlug}: no factsheet PDF for requested period "${requestedPeriod}". Available: [${dated
            .map((l) => l.period ?? "—")
            .slice(0, 8)
            .join(", ")}]`
        );
        return null;
      }
    } else {
      candidate = dated[0];
    }
    info(`${strategy.amcSlug}: chosen ${candidate.href} (period=${candidate.period})`);

    const dlResp = await ctx.request.get(candidate.href, {
      timeout: T.pdfDownload,
    });
    if (!dlResp.ok()) {
      warn(`${strategy.amcSlug}: PDF download HTTP ${dlResp.status()}`);
      return null;
    }
    const buffer = Buffer.from(await dlResp.body());
    info(`${strategy.amcSlug}: downloaded ${buffer.length} bytes`);

    await fs.mkdir(cacheDir, { recursive: true });
    const filename = `${candidate.period ?? "unknown"}.pdf`;
    const sourceFile = path.join(cacheDir, filename);
    await fs.writeFile(sourceFile, buffer);
    info(`${strategy.amcSlug}: cached to ${sourceFile}`);

    return {
      buffer,
      sourceUrl: candidate.href,
      sourceFile,
      periodHint: candidate.period,
    };
  } catch (err) {
    warn(`${strategy.amcSlug}: ${(err as Error).message}`);
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function loadLocalPdf(localPath: string): Promise<FetchResult | null> {
  try {
    const buffer = await fs.readFile(localPath);
    const periodMatch = path.basename(localPath).match(/(\d{4})-(\d{2})/);
    return {
      buffer,
      sourceUrl: localPath,
      sourceFile: localPath,
      periodHint: periodMatch ? `${periodMatch[1]}-${periodMatch[2]}` : null,
    };
  } catch (err) {
    warn(
      `factsheet: cannot read local PDF "${localPath}": ${(err as Error).message}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// runFactsheetStrategy — the main entry point. Given a strategy +
// browser + (optional) requested period, fetch the latest factsheet
// PDF, parse it, and return an AmcAuditResult.
// ---------------------------------------------------------------------------

export async function runFactsheetStrategy(
  strategy: AmcStrategy,
  browser: Browser | null,
  opts: {
    requestedPeriod?: string | null;
    localPdfPath?: string | null;
    cacheDir: string;
  }
): Promise<AmcAuditResult> {
  const fetchedAt = nowIso();
  const baseFailed = (
    failureReason: string,
    sourceUrl: string | null = null,
    sourceFile: string | null = null
  ): AmcAuditResult => ({
    amcSlug: strategy.amcSlug,
    amcName: strategy.amcName,
    source: "AMC factsheet",
    sourceUrl,
    sourceFile,
    periodEnd: null,
    fetchedAt,
    status: "failed",
    parsedSchemeCount: 0,
    eligibleSchemeCount1Y: 0,
    eligibleSchemeCount3Y: 0,
    eligibleSchemeCount5Y: 0,
    outperformingSchemeCount1Y: 0,
    outperformingSchemeCount3Y: 0,
    outperformingSchemeCount5Y: 0,
    outperformancePct1Y: null,
    outperformancePct3Y: null,
    outperformancePct5Y: null,
    candidateBlocksScanned: 0,
    performancePagesDetected: [],
    rejectedCandidateSamples: [],
    includedSchemes: [],
    excludedSchemes: [],
    warnings: [],
    notes: [failureReason],
    failureReason,
  });

  let fetched: FetchResult | null;
  if (opts.localPdfPath) {
    fetched = await loadLocalPdf(opts.localPdfPath);
    if (!fetched) {
      return baseFailed(
        `Local PDF override "${opts.localPdfPath}" could not be read.`,
        null,
        opts.localPdfPath
      );
    }
  } else {
    if (!browser) {
      return baseFailed(
        `Playwright not available; cannot fetch ${strategy.listingUrl}.`,
        strategy.listingUrl,
        null
      );
    }
    fetched = await fetchLatestFactsheetPdf(
      strategy,
      browser,
      opts.cacheDir,
      opts.requestedPeriod ?? null
    );
    if (!fetched) {
      return baseFailed(
        `Failed to fetch latest factsheet from ${strategy.listingUrl} (WAF / no matching link / network).`,
        strategy.listingUrl,
        null
      );
    }
  }

  // --- Parse PDF ---
  let pages: PdfPage[] = [];
  const parser = new PDFParse({ data: new Uint8Array(fetched.buffer) });
  try {
    const result = await parser.getText();
    pages = result.pages.map((p) => ({ num: p.num, text: p.text ?? "" }));
  } catch (err) {
    return baseFailed(
      `pdf-parse failed: ${(err as Error).message}`,
      fetched.sourceUrl,
      fetched.sourceFile
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  if (pages.length === 0) {
    return baseFailed(
      "pdf-parse returned 0 pages",
      fetched.sourceUrl,
      fetched.sourceFile
    );
  }

  info(`${strategy.amcSlug}: ${pages.length} page(s) parsed`);

  // --- Walk performance sections ---
  const sections = findPerformanceSections(pages, strategy);
  const allEntries: ParsedSchemeRowWithContext[] = [];
  const allWarnings: ParseWarning[] = [];
  const rejectedCandidateSamples: RejectedCandidate[] = [];
  const performancePages = new Set<number>();
  let candidateBlocksScanned = 0;
  for (const section of sections) {
    candidateBlocksScanned += 1;
    const parsed = parsePerformanceSection(section, strategy);
    if (parsed.row && parsed.context) {
      allEntries.push({ row: parsed.row, context: parsed.context });
      performancePages.add(section.pageNum);
      continue;
    }
    if (parsed.rejection && parsed.rejection.reason !== "sip-performance") {
      rejectedCandidateSamples.push(parsed.rejection);
    }
  }
  const rejectedCandidateSamplesCapped = rejectedCandidateSamples.slice(0, 20);
  const dedupedEntries = dedupeRows(allEntries);

  // --- Eligibility filter ---
  const included: ParsedSchemeRow[] = [];
  const excluded: ExcludedScheme[] = [];
  let benchmarkNameFallbackCount = 0;
  for (const entry of dedupedEntries) {
    const r = entry.row;
    if (!r.categorySlug) {
      excluded.push({
        schemeName: r.schemeName,
        reason: "category-unknown",
        pageNum: r.pageNum,
      });
      continue;
    }
    if (!ELIGIBLE_SLUGS.has(r.categorySlug)) {
      excluded.push({
        schemeName: r.schemeName,
        reason: "category-excluded",
        categorySlug: r.categorySlug,
        category: r.category ?? undefined,
        pageNum: r.pageNum,
      });
      continue;
    }
    const hasAnySchemeReturn =
      r.schemeReturn1Y !== null ||
      r.schemeReturn3Y !== null ||
      r.schemeReturn5Y !== null;
    const hasAnyBenchmarkReturn =
      r.benchmarkReturn1Y !== null ||
      r.benchmarkReturn3Y !== null ||
      r.benchmarkReturn5Y !== null;
    if (!hasAnySchemeReturn) {
      excluded.push({
        schemeName: r.schemeName,
        reason: "missing-returns",
        categorySlug: r.categorySlug,
        category: r.category ?? undefined,
        pageNum: r.pageNum,
      });
      continue;
    }
    if (!hasAnyBenchmarkReturn) {
      excluded.push({
        schemeName: r.schemeName,
        reason: "missing-benchmark",
        categorySlug: r.categorySlug,
        category: r.category ?? undefined,
        pageNum: r.pageNum,
        detectedSchemeTitleCandidate:
          entry.context.detectedSchemeTitleCandidate ?? undefined,
        pageHeaderSnippet: entry.context.pageHeaderSnippet,
        benchmarkHeaderSnippet: entry.context.benchmarkHeaderSnippet,
        detectedPrimaryBenchmarkCandidate:
          entry.context.detectedPrimaryBenchmarkCandidate,
        detectedAdditionalBenchmarkCandidate:
          entry.context.detectedAdditionalBenchmarkCandidate,
      });
      continue;
    }
    if (!r.benchmarkName) {
      benchmarkNameFallbackCount += 1;
      r.benchmarkName = "Primary benchmark";
    }
    included.push(r);
  }

  const elig = (period: Period) => {
    const sKey = `schemeReturn${period}` as const;
    const bKey = `benchmarkReturn${period}` as const;
    const eligible = included.filter((r) => r[sKey] !== null && r[bKey] !== null);
    const beat = eligible.filter((r) => r[sKey]! > r[bKey]!);
    const pct =
      eligible.length > 0
        ? Math.round((beat.length / eligible.length) * 1000) / 10
        : null;
    return { eligibleN: eligible.length, beatN: beat.length, pct };
  };
  const e1 = elig("1Y");
  const e3 = elig("3Y");
  const e5 = elig("5Y");

  // --- periodEnd from page-text first ---
  let periodEnd: string | null = null;
  const months =
    "january february march april may june july august september october november december".split(
      " "
    );
  for (let p = 0; p < Math.min(5, pages.length); p++) {
    const m = pages[p].text.match(
      /\b(?:as\s+(?:on|of)\s+)?(?:\d{1,2}\s*(?:st|nd|rd|th)?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
    );
    if (m) {
      const idx = months.indexOf(m[1].toLowerCase());
      if (idx >= 0) {
        periodEnd = `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
        break;
      }
    }
  }
  if (!periodEnd) periodEnd = fetched.periodHint;

  const status: AmcAuditResult["status"] =
    included.length === 0 ? "failed" : included.length < 10 ? "partial" : "ok";

  const notes: string[] = [
    `Eligibility = IIFL active-equity envelope (Sub II + Sub III ex-Arbitrage + Sub IV).`,
    `Outperformance = scheme return > primary benchmark return for the period; null on either side drops the scheme from that period's denominator.`,
    `Direct + Regular plan dedup applied; one row per scheme stem.`,
    `Parser anchors on "PERFORMANCE ^" section marker; "SIP PERFORMANCE" siblings rejected upstream.`,
    `Per-row extraction: each table row is a TIME PERIOD ("Last 1 Year" / "Last 3 Years" / "Last 5 Years"); row's first three CAGR numbers are (scheme %, benchmark %, additional %).`,
  ];
  if (benchmarkNameFallbackCount > 0) {
    notes.push(
      `${benchmarkNameFallbackCount} scheme(s) included with benchmarkName="Primary benchmark" — period rows yielded scheme + benchmark return numbers, but the page-level "#BENCHMARK INDEX" legend was not detected by the walker. Outperformance math is unaffected.`
    );
  }

  // Diagnostics — populated when the PDF parsed but no PERFORMANCE
  // markers matched (i.e. the strategy's marker regexes are wrong
  // for this AMC's section header phrasing). Lets the next iteration
  // see the actual page text without a re-run.
  let diagnostics: PdfDiagnostics | undefined;
  let failureReason: string | undefined;
  if (candidateBlocksScanned === 0 && pages.length > 0) {
    diagnostics = buildPdfDiagnostics(pages, strategy);
    failureReason = `PDF parsed (${pages.length} pages) but found 0 PERFORMANCE section markers. Strategy may need different performanceMarkerPatterns. See diagnostics.`;
    notes.push(failureReason);
  }

  info(
    `${strategy.amcSlug}: parsed=${dedupedEntries.length} included=${included.length} excluded=${excluded.length}; ` +
      `1Y ${e1.beatN}/${e1.eligibleN} (${e1.pct ?? "—"}%) · ` +
      `3Y ${e3.beatN}/${e3.eligibleN} (${e3.pct ?? "—"}%) · ` +
      `5Y ${e5.beatN}/${e5.eligibleN} (${e5.pct ?? "—"}%)`
  );

  return {
    amcSlug: strategy.amcSlug,
    amcName: strategy.amcName,
    source: "AMC factsheet",
    sourceUrl: fetched.sourceUrl,
    sourceFile: fetched.sourceFile,
    periodEnd,
    fetchedAt,
    status,
    parsedSchemeCount: dedupedEntries.length,
    eligibleSchemeCount1Y: e1.eligibleN,
    eligibleSchemeCount3Y: e3.eligibleN,
    eligibleSchemeCount5Y: e5.eligibleN,
    outperformingSchemeCount1Y: e1.beatN,
    outperformingSchemeCount3Y: e3.beatN,
    outperformingSchemeCount5Y: e5.beatN,
    outperformancePct1Y: e1.pct,
    outperformancePct3Y: e3.pct,
    outperformancePct5Y: e5.pct,
    candidateBlocksScanned,
    performancePagesDetected: Array.from(performancePages).sort((a, b) => a - b),
    rejectedCandidateSamples: rejectedCandidateSamplesCapped,
    includedSchemes: included,
    excludedSchemes: excluded,
    warnings: allWarnings,
    notes,
    failureReason,
    diagnostics,
  };
}

/** Walk every page's text and surface the lines that mention
 *  "performance" / "benchmark" / "returns", plus the lines starting
 *  with the AMC's brand prefix. The next strategy iteration uses
 *  this to target its marker patterns at the actual phrasing. */
function buildPdfDiagnostics(
  pages: PdfPage[],
  strategy: AmcStrategy
): PdfDiagnostics {
  const allLines: string[] = [];
  for (const p of pages) {
    p.text.split(/\n+/).forEach((l) => {
      const trimmed = l.trim();
      if (trimmed.length > 0) allLines.push(trimmed);
    });
  }

  const findLines = (re: RegExp, max = 20): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of allLines) {
      if (!re.test(l)) continue;
      const truncated = l.slice(0, 200);
      if (seen.has(truncated)) continue;
      seen.add(truncated);
      out.push(truncated);
      if (out.length >= max) break;
    }
    return out;
  };

  const performanceLines = findLines(/\bperformance\b/i);
  const benchmarkLines = findLines(/\bbenchmark\b/i);
  const returnsLines = findLines(/\breturns?\b/i);

  const schemeTitleCandidates: string[] = [];
  const seenTitles = new Set<string>();
  for (const l of allLines) {
    if (!strategy.schemeBrandPrefix.test(l)) continue;
    if (strategy.isBoilerplate(l)) continue;
    const truncated = l.slice(0, 200);
    if (seenTitles.has(truncated)) continue;
    seenTitles.add(truncated);
    schemeTitleCandidates.push(truncated);
    if (schemeTitleCandidates.length >= 20) break;
  }

  // First-page snippets — always include the first 3 pages.
  const firstPageSnippets = pages.slice(0, 3).map((p) => ({
    pageNum: p.num,
    snippet: p.text.slice(0, 800),
  }));
  // Strategy-defined extra range — useful when the AMC's
  // performance content lives in a known annexure (ICICI: pages
  // 115-125 hold "Annexure for Returns of all the Schemes"). Each
  // requested page is captured at 1600 chars (longer than the
  // default 800 since these ARE the interesting pages). Already-
  // included first-3 pages are deduped.
  const extraSnippets: { pageNum: number; snippet: string }[] = [];
  if (strategy.diagnosticsPageRange) {
    const [start, end] = strategy.diagnosticsPageRange;
    const seenPageNums = new Set(firstPageSnippets.map((s) => s.pageNum));
    for (const p of pages) {
      if (p.num < start || p.num > end) continue;
      if (seenPageNums.has(p.num)) continue;
      extraSnippets.push({ pageNum: p.num, snippet: p.text.slice(0, 1600) });
      seenPageNums.add(p.num);
    }
  }

  return {
    pageCount: pages.length,
    textExtractionStatus: pages.length > 0 ? "ok" : "empty",
    firstPageSnippets: [...firstPageSnippets, ...extraSnippets],
    performanceLines,
    benchmarkLines,
    returnsLines,
    schemeTitleCandidates,
  };
}
