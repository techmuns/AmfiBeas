/**
 * HDFC Mutual Fund — Scheme Outperformance PoC parser.
 *
 * Goal: read HDFC's monthly factsheet PDF, extract the SEBI-mandated
 * "Comparative Performance" rows (scheme + primary benchmark CAGR for
 * 1Y / 3Y / 5Y), filter to active equity / hybrid-ex-arbitrage /
 * solution categories, and compute the outperformance ratio per period.
 *
 * Output: a single debug JSON at
 *   manual-data/audit/hdfc-scheme-outperformance-poc.json
 *
 * No production snapshot is written. No UI is wired. This is a
 * one-AMC PoC to verify whether the factsheet is parseable and
 * whether the metric can be computed cleanly before scaling to the
 * other 6 top AMCs.
 *
 * ### Data source
 *
 * Listing page: https://www.hdfcfund.com/investor-services/factsheets
 * Observed PDF URL pattern (predictable):
 *   https://files.hdfcfund.com/s3fs-public/<YYYY-MM>/HDFC%20MF%20Factsheet%20-%20<Month>%20<Year>.pdf
 *
 * The HDFC origin sits behind a WAF that 403's plain curl/UAs from
 * non-browser hosts. In CI / on a dev machine with network access,
 * we drive Playwright (same pattern as scripts/ingest/amfi-aaum.ts):
 *  1. Navigate to the listing page
 *  2. Find every PDF link whose href looks like an HDFC factsheet
 *  3. Pick the most recent by `<Month> <Year>` text
 *  4. Download the PDF buffer with the same browser context (so the
 *     WAF cookie/UA carries over)
 *
 * ### Local override (sandbox / debug)
 *
 *   HDFC_FACTSHEET_PDF=/path/to/factsheet.pdf \
 *     npm run audit:hdfc-factsheet
 *
 * Skips the network entirely and parses the supplied PDF. Useful for
 * iterating on parser heuristics without round-tripping through the
 * WAF, and for testing inside the harness sandbox where hdfcfund.com
 * is on the host-not-allowed list.
 *
 * ### Other env vars (used by the workflow_dispatch GitHub Action)
 *
 *   HDFC_FACTSHEET_PERIOD=YYYY-MM
 *     Optional. When set, the listing scraper filters to PDFs whose
 *     URL contains the requested /YYYY-MM/ segment (publish month).
 *     Blank / unset → pick the most recent listed PDF.
 *
 *   HDFC_FACTSHEET_WRITE=0
 *     Skip writing the audit JSON file. Anything other than "0"
 *     (including unset) writes as normal.
 *
 * ### Eligibility (matches the IIFL active-equity envelope)
 *
 *   Sub II — Growth/Equity (all 11)
 *   Sub III — Hybrid EX-Arbitrage (5: Conservative Hybrid, Balanced/
 *     Aggressive Hybrid, BAF/DAA, Multi-Asset, Equity Savings)
 *   Sub IV — Solution (Retirement, Children's)
 *
 * Excludes: Sub I (Debt), Arbitrage, Sub V (Index/ETF/FoF).
 *
 * ### Outperformance rule
 *
 *   outperformed = schemeReturn > primaryBenchmarkReturn
 *
 * For each of 1Y / 3Y / 5Y. If either side is null (e.g. scheme < 5Y
 * old) the scheme is dropped from that period's denominator — never
 * counted as a non-outperformer.
 *
 * ### Parser strategy (PRs #84 → #85)
 *
 * Anchor on HDFC's literal section header — "PERFORMANCE ^ -
 * Regular Plan - Growth Option" — and reject "SIP PERFORMANCE"
 * siblings before parsing. The page header (text BEFORE the
 * marker) carries the scheme title and a category-hint line; the
 * section body is a row-major-by-time-period table whose rows are
 * "Last 1 Year" / "Last 3 Years" / "Last 5 Years" / "Since
 * Inception". Each row's first 3 CAGR-shaped numbers are
 * (scheme %, benchmark %, additional benchmark %); we keep scheme
 * + benchmark and discard the additional. The benchmark NAME
 * comes from the page-level "#" legend, not from any row.
 *
 * PR #84 wrongly assumed each row was a separate (scheme,
 * benchmark, additional) entity and read 1Y/3Y/5Y from columns —
 * that's the wrong table orientation. PR #85 fixes the
 * orientation and pulls the scheme title from the page header.
 *
 * Each rejected section is recorded under
 * `rejectedCandidateSamples` with its reason + the page-header
 * context + the title/category candidates so misses are easy to
 * triage without re-running.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type { Browser } from "playwright";
import { info, nowIso, parseNumberLoose, warn } from "./utils";

const LISTING_URL = "https://www.hdfcfund.com/investor-services/factsheets";

const T = {
  totalKill: 600_000,
  pageGoto: 25_000,
  waitListing: 12_000,
  pdfDownload: 60_000,
};

// ---------------------------------------------------------------------------
// Eligibility — same closed set the IIFL Active-Equity envelope uses
// (scripts/ingest/amfi-aaum.ts and src/data/types.ts).
// ---------------------------------------------------------------------------

type CategorySlug =
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
  // Excluded categories — kept in the slug map so we can label the
  // excluded reason precisely instead of "unknown".
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

interface CategorySpec {
  slug: CategorySlug;
  label: string;
  /** Match against the scheme-name line (case-insensitive). Order
   *  matters: more-specific patterns must come before less-specific
   *  ones so e.g. "Ultra Short Duration" beats "Short Duration". */
  re: RegExp;
}

