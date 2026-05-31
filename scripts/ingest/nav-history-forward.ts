/**
 * Phase 3.9B — Daily forward NAV refresh (DRY RUN).
 *
 * Reads the already-committed mf-latest-nav.json (refreshed daily by
 * nav-latest.yml) and, for each fund, simulates appending the latest
 * NAV onto its existing public/nav-history/{schemecode}.json series IN
 * MEMORY. Produces a dry-run report + (optional) sample proposed merged
 * files + proposed periodCoverage summaries under data/debug/.
 *
 * Strict dry-run: NEVER writes to public/nav-history/, NEVER writes to
 * src/data/snapshots/. The production-write path is intentionally not
 * wired here — it will land in Phase 3.9C.
 *
 * Append rule (per fund):
 *   • If latestIsoDate > history.lastDate  → would-append (the only
 *     code path that proposes a new series point).
 *   • If latestIsoDate == history.lastDate → current (skip; series
 *     already at today's NAV).
 *   • If latestIsoDate <  history.lastDate → stale-latest (skip; we
 *     NEVER rewind a committed series).
 *
 * Validates the latest NAV value (finite, > 0), enforces strictly
 * ascending dates, and detects gaps > GAP_DAYS_THRESHOLD calendar days
 * between history.lastDate and latestIsoDate (a hint that a historical
 * backfill is needed, not just a forward append).
 *
 * Run: npm run ingest:nav:forward   (tsx scripts/ingest/nav-history-forward.ts)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const LATEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");
const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-history-manifest.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-history-forward-dryrun-report.json");
const SAMPLE_DIR = path.join(REPORT_DIR, "sample-nav-history-forward");
const RETURNS_SUMMARY_PATH = path.join(REPORT_DIR, "mf-returns-forward-summary.json");
const CATEGORY_SUMMARY_PATH = path.join(REPORT_DIR, "mf-category-returns-forward-summary.json");

const SAMPLE_PILOT_SCHEMECODES = ["21520", "1131", "43811", "33369", "1273"];

// Forward-append guardrails (Phase 3.9B). Tuned for daily cadence:
// AMFI publishes after market close, our cron runs ~01:30 IST next day,
// so a healthy run sees gap == 1 calendar day on business days, 2-3 days
// after weekends/holidays. Anything > 7 calendar days (about a business
// week) means a historical hole that forward-append cannot heal — flag
// it so the operator runs a Stage-N backfill instead.
const GAP_DAYS_THRESHOLD = 7;
// If too large a slice of the universe shows a large gap, block the run
// rather than proposing a thousand 1-point appends across a 3-week hole.
const LARGE_GAP_BLOCK_PCT = 5;
const EXPECTED_UNIVERSE = 1036;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LatestFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  amfiSchemeName: string;
  amfiAmcName: string;
  isin: string | null;
  nav: number;
  navDate: string; // DD-MMM-YYYY (AMFI feed format)
  matchConfidence: string;
  matchedBy: string;
  hasHoldings: boolean;
}
interface LatestSnapshot {
  feedDate: string; // DD-MMM-YYYY
  funds: LatestFund[];
}

interface ManifestFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  available: boolean;
  availablePeriods: Array<"1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y">;
  path: string;
}
interface ManifestFile {
  generatedAt: string;
  source: string;
  stage: number;
  totalFunds: number;
  fundsAvailable: number;
  fundsMissing: number;
  periodCoverage: { "1M": number; "3M": number; "6M": number; "1Y": number; "3Y"?: number; "5Y"?: number };
  funds: ManifestFund[];
}

interface ExistingHistoryFile {
  meta: {
    schemecode: string;
    amfiSchemeCode: number;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
    stage: number;
    lastForwardAppendAt?: string | null;
  };
  series: Array<[string, number]>;
}

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

interface ForwardAction {
  schemecode: string;
  fundName: string;
  action: "would-append" | "current" | "stale-latest" | "invalid-nav" | "no-existing-history" | "no-latest-row";
  historyLastDate: string | null;
  historyFirstDate: string | null;
  historyPoints: number;
  latestNavDate: string | null; // ISO
  latestNavDateAmfi: string | null; // DD-MMM-YYYY
  latestNav: number | null;
  proposedLastDate: string | null;
  proposedPoints: number;
  gapCalendarDays: number; // 0 when not appending
  largeGap: boolean;
  // Per-fund availability after the proposed append (or unchanged if not
  // appending). Used by the report's proposed periodCoverage aggregate.
  proposedAvailability: Record<PeriodKey, boolean>;
  // The corresponding flags read from the manifest. Lets the report show
  // exactly which funds *gain* a period on this run.
  manifestAvailability: Record<PeriodKey, boolean>;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const MONTH_TO_NUM: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
export function ddMMMyyyyToIso(s: string): string | null {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monKey = m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
  const month = MONTH_TO_NUM[monKey];
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}

function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

function dayDiffDays(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Availability detector (mirrors nav-history-backfill's computeReturns shape
// — booleans only, no return values). Always evaluates all 6 periods.
// ---------------------------------------------------------------------------

interface SeriesPoint { date: string; nav: number }

const PERIOD_SPECS: ReadonlyArray<{ key: PeriodKey; months: number; years: number }> = [
  { key: "1M", months: 1, years: 0 },
  { key: "3M", months: 3, years: 0 },
  { key: "6M", months: 6, years: 0 },
  { key: "1Y", months: 0, years: 1 },
  { key: "3Y", months: 0, years: 3 },
  { key: "5Y", months: 0, years: 5 },
];

function nearestPrior(series: SeriesPoint[], target: string): SeriesPoint | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= target) return series[i];
  return null;
}

function emptyAvailability(): Record<PeriodKey, boolean> {
  return { "1M": false, "3M": false, "6M": false, "1Y": false, "3Y": false, "5Y": false };
}

export function dataAvailability(series: SeriesPoint[]): Record<PeriodKey, boolean> {
  const out = emptyAvailability();
  if (series.length < 2) return out;
  const end = series[series.length - 1];
  const firstDate = series[0].date;
  for (const p of PERIOD_SPECS) {
    const target = subPeriod(end.date, p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start.nav <= 0) continue;
    out[p.key] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-memory append simulation. Pure (no I/O), used both by main() and tests.
// ---------------------------------------------------------------------------

export interface SimulateInput {
  schemecode: string;
  fundName: string;
  existingSeries: Array<[string, number]>;
  existingFirstDate: string | null;
  existingLastDate: string | null;
  latestNav: number | null;
  latestNavIso: string | null;
  latestNavAmfi: string | null;
  manifestAvailability: Record<PeriodKey, boolean>;
}

export function simulateForwardAppend(input: SimulateInput): ForwardAction {
  const base: ForwardAction = {
    schemecode: input.schemecode,
    fundName: input.fundName,
    action: "current",
    historyLastDate: input.existingLastDate,
    historyFirstDate: input.existingFirstDate,
    historyPoints: input.existingSeries.length,
    latestNavDate: input.latestNavIso,
    latestNavDateAmfi: input.latestNavAmfi,
    latestNav: input.latestNav,
    proposedLastDate: input.existingLastDate,
    proposedPoints: input.existingSeries.length,
    gapCalendarDays: 0,
    largeGap: false,
    proposedAvailability: input.manifestAvailability,
    manifestAvailability: input.manifestAvailability,
  };

  if (input.existingSeries.length === 0) {
    return { ...base, action: "no-existing-history" };
  }
  if (input.latestNavIso === null || input.latestNav === null) {
    return { ...base, action: "no-latest-row" };
  }
  if (!Number.isFinite(input.latestNav) || input.latestNav <= 0) {
    return { ...base, action: "invalid-nav" };
  }
  if (input.existingLastDate === null) {
    return { ...base, action: "no-existing-history" };
  }

  if (input.latestNavIso < input.existingLastDate) {
    return { ...base, action: "stale-latest" };
  }
  if (input.latestNavIso === input.existingLastDate) {
    // Recompute availability on the unchanged series so the report's
    // proposed-vs-manifest comparison is honest (the manifest could be
    // stale if a separate run regenerated it without updating returns).
    const seriesPts: SeriesPoint[] = input.existingSeries.map(([d, n]) => ({ date: d, nav: n }));
    return { ...base, action: "current", proposedAvailability: dataAvailability(seriesPts) };
  }

  // would-append branch
  const gapDays = dayDiffDays(input.existingLastDate, input.latestNavIso);
  const merged: Array<[string, number]> = [...input.existingSeries, [input.latestNavIso, input.latestNav]];
  const mergedPts: SeriesPoint[] = merged.map(([d, n]) => ({ date: d, nav: n }));
  return {
    ...base,
    action: "would-append",
    proposedLastDate: input.latestNavIso,
    proposedPoints: merged.length,
    gapCalendarDays: gapDays,
    largeGap: gapDays > GAP_DAYS_THRESHOLD,
    proposedAvailability: dataAvailability(mergedPts),
  };
}

// Convert a manifest fund's availablePeriods array (which may omit periods
// that didn't have a writer on the originating stage) into the boolean map.
function manifestAvailabilityFor(m: ManifestFund | undefined): Record<PeriodKey, boolean> {
  const out = emptyAvailability();
  if (!m) return out;
  for (const k of m.availablePeriods) out[k] = true;
  return out;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function readExistingHistoryFile(schemecode: string): Promise<ExistingHistoryFile | null> {
  const p = path.join(HISTORY_DIR, `${schemecode}.json`);
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as ExistingHistoryFile;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), LATEST_PATH)}`);
  let latest: LatestSnapshot;
  try {
    latest = JSON.parse(await fs.readFile(LATEST_PATH, "utf8")) as LatestSnapshot;
  } catch (e) {
    warn(`could not read latest snapshot: ${(e as Error).message}`);
    process.exit(1);
  }
  info(`latest snapshot: feedDate=${latest.feedDate} funds=${latest.funds.length}`);
  const feedDateIso = ddMMMyyyyToIso(latest.feedDate);

  info(`reading ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  let manifest: ManifestFile;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as ManifestFile;
  } catch (e) {
    warn(`could not read manifest: ${(e as Error).message}`);
    process.exit(1);
  }
  info(`manifest: stage=${manifest.stage} totalFunds=${manifest.totalFunds} generatedAt=${manifest.generatedAt}`);

  const manifestByCode = new Map(manifest.funds.map((m) => [m.schemecode, m]));
  const latestByCode = new Map(latest.funds.map((f) => [f.schemecode, f]));

  // --- 1. Per-fund simulation -----------------------------------------------
  const actions: ForwardAction[] = [];
  for (const f of latest.funds) {
    const existing = await readExistingHistoryFile(f.schemecode);
    const mEntry = manifestByCode.get(f.schemecode);
    const latestNavIso = ddMMMyyyyToIso(f.navDate);
    actions.push(simulateForwardAppend({
      schemecode: f.schemecode,
      fundName: f.fundName,
      existingSeries: existing?.series ?? [],
      existingFirstDate: existing?.meta.firstDate ?? null,
      existingLastDate: existing?.meta.lastDate ?? null,
      latestNav: f.nav,
      latestNavIso,
      latestNavAmfi: f.navDate,
      manifestAvailability: manifestAvailabilityFor(mEntry),
    }));
  }
  // Funds in the manifest that have no row in the latest snapshot — rare but
  // worth surfacing (it'd mean the daily NAV refresh dropped them).
  const latestCodes = new Set(latest.funds.map((f) => f.schemecode));
  const manifestOnly = manifest.funds.filter((m) => !latestCodes.has(m.schemecode));

  // --- 2. Aggregates --------------------------------------------------------
  const wouldAppend = actions.filter((a) => a.action === "would-append");
  const current = actions.filter((a) => a.action === "current");
  const staleLatest = actions.filter((a) => a.action === "stale-latest");
  const invalidNav = actions.filter((a) => a.action === "invalid-nav");
  const noExistingHistory = actions.filter((a) => a.action === "no-existing-history");
  const noLatestRow = actions.filter((a) => a.action === "no-latest-row");
  const largeGap = actions.filter((a) => a.largeGap);
  const maxGap = actions.reduce((max, a) => Math.max(max, a.gapCalendarDays), 0);

  const proposedPeriodCoverage = {
    "1M": actions.filter((a) => a.proposedAvailability["1M"]).length,
    "3M": actions.filter((a) => a.proposedAvailability["3M"]).length,
    "6M": actions.filter((a) => a.proposedAvailability["6M"]).length,
    "1Y": actions.filter((a) => a.proposedAvailability["1Y"]).length,
    "3Y": actions.filter((a) => a.proposedAvailability["3Y"]).length,
    "5Y": actions.filter((a) => a.proposedAvailability["5Y"]).length,
  };
  const currentPeriodCoverage = {
    "1M": manifest.periodCoverage["1M"] ?? 0,
    "3M": manifest.periodCoverage["3M"] ?? 0,
    "6M": manifest.periodCoverage["6M"] ?? 0,
    "1Y": manifest.periodCoverage["1Y"] ?? 0,
    "3Y": manifest.periodCoverage["3Y"] ?? 0,
    "5Y": manifest.periodCoverage["5Y"] ?? 0,
  };
  const periodCoverageDelta: Record<PeriodKey, number> = {
    "1M": proposedPeriodCoverage["1M"] - currentPeriodCoverage["1M"],
    "3M": proposedPeriodCoverage["3M"] - currentPeriodCoverage["3M"],
    "6M": proposedPeriodCoverage["6M"] - currentPeriodCoverage["6M"],
    "1Y": proposedPeriodCoverage["1Y"] - currentPeriodCoverage["1Y"],
    "3Y": proposedPeriodCoverage["3Y"] - currentPeriodCoverage["3Y"],
    "5Y": proposedPeriodCoverage["5Y"] - currentPeriodCoverage["5Y"],
  };

  // --- 3. Guardrails --------------------------------------------------------
  const guardFailures: string[] = [];
  if (latest.funds.length !== EXPECTED_UNIVERSE) {
    guardFailures.push(`latest.funds.length ${latest.funds.length} != ${EXPECTED_UNIVERSE}`);
  }
  if (manifest.totalFunds !== EXPECTED_UNIVERSE) {
    guardFailures.push(`manifest.totalFunds ${manifest.totalFunds} != ${EXPECTED_UNIVERSE}`);
  }
  if (invalidNav.length > 0) {
    guardFailures.push(`${invalidNav.length} fund(s) had invalid latest NAV (non-finite or <= 0)`);
  }
  if (noExistingHistory.length > 0) {
    guardFailures.push(`${noExistingHistory.length} fund(s) have no existing history file (production state broken)`);
  }
  if (manifestOnly.length > 0) {
    guardFailures.push(`${manifestOnly.length} fund(s) present in manifest but missing from latest snapshot`);
  }
  // No-regression on the period coverage that already exists on disk.
  for (const k of ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as PeriodKey[]) {
    if (proposedPeriodCoverage[k] < currentPeriodCoverage[k]) {
      guardFailures.push(`${k} coverage would regress: proposed ${proposedPeriodCoverage[k]} < current ${currentPeriodCoverage[k]}`);
    }
  }
  // Block if too many funds show a "large" gap — likely needs Stage-N
  // historical backfill, not a forward append across a multi-week hole.
  const largeGapPct = (largeGap.length / Math.max(1, EXPECTED_UNIVERSE)) * 100;
  if (largeGapPct > LARGE_GAP_BLOCK_PCT) {
    guardFailures.push(`${largeGap.length} fund(s) (= ${largeGapPct.toFixed(2)}%) show gap > ${GAP_DAYS_THRESHOLD} days — exceeds the ${LARGE_GAP_BLOCK_PCT}% block threshold. Run a historical backfill (stage 1/2/3) before forward-appending.`);
  }
  // Cross-check: every "would-append" action's proposed series is strictly
  // ascending and has no duplicate of its own appended date. By construction
  // (we only append when latestIso > lastDate), this should always hold —
  // but we assert it defensively for the dry-run.
  for (const a of wouldAppend) {
    if (a.latestNavDate && a.historyLastDate && a.latestNavDate <= a.historyLastDate) {
      guardFailures.push(`${a.schemecode} would-append violates ascending: ${a.latestNavDate} <= ${a.historyLastDate}`);
    }
  }
  const guardPass = guardFailures.length === 0;

  // --- 4. Sample proposed merged files (always written under data/debug) ---
  await fs.mkdir(SAMPLE_DIR, { recursive: true });
  const sampleSummaries: Array<{
    schemecode: string; fundName: string; action: string; path: string;
    proposedFirstDate: string | null; proposedLastDate: string | null; proposedPoints: number;
    gapCalendarDays: number;
  }> = [];
  for (const code of SAMPLE_PILOT_SCHEMECODES) {
    const a = actions.find((x) => x.schemecode === code);
    if (!a) continue;
    const existing = await readExistingHistoryFile(code);
    const latestRow = latestByCode.get(code);
    const merged: Array<[string, number]> = existing
      ? (a.action === "would-append" && latestRow && a.latestNavDate
          ? [...existing.series, [a.latestNavDate, latestRow.nav]]
          : existing.series)
      : [];
    const sampleFile = {
      meta: {
        schemecode: code,
        fundName: a.fundName,
        action: a.action,
        proposedFirstDate: merged[0]?.[0] ?? null,
        proposedLastDate: merged[merged.length - 1]?.[0] ?? null,
        proposedPoints: merged.length,
        priorFirstDate: existing?.meta.firstDate ?? null,
        priorLastDate: existing?.meta.lastDate ?? null,
        priorPoints: existing?.meta.points ?? 0,
        gapCalendarDays: a.gapCalendarDays,
        largeGap: a.largeGap,
        wouldSetLastForwardAppendAt: a.action === "would-append" ? generatedAt : null,
      },
      seriesTail: merged.slice(-10), // last 10 points only — the dry-run report doesn't need the full series
    };
    const out = path.join(SAMPLE_DIR, `${code}.json`);
    await fs.writeFile(out, JSON.stringify(sampleFile, null, 2) + "\n", "utf8");
    sampleSummaries.push({
      schemecode: code, fundName: a.fundName, action: a.action,
      path: path.relative(process.cwd(), out),
      proposedFirstDate: sampleFile.meta.proposedFirstDate,
      proposedLastDate: sampleFile.meta.proposedLastDate,
      proposedPoints: sampleFile.meta.proposedPoints,
      gapCalendarDays: a.gapCalendarDays,
    });
  }

  // --- 5. Proposed-snapshot summaries (period coverage only — no full re-gen)
  //   The Phase 3.9C production path will actually regenerate mf-returns.json
  //   and mf-category-returns.json. For the dry-run we just project the new
  //   per-period coverage that would land in those snapshots.
  const returnsSummary = {
    generatedAt,
    source: "Phase 3.9B dry-run — proposed mf-returns.json periodCoverage after forward append",
    historyStage: manifest.stage,
    asOfDate: feedDateIso,
    universeCount: actions.length,
    currentPeriodCoverage,
    proposedPeriodCoverage,
    periodCoverageDelta,
  };
  await fs.writeFile(RETURNS_SUMMARY_PATH, JSON.stringify(returnsSummary, null, 2) + "\n", "utf8");
  const categorySummary = {
    generatedAt,
    source: "Phase 3.9B dry-run — proposed mf-category-returns.json scope hint after forward append",
    note: "Category returns are derived from mf-returns.json. The exact fundsWithRank counts depend on cohort sizes after the new period eligibilities; full simulation lives in Phase 3.9C's production regen.",
    proposedPeriodCoverage,
    periodCoverageDelta,
  };
  await fs.writeFile(CATEGORY_SUMMARY_PATH, JSON.stringify(categorySummary, null, 2) + "\n", "utf8");

  // --- 6. Report ------------------------------------------------------------
  const verdict = {
    writeMode: "dryrun" as const,
    feedDate: latest.feedDate,
    feedDateIso,
    historyStage: manifest.stage,
    manifestGeneratedAt: manifest.generatedAt,
    universeCount: actions.length,
    counts: {
      wouldAppend: wouldAppend.length,
      current: current.length,
      staleLatest: staleLatest.length,
      invalidNav: invalidNav.length,
      noExistingHistory: noExistingHistory.length,
      noLatestRow: noLatestRow.length,
      largeGap: largeGap.length,
      manifestOnly: manifestOnly.length,
    },
    maxGapCalendarDays: maxGap,
    largeGapPct: Number(largeGapPct.toFixed(2)),
    largeGapBlockThresholdPct: LARGE_GAP_BLOCK_PCT,
    gapDaysThreshold: GAP_DAYS_THRESHOLD,
    changedFileCount: wouldAppend.length,
    currentPeriodCoverage,
    proposedPeriodCoverage,
    periodCoverageDelta,
    guardPass,
    guardFailures,
  };

  const report = {
    meta: {
      generatedAt,
      writeMode: "dryrun",
      dryRun: true,
      phase: "3.9B",
      note: "Daily forward NAV refresh — DRY RUN. Simulates appending mf-latest-nav.json's latest NAV onto each fund's existing public/nav-history/{schemecode}.json series IN MEMORY only. NEVER writes to public/nav-history/ or src/data/snapshots/. Production write wired in Phase 3.9C.",
      latestSnapshot: "src/data/snapshots/mf-latest-nav.json",
      historyManifest: "src/data/snapshots/mf-history-manifest.json",
    },
    verdict,
    sampleProposedFiles: sampleSummaries,
    // Bounded slices so the report stays a sane size.
    wouldAppendSample: wouldAppend.slice(0, 25).map((a) => ({
      schemecode: a.schemecode, fundName: a.fundName,
      historyLastDate: a.historyLastDate, latestNavDate: a.latestNavDate,
      latestNav: a.latestNav, gapCalendarDays: a.gapCalendarDays, largeGap: a.largeGap,
      proposedAvailability: a.proposedAvailability,
    })),
    largeGapSample: largeGap.slice(0, 25).map((a) => ({
      schemecode: a.schemecode, fundName: a.fundName,
      historyLastDate: a.historyLastDate, latestNavDate: a.latestNavDate,
      gapCalendarDays: a.gapCalendarDays,
    })),
    staleLatestSample: staleLatest.slice(0, 25).map((a) => ({
      schemecode: a.schemecode, fundName: a.fundName,
      historyLastDate: a.historyLastDate, latestNavDate: a.latestNavDate,
    })),
    invalidNavSample: invalidNav.slice(0, 25).map((a) => ({
      schemecode: a.schemecode, fundName: a.fundName,
      latestNav: a.latestNav, latestNavDate: a.latestNavDate,
    })),
    manifestOnlySample: manifestOnly.slice(0, 25).map((m) => ({
      schemecode: m.schemecode, fundName: m.fundName, lastDate: m.lastDate,
    })),
    debugArtifacts: {
      returnsSummary: path.relative(process.cwd(), RETURNS_SUMMARY_PATH),
      categorySummary: path.relative(process.cwd(), CATEGORY_SUMMARY_PATH),
      sampleDir: path.relative(process.cwd(), SAMPLE_DIR),
    },
    recommendation: (() => {
      if (!guardPass) return `BLOCK: dry-run guardrails failed (${guardFailures.join(" · ")}). Investigate before promoting to Phase 3.9C production write. Existing public/nav-history files were left untouched.`;
      if (wouldAppend.length === 0) return `NOOP: no funds would gain a new NAV point on this run (all funds are at the latest feed date already). Production run would be a clean no-commit.`;
      return `PROCEED to Phase 3.9C design (manual production write): ${wouldAppend.length} fund(s) would gain a new NAV point; max gap = ${maxGap} day(s); period coverage deltas 1M=${signed(periodCoverageDelta["1M"])} 3M=${signed(periodCoverageDelta["3M"])} 6M=${signed(periodCoverageDelta["6M"])} 1Y=${signed(periodCoverageDelta["1Y"])} 3Y=${signed(periodCoverageDelta["3Y"])} 5Y=${signed(periodCoverageDelta["5Y"])}.`;
    })(),
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  let wrote = false;
  try {
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    wrote = true;
    info(`wrote ${path.relative(process.cwd(), REPORT_PATH)}`);
  } catch (e) {
    warn(`could not write report: ${(e as Error).message}`);
  }

  info(`============ NAV HISTORY FORWARD REFRESH DRY-RUN ============`);
  info(`Feed date: ${latest.feedDate} (${feedDateIso ?? "?"})  ·  manifest stage=${manifest.stage} generatedAt=${manifest.generatedAt}`);
  info(`Counts: wouldAppend=${wouldAppend.length} current=${current.length} staleLatest=${staleLatest.length} invalidNav=${invalidNav.length} noExistingHistory=${noExistingHistory.length} noLatestRow=${noLatestRow.length} largeGap=${largeGap.length} manifestOnly=${manifestOnly.length}`);
  info(`Max gap (calendar days): ${maxGap}  ·  large-gap funds: ${largeGap.length} (= ${largeGapPct.toFixed(2)}%; block at ${LARGE_GAP_BLOCK_PCT}%)`);
  info(`Changed-file estimate (production write would touch): ${wouldAppend.length}`);
  info(`Current  periodCoverage: 1M=${currentPeriodCoverage["1M"]} 3M=${currentPeriodCoverage["3M"]} 6M=${currentPeriodCoverage["6M"]} 1Y=${currentPeriodCoverage["1Y"]} 3Y=${currentPeriodCoverage["3Y"]} 5Y=${currentPeriodCoverage["5Y"]}`);
  info(`Proposed periodCoverage: 1M=${proposedPeriodCoverage["1M"]} 3M=${proposedPeriodCoverage["3M"]} 6M=${proposedPeriodCoverage["6M"]} 1Y=${proposedPeriodCoverage["1Y"]} 3Y=${proposedPeriodCoverage["3Y"]} 5Y=${proposedPeriodCoverage["5Y"]}`);
  info(`Coverage deltas:         1M=${signed(periodCoverageDelta["1M"])} 3M=${signed(periodCoverageDelta["3M"])} 6M=${signed(periodCoverageDelta["6M"])} 1Y=${signed(periodCoverageDelta["1Y"])} 3Y=${signed(periodCoverageDelta["3Y"])} 5Y=${signed(periodCoverageDelta["5Y"])}`);
  for (const s of sampleSummaries) {
    info(`   sample ${s.schemecode}: ${s.fundName}  action=${s.action} pts=${s.proposedPoints} ${s.proposedFirstDate ?? "-"}..${s.proposedLastDate ?? "-"} gap=${s.gapCalendarDays}d → ${s.path}`);
  }
  info(`Guardrails: ${guardPass ? "PASS" : "FAIL · " + guardFailures.join(" · ")}`);
  info(`Recommendation: ${report.recommendation}`);
  info(`Debug artifacts: ${path.relative(process.cwd(), REPORT_PATH)} · ${path.relative(process.cwd(), RETURNS_SUMMARY_PATH)} · ${path.relative(process.cwd(), CATEGORY_SUMMARY_PATH)} · ${path.relative(process.cwd(), SAMPLE_DIR)}/`);
  info(`Production write: NOT WIRED in Phase 3.9B (dry-run only). Phase 3.9C will add it.`);
  info(`=============================================================`);

  if (!wrote) process.exit(1);
  if (!guardPass) { warn(`guardrails failed: ${guardFailures.join(" · ")}`); process.exit(1); }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// Phase 3.9B: this module is import-safe — the synthetic test imports
// `simulateForwardAppend` / `dataAvailability` / `ddMMMyyyyToIso` and
// must NOT trigger a real run as a side effect. We only invoke main()
// when the file is being executed directly (process.argv[1] points
// at this file). Works for tsx / node ESM and CJS.
const _argv1 = process.argv[1] ?? "";
const _isEntry =
  _argv1.endsWith("/nav-history-forward.ts") ||
  _argv1.endsWith("\\nav-history-forward.ts") ||
  _argv1.endsWith("/nav-history-forward.js") ||
  _argv1.endsWith("\\nav-history-forward.js");
if (_isEntry) {
  main().catch((e) => {
    warn(`nav-history-forward failed: ${(e as Error).message}`);
    process.exit(1);
  });
}
