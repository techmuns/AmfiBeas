/**
 * Phase 3.2H — Stage-1 production historical NAV backfill DRY RUN.
 *
 * Production-shaped backfill driver for the full matched universe (1,036 funds
 * from src/data/snapshots/mf-latest-nav.json) across the Stage-1 15-month
 * range, fetched from AMFI historical in 75-day chunks (the configuration
 * proven by Phase 3.2F). DRY RUN ONLY in this phase: writes the diagnostic
 * report + 5 representative sample files to data/debug/ (gitignored); does
 * NOT write to public/nav-history/, does NOT commit anything.
 *
 * Reuses the Phase 3.2E/3.2F header-driven parser (column map by NAME, not
 * position). Filter key: AMFI scheme code (already proven reliable).
 *
 * Run: npx tsx scripts/ingest/nav-history-backfill.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AMFI_HISTORY_BASE = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";
const LATEST_SNAPSHOT_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-history-backfill-dryrun-report.json");
const SAMPLE_DIR = path.resolve(REPORT_DIR, "sample-nav-history");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Stage-1 parameters (per Phase 3.2G design).
const STAGE = 1;
const TOTAL_MONTHS_BACK = 15;
const CHUNK_DAYS = 75;
const POLITE_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 120_000;
const RUN_DEADLINE_MS = 30 * 60_000;
const PER_WINDOW_MAX_RETRIES = 3;
const BACKOFF_MS = [5_000, 15_000, 45_000];

// Production guardrails. The dry-run STILL exits non-zero on guardrail failure,
// so the workflow's optional commit step (today defaulted to false) cannot fire
// on degraded data.
const GUARD = {
  minValidRowsPerWindow: 5_000,         // catches "AMFI returned a slice"
  minTotalValidRows: 50_000,            // sanity floor across the whole run
  minMatchedCoveragePct: 95,            // ≥95% of matched funds must have ≥1 valid point
  maxFailedWindows: 1,                  // Stage-1 has 7 windows → at most 1 failed
};

const RULE_VERSION = 1;
const PARSER_VERSION = 1;

// 5 representative sample funds for inspect-the-shape sample files. Picked to
// span large equity (Direct+Regular), index fund (override), ETF, hybrid.
const SAMPLE_PILOT_SCHEMECODES = [
  "21520", // Parag Parikh Flexi Cap Fund-Reg(G) — large equity (Regular)
  "1131",  // HDFC Flexi Cap Fund(G)             — large equity (Direct)
  "43811", // Motilal Oswal Nifty Smallcap 250 Index Fund-Reg(G) — Index (override)
  "33369", // SBI Nifty 50 ETF                   — ETF
  "1273",  // HDFC Balanced Advantage Fund(G)    — Hybrid
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  amfiSchemeName?: string;
  amfiAmcName?: string;
  isin: string | null;
  matchConfidence: string;
  hasHoldings: boolean;
}
interface LatestSnapshot { funds: SnapshotFund[] }

interface SeriesPoint { date: string; nav: number } // ISO YYYY-MM-DD

interface WindowResult {
  index: number;
  url: string;
  windowFrom: string; // DD-MMM-YYYY
  windowTo: string;
  requestedAt: string;
  attempts: number;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  responseMs: number;
  headerSeen: boolean;
  totalDataLines: number;
  validRowCount: number;
  skippedCount: number;
  targetRowsParsed: number;
  dateMin: string | null;
  dateMax: string | null;
  error?: string;
  failureReason?: string;
}

interface ReturnCell {
  value: number;
  kind: "simple";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
}

interface PerFundCoverage {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  isin: string | null;
  hasHoldings: boolean;
  points: number;
  firstDate: string | null;
  lastDate: string | null;
  latestNav: number | null;
  returns: Record<string, ReturnCell>;
  dataAvailability: { "1M": boolean; "3M": boolean; "6M": boolean; "1Y": boolean };
}

// ---------------------------------------------------------------------------
// Plan / option / classifier helpers (derived from fund-name)
// ---------------------------------------------------------------------------

type Plan = "direct" | "regular" | "unknown";
type Option = "growth" | "idcw" | "unknown";

function inferPlan(name: string): Plan {
  const s = name.toLowerCase();
  if (/-reg|\(reg\)|\bregular\b/.test(s)) return "regular";
  if (/-dir|\(dir\)|\bdirect\b/.test(s)) return "direct";
  // RupeeVest convention: "(G)" with no -Reg implies Direct plan.
  if (/\((g|idcw|dividend)\)/.test(s)) return "direct";
  return "unknown";
}
function inferOption(name: string): Option {
  const s = name.toLowerCase();
  if (/\b(idcw|dividend|div\b)/.test(s)) return "idcw";
  if (/\bgrowth\b|\((g|growth)\)/.test(s)) return "growth";
  return "unknown";
}
function isEtf(name: string, cls: string | null): boolean {
  return /\b(etf|exchange traded)\b/i.test(name) || (cls ?? "").includes("ETF");
}
function isFof(name: string, cls: string | null): boolean {
  return /\bfof\b|\bfund of funds?\b/i.test(name) || (cls ?? "").includes("FoFs");
}

// ---------------------------------------------------------------------------
// Date helpers (UTC, deterministic)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ddMMMyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function toDDMMMYYYY(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTH_ABBR[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
function utcShiftDays(daysBack: number, anchor = Date.now()): Date {
  return new Date(anchor - daysBack * 86_400_000);
}
function utcShiftMonths(monthsBack: number, anchor = Date.now()): Date {
  const d = new Date(anchor);
  const ny = d.getUTCFullYear();
  const nm = d.getUTCMonth() - monthsBack;
  const targetYear = ny + Math.floor(nm / 12);
  const targetMonth = ((nm % 12) + 12) % 12;
  const dim = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), dim);
  return new Date(Date.UTC(targetYear, targetMonth, day));
}
function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
function buildWindows(monthsBack: number, chunkDays: number): Array<{ from: Date; to: Date }> {
  const today = new Date();
  const earliest = utcShiftMonths(monthsBack);
  const wins: Array<{ from: Date; to: Date }> = [];
  let toDate = today;
  while (toDate > earliest) {
    const fromDate = new Date(Math.max(earliest.getTime(), toDate.getTime() - (chunkDays - 1) * 86_400_000));
    wins.push({ from: fromDate, to: toDate });
    toDate = utcShiftDays(1, fromDate.getTime());
  }
  return wins.reverse(); // oldest first → newer windows overwrite via last-write-wins
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// Fetch (with 3× exponential-backoff retry per window)
// ---------------------------------------------------------------------------

interface FetchOut {
  ok: boolean;
  status: number | null;
  text: string | null;
  contentType: string | null;
  bytes: number | null;
  requestedAt: string;
  attempts: number;
  error?: string;
  ms: number;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<Omit<FetchOut, "attempts">> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const requestedAt = new Date(t0).toISOString();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": USER_AGENT, accept: "text/plain,*/*" } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, contentType: res.headers.get("content-type"), bytes: text.length, requestedAt, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: null, text: null, contentType: null, bytes: null, requestedAt, error: (e as Error).message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

