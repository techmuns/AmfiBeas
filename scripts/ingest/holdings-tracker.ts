/**
 * Scheme-wise equity-holdings refresh from the RupeeVest Mutual Fund Portfolio
 * Tracker (https://www.rupeevest.com/Mutual-Fund-Portfolio-Tracker).
 *
 * Each scheme's holdings come from the same JSON endpoint the tracker page uses:
 *   GET /home/get_mf_portfolio_tracker?schemecode=<code>
 *     -> { fund_info:[{ s_name, aumtotal, aumdate, classification }],
 *          month_name:[m0,m1,m2,m3],          // m0 = most recent (column labels)
 *          MonthwiseAUM:[{ aum }, ...],        // per-month total AUM ("-" for equity)
 *          stock_data:[ [ { fincode, noshares, percent_aum }, ... ], ... ], // per month
 *          stock_mapping:{ fincode: companyName }, ... (debt fields ignored) }
 *
 * The endpoint is session-gated (403 to a bare request), so — exactly like the
 * one-off bootstrap scraper that built this dataset — we drive a real browser:
 * load the tracker page once for cookies, then call the endpoint through the
 * browser context's request (shares cookies/origin) with AJAX headers.
 *
 * UNIVERSE — "based on the previous benchmark (> ₹500 Cr AUM)". We iterate the
 * funds already recorded in src/data/portfolio-tracker/index.json, which is
 * exactly the cohort that passed the > ₹500 Cr filter on the last full build
 * (meta.minAumCr = 500). So the monthly job touches the ~1.1k funds that matter,
 * not the full ~2.1k scheme list.
 *
 * MERGE, never clobber — the endpoint only exposes a short rolling window, so we
 * MERGE the freshly fetched month(s) into each existing snapshot (fresh data
 * wins for overlapping months; older months already on disk are preserved) and
 * recompute the UI's change arrows across the full merged window. History grows
 * forward, matching the repo's nav-history-forward convention. Cap with
 * HOLDINGS_MAX_MONTHS (default 18).
 *
 * SAFETY — per fund, a fetch/parse failure or an empty parse keeps the last-good
 * snapshot untouched (never wiped). parseTracker THROWS on an unrecognised
 * response rather than writing blanks. If EVERY attempted fund fails, the script
 * exits non-zero without rewriting the index, so the workflow's commit step is
 * skipped (keep-last-good, globally).
 *
 * MODES (env or argv):
 *   HOLDINGS_PROBE=1 | --probe   Fetch a few schemes, dump the raw JSON to
 *                                data/debug/ and print its shape. No writes.
 *   HOLDINGS_LIMIT=N | --limit N Only process the first N funds (test runs).
 *   HOLDINGS_DELAY_MS=N          Polite delay between requests (default 200).
 *   HOLDINGS_MAX_MONTHS=N        Cap merged window length (default 18).
 *
 * Run (needs `npx playwright install chromium`):
 *   npx tsx scripts/ingest/holdings-tracker.ts
 */
import { chromium, type APIRequestContext, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { info, warn, nowIso } from "./utils";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "src", "data", "portfolio-tracker", "index.json");
const DEBUG_DIR = path.join(ROOT, "data", "debug");

const ORIGIN = "https://www.rupeevest.com";
const PAGE_URL = `${ORIGIN}/Mutual-Fund-Portfolio-Tracker`;
const ENDPOINT = `${ORIGIN}/home/get_mf_portfolio_tracker`;
const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: PAGE_URL,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
};
const ARROW_LOGIC =
  "Per the tracker UI: arrow compares a month's share count to the next-older " +
  "month (up=increase, down=decrease, flat/none=no change). Oldest column shows " +
  "no arrow (flat/none). 'missing' = no holding reported that month.";

