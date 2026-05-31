/**
 * Production historical NAV backfill driver (Phase 3.2H / 3.2I / 3.5A).
 *
 * Drives a per-stage AMFI historical backfill of the full matched universe
 * (1,036 funds from src/data/snapshots/mf-latest-nav.json):
 *
 *   - Stage 1 (default; NAV_HISTORY_STAGE=1): 15 months, 75-day chunks → 7
 *     windows. Computes 1M/3M/6M/1Y simple returns. Production output landed
 *     in commit 8543be9.
 *   - Stage 2 (NAV_HISTORY_STAGE=2): 3 years, 75-day chunks → ~15 windows.
 *     Adds 3Y CAGR. Stage-2 dry-run writes its diagnostic report + sample
 *     files to distinct stage-2 paths under data/debug/ so it cannot
 *     collide with the Stage-1 outputs.
 *
 * NAV_HISTORY_WRITE_MODE=production enables writing public/nav-history/ +
 * the manifest. The script writes production files ONLY when every guardrail
 * passes; otherwise it leaves existing files untouched (keep-last-good) and
 * exits non-zero. The workflow's optional commit step is gated on the
 * script's clean exit.
 *
 * Reuses the Phase 3.2E/3.2F header-driven parser (column map by NAME, not
 * position). Filter key: AMFI scheme code.
 *
 * Run: NAV_HISTORY_STAGE=2 npx tsx scripts/ingest/nav-history-backfill.ts
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

// Default = "dryrun"; set NAV_HISTORY_WRITE_MODE=production to enable
// write-to-public + manifest. The script writes production files ONLY when
// every guardrail passes; otherwise it leaves existing files untouched
// (keep-last-good) and exits non-zero.
const WRITE_MODE: "dryrun" | "production" =
  process.env.NAV_HISTORY_WRITE_MODE === "production" ? "production" : "dryrun";

// Stage selection. NAV_HISTORY_STAGE=2 enables the 3-year backfill (75-day
// chunks → ~15 windows). Default is Stage 1 = 15 months (~7 windows) — the
// validated production configuration.
const STAGE: 1 | 2 = process.env.NAV_HISTORY_STAGE === "2" ? 2 : 1;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Per-stage configuration. Stage 1 keeps the exact constants we shipped in
// production; Stage 2 adds 3Y coverage, doubles the window count, lifts the
// failed-window ceiling proportionally, and writes its dry-run output to a
// distinct path so it can never collide with Stage 1.
interface StageConfig {
  totalMonthsBack: number;
  bufferDays: number;
  chunkDays: number;
  politeDelayMs: number;
  fetchTimeoutMs: number;
  runDeadlineMs: number;
  perWindowMaxRetries: number;
  backoffMs: number[];
  reportPath: string;
  sampleDir: string;
  productionHistoryDir: string;
  productionManifestPath: string;
  guard: {
    minValidRowsPerWindow: number;
    minTotalValidRows: number;
    minMatchedCoveragePct: number;
    min1YCoveragePct: number;
    // Phase 3.5D: eligibility-aware 3Y floor. Measured against the funds
    // that are *eligible* for a 3Y return (firstDate ≤ feedLastDate − 3y),
    // not the full universe — so genuinely-young funds (launched inside the
    // 3Y window) cannot drag the metric below the floor. Set to 0 on Stage 1
    // where 3Y isn't attempted.
    minEligible3YCoveragePct: number;
    maxFailedWindows: number;
    expectedFileCount: number;
  };
}

const STAGE_CONFIGS: Record<1 | 2, StageConfig> = {
  1: {
    totalMonthsBack: 15,
    // Stage 1's longest period is 1Y; 15 months already leaves ~90 days of
    // lead-in before the 1Y anchor, so no extra buffer is needed (kept 0 to
    // preserve the validated Stage-1 window set exactly).
    bufferDays: 0,
    chunkDays: 75,
    politeDelayMs: 1500,
    fetchTimeoutMs: 120_000,
    runDeadlineMs: 30 * 60_000,
    perWindowMaxRetries: 3,
    backoffMs: [5_000, 15_000, 45_000],
    reportPath: path.join(REPORT_DIR, "nav-history-backfill-dryrun-report.json"),
    sampleDir: path.resolve(REPORT_DIR, "sample-nav-history"),
    productionHistoryDir: path.resolve(process.cwd(), "public/nav-history"),
    productionManifestPath: path.resolve(process.cwd(), "src/data/snapshots/mf-history-manifest.json"),
    guard: {
      minValidRowsPerWindow: 5_000,
      minTotalValidRows: 50_000,
      minMatchedCoveragePct: 95,
      min1YCoveragePct: 95,
      minEligible3YCoveragePct: 0, // Stage 1 cannot produce 3Y; guard disabled.
      maxFailedWindows: 1, // 7 windows → ≤1 fail
      expectedFileCount: 1036,
    },
  },
  2: {
    totalMonthsBack: 36, // 3 years
    // 45-day lead-in BEFORE the 36-month mark so the fetched series starts
    // comfortably before the (asOf − 3y) anchor — fixes the Phase 3.5A 3Y=0
    // bug where the window began at/after the anchor. ~45 days absorbs the
    // today-vs-asOf gap plus weekend/holiday market closures around the
    // boundary. Adds ~1 window (≈16 total).
    bufferDays: 45,
    chunkDays: 75,
    politeDelayMs: 1500,
    fetchTimeoutMs: 120_000,
    runDeadlineMs: 45 * 60_000, // ~15 windows → more headroom
    perWindowMaxRetries: 3,
    backoffMs: [5_000, 15_000, 45_000],
    reportPath: path.join(REPORT_DIR, "nav-history-backfill-stage2-dryrun-report.json"),
    sampleDir: path.resolve(REPORT_DIR, "sample-nav-history-stage2"),
    // Stage-2 production write would land in the SAME canonical paths as
    // Stage 1 (one set of per-fund files / one manifest). For Phase 3.5A
    // this is dry-run only, so these paths are never actually written.
    productionHistoryDir: path.resolve(process.cwd(), "public/nav-history"),
    productionManifestPath: path.resolve(process.cwd(), "src/data/snapshots/mf-history-manifest.json"),
    guard: {
      minValidRowsPerWindow: 5_000,
      minTotalValidRows: 100_000, // larger total span → higher floor
      minMatchedCoveragePct: 95,
      min1YCoveragePct: 95,
      // Phase 3.5D: eligibility-aware 3Y floor. The blunt 80% total-universe
      // floor (Phase 3.5A/B/C) was failing on legitimately-young funds —
      // ~169 of the 1,036-fund universe launched inside the 3Y window and
      // can't physically have a 3Y return regardless of extraction quality.
      // The new floor: among funds whose firstDate ≤ (feedLastDate − 3y),
      // at least 99% must have a usable 3Y return. Total-universe 3Y is
      // still reported as an informational metric in the verdict + log.
      minEligible3YCoveragePct: 99,
      maxFailedWindows: 2, // 15 windows → ≤2 fail
      expectedFileCount: 1036,
    },
  },
};

const CONFIG = STAGE_CONFIGS[STAGE];
const TOTAL_MONTHS_BACK = CONFIG.totalMonthsBack;
const BUFFER_DAYS = CONFIG.bufferDays;
const CHUNK_DAYS = CONFIG.chunkDays;
const POLITE_DELAY_MS = CONFIG.politeDelayMs;
const FETCH_TIMEOUT_MS = CONFIG.fetchTimeoutMs;
const RUN_DEADLINE_MS = CONFIG.runDeadlineMs;
const PER_WINDOW_MAX_RETRIES = CONFIG.perWindowMaxRetries;
const BACKOFF_MS = CONFIG.backoffMs;
const REPORT_PATH = CONFIG.reportPath;
const SAMPLE_DIR = CONFIG.sampleDir;
const PRODUCTION_HISTORY_DIR = CONFIG.productionHistoryDir;
const PRODUCTION_MANIFEST_PATH = CONFIG.productionManifestPath;
const GUARD = CONFIG.guard;

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
  role: "main" | "pre-buffer";
  url: string;
  windowFrom: string; // DD-MMM-YYYY
  windowTo: string;
  requestedAt: string;
  attempts: number;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  bodyPreview: string | null;     // first 240 chars when HTTP 200 returns suspiciously-tiny body
  responseMs: number;
  headerSeen: boolean;
  totalDataLines: number;
  validRowCount: number;
  skippedCount: number;
  targetRowsParsed: number;
  dateMin: string | null;
  dateMax: string | null;
  zeroRowFlag: boolean;           // HTTP 200 + bytes < 50_000 + validRowCount === 0
  error?: string;
  failureReason?: string;
}

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y";

interface ReturnCell {
  value: number;
  kind: "simple" | "cagr";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
  years?: number; // present when kind === "cagr"
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
  returns: Partial<Record<PeriodKey, ReturnCell>>;
  dataAvailability: Record<PeriodKey, boolean>;
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
export interface WindowSpec { from: Date; to: Date; role: "main" | "pre-buffer" }

/** Build oldest→newest fetch windows.
 *
 *  The `main` windows span EXACTLY `monthsBack` months from `today`, in
 *  `chunkDays`-day chunks. This is the proven Stage-2 schedule
 *  (31-May-2023 → 31-May-2026 in 75-day chunks) that returned 100% universe
 *  coverage in the Phase 3.5A dry-run.
 *
 *  When `bufferDays > 0` we PREPEND ONE additional pre-buffer window of
 *  exactly `bufferDays` ending the day before the first main window. That
 *  window's sole job is to provide a NAV point on/before the (asOf − N years)
 *  anchor so annualised returns (3Y/5Y) compute correctly. It does NOT shift
 *  the main schedule — Phase 3.5C confirmed that shifting the whole grid
 *  triggers empty 200-byte responses from AMFI for windows ≥2. */