// Eligibility set — IIFL active-equity envelope, 18 categories.
const ELIGIBLE_SLUGS = new Set<CategorySlug>([
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

// Ordered most-specific-first. The matcher walks this list in order
// and returns the FIRST hit, so e.g. "Ultra Short" must precede
// "Short", "Large & Mid" must precede "Large" / "Mid".
const CATEGORY_SPECS: CategorySpec[] = [
  // Excluded — passive / debt / arbitrage
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
  // Eligible — Growth/Equity
  { slug: "large-mid-cap", label: "Large & Mid Cap Fund", re: /\bLarge\s*(?:&|and)\s*Mid\s+Cap\b/i },
  { slug: "flexi-cap", label: "Flexi Cap Fund", re: /\bFlexi\s+Cap\b/i },
  { slug: "multi-cap", label: "Multi Cap Fund", re: /\bMulti\s+Cap\b/i },
  { slug: "large-cap", label: "Large Cap Fund", re: /\bLarge\s+Cap\b/i },
  { slug: "mid-cap", label: "Mid Cap Fund", re: /\bMid[\s-]?Cap\s+(?:Opportunit|Fund)/i },
  { slug: "small-cap", label: "Small Cap Fund", re: /\bSmall[\s-]?Cap\b/i },
  { slug: "dividend-yield", label: "Dividend Yield Fund", re: /\bDividend\s+Yield\b/i },
  { slug: "value-contra", label: "Value Fund / Contra Fund", re: /\b(?:Value\s+Fund|Contra\s+Fund|Capital\s+Builder\s+Value)\b/i },
  { slug: "focused", label: "Focused Fund", re: /\bFocused\b/i },
  { slug: "sectoral-thematic", label: "Sectoral / Thematic Fund", re: /\b(?:Banking\s+(?:&|and)\s+Financial|Pharma|Healthcare|Technology|Infrastructure|Defence|MNC|FMCG|Energy|Transportation|Logistics|Consumption|Business\s+Cycle|Manufacturing|PSU|Housing|Tax\s+Saver(?!\s*-?\s*ELSS))\b/i },
  { slug: "elss", label: "ELSS", re: /\b(?:ELSS|Tax[\s-]?Saver)\b/i },
  // Eligible — Hybrid (Arbitrage already matched above + excluded)
  { slug: "balanced-aggressive-hybrid", label: "Balanced / Aggressive Hybrid Fund", re: /\b(?:Balanced\s+Advantage|Aggressive\s+Hybrid|Balanced\s+Hybrid)\b/i },
  { slug: "baf-daa", label: "Dynamic Asset Allocation / BAF", re: /\b(?:Dynamic\s+Asset\s+Allocation|Dynamic\s+PE)\b/i },
  { slug: "conservative-hybrid", label: "Conservative Hybrid Fund", re: /\b(?:Conservative\s+Hybrid|Hybrid\s+Debt|Hybrid\s+Equity\s+Debt)\b/i },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund", re: /\bMulti[\s-]?Asset\b/i },
  { slug: "equity-savings", label: "Equity Savings Fund", re: /\bEquity\s+Savings?\b/i },
  // Eligible — Solution
  { slug: "retirement", label: "Retirement Fund", re: /\bRetirement\b/i },
  { slug: "childrens", label: "Children's Fund", re: /\bChildren'?s?\b.*\b(?:Fund|Gift)\b/i },
];

function classifyCategory(
  schemeName: string
): { slug: CategorySlug; label: string } | null {
  for (const spec of CATEGORY_SPECS) {
    if (spec.re.test(schemeName)) return { slug: spec.slug, label: spec.label };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface PdfPage {
  num: number;
  text: string;
}

interface ParsedSchemeRow {
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
  /** Page index (1-based) where the scheme was located. */
  pageNum: number;
  /** Raw text block we extracted numbers from — useful to debug
   *  parser misses without re-running. */
  textSnippet: string;
}

interface ExcludedScheme {
  schemeName: string;
  reason:
    | "category-excluded"
    | "category-unknown"
    | "missing-returns"
    | "missing-benchmark";
  categorySlug?: CategorySlug;
  category?: string;
  pageNum?: number;
}

interface ParseWarning {
  pageNum?: number;
  message: string;
}

/** Per-section diagnostic shown in the audit JSON when a candidate
 *  PERFORMANCE block was found but rejected before reaching the
 *  eligibility filter. Helps triage parser misses without re-running. */
interface RejectedCandidate {
  pageNum: number;
  reason:
    | "sip-performance"
    | "no-hdfc-scheme-line"
    | "no-benchmark-line"
    | "no-scheme-numbers"
    | "no-period-rows"
    | "scheme-name-too-long"
    | "scheme-name-paragraph";
  /** First ~240 chars of the section text, useful to eyeball the
   *  rejection reason. */
  textSnippet: string;
  /** First ~800 chars of the page (above the PERFORMANCE marker) —
   *  this is where the scheme title and category typically live. */
  pageHeaderSnippet?: string;
  /** ~800 chars immediately before the PERFORMANCE marker (most
   *  recent context). */
  textBeforePerformance?: string;
  /** What the scheme-title walker locked onto (or null if nothing). */
  detectedSchemeTitleCandidate?: string | null;
  /** What the category-from-title classifier returned (or null). */
  detectedCategoryCandidate?: string | null;
}

// Benchmark index tokens — used to validate the "#" legend hits
// and to recognise inline benchmark mentions on a page.
const RE_BENCHMARK_TOKEN = /\b(?:NIFTY|S&P\s*BSE|BSE\s+\d|CRISIL|MSCI|FTSE|Sensex)\b/i;

// CAGR number regex — decimals only. Rejects integer scheme codes
// ("1", "10") and PIN codes. Accepts "-1.50%" / "12.34" / "1,234.56".
const RE_CAGR = /-?\d{1,3}(?:,\d{3})*\.\d{1,2}\s*%?/g;

// HDFC's per-scheme PERFORMANCE block is anchored by a literal
// header line:
//   "PERFORMANCE ^ - Regular Plan - Growth Option"
// and then SIP-PERFORMANCE later on the same page reads
//   "SIP PERFORMANCE ^ - Regular Plan - Growth Option".
// We anchor on /\bPERFORMANCE\b/ but reject when the marker is
// preceded by "SIP" within the prior ~12 chars on the same line.
const RE_PERFORMANCE_MARKER = /\bPERFORMANCE\s*\^?/g;

interface PerformanceSection {
  pageNum: number;
  /** The section's full text — from this marker to the next
   *  (PERFORMANCE / SIP-PERFORMANCE / page end). */
  text: string;
  /** Page text BEFORE the PERFORMANCE marker. The scheme title and
   *  category live here in HDFC factsheets. */
  pageHeaderText: string;
  /** Full page text — used to locate the # / ## benchmark legend
   *  (the legend can appear EITHER above or below the table). */
  pageFullText: string;
  isSip: boolean;
}

/** Walk every page; for each `PERFORMANCE` marker hit, define a
 *  section that runs until the next marker or the page end. Each
 *  per-scheme HDFC factsheet page typically yields exactly two
 *  sections — the regular performance block and the SIP block —
 *  and we reject the SIP block before parsing. */
function findPerformanceSections(pages: PdfPage[]): PerformanceSection[] {
  const out: PerformanceSection[] = [];
  for (const p of pages) {
    const text = p.text;
    const markers: { idx: number; isSip: boolean }[] = [];
    RE_PERFORMANCE_MARKER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_PERFORMANCE_MARKER.exec(text)) !== null) {
      // SIP / SCHEME context check: look at up to 16 chars BEFORE
      // the marker on the same line. "SIP " = SIP block.
      const head = text
        .slice(Math.max(0, m.index - 16), m.index)
        .replace(/[\r]/g, "")
        .split("\n")
        .pop()!;
      const isSip = /\bSIP\s*$/i.test(head);
      markers.push({ idx: m.index, isSip });
    }
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].idx;
      const end = i + 1 < markers.length ? markers[i + 1].idx : text.length;
      out.push({
        pageNum: p.num,
        text: text.slice(start, end),
        pageHeaderText: text.slice(0, start),
        pageFullText: text,
        isSip: markers[i].isSip,
      });
    }
  }
  return out;
}

interface ParsedSection {
  /** Set when a clean (scheme, benchmark) pair was extracted. */
  row?: ParsedSchemeRow;
  /** Set when the section was rejected. */
  rejection?: RejectedCandidate;
}

const PERIOD_LABELS = {
  "1Y": /^Last\s+1\s+Year\b/i,
  "3Y": /^Last\s+3\s+Years?\b/i,
  "5Y": /^Last\s+5\s+Years?\b/i,
} as const;

type Period = "1Y" | "3Y" | "5Y";

/** HDFC's per-scheme PERFORMANCE block (March 2026 audit confirms):
 *
 *    [page header — usually scheme title + category line]
 *    HDFC <Fund Name>
 *    <Category Label>
 *    ...
 *    PERFORMANCE ^ - Regular Plan - Growth Option
 *    Date Period
 *    Scheme Returns (%)        Benchmark Returns (%)#   Additional Benchmark Returns (%)##
 *    Value of ₹ 10,000 invested
 *    Scheme (₹)  Benchmark (₹)#  Additional Benchmark (₹)##
 *    Mar 31, 25  Last 1 Year   <s%>  <b%>  <a%>  <s₹>  <b₹>  <a₹>
 *    Mar 31, 23  Last 3 Years  <s%>  <b%>  <a%>  ...
 *    Mar 31, 21  Last 5 Years  <s%>  <b%>  <a%>  ...
 *    SI         Since Inception <s%>  <b%>  <a%>  ...
 *    SIP PERFORMANCE ^ - ...
 *
 *  Earlier PoC assumed each row was scheme/benchmark/additional and
 *  read the 1Y/3Y/5Y values from columns. WRONG — HDFC's table is
 *  row-major by TIME PERIOD; each row carries (scheme%, benchmark%,
 *  additional%, scheme₹, benchmark₹, additional₹) for ONE period.
 *
 *  Per-row extraction (PR #85):
 *    schemeReturn1Y    = first CAGR number on the "Last 1 Year" row
 *    benchmarkReturn1Y = second CAGR number on the "Last 1 Year" row
 *    (third = additional benchmark — discarded)
 *    Same for 3Y / 5Y rows.
 *
 *  Scheme title / category come from the page header (above the
 *  marker). Benchmark name comes from the "#" legend, which may
 *  appear above OR below the table. */
function parsePerformanceSection(section: PerformanceSection): ParsedSection {
  if (section.isSip) {
    return {
      rejection: {
        pageNum: section.pageNum,
        reason: "sip-performance",
        textSnippet: section.text.slice(0, 240),
      },
    };
  }

  // ---- Scheme title & category from the page header ----
  const titleCandidate = detectSchemeTitleCandidate(section.pageHeaderText);
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

  if (!titleCandidate) {
    return { rejection: baseRejection("no-hdfc-scheme-line") };
  }
  if (titleCandidate.length > 80) {
    return { rejection: baseRejection("scheme-name-too-long") };
  }
  if (looksLikeParagraph(titleCandidate)) {
    return { rejection: baseRejection("scheme-name-paragraph") };
  }

  // ---- Walk the table body for "Last N Year(s)" rows ----
  const lines = section.text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const periodRows: Partial<
    Record<Period, { line: string; nums: (number | null)[] }>
  > = {};

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // The pdf-parse output sometimes puts "Mar 31, 25 Last 1 Year"
    // as the row prefix; the period label may be at the START or
    // AFTER a date prefix. Normalise by stripping a leading date.
    const stripped = l.replace(
      /^[A-Z][a-z]{2}\s+\d{1,2},\s*\d{2,4}\s+/,
      ""
    );
    for (const [period, re] of Object.entries(PERIOD_LABELS) as [
      Period,
      RegExp,
    ][]) {
      if (periodRows[period]) continue;
      if (!re.test(stripped)) continue;
      // Numbers on this row may spill onto the next 1-2 lines (pdf-
      // parse often wraps wide tables). Concatenate up to 3 lines.
      const merged = [l, lines[i + 1] ?? "", lines[i + 2] ?? ""]
        .join(" ")
        .replace(/\s+/g, " ");
      const nums = extractNumbers(merged);
      if (nums.length === 0) continue;
      periodRows[period] = { line: merged, nums };
      break; // one period per line
    }
  }

  if (
    !periodRows["1Y"] &&
    !periodRows["3Y"] &&
    !periodRows["5Y"]
  ) {
    return { rejection: baseRejection("no-period-rows") };
  }

  // Each row's first 3 numbers are (scheme%, benchmark%, additional%).
  // We keep scheme + benchmark and discard additional. Rows with
  // fewer than 3 numbers are unreliable (some columns may be N.A.
  // and pdf-parse silently drops them) — treat scheme/benchmark
  // as null rather than guessing at column position.
  const pickPair = (
    nums: (number | null)[]
  ): [number | null, number | null] =>
    nums.length >= 3 ? [nums[0] ?? null, nums[1] ?? null] : [null, null];
  const [s1Y, b1Y] = pickPair(periodRows["1Y"]?.nums ?? []);
  const [s3Y, b3Y] = pickPair(periodRows["3Y"]?.nums ?? []);
  const [s5Y, b5Y] = pickPair(periodRows["5Y"]?.nums ?? []);

  if (s1Y === null && s3Y === null && s5Y === null) {
    return { rejection: baseRejection("no-scheme-numbers") };
  }
  if (b1Y === null && b3Y === null && b5Y === null) {
    return { rejection: baseRejection("no-benchmark-line") };
  }

  // ---- Benchmark name from the "#" legend on the page ----
  const benchmarkName = detectBenchmarkName(section.pageFullText);

  // ---- Category — first try the title regex; fall back to scanning
  // the page header for a category-label line. ----
  const cls =
    classifyCategory(titleCandidate) ??
    classifyCategory(detectCategoryHintLine(section.pageHeaderText) ?? "");

  const row: ParsedSchemeRow = {
    schemeName: titleCandidate,
    schemeNameRaw: titleCandidate,
    category: cls?.label ?? null,
    categorySlug: cls?.slug ?? null,
    benchmarkName,
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
  return { row };
}

/** Walk the page-header text BACKWARD (closest to the PERFORMANCE
 *  marker first) and return the first plausible "HDFC <Fund Name>"
 *  scheme title. Rejects HDFC boilerplate (Asset Management /
 *  Trustee / Bank Limited) and paragraph-y lines. */
function detectSchemeTitleCandidate(headerText: string): string | null {
  const lines = headerText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Walk from the END (closest to the PERFORMANCE marker).
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/^HDFC\s/.test(l)) continue;
    if (isHdfcBoilerplate(l)) continue;
    if (looksLikeParagraph(l)) continue;
    // Strip trailing markers (^, ##, $, etc) and trailing labels
    // like "(An open-ended..." — keep just the fund name.
    const cleaned = l
      .replace(/\(An\s+open[-\s]ended.*$/i, "")
      .replace(/\(Open[-\s]ended.*$/i, "")
      .replace(/[\^*#$]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned) continue;
    if (cleaned.length > 80) continue;
    // Must look like an actual fund name — contains "Fund" / "Plan"
    // / "Scheme" / "ELSS" somewhere.
    if (!/\b(?:Fund|Scheme|Plan|ELSS|Advantage|Opportunit|Saver)\b/i.test(cleaned))
      continue;
    return cleaned;
  }
  return null;
}

/** Look at the page header for a likely SEBI-category label line —
 *  e.g. "An open-ended equity scheme predominantly investing in
 *  large cap stocks". Returns the line text so the caller can run
 *  classifyCategory() against it. */
function detectCategoryHintLine(headerText: string): string | null {
  const lines = headerText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/An\s+open[-\s]ended/i.test(l)) return l;
    if (/\b(?:large|mid|small|flexi|multi|focused|sectoral|thematic|elss|hybrid|arbitrage|conservative|aggressive|equity\s+saving|balanced|advantage|retirement|children|liquid|overnight|gilt|corporate\s+bond|credit\s+risk|index|etf|fund\s+of\s+fund|low\s+duration|short\s+duration|medium\s+duration|long\s+duration|ultra\s+short|money\s+market|floater|banking\s+(?:and|&)\s+psu|dynamic\s+(?:bond|asset))\b/i.test(
      l
    )) {
      return l;
    }
  }
  return null;
}

/** Look for the HDFC "#" legend that names the primary benchmark.
 *  Examples seen in HDFC factsheets:
 *    "# NIFTY 500 TRI"
 *    "# NIFTY Smallcap 250 TRI Index"
 *    "# Benchmark: NIFTY 500 TRI"
 *    "Benchmark Index: NIFTY 500 TRI"
 *
 *  We try a few patterns and return the first hit. The "##" legend
 *  is the additional benchmark and is ignored. */
function detectBenchmarkName(pageText: string): string | null {
  const candidatePatterns = [
    // Lines beginning with a single "#" followed by a benchmark name.
    /^\s*#\s*(?!#)([^\n]{3,80})$/m,
    // "# Benchmark: <name>" / "Benchmark Index: <name>" / "Scheme
    // Benchmark: <name>".
    /(?:^|\n)\s*(?:Benchmark\s+Index|Scheme\s+Benchmark|#\s*Benchmark)\s*[:\-]\s*([^\n]{3,80})/i,
  ];
  for (const re of candidatePatterns) {
    const m = pageText.match(re);
    if (!m) continue;
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    if (!RE_BENCHMARK_TOKEN.test(raw)) continue; // must contain a real index token
    return raw
      .replace(/^\s*[-–]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return null;
}

/** Reject HDFC strings that start with "HDFC " but are not scheme
 *  names — banner footer text, contact lines, etc. */
function isHdfcBoilerplate(line: string): boolean {
  return /\bHDFC\s+(?:Asset\s+Management|AMC|Mutual\s+Fund\s+Investor|Trustee|Bank\s+Limited|Limited)\b/i.test(
    line
  );
}

/** Reject scheme names that are clearly paragraph text (Market
 *  Review false positives etc). Tells "HDFC Flexi Cap Fund" apart
 *  from "HDFC <fund> performance increased due to ...". */
function looksLikeParagraph(name: string): boolean {
  if (/\b(?:however|due\s+to|moderated|widened|narrowed|outflows|increased|decreased)\b/i.test(name)) return true;
  if (/\bFY\d{2}\b|\bUSD\b|\bBoP\b|\bYoY\b|\b9MFY/i.test(name)) return true;
  // HDFC scheme names are usually < 8 words; flag anything noticeably longer.
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 12;
}

/** Extract every CAGR-shaped number from a row in left-to-right
 *  order. RE_CAGR requires a decimal, so the comma-separated
 *  rupee figures in the "Value of Rs 10,000 invested" columns
 *  (e.g. "11,234") never match. The first 3 hits per period row
 *  are reliably (scheme%, benchmark%, additional%). */
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

function dedupeRows(rows: ParsedSchemeRow[]): ParsedSchemeRow[] {
  // Direct + Regular plans share the same scheme + benchmark returns
  // (rounded). Keep one row per "scheme stem" — i.e. drop the trailing
  // "- Direct"/"- Regular" + "Growth"/"IDCW" suffixes for the dedup key.
  const stemFor = (n: string) =>
    n
      .replace(/[\s-]*(?:Direct|Regular)\s*Plan?[\s-]*/i, " ")
      .replace(/[\s-]*(?:Growth|IDCW|Dividend)\s*Option?[\s-]*/i, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const seen = new Map<string, ParsedSchemeRow>();
  for (const r of rows) {
    const stem = stemFor(r.schemeName);
    // Keep the row with the most non-null returns; tie-break on Direct
    // (since SEBI's preferred default for performance reporting).
    const prev = seen.get(stem);
    if (!prev) {
      seen.set(stem, r);
      continue;
    }
    const score = (x: ParsedSchemeRow) =>
      [x.schemeReturn1Y, x.schemeReturn3Y, x.schemeReturn5Y].filter(
        (v) => v !== null
      ).length +
      (/\bDirect\b/i.test(x.schemeName) ? 0.5 : 0);
    if (score(r) > score(prev)) seen.set(stem, r);
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

interface AuditOutput {
  source: "HDFC Mutual Fund factsheet";
  sourceUrl: string | null;
  sourceFile: string | null;
  /** "YYYY-MM" — preferred from page-1 / footer text ("March 2026"
   *  → "2026-03"). Falls back to the URL publish-folder month
   *  ("/s3fs-public/2026-04/...") only when no scanned text gives
   *  us a month. */
  periodEnd: string | null;
  fetchedAt: string;
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
  /** Diagnostics — see RejectedCandidate above. */
  candidateBlocksScanned: number;
  performancePagesDetected: number[];
  rejectedCandidateSamples: RejectedCandidate[];
  includedSchemes: ParsedSchemeRow[];
  excludedSchemes: ExcludedScheme[];
  warnings: ParseWarning[];
  notes: string[];
  status: "ok" | "partial" | "failed";
}

// ---------------------------------------------------------------------------
// Fetcher (Playwright path; only runs when no local PDF override)
// ---------------------------------------------------------------------------

interface FetchResult {
  buffer: Buffer;
  sourceUrl: string;
  sourceFile: string;
  periodHint: string | null;
}

async function fetchLatestFactsheet(
  cacheDir: string,
  requestedPeriod?: string | null
): Promise<FetchResult | null> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    warn(`hdfc-factsheet: playwright unavailable: ${(err as Error).message}`);
    return null;
  }

  let browser: Browser | null = null;
  const killTimer = setTimeout(() => {
    warn(`hdfc-factsheet: total timeout (${T.totalKill}ms) — closing browser`);
    if (browser) browser.close().catch(() => {});
  }, T.totalKill);

  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    const page = await ctx.newPage();

    info(`hdfc-factsheet: opening listing ${LISTING_URL}`);
    const resp = await page.goto(LISTING_URL, {
      waitUntil: "domcontentloaded",
      timeout: T.pageGoto,
    });
    if (!resp || !resp.ok()) {
      warn(`hdfc-factsheet: listing HTTP ${resp?.status() ?? "no-response"}`);
      return null;
    }

    // Wait for any factsheet link to appear in the DOM. The listing
    // page renders link nodes server-side, but we still wait so the
    // first hydration + XHR-supplied "latest" links are in place.
    await page
      .waitForSelector('a[href*="HDFC%20MF%20Factsheet"], a[href*="HDFC MF Factsheet"]', {
        timeout: T.waitListing,
      })
      .catch(() => {});

    const links = await page.evaluate(() => {
      const out: { href: string; text: string }[] = [];
      const els = document.querySelectorAll("a[href]");
      els.forEach((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href;
        if (!/HDFC.{0,3}MF.{0,3}Factsheet/i.test(href)) return;
        if (!/\.pdf(?:$|\?)/i.test(href)) return;
        out.push({ href, text: (a.textContent || "").trim() });
      });
      return out;
    });
    info(`hdfc-factsheet: ${links.length} factsheet PDF link(s) found`);

    if (links.length === 0) {
      warn(`hdfc-factsheet: no factsheet PDF links on listing page`);
      return null;
    }

    // Tag every link with its YYYY-MM segment from the URL —
    // `/s3fs-public/<YYYY-MM>/HDFC...pdf`. When the workflow input
    // pins a specific period, filter to that one; otherwise sort
    // descending and take the most recent.
    const dated = links
      .map((l) => {
        const m = l.href.match(/\/(\d{4})-(\d{2})\//);
        const period = m ? `${m[1]}-${m[2]}` : null;
        return { ...l, period };
      })
      .sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));

    let candidate: (typeof dated)[number] | undefined;
    if (requestedPeriod) {
      candidate = dated.find((l) => l.period === requestedPeriod);
      if (!candidate) {
        warn(
          `hdfc-factsheet: no factsheet PDF found for requested period "${requestedPeriod}". Available: [${dated
            .map((l) => l.period ?? "—")
            .slice(0, 8)
            .join(", ")}]`
        );
        return null;
      }
      info(`hdfc-factsheet: pinned to period=${requestedPeriod} → ${candidate.href}`);
    } else {
      candidate = dated[0];
      info(`hdfc-factsheet: latest = ${candidate.href} (period=${candidate.period})`);
    }
    const latest = candidate;

    // Download the PDF using the same browser context so the WAF
    // cookie + UA carry over.
    const dlResp = await ctx.request.get(latest.href, {
      timeout: T.pdfDownload,
    });
    if (!dlResp.ok()) {
      warn(`hdfc-factsheet: PDF download HTTP ${dlResp.status()}`);
      return null;
    }
    const buffer = Buffer.from(await dlResp.body());
    info(`hdfc-factsheet: downloaded ${buffer.length} bytes`);

    // Cache to disk so a follow-up run with HDFC_FACTSHEET_PDF can
    // reuse it. The dir is gitignored.
    await fs.mkdir(cacheDir, { recursive: true });
    const filename = `${latest.period ?? "unknown"}.pdf`;
    const sourceFile = path.join(cacheDir, filename);
    await fs.writeFile(sourceFile, buffer);
    info(`hdfc-factsheet: cached to ${sourceFile}`);

    return {
      buffer,
      sourceUrl: latest.href,
      sourceFile,
      periodHint: latest.period,
    };
  } catch (err) {
    warn(`hdfc-factsheet: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(killTimer);
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

async function loadLocalPdf(localPath: string): Promise<FetchResult | null> {
  try {
    const buffer = await fs.readFile(localPath);
    const periodMatch = path.basename(localPath).match(/(\d{4})-(\d{2})/);
    return {
      buffer,
      sourceUrl: null as unknown as string,
      sourceFile: localPath,
      periodHint: periodMatch ? `${periodMatch[1]}-${periodMatch[2]}` : null,
    };
  } catch (err) {
    warn(`hdfc-factsheet: cannot read local PDF "${localPath}": ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export async function ingestHdfcFactsheetPoc(): Promise<void> {
  info("=== amc-factsheet-hdfc (PoC) ===");
  const fetchedAt = nowIso();
  const cacheDir = path.resolve(process.cwd(), "manual-data/factsheets/hdfc");
  const auditDir = path.resolve(process.cwd(), "manual-data/audit");
  const auditFile = path.join(auditDir, "hdfc-scheme-outperformance-poc.json");

  const localOverride = process.env.HDFC_FACTSHEET_PDF;
  // Workflow inputs: blank period → "latest"; HDFC_FACTSHEET_WRITE="0" → no write.
  const requestedPeriod = (process.env.HDFC_FACTSHEET_PERIOD ?? "").trim() || null;
  const shouldWrite = (process.env.HDFC_FACTSHEET_WRITE ?? "1") !== "0";
  if (requestedPeriod) info(`hdfc-factsheet: pinned period = ${requestedPeriod}`);
  if (!shouldWrite) info(`hdfc-factsheet: write disabled (HDFC_FACTSHEET_WRITE=0)`);

  const fetched = localOverride
    ? await loadLocalPdf(localOverride)
    : await fetchLatestFactsheet(cacheDir, requestedPeriod);

  if (!fetched) {
    const failed: AuditOutput = {
      source: "HDFC Mutual Fund factsheet",
      sourceUrl: localOverride ? null : LISTING_URL,
      sourceFile: localOverride ?? null,
      periodEnd: null,
      fetchedAt,
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
      notes: [
        localOverride
          ? `Local PDF override "${localOverride}" could not be read.`
          : "Failed to fetch latest factsheet — Playwright could not reach the HDFC listing page (WAF / network). Re-run with HDFC_FACTSHEET_PDF=/path/to/file.pdf to parse a local PDF.",
      ],
      status: "failed",
    };
    if (shouldWrite) {
      await fs.mkdir(auditDir, { recursive: true });
      await fs.writeFile(auditFile, JSON.stringify(failed, null, 2) + "\n", "utf8");
      info(`hdfc-factsheet: wrote ${auditFile} (failed)`);
    } else {
      info(`hdfc-factsheet: write disabled — would have written ${auditFile} (failed)`);
    }
    return;
  }

  // ---- Parse PDF ----
  let pages: PdfPage[] = [];
  const parser = new PDFParse({ data: new Uint8Array(fetched.buffer) });
  try {
    const result = await parser.getText();
    pages = result.pages.map((p) => ({ num: p.num, text: p.text ?? "" }));
  } catch (err) {
    warn(`hdfc-factsheet: pdf-parse failed — ${(err as Error).message}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  if (pages.length === 0) {
    const failed: AuditOutput = {
      source: "HDFC Mutual Fund factsheet",
      sourceUrl: fetched.sourceUrl,
      sourceFile: fetched.sourceFile,
      periodEnd: fetched.periodHint,
      fetchedAt,
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
      notes: ["pdf-parse returned 0 pages."],
      status: "failed",
    };
    if (shouldWrite) {
      await fs.mkdir(auditDir, { recursive: true });
      await fs.writeFile(auditFile, JSON.stringify(failed, null, 2) + "\n", "utf8");
      info(`hdfc-factsheet: wrote ${auditFile} (failed: 0 pages)`);
    } else {
      info(`hdfc-factsheet: write disabled — would have written ${auditFile} (failed: 0 pages)`);
    }
    return;
  }

  info(`hdfc-factsheet: ${pages.length} page(s) parsed`);

  // ---- Section-anchored extraction ----
  // PR #82's first heuristic walked every block on every page —
  // which produced false positives from Market Review prose and the
  // FUND DETAILS ANNEXURE allocation tables (any text with 3+
  // numbers got parsed as a scheme). PR #84 anchors on HDFC's
  // literal "PERFORMANCE ^ - Regular Plan - Growth Option" marker
  // and rejects "SIP PERFORMANCE" siblings before parsing — both
  // signals are stable across HDFC factsheet months.
  const sections = findPerformanceSections(pages);
  const allRows: ParsedSchemeRow[] = [];
  const allWarnings: ParseWarning[] = [];
  const rejectedCandidateSamples: RejectedCandidate[] = [];
  const performancePages = new Set<number>();
  let candidateBlocksScanned = 0;
  for (const section of sections) {
    candidateBlocksScanned += 1;
    const parsed = parsePerformanceSection(section);
    if (parsed.row) {
      allRows.push(parsed.row);
      performancePages.add(section.pageNum);
      continue;
    }
    if (parsed.rejection) {
      // Don't store the SIP rejections in the diagnostic samples —
      // they're predictable and would dominate the array. We still
      // count them via candidateBlocksScanned.
      if (parsed.rejection.reason !== "sip-performance") {
        rejectedCandidateSamples.push(parsed.rejection);
      }
    }
  }
  // Cap diagnostic samples so the audit JSON stays small.
  const rejectedCandidateSamplesCapped = rejectedCandidateSamples.slice(0, 20);

  const deduped = dedupeRows(allRows);

  // ---- Eligibility filter + period-specific denominators ----
  const included: ParsedSchemeRow[] = [];
  const excluded: ExcludedScheme[] = [];
  for (const r of deduped) {
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
    if (!r.benchmarkName) {
      excluded.push({
        schemeName: r.schemeName,
        reason: "missing-benchmark",
        categorySlug: r.categorySlug,
        category: r.category ?? undefined,
        pageNum: r.pageNum,
      });
      continue;
    }
    if (
      r.schemeReturn1Y === null &&
      r.schemeReturn3Y === null &&
      r.schemeReturn5Y === null
    ) {
      excluded.push({
        schemeName: r.schemeName,
        reason: "missing-returns",
        categorySlug: r.categorySlug,
        category: r.category ?? undefined,
        pageNum: r.pageNum,
      });
      continue;
    }
    included.push(r);
  }

  // Eligibility per period: scheme must have BOTH a scheme return AND
  // a benchmark return for that period. A scheme < 5Y old fails the
  // 5Y bucket's denominator.
  const elig = (period: "1Y" | "3Y" | "5Y") => {
    const sKey = `schemeReturn${period}` as const;
    const bKey = `benchmarkReturn${period}` as const;
    const eligible = included.filter((r) => r[sKey] !== null && r[bKey] !== null);
    const beat = eligible.filter((r) => r[sKey]! > r[bKey]!);
    const pct = eligible.length > 0
      ? Math.round((beat.length / eligible.length) * 1000) / 10 // 1 dp
      : null;
    return { eligibleN: eligible.length, beatN: beat.length, pct };
  };
  const e1 = elig("1Y");
  const e3 = elig("3Y");
  const e5 = elig("5Y");

  // ---- periodEnd inference ----
  // Prefer page-text. The factsheet's footer reads "<page#> | <Month>
  // <Year>" on every page; that's the actual reporting period. The
  // URL folder ("/s3fs-public/2026-04/...") is the PUBLISH month —
  // typically one month after the reporting month — so it's a
  // last-resort fallback only.
  let periodEnd: string | null = null;
  const months = "january february march april may june july august september october november december".split(" ");
  // Scan up to first 5 pages for a "<Month> <Year>" or
  // "as on <DD> <Month> <Year>" hit.
  for (let p = 0; p < Math.min(5, pages.length); p++) {
    const text = pages[p].text;
    const m = text.match(
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
  // Fallback: URL folder month (publish month, typically lags the
  // reporting month by one).
  if (!periodEnd) periodEnd = fetched.periodHint;

  const status: AuditOutput["status"] =
    included.length === 0 ? "failed" : included.length < 10 ? "partial" : "ok";

  const out: AuditOutput = {
    source: "HDFC Mutual Fund factsheet",
    sourceUrl: fetched.sourceUrl,
    sourceFile: fetched.sourceFile,
    periodEnd: periodEnd ?? null,
    fetchedAt,
    parsedSchemeCount: deduped.length,
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
    notes: [
      "PoC — single-AMC, single-period audit. Not a production snapshot.",
      `Eligibility = IIFL active-equity envelope (Sub II + Sub III ex-Arbitrage + Sub IV).`,
      `Outperformance = scheme return > primary benchmark return for the period; null on either side drops the scheme from that period's denominator.`,
      `Direct + Regular plan dedup applied; one row per scheme stem.`,
      `Parser anchors on HDFC's literal "PERFORMANCE ^" section marker; "SIP PERFORMANCE" siblings are rejected upstream. Scheme title is detected from the page header (above the marker); benchmark name is detected from the page-level "#" legend.`,
      `Per-row extraction: each table row is a TIME PERIOD ("Last 1 Year" / "Last 3 Years" / "Last 5 Years"); the row's first three CAGR numbers are (scheme %, benchmark %, additional %). We keep scheme + benchmark.`,
    ],
    status,
  };

  info(
    `hdfc-factsheet: parsed=${deduped.length} included=${included.length} excluded=${excluded.length}; ` +
      `1Y ${e1.beatN}/${e1.eligibleN} (${e1.pct ?? "—"}%) · ` +
      `3Y ${e3.beatN}/${e3.eligibleN} (${e3.pct ?? "—"}%) · ` +
      `5Y ${e5.beatN}/${e5.eligibleN} (${e5.pct ?? "—"}%)`
  );
  if (shouldWrite) {
    await fs.mkdir(auditDir, { recursive: true });
    await fs.writeFile(auditFile, JSON.stringify(out, null, 2) + "\n", "utf8");
    info(`hdfc-factsheet: wrote ${auditFile}`);
  } else {
    info(`hdfc-factsheet: write disabled — would have written ${auditFile}`);
  }
}

// Self-invoke when run via `tsx scripts/ingest/amc-factsheet-hdfc.ts`.
const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return /amc-factsheet-hdfc\.ts$/.test(argv1);
  } catch {
    return false;
  }
})();
if (isMain) {
  ingestHdfcFactsheetPoc().catch((err) => {
    warn(`hdfc-factsheet: fatal — ${(err as Error).message}`);
    process.exit(1);
  });
}