// ---- knobs ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
function argVal(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const PROBE = flag("probe") || process.env.HOLDINGS_PROBE === "1";
const LIMIT = Number(argVal("limit") ?? process.env.HOLDINGS_LIMIT ?? "0") || 0;
const DELAY_MS = Math.max(0, Number(process.env.HOLDINGS_DELAY_MS ?? "200") || 0);
const MAX_MONTHS = Math.max(1, Number(process.env.HOLDINGS_MAX_MONTHS ?? "18") || 18);
const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- shapes (mirror src/data/portfolio-tracker.ts) -----------------------
export interface IndexEntry {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  aumAsOf: string | null;
  rowCount: number;
  file: string | null;
}
interface IndexFile {
  meta: Record<string, unknown>;
  funds: IndexEntry[];
  errors?: unknown[];
}

export type Arrow = "up" | "down" | "flat/none" | "missing" | "unknown";
interface Cell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
  arrow: Arrow;
  arrow_raw: string | null;
}
interface Row {
  company_name: string;
  fincode: string;
  months: Record<string, Cell>;
}
interface MonthMeta {
  label: string;
  aumCr: string | number | null;
}
export interface FundPortfolio {
  meta: {
    source: string;
    endpoint: string;
    fund: string;
    schemecode: string;
    classification: string | null;
    aumTotalCr: number | null;
    aumAsOf: string | null;
    scrapedAt: string;
    months: MonthMeta[];
    section: string;
    extractionMethod: string;
    arrowLogic: string;
  };
  rows: Row[];
}

// Parser output: present cells only (no nulls, no arrows). The merge step
// null-fills the window and derives arrows.
interface ParsedCell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
}
interface ParsedRow {
  company_name: string;
  fincode: string;
  cells: Record<string, ParsedCell>;
}
export interface ParsedTracker {
  fund: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  months: MonthMeta[];
  rows: ParsedRow[];
  method: string;
}

// ---- small helpers -------------------------------------------------------
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** "Apr-26" -> "apr_26" (matches portfolio-tracker.ts monthSlug). */
function monthSlug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Apr-26" -> 202604 (sortable; descending = newest first). */
export function monthSortKey(label: string): number {
  const m = label.trim().toLowerCase().match(/^([a-z]{3})[^0-9]*'?(\d{2,4})$/);
  if (!m) return 0;
  const mo = MONTHS_LOOKUP[m[1]] ?? 0;
  let y = Number(m[2]);
  if (y < 100) y += 2000;
  return y * 100 + mo;
}

/** "May-26" -> ISO of the month's last day at 00:00 UTC ("2026-05-31T…"). */
export function monthEndIso(label: string | undefined): string | null {
  if (!label) return null;
  const m = label.trim().toLowerCase().match(/^([a-z]{3})[^0-9]*'?(\d{2,4})$/);
  if (!m) return null;
  const mo = MONTHS_LOOKUP[m[1]];
  if (!mo) return null;
  let y = Number(m[2]);
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, mo, 0)).toISOString();
}

/** Loose numeric coercion: "76,97,626" -> 7697626, "8.26%" -> 8.26, "-" -> null. */
export function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s₹%]/g, "");
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Indian digit grouping: 7697626 -> "76,97,626" (matches the tracker UI). */
export function indianFmt(n: number): string {
  const neg = n < 0;
  let s = String(Math.abs(Math.round(n)));
  if (s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    s = `${rest},${last3}`;
  }
  return neg ? `-${s}` : s;
}

/** Normalise "Apr-26", "April 2026", "Apr 26" -> canonical "Apr-26". */
export function canonMonthLabel(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^([a-z]{3,9})[^0-9]*'?(\d{2,4})$/);
  if (!m) return null;
  const mo = MONTHS_LOOKUP[m[1].slice(0, 3)];
  if (!mo) return null;
  let y = Number(m[2]);
  if (y >= 100) y = y % 100;
  const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[mo]}-${String(y).padStart(2, "0")}`;
}

/**
 * Faithful replication of the tracker UI's incr/decr/nochange logic.
 * shares[0] = most recent month … shares[n-1] = oldest. `i` is the month index.
 */
export function arrowFor(shares: (number | null)[], i: number): Arrow {
  const cur = shares[i];
  if (cur == null) return "missing";
  if (i >= shares.length - 1) return "flat/none"; // oldest column: no arrow
  const prev = shares[i + 1];
  if (prev == null) return "up"; // appeared this month (nothing older)
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "flat/none";
}

/** Stable identity for a holdings row across snapshots. */
function keyOf(r: { fincode?: string | null; company_name?: string | null }): string {
  const fc = String(r.fincode ?? "").trim();
  if (fc) return fc;
  return `name:${String(r.company_name ?? "").toLowerCase().trim()}`;
}

/** Filesystem-safe slug for a *new* holdings file ("DSP Flexi…(G)" → "dsp-flexi…-g"). */
function fundFileSlug(schemecode: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${schemecode}-${slug}.json`;
}

