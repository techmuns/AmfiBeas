/**
 * Phase 3.2B — dual-source historical NAV pilot (READ-ONLY, debug-only).
 *
 * Validates MFAPI historical backfill against AMFI historical data for 12
 * representative funds BEFORE any production history files exist. Writes only
 * a gitignored report at data/debug/nav-history-pilot-report.json and prints
 * a concise summary. Writes NOTHING to src/data/** or public/**.
 *
 *  - MFAPI-led: fetch full history per pilot fund by AMFI scheme code.
 *  - AMFI cross-check: pull a recent window (all schemes) once and compare
 *    NAVs on overlapping dates for a few pilot funds. Degrades cleanly if the
 *    AMFI history endpoint is unreachable from the runner.
 *  - Returns: 1M/3M/6M/1Y (simple) and 3Y/5Y/since-inception (CAGR), using the
 *    nearest-prior available NAV for weekends/holidays. Periods without enough
 *    history are omitted, never faked.
 *
 * Run: npx tsx scripts/ingest/nav-history-pilot.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseNavAll } from "./amfi-nav";
import { info, nowIso, warn } from "./utils";

const MFAPI_BASE = "https://api.mfapi.in/mf";
const AMFI_HISTORY_BASE = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";
const LATEST_SNAPSHOT_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-history-pilot-report.json");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const POLITE_DELAY_MS = 400;
const AMFI_WINDOW_DAYS = 16;
const NAV_TOLERANCE_PCT = 0.5; // |Δ| within 0.5% of NAV counts as a match

// 12 representative pilot funds (RupeeVest schemecodes), resolved to their
// AMFI scheme codes from the committed latest-NAV snapshot at runtime.
// Coverage: large equity (Direct + Regular), index fund (override), 2 ETFs
// (one override), 3 hybrids (multi-asset / aggressive / arbitrage).
const PILOT_SCHEMECODES = [
  "21520", // Parag Parikh Flexi Cap Fund-Reg(G)   — Flexi Cap (Regular)
  "1131",  // HDFC Flexi Cap Fund(G)               — Flexi Cap (Direct)
  "1273",  // HDFC Balanced Advantage Fund(G)      — Dynamic Asset Allocation
  "12758", // Nippon India Small Cap Fund(G)       — Small Cap
  "1305",  // HDFC Mid Cap Fund-Reg(G)             — Mid Cap
  "4980",  // ICICI Pru Large Cap Fund(G)          — Large Cap
  "43811", // Motilal Oswal Nifty Smallcap 250 Index Fund-Reg(G) — Index (override)
  "33369", // SBI Nifty 50 ETF                     — ETF
  "37338", // UTI Nifty Next 50 ETF                — ETF (override)
  "1495",  // ICICI Pru Multi-Asset Fund(G)        — Multi Asset Allocation
  "2747",  // SBI Equity Hybrid Fund-Reg(G)        — Aggressive Hybrid
  "1979",  // Kotak Arbitrage Fund(G)              — Arbitrage
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

interface SeriesPoint { date: string; nav: number } // date = ISO YYYY-MM-DD

interface ReturnCell {
  value: number;
  kind: "simple" | "cagr";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
  years?: number;
}

interface FundFetchResult {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  isin: string | null;
  matchConfidence: string;
  status: "ok" | "error";
  // --- request diagnostics (Phase 3.2C) ---
  url: string;
  requestedAt: string;
  httpStatus: number | null;
  contentType: string | null;
  bodyPreview: string | null;
  parseError?: string;
  failureReason?: string;
  error?: string;
  responseMs: number;
  // --- parsed result ---
  points: number;
  firstDate: string | null;
  lastDate: string | null;
  latestNav: number | null;
  returns: Record<string, ReturnCell>;
  dataAvailability: Record<string, boolean>;
}

interface CrossCheckResult {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  amfiPointsFound: number; // distinct AMFI NAV dates for this code in the window (independent of MFAPI)
  comparedDates: number;
  withinTolerance: number;
  matchRatePct: number;
  maxAbsDiff: number | null;
  maxPctDiff: number | null;
}

// ---------------------------------------------------------------------------
// Date helpers (UTC, deterministic)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "29-05-2026" (MFAPI DD-MM-YYYY) → "2026-05-29". */
function ddmmyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
/** "29-May-2026" (AMFI DD-MMM-YYYY) → "2026-05-29". */
function ddMMMyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/** Today (UTC) shifted back, formatted as AMFI's DD-MMM-YYYY. */
function utcShiftToDDMMMYYYY(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTH_ABBR[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
/** Subtract months/years from an ISO date, clamping the day to month length. */
function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
function dayDiff(isoStart: string, isoEnd: string): number {
  const [ya, ma, da] = isoStart.split("-").map(Number);
  const [yb, mb, db] = isoEnd.split("-").map(Number);
  return (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Fetch helper (permissive — never throws; captures rich diagnostics)
// ---------------------------------------------------------------------------

const BODY_PREVIEW_LIMIT = 1024; // bytes of response body retained for diagnosis

function makePreview(text: string): string {
  const head = text.slice(0, BODY_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
  return text.length > BODY_PREVIEW_LIMIT ? `${head} … [truncated, total ${text.length} bytes]` : head;
}

interface FetchOut {
  ok: boolean;
  status: number | null;
  text: string | null;
  contentType: string | null;
  bodyPreview: string | null;
  requestedAt: string;
  error?: string;
  ms: number;
}
async function politeFetch(url: string, timeoutMs = 45_000): Promise<FetchOut> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const requestedAt = new Date(t0).toISOString();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": USER_AGENT, accept: "application/json,text/plain,*/*" } });
    const text = await res.text();
    return {
      ok: res.ok, status: res.status, text,
      contentType: res.headers.get("content-type"),
      bodyPreview: makePreview(text),
      requestedAt, ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, status: null, text: null, contentType: null, bodyPreview: null, requestedAt, error: (e as Error).message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// MFAPI history → ascending series
// ---------------------------------------------------------------------------

interface MfapiResponse { meta?: Record<string, unknown>; data?: Array<{ date?: string; nav?: string }>; status?: string }

interface MfapiParse {
  series: SeriesPoint[];
  parseError: string | null; // set when a 200 body could not be turned into a series
  shapeOk: boolean; // true when JSON parsed AND had a `data` array
  rawCount: number; // raw `data` rows seen (pre-filter)
}

function parseMfapiSeries(text: string): MfapiParse {
  let json: MfapiResponse;
  try {
    json = JSON.parse(text) as MfapiResponse;
  } catch (e) {
    return { series: [], parseError: `JSON parse failed: ${(e as Error).message}`, shapeOk: false, rawCount: 0 };
  }
  if (!Array.isArray(json.data)) {
    return { series: [], parseError: "response JSON has no 'data' array", shapeOk: false, rawCount: 0 };
  }
  const data = json.data;
  const out: SeriesPoint[] = [];
  for (const row of data) {
    if (!row.date || !row.nav) continue;
    const iso = ddmmyyyyToIso(row.date);
    const nav = Number(row.nav);
    if (!iso || !Number.isFinite(nav) || nav <= 0) continue;
    out.push({ date: iso, nav });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // ISO sorts lexically
  return {
    series: out,
    parseError: out.length === 0 ? `data array had ${data.length} rows but 0 usable NAV points` : null,
    shapeOk: true,
    rawCount: data.length,
  };
}

/** Last point on or before targetIso (nearest-prior); null if none. */
function nearestPrior(series: SeriesPoint[], targetIso: string): SeriesPoint | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= targetIso) return series[i];
  }
  return null;
}

const PERIODS: Array<{ key: string; months: number; years: number; annualize: boolean }> = [
  { key: "1M", months: 1, years: 0, annualize: false },
  { key: "3M", months: 3, years: 0, annualize: false },
  { key: "6M", months: 6, years: 0, annualize: false },
  { key: "1Y", months: 0, years: 1, annualize: false },
  { key: "3Y", months: 0, years: 3, annualize: true },
  { key: "5Y", months: 0, years: 5, annualize: true },
];

function computeReturns(series: SeriesPoint[]): { returns: Record<string, ReturnCell>; availability: Record<string, boolean> } {
  const returns: Record<string, ReturnCell> = {};
  const availability: Record<string, boolean> = {};
  if (series.length < 2) {
    for (const p of PERIODS) availability[p.key] = false;
    availability["since_inception"] = false;
    return { returns, availability };
  }
  const end = series[series.length - 1];
  const firstDate = series[0].date;

  for (const p of PERIODS) {
    const target = subPeriod(end.date, p.months, p.years);
    // Need history that reaches at/before the target start date.
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

  // Since inception — only when there is real history (>=60 points, >=1y span).
  const incYears = dayDiff(firstDate, end.date) / 365.25;
  if (series.length >= 60 && incYears >= 1) {
    const start = series[0];
    const value = (Math.pow(end.nav / start.nav, 1 / incYears) - 1) * 100;
    returns["since_inception"] = { value: round2(value), kind: "cagr", startDate: start.date, startNav: start.nav, endDate: end.date, endNav: end.nav, years: round2(incYears) };
    availability["since_inception"] = true;
  } else {
    availability["since_inception"] = false;
  }

  return { returns, availability };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// AMFI cross-check (recent window, all schemes)
// ---------------------------------------------------------------------------

interface PilotPresenceCheck {
  schemecode: string;
  amfiSchemeCode: number;
  isin: string | null;
  presentInParsedByCode: number; // rows parseNavAll returned with this schemeCode
  presentInRawByCode: number;    // /(?:^|;|\n)\s*<code>\s*;/ hits in the raw body
  presentInRawByIsin: number;    // /<isin>/ hits in the raw body (0 if isin null)
}

interface AmfiResponseDiagnostics {
  distinctSchemeCodeCount: number;
  distinctSchemeCodeSampleHead: number[];   // first 10 distinct codes seen, in order
  distinctSchemeCodeSampleTail: number[];   // last 10 distinct codes seen, in order
  sectionsFound: string[];                  // section-header lines from raw (capped)
  amcsFoundCount: number;                   // distinct non-`;` lines (i.e. AMC headers)
  amcsFoundSample: string[];                // first 20 distinct AMC names
  dateMin: string | null;                   // ISO YYYY-MM-DD across parsed rows
  dateMax: string | null;
  topDatesByCount: Array<{ date: string; count: number }>; // top 5
  firstParsedRows: Array<{ schemeCode: number; schemeName: string; isin?: string; navDate: string; isoDate: string | null }>;
  pilotPresence: PilotPresenceCheck[];
}

interface AmfiCrossCheck {
  attempted: boolean;
  reachable: boolean;
  error?: string;
  // --- request diagnostics (Phase 3.2C) ---
  url: string;
  requestedAt: string | null;
  httpStatus: number | null;
  contentType: string | null;
  bodyPreview: string | null;
  parseError?: string;
  failureReason?: string;
  windowFrom: string;
  windowTo: string;
  rowsParsed: number;
  results: CrossCheckResult[];
  // --- response diagnostics (Phase 3.2D) ---
  diagnostics?: AmfiResponseDiagnostics;
}

/** Count occurrences of a regex pattern in raw text without retaining match objects.
 *  `re` must carry the /g flag. Uses exec-loop to avoid allocating per match. */
function regexCount(text: string, re: RegExp): number {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(text) !== null) n += 1;
  return n;
}

const SECTION_LINE_RE = /^(Open|Close|Interval) Ended Schemes.*/i;

/** Diagnostic scan of the AMFI historical response. Cheap second pass over the
 *  already-fetched text + parsed rows; tells us whether the filter was looking
 *  in the wrong place vs whether the codes simply aren't in the response. */
function computeResponseDiagnostics(
  text: string,
  rows: ReturnType<typeof parseNavAll>,
  funds: Array<{ schemecode: string; amfiSchemeCode: number; isin: string | null }>
): AmfiResponseDiagnostics {
  // Distinct scheme codes
  const distinctCodes = new Set<number>();
  const distinctSeq: number[] = [];
  for (const r of rows) {
    if (distinctCodes.has(r.schemeCode)) continue;
    distinctCodes.add(r.schemeCode);
    distinctSeq.push(r.schemeCode);
  }
  // Sections + AMCs from raw (mirrors parseNavAll's heuristic: section regex,
  // 'Scheme Code' header, then non-';' lines = AMC names).
  const sectionsSet = new Set<string>();
  const amcsSet = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_LINE_RE.test(line)) { sectionsSet.add(line); continue; }
    if (line.startsWith("Scheme Code")) continue;
    if (!line.includes(";")) amcsSet.add(line);
  }
  const sectionsFound = Array.from(sectionsSet).slice(0, 30);
  const amcsFoundSample = Array.from(amcsSet).slice(0, 20);

  // Dates
  const byDate = new Map<string, number>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  for (const r of rows) {
    const iso = ddMMMyyyyToIso(r.date);
    if (!iso) continue;
    byDate.set(iso, (byDate.get(iso) ?? 0) + 1);
    if (!dateMin || iso < dateMin) dateMin = iso;
    if (!dateMax || iso > dateMax) dateMax = iso;
  }
  const topDatesByCount = Array.from(byDate.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([date, count]) => ({ date, count }));

  // First 20 parsed rows (the most informative artifact — shows exact shape).
  const firstParsedRows = rows.slice(0, 20).map((r) => ({
    schemeCode: r.schemeCode,
    schemeName: r.schemeName,
    isin: r.isin,
    navDate: r.date,
    isoDate: ddMMMyyyyToIso(r.date),
  }));

  // Pilot presence: by parsed scheme code, and raw-text regex by code + ISIN.
  const pilotPresence: PilotPresenceCheck[] = funds.map((f) => {
    let parsedHits = 0;
    for (const r of rows) if (r.schemeCode === f.amfiSchemeCode) parsedHits += 1;
    // Raw regex by code: number bounded by start-of-line OR `;` OR newline on
    // either side, followed by `;` (the schemeCode is the leftmost field of
    // each scheme line in NAVAll format).
    const codeRe = new RegExp(`(?:^|[;\\n])\\s*${f.amfiSchemeCode}\\s*;`, "g");
    const isinRe = f.isin ? new RegExp(f.isin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : null;
    return {
      schemecode: f.schemecode,
      amfiSchemeCode: f.amfiSchemeCode,
      isin: f.isin,
      presentInParsedByCode: parsedHits,
      presentInRawByCode: regexCount(text, codeRe),
      presentInRawByIsin: isinRe ? regexCount(text, isinRe) : 0,
    };
  });

  return {
    distinctSchemeCodeCount: distinctCodes.size,
    distinctSchemeCodeSampleHead: distinctSeq.slice(0, 10),
    distinctSchemeCodeSampleTail: distinctSeq.slice(-10),
    sectionsFound,
    amcsFoundCount: amcsSet.size,
    amcsFoundSample,
    dateMin, dateMax, topDatesByCount,
    firstParsedRows,
    pilotPresence,
  };
}

async function runAmfiCrossCheck(
  funds: Array<{ schemecode: string; fundName: string; amfiSchemeCode: number; isin: string | null; series: SeriesPoint[] }>
): Promise<AmfiCrossCheck> {
  const windowTo = utcShiftToDDMMMYYYY(0);
  const windowFrom = utcShiftToDDMMMYYYY(AMFI_WINDOW_DAYS);
  const url = `${AMFI_HISTORY_BASE}?frmdt=${windowFrom}&todt=${windowTo}`;
  info(`[amfi] historical request ${windowFrom} → ${windowTo}`);
  const res = await politeFetch(url, 60_000);
  const diag = {
    attempted: true as const,
    url,
    requestedAt: res.requestedAt,
    httpStatus: res.status,
    contentType: res.contentType,
    bodyPreview: res.bodyPreview,
    windowFrom,
    windowTo,
  };
  if (!res.ok || !res.text || res.text.length < 200) {
    return {
      ...diag, reachable: false,
      error: res.error ?? `HTTP ${res.status ?? "?"} (bytes=${res.text?.length ?? 0})`,
      failureReason: res.error ? `network error: ${res.error}` : `HTTP ${res.status ?? "?"} or body too short (bytes=${res.text?.length ?? 0})`,
      rowsParsed: 0, results: [],
    };
  }

  let rows: ReturnType<typeof parseNavAll>;
  try {
    rows = parseNavAll(res.text);
  } catch (e) {
    return { ...diag, reachable: true, parseError: `parseNavAll threw: ${(e as Error).message}`, failureReason: "AMFI body received but parseNavAll failed", rowsParsed: 0, results: [] };
  }

  // Phase 3.2D: response diagnostics computed against the full pilot set, not
  // just the cross-check subset, so the report shows presence-by-code/by-ISIN
  // for every pilot fund regardless of how many we sliced for the comparison.
  const diagnostics = computeResponseDiagnostics(res.text, rows, funds.map((f) => ({ schemecode: f.schemecode, amfiSchemeCode: f.amfiSchemeCode, isin: f.isin })));

  // amfiSchemeCode → (isoDate → nav)
  const wanted = new Set(funds.map((f) => f.amfiSchemeCode));
  const byCode = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (!wanted.has(r.schemeCode)) continue;
    const iso = ddMMMyyyyToIso(r.date);
    if (!iso) continue;
    if (!byCode.has(r.schemeCode)) byCode.set(r.schemeCode, new Map());
    byCode.get(r.schemeCode)!.set(iso, r.nav);
  }

  const results: CrossCheckResult[] = [];
  for (const f of funds) {
    const amfiMap = byCode.get(f.amfiSchemeCode);
    const amfiPointsFound = amfiMap?.size ?? 0;
    // Compare against MFAPI only when we actually have an MFAPI series; an
    // empty series still yields amfiPointsFound so we learn AMFI reachability
    // and per-code presence even when MFAPI was down.
    const mfapiByDate = new Map(f.series.map((p) => [p.date, p.nav]));
    let compared = 0, within = 0, maxAbs = 0, maxPct = 0;
    if (amfiMap) {
      for (const [iso, amfiNav] of amfiMap) {
        const mfapiNav = mfapiByDate.get(iso);
        if (mfapiNav === undefined) continue;
        compared += 1;
        const absDiff = Math.abs(mfapiNav - amfiNav);
        const pctDiff = amfiNav !== 0 ? (absDiff / amfiNav) * 100 : 0;
        if (pctDiff <= NAV_TOLERANCE_PCT) within += 1;
        if (absDiff > maxAbs) maxAbs = absDiff;
        if (pctDiff > maxPct) maxPct = pctDiff;
      }
    }
    results.push({
      schemecode: f.schemecode, amfiSchemeCode: f.amfiSchemeCode, fundName: f.fundName,
      amfiPointsFound,
      comparedDates: compared, withinTolerance: within,
      matchRatePct: compared > 0 ? round2((within / compared) * 100) : 0,
      maxAbsDiff: compared > 0 ? round2(maxAbs) : null,
      maxPctDiff: compared > 0 ? round2(maxPct) : null,
    });
  }
  const parseError = rows.length === 0 ? "AMFI body received but parseNavAll returned 0 rows" : undefined;
  return { ...diag, reachable: true, parseError, rowsParsed: rows.length, results, diagnostics };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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

  // 1. MFAPI history per pilot fund.
  const fetchResults: FundFetchResult[] = [];
  const seriesByCode = new Map<string, SeriesPoint[]>();
  for (const f of pilot) {
    const url = `${MFAPI_BASE}/${f.amfiSchemeCode}`;
    info(`[mfapi] ${f.schemecode} → ${f.amfiSchemeCode} (${f.fundName})`);
    const res = await politeFetch(url, 45_000);
    const base: FundFetchResult = {
      schemecode: f.schemecode, fundName: f.fundName, classification: f.classification,
      amfiSchemeCode: f.amfiSchemeCode, isin: f.isin, matchConfidence: f.matchConfidence,
      status: "error",
      url, requestedAt: res.requestedAt, httpStatus: res.status, contentType: res.contentType, bodyPreview: res.bodyPreview,
      responseMs: res.ms,
      points: 0, firstDate: null, lastDate: null, latestNav: null, returns: {}, dataAvailability: {},
    };
    if (!res.ok || !res.text) {
      base.error = res.error ?? `HTTP ${res.status ?? "?"}`;
      base.failureReason = res.error ? `network error: ${res.error}` : `non-OK HTTP ${res.status ?? "?"}`;
      fetchResults.push(base);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    const parsed = parseMfapiSeries(res.text);
    if (parsed.series.length === 0) {
      base.error = parsed.parseError ?? "no usable NAV points in MFAPI response";
      base.parseError = parsed.parseError ?? undefined;
      base.failureReason = parsed.shapeOk
        ? `HTTP 200 but ${parsed.parseError}`
        : `HTTP 200 but response not in expected {meta,data} shape: ${parsed.parseError}`;
      fetchResults.push(base);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    seriesByCode.set(f.schemecode, parsed.series);
    const { returns, availability } = computeReturns(parsed.series);
    fetchResults.push({
      ...base, status: "ok",
      points: parsed.series.length, firstDate: parsed.series[0].date, lastDate: parsed.series[parsed.series.length - 1].date,
      latestNav: parsed.series[parsed.series.length - 1].nav, returns, dataAvailability: availability,
    });
    await sleep(POLITE_DELAY_MS);
  }

  const okResults = fetchResults.filter((r) => r.status === "ok");

  // 2. AMFI historical request — ALWAYS attempted (Phase 3.2C), keyed off ALL
  // pilot AMFI scheme codes (Phase 3.2D widened from the first 3 so the
  // per-pilot presence diagnostic covers every fund). Independent of MFAPI
  // success. ISIN is passed through for the response-diagnostics raw scan.
  const crossFunds = pilot.map((f) => ({
    schemecode: f.schemecode, fundName: f.fundName, amfiSchemeCode: f.amfiSchemeCode,
    isin: f.isin, series: seriesByCode.get(f.schemecode) ?? [],
  }));
  let crossCheck: AmfiCrossCheck;
  if (crossFunds.length === 0) {
    crossCheck = { attempted: false, reachable: false, error: "no pilot funds resolved", url: "", requestedAt: null, httpStatus: null, contentType: null, bodyPreview: null, windowFrom: "", windowTo: "", rowsParsed: 0, results: [] };
  } else {
    try {
      crossCheck = await runAmfiCrossCheck(crossFunds);
    } catch (e) {
      crossCheck = { attempted: true, reachable: false, error: (e as Error).message, failureReason: `runAmfiCrossCheck threw: ${(e as Error).message}`, url: "", requestedAt: null, httpStatus: null, contentType: null, bodyPreview: null, windowFrom: "", windowTo: "", rowsParsed: 0, results: [] };
    }
  }

  // 3. Verdict + recommendation.
  const periodKeys = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "since_inception"];
  const periodCoverage: Record<string, number> = {};
  for (const k of periodKeys) periodCoverage[k] = okResults.filter((r) => r.dataAvailability[k]).length;

  const crossCompared = crossCheck.results.reduce((s, r) => s + r.comparedDates, 0);
  const crossWithin = crossCheck.results.reduce((s, r) => s + r.withinTolerance, 0);
  const crossRatePct = crossCompared > 0 ? round2((crossWithin / crossCompared) * 100) : null;

  const verdict = {
    mfapiOk: okResults.length,
    mfapiFailed: fetchResults.length - okResults.length,
    mfapiUsable: okResults.length > 0,
    amfiCrossCheckReachable: crossCheck.reachable,
    crossCheckComparedDates: crossCompared,
    crossCheckWithinTolerancePct: crossRatePct,
    periodCoverage,
    summary: buildVerdictText(okResults.length, fetchResults.length, crossCheck, crossRatePct),
  };

  const recommendation = buildRecommendation(okResults.length, fetchResults.length, crossCheck, crossRatePct);

  const report = {
    meta: {
      generatedAt,
      dryRun: true,
      note: "Read-only dual-source historical NAV pilot. Not a production history file. Not wired to dashboard. MFAPI is a third-party AMFI mirror; AMFI is the source of truth.",
      pilotCount: pilot.length,
      mfapiBase: MFAPI_BASE,
      amfiHistoryBase: AMFI_HISTORY_BASE,
      navTolerancePct: NAV_TOLERANCE_PCT,
    },
    sourceSummary: {
      latestSnapshot: "src/data/snapshots/mf-latest-nav.json",
      historicalBackfillSource: "mfapi.in (third-party AMFI mirror)",
      crossCheckSource: "AMFI DownloadNAVHistoryReport_Po.aspx",
      missingPilotSchemecodes: missing,
    },
    pilotFunds: pilot.map((f) => ({ schemecode: f.schemecode, fundName: f.fundName, classification: f.classification, amfiSchemeCode: f.amfiSchemeCode, matchConfidence: f.matchConfidence })),
    mfapiResults: fetchResults,
    amfiCrossCheck: crossCheck,
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

  printSummary(verdict, crossCheck, periodCoverage, recommendation, fetchResults);

  // Exit non-zero only if NO usable historical data was obtained from EITHER
  // source (MFAPI series OR AMFI rows) — or the report could not be written.
  // The diagnostic report is always written first regardless.
  const anyHistorical = verdict.mfapiUsable || (crossCheck.reachable && crossCheck.rowsParsed > 0);
  if (!wrote) process.exit(1);
  if (!anyHistorical) { warn("no usable historical data from MFAPI or AMFI"); process.exit(1); }
}

function buildVerdictText(ok: number, total: number, cross: AmfiCrossCheck, crossRate: number | null): string {
  const parts = [`MFAPI: ${ok}/${total} pilot funds returned usable history.`];
  if (!cross.attempted) parts.push("AMFI historical not attempted (no pilot funds resolved).");
  else if (!cross.reachable) parts.push(`AMFI historical endpoint NOT reachable from runner (${cross.failureReason ?? cross.error}).`);
  else {
    const amfiPts = cross.results.reduce((s, r) => s + r.amfiPointsFound, 0);
    parts.push(`AMFI historical reachable: ${cross.rowsParsed} rows parsed, ${amfiPts} NAV points across ${cross.results.length} pilot codes.`);
    if (crossRate !== null) parts.push(`Overlap cross-check: ${crossRate}% within ${NAV_TOLERANCE_PCT}% tolerance.`);
    else parts.push("No MFAPI series to compare against (cross-check tolerance n/a).");
  }
  return parts.join(" ");
}

function buildRecommendation(ok: number, total: number, cross: AmfiCrossCheck, crossRate: number | null): string {
  const amfiUsable = cross.reachable && cross.rowsParsed > 0;
  // MFAPI entirely down.
  if (ok === 0) {
    if (amfiUsable) return "PIVOT TO AMFI: MFAPI returned no usable history (likely transient 502), BUT AMFI historical IS reachable from CI and returned rows for the pilot codes. Recommend Phase 3.2D — AMFI historical chunked backfill as primary, with MFAPI as a later cross-check/recovery source.";
    return "BLOCK: neither MFAPI nor AMFI historical produced usable data from CI. Inspect the captured contentType/bodyPreview for each (anti-bot HTML / 5xx / network) before choosing a source.";
  }
  if (ok < total) return `PROCEED WITH CARE: MFAPI usable for ${ok}/${total}. Backfill must record per-fund availability and fall back to AMFI historical for misses${amfiUsable ? " (AMFI historical confirmed reachable)" : ""}.`;
  if (crossRate !== null && crossRate >= 99) return "PROCEED: MFAPI full-coverage on pilot and agrees with AMFI within tolerance. Recommend a small MFAPI backfill batch with AMFI forward-accrual, cross-checked.";
  if (crossRate !== null) return `REVIEW: MFAPI full-coverage but only ${crossRate}% within tolerance vs AMFI. Inspect deltas before trusting MFAPI as backfill.`;
  return `PROCEED (MFAPI-only): MFAPI full-coverage on pilot; AMFI overlap cross-check not available (${amfiUsable ? "AMFI reachable but no MFAPI overlap dates" : cross.failureReason ?? "AMFI unreachable"}). Recommend retrying AMFI cross-check before a larger backfill.`;
}

function printSummary(
  verdict: { mfapiOk: number; mfapiFailed: number; amfiCrossCheckReachable: boolean; crossCheckComparedDates: number; crossCheckWithinTolerancePct: number | null },
  cross: AmfiCrossCheck,
  periodCoverage: Record<string, number>,
  recommendation: string,
  fetchResults: FundFetchResult[]
): void {
  info("================= NAV HISTORY PILOT SUMMARY =================");
  info(`MFAPI usable:   ${verdict.mfapiOk}  ·  failed: ${verdict.mfapiFailed}`);
  // One line per MFAPI fund so the logs alone show status + content-type.
  for (const r of fetchResults) {
    const tag = r.status === "ok" ? `ok pts=${r.points} ${r.firstDate}..${r.lastDate}` : `ERR ${r.failureReason ?? r.error}`;
    info(`   mfapi ${r.amfiSchemeCode} ${r.schemecode}: HTTP ${r.httpStatus ?? "-"} ct=${r.contentType ?? "-"} · ${tag}`);
  }
  info(`AMFI historical: attempted=${cross.attempted} reachable=${cross.reachable} HTTP=${cross.httpStatus ?? "-"} ct=${cross.contentType ?? "-"} rows=${cross.rowsParsed}`);
  if (cross.failureReason) info(`   AMFI failureReason: ${cross.failureReason}`);
  if (cross.bodyPreview && !cross.reachable) info(`   AMFI bodyPreview: ${cross.bodyPreview.slice(0, 200)}`);
  // Phase 3.2D response diagnostics — surface enough in the log alone to
  // diagnose why amfiPts can be 0 despite rows>0 (scheme universe / parser /
  // filter key). The full structure is in the artifact.
  if (cross.diagnostics) {
    const d = cross.diagnostics;
    info(`   AMFI diag: distinctSchemeCodes=${d.distinctSchemeCodeCount} sections=${d.sectionsFound.length} amcs=${d.amcsFoundCount} dateRange=${d.dateMin ?? "-"}..${d.dateMax ?? "-"}`);
    info(`   AMFI distinct-code head: ${d.distinctSchemeCodeSampleHead.join(",")}`);
    info(`   AMFI distinct-code tail: ${d.distinctSchemeCodeSampleTail.join(",")}`);
    info(`   AMFI sections found (first 5): ${d.sectionsFound.slice(0, 5).join(" | ") || "(none)"}`);
    info(`   AMFI AMCs found (first 5):     ${d.amcsFoundSample.slice(0, 5).join(" | ") || "(none)"}`);
    info(`   AMFI topDates: ${d.topDatesByCount.map((x) => `${x.date}=${x.count}`).join(" ")}`);
    if (d.firstParsedRows.length > 0) {
      const f = d.firstParsedRows[0];
      info(`   AMFI first parsed row: code=${f.schemeCode} name=${f.schemeName.slice(0, 60)} isin=${f.isin ?? "-"} date=${f.navDate}(iso=${f.isoDate ?? "-"})`);
    }
    for (const p of d.pilotPresence) info(`   pilot ${p.amfiSchemeCode} ${p.schemecode}: parsed=${p.presentInParsedByCode} rawByCode=${p.presentInRawByCode} rawByIsin=${p.presentInRawByIsin}`);
  }
  for (const r of cross.results) info(`   amfi-cmp ${r.amfiSchemeCode} ${r.schemecode}: amfiPts=${r.amfiPointsFound} compared=${r.comparedDates} within=${r.withinTolerance} maxΔ%=${r.maxPctDiff ?? "-"}`);
  info(`x-check within-tol: ${verdict.crossCheckWithinTolerancePct ?? "n/a"}%  (compared=${verdict.crossCheckComparedDates})`);
  info(`Period coverage (of usable funds): ${["1M", "3M", "6M", "1Y", "3Y", "5Y", "since_inception"].map((k) => `${k}=${periodCoverage[k]}`).join(" ")}`);
  info(`Recommendation: ${recommendation}`);
  info("============================================================");
  info(`Full report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((e) => {
  warn(`history pilot failed: ${(e as Error).message}`);
  process.exit(1);
});