function buildWindows(monthsBack: number, chunkDays: number, bufferDays = 0): WindowSpec[] {
  const today = new Date();
  const earliest = utcShiftMonths(monthsBack);
  const mains: WindowSpec[] = [];
  let toDate = today;
  while (toDate > earliest) {
    const fromDate = new Date(Math.max(earliest.getTime(), toDate.getTime() - (chunkDays - 1) * 86_400_000));
    mains.push({ from: fromDate, to: toDate, role: "main" });
    toDate = utcShiftDays(1, fromDate.getTime());
  }
  mains.reverse(); // oldest first → newer windows overwrite via last-write-wins

  if (bufferDays <= 0) return mains;

  // Prepend ONE pre-buffer window ending the day before the first main
  // window. Width = bufferDays so the pre-buffer's `from` lands ~`bufferDays`
  // before the 3Y target.
  const firstMain = mains[0];
  const preTo = utcShiftDays(1, firstMain.from.getTime());
  const preFrom = utcShiftDays(bufferDays - 1, preTo.getTime());
  return [{ from: preFrom, to: preTo, role: "pre-buffer" }, ...mains];
}
function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** Whole-day difference isoB − isoA (positive when isoB is later). */
function dayDiffDays(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
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
// Return computation
//  Stage 1 → simple 1M/3M/6M/1Y.
//  Stage 2 → adds 3Y CAGR (annualised, point-to-point).
// ---------------------------------------------------------------------------

interface PeriodSpec {
  key: PeriodKey;
  months: number;
  years: number;
  annualize: boolean;
  stages: ReadonlyArray<1 | 2>;
}
const ALL_PERIODS: ReadonlyArray<PeriodSpec> = [
  { key: "1M", months: 1, years: 0, annualize: false, stages: [1, 2] },
  { key: "3M", months: 3, years: 0, annualize: false, stages: [1, 2] },
  { key: "6M", months: 6, years: 0, annualize: false, stages: [1, 2] },
  { key: "1Y", months: 0, years: 1, annualize: false, stages: [1, 2] },
  { key: "3Y", months: 0, years: 3, annualize: true,  stages: [2] },
];
const PERIODS_FOR_STAGE: ReadonlyArray<PeriodSpec> = ALL_PERIODS.filter((p) => p.stages.includes(STAGE));

function nearestPrior(series: SeriesPoint[], target: string): SeriesPoint | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= target) return series[i];
  return null;
}