// ---- parse (JSON endpoint) -----------------------------------------------
/**
 * Parse the get_mf_portfolio_tracker JSON into present-cells-only rows. THROWS
 * on an unrecognised response so the caller keeps the last-good snapshot instead
 * of overwriting it with blanks. Accepts the parsed object or a raw JSON string.
 */
export function parseTracker(raw: unknown, schemecode: string): ParsedTracker {
  let data: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(
        `scheme ${schemecode}: response is not JSON (head=${JSON.stringify(raw.slice(0, 120))})`
      );
    }
  } else if (raw && typeof raw === "object") {
    data = raw as Record<string, unknown>;
  } else {
    throw new Error(`scheme ${schemecode}: empty/non-object response`);
  }

  const fundInfo = data.fund_info;
  const info = Array.isArray(fundInfo) ? (fundInfo[0] as Record<string, unknown>) : null;

  const monthLabelsRaw: string[] = (Array.isArray(data.month_name) ? data.month_name : [])
    .map((m: unknown) => String(m).trim())
    .filter((m: string) => m.length > 0);
  if (monthLabelsRaw.length === 0) {
    throw new Error(
      `scheme ${schemecode}: no month_name[] in response (keys=${Object.keys(data).slice(0, 12).join(",")})`
    );
  }

  const monthlyAum = (Array.isArray(data.MonthwiseAUM) ? data.MonthwiseAUM : []).map(
    (a: unknown) => (a && typeof a === "object" ? (a as Record<string, unknown>).aum ?? null : null)
  );
  const stockData = (Array.isArray(data.stock_data) ? data.stock_data : []) as unknown[][];
  const mapping = (data.stock_mapping ?? {}) as Record<string, string>;

  const months: MonthMeta[] = monthLabelsRaw.map((label, i) => ({
    label: canonMonthLabel(label) ?? label,
    aumCr: (monthlyAum[i] as string | number | null) ?? "-",
  }));
  const slugs = months.map((m) => monthSlug(m.label));

  const byFin = new Map<string, ParsedRow>();
  for (let i = 0; i < months.length; i++) {
    const monthArr = Array.isArray(stockData[i]) ? stockData[i] : [];
    for (const raw of monthArr) {
      const h = raw as Record<string, unknown>;
      if (!h || h.fincode == null) continue;
      const fin = String(h.fincode);
      let row = byFin.get(fin);
      if (!row) {
        row = { company_name: mapping[fin] ?? `#${fin}`, fincode: fin, cells: {} };
        byFin.set(fin, row);
      }
      const sharesNum = toNumOrNull(h.noshares);
      row.cells[slugs[i]] = {
        aum_pct_raw: h.percent_aum == null ? "" : String(h.percent_aum),
        aum_pct_num: toNumOrNull(h.percent_aum),
        shares_raw: sharesNum == null ? "" : indianFmt(sharesNum),
        shares_num: sharesNum,
      };
    }
  }

  return {
    fund: (info?.s_name as string) ?? null,
    classification: (info?.classification as string) ?? null,
    aumTotalCr: toNumOrNull(info?.aumtotal),
    months,
    rows: [...byFin.values()],
    method: "json-endpoint",
  };
}

