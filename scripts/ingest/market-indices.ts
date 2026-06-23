/**
 * Parse manually-uploaded NSE index history CSVs under
 * `manual-data/market/` and write a clean month-end snapshot to
 * `src/data/snapshots/market-indices-monthly.json`.
 *
 * Each CSV is the raw NSE daily-history export with header columns:
 *   Date, Open, High, Low, Close, Shares Traded, Turnover (₹ Cr)
 *
 * Filenames look like `NIFTY 500-01-04-2019-to-31-03-2020.csv` — we
 * pull the index name from the leading non-date portion of the
 * filename, dropping spaces (`NIFTY 500` → `NIFTY_500`). Multiple
 * files for the same index are concatenated; only the LAST trading
 * day of each calendar month is retained for the snapshot.
 *
 * Derived fields (return1m, return3m, return6m, return12m,
 * drawdownPct) are computed from the resulting per-index, per-month
 * series; nulls are emitted when there isn't enough trailing history.
 *
 * No external fetches, no merge with prior snapshot — the CSV
 * directory is the source of truth. Wholesale write.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeSnapshot } from "./utils";
import type {
  MarketIndexMonthlyRow,
  MarketIndexMonthlySnapshot,
} from "../../src/data/snapshots/types";

const CSV_DIR = path.resolve(process.cwd(), "manual-data/market");
const SNAPSHOT_FILE = "market-indices-monthly.json";

const MONTH_ABBR: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

interface DailyRow {
  date: string; // YYYY-MM-DD
  close: number;
}

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
 * Strip the BOM, then parse rows HEADER-DRIVEN (Date + Close columns located
 * by name) so both manual sources work: the nseindia.com export
 * (Date,Open,High,Low,Close,…; "31-MAR-2020") and the niftyindices.com PR
 * export ("Index Name","Date",…,"Close"; "31 Mar 2017"). Fields never contain
 * an embedded comma in either, so a plain comma split is safe.
 */
function parseCsv(text: string): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
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

/** Extract a canonical index id from the filename, for both manual sources:
 *    nseindia.com:     `NIFTY 500-DD-MM-YYYY-to-DD-MM-YYYY.csv`
 *    niftyindices.com: `NIFTY 500_Historical_PR_DDMMYYYYtoDDMMYYYY.csv`
 *  The index name is whatever precedes the first date / "_Historical_" token. */
function indexIdFromFilename(filename: string): string | null {
  const base = path.basename(filename, ".csv");
  const m =
    base.match(/^(.+?)-\d{2}-\d{2}-\d{4}-to-/) ??
    base.match(/^(.+?)_Historical_/i);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, "_").toUpperCase();
}

/** Keep only the last trading day per (YYYY-MM) bucket, return rows
 *  sorted ascending by month. */
function monthEndSeries(daily: DailyRow[]): { month: string; level: number }[] {
  const byMonth = new Map<string, DailyRow>();
  for (const row of daily) {
    const month = row.date.slice(0, 7); // YYYY-MM
    const prev = byMonth.get(month);
    if (!prev || row.date > prev.date) {
      byMonth.set(month, row);
    }
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, row]) => ({ month, level: row.close }));
}

/** Percent return between two non-zero levels, rounded to 2dp. */
function pctReturn(curr: number, prev: number | undefined | null): number | null {
  if (typeof prev !== "number" || !Number.isFinite(prev) || prev <= 0) return null;
  return Number((((curr - prev) / prev) * 100).toFixed(2));
}

/** Per-month rolling drawdown from the running peak of `level`. */
function rollingDrawdownPct(
  series: { month: string; level: number }[]
): (number | null)[] {
  let peak = -Infinity;
  return series.map((p) => {
    if (p.level > peak) peak = p.level;
    if (peak <= 0) return null;
    return Number((((p.level - peak) / peak) * 100).toFixed(2));
  });
}

async function main() {
  let entries: string[];
  try {
    entries = await fs.readdir(CSV_DIR);
  } catch {
    console.warn(
      `[ingest] market-indices: ${CSV_DIR} not found — skipping (snapshot preserved if it exists)`
    );
    return;
  }

  // Group CSV rows by index id; each year-file contributes its rows
  // and we de-dup by (index, date) before extracting month-end rows.
  const byIndex = new Map<string, Map<string, DailyRow>>();
  let processed = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".csv")) {
      skipped += 1;
      continue;
    }
    const indexId = indexIdFromFilename(entry);
    if (!indexId) {
      console.warn(
        `[ingest] market-indices: ${entry}: cannot derive index id from filename — skipping`
      );
      skipped += 1;
      continue;
    }
    const text = await fs.readFile(path.join(CSV_DIR, entry), "utf8");
    const rows = parseCsv(text);
    if (rows.length === 0) {
      console.warn(`[ingest] market-indices: ${entry}: no parseable rows`);
      skipped += 1;
      continue;
    }
    if (!byIndex.has(indexId)) byIndex.set(indexId, new Map());
    const dest = byIndex.get(indexId)!;
    for (const r of rows) dest.set(r.date, r);
    console.log(
      `[ingest] market-indices: ${entry}: parsed ${rows.length} daily rows for ${indexId}`
    );
    processed += 1;
  }

  const allRows: MarketIndexMonthlyRow[] = [];
  for (const [indexId, daily] of byIndex.entries()) {
    const dailyArr = Array.from(daily.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const monthEnds = monthEndSeries(dailyArr);
    if (monthEnds.length === 0) continue;
    const drawdowns = rollingDrawdownPct(monthEnds);
    const byMonth = new Map(monthEnds.map((p) => [p.month, p.level]));

    for (let i = 0; i < monthEnds.length; i++) {
      const { month, level } = monthEnds[i];
      // For the rolling returns we look up months by absolute label so
      // any gaps (e.g. a missing data file) propagate as nulls rather
      // than silently shifting the window.
      const monthsAgo = (n: number) => {
        const [y, m] = month.split("-").map(Number);
        const total = (y * 12 + (m - 1)) - n;
        const yy = Math.floor(total / 12);
        const mm = (total % 12) + 1;
        return `${yy}-${String(mm).padStart(2, "0")}`;
      };
      allRows.push({
        index: indexId,
        month,
        level,
        return1mPct: pctReturn(level, byMonth.get(monthsAgo(1))),
        return3mPct: pctReturn(level, byMonth.get(monthsAgo(3))),
        return6mPct: pctReturn(level, byMonth.get(monthsAgo(6))),
        return12mPct: pctReturn(level, byMonth.get(monthsAgo(12))),
        drawdownPct: drawdowns[i],
        status: "ok",
        source: "manual upload",
      });
    }
  }

  allRows.sort((a, b) =>
    a.index === b.index ? a.month.localeCompare(b.month) : a.index.localeCompare(b.index)
  );

  const snapshot: MarketIndexMonthlySnapshot = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "manual-data/market/",
      notes: `Month-end index levels with derived 1M / 3M / 6M / 12M returns and rolling drawdown. Last trading day of each calendar month per index. processedFiles=${processed}, skippedFiles=${skipped}, rows=${allRows.length}.`,
    },
    rows: allRows,
  };
  await writeSnapshot(SNAPSHOT_FILE, snapshot);
  console.log(
    `[ingest] market-indices: wrote ${allRows.length} row(s) to src/data/snapshots/${SNAPSHOT_FILE} from ${processed} CSV(s)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
