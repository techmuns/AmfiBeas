/**
 * Phase 3.3A — computed fund returns snapshot (Stage-1 periods only).
 *
 * Reads the committed Stage-1 history manifest + per-fund history files,
 * computes simple 1M / 3M / 6M / 1Y returns per fund (point-to-point, with
 * the nearest-prior NAV as the anchor for weekend/holiday targets), and
 * writes a deterministic snapshot at src/data/snapshots/mf-returns.json.
 *
 * Validates against the manifest BEFORE writing: file count must equal the
 * manifest's totalFunds, each available fund must have a history file with
 * a non-decreasing ISO date series of strictly-positive NAVs, and the run's
 * period coverage must match the manifest. On any validation failure the
 * snapshot is NOT written and the script exits non-zero.
 *
 * Does NOT touch public/nav-history files, the manifest, the latest-NAV
 * snapshot, or anything else under src/data/snapshots/. Does NOT compute
 * category averages/medians/quartiles (those come later phases).
 *
 * Run: npm run ingest:nav:returns   (tsx scripts/ingest/nav-returns.ts)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-history-manifest.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const OUTPUT_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-returns.json");

const RULE_VERSION = 1;

// Guardrails — matched to the values from the manifest you verified. The
// 3M/6M/1Y "close to" tolerance is ±0.5% of the manifest's value (small —
// the manifest and the per-fund files were built from the same fetch, so the
// counts should be identical; the tolerance is there only as a safety net
// for any cross-day rounding around the asOfDate anchor).
const GUARD = {
  expectedFundCount: 1036,
  exact1M: 1036,                      // 1M must be exactly the full universe
  approx3M: 1029,                     // see manifest
  approx6M: 1022,
  approx1Y: 995,
  approxTolerancePct: 0.5,
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
  availablePeriods: Array<"1M" | "3M" | "6M" | "1Y">;
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
  periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number };
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

type PeriodKey = "1M" | "3M" | "6M" | "1Y";

interface ReturnCell {
  value: number;
  kind: "simple";
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
}

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

const PERIODS: Array<{ key: PeriodKey; months: number; years: number }> = [
  { key: "1M", months: 1, years: 0 },
  { key: "3M", months: 3, years: 0 },
  { key: "6M", months: 6, years: 0 },
  { key: "1Y", months: 0, years: 1 },
];

function computeReturns(series: SeriesPoint[]): { returns: Partial<Record<PeriodKey, ReturnCell>>; availability: Record<PeriodKey, boolean> } {
  const returns: Partial<Record<PeriodKey, ReturnCell>> = {};
  const availability: Record<PeriodKey, boolean> = { "1M": false, "3M": false, "6M": false, "1Y": false };
  if (series.length < 2) return { returns, availability };
  const end = series[series.length - 1];
  const firstDate = series[0].date;
  for (const p of PERIODS) {
    const target = subPeriod(end.date, p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start.nav <= 0) continue;
    returns[p.key] = {
      value: round4((end.nav / start.nav - 1) * 100),
      kind: "simple",
      startDate: start.date, startNav: start.nav,
      endDate: end.date, endNav: end.nav,
    };
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
  if (manifest.totalFunds !== GUARD.expectedFundCount) {
    validationFailures.push(`manifest.totalFunds ${manifest.totalFunds} != expected ${GUARD.expectedFundCount}`);
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
  let availability1M = 0, availability3M = 0, availability6M = 0, availability1Y = 0;

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
    for (const k of ["1M", "3M", "6M", "1Y"] as PeriodKey[]) {
      const r = returns[k];
      if (r && (!Number.isFinite(r.value) || !Number.isFinite(r.startNav) || !Number.isFinite(r.endNav))) {
        issues.push({ schemecode: mFund.schemecode, reason: `${k} computed non-finite values` });
        returns[k] = undefined;
        availability[k] = false;
      }
    }

    if (availability["1M"]) availability1M += 1;
    if (availability["3M"]) availability3M += 1;
    if (availability["6M"]) availability6M += 1;
    if (availability["1Y"]) availability1Y += 1;

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
  if (rows.length !== GUARD.expectedFundCount) {
    validationFailures.push(`rows.length ${rows.length} != expected ${GUARD.expectedFundCount}`);
  }
  if (availability1M !== GUARD.exact1M) {
    validationFailures.push(`1M coverage ${availability1M} != exact ${GUARD.exact1M}`);
  }
  function approxOk(actual: number, expected: number): boolean {
    if (expected === 0) return actual === 0;
    return Math.abs((actual - expected) / expected) * 100 <= GUARD.approxTolerancePct;
  }
  if (!approxOk(availability3M, GUARD.approx3M)) {
    validationFailures.push(`3M coverage ${availability3M} not within ${GUARD.approxTolerancePct}% of expected ${GUARD.approx3M}`);
  }
  if (!approxOk(availability6M, GUARD.approx6M)) {
    validationFailures.push(`6M coverage ${availability6M} not within ${GUARD.approxTolerancePct}% of expected ${GUARD.approx6M}`);
  }
  if (!approxOk(availability1Y, GUARD.approx1Y)) {
    validationFailures.push(`1Y coverage ${availability1Y} not within ${GUARD.approxTolerancePct}% of expected ${GUARD.approx1Y}`);
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
    historyStage: 1 as const,
    historyManifestGeneratedAt: manifest.generatedAt,
    asOfDate,
    ruleVersion: RULE_VERSION,
    periodCoverage: {
      "1M": availability1M,
      "3M": availability3M,
      "6M": availability6M,
      "1Y": availability1Y,
    },
    funds: rows,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  info("================ MF RETURNS SNAPSHOT SUMMARY ================");
  info(`asOfDate: ${asOfDate ?? "?"}  ·  rows: ${rows.length}`);
  info(`Period coverage: 1M=${availability1M} 3M=${availability3M} 6M=${availability6M} 1Y=${availability1Y}`);
  info(`Manifest expected: 1M=${manifest.periodCoverage["1M"]} 3M=${manifest.periodCoverage["3M"]} 6M=${manifest.periodCoverage["6M"]} 1Y=${manifest.periodCoverage["1Y"]}`);
  info(`Guardrails: PASS`);
  info("============================================================");
}

main().catch((e) => {
  warn(`nav-returns failed: ${(e as Error).message}`);
  process.exit(1);
});
