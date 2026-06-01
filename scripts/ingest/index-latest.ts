/**
 * Phase 3.10B — Latest Nifty 500 NAV-equivalent (daily close) fetcher.
 *
 * Fetches NSE's public daily-indices close CSV
 *   https://archives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
 * and writes the latest NIFTY 500 row to
 *   src/data/snapshots/index-latest.json
 *
 * Date detection (env-driven, mirrors nav-latest.ts's posture):
 *   • Default: today's IST calendar date.
 *   • INDEX_LATEST_DATE=YYYY-MM-DD overrides the target.
 *   • INDEX_LATEST_LOOKBACK_DAYS=N (default 7) — if today's CSV isn't
 *     published yet (404), or has no NIFTY 500 row, walk back N
 *     calendar days. NSE 404s naturally on weekends + market holidays,
 *     so the lookback walks past them transparently.
 *
 * Production safety (mirrors nav-latest.ts):
 *   • Keep-last-good: if every candidate date fails to yield a valid
 *     NIFTY 500 row, the script exits non-zero WITHOUT writing — the
 *     existing index-latest.json (if any) is left untouched. A
 *     scheduled workflow commit step will not run.
 *   • Atomic write (temp + rename) — a torn write leaves the prior
 *     snapshot in place.
 *
 * Run: npm run ingest:index:latest   (tsx scripts/ingest/index-latest.ts)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const OUTPUT_PATH = path.resolve(process.cwd(), "src/data/snapshots/index-latest.json");
const NSE_BASE = "https://archives.nseindia.com/content/indices/ind_close_all_";
const FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TARGET_INDEX_NAME = "Nifty 500";
const TARGET_INDEX_ID = "NIFTY_500";

const DEFAULT_LOOKBACK_DAYS = 7;

interface LatestRow {
  indexId: string;
  name: string;
  level: number;
  asOf: string; // ISO YYYY-MM-DD
  sourceUrl: string;
}

interface OutputSnapshot {
  generatedAt: string;
  source: string;
  feedDate: string; // ISO YYYY-MM-DD (mirrors the row's asOf)
  indices: LatestRow[];
  provenance: {
    attempts: Array<{ date: string; url: string; status: number | null; bytes: number | null; outcome: string }>;
    lookbackDaysTried: number;
    parser: string;
    notes: string;
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayIstIso(): string {
  // IST is UTC+5:30 (no DST). Shift the current UTC instant into IST, then
  // emit a YYYY-MM-DD calendar date in that timezone.
  const istMs = Date.now() + 5.5 * 3600_000;
  const d = new Date(istMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isoSubDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86_400_000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** ISO YYYY-MM-DD → NSE filename DDMMYYYY (no separators). */
function isoToNseFilenameDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

const MONTH_ABBR_TO_NUM: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** Parse NSE's in-CSV date forms back to ISO. Common shapes:
 *  "27-MAY-2025" / "27 May 2025" / "27-May-2025". Returns null on miss. */
function parseNseCsvDate(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = MONTH_ABBR_TO_NUM[m[2].toUpperCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

interface FetchOut {
  ok: boolean;
  status: number | null;
  text: string | null;
  bytes: number | null;
  error?: string;
}

async function fetchCsv(url: string): Promise<FetchOut> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/csv,text/plain,*/*",
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, bytes: text.length };
  } catch (e) {
    return { ok: false, status: null, text: null, bytes: null, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** Parse the NSE daily-indices close CSV and return the row whose index
 *  name matches TARGET_INDEX_NAME (case-insensitive, trimmed). Returns
 *  null when the row is absent OR the close value can't be parsed. */
function extractNifty500(csvText: string): { level: number; asOf: string | null } | null {
  // Strip BOM, split rows. NSE's CSV does not embed commas inside quotes
  // for this file format, so a plain comma split is sufficient.
  const lines = csvText
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  // Locate columns by header name (NSE has reordered them historically).
  const nameIdx = header.findIndex((c) => c === "index name");
  const dateIdx = header.findIndex((c) => c === "index date");
  const closeIdx = header.findIndex((c) => c === "closing index value");
  if (nameIdx < 0 || closeIdx < 0) return null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length <= Math.max(nameIdx, closeIdx)) continue;
    if (cols[nameIdx].toLowerCase() !== TARGET_INDEX_NAME.toLowerCase()) continue;
    const level = Number(cols[closeIdx]);
    if (!Number.isFinite(level) || level <= 0) return null;
    const asOf = dateIdx >= 0 && cols[dateIdx] ? parseNseCsvDate(cols[dateIdx]) : null;
    return { level, asOf };
  }
  return null;
}

