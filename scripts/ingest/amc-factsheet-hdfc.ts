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
  reason: "category-excluded" | "category-unknown" | "missing-returns";
  categorySlug?: CategorySlug;
  category?: string;
  pageNum?: number;
}

interface ParseWarning {
  pageNum?: number;
  message: string;
}

// Heuristic: a scheme name line is one that mentions "Fund" / "Plan" /
// "Scheme" and is NOT a benchmark line (NIFTY / BSE / S&P / CRISIL).
const RE_BENCHMARK = /\b(?:NIFTY|S&P\s*BSE|BSE\s+\d|CRISIL|MSCI|FTSE)\b/i;
const RE_SCHEME_TOKEN = /\b(?:Fund|Plan|Scheme|ELSS|Direct|Regular|Growth|IDCW)\b/i;

// Regex for a CAGR/percentage number — accepts e.g. "12.34", "12.3%",
// "-1.5", "1,234.56" (rare). Rejects bare integers like "1" / "10"
// (those are scheme codes / sequence numbers in factsheets).
const RE_CAGR = /-?\d{1,3}(?:,\d{3})*\.\d{1,2}\s*%?/g;

/** Split a page's text into logical blocks. We use double-newlines
 *  and form-feeds as block boundaries; pdf-parse preserves both for
 *  multi-column tables. */
function splitBlocks(pageText: string): string[] {
  return pageText
    .split(/\n{2,}|\f/)
    .map((b) => b.replace(/[\r]+/g, "").trim())
    .filter((b) => b.length > 0);
}

/** Walk a block's lines and try to extract a (scheme, benchmark)
 *  pair with 1Y/3Y/5Y returns. Returns null if the block doesn't
 *  look like a comparative-performance entry.
 *
 *  Approach: find the FIRST line containing 3+ CAGR numbers; treat
 *  it as the scheme returns row. The line(s) before it carry the
 *  scheme name; the line immediately after with 3+ CAGR numbers and
 *  a benchmark token is the benchmark row.
 *
 *  HDFC factsheets are born-digital with a clean text layer, so
 *  pdf-parse tends to emit one row per visual table line. This
 *  heuristic is the most permissive shape that still distinguishes
 *  "scheme returns" from random numeric rows. */
function tryParseSchemeBlock(
  block: string,
  pageNum: number
): { row: ParsedSchemeRow; warnings: ParseWarning[] } | null {
  const lines = block
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  // Locate the first numeric-heavy line (≥ 3 CAGR-like numbers).
  let numericIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(RE_CAGR);
    if (matches && matches.length >= 3) {
      numericIdx = i;
      break;
    }
  }
  if (numericIdx === -1) return null;
  const schemeNumLine = lines[numericIdx];

  // Walk backwards to assemble the scheme name. Skip empty lines and
  // lines that look like column headers ("Scheme Returns (%)" etc).
  const namePieces: string[] = [];
  for (let i = numericIdx - 1; i >= 0 && namePieces.length < 4; i--) {
    const l = lines[i];
    if (!l) continue;
    if (RE_BENCHMARK.test(l)) break; // hit prior benchmark row → stop
    if (/^[A-Z][A-Z\s%()]+$/.test(l) && !/Fund|Plan|Scheme/i.test(l)) continue; // header noise
    namePieces.unshift(l);
    // A clean "Fund" / "Plan" suffix usually means we have the full name.
    if (RE_SCHEME_TOKEN.test(l) && /Fund|Scheme|Plan/i.test(l)) break;
  }
  const schemeNameRaw = namePieces.join(" ").replace(/\s+/g, " ").trim();
  if (!schemeNameRaw) return null;
  if (!RE_SCHEME_TOKEN.test(schemeNameRaw)) return null;

  // Look for the benchmark line immediately after — first line with
  // a benchmark token AND ≥ 3 CAGR-like numbers.
  let benchmarkIdx = -1;
  for (let i = numericIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!RE_BENCHMARK.test(l)) continue;
    const matches = l.match(RE_CAGR);
    if (matches && matches.length >= 3) {
      benchmarkIdx = i;
      break;
    }
  }

  const schemeNums = parseNumericLine(schemeNumLine);
  const warnings: ParseWarning[] = [];

  let benchmarkName: string | null = null;
  let benchmarkNums: (number | null)[] = [];
  if (benchmarkIdx !== -1) {
    const bLine = lines[benchmarkIdx];
    benchmarkNums = parseNumericLine(bLine);
    benchmarkName = bLine
      .replace(RE_CAGR, "")
      .replace(/\s+/g, " ")
      .trim();
  } else {
    warnings.push({
      pageNum,
      message: `No benchmark row found for "${schemeNameRaw}" (page ${pageNum}).`,
    });
  }

  // Column ordering on HDFC's "Performance" appendix is consistently
  // (1Y, 3Y, 5Y, Since Inception). When fewer than 4 numbers appear,
  // we conservatively assume the leftmost is 1Y, then 3Y, then 5Y.
  const [s1Y, s3Y, s5Y] = pickFirstThree(schemeNums);
  const [b1Y, b3Y, b5Y] = pickFirstThree(benchmarkNums);

  const cls = classifyCategory(schemeNameRaw);

  const row: ParsedSchemeRow = {
    schemeName: schemeNameRaw,
    schemeNameRaw,
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
    pageNum,
    textSnippet: block.slice(0, 400),
  };
  return { row, warnings };
}

