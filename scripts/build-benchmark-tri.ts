/**
 * Benchmark return builder — a TRI (total-return) ESTIMATE per index/horizon.
 *
 * WHAT IS OFFICIAL AND WHAT IS NOT
 * --------------------------------
 * Two different things travel together and must never be conflated:
 *
 *   benchmark IDENTITY — which index a scheme is measured against. That comes
 *     from the AMC's own document (public/nav-data/mf-scheme-benchmarks.json)
 *     and is OFFICIAL.
 *   benchmark RETURN   — the number this script produces. It is an ESTIMATE,
 *     reconstructed from NSE price levels plus dividend yield, and every record
 *     it writes is labelled `isEstimate: true` with an explicit `returnMethod`.
 *
 * niftyindices.com (the only public source of TRI *levels*) blocks scripted
 * access, so we reconstruct:
 *
 *     PRI return  = level_now / level_then − 1                    (1M/3M/6M/1Y)
 *     PRI CAGR    = (level_now / level_then) ^ (1/years) − 1      (3Y/5Y/10Y)
 *     div drag    = mean(divYield_now, divYield_then)             (annual, %)
 *     TRI ≈       = (1 + PRI) · (1 + div drag · yearsFactor) − 1
 *
 * For broad Nifty indices this lands within a few tenths of a percent of the
 * published TRI — good enough to flag beat/miss, and clearly labelled.
 *
 * PERIOD ALIGNMENT
 * ----------------
 * Periods, anchors and return conventions are imported from
 * src/lib/return-periods.ts — the SAME module nav-returns.ts uses for
 * fund returns. 1M/3M/6M/1Y are simple returns; 3Y/5Y/10Y are CAGR over the
 * actual elapsed years. The end anchor is the trading day on/before the NAV
 * snapshot's as-of date, so fund and benchmark windows line up; each period
 * publishes its resolved fromDate/toDate so the API can verify that itself.
 *
 * INDEX UNIVERSE
 * --------------
 * Driven by the benchmarks the OFFICIAL scheme registry actually references
 * (canonical keys whose returnSupport is "nse-ind-close-all"), unioned with the
 * legacy category-proxy indices the Active Fund Performance tab still reads.
 * Indices from providers we cannot price (BSE, CRISIL, MSCI, blended
 * debt/hybrid) are deliberately absent — their schemes keep the official name
 * and a null return rather than borrowing a convenient Nifty proxy.
 *
 * Output: public/nav-data/benchmark-tri.json
 * Run:    npm run build:benchmark-tri
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, warn, nowIso } from "./ingest/utils";
import {
  PERIOD_SPECS,
  daysBetween,
  elapsedYears,
  subPeriod,
  type PeriodKey,
} from "../src/lib/return-periods";
import { CANONICAL_BENCHMARKS, benchmarkByKey } from "../src/data/benchmark-registry";
import { CATEGORY_BENCHMARK } from "../src/data/benchmark-tri";
import type { SchemeBenchmarkRegistry } from "../src/data/scheme-benchmarks";

const OUTPUT_PATH = path.resolve(process.cwd(), "public/nav-data/benchmark-tri.json");
const REGISTRY_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmarks.json");
const CATEGORY_RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/mf-category-returns.json");

const NSE_BASE = "https://archives.nseindia.com/content/indices/ind_close_all_";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 45_000;
const RETRIES_PER_DATE = 6;
const WALK_BACK_DAYS = 12;

export const RETURN_METHOD = "estimated-tri-from-pri-plus-dividend-yield";
const RETURN_SOURCE = "NSE ind_close_all daily CSV (price-return close + per-index dividend yield)";

/** Indices the UI's category-proxy view still needs, regardless of registry. */
const LEGACY_PROXY_KEYS = [...new Set(Object.values(CATEGORY_BENCHMARK))];

interface IndexRow {
  close: number;
  divYieldPct: number;
}
type DayMap = Map<string, IndexRow>;

interface WantedIndex {
  key: string;
  label: string;
  /** Normalized NSE csv names this index answers to. */
  csvKeys: string[];
  /** Schemes in the official registry that name this index. */
  schemeCount: number;
}

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
function isoToNseFilename(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Index universe
// ---------------------------------------------------------------------------

function normalizeCsvName(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/\bindex\b/g, " ").replace(/[^a-z0-9]+/g, "");
}

