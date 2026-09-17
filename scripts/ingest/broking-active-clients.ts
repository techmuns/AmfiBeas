/**
 * NSE "active clients per member (broker)" monthly refresh — the live feed for
 * the Broking / Capital Markets tab.
 *
 * NSE publishes the number of active clients (traded at least once in the last
 * 12 months) per trading member every month. There is NO clean static archive
 * for it (unlike the ind_close_all index CSV) — it is served only through
 * www.nseindia.com, which is Akamai bot-walled: a bare fetch gets a 403. So,
 * exactly like the schemewise-holdings scraper, we drive a real browser to
 * establish a session, then call the data endpoint through the browser context
 * (which shares the Akamai cookies and origin).
 *
 * The exact JSON endpoint NSE's active-clients page uses is not documented and
 * cannot be seen from a bot-walled network, so this script is PROBE-FIRST:
 *
 *   MODE=probe  Load the NSE active-clients / all-reports pages in a real
 *               browser, capture every XHR/fetch response the page makes
 *               (url, status, content-type, a content preview) plus a direct
 *               try of each candidate endpoint, and dump it all to
 *               data/debug/broking-probe-*.json. No writes to the dataset.
 *               Run this ONCE on a GitHub Actions runner (where NSE is not
 *               blocked), read the artifact, and set NSE_ACTIVE_CLIENTS_URL to
 *               the endpoint that returns the member/active-client rows.
 *
 *   MODE=full   Fetch NSE_ACTIVE_CLIENTS_URL (or the built-in default once
 *               confirmed), parse the member rows, normalise broker names to
 *               their common display names, and write
 *               manual-data/broking/active-clients-YYYY-MM.csv (an official,
 *               non-sample file). `npm run build:broking` then regenerates the
 *               snapshot the tab renders.
 *
 * SAFETY (keep-last-good): any failure — blocked, endpoint moved, empty or
 * unrecognised response, too few rows — exits non-zero WITHOUT writing, so the
 * workflow's commit step is skipped and the existing data (sample or a prior
 * official month) is never overwritten with garbage.
 *
 * Env / argv:
 *   BROKING_MODE=probe|full        (or --probe)         default: full
 *   NSE_ACTIVE_CLIENTS_URL=<url>    endpoint override for full mode
 *   BROKING_MONTH=YYYY-MM          force the output month (default: prior month)
 *   BROKING_MIN_ROWS=N             minimum member rows to accept (default 10)
 *
 * Run (needs `npx playwright install chromium`):
 *   npx tsx scripts/ingest/broking-active-clients.ts --probe
 */
import { chromium, type APIRequestContext, type Page, type Response } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { info, warn } from "./utils";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "manual-data", "broking");
const DEBUG_DIR = path.join(ROOT, "data", "debug");

const ORIGIN = "https://www.nseindia.com";
// Pages that surface member / active-client data — loaded to establish the
// Akamai session and (in probe mode) to capture whatever API calls they fire.
const SEED_PAGES = [
  `${ORIGIN}/market-data/exchange-wise-active-members`,
  `${ORIGIN}/all-reports`,
  `${ORIGIN}/`,
];
// Candidate JSON endpoints to try directly in probe mode. The real one is
// confirmed from the captured traffic and then pinned via NSE_ACTIVE_CLIENTS_URL.
const CANDIDATE_ENDPOINTS = [
  `${ORIGIN}/api/exchange-wise-active-members`,
  `${ORIGIN}/api/active-members`,
  `${ORIGIN}/api/merged-daily-reports?key=favActiveClients`,
];

const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/javascript, text/csv, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: SEED_PAGES[0],
};
const FETCH_TIMEOUT_MS = 45_000;
// Short nav timeout: if NSE's edge is going to hang the connection (as it does
// from GitHub-runner IPs) we want the probe to fail fast, not sit on retries.
const NAV_TIMEOUT_MS = 20_000;

// ---- knobs ---------------------------------------------------------------
const argv = process.argv.slice(2);
const MODE = argv.includes("--probe") || process.env.BROKING_MODE === "probe" ? "probe" : "full";
const ENDPOINT_OVERRIDE = process.env.NSE_ACTIVE_CLIENTS_URL?.trim() || null;
const MIN_ROWS = Number(process.env.BROKING_MIN_ROWS) || 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Prior calendar month as YYYY-MM (NSE publishes a month's data early the next
 *  month), overridable with BROKING_MONTH. */
