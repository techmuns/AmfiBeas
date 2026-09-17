/**
 * Benchmark TRI (Total Return Index) estimate builder.
 *
 * The Active Fund Performance tab needs each category's fact-sheet benchmark
 * return to flag which schemes actually beat their index. Fact sheets quote the
 * TRI (total-return, dividends reinvested) variant — but niftyindices.com, the
 * only public source of TRI *levels*, blocks scripted access. NSE's daily
 * `ind_close_all` CSV, however, is reachable and carries both the price-return
 * close AND a per-index dividend-yield column for every benchmark we need.
 *
 * So we reconstruct a TRI *estimate* per index and horizon:
 *
 *     PRI CAGR   = (level_now / level_then) ^ (1/years) − 1
 *     div drag   = mean(divYield_now, divYield_then)              (annual, %)
 *     TRI CAGR≈  = (1 + PRI CAGR) · (1 + div drag) − 1
 *
 * This is an estimate, not the exact fact-sheet TRI (it assumes a steady
 * dividend yield reinvested annually), but for broad Nifty indices it lands
 * within a few tenths of a percent of the real figure — good enough to flag
 * beat/miss, and clearly labelled as an estimate in the UI. Fully automated:
 * no manual uploads, refreshes from a single reachable source.
 *
 * Anchors: the latest available trading day, then the trading day on/just
 * before that date minus 1 / 3 / 5 years. NSE 404s on non-trading days and
 * occasionally 403s (rate limiting), so each anchor walks back until a usable
 * CSV is found and each fetch is retried a few times.
 *
 * Output: public/nav-data/benchmark-tri.json (a static asset the tab fetches).
 * Run:    npm run build:benchmark-tri
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, warn, nowIso } from "./ingest/utils";

const OUTPUT_PATH = path.resolve(process.cwd(), "public/nav-data/benchmark-tri.json");
const NSE_BASE = "https://archives.nseindia.com/content/indices/ind_close_all_";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 45_000;
const RETRIES_PER_DATE = 6;
const WALK_BACK_DAYS = 12;
const PERIODS = [
  { key: "1Y", years: 1 },
  { key: "3Y", years: 3 },
  { key: "5Y", years: 5 },
] as const;

/** The benchmark indices we resolve, keyed by a stable id. `csvName` must match
 *  the NSE `ind_close_all` "Index Name" column exactly (case-insensitive). */
const INDICES: { id: string; csvName: string; label: string }[] = [
  { id: "NIFTY_500", csvName: "Nifty 500", label: "Nifty 500 TRI" },
  { id: "NIFTY_100", csvName: "Nifty 100", label: "Nifty 100 TRI" },
  { id: "NIFTY_LARGEMIDCAP_250", csvName: "NIFTY LargeMidcap 250", label: "Nifty LargeMidcap 250 TRI" },
  { id: "NIFTY_MIDCAP_150", csvName: "Nifty Midcap 150", label: "Nifty Midcap 150 TRI" },
  { id: "NIFTY_SMALLCAP_250", csvName: "Nifty Smallcap 250", label: "Nifty Smallcap 250 TRI" },
];

interface IndexRow {
  close: number;
  divYieldPct: number;
}
type DayMap = Map<string, IndexRow>;

// ---------------------------------------------------------------------------
// Date helpers (IST calendar, no DST)
// ---------------------------------------------------------------------------
function todayIstIso(): string {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function isoSubDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function isoSubYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y - years, m - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function isoToNseFilename(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------
async function fetchCsv(iso: string): Promise<string | null> {
  const url = `${NSE_BASE}${isoToNseFilename(iso)}.csv`;
  for (let attempt = 1; attempt <= RETRIES_PER_DATE; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/csv,text/plain,*/*" },
      });
      const text = await res.text();
      if (res.ok && text.length > 1000 && /index name/i.test(text)) return text;
      // 403 (rate limit) is worth another try; 404 (non-trading day) is not.
      if (res.status === 404) return null;
    } catch {
      /* network hiccup — retry */
    } finally {
      clearTimeout(t);
    }
    // Jittered backoff: NSE's edge 403s are transient, so wait longer each try.
    if (attempt < RETRIES_PER_DATE) await sleep(1500 * attempt + Math.floor(Math.random() * 800));
  }
  return null;
}

function parseDay(csvText: string): DayMap {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const nameIdx = header.findIndex((c) => c === "index name");
  const closeIdx = header.findIndex((c) => c === "closing index value");
  const divIdx = header.findIndex((c) => c.startsWith("div yield"));
  const map: DayMap = new Map();
  if (nameIdx < 0 || closeIdx < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length <= Math.max(nameIdx, closeIdx)) continue;
    const close = Number(cols[closeIdx]);
    const div = divIdx >= 0 ? Number(cols[divIdx]) : NaN;
    if (!Number.isFinite(close) || close <= 0) continue;
    map.set(cols[nameIdx].toLowerCase(), {
      close,
      divYieldPct: Number.isFinite(div) ? div : 0,
    });
  }
  return map;
}