async function resolveWantedIndices(): Promise<WantedIndex[]> {
  const counts = new Map<string, number>();
  try {
    const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, "utf8")) as SchemeBenchmarkRegistry;
    for (const s of registry.schemes ?? []) {
      const key = s.currentBenchmark?.canonicalBenchmarkKey;
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      for (const h of s.benchmarkHistory ?? []) {
        if (h.canonicalBenchmarkKey) counts.set(h.canonicalBenchmarkKey, counts.get(h.canonicalBenchmarkKey) ?? 0);
      }
    }
    info(`registry references ${counts.size} distinct canonical benchmarks`);
  } catch {
    warn("scheme-benchmark registry not readable — building the legacy proxy index set only");
  }
  for (const k of LEGACY_PROXY_KEYS) if (!counts.has(k)) counts.set(k, 0);

  const wanted: WantedIndex[] = [];
  for (const [key, schemeCount] of counts) {
    const canonical = benchmarkByKey(key);
    if (!canonical) {
      warn(`registry references unknown canonical key ${key} — skipped`);
      continue;
    }
    if (canonical.returnSupport !== "nse-ind-close-all") continue; // honest: no substitute
    const csvKeys = [...new Set((canonical.nseIndexNames ?? []).map(normalizeCsvName))];
    if (csvKeys.length === 0) continue;
    wanted.push({ key, label: `${canonical.name} TRI`, csvKeys, schemeCount });
  }
  wanted.sort((a, b) => b.schemeCount - a.schemeCount || a.key.localeCompare(b.key));
  return wanted;
}

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
    map.set(normalizeCsvName(cols[nameIdx]), {
      close,
      divYieldPct: Number.isFinite(div) ? div : 0,
    });
  }
  return map;
}

function lookup(day: DayMap, ix: WantedIndex): IndexRow | undefined {
  for (const k of ix.csvKeys) {
    const row = day.get(k);
    if (row) return row;
  }
  return undefined;
}

/** Walk back from `startIso` until a CSV that carries the CORE indices is
 *  found (a day whose file exists but is truncated is not a usable anchor). */
