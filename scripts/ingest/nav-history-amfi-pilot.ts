/**
 * Phase 3.2F — AMFI chunked historical backfill pilot (READ-ONLY, debug-only).
 *
 * Fetches AMFI historical NAV for the 12 representative pilot funds across
 * multiple polite windows (default: 15 months, 75-day chunks → 6 windows),
 * merges per-fund series, dedupes by date, and computes real return periods
 * (1M/3M/6M/1Y simple). Writes only a gitignored report at
 * data/debug/nav-history-amfi-pilot-report.json and prints a concise summary.
 * Writes NOTHING to src/data/** or public/**.
 *
 * Source: AMFI historical (DownloadNAVHistoryReport_Po.aspx). MFAPI is not
 * touched (we proved it isn't reliable; AMFI is the production source-of-
 * truth). The header-driven parser from the latest pilot is reused — it has
 * already cleared a 13/13 synthetic test and a 96,311-row real CI run.
 *
 * Run: npx tsx scripts/ingest/nav-history-amfi-pilot.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const AMFI_HISTORY_BASE = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";
const LATEST_SNAPSHOT_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-history-amfi-pilot-report.json");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Chunking strategy: 75-day windows under AMFI's ~90-day practical limit, 15-
// month total span = 6 windows. Comfortably covers 1Y while keeping each
// response small and the total run polite.
const CHUNK_DAYS = 75;
const TOTAL_MONTHS_BACK = 15;
const POLITE_DELAY_MS = 1200; // between windows
const FETCH_TIMEOUT_MS = 90_000;
const RUN_DEADLINE_MS = 10 * 60_000; // hard ceiling for the whole pilot

// Same 12 pilot funds as the dual-source pilot (resolved at runtime against
// the production snapshot so we can't drift).
const PILOT_SCHEMECODES = [
  "21520", "1131", "1273", "12758", "1305", "4980",
  "43811", "33369", "37338", "1495", "2747", "1979",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  isin: string | null;
  matchConfidence: string;
  hasHoldings: boolean;
}
interface LatestSnapshot { funds: SnapshotFund[] }

interface SeriesPoint { date: string; nav: number } // ISO YYYY-MM-DD

interface WindowResult {
  index: number;
  url: string;
  windowFrom: string; // DD-MMM-YYYY as sent to AMFI
  windowTo: string;
  requestedAt: string;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  responseMs: number;
  headerSeen: boolean;
  totalDataLines: number;
  validRowCount: number;
  skippedCount: number;
  pilotRowsParsed: number; // valid (code, nav, date) rows for the 12 pilot codes
  dateMin: string | null;
  dateMax: string | null;
  error?: string;
  failureReason?: string;
}

interface ReturnCell {
  value: number;
  kind: "simple" | "cagr";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
  years?: number;
}

interface PerFundResult {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  isin: string | null;
  points: number;
  firstDate: string | null;
  lastDate: string | null;
  latestNav: number | null;
  returns: Record<string, ReturnCell>;
  dataAvailability: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Date helpers (UTC; deterministic)
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
function dayDiff(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  return (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000;
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
  // Oldest first so duplicate (newer) rows in subsequent windows overwrite —
  // not that they should differ, but deterministic ordering matters.
  return wins.reverse();
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// Fetch + header-driven AMFI historical parser (mirrors the proven 3.2E parser)
// ---------------------------------------------------------------------------

interface FetchOut { ok: boolean; status: number | null; text: string | null; contentType: string | null; bytes: number | null; requestedAt: string; error?: string; ms: number }
async function politeFetch(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchOut> {
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
  pilotRowsParsed: number;
  dateMin: string | null;
  dateMax: string | null;
}

/** Header-driven AMFI historical parser. Appends valid pilot rows into the
 *  per-code map `into` (deduping by ISO date with last-write-wins) and
 *  returns parse statistics. Identical column-map logic to nav-history-pilot. */