function targetMonth(): string {
  const env = process.env.BROKING_MONTH?.trim();
  if (env && /^\d{4}-\d{2}$/.test(env)) return env;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Broker-name normalisation — NSE lists full legal names; the tab wants the
// short, recognisable brand. Anything unmatched keeps a lightly-cleaned legal
// name so a new broker still shows up (just less prettily) rather than vanish.
// ---------------------------------------------------------------------------
const NAME_ALIASES: { pattern: RegExp; display: string }[] = [
  { pattern: /groww|nextbillion/i, display: "Groww" },
  { pattern: /zerodha/i, display: "Zerodha" },
  { pattern: /angel\s*one|angel\s*broking/i, display: "Angel One" },
  { pattern: /upstox|rksv/i, display: "Upstox" },
  { pattern: /icici\s*securit/i, display: "ICICI Securities" },
  { pattern: /kotak\s*securit/i, display: "Kotak Securities" },
  { pattern: /hdfc\s*securit/i, display: "HDFC Securities" },
  { pattern: /motilal\s*oswal/i, display: "Motilal Oswal" },
  { pattern: /5paisa|five\s*paisa/i, display: "5paisa" },
  { pattern: /paytm|nse\s*it.*paytm|one\s*97/i, display: "Paytm Money" },
  { pattern: /sbicap|sbi\s*cap|sbi\s*securit/i, display: "SBI Securities" },
  { pattern: /axis\s*securit|axis\s*direct/i, display: "Axis Securities" },
  { pattern: /iifl|india\s*infoline/i, display: "IIFL Securities" },
  { pattern: /sharekhan/i, display: "Sharekhan" },
  { pattern: /dhan|raise\s*financial/i, display: "Dhan" },
  { pattern: /fyers/i, display: "Fyers" },
  { pattern: /choice\s*equity|choice\s*broking/i, display: "Choice" },
  { pattern: /nuvama|edelweiss/i, display: "Nuvama" },
];

function displayName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  for (const a of NAME_ALIASES) if (a.pattern.test(name)) return a.display;
  // Fallback: trim common corporate suffixes for a cleaner label.
  return name
    .replace(/\b(private|pvt|limited|ltd|broking|securities|financial services|services)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/, "")
    .trim() || name;
}

// ---------------------------------------------------------------------------
// Flexible parse — the confirmed endpoint returns either JSON (array of member
// objects, possibly under a `data`/`rows` key) or CSV. Pull (member name,
// active-client count) from whatever shape it is.
// ---------------------------------------------------------------------------
interface Row {
  broker: string;
  activeClients: number;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/[^0-9.-]/g, ""));
  return NaN;
}

const NAME_KEYS = ["membername", "member_name", "member", "name", "tradingmember", "trading_member", "brokername", "broker"];
const CLIENT_KEYS = ["activeclients", "active_clients", "noofactiveclients", "clients", "activeclientcount", "count", "totalclients"];

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = obj[k];
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm in lower && lower[norm] != null && lower[norm] !== "") return lower[norm];
  }
  return undefined;
}

function parseJson(payload: unknown): Row[] {
  let arr: unknown[] = [];
  if (Array.isArray(payload)) arr = payload;
  else if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    const keyed = o.data ?? o.rows ?? o.records ?? o.result ?? o.members;
    if (Array.isArray(keyed)) arr = keyed;
  }
  const rows: Row[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const nameRaw = pick(rec, NAME_KEYS);
    const clientRaw = pick(rec, CLIENT_KEYS);
    if (nameRaw == null || clientRaw == null) continue;
    const clients = num(clientRaw);
    if (!String(nameRaw).trim() || !Number.isFinite(clients) || clients <= 0) continue;
    rows.push({ broker: displayName(String(nameRaw)), activeClients: Math.round(clients) });
  }
  return rows;
}