// ---- merge ---------------------------------------------------------------
export function mergeHoldings(
  existing: FundPortfolio | null,
  parsed: ParsedTracker,
  entry: IndexEntry
): FundPortfolio {
  // Union of month labels (existing + fresh), newest first, capped.
  const labelBySlug = new Map<string, string>();
  const aumByLabel = new Map<string, string | number | null>();
  for (const m of existing?.meta.months ?? []) {
    labelBySlug.set(monthSlug(m.label), m.label);
    aumByLabel.set(m.label, m.aumCr);
  }
  for (const m of parsed.months) {
    labelBySlug.set(monthSlug(m.label), m.label);
    if (m.aumCr !== "-" && m.aumCr != null) aumByLabel.set(m.label, m.aumCr);
    else if (!aumByLabel.has(m.label)) aumByLabel.set(m.label, "-");
  }
  const orderedSlugs = [...labelBySlug.keys()]
    .sort((a, b) => monthSortKey(labelBySlug.get(b)!) - monthSortKey(labelBySlug.get(a)!))
    .slice(0, MAX_MONTHS);
  const orderedLabels = orderedSlugs.map((s) => labelBySlug.get(s)!);
  const freshSlugs = new Set(parsed.months.map((m) => monthSlug(m.label)));

  // Merge present cells by stable key; fresh wins on overlapping months only.
  const byKey = new Map<string, { company_name: string; fincode: string; cells: Record<string, ParsedCell> }>();
  for (const r of existing?.rows ?? []) {
    const cells: Record<string, ParsedCell> = {};
    for (const [slug, c] of Object.entries(r.months)) {
      if (c.shares_num == null && c.aum_pct_num == null) continue; // drop disk null-fill
      cells[slug] = {
        aum_pct_raw: c.aum_pct_raw,
        aum_pct_num: c.aum_pct_num,
        shares_raw: c.shares_raw,
        shares_num: c.shares_num,
      };
    }
    byKey.set(keyOf(r), { company_name: r.company_name, fincode: r.fincode, cells });
  }
  for (const r of parsed.rows) {
    const k = keyOf(r);
    let cur = byKey.get(k);
    if (!cur) {
      cur = { company_name: r.company_name, fincode: r.fincode, cells: {} };
      byKey.set(k, cur);
    } else if (!cur.fincode && r.fincode) {
      cur.fincode = r.fincode;
    }
    // Fresh is authoritative for the months it covers: clear then re-apply so a
    // holding dropped this month doesn't linger from the prior overlap fetch.
    for (const slug of freshSlugs) delete cur.cells[slug];
    for (const [slug, c] of Object.entries(r.cells)) cur.cells[slug] = { ...c };
  }

  // Build the full-grid output (null-fill the window) + faithful arrows.
  const rows: Row[] = [];
  for (const cur of byKey.values()) {
    if (!orderedSlugs.some((s) => cur.cells[s] !== undefined)) continue; // nothing in window
    const shrArr = orderedSlugs.map((s) => cur.cells[s]?.shares_num ?? null);
    const months: Record<string, Cell> = {};
    orderedSlugs.forEach((slug, i) => {
      const c = cur.cells[slug];
      const pctNum = c?.aum_pct_num ?? null;
      const shrNum = c?.shares_num ?? null;
      months[slug] = {
        aum_pct_raw: pctNum == null ? "-" : c?.aum_pct_raw || String(pctNum),
        aum_pct_num: pctNum,
        shares_raw: shrNum == null ? "-" : c?.shares_raw || indianFmt(shrNum),
        shares_num: shrNum,
        arrow: arrowFor(shrArr, i),
        arrow_raw: null,
      };
    });
    rows.push({ company_name: cur.company_name, fincode: cur.fincode, months });
  }

  // Sort by latest-month % of AUM, descending.
  const latestSlug = orderedSlugs[0];
  const latestPct = (r: Row) => r.months[latestSlug]?.aum_pct_num ?? -1;
  rows.sort((a, b) => latestPct(b) - latestPct(a));

  const newest = orderedLabels[0];
  return {
    meta: {
      source: existing?.meta.source ?? PAGE_URL,
      endpoint: `${ENDPOINT}?schemecode=${entry.schemecode}`,
      fund: existing?.meta.fund ?? parsed.fund ?? entry.fundName ?? entry.name,
      schemecode: String(entry.schemecode),
      classification: parsed.classification ?? existing?.meta.classification ?? entry.classification ?? null,
      aumTotalCr: parsed.aumTotalCr ?? existing?.meta.aumTotalCr ?? entry.aumTotalCr ?? null,
      aumAsOf: monthEndIso(newest) ?? existing?.meta.aumAsOf ?? entry.aumAsOf ?? null,
      scrapedAt: nowIso(),
      months: orderedLabels.map((l) => ({ label: l, aumCr: aumByLabel.get(l) ?? "-" })),
      section: existing?.meta.section ?? "Equity Holdings",
      extractionMethod: parsed.method ?? existing?.meta.extractionMethod ?? "json-endpoint",
      arrowLogic: existing?.meta.arrowLogic ?? ARROW_LOGIC,
    },
    rows,
  };
}

