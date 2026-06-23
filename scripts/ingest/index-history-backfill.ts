/**
 * Phase 3.10A — Daily Nifty 500 history backfill from local CSVs.
 *
 * Reads every NIFTY-500 daily history CSV under manual-data/market/,
 * parses [date, close] rows, dedupes by date, sorts ascending, and
 * writes:
 *   • public/index-history/NIFTY_500.json
 *       — same shape as public/nav-history/{schemecode}.json so the
 *         Trends UI can consume it with the same fetch + rebase code
 *         path. Meta carries stage = "csv-backfill" (not the numeric
 *         stage used for funds — index history is on its own track).
 *   • src/data/snapshots/index-history-manifest.json
 *       — tiny per-index index (mirrors mf-history-manifest.json).
 *
 * CSV format — HEADER-DRIVEN (Date + Close located by column name), so both
 * manual sources parse:
 *   • nseindia.com export:  Date,Open,High,Low,Close,Shares Traded,Turnover
 *                           31-MAR-2020,6938.05,...            (UTF-8 BOM)
 *   • niftyindices.com PR:  "Index Name","Date","Open","High","Low","Close"
 *                           "NIFTY 500","31 Mar 2017",...,"7995.05"
 *
 * Validation rules — any failure rejects THAT row (not the whole run):
 *   • Date must parse from DD-MMM-YYYY to ISO YYYY-MM-DD
 *   • Close must be a finite number > 0
 *   • Duplicate dates: last one parsed wins per CSV; final dedupe is
 *     by-date across all files (later file's value for the same date
 *     overrides earlier — by sort order, the latest CSV wins on ties).
 *
 * No external fetches, no merge with prior snapshot — the CSV
 * directory is the source of truth. Atomic writes (temp + rename).
 *
 * Run: npm run ingest:index:backfill   (tsx scripts/ingest/index-history-backfill.ts)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const CSV_DIR = path.resolve(process.cwd(), "manual-data/market");
const HISTORY_DIR = path.resolve(process.cwd(), "public/index-history");
const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/index-history-manifest.json");

const INDEX_ID = "NIFTY_500";
const INDEX_NAME = "Nifty 500";
// Matches NSE export filenames: "NIFTY 500-01-04-2019-to-31-03-2020.csv".
const CSV_NAME_RE = /^NIFTY ?500.*\.csv$/i;

const MONTH_ABBR: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

interface RawRow { date: string; close: number }

/** Parse a date in either the nseindia.com ("31-MAR-2020") or niftyindices.com
 *  ("31 Mar 2017") style → ISO "YYYY-MM-DD". Null on bad input. */
function parseIndexDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTH_ABBR[m[2].toUpperCase()];
  const year = Number(m[3]);
  if (!day || !month || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Strip surrounding double-quotes (niftyindices quotes every field) + trim. */
function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).trim() : t;
}

/**
 * Parse one CSV body → ordered list of [isoDate, close] rows. HEADER-DRIVEN
 * (Date + Close columns located by name), so it handles BOTH manual sources:
 *   • nseindia.com export:  Date,Open,High,Low,Close,Shares Traded,Turnover…
 *                           rows  "31-MAR-2020,6938.05,…"   (Close at col 4)
 *   • niftyindices.com PR:  "Index Name","Date","Open","High","Low","Close"
 *                           rows  "…","31 Mar 2017","…","…","…","7995.05"
 * Strips the BOM + surrounding quotes; trims whitespace. Fields never contain
 * an embedded comma in either source, so a plain comma split is safe.
 */
function parseCsv(text: string): RawRow[] {
  const out: RawRow[] = [];
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return out;
  const header = lines[0].split(",").map((c) => unquote(c).toLowerCase());
  const dateIdx = header.findIndex((c) => c === "date");
  const closeIdx = header.findIndex((c) => c === "close");
  if (dateIdx < 0 || closeIdx < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => unquote(c));
    if (cols.length <= Math.max(dateIdx, closeIdx)) continue;
    const date = parseIndexDate(cols[dateIdx]);
    const close = Number(cols[closeIdx]);
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date, close });
  }
  return out;
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