function parseCsv(text: string): Row[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const nameIdx = header.findIndex((h) => NAME_KEYS.some((k) => h.includes(k.replace(/[^a-z0-9]/g, ""))));
  const clientIdx = header.findIndex((h) => CLIENT_KEYS.some((k) => h.includes(k.replace(/[^a-z0-9]/g, ""))));
  if (nameIdx < 0 || clientIdx < 0) return [];
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const clients = num(cols[clientIdx]);
    if (!cols[nameIdx] || !Number.isFinite(clients) || clients <= 0) continue;
    rows.push({ broker: displayName(cols[nameIdx]), activeClients: Math.round(clients) });
  }
  return rows;
}

/** Merge duplicate display names (e.g. two legal entities → one brand). */
function coalesce(rows: Row[]): Row[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.broker, (by.get(r.broker) ?? 0) + r.activeClients);
  return [...by.entries()]
    .map(([broker, activeClients]) => ({ broker, activeClients }))
    .sort((a, b) => b.activeClients - a.activeClients);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
async function withSession<T>(fn: (req: APIRequestContext, page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    // NSE's Akamai edge resets HTTP/2 connections from headless Chromium
    // (ERR_HTTP2_PROTOCOL_ERROR) as a bot defence; forcing HTTP/1.1 sidesteps
    // its HTTP/2 frame fingerprinting. AutomationControlled off hides the
    // obvious webdriver flag.
    args: ["--disable-http2", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    const page = await ctx.newPage();
    return await fn(ctx.request, page);
  } finally {
    await browser.close();
  }
}

async function establish(page: Page, url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.waitForTimeout(2500);
      return true;
    } catch (e) {
      warn(`nav to ${url} failed (attempt ${attempt}): ${(e as Error).message}`);
      await sleep(1500 * attempt);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Probe — capture the traffic so the real endpoint can be identified.
// ---------------------------------------------------------------------------
async function runProbe(): Promise<void> {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const captured: {
    via: string;
    url: string;
    status: number;
    contentType: string;
    preview: string;
    looksRelevant: boolean;
    parsedRows: number;
  }[] = [];

  await withSession(async (req, page) => {
    const onResp = async (resp: Response) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] ?? "";
      // Only inspect data-ish responses to NSE APIs.
      if (!/nseindia\.com/.test(url)) return;
      if (!/json|csv|text\/plain|octet-stream/i.test(ct) && !/\/api\//.test(url)) return;
      let body = "";
      try {
        body = await resp.text();
      } catch {
        return;
      }
      const relevant = /member|active|client|broker|participant/i.test(url + body.slice(0, 4000));
      let parsedRows = 0;
      try {
        parsedRows = /json/i.test(ct) ? parseJson(JSON.parse(body)).length : parseCsv(body).length;
      } catch {
        /* not this shape */
      }
      captured.push({
        via: "network",
        url,
        status: resp.status(),
        contentType: ct,
        preview: body.slice(0, 600),
        looksRelevant: relevant,
        parsedRows,
      });
    };
    page.on("response", (r) => void onResp(r));

    for (const seed of SEED_PAGES) {
      info(`probe: loading ${seed}`);
      const ok = await establish(page, seed);
      const title = ok ? await page.title().catch(() => "?") : "-";
      info(`probe:   ${ok ? "LOADED" : "FAILED"} ${seed}${ok ? ` (title: ${JSON.stringify(title)})` : ""}`);
      await page.waitForTimeout(2000);
    }
    info(`probe: captured ${captured.length} NSE response(s) from page traffic`);
    page.off("response", (r) => void onResp(r));

    // Direct tries of the candidate endpoints through the established session.
    for (const url of CANDIDATE_ENDPOINTS) {
      try {
        const res = await req.get(url, { headers: AJAX_HEADERS, timeout: FETCH_TIMEOUT_MS });
        const body = await res.text();
        let parsedRows = 0;
        try {
          parsedRows = parseJson(JSON.parse(body)).length;
        } catch {
          parsedRows = parseCsv(body).length;
        }
        captured.push({
          via: "direct",
          url,
          status: res.status(),
          contentType: res.headers()["content-type"] ?? "",
          preview: body.slice(0, 600),
          looksRelevant: /member|active|client|broker/i.test(body.slice(0, 4000)),
          parsedRows,
        });
        info(`probe: GET ${url} -> ${res.status()} (${body.length} bytes, ${parsedRows} rows parsed)`);
      } catch (e) {
        info(`probe: GET ${url} failed: ${(e as Error).message}`);
      }
    }
  });

  const out = path.join(DEBUG_DIR, "broking-probe.json");
  fs.writeFileSync(out, JSON.stringify(captured, null, 2), "utf8");
  info("================ BROKING PROBE SUMMARY ================");
  const ranked = [...captured].sort((a, b) => b.parsedRows - a.parsedRows);
  for (const c of ranked.slice(0, 25)) {
    info(`  [${c.parsedRows.toString().padStart(3)} rows] ${c.status} ${c.via.padEnd(7)} ${c.url.slice(0, 110)}`);
  }
  const best = ranked.find((c) => c.parsedRows >= MIN_ROWS);
  if (best) {
    info(`\n  LIKELY ENDPOINT → ${best.url}`);
    info(`  Set NSE_ACTIVE_CLIENTS_URL to it and re-run in full mode.`);
  } else {
    warn("  No captured response parsed into member rows. Inspect the artifact's previews.");
  }
  info(`  Full capture → ${path.relative(ROOT, out)}`);
  info("======================================================");
}

// ---------------------------------------------------------------------------
// Full — fetch the confirmed endpoint and write the official monthly CSV.
// ---------------------------------------------------------------------------
async function fetchRows(): Promise<Row[]> {
  if (!ENDPOINT_OVERRIDE) {
    warn(
      "NSE_ACTIVE_CLIENTS_URL is not set. Run this workflow in `probe` mode first " +
        "to discover the endpoint (the run uploads a broking-probe artifact), then " +
        "set NSE_ACTIVE_CLIENTS_URL and run again."
    );
    return [];
  }
  return withSession(async (req, page) => {
    await establish(page, SEED_PAGES[0]);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await req.get(ENDPOINT_OVERRIDE, { headers: AJAX_HEADERS, timeout: FETCH_TIMEOUT_MS });
        const body = await res.text();
        if (res.status() === 403 || res.status() >= 500 || !body) {
          warn(`fetch ${ENDPOINT_OVERRIDE} -> ${res.status()} (attempt ${attempt}); refreshing session`);
          await establish(page, SEED_PAGES[attempt % SEED_PAGES.length]);
          await sleep(800 * attempt);
          continue;
        }
        const ct = res.headers()["content-type"] ?? "";
        const rows = /json/i.test(ct) || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")
          ? parseJson(JSON.parse(body))
          : parseCsv(body);
        return coalesce(rows);
      } catch (e) {
        warn(`fetch attempt ${attempt} failed: ${(e as Error).message}`);
        await sleep(800 * attempt);
      }
    }
    return [];
  });
}