function parseHistoricalInto(
  text: string,
  pilotCodes: Set<number>,
  into: Map<number, Map<string, number>>
): ParseStats {
  let cm: ColumnMap | null = null;
  let headerSeen = false;
  let totalDataLines = 0, validRowCount = 0, skippedCount = 0, pilotRows = 0;
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
    if (!pilotCodes.has(code)) continue;
    pilotRows += 1;
    let series = into.get(code);
    if (!series) { series = new Map(); into.set(code, series); }
    series.set(iso, nav); // dedupe by date (last-write-wins across windows)
  }

  return { headerSeen, columnMap: cm, totalDataLines, validRowCount, skippedCount, pilotRowsParsed: pilotRows, dateMin, dateMax };
}

// ---------------------------------------------------------------------------
// Return computation (point-to-point; simple ≤1Y, CAGR >1Y; not-faked)
// ---------------------------------------------------------------------------

const PERIODS: Array<{ key: string; months: number; years: number; annualize: boolean }> = [
  { key: "1M", months: 1, years: 0, annualize: false },
  { key: "3M", months: 3, years: 0, annualize: false },
  { key: "6M", months: 6, years: 0, annualize: false },
  { key: "1Y", months: 0, years: 1, annualize: false },
];

function nearestPrior(series: SeriesPoint[], targetIso: string): SeriesPoint | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= targetIso) return series[i];
  return null;
}