async function main(): Promise<void> {
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), CSV_DIR)}/`);
  let entries: string[];
  try {
    entries = await fs.readdir(CSV_DIR);
  } catch (e) {
    warn(`could not read ${CSV_DIR}: ${(e as Error).message}`);
    process.exit(1);
  }
  const csvFiles = entries.filter((n) => CSV_NAME_RE.test(n)).sort();
  if (csvFiles.length === 0) {
    warn(`no NIFTY 500 CSVs found under ${CSV_DIR}`);
    process.exit(1);
  }
  info(`found ${csvFiles.length} NIFTY 500 CSV(s): ${csvFiles.join(", ")}`);

  // Aggregate across all CSVs. Dedup by date: last-seen-wins, and we
  // process files in sorted (lexicographic) order so the latest fiscal
  // year's value wins on any date that appears in two files.
  const byDate = new Map<string, number>();
  let totalParsed = 0;
  let totalSkipped = 0;
  const perFile: Array<{ file: string; rows: number; firstDate: string | null; lastDate: string | null }> = [];
  for (const f of csvFiles) {
    const p = path.join(CSV_DIR, f);
    let text: string;
    try { text = await fs.readFile(p, "utf8"); }
    catch (e) { warn(`could not read ${f}: ${(e as Error).message}`); continue; }
    const rows = parseCsv(text);
    const skipped = Math.max(0, text.split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1 - rows.length);
    totalParsed += rows.length;
    totalSkipped += skipped;
    for (const r of rows) byDate.set(r.date, r.close);
    const dates = rows.map((r) => r.date).sort();
    perFile.push({ file: f, rows: rows.length, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null });
    info(`   ${f}: parsed=${rows.length} skipped=${skipped} range=${dates[0] ?? "-"}..${dates[dates.length - 1] ?? "-"}`);
  }

  // Preserve dates the prior snapshot has BEYOND the CSV coverage — e.g. the
  // recent days appended by the live index forward-refresh, which the manual
  // financial-year CSVs don't include yet. The CSVs stay authoritative for the
  // dates they DO cover (we only fill gaps), so re-running this backfill never
  // regresses the forward-appended tail.
  try {
    const prev = JSON.parse(
      await fs.readFile(path.join(HISTORY_DIR, `${INDEX_ID}.json`), "utf8"),
    ) as { series?: Array<[string, number]> };
    let preserved = 0;
    for (const [d, c] of prev.series ?? []) {
      if (!byDate.has(d) && Number.isFinite(c) && c > 0) { byDate.set(d, c); preserved += 1; }
    }
    if (preserved > 0) info(`preserved ${preserved} date(s) from the prior snapshot beyond CSV coverage`);
  } catch { /* no prior snapshot — first run */ }

  // Validate the aggregate before writing.
  const dates = Array.from(byDate.keys()).sort();
  if (dates.length < 2) {
    warn(`only ${dates.length} valid row(s) parsed across all CSVs — refusing to write a degenerate history file`);
    process.exit(1);
  }
  const series: Array<[string, number]> = dates.map((d) => [d, byDate.get(d)!]);

  // Defensive: assert strictly ascending dates + finite positive closes.
  let prev = "";
  for (let i = 0; i < series.length; i++) {
    const [d, c] = series[i];
    if (i > 0 && d <= prev) {
      warn(`internal: non-ascending dates at row ${i}: ${d} <= ${prev}`); process.exit(1);
    }
    if (!Number.isFinite(c) || c <= 0) {
      warn(`internal: invalid close at ${d}: ${c}`); process.exit(1);
    }
    prev = d;
  }

  const firstDate = series[0][0];
  const lastDate = series[series.length - 1][0];

  // Write the per-index history file.
  const indexFile = {
    meta: {
      indexId: INDEX_ID,
      name: INDEX_NAME,
      source: "NSE (nseindia.com) + niftyindices.com historical CSV",
      stage: "csv-backfill",
      generatedAt,
      firstDate,
      lastDate,
      points: series.length,
      provenance: {
        csvDir: path.relative(process.cwd(), CSV_DIR),
        csvFiles: perFile,
        parser: "scripts/ingest/index-history-backfill.ts:parseCsv",
        notes: "Daily Nifty 500 close levels parsed from local NSE CSV exports. Phase 3.10A backfill — live daily refresh lands in Phase 3.10B/C/D.",
      },
    },
    series,
  };
  const historyPath = path.join(HISTORY_DIR, `${INDEX_ID}.json`);
  await atomicWriteJson(historyPath, indexFile);
  info(`wrote ${path.relative(process.cwd(), historyPath)}`);

  // Write the manifest (one entry; extensible to multiple indices later).
  const manifest = {
    stage: "csv-backfill",
    generatedAt,
    indices: [
      {
        indexId: INDEX_ID,
        name: INDEX_NAME,
        firstDate,
        lastDate,
        points: series.length,
        path: `/index-history/${INDEX_ID}.json`,
      },
    ],
  };
  await atomicWriteJson(MANIFEST_PATH, manifest);
  info(`wrote ${path.relative(process.cwd(), MANIFEST_PATH)}`);

  info(`================ INDEX HISTORY BACKFILL SUMMARY ================`);
  info(`index:        ${INDEX_ID} (${INDEX_NAME})`);
  info(`csv files:    ${csvFiles.length}`);
  info(`rows parsed:  ${totalParsed} (skipped: ${totalSkipped})`);
  info(`dedup points: ${series.length}`);
  info(`date range:   ${firstDate} → ${lastDate}`);
  info(`outputs:`);
  info(`   ${path.relative(process.cwd(), historyPath)}`);
  info(`   ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  info(`Daily live refresh: NOT implemented (Phase 3.10B/C/D).`);
  info(`================================================================`);
}

main().catch((e) => {
  warn(`index-history-backfill failed: ${(e as Error).message}`);
  process.exit(1);
});