// ---- fetch (browser session) ---------------------------------------------
async function getJson(
  req: APIRequestContext,
  schemecode: string
): Promise<{ ok: boolean; status: number; body: string; json: unknown | null }> {
  const url = `${ENDPOINT}?schemecode=${encodeURIComponent(schemecode)}`;
  try {
    const res = await req.get(url, { headers: AJAX_HEADERS, timeout: FETCH_TIMEOUT_MS });
    const body = await res.text();
    if (!res.ok()) return { ok: false, status: res.status(), body, json: null };
    try {
      return { ok: true, status: res.status(), body, json: JSON.parse(body) };
    } catch {
      return { ok: false, status: res.status(), body, json: null };
    }
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message, json: null };
  }
}

async function refreshSession(page: Page): Promise<void> {
  try {
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    warn(`session refresh failed: ${(e as Error).message}`);
  }
}

/** Fetch one scheme, refreshing the session and retrying on 403/5xx/network. */
async function fetchScheme(
  req: APIRequestContext,
  page: Page,
  schemecode: string
): Promise<{ ok: boolean; status: number; body: string; json: unknown | null }> {
  let r = await getJson(req, schemecode);
  for (let attempt = 1; !r.ok && attempt <= FETCH_RETRIES; attempt++) {
    if (r.status === 403 || r.status === 0 || r.status >= 500) await refreshSession(page);
    await sleep(500 * attempt);
    r = await getJson(req, schemecode);
  }
  return r;
}

async function withSession<T>(fn: (req: APIRequestContext, page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    const page = await ctx.newPage();
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
    info("tracker page loaded (session cookies established)");
    return await fn(ctx.request, page);
  } finally {
    await browser.close();
  }
}