async function atomicWriteJson(targetPath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await fs.rename(tmp, targetPath);
  } catch (e) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();
  const startDate =
    process.env.INDEX_LATEST_DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.INDEX_LATEST_DATE)
      ? process.env.INDEX_LATEST_DATE
      : todayIstIso();
  const lookbackDays = Math.max(
    0,
    Number(process.env.INDEX_LATEST_LOOKBACK_DAYS) || DEFAULT_LOOKBACK_DAYS,
  );

  info(`target start date (IST): ${startDate}  ·  lookback: ${lookbackDays} day(s)`);

  const attempts: Array<{ date: string; url: string; status: number | null; bytes: number | null; outcome: string }> = [];
  let hit: { date: string; url: string; row: { level: number; asOf: string | null } } | null = null;

  // Walk back day by day. NSE returns HTTP 404 for non-trading days
  // (weekends + market holidays), so the lookback transparently skips
  // those without needing a calendar.
  for (let offset = 0; offset <= lookbackDays; offset++) {
    const date = isoSubDays(startDate, offset);
    const fileDate = isoToNseFilenameDate(date);
    const url = `${NSE_BASE}${fileDate}.csv`;
    info(`[nse] ${url}`);
    const res = await fetchCsv(url);
    if (!res.ok || !res.text) {
      const outcome = res.error
        ? `network error: ${res.error}`
        : `HTTP ${res.status ?? "?"} (bytes=${res.bytes ?? 0})`;
      attempts.push({ date, url, status: res.status, bytes: res.bytes, outcome });
      info(`   miss · ${outcome}`);
      continue;
    }
    const row = extractNifty500(res.text);
    if (!row) {
      attempts.push({ date, url, status: res.status, bytes: res.bytes, outcome: `NIFTY 500 row not found in CSV (${res.bytes} bytes)` });
      info(`   miss · NIFTY 500 row not in CSV`);
      continue;
    }
    attempts.push({ date, url, status: res.status, bytes: res.bytes, outcome: `ok level=${row.level} asOf=${row.asOf ?? "(header missing)"}` });
    info(`   hit  · level=${row.level} asOf=${row.asOf ?? "(header missing)"}`);
    hit = { date, url, row };
    break;
  }

  if (!hit) {
    warn(`no NIFTY 500 row found across ${lookbackDays + 1} day(s) starting ${startDate}. Keeping previous snapshot; not writing.`);
    for (const a of attempts) warn(`  - ${a.date}: ${a.outcome}`);
    process.exit(1);
  }

  // Prefer the CSV's own as-of date; fall back to the filename date if
  // the header was missing/unparseable.
  const asOf = hit.row.asOf ?? hit.date;
  const snapshot: OutputSnapshot = {
    generatedAt,
    source: "NSE daily index close CSV",
    feedDate: asOf,
    indices: [
      {
        indexId: TARGET_INDEX_ID,
        name: TARGET_INDEX_NAME,
        level: hit.row.level,
        asOf,
        sourceUrl: hit.url,
      },
    ],
    provenance: {
      attempts,
      lookbackDaysTried: lookbackDays,
      parser: "scripts/ingest/index-latest.ts:extractNifty500",
      notes: "Phase 3.10B daily latest fetcher. Keep-last-good: never overwrites a good snapshot with empty/bad data.",
    },
  };

  await atomicWriteJson(OUTPUT_PATH, snapshot);
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  info(`================ INDEX LATEST SNAPSHOT SUMMARY ================`);
  info(`target start date (IST):  ${startDate}`);
  info(`hit:                      ${asOf}  ·  level=${hit.row.level}`);
  info(`hit url:                  ${hit.url}`);
  info(`attempts:                 ${attempts.length} (last ${attempts[attempts.length - 1]?.outcome ?? "?"})`);
  info(`output:                   ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  info(`================================================================`);
}

main().catch((e) => {
  warn(`index-latest failed: ${(e as Error).message}`);
  process.exit(1);
});
