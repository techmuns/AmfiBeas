/**
 * Phase 3.10C.1 — Daily NIFTY 500 gap catch-up.
 *
 * Fills missing trading days between the current per-index history
 * lastDate and a target end date by fetching one NSE daily-index-close
 * CSV per candidate date and appending validated NIFTY 500 rows.
 *
 * Reads:
 *   • public/index-history/NIFTY_500.json          (existing series — the floor)
 *   • src/data/snapshots/index-latest.json          (optional — used to
 *                                                    default the end date)
 *   • src/data/snapshots/index-history-manifest.json
 *
 * Date range (env-driven, mirrors index-latest.ts's posture):
 *   • start = INDEX_CATCHUP_START || (history.lastDate + 1 calendar day)
 *   • end   = INDEX_CATCHUP_END   || index-latest.asOf || today's IST date
 *   • If start > end: clean no-op exit (nothing to catch up).
 *
 * Fetch policy:
 *   • HTTP 404      → skip (file not published → weekend / market holiday /
 *                     future date). Recorded as "skipped404" in the report.
 *   • HTTP 200      → parse + validate + queue for append.
 *   • HTTP 403/5xx  → fail-loud. A non-404 error from NSE archives almost
 *                     always means our IP is blocked or the service is
 *                     down; continuing would burn quota for no value and
 *                     could obscure the real fix.
 *   • Network error → fail-loud (timeout / DNS / etc).
 *
 * Production safety:
 *   • Atomic all-or-nothing write: every fetched day is validated in
 *     memory first; if any non-404 error occurs mid-walk, the script
 *     exits non-zero WITHOUT writing — existing history is untouched
 *     (keep-last-good).
 *   • Strictly ascending dates, no duplicates, finite positive levels.
 *   • firstDate unchanged.
 *   • Atomic temp + rename writes for both the per-index file and the
 *     manifest; manifest written AFTER the per-index file.
 *
 * Run: npm run ingest:index:history-catchup
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const LATEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/index-latest.json");
const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/index-history-manifest.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/index-history");
const TARGET_INDEX_ID = "NIFTY_500";
const TARGET_INDEX_NAME = "Nifty 500";

const NSE_BASE = "https://archives.nseindia.com/content/indices/ind_close_all_";
const FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Polite delay between requests. NSE archives are static files, but the
// catch-up may iterate ~60 days — keep traffic gentle.
const POLITE_DELAY_MS = 750;

// ---------------------------------------------------------------------------
// Types (kept inline to avoid over-refactoring; matches the schema written
// by Phase 3.10A's index-history-backfill.ts and updated by 3.10C's
// index-history-forward.ts.)
// ---------------------------------------------------------------------------

interface IndexHistoryFile {
  meta: {
    indexId: string;
    name: string;
    source: string;
    stage: string;
    generatedAt: string;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
    provenance?: {
      csvDir?: string;
      csvFiles?: unknown;
      parser?: string;
      notes?: string;
      forwardSource?: string;
      forwardAppends?: Array<{ asOf: string; level: number; feedDate?: string; appendedAt: string; latestSnapshotGeneratedAt?: string | null; via?: string }>;
    };
  };
  series: Array<[string, number]>;
}

interface ManifestEntry {
  indexId: string;
  name: string;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  path: string;
}
interface ManifestFile {
  stage: string;
  generatedAt: string;
  indices: ManifestEntry[];
}

interface LatestSnapshotShape {
  feedDate?: string;
  indices?: Array<{ indexId: string; asOf?: string }>;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayIstIso(): string {
  const istMs = Date.now() + 5.5 * 3600_000;
  const d = new Date(istMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isoAddDays(iso: string, days: number): string {
  return utcMsToIso(isoToUtcMs(iso) + days * 86_400_000);
}

function isoToNseFilenameDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

const MONTH_ABBR_TO_NUM: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function parseNseCsvDate(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = MONTH_ABBR_TO_NUM[m[2].toUpperCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
      headers: { "user-agent": USER_AGENT, accept: "text/csv,text/plain,*/*" },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, bytes: text.length };
  } catch (e) {
    return { ok: false, status: null, text: null, bytes: null, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** Parse the NSE daily-indices close CSV and return the NIFTY 500 row's
 *  (level, asOf-iso). Returns null when the row is absent or the close
 *  value can't be parsed. Same shape as index-latest.ts:extractNifty500
 *  (kept inline rather than shared to avoid over-refactoring two
 *  short scripts). */
function extractNifty500(csvText: string): { level: number; asOf: string | null } | null {
  const lines = csvText
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
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

interface Attempt {
  date: string;
  url: string;
  status: number | null;
  bytes: number | null;
  outcome: string;
}

async function main(): Promise<void> {
  const generatedAt = nowIso();

  // --- Read existing per-index history (the floor) -------------------------
  const historyPath = path.join(HISTORY_DIR, `${TARGET_INDEX_ID}.json`);
  let existing: IndexHistoryFile;
  try {
    existing = JSON.parse(await fs.readFile(historyPath, "utf8")) as IndexHistoryFile;
  } catch (e) {
    warn(`could not read ${path.relative(process.cwd(), historyPath)}: ${(e as Error).message}`);
    warn(`catch-up requires the per-index file to exist — run npm run ingest:index:backfill first.`);
    process.exit(1);
  }
  if (existing.meta.indexId !== TARGET_INDEX_ID) {
    warn(`history file indexId mismatch: expected ${TARGET_INDEX_ID}, got ${existing.meta.indexId}`);
    process.exit(1);
  }
  const existingLast = existing.meta.lastDate;
  if (!existingLast) {
    warn(`existing history file has no lastDate; refusing to catch up an empty series`);
    process.exit(1);
  }

  // --- Resolve start / end dates -------------------------------------------
  const startOverride = process.env.INDEX_CATCHUP_START && /^\d{4}-\d{2}-\d{2}$/.test(process.env.INDEX_CATCHUP_START)
    ? process.env.INDEX_CATCHUP_START : null;
  const endOverride = process.env.INDEX_CATCHUP_END && /^\d{4}-\d{2}-\d{2}$/.test(process.env.INDEX_CATCHUP_END)
    ? process.env.INDEX_CATCHUP_END : null;

  const start = startOverride ?? isoAddDays(existingLast, 1);

  let end: string;
  if (endOverride) {
    end = endOverride;
  } else {
    // Default end = index-latest.asOf when present; else today's IST date.
    let latestAsOf: string | null = null;
    try {
      const latest = JSON.parse(await fs.readFile(LATEST_PATH, "utf8")) as LatestSnapshotShape;
      const row = latest.indices?.find((i) => i.indexId === TARGET_INDEX_ID);
      if (row?.asOf && /^\d{4}-\d{2}-\d{2}$/.test(row.asOf)) latestAsOf = row.asOf;
    } catch { /* index-latest may not exist yet — fall through to today */ }
    end = latestAsOf ?? todayIstIso();
  }

  info(`history lastDate:       ${existingLast}`);
  info(`catch-up start:         ${start}${startOverride ? " (override)" : " (lastDate + 1 day)"}`);
  info(`catch-up end:           ${end}${endOverride ? " (override)" : ""}`);

  // Detect interior gaps — pairs of consecutive points more than a week
  // apart. Used purely for diagnostics: the script's *default* range
  // (lastDate + 1 → latest.asOf) only fills gaps AFTER lastDate, so a
  // pre-existing interior gap (e.g. a one-off forward-append that landed
  // far ahead of the previous lastDate) can be flagged with a clear
  // operator hint about how to pass an override.
  const interiorGaps: Array<{ from: string; to: string; days: number }> = [];
  for (let i = 1; i < existing.series.length; i++) {
    const a = existing.series[i - 1][0];
    const b = existing.series[i][0];
    const days = Math.floor((isoToUtcMs(b) - isoToUtcMs(a)) / 86_400_000);
    if (days > 7) interiorGaps.push({ from: a, to: b, days });
  }
  if (interiorGaps.length > 0) {
    info(`note: ${interiorGaps.length} interior gap(s) > 7 days detected:`);
    for (const g of interiorGaps.slice(0, 5)) {
      info(`        ${g.from} → ${g.to}  (${g.days} calendar day(s))`);
    }
    info(`        To FILL an interior gap, run with INDEX_CATCHUP_START=<day after the gap's left edge>`);
    info(`        and (optionally) INDEX_CATCHUP_END=<day at or before the gap's right edge>.`);
    info(`        Existing dates inside the range are auto-skipped as duplicates.`);
  }

  if (start > end) {
    info(`start > end → nothing to catch up (forward catch-up has no work to do).`);
    if (interiorGaps.length > 0 && !startOverride) {
      info(`But ${interiorGaps.length} interior gap(s) exist (see note above). Set INDEX_CATCHUP_START / INDEX_CATCHUP_END to fill them.`);
    }
    return;
  }
  // Sanity ceiling — a catch-up of more than ~400 days is almost certainly
  // a misconfiguration (the gap should be at most one or two months). Refuse
  // rather than burn through a year of NSE requests.
  const totalDays = Math.floor((isoToUtcMs(end) - isoToUtcMs(start)) / 86_400_000) + 1;
  if (totalDays > 400) {
    warn(`catch-up range ${start} → ${end} spans ${totalDays} days; refusing (cap = 400). Use index-history-backfill for large historical fills.`);
    process.exit(1);
  }

  // --- Walk every calendar day in [start, end] ----------------------------
  const attempts: Attempt[] = [];
  const queued: Array<{ asOf: string; level: number; sourceUrl: string }> = [];
  let skipped404 = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const existingDates = new Set(existing.series.map(([d]) => d));

  for (let cursor = start; cursor <= end; cursor = isoAddDays(cursor, 1)) {
    const fileDate = isoToNseFilenameDate(cursor);
    const url = `${NSE_BASE}${fileDate}.csv`;
    const res = await fetchCsv(url);
    if (res.status === 404) {
      attempts.push({ date: cursor, url, status: 404, bytes: res.bytes, outcome: "skip 404 (non-trading day / file unavailable)" });
      skipped404 += 1;
      info(`[nse] ${cursor}  404 (skipped)`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    if (!res.ok || !res.text) {
      // Anything other than 200/404 from NSE archives is a real signal
      // (likely IP block at 403, or service down). Fail loudly so the
      // operator can fix the root cause rather than wasting retries.
      const detail = res.error ? `network error: ${res.error}` : `HTTP ${res.status ?? "?"}`;
      attempts.push({ date: cursor, url, status: res.status, bytes: res.bytes, outcome: `FATAL ${detail}` });
      warn(`fatal at ${cursor}: ${detail}. Catch-up aborted; existing history left untouched.`);
      warn(`partial progress this run (NOT written): queued=${queued.length}, skipped404=${skipped404}, attempts=${attempts.length}.`);
      process.exit(1);
    }
    // HTTP 200: parse + validate the row.
    const row = extractNifty500(res.text);
    if (!row) {
      attempts.push({ date: cursor, url, status: 200, bytes: res.bytes, outcome: `invalid: NIFTY 500 row not found / not parseable (${res.bytes} bytes)` });
      skippedInvalid += 1;
      info(`[nse] ${cursor}  200 but NIFTY 500 row missing (skipped invalid)`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    const asOf = row.asOf ?? cursor;
    if (existingDates.has(asOf) || queued.some((q) => q.asOf === asOf)) {
      attempts.push({ date: cursor, url, status: 200, bytes: res.bytes, outcome: `duplicate asOf ${asOf} (skipped)` });
      skippedDuplicate += 1;
      info(`[nse] ${cursor}  200 but asOf=${asOf} already present (skipped duplicate)`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    if (asOf < cursor) {
      // The CSV's own as-of date is older than the file's named date —
      // shouldn't happen, but defensive: don't trust it.
      attempts.push({ date: cursor, url, status: 200, bytes: res.bytes, outcome: `invalid: CSV asOf ${asOf} < file date ${cursor}` });
      skippedInvalid += 1;
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    attempts.push({ date: cursor, url, status: 200, bytes: res.bytes, outcome: `ok asOf=${asOf} level=${row.level}` });
    queued.push({ asOf, level: row.level, sourceUrl: url });
    info(`[nse] ${cursor}  ok asOf=${asOf} level=${row.level} (queued)`);
    await sleep(POLITE_DELAY_MS);
  }

  if (queued.length === 0) {
    info(`================ CATCH-UP SUMMARY ================`);
    info(`range:           ${start} → ${end}`);
    info(`attempts:        ${attempts.length}  ·  appended=0  ·  skipped404=${skipped404}  ·  invalid=${skippedInvalid}  ·  duplicate=${skippedDuplicate}`);
    info(`nothing to append — existing history unchanged.`);
    info(`==================================================`);
    return;
  }

  // --- Build the merged series + validate end-to-end ---------------------
  // Phase 3.10C.1 bug fix: a naïve [...existing.series, ...queued] only
  // produces an ascending array when every queued asOf is strictly greater
  // than existing.lastDate. That holds for a routine forward catch-up but
  // FAILS when filling an INTERIOR gap — e.g. existing series ended at
  // 2026-03-30 then Phase 3.10C forward-appended only 2026-05-29, so the
  // existing series ends at 2026-05-29 even though 2026-03-31..2026-05-28
  // are missing. Catching those up appends rows whose asOf is LESS than
  // existing.lastDate, and the simple concatenation produces a
  // non-ascending series that the validator (correctly) rejects.
  //
  // The right model is a date-keyed map: seed with the existing series,
  // insert queued rows where they don't already exist (preserving existing
  // values on collision — the fetch loop also pre-filters duplicates), then
  // emit a sorted ascending series. The downstream validation walk stays
  // unchanged and acts as a safety net.
  const byDate = new Map<string, number>(existing.series);
  let mergeCollisions = 0;
  for (const q of queued) {
    if (byDate.has(q.asOf)) {
      // Pre-existing date — preserve the existing value (NO overwrite).
      // The fetch loop's existingDates check makes this branch defensive;
      // hitting it would indicate a queued row that bypassed that filter.
      mergeCollisions += 1;
      continue;
    }
    byDate.set(q.asOf, q.level);
  }
  const sortedDates = Array.from(byDate.keys()).sort();
  const merged: Array<[string, number]> = sortedDates.map((d) => [d, byDate.get(d)!]);

  const seen = new Set<string>();
  let prev = "";
  for (let i = 0; i < merged.length; i++) {
    const [d, v] = merged[i];
    if (seen.has(d)) { warn(`duplicate date detected at row ${i}: ${d}`); process.exit(1); }
    seen.add(d);
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      warn(`invalid value at ${d}: ${v}`); process.exit(1);
    }
    if (i > 0 && d <= prev) { warn(`non-ascending dates at row ${i}: ${d} <= ${prev}`); process.exit(1); }
    prev = d;
  }
  const newFirstDate = merged[0][0];
  const newLastDate = merged[merged.length - 1][0];
  if (existing.meta.firstDate !== null && newFirstDate !== existing.meta.firstDate) {
    warn(`firstDate changed across the catch-up: ${existing.meta.firstDate} → ${newFirstDate}`); process.exit(1);
  }

  // --- Write the per-index file --------------------------------------------
  const prevProvenance = existing.meta.provenance ?? {};
  const forwardAppends = Array.isArray(prevProvenance.forwardAppends)
    ? [...prevProvenance.forwardAppends]
    : [];
  // Phase 3.10C.1: each catch-up day is recorded with via:"catchup" so the
  // audit trail distinguishes single-day forward appends (Phase 3.10C) from
  // bulk catch-up fills.
  for (const q of queued) {
    forwardAppends.push({
      asOf: q.asOf,
      level: q.level,
      appendedAt: generatedAt,
      via: "catchup",
    });
  }
  const newFile: IndexHistoryFile = {
    ...existing,
    meta: {
      ...existing.meta,
      firstDate: newFirstDate,
      lastDate: newLastDate,
      points: merged.length,
      // Mirror the 3.10C semantics: once any forward / catch-up append has
      // happened, the stage tag carries the "+forward" suffix (idempotent —
      // we don't double-append the suffix on subsequent runs).
      stage: existing.meta.stage.includes("forward") ? existing.meta.stage : `${existing.meta.stage}+forward`,
      generatedAt,
      provenance: {
        ...prevProvenance,
        forwardSource: "NSE daily index close CSV (via scripts/ingest/index-history-catchup.ts)",
        forwardAppends,
        parser: prevProvenance.parser ?? "scripts/ingest/index-history-backfill.ts:parseCsv",
      },
    },
    series: merged,
  };
  await atomicWriteJson(historyPath, newFile);
  info(`wrote ${path.relative(process.cwd(), historyPath)}  (lastDate=${newLastDate} points=${merged.length})`);

  // --- Update manifest -----------------------------------------------------
  let manifest: ManifestFile;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as ManifestFile;
  } catch {
    manifest = { stage: "csv-backfill", generatedAt, indices: [] };
  }
  const newEntry: ManifestEntry = {
    indexId: TARGET_INDEX_ID,
    name: existing.meta.name,
    firstDate: newFirstDate,
    lastDate: newLastDate,
    points: merged.length,
    path: `/index-history/${TARGET_INDEX_ID}.json`,
  };
  const idx = manifest.indices.findIndex((e) => e.indexId === TARGET_INDEX_ID);
  if (idx >= 0) manifest.indices[idx] = newEntry;
  else manifest.indices.push(newEntry);
  manifest.stage = newFile.meta.stage;
  manifest.generatedAt = generatedAt;
  await atomicWriteJson(MANIFEST_PATH, manifest);
  info(`wrote ${path.relative(process.cwd(), MANIFEST_PATH)}`);

  const newDates = merged.length - existing.series.length;
  info(`================ CATCH-UP SUMMARY ================`);
  info(`range:             ${start} → ${end}  (${totalDays} calendar day(s))`);
  info(`fetched ok:        ${queued.length}`);
  info(`merge collisions:  ${mergeCollisions}  (queued dates already in existing — preserved existing values)`);
  info(`new dates landed:  ${newDates}  (= merged.length − existing.series.length)`);
  info(`skipped 404:       ${skipped404}  (non-trading days / unavailable files)`);
  info(`skipped invalid:   ${skippedInvalid}`);
  info(`skipped duplicate: ${skippedDuplicate}  (caught at fetch time before queue)`);
  info(`new range:         ${newFirstDate} → ${newLastDate}`);
  info(`new points:        ${merged.length}  (was ${existing.series.length})`);
  info(`stage:             ${newFile.meta.stage}`);
  info(`==================================================`);
}

main().catch((e) => {
  warn(`index-history-catchup failed: ${(e as Error).message}`);
  process.exit(1);
});