// ---- probe ---------------------------------------------------------------
async function runProbe(universe: IndexEntry[]): Promise<void> {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const n = Math.min(LIMIT || 3, universe.length);
  info(`PROBE mode — fetching ${n} scheme(s), dumping raw JSON, no writes.`);
  await withSession(async (req, page) => {
    for (let i = 0; i < n; i++) {
      const e = universe[i];
      const r = await fetchScheme(req, page, e.schemecode);
      const out = path.join(DEBUG_DIR, `holdings-probe-${e.schemecode}.json`);
      fs.writeFileSync(out, r.body, "utf8");
      info(`  ${e.schemecode} ${e.name} — status ${r.status}, ${r.body.length} bytes → ${path.relative(ROOT, out)}`);
      if (r.json && typeof r.json === "object") {
        info(`    keys: ${Object.keys(r.json as object).slice(0, 12).join(", ")}`);
      } else {
        info(`    head: ${JSON.stringify(r.body.slice(0, 200))}`);
      }
      try {
        const p = parseTracker(r.json ?? r.body, e.schemecode);
        info(
          `    parsed OK — fund=${JSON.stringify(p.fund)} aumCr=${p.aumTotalCr} ` +
            `months=[${p.months.map((m) => m.label).join(", ")}] rows=${p.rows.length}`
        );
      } catch (err) {
        warn(`    parse failed: ${(err as Error).message}`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  });
}

// ---- orchestrator --------------------------------------------------------
async function main(): Promise<void> {
  const index = readJson<IndexFile | null>(INDEX_PATH, null);
  if (!index || !Array.isArray(index.funds)) {
    warn(`could not read index at ${INDEX_PATH}; nothing to do.`);
    process.exit(1);
  }

  let universe = index.funds;
  if (LIMIT > 0) universe = universe.slice(0, LIMIT);
  info(
    `universe: ${universe.length} funds (previous > ₹500 Cr benchmark` +
      `${LIMIT ? `, limited to ${LIMIT}` : ""}); maxMonths=${MAX_MONTHS}`
  );

  if (PROBE) {
    await runProbe(universe);
    return;
  }

  const stats = { refreshed: 0, created: 0, keptEmpty: 0, keptFailed: 0, skipped: 0 };
  const errors: { schemecode: string; reason: string }[] = [];

  await withSession(async (req, page) => {
    let i = 0;
    for (const entry of universe) {
      i++;
      const r = await fetchScheme(req, page, entry.schemecode);
      if (!r.ok || r.json == null) {
        stats.keptFailed++;
        errors.push({ schemecode: entry.schemecode, reason: `fetch (status ${r.status})` });
        if (DELAY_MS) await sleep(DELAY_MS);
        continue;
      }

      let parsed: ParsedTracker;
      try {
        parsed = parseTracker(r.json, entry.schemecode);
      } catch (e) {
        stats.keptFailed++;
        errors.push({ schemecode: entry.schemecode, reason: `parse: ${(e as Error).message}` });
        if (DELAY_MS) await sleep(DELAY_MS);
        continue;
      }

      if (parsed.rows.length === 0) {
        stats[entry.file ? "keptEmpty" : "skipped"]++; // never wipe an existing snapshot
        if (DELAY_MS) await sleep(DELAY_MS);
        continue;
      }

      const existingPath = entry.file ? path.join(ROOT, "public", entry.file) : null;
      const existing =
        existingPath && fs.existsSync(existingPath)
          ? readJson<FundPortfolio | null>(existingPath, null)
          : null;

      const merged = mergeHoldings(existing, parsed, entry);
      const file = entry.file ?? `holdings/${fundFileSlug(entry.schemecode, merged.meta.fund)}`;
      const outPath = path.join(ROOT, "public", file);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

      entry.file = file;
      entry.rowCount = merged.rows.length;
      entry.aumTotalCr = merged.meta.aumTotalCr;
      entry.aumAsOf = merged.meta.aumAsOf;
      entry.classification = merged.meta.classification;

      stats[existing ? "refreshed" : "created"]++;
      if ((stats.refreshed + stats.created) % 50 === 0) {
        info(`  …${i}/${universe.length} processed (refreshed ${stats.refreshed}, created ${stats.created})`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  });

  const succeeded = stats.refreshed + stats.created;
  info(
    `done — refreshed ${stats.refreshed}, created ${stats.created}, ` +
      `kept-empty ${stats.keptEmpty}, kept-failed ${stats.keptFailed}, skipped ${stats.skipped}`
  );
  if (errors.length) {
    warn(`${errors.length} fund(s) failed; first few:`);
    for (const e of errors.slice(0, 8)) warn(`  ${e.schemecode}: ${e.reason}`);
  }

  // Global keep-last-good: nothing succeeded → leave the index untouched + fail.
  if (succeeded === 0) {
    warn(`no funds refreshed (attempted ${universe.length}); leaving index untouched.`);
    process.exit(1);
  }

  const newestAsOf = index.funds
    .map((f) => f.aumAsOf)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  index.funds.sort((a, b) => (b.aumTotalCr ?? -1) - (a.aumTotalCr ?? -1));
  index.meta.generatedAt = nowIso();
  if (newestAsOf) index.meta.holdingsAsOf = newestAsOf;
  index.meta.lastHoldingsRefresh = {
    at: nowIso(),
    attempted: universe.length,
    refreshed: stats.refreshed,
    created: stats.created,
    keptEmpty: stats.keptEmpty,
    keptFailed: stats.keptFailed,
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n", "utf8");
  info(`index updated → ${path.relative(ROOT, INDEX_PATH)} (holdingsAsOf=${newestAsOf ?? "n/a"})`);
}

// Import-safe: the synthetic test imports parseTracker / mergeHoldings / helpers
// and must NOT trigger a real run. Only invoke main() when executed directly.
const _argv1 = process.argv[1] ?? "";
const _isEntry =
  _argv1.endsWith("/holdings-tracker.ts") ||
  _argv1.endsWith("\\holdings-tracker.ts") ||
  _argv1.endsWith("/holdings-tracker.js") ||
  _argv1.endsWith("\\holdings-tracker.js");
if (_isEntry) {
  main().catch((e) => {
    warn(`fatal: ${(e as Error).stack ?? (e as Error).message}`);
    process.exit(1);
  });
}