async function resolveTradingDay(startIso: string, core: WantedIndex[]): Promise<{ iso: string; day: DayMap } | null> {
  for (let off = 0; off <= WALK_BACK_DAYS; off++) {
    const iso = isoSubDays(startIso, off);
    const csv = await fetchCsv(iso);
    if (!csv) continue;
    const day = parseDay(csv);
    if (day.size > 0 && core.every((ix) => lookup(day, ix) !== undefined)) {
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
  const wanted = await resolveWantedIndices();
  if (wanted.length === 0) {
    warn("no NSE-resolvable benchmark indices to build; keeping previous snapshot.");
    process.exit(1);
  }
  info(`index universe: ${wanted.length} NSE indices (${wanted.filter((w) => w.schemeCount > 0).length} referenced by official scheme mappings)`);

  // The legacy proxy set is the CORE: a trading day that cannot price those is
  // not a usable anchor. Newer/thinner indices are best-effort per index.
  const core = wanted.filter((w) => LEGACY_PROXY_KEYS.includes(w.key));

  // Anchor to the NAV snapshot's as-of date when it is recent, so fund and
  // benchmark windows end on the same (or adjacent) trading day.
  let navAsOfDate: string | null = null;
  try {
    const cat = JSON.parse(await fs.readFile(CATEGORY_RETURNS_PATH, "utf8")) as { asOfDate?: string | null };
    navAsOfDate = cat.asOfDate ?? null;
  } catch {
    /* no NAV snapshot — fall back to today */
  }
  const today = todayIstIso();
  const envDate = process.env.BENCHMARK_TRI_DATE;
  const start =
    envDate && /^\d{4}-\d{2}-\d{2}$/.test(envDate)
      ? envDate
      : navAsOfDate && daysBetween(navAsOfDate, today) <= 10 && navAsOfDate <= today
        ? navAsOfDate
        : today;
  info(`latest anchor: walking back from ${start}${navAsOfDate ? ` (NAV as-of ${navAsOfDate})` : ""}`);

  const latest = await resolveTradingDay(start, core);
  if (!latest) {
    warn(`could not resolve a latest trading day from ${start}; keeping previous snapshot.`);
    process.exit(1);
  }

  // One anchor per horizon: the trading day on/before the period's target date,
  // computed with the SAME calendar arithmetic the NAV feed uses.
  const anchors: Partial<Record<PeriodKey, { iso: string; day: DayMap; target: string }>> = {};
  for (const p of PERIOD_SPECS) {
    const target = subPeriod(latest.iso, p.months, p.years);
    info(`${p.key} anchor: target ${target}`);
    const resolved = await resolveTradingDay(target, core);
    if (!resolved) {
      warn(`could not resolve the ${p.key} anchor near ${target}; skipping that horizon.`);
      continue;
    }
    anchors[p.key] = { ...resolved, target };
  }

  const indicesOut: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const ix of wanted) {
    const now = lookup(latest.day, ix);
    if (!now) continue;
    const periods: Record<string, unknown> = {};
    for (const p of PERIOD_SPECS) {
      const anchor = anchors[p.key];
      const then = anchor ? lookup(anchor.day, ix) : undefined;
      if (!anchor || !then) continue;
      if (!(then.close > 0) || !(now.close > 0)) continue;
      if (anchor.iso >= latest.iso) {
        failures.push(`${ix.key} ${p.key}: impossible date range ${anchor.iso} → ${latest.iso}`);
        continue;
      }
      const years = elapsedYears(anchor.iso, latest.iso);
      if (!(years > 0)) {
        failures.push(`${ix.key} ${p.key}: non-positive elapsed years`);
        continue;
      }
      const divAvg = (now.divYieldPct + then.divYieldPct) / 2 / 100;
      let priPct: number;
      let triPct: number;
      if (p.kind === "simple") {
        // Simple point-to-point, matching the fund feed. The dividend accrual is
        // pro-rated to the window rather than annualized.
        priPct = now.close / then.close - 1;
        triPct = (1 + priPct) * (1 + divAvg * years) - 1;
      } else {
        priPct = Math.pow(now.close / then.close, 1 / years) - 1;
        triPct = (1 + priPct) * (1 + divAvg) - 1;
      }
      if (!Number.isFinite(priPct) || !Number.isFinite(triPct)) {
        failures.push(`${ix.key} ${p.key}: non-finite return`);
        continue;
      }
      periods[p.key] = {
        // Canonical fields.
        returnPct: round2(triPct * 100),
        priReturnPct: round2(priPct * 100),
        kind: p.kind,
        years: p.kind === "cagr" ? round4(years) : undefined,
        divYieldAvgPct: round2(divAvg * 100),
        fromDate: anchor.iso,
        toDate: latest.iso,
        targetDate: anchor.target,
        returnMethod: RETURN_METHOD,
        returnSource: RETURN_SOURCE,
        isEstimate: true,
        // Legacy aliases — the Active Fund Performance tab reads these. Same
        // numbers; the name is historical (1M/3M/6M are simple, not CAGR).
        triEstCagrPct: round2(triPct * 100),
        priCagrPct: round2(priPct * 100),
      };
    }
    indicesOut[ix.key] = {
      label: ix.label,
      asOf: latest.iso,
      priClose: now.close,
      divYieldPct: round2(now.divYieldPct),
      schemeCount: ix.schemeCount,
      periods,
    };
  }

  if (failures.length > 0) {
    warn("benchmark return validation FAILED — keeping previous snapshot:");
    for (const f of failures.slice(0, 20)) warn(`  - ${f}`);
    process.exit(1);
  }
  const built = Object.keys(indicesOut).length;
  if (built === 0 || core.some((c) => !indicesOut[c.key])) {
    warn(`core benchmark indices missing from the resolved day (built ${built}); keeping previous snapshot.`);
    process.exit(1);
  }

  const snapshot = {
    generatedAt,
    source: RETURN_SOURCE,
    method:
      "TRI estimate = (1 + price return) × (1 + mean dividend yield over the window) − 1. " +
      "ESTIMATE, not the published fact-sheet TRI. Benchmark IDENTITY is official (AMC-sourced); this RETURN is reconstructed.",
    returnMethod: RETURN_METHOD,
    isEstimate: true,
    periodConvention:
      "1M/3M/6M/1Y simple point-to-point; 3Y/5Y/10Y CAGR over actual elapsed years — identical to src/lib/return-periods.ts, which the NAV feed uses",
    latestDate: latest.iso,
    navAsOfDate,
    indices: indicesOut,
  };

  await atomicWriteJson(OUTPUT_PATH, snapshot);
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (asOf ${latest.iso})`);
  info("================ BENCHMARK TRI SUMMARY ================");
  info(`indices built: ${built} of ${wanted.length} wanted   ·   NSE-unsupported providers are left to the registry as official-name-only`);
  for (const ix of wanted.slice(0, 24)) {
    const rec = indicesOut[ix.key] as { periods?: Record<string, { returnPct: number }> } | undefined;
    const p = rec?.periods ?? {};
    info(
      `${ix.label.padEnd(34)} 1Y=${fmt(p["1Y"]?.returnPct)}  3Y=${fmt(p["3Y"]?.returnPct)}  5Y=${fmt(p["5Y"]?.returnPct)}  10Y=${fmt(p["10Y"]?.returnPct)}`
    );
  }
  const unsupported = CANONICAL_BENCHMARKS.filter((b) => b.returnSupport === "unsupported").length;
  info(`canonical indices with no automated return source: ${unsupported} (kept as official names, never proxied)`);
  info("======================================================");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function fmt(n: number | undefined): string {
  return typeof n === "number" ? `${n.toFixed(2)}%` : "   n/a";
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