async function fetchWithRetry(url: string): Promise<FetchOut> {
  let last: Omit<FetchOut, "attempts"> = { ok: false, status: null, text: null, contentType: null, bytes: null, requestedAt: nowIso(), ms: 0, error: "no attempts made" };
  for (let i = 1; i <= PER_WINDOW_MAX_RETRIES; i++) {
    last = await fetchOnce(url, FETCH_TIMEOUT_MS);
    if (last.ok && last.text && last.text.length >= 200) return { ...last, attempts: i };
    if (i < PER_WINDOW_MAX_RETRIES) {
      const wait = BACKOFF_MS[i - 1] ?? 30_000;
      warn(`  attempt ${i} failed (${last.error ?? `HTTP ${last.status ?? "?"}`}); sleeping ${wait}ms before retry`);
      await sleep(wait);
    }
  }
  return { ...last, attempts: PER_WINDOW_MAX_RETRIES };
}

// ---------------------------------------------------------------------------
// Header-driven AMFI historical parser (verbatim from the proven 3.2E/F path)
// ---------------------------------------------------------------------------

const SECTION_LINE_RE = /^(Open|Close|Interval) Ended Schemes.*/i;
interface ColumnMap { schemeCode: number; schemeName: number; isinGrowth: number; isinReinv: number; nav: number; date: number }
function buildColumnMap(headerCells: string[]): ColumnMap | null {
  const idxOf = (re: RegExp) => headerCells.findIndex((c) => re.test(c));
  const isinIdxs = headerCells.map((c, i) => ({ c, i })).filter((x) => /isin/i.test(x.c)).map((x) => x.i);
  const dateIdxs = headerCells.map((c, i) => ({ c, i })).filter((x) => /date/i.test(x.c)).map((x) => x.i);
  const map: ColumnMap = {
    schemeCode: idxOf(/scheme\s*code/i),
    schemeName: idxOf(/scheme\s*name/i),
    isinGrowth: isinIdxs[0] ?? -1,
    isinReinv: isinIdxs[1] ?? -1,
    nav: idxOf(/net\s*asset\s*value/i),
    date: dateIdxs.length ? dateIdxs[dateIdxs.length - 1] : -1,
  };
  if (map.schemeCode < 0 || map.nav < 0 || map.date < 0) return null;
  return map;
}

