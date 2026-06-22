/**
 * Phase 3.3A — computed fund returns snapshot.
 *
 * Reads the committed history manifest + per-fund history files, computes
 * point-to-point returns per fund (nearest-prior NAV anchor for
 * weekend/holiday targets), and writes a deterministic snapshot at
 * src/data/snapshots/mf-returns.json.
 *
 * Stage-1 supported periods: 1M / 3M / 6M / 1Y (simple).
 * Stage-2 adds: 3Y (CAGR, using actual elapsed years between the
 *               selected start and end dates).
 * Stage-3 adds: 5Y (CAGR, same formula at the 5-year anchor).
 *
 * Validates against the manifest BEFORE writing: file count must equal the
 * manifest's totalFunds, each available fund must have a history file with
 * a non-decreasing ISO date series of strictly-positive NAVs, and the run's
 * period coverage must match the manifest. On any validation failure the
 * snapshot is NOT written and the script exits non-zero.
 *
 * Does NOT touch public/nav-history files, the manifest, the latest-NAV
 * snapshot, or anything else under src/data/snapshots/. Does NOT compute
 * category averages/medians/quartiles (those come in later phases).
 *
 * Run: npm run ingest:nav:returns   (tsx scripts/ingest/nav-returns.ts)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const MANIFEST_PATH = path.resolve(process.cwd(), "public/nav-data/mf-history-manifest.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const OUTPUT_PATH = path.resolve(process.cwd(), "public/nav-data/mf-returns.json");

const RULE_VERSION = 1;

// Guardrails — Phase 3.9B: per-period expected coverage is now
// manifest-derived rather than hard-coded. The manifest is the single
// source of truth (regenerated alongside the per-fund files), so any
// divergence is a logic bug — we fail loudly rather than tolerate
// approximation. This unblocks the daily forward-refresh flow, where
// 1Y/3Y/5Y eligibility ticks up naturally as funds age into a period.
//
// expectedFundCount stays here as universe-size sanity (catastrophic-
// drop floor) — it doesn't track period eligibility, so it's not
// manifest-derived.
const GUARD = {
  // Catastrophic-drop floor (universe-size sanity). Exact per-fund counts are
  // validated relationally against the manifest (file count == totalFunds and
  // rows == totalFunds), so this is only a floor — the absolute number grew
  // when Regular + Direct plan-series were both ingested from mf-data.
  minFundCount: 1000,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  available: boolean;
  // Phase 3.6A/3.7C: legacy Stage-1/2 manifests store 1M/3M/6M/1Y only;
  // Stage-3 manifests (Phase 3.7C) may include 3Y and 5Y when the merged
  // series supports them. This script reads from the file in either shape
  // and ignores the field (returns are computed locally), but the union
  // here keeps the type honest.
  availablePeriods: Array<"1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y">;
  path: string;
}
interface ManifestFile {
  generatedAt: string;
  source: string;
  stage: number;
  requestedRange: { from: string; to: string; windowCount: number };
  totalFunds: number;
  fundsAvailable: number;
  fundsMissing: number;
  // periodCoverage in the on-disk manifest includes "3Y" on Stage-2 builds
  // and adds "5Y" on Stage-3 builds. We tolerate either shape and read each
  // optional key if present.
  periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number; "3Y"?: number; "5Y"?: number };
  ruleVersion: number;
  parserVersion: number;
  funds: ManifestFund[];
}

interface HistoryFile {
  meta: {
    schemecode: string;
    amfiSchemeCode: number;
    isin: string | null;
    fundName: string;
    amfiSchemeName?: string | null;
    amfiAmcName?: string | null;
    classification: string | null;
    plan: "direct" | "regular" | "unknown";
    option: "growth" | "idcw" | "unknown";
    isEtf: boolean;
    isFof: boolean;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
    stage: number;
    ruleVersion: number;
    parserVersion: number;
    generatedAt: string;
  };
  series: Array<[string, number]>; // ascending [isoDate, nav]
}

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

// Phase 3.6A/3.8A: 1M/3M/6M/1Y stay simple. 3Y and 5Y are annualized
// (CAGR) using the actual elapsed years between the selected start and end
// dates, not the nominal 3.0/5.0; this keeps the formula honest when
// nearest-prior anchors a few days before/after the exact target boundary.
type SimpleReturnCell = {
  value: number;
  kind: "simple";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
};
type CagrReturnCell = {
  value: number;
  kind: "cagr";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
  years: number; // actual elapsed years between startDate and endDate
};
type ReturnCell = SimpleReturnCell | CagrReturnCell;

interface ReturnRow {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  plan: HistoryFile["meta"]["plan"];
  option: HistoryFile["meta"]["option"];
  isEtf: boolean;
  isFof: boolean;
  asOfNav: number;
  asOfNavDate: string;
  firstDate: string;
  lastDate: string;
  points: number;
  returns: Partial<Record<PeriodKey, ReturnCell>>;
  dataAvailability: Record<PeriodKey, boolean>;
}

// ---------------------------------------------------------------------------
// Date + return math (UTC, deterministic)
// ---------------------------------------------------------------------------

function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

interface SeriesPoint { date: string; nav: number }

function nearestPrior(series: SeriesPoint[], target: string): SeriesPoint | null {
  // Series is ascending; walk backwards to find the last point ≤ target.
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= target) return series[i];
  return null;
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// Elapsed years between two ISO YYYY-MM-DD dates, computed deterministically
// in UTC. 365.25 absorbs leap years; the CAGR formula is forgiving enough
// that this is more than accurate for fund-return reporting.
function elapsedYears(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return (endMs - startMs) / (86400_000 * 365.25);
}

type PeriodSpec =
  | { key: "1M" | "3M" | "6M" | "1Y"; months: number; years: number; kind: "simple" }
  | { key: "3Y"; months: 0; years: 3; kind: "cagr" }
  | { key: "5Y"; months: 0; years: 5; kind: "cagr" };

const PERIODS: PeriodSpec[] = [
  { key: "1M", months: 1, years: 0, kind: "simple" },
  { key: "3M", months: 3, years: 0, kind: "simple" },
  { key: "6M", months: 6, years: 0, kind: "simple" },
  { key: "1Y", months: 0, years: 1, kind: "simple" },
  { key: "3Y", months: 0, years: 3, kind: "cagr" },
  { key: "5Y", months: 0, years: 5, kind: "cagr" },
];

function computeReturns(series: SeriesPoint[]): { returns: Partial<Record<PeriodKey, ReturnCell>>; availability: Record<PeriodKey, boolean> } {
  const returns: Partial<Record<PeriodKey, ReturnCell>> = {};
  const availability: Record<PeriodKey, boolean> = { "1M": false, "3M": false, "6M": false, "1Y": false, "3Y": false, "5Y": false };
  if (series.length < 2) return { returns, availability };
  const end = series[series.length - 1];
  const firstDate = series[0].date;
  for (const p of PERIODS) {
    const target = subPeriod(end.date, p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start.nav <= 0) continue;
    if (p.kind === "simple") {
      returns[p.key] = {
        value: round4((end.nav / start.nav - 1) * 100),
        kind: "simple",
        startDate: start.date, startNav: start.nav,
        endDate: end.date, endNav: end.nav,
      };
    } else {
      // CAGR with actual elapsed years between the resolved start and end
      // dates. If years is non-positive (degenerate same-day) or the ratio
      // isn't positive, skip — keep dataAvailability honest.
      const years = elapsedYears(start.date, end.date);
      if (!(years > 0) || !(end.nav > 0) || !(start.nav > 0)) continue;
      const ratio = end.nav / start.nav;
      const cagrPct = (Math.pow(ratio, 1 / years) - 1) * 100;
      if (!Number.isFinite(cagrPct)) continue;
      returns[p.key] = {
        value: round4(cagrPct),
        kind: "cagr",
        startDate: start.date, startNav: start.nav,
        endDate: end.date, endNav: end.nav,
        years: round4(years),
      };
    }
    availability[p.key] = true;
  }
  return { returns, availability };
}

// ---------------------------------------------------------------------------
// Per-fund file validators
// ---------------------------------------------------------------------------

interface ValidationIssue {
  schemecode: string;
  reason: string;
}

function validateHistoryFile(h: HistoryFile, manifestEntry: ManifestFund): ValidationIssue | null {
  if (h.meta.schemecode !== manifestEntry.schemecode) {
    return { schemecode: manifestEntry.schemecode, reason: `meta.schemecode ${h.meta.schemecode} != manifest ${manifestEntry.schemecode}` };
  }
  if (h.meta.amfiSchemeCode !== manifestEntry.amfiSchemeCode) {
    return { schemecode: manifestEntry.schemecode, reason: `meta.amfiSchemeCode ${h.meta.amfiSchemeCode} != manifest ${manifestEntry.amfiSchemeCode}` };
  }
  if (!Array.isArray(h.series)) {
    return { schemecode: manifestEntry.schemecode, reason: "series is not an array" };
  }
  if (manifestEntry.available && h.series.length === 0) {
    return { schemecode: manifestEntry.schemecode, reason: "manifest marks available but series is empty" };
  }
  if (h.series.length !== h.meta.points) {
    return { schemecode: manifestEntry.schemecode, reason: `meta.points ${h.meta.points} != series.length ${h.series.length}` };
  }
  // Walk the series: strictly ascending dates, valid ISO, finite positive NAVs.
  let prev = "";
  for (let i = 0; i < h.series.length; i++) {
    const row = h.series[i];
    if (!Array.isArray(row) || row.length !== 2) return { schemecode: manifestEntry.schemecode, reason: `row ${i} is not [date, nav]` };
    const [date, nav] = row;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { schemecode: manifestEntry.schemecode, reason: `row ${i} date not ISO: ${JSON.stringify(date)}` };
    if (typeof nav !== "number" || !Number.isFinite(nav) || nav <= 0) return { schemecode: manifestEntry.schemecode, reason: `row ${i} invalid nav: ${JSON.stringify(nav)}` };
    if (date <= prev && i > 0) return { schemecode: manifestEntry.schemecode, reason: `row ${i} date ${date} not strictly after previous ${prev}` };
    prev = date;
  }
  if (h.series.length > 0) {
    if (h.series[0][0] !== h.meta.firstDate) return { schemecode: manifestEntry.schemecode, reason: `meta.firstDate ${h.meta.firstDate} != series[0][0] ${h.series[0][0]}` };
    if (h.series[h.series.length - 1][0] !== h.meta.lastDate) return { schemecode: manifestEntry.schemecode, reason: `meta.lastDate ${h.meta.lastDate} != series[-1][0] ${h.series[h.series.length - 1][0]}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  let manifest: ManifestFile;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as ManifestFile;
  } catch (e) {
    warn(`could not read manifest: ${(e as Error).message}`);
    process.exit(1);
  }
  info(`manifest stage=${manifest.stage} totalFunds=${manifest.totalFunds} fundsAvailable=${manifest.fundsAvailable}`);

  // Compare on-disk file count to the manifest BEFORE doing any work — if it
  // disagrees, refuse to write a returns snapshot that's out-of-sync.
  let dirEntries: string[];
  try {
    dirEntries = (await fs.readdir(HISTORY_DIR)).filter((n) => n.endsWith(".json"));
  } catch (e) {
    warn(`could not read ${HISTORY_DIR}: ${(e as Error).message}`);
    process.exit(1);
  }
  info(`history files on disk: ${dirEntries.length}`);

  const issues: ValidationIssue[] = [];
  const validationFailures: string[] = [];

  if (dirEntries.length !== manifest.totalFunds) {
    validationFailures.push(`history file count ${dirEntries.length} != manifest.totalFunds ${manifest.totalFunds}`);
  }
  if (manifest.totalFunds < GUARD.minFundCount) {
    validationFailures.push(`manifest.totalFunds ${manifest.totalFunds} below floor ${GUARD.minFundCount}`);
  }

  // Load + validate + compute per fund. Sort manifest funds by schemecode
  // numerically for deterministic output ordering.
  const sortedManifestFunds = manifest.funds.slice().sort((a, b) => {
    const an = Number(a.schemecode);
    const bn = Number(b.schemecode);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.schemecode.localeCompare(b.schemecode);
  });

  const rows: ReturnRow[] = [];
  let availability1M = 0, availability3M = 0, availability6M = 0, availability1Y = 0, availability3Y = 0, availability5Y = 0;

  for (const mFund of sortedManifestFunds) {
    const filePath = path.resolve(process.cwd(), mFund.path);
    let history: HistoryFile;
    try {
      history = JSON.parse(await fs.readFile(filePath, "utf8")) as HistoryFile;
    } catch (e) {
      issues.push({ schemecode: mFund.schemecode, reason: `could not read ${mFund.path}: ${(e as Error).message}` });
      continue;
    }
    const v = validateHistoryFile(history, mFund);
    if (v) { issues.push(v); continue; }

    const series: SeriesPoint[] = history.series.map(([d, n]) => ({ date: d, nav: n }));
    const asOf = series[series.length - 1];
    const { returns, availability } = computeReturns(series);

    // Sanity-check the computed return values are finite numbers.
    for (const k of ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as PeriodKey[]) {
      const r = returns[k];
      if (r && (!Number.isFinite(r.value) || !Number.isFinite(r.startNav) || !Number.isFinite(r.endNav))) {
        issues.push({ schemecode: mFund.schemecode, reason: `${k} computed non-finite values` });
        returns[k] = undefined;
        availability[k] = false;
      }
      if (r && r.kind === "cagr" && (!Number.isFinite(r.years) || r.years <= 0)) {
        issues.push({ schemecode: mFund.schemecode, reason: `${k} CAGR has non-finite or non-positive years` });
        returns[k] = undefined;
        availability[k] = false;
      }
    }

    if (availability["1M"]) availability1M += 1;
    if (availability["3M"]) availability3M += 1;
    if (availability["6M"]) availability6M += 1;
    if (availability["1Y"]) availability1Y += 1;
    if (availability["3Y"]) availability3Y += 1;
    if (availability["5Y"]) availability5Y += 1;

    rows.push({
      schemecode: mFund.schemecode,
      amfiSchemeCode: mFund.amfiSchemeCode,
      fundName: history.meta.fundName,
      classification: history.meta.classification,
      plan: history.meta.plan,
      option: history.meta.option,
      isEtf: history.meta.isEtf,
      isFof: history.meta.isFof,
      asOfNav: asOf.nav,
      asOfNavDate: asOf.date,
      firstDate: series[0].date,
      lastDate: asOf.date,
      points: series.length,
      returns,
      dataAvailability: availability,
    });
  }

  // --- Guardrails ----------------------------------------------------------
  if (rows.length !== manifest.totalFunds) {
    validationFailures.push(`rows.length ${rows.length} != manifest.totalFunds ${manifest.totalFunds}`);
  }
  // Phase 3.9B: manifest-derived per-period coverage. Required: this run's
  // counts equal manifest.periodCoverage exactly for every period the
  // manifest reports. Older manifests (Stage-1/2) may omit 3Y or 5Y; those
  // keys are skipped rather than treated as zero. Daily forward-refresh
  // regenerates the manifest in the same run that regenerates returns, so
  // exact equality is the right bar — and it catches the bug-class where
  // a partial fetch leaves the snapshot out of sync with the manifest.
  const availabilityCounts: Record<PeriodKey, number> = {
    "1M": availability1M, "3M": availability3M, "6M": availability6M,
    "1Y": availability1Y, "3Y": availability3Y, "5Y": availability5Y,
  };
  for (const k of ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as PeriodKey[]) {
    const expected = manifest.periodCoverage[k];
    if (expected === undefined) continue; // older manifest didn't carry this period
    if (availabilityCounts[k] !== expected) {
      validationFailures.push(`${k} coverage ${availabilityCounts[k]} != manifest.periodCoverage["${k}"] ${expected}`);
    }
  }
  if (issues.length > 0) {
    validationFailures.push(`${issues.length} per-fund validation issues`);
  }

  // --- asOfDate = mode of lastDate across rows (single calendar day expected)
  const lastDateCounts = new Map<string, number>();
  for (const r of rows) lastDateCounts.set(r.lastDate, (lastDateCounts.get(r.lastDate) ?? 0) + 1);
  const asOfDate = Array.from(lastDateCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  if (validationFailures.length > 0) {
    warn("validation FAILED — NOT writing snapshot:");
    for (const f of validationFailures) warn(`  - ${f}`);
    if (issues.length > 0) {
      warn(`first 5 per-fund issues:`);
      for (const i of issues.slice(0, 5)) warn(`  - ${i.schemecode}: ${i.reason}`);
    }
    process.exit(1);
  }

  const snapshot = {
    generatedAt,
    source: "computed from public/nav-history",
    // historyStage tracks which Stage the source history was produced by.
    // Stage-2 introduces 3Y; Stage-3 introduces 5Y. The field is read by
    // downstream UIs to decide which periods to expose.
    historyStage: manifest.stage,
    historyManifestGeneratedAt: manifest.generatedAt,
    asOfDate,
    ruleVersion: RULE_VERSION,
    periodCoverage: {
      "1M": availability1M,
      "3M": availability3M,
      "6M": availability6M,
      "1Y": availability1Y,
      "3Y": availability3Y,
      "5Y": availability5Y,
    },
    funds: rows,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  info("================ MF RETURNS SNAPSHOT SUMMARY ================");
  info(`asOfDate: ${asOfDate ?? "?"}  ·  rows: ${rows.length}  ·  historyStage: ${manifest.stage}`);
  info(`Period coverage: 1M=${availability1M} 3M=${availability3M} 6M=${availability6M} 1Y=${availability1Y} 3Y=${availability3Y} 5Y=${availability5Y}`);
  info(`Manifest expected: 1M=${manifest.periodCoverage["1M"]} 3M=${manifest.periodCoverage["3M"]} 6M=${manifest.periodCoverage["6M"]} 1Y=${manifest.periodCoverage["1Y"]} 3Y=${manifest.periodCoverage["3Y"] ?? "(absent)"} 5Y=${manifest.periodCoverage["5Y"] ?? "(absent)"}`);
  info(`Guardrails: PASS`);
  info("============================================================");
}

main().catch((e) => {
  warn(`nav-returns failed: ${(e as Error).message}`);
  process.exit(1);
});