async function runFull(): Promise<void> {
  const rows = await fetchRows();
  if (rows.length < MIN_ROWS) {
    warn(`only ${rows.length} member rows (< ${MIN_ROWS} required) — keeping existing data, not writing.`);
    process.exit(1);
  }
  const month = targetMonth();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `active-clients-${month}.csv`);
  const csv = ["broker,activeClients", ...rows.map((r) => `${r.broker},${r.activeClients}`)].join("\n") + "\n";
  fs.writeFileSync(file, csv, "utf8");
  info(`wrote ${path.relative(ROOT, file)} — ${rows.length} brokers, ${month}`);
  info("================ ACTIVE CLIENTS ================");
  for (const r of rows.slice(0, 15)) {
    info(`  ${r.broker.padEnd(20)} ${(r.activeClients / 1e5).toFixed(1).padStart(8)} L`);
  }
  info("  (run `npm run build:broking` to refresh the snapshot)");
  info("===============================================");
}

async function main(): Promise<void> {
  info(`broking active-clients: mode=${MODE}${ENDPOINT_OVERRIDE ? ` endpoint=${ENDPOINT_OVERRIDE}` : ""}`);
  if (MODE === "probe") await runProbe();
  else await runFull();
}

main().catch((e) => {
  warn(`broking-active-clients failed: ${(e as Error).message}`);
  process.exit(1);
});