interface ParseStats {
  headerSeen: boolean;
  columnMap: ColumnMap | null;
  totalDataLines: number;
  validRowCount: number;
  skippedCount: number;
  targetRowsParsed: number;
  dateMin: string | null;
  dateMax: string | null;
}

/** Parse + merge pilot rows into `into` (Map<code, Map<isoDate, nav>>), with
 *  per-(code, date) dedup via last-write-wins. */
function parseHistoricalInto(
  text: string,
  targetCodes: Set<number>,
  into: Map<number, Map<string, number>>
): ParseStats {
  let cm: ColumnMap | null = null;
  let headerSeen = false;
  let totalDataLines = 0, validRowCount = 0, skippedCount = 0, targetRows = 0;
  let dateMin: string | null = null, dateMax: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_LINE_RE.test(line)) continue;
    if (/^scheme\s*code/i.test(line)) {
      cm = buildColumnMap(line.split(";").map((s) => s.trim()));
      headerSeen = true;
      continue;
    }
    if (!line.includes(";")) continue;
    if (!cm) { skippedCount += 1; continue; }
    totalDataLines += 1;
    const parts = line.split(";").map((s) => s.trim());
    const code = Number(parts[cm.schemeCode]);
    if (!Number.isFinite(code)) { skippedCount += 1; continue; }
    const nav = Number(parts[cm.nav] ?? "");
    const iso = ddMMMyyyyToIso(parts[cm.date] ?? "");
    if (!Number.isFinite(nav) || nav <= 0 || iso === null) { skippedCount += 1; continue; }
    validRowCount += 1;
    if (!dateMin || iso < dateMin) dateMin = iso;
    if (!dateMax || iso > dateMax) dateMax = iso;
    if (!targetCodes.has(code)) continue;
    targetRows += 1;
    let series = into.get(code);
    if (!series) { series = new Map(); into.set(code, series); }
    series.set(iso, nav);
  }
  return { headerSeen, columnMap: cm, totalDataLines, validRowCount, skippedCount, targetRowsParsed: targetRows, dateMin, dateMax };
}

// ---------------------------------------------------------------------------
// Return computation (Stage-1: simple 1M/3M/6M/1Y only)
// ---------------------------------------------------------------------------

const PERIODS: Array<{ key: "1M" | "3M" | "6M" | "1Y"; months: number; years: number }> = [
  { key: "1M", months: 1, years: 0 },
  { key: "3M", months: 3, years: 0 },
  { key: "6M", months: 6, years: 0 },
  { key: "1Y", months: 0, years: 1 },
];

function nearestPrior(series: SeriesPoint[], target: string): SeriesPoint | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= target) return series[i];
  return null;
}

function computeReturns(series: SeriesPoint[]): {
  returns: Record<string, ReturnCell>;
  availability: { "1M": boolean; "3M": boolean; "6M": boolean; "1Y": boolean };
} {
  const returns: Record<string, ReturnCell> = {};
  const availability = { "1M": false, "3M": false, "6M": false, "1Y": false };
  if (series.length < 2) return { returns, availability };
  const end = series[series.length - 1];
  const firstDate = series[0].date;
  for (const p of PERIODS) {
    const target = subPeriod(end.date, p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start.nav <= 0) continue;
    returns[p.key] = {
      value: round2((end.nav / start.nav - 1) * 100),
      kind: "simple",
      startDate: start.date, startNav: start.nav,
      endDate: end.date, endNav: end.nav,
    };
    availability[p.key] = true;
  }
  return { returns, availability };
}