function dayDiffYears(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  const ms = Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da);
  return ms / (365.25 * 86_400_000);
}

function emptyAvailability(): Record<PeriodKey, boolean> {
  const out = { "1M": false, "3M": false, "6M": false, "1Y": false, "3Y": false };
  return out;
}

function computeReturns(series: SeriesPoint[]): {
  returns: Partial<Record<PeriodKey, ReturnCell>>;
  availability: Record<PeriodKey, boolean>;
} {
  const returns: Partial<Record<PeriodKey, ReturnCell>> = {};
  const availability = emptyAvailability();
  if (series.length < 2) return { returns, availability };
  const end = series[series.length - 1];
  const firstDate = series[0].date;
  for (const p of PERIODS_FOR_STAGE) {
    const target = subPeriod(end.date, p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start.nav <= 0) continue;
    if (p.annualize) {
      const years = dayDiffYears(start.date, end.date);
      if (!Number.isFinite(years) || years <= 0) continue;
      returns[p.key] = {
        value: round2((Math.pow(end.nav / start.nav, 1 / years) - 1) * 100),
        kind: "cagr",
        startDate: start.date, startNav: start.nav,
        endDate: end.date, endNav: end.nav,
        years: Math.round(years * 100) / 100,
      };
    } else {
      returns[p.key] = {
        value: round2((end.nav / start.nav - 1) * 100),
        kind: "simple",
        startDate: start.date, startNav: start.nav,
        endDate: end.date, endNav: end.nav,
      };
    }
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
// Production file builder + manifest (write-mode only)
// ---------------------------------------------------------------------------

// Same shape as SampleHistoryFile; written verbatim to public/nav-history/.
type ProductionHistoryFile = SampleHistoryFile;

function buildProductionFile(
  fund: SnapshotFund,
  series: SeriesPoint[],
  windows: WindowResult[],
  generatedAt: string
): ProductionHistoryFile {
  // Identical schema to the sample files (which we already exposed for
  // review) — only the destination path differs.
  return buildSampleFile(fund, series, windows, generatedAt);
}

/** Atomic per-file write: temp-write + rename. If the rename fails, leave
 *  any existing prior file intact (keep-last-good). */
async function atomicWriteJson(targetPath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  try {
    await fs.rename(tmp, targetPath);
  } catch (e) {
    // Clean up the temp file so we don't leave half-state on disk.
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

interface ManifestFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  available: boolean;
  availablePeriods: Array<"1M" | "3M" | "6M" | "1Y">;
  path: string; // repo-relative
}

interface ManifestFile {
  generatedAt: string;
  source: string;
  stage: number;
  requestedRange: { from: string; to: string; windowCount: number };
  totalFunds: number;
  fundsAvailable: number;
  fundsMissing: number;
  periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number; "3Y": number };
  ruleVersion: number;
  parserVersion: number;
  funds: ManifestFund[];
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

  const targetCodes = new Set(universe.map((f) => f.amfiSchemeCode));

  const windows = buildWindows(TOTAL_MONTHS_BACK, CHUNK_DAYS, BUFFER_DAYS);
  const requestedRangeFrom = toDDMMMYYYY(windows[0].from);
  const requestedRangeTo = toDDMMMYYYY(windows[windows.length - 1].to);
  const fetchStartIso = toIso(windows[0].from);
  info(`Stage-${STAGE} range: ${requestedRangeFrom} → ${requestedRangeTo}  ·  ${windows.length} windows × ${CHUNK_DAYS} days · buffer ${BUFFER_DAYS}d`);

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
    info(`[amfi] window ${i + 1}/${windows.length}  [${w.role}] ${windowFrom} → ${windowTo}`);
    const res = await fetchWithRetry(url);

    const base: WindowResult = {
      index: i, role: w.role, url, windowFrom, windowTo,
      requestedAt: res.requestedAt, attempts: res.attempts,
      httpStatus: res.status, contentType: res.contentType, bytes: res.bytes, bodyPreview: null, responseMs: res.ms,
      headerSeen: false, totalDataLines: 0, validRowCount: 0, skippedCount: 0, targetRowsParsed: 0,
      dateMin: null, dateMax: null, zeroRowFlag: false,
    };
    if (!res.ok || !res.text || res.text.length < 200) {
      base.error = res.error ?? `HTTP ${res.status ?? "?"} (bytes=${res.bytes ?? 0})`;
      base.failureReason = res.error ? `network error after ${res.attempts} attempt(s): ${res.error}` : `HTTP ${res.status ?? "?"} after ${res.attempts} attempt(s)`;
      base.bodyPreview = res.text ? res.text.slice(0, 240) : null;
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
    // Phase 3.5C diagnostic: HTTP 200 with a suspiciously-tiny body that
    // produced zero rows. AMFI sometimes returns 14 KB header-and-footer
    // shells for malformed window combos; surface those for inspection
    // instead of letting them quietly drag universe coverage down.
    const tinyEmpty = res.bytes !== null && res.bytes < 50_000 && stats.validRowCount === 0;
    if (tinyEmpty) {
      base.zeroRowFlag = true;
      base.bodyPreview = (res.text ?? "").slice(0, 240);
      base.failureReason = `HTTP 200 but body too small (${res.bytes} bytes) and 0 valid rows — likely an empty AMFI response for this window combo`;
    }
    if (stats.validRowCount > 0) { anyValidWindow = true; totalValidRows += stats.validRowCount; }
    windowResults.push(base);
    info(`   ${tinyEmpty ? "ZERO" : "OK  "} bytes=${res.bytes} valid=${stats.validRowCount} skipped=${stats.skippedCount} targetRows=${stats.targetRowsParsed} dates=${stats.dateMin}..${stats.dateMax}`);

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
    "3Y": perFundCoverage.filter((f) => f.dataAvailability["3Y"]).length,
  };
  const fundsMissingHistory = perFundCoverage.filter((f) => f.points === 0).map((f) => ({
    schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, amfiSchemeCode: f.amfiSchemeCode,
  }));

  // --- Anchor diagnostics (makes any future range/anchor bug obvious) ------
  // feedLastDate = the latest NAV date seen across all funds (≈ the feed's
  // as-of date). The 3Y return anchor is subPeriod(feedLastDate, 0, 3); the
  // fetch must start before it. bufferDaysBefore3YTarget > 0 means the fetch
  // start safely precedes the anchor (the fix); ≤ 0 reproduces the 3.5A bug.
  let feedLastDate: string | null = null;
  for (const f of perFundCoverage) {
    if (f.lastDate && (!feedLastDate || f.lastDate > feedLastDate)) feedLastDate = f.lastDate;
  }
  const threeYTarget = feedLastDate ? subPeriod(feedLastDate, 0, 3) : null;
  const preBufferWindow = windowResults.find((w) => w.role === "pre-buffer");
  const firstMainWindow = windowResults.find((w) => w.role === "main");
  const preFromIso = preBufferWindow ? ddMMMyyyyToIso(preBufferWindow.windowFrom) : null;
  const preToIso = preBufferWindow ? ddMMMyyyyToIso(preBufferWindow.windowTo) : null;
  const anchorDiagnostics = {
    feedLastDate,
    threeYTargetDate: threeYTarget,
    fetchStartDate: fetchStartIso, // = pre-buffer's `from` when present, else first main's `from`
    preBuffer: preBufferWindow
      ? {
          from: preBufferWindow.windowFrom,
          to: preBufferWindow.windowTo,
          fromIso: preFromIso,
          toIso: preToIso,
          bytes: preBufferWindow.bytes,
          validRows: preBufferWindow.validRowCount,
          targetRows: preBufferWindow.targetRowsParsed,
        }
      : null,
    firstMain: firstMainWindow
      ? { from: firstMainWindow.windowFrom, to: firstMainWindow.windowTo }
      : null,
    bufferDaysBefore3YTarget: threeYTarget ? dayDiffDays(fetchStartIso, threeYTarget) : null,
    bufferConfigDays: BUFFER_DAYS,
    threeYTargetInPreBuffer:
      preFromIso && preToIso && threeYTarget
        ? preFromIso <= threeYTarget && threeYTarget <= preToIso
        : null,
  };

  // --- Guardrails -----------------------------------------------------------
  const windowsOk = windowResults.filter((w) => !w.error && w.validRowCount > 0).length;
  const windowsFailed = windowResults.filter((w) => Boolean(w.error)).length;
  // Phase 3.5C: "zero-row" = HTTP 200 + suspiciously-tiny body + 0 valid rows.
  // Counted separately from `windowsFailed` (which counts true errors) so the
  // diagnostic is obvious in the verdict / log.
  const zeroRowWindows = windowResults.filter((w) => w.zeroRowFlag).length;
  const oneYCoveragePct = round2((periodCoverage["1Y"] / universe.length) * 100);
  const threeYCoveragePct = round2((periodCoverage["3Y"] / universe.length) * 100);

  // Phase 3.5D eligibility-aware 3Y partition.
  // Eligible = funds whose firstDate is on or before the 3Y target anchor;
  // i.e. funds old enough to *physically* have a 3Y return given the feed's
  // as-of date. Ineligible = funds launched after that anchor (genuinely
  // young — no extraction fix could ever give them a 3Y number). The Stage-2
  // guardrail now measures coverage among Eligible only; total-universe 3Y
  // remains an informational metric.
  const eligible3YPartition = (() => {
    const eligible: typeof perFundCoverage = [];
    const ineligible: typeof perFundCoverage = [];
    if (!threeYTarget) {
      return { eligible, ineligible, eligibleAvailable: 0, eligibleCoveragePct: 0 };
    }
    for (const f of perFundCoverage) {
      if (f.firstDate && f.firstDate <= threeYTarget) eligible.push(f);
      else ineligible.push(f);
    }
    const eligibleAvailable = eligible.filter((f) => f.dataAvailability["3Y"]).length;
    const eligibleCoveragePct = eligible.length > 0
      ? round2((eligibleAvailable / eligible.length) * 100)
      : 0;
    return { eligible, ineligible, eligibleAvailable, eligibleCoveragePct };
  })();
  const eligible3YCount = eligible3YPartition.eligible.length;
  const eligible3YAvailable = eligible3YPartition.eligibleAvailable;
  const eligible3YCoveragePct = eligible3YPartition.eligibleCoveragePct;
  const ineligible3YCount = eligible3YPartition.ineligible.length;
  const missingEligible3Y = eligible3YPartition.eligible.filter((f) => !f.dataAvailability["3Y"]);

  const guardFailures: string[] = [];
  for (const w of windowResults) {
    if (!w.error && w.validRowCount > 0 && w.validRowCount < GUARD.minValidRowsPerWindow) {
      guardFailures.push(`window ${w.index + 1} (${w.windowFrom}→${w.windowTo}) valid=${w.validRowCount} < floor ${GUARD.minValidRowsPerWindow}`);
    }
  }
  if (zeroRowWindows > 0) {
    guardFailures.push(`${zeroRowWindows} window(s) returned HTTP 200 but 0 valid rows with tiny body — see windows[].bodyPreview / failureReason`);
  }
  if (totalValidRows < GUARD.minTotalValidRows) {
    guardFailures.push(`totalValidRows ${totalValidRows} < floor ${GUARD.minTotalValidRows}`);
  }
  if (matchedCoveragePct < GUARD.minMatchedCoveragePct) {
    guardFailures.push(`matchedCoveragePct ${matchedCoveragePct} < floor ${GUARD.minMatchedCoveragePct}`);
  }
  if (oneYCoveragePct < GUARD.min1YCoveragePct) {
    guardFailures.push(`1Y coverage ${oneYCoveragePct}% < floor ${GUARD.min1YCoveragePct}%`);
  }
  // Phase 3.5D: only the eligibility-aware 3Y coverage gates production.
  // The full-universe 3Y figure is informational (reported in the verdict),
  // not a guard, so genuinely-young funds don't punish a healthy extraction.
  if (GUARD.minEligible3YCoveragePct > 0) {
    if (eligible3YCount === 0) {
      guardFailures.push(`eligible-3Y partition is empty (threeYTarget=${threeYTarget ?? "-"}) — anchor diagnostics broken; cannot evaluate Stage-2 3Y guardrail`);
    } else if (eligible3YCoveragePct < GUARD.minEligible3YCoveragePct) {
      guardFailures.push(
        `eligible 3Y coverage ${eligible3YCoveragePct}% (${eligible3YAvailable}/${eligible3YCount}) < floor ${GUARD.minEligible3YCoveragePct}% — inspect missingEligible3Y in the report; these are older funds (firstDate ≤ ${threeYTarget}) that should have a 3Y return but don't`,
      );
    }
  }
  if (windowsFailed > GUARD.maxFailedWindows) {
    guardFailures.push(`failed windows ${windowsFailed} > ceiling ${GUARD.maxFailedWindows}`);
  }
  if (aborted) guardFailures.push("run hit deadline before completing all windows");
  const guardPass = guardFailures.length === 0;

  // --- Production write (gated on WRITE_MODE === "production" AND guards) ---
  // Always builds the manifest in memory so the dry-run report can include
  // counts of "would-be-available" funds. The actual write happens only in
  // production mode + clean guardrails (keep-last-good: no partial writes).
  const manifestFunds: ManifestFund[] = perFundCoverage.map((f) => {
    const availablePeriods: Array<"1M" | "3M" | "6M" | "1Y"> = [];
    for (const k of ["1M", "3M", "6M", "1Y"] as const) if (f.dataAvailability[k]) availablePeriods.push(k);
    return {
      schemecode: f.schemecode,
      amfiSchemeCode: f.amfiSchemeCode,
      fundName: f.fundName,
      classification: f.classification,
      firstDate: f.firstDate,
      lastDate: f.lastDate,
      points: f.points,
      available: f.points > 0,
      availablePeriods,
      path: `public/nav-history/${f.schemecode}.json`,
    };
  });
  const manifest: ManifestFile = {
    generatedAt,
    source: "AMFI historical (DownloadNAVHistoryReport_Po.aspx)",
    stage: STAGE,
    requestedRange: { from: requestedRangeFrom, to: requestedRangeTo, windowCount: windows.length },
    totalFunds: universe.length,
    fundsAvailable: manifestFunds.filter((m) => m.available).length,
    fundsMissing: manifestFunds.filter((m) => !m.available).length,
    periodCoverage,
    ruleVersion: RULE_VERSION,
    parserVersion: PARSER_VERSION,
    funds: manifestFunds,
  };

  let production: {
    attempted: boolean;
    wroteFiles: number;
    manifestPath: string | null;
    skippedReason?: string;
    perFundWriteErrors: Array<{ schemecode: string; error: string }>;
  } = { attempted: false, wroteFiles: 0, manifestPath: null, perFundWriteErrors: [] };

  if (WRITE_MODE === "production" && guardPass) {
    info(`production write mode: writing ${universe.length} per-fund files under ${path.relative(process.cwd(), PRODUCTION_HISTORY_DIR)} (atomic temp+rename)`);
    await fs.mkdir(PRODUCTION_HISTORY_DIR, { recursive: true });
    let wrote = 0;
    const errs: Array<{ schemecode: string; error: string }> = [];
    for (const f of universe) {
      const byDate = seriesByCode.get(f.amfiSchemeCode) ?? new Map<string, number>();
      const dates = Array.from(byDate.keys()).sort();
      const series: SeriesPoint[] = dates.map((d) => ({ date: d, nav: byDate.get(d)! }));
      const target = path.join(PRODUCTION_HISTORY_DIR, `${f.schemecode}.json`);
      try {
        const file = buildProductionFile(f, series, windowResults, generatedAt);
        await atomicWriteJson(target, file);
        wrote += 1;
      } catch (e) {
        errs.push({ schemecode: f.schemecode, error: (e as Error).message });
      }
    }
    info(`wrote ${wrote} per-fund history files (${errs.length} errors)`);
    if (wrote !== GUARD.expectedFileCount) {
      // Hard failure — do not commit a partial backfill. We've still left any
      // prior production files intact (keep-last-good); only new/changed files
      // were touched.
      const reason = `production write expected ${GUARD.expectedFileCount} files but wrote ${wrote}`;
      warn(reason);
      production = { attempted: true, wroteFiles: wrote, manifestPath: null, skippedReason: reason, perFundWriteErrors: errs };
      guardFailures.push(reason);
    } else {
      // Manifest written LAST so a torn write leaves it stale (loaders treat
      // the manifest as truth and re-derive from per-fund files if needed).
      await atomicWriteJson(PRODUCTION_MANIFEST_PATH, manifest);
      info(`wrote ${path.relative(process.cwd(), PRODUCTION_MANIFEST_PATH)}`);
      production = { attempted: true, wroteFiles: wrote, manifestPath: path.relative(process.cwd(), PRODUCTION_MANIFEST_PATH), perFundWriteErrors: errs };
    }
  } else if (WRITE_MODE === "production" && !guardPass) {
    production = { attempted: false, wroteFiles: 0, manifestPath: null, skippedReason: `guardrails failed: ${guardFailures.join(" · ")}`, perFundWriteErrors: [] };
    warn(`production write SKIPPED — guardrails failed; existing public/nav-history files (if any) untouched`);
  } else {
    production = { attempted: false, wroteFiles: 0, manifestPath: null, skippedReason: "dryrun mode (default) — set NAV_HISTORY_WRITE_MODE=production to write public/nav-history/", perFundWriteErrors: [] };
  }

  // --- Sample files (always written under data/debug for review) ------------
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
  // Re-evaluate guardPass AFTER the production-write block (which can append
  // a partial-files failure to guardFailures); the verdict + recommendation
  // must reflect the post-write state.
  const finalGuardPass = guardFailures.length === 0;
  const recommendation = buildRecommendation(finalGuardPass, guardFailures, matchedCoveragePct, periodCoverage, universe.length, WRITE_MODE, production, {
    eligible3YCount,
    eligible3YAvailable,
    eligible3YCoveragePct,
    ineligible3YCount,
  });
  const verdict = {
    writeMode: WRITE_MODE,
    stage: STAGE,
    universeCount: universe.length,
    windowsAttempted: windowResults.length,
    windowsOk,
    windowsFailed,
    zeroRowWindows,
    abortedEarly: aborted,
    totalValidRows,
    fundsWithAnyPoint: fundsWithPoints.length,
    fundsMissingHistoryCount: fundsMissingHistory.length,
    matchedCoveragePct,
    oneYCoveragePct,
    // Phase 3.5D: total-universe 3Y is informational only; the gating metric
    // is eligible3YCoveragePct (funds with firstDate ≤ feedLastDate − 3y).
    threeYCoveragePct,
    eligible3YFunds: eligible3YCount,
    eligible3YAvailable,
    eligible3YCoveragePct,
    ineligible3YFunds: ineligible3YCount,
    threeYTargetDate: threeYTarget,
    periodCoverage,
    guardPass: finalGuardPass,
    guardFailures,
    production: { attempted: production.attempted, wroteFiles: production.wroteFiles, skippedReason: production.skippedReason ?? null },
  };

  const report = {
    meta: {
      generatedAt,
      writeMode: WRITE_MODE,
      dryRun: WRITE_MODE === "dryrun",
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
      note: WRITE_MODE === "production"
        ? "PRODUCTION WRITE MODE — wrote public/nav-history/{schemecode}.json + src/data/snapshots/mf-history-manifest.json when all guardrails passed. ISIN is diagnostic only; extraction is keyed on AMFI scheme code."
        : "DRY RUN — writes only data/debug/. Production per-fund files (public/nav-history/) are NOT written. ISIN is diagnostic only; extraction is keyed on AMFI scheme code.",
    },
    requestedRange: { from: requestedRangeFrom, to: requestedRangeTo, windowCount: windows.length },
    anchorDiagnostics,
    guardrails: GUARD,
    production,
    verdict,
    windows: windowResults,
    universeCoverage: {
      universeCount: universe.length,
      fundsWithAnyPoint: fundsWithPoints.length,
      matchedCoveragePct,
      periodCoverage,
      fundsMissingHistorySample: fundsMissingHistory.slice(0, 50),
      fundsMissingHistoryTotal: fundsMissingHistory.length,
      // Stage-2 helper: lists funds that have history but didn't reach the
      // 3Y target start (mostly genuinely young funds). On Stage 1 this list
      // is naturally the whole holding-bearing set because 3Y is never
      // attempted — kept as `null` there to avoid noise.
      fundsMissing3YTotal: STAGE === 2
        ? perFundCoverage.filter((f) => f.points > 0 && !f.dataAvailability["3Y"]).length
        : null,
      fundsMissing3YSample: STAGE === 2
        ? perFundCoverage
            .filter((f) => f.points > 0 && !f.dataAvailability["3Y"])
            .slice(0, 50)
            .map((f) => ({ schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, firstDate: f.firstDate, lastDate: f.lastDate, points: f.points }))
        : null,
      // Phase 3.5D: eligibility-aware breakdown of the missing-3Y set.
      // - missingEligible3Y*: older funds (firstDate ≤ feedLastDate − 3y)
      //   that *should* have a 3Y return but don't. These are the funds the
      //   guardrail cares about — if this list is non-empty, an extraction
      //   issue is likely.
      // - ineligible3YFundsTotal: funds launched after the 3Y target anchor;
      //   physically can't have a 3Y return. Informational only.
      missingEligible3YTotal: STAGE === 2 ? missingEligible3Y.length : null,
      missingEligible3YSample: STAGE === 2
        ? missingEligible3Y
            .slice(0, 50)
            .map((f) => ({ schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, firstDate: f.firstDate, lastDate: f.lastDate, points: f.points }))
        : null,
      ineligible3YFundsTotal: STAGE === 2 ? ineligible3YCount : null,
      ineligible3YFundsSample: STAGE === 2
        ? eligible3YPartition.ineligible
            .slice(0, 25)
            .map((f) => ({ schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, firstDate: f.firstDate, lastDate: f.lastDate, points: f.points }))
        : null,
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

  printSummary(verdict, windowResults, sampleSummaries, recommendation, production, anchorDiagnostics);

  // Exit non-zero if NO usable windows OR the report couldn't be written OR
  // any guardrail failed (incl. production-write partial failure). The
  // workflow's commit step only runs on a zero exit from this script.
  if (!wrote) process.exit(1);
  if (!anyValidWindow) { warn("no AMFI historical windows yielded usable rows"); process.exit(1); }
  if (!finalGuardPass) { warn(`guardrails failed: ${guardFailures.join(" · ")}`); process.exit(1); }
}

function buildRecommendation(
  guardPass: boolean,
  guardFailures: string[],
  matchedCoveragePct: number,
  periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number; "3Y": number },
  universeCount: number,
  writeMode: "dryrun" | "production",
  production: { attempted: boolean; wroteFiles: number; manifestPath: string | null; skippedReason?: string },
  eligibility: {
    eligible3YCount: number;
    eligible3YAvailable: number;
    eligible3YCoveragePct: number;
    ineligible3YCount: number;
  },
): string {
  if (!guardPass) return `BLOCK: production guardrails failed (${guardFailures.join(" · ")}). Inspect window-level failureReason and per-fund coverage; existing public/nav-history files were left untouched (keep-last-good).`;
  const oneY = periodCoverage["1Y"];
  const threeY = periodCoverage["3Y"];
  const oneYok = matchedCoveragePct >= 99 && oneY >= Math.floor(universeCount * 0.95);
  const stageLabel = `Stage-${STAGE}`;
  if (writeMode === "production") {
    return production.attempted && production.wroteFiles === universeCount && production.manifestPath
      ? `PROCEED: wrote ${production.wroteFiles}/${universeCount} per-fund files + manifest at ${production.manifestPath}. ${stageLabel} historical NAV is now on disk; commit step (gated on commit=true in the workflow) will land it on the branch.`
      : `BLOCK: production write was skipped or partial (${production.skippedReason ?? "unknown"}); existing public/nav-history files were left untouched.`;
  }
  if (STAGE === 2) {
    // Phase 3.5D: Stage-2 dry-run verdict is driven by the eligibility-aware
    // 3Y coverage, not the blunt total-universe percentage. Total-universe
    // 3Y is reported as supplementary context.
    const elig = eligibility;
    if (oneYok && elig.eligible3YCount > 0 && elig.eligible3YCoveragePct >= 99) {
      return `PROCEED (Stage-2 dry-run): 1Y ${oneY}/${universeCount}; eligible 3Y ${elig.eligible3YAvailable}/${elig.eligible3YCount} = ${elig.eligible3YCoveragePct}% (≥99%); ${elig.ineligible3YCount} funds genuinely young (launched after the 3Y anchor); total 3Y ${threeY}/${universeCount} (informational). Recommend re-running with commit=true to land Stage-2 history.`;
    }
    if (oneYok) {
      return `REVIEW (Stage-2 dry-run): guardrails passed; 1Y ${oneY}/${universeCount} OK but eligible 3Y is ${elig.eligible3YAvailable}/${elig.eligible3YCount} = ${elig.eligible3YCoveragePct}% (below 99% threshold). Inspect missingEligible3YSample in the report — these are older funds that should have a 3Y return but don't, and likely indicate an extraction gap, not genuine youth. Do not promote until investigated.`;
    }
    return `REVIEW: dry-run cleared baseline guardrails but 1Y rate is below 95% (${oneY}/${universeCount}). Inspect fundsMissingHistorySample before promoting.`;
  }
  if (oneYok) {
    return `PROCEED (${stageLabel} dry-run): clean across the matched universe and ≥95% have 1Y coverage. Recommend re-running with commit=true (NAV_HISTORY_WRITE_MODE=production) to land public/nav-history/{schemecode}.json.`;
  }
  return `REVIEW: dry-run cleared guardrails (matchedCoveragePct=${matchedCoveragePct}%, 1Y coverage=${oneY}/${universeCount}), but the 1Y rate is below 95% of universe. Inspect fundsMissingHistorySample before promoting to a real backfill.`;
}

function printSummary(
  v: { writeMode: "dryrun" | "production"; stage: 1 | 2; universeCount: number; windowsAttempted: number; windowsOk: number; windowsFailed: number; zeroRowWindows: number; abortedEarly: boolean; totalValidRows: number; fundsWithAnyPoint: number; fundsMissingHistoryCount: number; matchedCoveragePct: number; oneYCoveragePct: number; threeYCoveragePct: number; eligible3YFunds: number; eligible3YAvailable: number; eligible3YCoveragePct: number; ineligible3YFunds: number; threeYTargetDate: string | null; periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number; "3Y": number }; guardPass: boolean; guardFailures: string[] },
  windows: WindowResult[],
  samples: Array<{ schemecode: string; fundName: string; path: string; points: number; firstDate: string | null; lastDate: string | null }>,
  recommendation: string,
  production: { attempted: boolean; wroteFiles: number; manifestPath: string | null; skippedReason?: string; perFundWriteErrors: Array<{ schemecode: string; error: string }> },
  anchor: {
    feedLastDate: string | null;
    fetchStartDate: string;
    threeYTargetDate: string | null;
    bufferDaysBefore3YTarget: number | null;
    bufferConfigDays: number;
    preBuffer: { from: string; to: string; bytes: number | null; validRows: number; targetRows: number } | null;
    firstMain: { from: string; to: string } | null;
    threeYTargetInPreBuffer: boolean | null;
  },
): void {
  info(`======== STAGE-${v.stage} NAV HISTORY BACKFILL SUMMARY (${v.writeMode.toUpperCase()}) =======`);
  info(`Universe matched funds: ${v.universeCount}`);
  info(`Anchor: feedLastDate=${anchor.feedLastDate ?? "-"} 3Y-target=${anchor.threeYTargetDate ?? "-"} fetchStart=${anchor.fetchStartDate} bufferBefore3Y=${anchor.bufferDaysBefore3YTarget ?? "-"}d (config ${anchor.bufferConfigDays}d)`);
  if (anchor.preBuffer) {
    info(`Pre-buffer:  ${anchor.preBuffer.from}→${anchor.preBuffer.to} · bytes=${anchor.preBuffer.bytes ?? "-"} valid=${anchor.preBuffer.validRows} target=${anchor.preBuffer.targetRows} · 3Y-target-in-window=${anchor.threeYTargetInPreBuffer}`);
  } else {
    info(`Pre-buffer:  (not used)`);
  }
  if (anchor.firstMain) info(`First main:  ${anchor.firstMain.from}→${anchor.firstMain.to}`);
  info(`Windows: attempted=${v.windowsAttempted} ok=${v.windowsOk} failed=${v.windowsFailed} zeroRow=${v.zeroRowWindows} aborted=${v.abortedEarly} totalValidRows=${v.totalValidRows}`);
  for (const w of windows) {
    const tag = w.error
      ? `ERR ${w.failureReason ?? w.error}`
      : w.zeroRowFlag
        ? `ZERO bytes=${w.bytes} valid=0 — body preview: ${(w.bodyPreview ?? "").slice(0, 120)}`
        : `ok valid=${w.validRowCount} target=${w.targetRowsParsed} ${w.dateMin}..${w.dateMax}`;
    info(`   ${w.index + 1}[${w.role}]: ${w.windowFrom}→${w.windowTo} attempts=${w.attempts} HTTP=${w.httpStatus ?? "-"} ct=${w.contentType ?? "-"} bytes=${w.bytes ?? "-"} ${w.responseMs}ms · ${tag}`);
  }
  info(`Universe coverage: ${v.fundsWithAnyPoint}/${v.universeCount} = ${v.matchedCoveragePct}% have ≥1 point; missing=${v.fundsMissingHistoryCount}`);
  info(`Period coverage (funds with availability): 1M=${v.periodCoverage["1M"]} 3M=${v.periodCoverage["3M"]} 6M=${v.periodCoverage["6M"]} 1Y=${v.periodCoverage["1Y"]} 3Y=${v.periodCoverage["3Y"]}  ·  1Y=${v.oneYCoveragePct}% 3Y=${v.threeYCoveragePct}% (total-universe; informational)`);
  if (v.stage === 2) {
    info(`Eligible 3Y (firstDate ≤ ${v.threeYTargetDate ?? "-"}): ${v.eligible3YAvailable}/${v.eligible3YFunds} = ${v.eligible3YCoveragePct}% (guard floor)  ·  ${v.ineligible3YFunds} genuinely-young funds excluded`);
  }
  info(`Guardrails: ${v.guardPass ? "PASS" : "FAIL · " + v.guardFailures.join(" · ")}`);
  info(`Production: attempted=${production.attempted} wroteFiles=${production.wroteFiles}${production.manifestPath ? ` manifest=${production.manifestPath}` : ""}${production.skippedReason ? ` · skipped: ${production.skippedReason}` : ""}`);
  if (production.perFundWriteErrors.length > 0) {
    info(`   per-fund write errors: ${production.perFundWriteErrors.length} (first 3 below)`);
    for (const e of production.perFundWriteErrors.slice(0, 3)) info(`     ${e.schemecode}: ${e.error}`);
  }
  for (const s of samples) info(`   sample ${s.schemecode}: ${s.fundName}  pts=${s.points} ${s.firstDate ?? "-"}..${s.lastDate ?? "-"} → ${s.path}`);
  info(`Recommendation: ${recommendation}`);
  info("=============================================================");
  info(`Full report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((e) => {
  warn(`nav-history backfill failed: ${(e as Error).message}`);
  process.exit(1);
});