function parseNumericLine(line: string): (number | null)[] {
  const matches = line.match(RE_CAGR) ?? [];
  return matches.map((m) => parseNumberLoose(m.replace("%", "")));
}

function pickFirstThree(
  nums: (number | null)[]
): [number | null, number | null, number | null] {
  return [nums[0] ?? null, nums[1] ?? null, nums[2] ?? null];
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
  periodEnd: string | null; // "YYYY-MM" inferred from filename or page text
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

  // ---- Locate comparative-performance section + walk blocks ----
  const allRows: ParsedSchemeRow[] = [];
  const allWarnings: ParseWarning[] = [];
  for (const p of pages) {
    // SEBI-mandated sections vary by AMC; HDFC factsheet typically
    // titles them "Comparative Performance" or "Performance — Other
    // Schemes managed by ...". Be permissive — we don't gate on the
    // title; we just walk every block on every page and try the
    // scheme/benchmark heuristic. Blocks that don't match return null.
    const blocks = splitBlocks(p.text);
    for (const block of blocks) {
      const parsed = tryParseSchemeBlock(block, p.num);
      if (!parsed) continue;
      allRows.push(parsed.row);
      allWarnings.push(...parsed.warnings);
    }
  }

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
  let periodEnd = fetched.periodHint;
  if (!periodEnd) {
    // Try to infer "April 2025" / "31-Mar-2025" / "as on 28 February 2025" from page 1
    const head = pages[0]?.text ?? "";
    const m = head.match(/\b(?:as\s+(?:on|of)\s+)?(\d{1,2}\s+)?([A-Z][a-z]+)\s+(\d{4})\b/);
    if (m) {
      const monthName = m[2].toLowerCase();
      const months = "january february march april may june july august september october november december".split(" ");
      const idx = months.indexOf(monthName);
      if (idx >= 0) {
        periodEnd = `${m[3]}-${String(idx + 1).padStart(2, "0")}`;
      }
    }
  }

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
    includedSchemes: included,
    excludedSchemes: excluded,
    warnings: allWarnings,
    notes: [
      "PoC — single-AMC, single-period audit. Not a production snapshot.",
      `Eligibility = IIFL active-equity envelope (Sub II + Sub III ex-Arbitrage + Sub IV).`,
      `Outperformance = scheme return > primary benchmark return for the period; null on either side drops the scheme from that period's denominator.`,
      `Direct + Regular plan dedup applied; one row per scheme stem.`,
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