// ---------------------------------------------------------------------------
// Sample file builder (proposed final production schema; written to debug/)
// ---------------------------------------------------------------------------

interface SampleHistoryFile {
  meta: {
    schemecode: string;
    amfiSchemeCode: number;
    isin: string | null;
    fundName: string;
    amfiSchemeName: string | null;
    amfiAmcName: string | null;
    classification: string | null;
    plan: Plan;
    option: Option;
    isEtf: boolean;
    isFof: boolean;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
    stage: number;
    ruleVersion: number;
    parserVersion: number;
    generatedAt: string;
    lastForwardAppendAt: string | null;
    provenance: {
      backfillSource: string;
      backfillWindows: Array<{ from: string; to: string; fetchedAt: string }>;
      forwardSource: string;
      parser: string;
      parserVersion: number;
    };
  };
  series: Array<[string, number]>;
}

function buildSampleFile(
  fund: SnapshotFund,
  series: SeriesPoint[],
  windows: WindowResult[],
  generatedAt: string
): SampleHistoryFile {
  return {
    meta: {
      schemecode: fund.schemecode,
      amfiSchemeCode: fund.amfiSchemeCode,
      isin: fund.isin,
      fundName: fund.fundName,
      amfiSchemeName: fund.amfiSchemeName ?? null,
      amfiAmcName: fund.amfiAmcName ?? null,
      classification: fund.classification,
      plan: inferPlan(fund.fundName),
      option: inferOption(fund.fundName),
      isEtf: isEtf(fund.fundName, fund.classification),
      isFof: isFof(fund.fundName, fund.classification),
      firstDate: series[0]?.date ?? null,
      lastDate: series[series.length - 1]?.date ?? null,
      points: series.length,
      stage: STAGE,
      ruleVersion: RULE_VERSION,
      parserVersion: PARSER_VERSION,
      generatedAt,
      lastForwardAppendAt: null,
      provenance: {
        backfillSource: "AMFI DownloadNAVHistoryReport_Po.aspx",
        backfillWindows: windows
          .filter((w) => !w.error && w.validRowCount > 0)
          .map((w) => ({ from: w.windowFrom, to: w.windowTo, fetchedAt: w.requestedAt })),
        forwardSource: "AMFI NAVAll.txt (via scripts/ingest/nav-latest.ts) — to be wired in a later phase",
        parser: "scripts/ingest/nav-history-backfill.ts:parseHistoricalInto",
        parserVersion: PARSER_VERSION,
      },
    },
    series: series.map((p) => [p.date, p.nav]),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const runStart = Date.now();
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), LATEST_SNAPSHOT_PATH)}`);
  const snapshot = JSON.parse(await fs.readFile(LATEST_SNAPSHOT_PATH, "utf8")) as LatestSnapshot;
  const universe = snapshot.funds;
  info(`universe (matched funds in latest snapshot): ${universe.length}`);

  const codeToFund = new Map<number, SnapshotFund>();
  for (const f of universe) codeToFund.set(f.amfiSchemeCode, f);
  const targetCodes = new Set(universe.map((f) => f.amfiSchemeCode));

  const windows = buildWindows(TOTAL_MONTHS_BACK, CHUNK_DAYS);
  const requestedRangeFrom = toDDMMMYYYY(windows[0].from);
  const requestedRangeTo = toDDMMMYYYY(windows[windows.length - 1].to);
  info(`Stage-${STAGE} range: ${requestedRangeFrom} → ${requestedRangeTo}  ·  ${windows.length} windows × ${CHUNK_DAYS} days`);

  const seriesByCode = new Map<number, Map<string, number>>();
  const windowResults: WindowResult[] = [];
  let anyValidWindow = false;
  let totalValidRows = 0;
  let aborted = false;

  for (let i = 0; i < windows.length; i++) {
    if (Date.now() - runStart > RUN_DEADLINE_MS) {
      warn(`run deadline (${RUN_DEADLINE_MS / 60000} min) hit before window ${i + 1}; stopping`);
      aborted = true;
      break;
    }
    const w = windows[i];
    const windowFrom = toDDMMMYYYY(w.from);
    const windowTo = toDDMMMYYYY(w.to);
    const url = `${AMFI_HISTORY_BASE}?frmdt=${windowFrom}&todt=${windowTo}`;
    info(`[amfi] window ${i + 1}/${windows.length}  ${windowFrom} → ${windowTo}`);
    const res = await fetchWithRetry(url);

    const base: WindowResult = {
      index: i, url, windowFrom, windowTo,
      requestedAt: res.requestedAt, attempts: res.attempts,
      httpStatus: res.status, contentType: res.contentType, bytes: res.bytes, responseMs: res.ms,
      headerSeen: false, totalDataLines: 0, validRowCount: 0, skippedCount: 0, targetRowsParsed: 0,
      dateMin: null, dateMax: null,
    };
    if (!res.ok || !res.text || res.text.length < 200) {
      base.error = res.error ?? `HTTP ${res.status ?? "?"} (bytes=${res.bytes ?? 0})`;
      base.failureReason = res.error ? `network error after ${res.attempts} attempt(s): ${res.error}` : `HTTP ${res.status ?? "?"} after ${res.attempts} attempt(s)`;
      windowResults.push(base);
      info(`   FAIL ${base.failureReason}`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }

    let stats: ParseStats;
    try {
      stats = parseHistoricalInto(res.text, targetCodes, seriesByCode);
    } catch (e) {
      base.error = (e as Error).message;
      base.failureReason = `parser threw: ${(e as Error).message}`;
      windowResults.push(base);
      info(`   FAIL parser threw: ${(e as Error).message}`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    base.headerSeen = stats.headerSeen;
    base.totalDataLines = stats.totalDataLines;
    base.validRowCount = stats.validRowCount;
    base.skippedCount = stats.skippedCount;
    base.targetRowsParsed = stats.targetRowsParsed;
    base.dateMin = stats.dateMin;
    base.dateMax = stats.dateMax;
    if (stats.validRowCount > 0) { anyValidWindow = true; totalValidRows += stats.validRowCount; }
    windowResults.push(base);
    info(`   OK   bytes=${res.bytes} valid=${stats.validRowCount} skipped=${stats.skippedCount} targetRows=${stats.targetRowsParsed} dates=${stats.dateMin}..${stats.dateMax}`);

    await sleep(POLITE_DELAY_MS);
  }

  // --- Per-fund coverage & returns ------------------------------------------
  const perFundCoverage: PerFundCoverage[] = [];
  const fundsWithPoints: number[] = []; // amfiSchemeCodes that got ≥1 valid row
  for (const f of universe) {
    const byDate = seriesByCode.get(f.amfiSchemeCode) ?? new Map<string, number>();
    const dates = Array.from(byDate.keys()).sort();
    const series: SeriesPoint[] = dates.map((d) => ({ date: d, nav: byDate.get(d)! }));
    const firstDate = series[0]?.date ?? null;
    const lastDate = series[series.length - 1]?.date ?? null;
    const latestNav = lastDate ? byDate.get(lastDate) ?? null : null;
    const { returns, availability } = computeReturns(series);
    perFundCoverage.push({
      schemecode: f.schemecode, fundName: f.fundName, classification: f.classification,
      amfiSchemeCode: f.amfiSchemeCode, isin: f.isin, hasHoldings: f.hasHoldings,
      points: series.length, firstDate, lastDate, latestNav,
      returns, dataAvailability: availability,
    });
    if (series.length > 0) fundsWithPoints.push(f.amfiSchemeCode);
  }

  const matchedCoveragePct = round2((fundsWithPoints.length / universe.length) * 100);
  const periodCoverage = {
    "1M": perFundCoverage.filter((f) => f.dataAvailability["1M"]).length,
    "3M": perFundCoverage.filter((f) => f.dataAvailability["3M"]).length,
    "6M": perFundCoverage.filter((f) => f.dataAvailability["6M"]).length,
    "1Y": perFundCoverage.filter((f) => f.dataAvailability["1Y"]).length,
  };
  const fundsMissingHistory = perFundCoverage.filter((f) => f.points === 0).map((f) => ({
    schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, amfiSchemeCode: f.amfiSchemeCode,
  }));

  // --- Guardrails -----------------------------------------------------------
  const windowsOk = windowResults.filter((w) => !w.error && w.validRowCount > 0).length;
  const windowsFailed = windowResults.filter((w) => Boolean(w.error)).length;
  const guardFailures: string[] = [];
  for (const w of windowResults) {
    if (!w.error && w.validRowCount > 0 && w.validRowCount < GUARD.minValidRowsPerWindow) {
      guardFailures.push(`window ${w.index + 1} (${w.windowFrom}→${w.windowTo}) valid=${w.validRowCount} < floor ${GUARD.minValidRowsPerWindow}`);
    }
  }
  if (totalValidRows < GUARD.minTotalValidRows) {
    guardFailures.push(`totalValidRows ${totalValidRows} < floor ${GUARD.minTotalValidRows}`);
  }
  if (matchedCoveragePct < GUARD.minMatchedCoveragePct) {
    guardFailures.push(`matchedCoveragePct ${matchedCoveragePct} < floor ${GUARD.minMatchedCoveragePct}`);
  }
  if (windowsFailed > GUARD.maxFailedWindows) {
    guardFailures.push(`failed windows ${windowsFailed} > ceiling ${GUARD.maxFailedWindows}`);
  }
  if (aborted) guardFailures.push("run hit deadline before completing all windows");
  const guardPass = guardFailures.length === 0;

  // --- Sample files (Stage-1 dry run; written under data/debug only) --------
  await fs.mkdir(SAMPLE_DIR, { recursive: true });
  const sampleSummaries: Array<{ schemecode: string; fundName: string; path: string; points: number; firstDate: string | null; lastDate: string | null }> = [];
  for (const code of SAMPLE_PILOT_SCHEMECODES) {
    const fund = universe.find((f) => f.schemecode === code);
    if (!fund) continue;
    const byDate = seriesByCode.get(fund.amfiSchemeCode) ?? new Map<string, number>();
    const dates = Array.from(byDate.keys()).sort();
    const series: SeriesPoint[] = dates.map((d) => ({ date: d, nav: byDate.get(d)! }));
    const file = buildSampleFile(fund, series, windowResults, generatedAt);
    const out = path.join(SAMPLE_DIR, `${code}.json`);
    await fs.writeFile(out, JSON.stringify(file, null, 2) + "\n", "utf8");
    sampleSummaries.push({
      schemecode: code, fundName: fund.fundName,
      path: path.relative(process.cwd(), out),
      points: series.length,
      firstDate: file.meta.firstDate, lastDate: file.meta.lastDate,
    });
  }

  // --- Report ---------------------------------------------------------------
  const recommendation = buildRecommendation(guardPass, guardFailures, matchedCoveragePct, periodCoverage, universe.length);
  const verdict = {
    universeCount: universe.length,
    windowsAttempted: windowResults.length,
    windowsOk,
    windowsFailed,
    abortedEarly: aborted,
    totalValidRows,
    fundsWithAnyPoint: fundsWithPoints.length,
    fundsMissingHistoryCount: fundsMissingHistory.length,
    matchedCoveragePct,
    periodCoverage,
    guardPass,
    guardFailures,
  };

  const report = {
    meta: {
      generatedAt,
      dryRun: true,
      stage: STAGE,
      monthsBack: TOTAL_MONTHS_BACK,
      chunkDays: CHUNK_DAYS,
      politeDelayMs: POLITE_DELAY_MS,
      perWindowMaxRetries: PER_WINDOW_MAX_RETRIES,
      backoffMs: BACKOFF_MS,
      runDeadlineMinutes: RUN_DEADLINE_MS / 60_000,
      ruleVersion: RULE_VERSION,
      parserVersion: PARSER_VERSION,
      source: "AMFI historical (DownloadNAVHistoryReport_Po.aspx)",
      latestSnapshot: "src/data/snapshots/mf-latest-nav.json",
      note: "DRY RUN — writes only data/debug/. Production per-fund files (public/nav-history/) are NOT written. ISIN is diagnostic only; extraction is keyed on AMFI scheme code.",
    },
    requestedRange: { from: requestedRangeFrom, to: requestedRangeTo, windowCount: windows.length },
    guardrails: GUARD,
    verdict,
    windows: windowResults,
    universeCoverage: {
      universeCount: universe.length,
      fundsWithAnyPoint: fundsWithPoints.length,
      matchedCoveragePct,
      periodCoverage,
      fundsMissingHistorySample: fundsMissingHistory.slice(0, 50),
      fundsMissingHistoryTotal: fundsMissingHistory.length,
    },
    perFundCoverageSample: perFundCoverage.slice(0, 25),
    sampleFiles: sampleSummaries,
    recommendation,
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  let wrote = false;
  try {
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    wrote = true;
    info(`wrote ${path.relative(process.cwd(), REPORT_PATH)}`);
  } catch (e) {
    warn(`could not write report: ${(e as Error).message}`);
  }

  printSummary(verdict, windowResults, sampleSummaries, recommendation);

  // Exit non-zero if NO usable windows OR the report couldn't be written OR
  // guardrails failed. The workflow's optional commit step (today defaulted
  // false) does not fire in any of these cases.
  if (!wrote) process.exit(1);
  if (!anyValidWindow) { warn("no AMFI historical windows yielded usable rows"); process.exit(1); }
  if (!guardPass) { warn(`guardrails failed: ${guardFailures.join(" · ")}`); process.exit(1); }
}

function buildRecommendation(
  guardPass: boolean,
  guardFailures: string[],
  matchedCoveragePct: number,
  periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number },
  universeCount: number
): string {
  if (!guardPass) return `BLOCK: production guardrails failed (${guardFailures.join(" · ")}). Inspect window-level failureReason and per-fund coverage; do NOT promote this run to writing public/nav-history/.`;
  const oneY = periodCoverage["1Y"];
  if (matchedCoveragePct >= 99 && oneY >= Math.floor(universeCount * 0.95)) {
    return "PROCEED: Stage-1 dry-run is clean across the matched universe and ≥95% have 1Y coverage. Recommend the next phase (3.2I) — same script with commit=true to land public/nav-history/{schemecode}.json for Stage 1, with the existing keep-last-good rule.";
  }
  return `REVIEW: dry-run cleared guardrails (matchedCoveragePct=${matchedCoveragePct}%, 1Y coverage=${oneY}/${universeCount}), but the 1Y rate is below 95% of universe. Inspect fundsMissingHistorySample before promoting to a real backfill.`;
}

function printSummary(
  v: { universeCount: number; windowsAttempted: number; windowsOk: number; windowsFailed: number; abortedEarly: boolean; totalValidRows: number; fundsWithAnyPoint: number; fundsMissingHistoryCount: number; matchedCoveragePct: number; periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number }; guardPass: boolean; guardFailures: string[] },
  windows: WindowResult[],
  samples: Array<{ schemecode: string; fundName: string; path: string; points: number; firstDate: string | null; lastDate: string | null }>,
  recommendation: string
): void {
  info("======== STAGE-1 NAV HISTORY BACKFILL DRY-RUN SUMMARY =======");
  info(`Universe matched funds: ${v.universeCount}`);
  info(`Windows: attempted=${v.windowsAttempted} ok=${v.windowsOk} failed=${v.windowsFailed} aborted=${v.abortedEarly} totalValidRows=${v.totalValidRows}`);
  for (const w of windows) {
    const tag = w.error ? `ERR ${w.failureReason ?? w.error}` : `ok valid=${w.validRowCount} target=${w.targetRowsParsed} ${w.dateMin}..${w.dateMax}`;
    info(`   ${w.index + 1}: ${w.windowFrom}→${w.windowTo} attempts=${w.attempts} HTTP=${w.httpStatus ?? "-"} ct=${w.contentType ?? "-"} bytes=${w.bytes ?? "-"} ${w.responseMs}ms · ${tag}`);
  }
  info(`Universe coverage: ${v.fundsWithAnyPoint}/${v.universeCount} = ${v.matchedCoveragePct}% have ≥1 point; missing=${v.fundsMissingHistoryCount}`);
  info(`Period coverage (funds with availability): 1M=${v.periodCoverage["1M"]} 3M=${v.periodCoverage["3M"]} 6M=${v.periodCoverage["6M"]} 1Y=${v.periodCoverage["1Y"]}`);
  info(`Guardrails: ${v.guardPass ? "PASS" : "FAIL · " + v.guardFailures.join(" · ")}`);
  for (const s of samples) info(`   sample ${s.schemecode}: ${s.fundName}  pts=${s.points} ${s.firstDate ?? "-"}..${s.lastDate ?? "-"} → ${s.path}`);
  info(`Recommendation: ${recommendation}`);
  info("=============================================================");
  info(`Full report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((e) => {
  warn(`nav-history backfill dry-run failed: ${(e as Error).message}`);
  process.exit(1);
});