/** Walk back from `startIso` until a CSV that contains every wanted index is
 *  found. Returns the resolved trading date and its parsed map. */
async function resolveTradingDay(startIso: string): Promise<{ iso: string; day: DayMap } | null> {
  for (let off = 0; off <= WALK_BACK_DAYS; off++) {
    const iso = isoSubDays(startIso, off);
    const csv = await fetchCsv(iso);
    if (!csv) continue;
    const day = parseDay(csv);
    const haveAll = INDICES.every((ix) => day.has(ix.csvName.toLowerCase()));
    if (day.size > 0 && haveAll) {
      info(`resolved ${iso} (${day.size} indices)`);
      return { iso, day };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const generatedAt = nowIso();
  const start = process.env.BENCHMARK_TRI_DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.BENCHMARK_TRI_DATE)
    ? process.env.BENCHMARK_TRI_DATE
    : todayIstIso();

  info(`latest anchor: walking back from ${start}`);
  const latest = await resolveTradingDay(start);
  if (!latest) {
    warn(`could not resolve a latest trading day from ${start}; keeping previous snapshot.`);
    process.exit(1);
  }

  // One anchor per horizon, each the trading day on/before (latest − N years).
  const anchors: Record<string, { iso: string; day: DayMap }> = {};
  for (const p of PERIODS) {
    const target = isoSubYears(latest.iso, p.years);
    info(`${p.key} anchor: walking back from ${target}`);
    const resolved = await resolveTradingDay(target);
    if (!resolved) {
      warn(`could not resolve the ${p.key} anchor near ${target}; skipping that horizon.`);
      continue;
    }
    anchors[p.key] = resolved;
  }

  const indicesOut: Record<string, unknown> = {};
  for (const ix of INDICES) {
    const now = latest.day.get(ix.csvName.toLowerCase());
    if (!now) continue;
    const periods: Record<string, unknown> = {};
    for (const p of PERIODS) {
      const anchor = anchors[p.key];
      const then = anchor?.day.get(ix.csvName.toLowerCase());
      if (!anchor || !then) continue;
      const priCagr = Math.pow(now.close / then.close, 1 / p.years) - 1;
      const divAvg = (now.divYieldPct + then.divYieldPct) / 2 / 100;
      const triCagr = (1 + priCagr) * (1 + divAvg) - 1;
      periods[p.key] = {
        triEstCagrPct: round2(triCagr * 100),
        priCagrPct: round2(priCagr * 100),
        divYieldAvgPct: round2(divAvg * 100),
        fromDate: anchor.iso,
      };
    }
    indicesOut[ix.id] = {
      label: ix.label,
      asOf: latest.iso,
      priClose: now.close,
      divYieldPct: round2(now.divYieldPct),
      periods,
    };
  }

  const snapshot = {
    generatedAt,
    source: "NSE ind_close_all daily CSV (price return + per-index dividend yield)",
    method:
      "TRI estimate = (1 + price-return CAGR) × (1 + mean dividend yield over the window) − 1. Estimate, not exact fact-sheet TRI.",
    latestDate: latest.iso,
    indices: indicesOut,
  };

  await atomicWriteJson(OUTPUT_PATH, snapshot);
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (asOf ${latest.iso})`);
  info("================ BENCHMARK TRI SUMMARY ================");
  for (const ix of INDICES) {
    const rec = indicesOut[ix.id] as { periods?: Record<string, { triEstCagrPct: number }> } | undefined;
    const p = rec?.periods ?? {};
    info(
      `${ix.label.padEnd(28)} 1Y=${fmt(p["1Y"]?.triEstCagrPct)}  3Y=${fmt(p["3Y"]?.triEstCagrPct)}  5Y=${fmt(p["5Y"]?.triEstCagrPct)}`
    );
  }
  info("======================================================");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmt(n: number | undefined): string {
  return typeof n === "number" ? `${n.toFixed(2)}%` : "  n/a";
}

async function atomicWriteJson(target: string, payload: unknown): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await fs.rename(tmp, target);
  } catch (e) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

main().catch((e) => {
  warn(`build-benchmark-tri failed: ${(e as Error).message}`);
  process.exit(1);
});