function computeReturns(series: SeriesPoint[]): { returns: Record<string, ReturnCell>; availability: Record<string, boolean> } {
  const returns: Record<string, ReturnCell> = {};
  const availability: Record<string, boolean> = {};
  if (series.length < 2) { for (const p of PERIODS) availability[p.key] = false; return { returns, availability }; }
  const end = series[series.length - 1];
  const firstDate = series[0].date;
  for (const p of PERIODS) {
    const target = subPeriod(end.date, p.months, p.years);
    if (firstDate > target) { availability[p.key] = false; continue; }
    const start = nearestPrior(series, target);
    if (!start || start.nav <= 0) { availability[p.key] = false; continue; }
    const ratio = end.nav / start.nav;
    let value: number;
    let kind: "simple" | "cagr";
    let years: number | undefined;
    if (p.annualize) {
      years = dayDiff(start.date, end.date) / 365.25;
      value = (Math.pow(ratio, 1 / years) - 1) * 100;
      kind = "cagr";
    } else {
      value = (ratio - 1) * 100;
      kind = "simple";
    }
    returns[p.key] = { value: round2(value), kind, startDate: start.date, startNav: start.nav, endDate: end.date, endNav: end.nav, years: years ? round2(years) : undefined };
    availability[p.key] = true;
  }
  return { returns, availability };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const runStart = Date.now();
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), LATEST_SNAPSHOT_PATH)}`);
  const snapshot = JSON.parse(await fs.readFile(LATEST_SNAPSHOT_PATH, "utf8")) as LatestSnapshot;
  const byCode = new Map(snapshot.funds.map((f) => [String(f.schemecode), f]));

  const pilot: SnapshotFund[] = [];
  const missing: string[] = [];
  for (const code of PILOT_SCHEMECODES) {
    const f = byCode.get(code);
    if (f) pilot.push(f); else missing.push(code);
  }
  if (missing.length > 0) warn(`pilot schemecodes missing from snapshot: ${missing.join(", ")}`);
  info(`pilot funds resolved: ${pilot.length}/${PILOT_SCHEMECODES.length}`);

  const windows = buildWindows(TOTAL_MONTHS_BACK, CHUNK_DAYS);
  const requestedRangeFrom = toDDMMMYYYY(windows[0].from);
  const requestedRangeTo = toDDMMMYYYY(windows[windows.length - 1].to);
  info(`requested range: ${requestedRangeFrom} → ${requestedRangeTo}  ·  ${windows.length} windows × ${CHUNK_DAYS} days`);

  const pilotCodes = new Set(pilot.map((f) => f.amfiSchemeCode));
  // amfiSchemeCode → (iso → nav)
  const seriesByCode = new Map<number, Map<string, number>>();
  const windowResults: WindowResult[] = [];
  let anyValidWindow = false;
  let aborted = false;

  for (let i = 0; i < windows.length; i++) {
    if (Date.now() - runStart > RUN_DEADLINE_MS) {
      warn(`run deadline (${RUN_DEADLINE_MS / 60000} min) hit before window ${i + 1}; stopping safely`);
      aborted = true;
      break;
    }
    const w = windows[i];
    const windowFrom = toDDMMMYYYY(w.from);
    const windowTo = toDDMMMYYYY(w.to);
    const url = `${AMFI_HISTORY_BASE}?frmdt=${windowFrom}&todt=${windowTo}`;
    info(`[amfi] window ${i + 1}/${windows.length}  ${windowFrom} → ${windowTo}`);
    const res = await politeFetch(url);

    const base: WindowResult = {
      index: i, url, windowFrom, windowTo,
      requestedAt: res.requestedAt, httpStatus: res.status, contentType: res.contentType, bytes: res.bytes, responseMs: res.ms,
      headerSeen: false, totalDataLines: 0, validRowCount: 0, skippedCount: 0, pilotRowsParsed: 0,
      dateMin: null, dateMax: null,
    };
    if (!res.ok || !res.text || res.text.length < 200) {
      base.error = res.error ?? `HTTP ${res.status ?? "?"} (bytes=${res.bytes ?? 0})`;
      base.failureReason = res.error ? `network error: ${res.error}` : `HTTP ${res.status ?? "?"} or body too short`;
      windowResults.push(base);
      info(`   FAIL ${base.failureReason}`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    let stats: ParseStats;
    try {
      stats = parseHistoricalInto(res.text, pilotCodes, seriesByCode);
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
    base.pilotRowsParsed = stats.pilotRowsParsed;
    base.dateMin = stats.dateMin;
    base.dateMax = stats.dateMax;
    if (stats.validRowCount > 0) anyValidWindow = true;
    windowResults.push(base);
    info(`   OK   bytes=${res.bytes} valid=${stats.validRowCount} skipped=${stats.skippedCount} pilotRows=${stats.pilotRowsParsed} dates=${stats.dateMin}..${stats.dateMax}`);

    await sleep(POLITE_DELAY_MS);
  }

  // Materialise per-fund sorted series + compute returns.
  const perFund: PerFundResult[] = [];
  for (const f of pilot) {
    const byDate = seriesByCode.get(f.amfiSchemeCode) ?? new Map<string, number>();
    const dates = Array.from(byDate.keys()).sort();
    const series: SeriesPoint[] = dates.map((d) => ({ date: d, nav: byDate.get(d)! }));
    const firstDate = series[0]?.date ?? null;
    const lastDate = series[series.length - 1]?.date ?? null;
    const latestNav = lastDate ? byDate.get(lastDate) ?? null : null;
    const { returns, availability } = computeReturns(series);
    perFund.push({
      schemecode: f.schemecode, fundName: f.fundName, classification: f.classification,
      amfiSchemeCode: f.amfiSchemeCode, isin: f.isin,
      points: series.length, firstDate, lastDate, latestNav,
      returns, dataAvailability: availability,
    });
  }

  // Period coverage (count of pilot funds with each period available).
  const periodKeys = ["1M", "3M", "6M", "1Y"];
  const periodCoverage: Record<string, number> = {};
  for (const k of periodKeys) periodCoverage[k] = perFund.filter((f) => f.dataAvailability[k]).length;

  const totalPilotRows = perFund.reduce((s, f) => s + f.points, 0);
  const allFundsHavePoints = perFund.every((f) => f.points > 0);

  const verdict = {
    windowsAttempted: windowResults.length,
    windowsOk: windowResults.filter((w) => !w.error && w.validRowCount > 0).length,
    windowsFailed: windowResults.filter((w) => Boolean(w.error)).length,
    abortedEarly: aborted,
    totalPilotPoints: totalPilotRows,
    allPilotFundsHavePoints: allFundsHavePoints,
    periodCoverage,
  };

  const recommendation = buildRecommendation(verdict, perFund);

  const report = {
    meta: {
      generatedAt,
      dryRun: true,
      source: "AMFI historical (DownloadNAVHistoryReport_Po.aspx)",
      note: "Read-only chunked AMFI historical backfill pilot. Not a production history file. Not wired to dashboard. ISIN remains diagnostic only — extraction is keyed on AMFI scheme code.",
      pilotCount: pilot.length,
      missingPilotSchemecodes: missing,
      monthsBack: TOTAL_MONTHS_BACK,
      chunkDays: CHUNK_DAYS,
      politeDelayMs: POLITE_DELAY_MS,
      requestedRangeFrom, requestedRangeTo,
      runDurationMs: Date.now() - runStart,
    },
    pilotFunds: pilot.map((f) => ({ schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, amfiSchemeCode: f.amfiSchemeCode, matchConfidence: f.matchConfidence })),
    windows: windowResults,
    perFund,
    verdict,
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

  printSummary(verdict, perFund, windowResults, recommendation);

  if (!wrote) process.exit(1);
  // Exit non-zero only if NO window yielded any usable rows AT ALL.
  if (!anyValidWindow) { warn("no AMFI historical windows yielded usable rows"); process.exit(1); }
}

function buildRecommendation(
  v: { windowsOk: number; windowsFailed: number; abortedEarly: boolean; allPilotFundsHavePoints: boolean; periodCoverage: Record<string, number> },
  perFund: PerFundResult[]
): string {
  if (v.windowsOk === 0) return "BLOCK: no AMFI historical window returned usable rows. Inspect window-level failureReason fields before retry.";
  const fundsCount = perFund.length;
  const oneY = v.periodCoverage["1Y"];
  const sixM = v.periodCoverage["6M"];
  if (v.allPilotFundsHavePoints && oneY === fundsCount && !v.abortedEarly && v.windowsFailed === 0) {
    return "PROCEED: AMFI chunked extraction is reliable end-to-end for all pilots through 1Y. Recommend Phase 3.2G — design the production AMFI historical backfill (universe scope, output schema, resume strategy, daily forward-accrual) before implementing.";
  }
  if (oneY > 0 || sixM > 0) {
    return `PARTIAL: AMFI windows OK=${v.windowsOk} failed=${v.windowsFailed} aborted=${v.abortedEarly}; period coverage ${JSON.stringify(v.periodCoverage)}/${fundsCount}. Inspect failed-window failureReason and per-fund gaps; consider smaller windows or per-AMC scoping before production backfill.`;
  }
  return "INSUFFICIENT: rows fetched but no fund reached even 6M coverage. Likely a window-merge or date-range issue; re-check before recommending the next phase.";
}

function printSummary(
  v: { windowsAttempted: number; windowsOk: number; windowsFailed: number; abortedEarly: boolean; totalPilotPoints: number; allPilotFundsHavePoints: boolean; periodCoverage: Record<string, number> },
  perFund: PerFundResult[],
  windows: WindowResult[],
  recommendation: string
): void {
  info("=========== AMFI CHUNKED HISTORICAL PILOT SUMMARY ===========");
  info(`windows: attempted=${v.windowsAttempted} ok=${v.windowsOk} failed=${v.windowsFailed} aborted=${v.abortedEarly}`);
  for (const w of windows) {
    const tag = w.error ? `ERR ${w.failureReason ?? w.error}` : `ok valid=${w.validRowCount} pilotRows=${w.pilotRowsParsed} ${w.dateMin}..${w.dateMax}`;
    info(`   ${w.index + 1}: ${w.windowFrom}→${w.windowTo} HTTP=${w.httpStatus ?? "-"} ct=${w.contentType ?? "-"} bytes=${w.bytes ?? "-"} ${w.responseMs}ms · ${tag}`);
  }
  info(`per-fund extraction (totalPilotPoints=${v.totalPilotPoints}):`);
  for (const f of perFund) {
    const r = (k: string) => f.returns[k] ? `${f.returns[k].value}%` : "-";
    info(`   ${f.amfiSchemeCode} ${f.schemecode}: pts=${f.points} ${f.firstDate ?? "-"}..${f.lastDate ?? "-"} latest=${f.latestNav ?? "-"} | 1M=${r("1M")} 3M=${r("3M")} 6M=${r("6M")} 1Y=${r("1Y")}`);
  }
  info(`period coverage (of ${perFund.length} pilot funds): ${["1M", "3M", "6M", "1Y"].map((k) => `${k}=${v.periodCoverage[k]}`).join(" ")}`);
  info(`Recommendation: ${recommendation}`);
  info("=============================================================");
  info(`Full report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((e) => {
  warn(`amfi history pilot failed: ${(e as Error).message}`);
  process.exit(1);
});
