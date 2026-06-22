/**
 * Phase 3.3B — category returns, peer ranks, and quartiles.
 *
 * Reads the committed src/data/snapshots/mf-returns.json, groups funds into
 * cohorts by (classification, plan, option), computes per-cohort/per-period
 * average/median/quartile-thresholds/best/worst when n ≥ 5, and computes
 * per-fund rank/percentile/quartile + cohort context for every period the
 * fund has a return value. Writes src/data/snapshots/mf-category-returns.json.
 *
 * Cohorting policy (per the Phase 3.3B spec):
 *  - Cohort key is the literal triple (classification, plan, option). No
 *    Direct/Regular mixing. No Growth/IDCW mixing. ETFs and FoFs keep
 *    plan="unknown"/option="unknown" if that's how mf-returns labelled them
 *    and form their own cohorts — they are never folded into direct/regular.
 *  - Minimum peer count for peer stats: n ≥ 5. Below that, the per-fund
 *    period entry records statsAvailable=false with a reason.
 *
 * Ranking and quartile rules (chosen and documented in the snapshot meta):
 *  - Higher return is better. Rank 1 = highest return.
 *  - COMPETITION ranking ("1224"): ties share the higher rank; the next
 *    rank skips. Picked over dense ranking because "joint 3rd of 38" is
 *    less confusing to a Trends-UI reader than "3rd of 38 in dense order".
 *  - Percentile = 100 × (1 − (rank − 1) / n). Top fund → 100; bottom →
 *    100/n. Consistent with the existing formatPercentile helper which
 *    treats high values as "top".
 *  - Quartile is assigned by PERCENTILE BAND (so tied funds always land in
 *    the same quartile):
 *      Q1: percentile ≥ 75   (top quartile)
 *      Q2: 50 ≤ percentile < 75
 *      Q3: 25 ≤ percentile < 50
 *      Q4: percentile < 25
 *
 * Validation: refuses to write the snapshot if (fundRanks.length ≠ 1036),
 * any value is NaN/Infinite, any quartile escapes Q1..Q4 when stats are
 * available, any cohort with n ≥ 5 fails the n threshold, or any cohort
 * mixes plans/options. On failure exits non-zero and reports reasons.
 *
 * Run: npm run ingest:nav:category-returns
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/mf-returns.json");
const OUTPUT_PATH = path.resolve(process.cwd(), "public/nav-data/mf-category-returns.json");

const RULE_VERSION = 1;
const MIN_PEER_COUNT = 5;
// Phase 3.6B/3.8B: 3Y and 5Y are sourced directly from mf-returns.json
// (CAGR values produced by Phases 3.6A / 3.8A). We do NOT recompute
// fund-level returns here; this script only ranks/aggregates what
// mf-returns has already produced.
const PERIODS = ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;
type PeriodKey = (typeof PERIODS)[number];

// ---------------------------------------------------------------------------
// Input types (subset of mf-returns.json)
// ---------------------------------------------------------------------------

type Plan = "direct" | "regular" | "unknown";
type OptionKind = "growth" | "idcw" | "unknown";

// Phase 3.6B/3.8B: 1M/3M/6M/1Y stay "simple"; 3Y and 5Y are "cagr" with
// an extra `years` field. Only `value` is consumed here — the ranking
// logic treats every period uniformly.
type ReturnCell =
  | { value: number; kind: "simple"; startDate: string; startNav: number; endDate: string; endNav: number }
  | { value: number; kind: "cagr"; startDate: string; startNav: number; endDate: string; endNav: number; years: number };

interface ReturnsFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  plan: Plan;
  option: OptionKind;
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

interface ReturnsFile {
  generatedAt: string;
  source: string;
  historyStage: number;
  historyManifestGeneratedAt: string;
  asOfDate: string | null;
  ruleVersion: number;
  periodCoverage: Record<PeriodKey, number>;
  funds: ReturnsFund[];
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

type Quartile = "Q1" | "Q2" | "Q3" | "Q4";

interface CategoryPeriodStats {
  n: number;
  average: number;
  median: number;
  q1Threshold: number; // 75th percentile return value
  q2Threshold: number; // 50th percentile (= median)
  q3Threshold: number; // 25th percentile
  best: number;
  worst: number;
  count: number;
}

interface CategoryEntry {
  classification: string | null;
  plan: Plan;
  option: OptionKind;
  periods: Partial<Record<PeriodKey, CategoryPeriodStats>>;
}

interface FundPeriodRank {
  return: number;
  rank: number;
  peerCount: number;
  percentile: number;
  quartile: Quartile;
  categoryAverage: number;
  categoryMedian: number;
  excessVsAverage: number;
  excessVsMedian: number;
  cohortKey: string;
  statsAvailable: true;
}
interface FundPeriodNoStats {
  return?: number;             // present when the fund has a return but the cohort lacks peers
  cohortKey: string;
  peerCount: number;           // n of the fund's cohort (could be 0)
  statsAvailable: false;
  reason: string;
}
type FundPeriodEntry = FundPeriodRank | FundPeriodNoStats;

interface FundRank {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: Plan;
  option: OptionKind;
  periodRanks: Partial<Record<PeriodKey, FundPeriodEntry>>;
}

interface CoverageSummary {
  cohortCount: number;
  cohortsWithStatsByPeriod: Record<PeriodKey, number>;
  fundsWithRankByPeriod: Record<PeriodKey, number>;
  fundsWithoutStatsByPeriod: Record<PeriodKey, number>;
  fundsWithoutStatsTopReasonsByPeriod: Record<PeriodKey, Array<{ reason: string; count: number }>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cohortKey(c: string | null, plan: Plan, option: OptionKind): string {
  return `${c ?? "(unclassified)"} | ${plan} | ${option}`;
}

/** Linearly-interpolated percentile of an ascending-sorted numeric array.
 *  `p` is a fraction in [0, 1] (e.g. 0.75 → 75th percentile = top-quartile
 *  cutoff for "what return separates the top quartile?"). Matches the
 *  classic R-7 / Excel-PERCENTILE.INC method. */
function quantileSorted(asc: number[], p: number): number {
  if (asc.length === 0) return NaN;
  if (asc.length === 1) return asc[0];
  if (p <= 0) return asc[0];
  if (p >= 1) return asc[asc.length - 1];
  const idx = (asc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return asc[lo];
  const frac = idx - lo;
  return asc[lo] * (1 - frac) + asc[hi] * frac;
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Competition ("1224") ranking on a list of {schemecode, value}, higher
 *  value first. Returns a map schemecode → rank where ties share the higher
 *  rank and the next distinct value skips ranks. */
function competitionRank(funds: Array<{ schemecode: string; value: number }>): Map<string, number> {
  const sorted = funds.slice().sort((a, b) => b.value - a.value);
  const ranks = new Map<string, number>();
  let lastValue = NaN;
  let lastRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i].value === lastValue ? lastRank : i + 1;
    ranks.set(sorted[i].schemecode, r);
    lastValue = sorted[i].value;
    lastRank = r;
  }
  return ranks;
}

function quartileFromPercentile(p: number): Quartile {
  if (p >= 75) return "Q1";
  if (p >= 50) return "Q2";
  if (p >= 25) return "Q3";
  return "Q4";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), RETURNS_PATH)}`);
  let returnsFile: ReturnsFile;
  try {
    returnsFile = JSON.parse(await fs.readFile(RETURNS_PATH, "utf8")) as ReturnsFile;
  } catch (e) {
    warn(`could not read returns snapshot: ${(e as Error).message}`);
    process.exit(1);
  }
  info(`returns snapshot: rows=${returnsFile.funds.length} asOfDate=${returnsFile.asOfDate ?? "?"} stage=${returnsFile.historyStage}`);

  // ---------------------------------------------------------------------------
  // 1. Group funds into cohorts by (classification, plan, option).
  // ---------------------------------------------------------------------------
  const cohorts = new Map<string, ReturnsFund[]>();
  for (const f of returnsFile.funds) {
    const k = cohortKey(f.classification, f.plan, f.option);
    let arr = cohorts.get(k);
    if (!arr) { arr = []; cohorts.set(k, arr); }
    arr.push(f);
  }
  info(`cohorts: ${cohorts.size}`);

  // ---------------------------------------------------------------------------
  // 2. Per-cohort, per-period stats (only when n ≥ MIN_PEER_COUNT).
  // ---------------------------------------------------------------------------
  // cohortPeriodStats[cohortKey][period] = stats (or undefined if n < threshold)
  const cohortPeriodStats = new Map<string, Partial<Record<PeriodKey, CategoryPeriodStats>>>();
  // perFundPercohortRanks[cohortKey][period] = Map<schemecode, rank>
  const perCohortRanks = new Map<string, Partial<Record<PeriodKey, Map<string, number>>>>();

  for (const [key, funds] of cohorts) {
    const periodStats: Partial<Record<PeriodKey, CategoryPeriodStats>> = {};
    const periodRanks: Partial<Record<PeriodKey, Map<string, number>>> = {};
    for (const p of PERIODS) {
      const valued = funds
        .filter((f) => f.returns[p] !== undefined && Number.isFinite(f.returns[p]!.value))
        .map((f) => ({ schemecode: f.schemecode, value: f.returns[p]!.value }));
      if (valued.length < MIN_PEER_COUNT) continue;
      const ascValues = valued.map((v) => v.value).sort((a, b) => a - b);
      periodStats[p] = {
        n: valued.length,
        count: valued.length,
        average: round4(mean(ascValues)),
        median: round4(quantileSorted(ascValues, 0.5)),
        q1Threshold: round4(quantileSorted(ascValues, 0.75)),
        q2Threshold: round4(quantileSorted(ascValues, 0.5)),
        q3Threshold: round4(quantileSorted(ascValues, 0.25)),
        best: round4(ascValues[ascValues.length - 1]),
        worst: round4(ascValues[0]),
      };
      periodRanks[p] = competitionRank(valued);
    }
    cohortPeriodStats.set(key, periodStats);
    perCohortRanks.set(key, periodRanks);
  }

  // ---------------------------------------------------------------------------
  // 3. Per-fund period ranks + per-cohort fund counts (for "no stats" reason).
  // ---------------------------------------------------------------------------
  const fundRanks: FundRank[] = returnsFile.funds.map((f) => {
    const key = cohortKey(f.classification, f.plan, f.option);
    const cohort = cohorts.get(key) ?? [];
    const stats = cohortPeriodStats.get(key) ?? {};
    const ranks = perCohortRanks.get(key) ?? {};
    const periodRanks: Partial<Record<PeriodKey, FundPeriodEntry>> = {};

    for (const p of PERIODS) {
      const cell = f.returns[p];
      const ps = stats[p];
      const rankMap = ranks[p];
      // How many funds in this cohort have data for this period — needed for
      // the "no stats" reason whether or not THIS fund has data.
      const cohortFundsWithReturn = cohort.filter((cf) => cf.returns[p] !== undefined).length;

      if (!cell || !Number.isFinite(cell.value)) {
        periodRanks[p] = {
          cohortKey: key,
          peerCount: cohortFundsWithReturn,
          statsAvailable: false,
          reason: "fund has no return for this period",
        };
        continue;
      }
      if (!ps || !rankMap) {
        periodRanks[p] = {
          return: round4(cell.value),
          cohortKey: key,
          peerCount: cohortFundsWithReturn,
          statsAvailable: false,
          reason: `cohort has only ${cohortFundsWithReturn} peers with data for this period (need ${MIN_PEER_COUNT})`,
        };
        continue;
      }
      const rank = rankMap.get(f.schemecode);
      if (rank === undefined) {
        // Shouldn't happen given the filter above; defensive.
        periodRanks[p] = {
          return: round4(cell.value),
          cohortKey: key,
          peerCount: ps.n,
          statsAvailable: false,
          reason: "fund return present but missing from cohort rank map (defensive)",
        };
        continue;
      }
      const percentile = ps.n === 1 ? 100 : 100 * (1 - (rank - 1) / ps.n);
      const quartile = quartileFromPercentile(percentile);
      periodRanks[p] = {
        return: round4(cell.value),
        rank,
        peerCount: ps.n,
        percentile: round2(percentile),
        quartile,
        categoryAverage: ps.average,
        categoryMedian: ps.median,
        excessVsAverage: round4(cell.value - ps.average),
        excessVsMedian: round4(cell.value - ps.median),
        cohortKey: key,
        statsAvailable: true,
      };
    }

    return {
      schemecode: f.schemecode,
      fundName: f.fundName,
      classification: f.classification,
      plan: f.plan,
      option: f.option,
      periodRanks,
    };
  });

  // ---------------------------------------------------------------------------
  // 4. Categories array (deterministic order: classification asc, plan, option).
  // ---------------------------------------------------------------------------
  const planOrder: Record<Plan, number> = { direct: 0, regular: 1, unknown: 2 };
  const optionOrder: Record<OptionKind, number> = { growth: 0, idcw: 1, unknown: 2 };
  const categories: CategoryEntry[] = [];
  for (const [key, funds] of cohorts) {
    const stats = cohortPeriodStats.get(key) ?? {};
    const f0 = funds[0];
    categories.push({
      classification: f0.classification,
      plan: f0.plan,
      option: f0.option,
      periods: stats,
    });
  }
  categories.sort((a, b) => {
    const ca = a.classification ?? "(unclassified)";
    const cb = b.classification ?? "(unclassified)";
    if (ca !== cb) return ca.localeCompare(cb);
    if (a.plan !== b.plan) return planOrder[a.plan] - planOrder[b.plan];
    return optionOrder[a.option] - optionOrder[b.option];
  });

  // Stable sort fundRanks by numeric schemecode (matches mf-returns ordering).
  fundRanks.sort((a, b) => {
    const an = Number(a.schemecode);
    const bn = Number(b.schemecode);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.schemecode.localeCompare(b.schemecode);
  });

  // ---------------------------------------------------------------------------
  // 5. Coverage summary.
  // ---------------------------------------------------------------------------
  const cohortsWithStatsByPeriod: Record<PeriodKey, number> = { "1M": 0, "3M": 0, "6M": 0, "1Y": 0, "3Y": 0, "5Y": 0 };
  for (const [, stats] of cohortPeriodStats) for (const p of PERIODS) if (stats[p]) cohortsWithStatsByPeriod[p] += 1;

  const fundsWithRankByPeriod: Record<PeriodKey, number> = { "1M": 0, "3M": 0, "6M": 0, "1Y": 0, "3Y": 0, "5Y": 0 };
  const fundsWithoutStatsByPeriod: Record<PeriodKey, number> = { "1M": 0, "3M": 0, "6M": 0, "1Y": 0, "3Y": 0, "5Y": 0 };
  const reasonCounts: Record<PeriodKey, Map<string, number>> = { "1M": new Map(), "3M": new Map(), "6M": new Map(), "1Y": new Map(), "3Y": new Map(), "5Y": new Map() };
  for (const fr of fundRanks) {
    for (const p of PERIODS) {
      const e = fr.periodRanks[p];
      if (!e) { fundsWithoutStatsByPeriod[p] += 1; reasonCounts[p].set("period entry missing", (reasonCounts[p].get("period entry missing") ?? 0) + 1); continue; }
      if (e.statsAvailable) fundsWithRankByPeriod[p] += 1;
      else {
        fundsWithoutStatsByPeriod[p] += 1;
        // Group reasons by category (without the n value, which is per-cohort).
        const baseReason = e.reason.startsWith("cohort has only") ? `cohort below MIN_PEER_COUNT (${MIN_PEER_COUNT})` : e.reason;
        reasonCounts[p].set(baseReason, (reasonCounts[p].get(baseReason) ?? 0) + 1);
      }
    }
  }
  const fundsWithoutStatsTopReasonsByPeriod: Record<PeriodKey, Array<{ reason: string; count: number }>> = { "1M": [], "3M": [], "6M": [], "1Y": [], "3Y": [], "5Y": [] };
  for (const p of PERIODS) {
    fundsWithoutStatsTopReasonsByPeriod[p] = Array.from(reasonCounts[p].entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }
  const coverageSummary: CoverageSummary = {
    cohortCount: cohorts.size,
    cohortsWithStatsByPeriod,
    fundsWithRankByPeriod,
    fundsWithoutStatsByPeriod,
    fundsWithoutStatsTopReasonsByPeriod,
  };

  // ---------------------------------------------------------------------------
  // 6. Guardrails (refuse to write on failure).
  // ---------------------------------------------------------------------------
  const failures: string[] = [];
  if (fundRanks.length !== returnsFile.funds.length) failures.push(`fundRanks.length ${fundRanks.length} != input ${returnsFile.funds.length}`);
  if (fundRanks.length < 1000) failures.push(`fundRanks.length ${fundRanks.length} below floor 1000`);

  // Reconcile per-period coverage vs mf-returns periodCoverage. The fundsWith
  // a rank in a period must be ≤ the funds with a return for that period, and
  // (funds with a return − funds with rank) must equal the funds whose cohort
  // is below threshold for that period.
  for (const p of PERIODS) {
    const fundsWithReturn = returnsFile.funds.filter((f) => f.returns[p] !== undefined).length;
    if (fundsWithReturn !== returnsFile.periodCoverage[p]) {
      failures.push(`${p}: fundsWithReturn ${fundsWithReturn} != mf-returns.periodCoverage[${p}] ${returnsFile.periodCoverage[p]}`);
    }
    if (fundsWithRankByPeriod[p] > fundsWithReturn) {
      failures.push(`${p}: fundsWithRank ${fundsWithRankByPeriod[p]} > fundsWithReturn ${fundsWithReturn}`);
    }
  }

  // Per-cohort: any cohort with a published period must have n ≥ MIN_PEER_COUNT
  // and must not mix plans/options (defensive — the cohort key already enforces).
  for (const [key, statsMap] of cohortPeriodStats) {
    const funds = cohorts.get(key)!;
    const plans = new Set(funds.map((f) => f.plan));
    const options = new Set(funds.map((f) => f.option));
    if (plans.size > 1 || options.size > 1) failures.push(`cohort "${key}" mixes plans=${[...plans]} options=${[...options]}`);
    for (const p of PERIODS) {
      const s = statsMap[p];
      if (s) {
        if (s.n < MIN_PEER_COUNT) failures.push(`cohort "${key}" period ${p} published with n=${s.n} < ${MIN_PEER_COUNT}`);
        for (const k of ["average", "median", "q1Threshold", "q2Threshold", "q3Threshold", "best", "worst"] as const) {
          if (!Number.isFinite(s[k])) failures.push(`cohort "${key}" period ${p} non-finite ${k}`);
        }
      }
    }
  }

  // Every statsAvailable=true entry must have finite values + a valid quartile.
  for (const fr of fundRanks) {
    for (const p of PERIODS) {
      const e = fr.periodRanks[p];
      if (!e || !e.statsAvailable) continue;
      const fields = ["return", "rank", "peerCount", "percentile", "categoryAverage", "categoryMedian", "excessVsAverage", "excessVsMedian"] as const;
      for (const k of fields) {
        const v = e[k];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          failures.push(`${fr.schemecode} ${p} non-finite ${k}`);
        }
      }
      if (!["Q1", "Q2", "Q3", "Q4"].includes(e.quartile)) failures.push(`${fr.schemecode} ${p} invalid quartile ${e.quartile}`);
      if (e.peerCount < MIN_PEER_COUNT) failures.push(`${fr.schemecode} ${p} statsAvailable with peerCount=${e.peerCount} < ${MIN_PEER_COUNT}`);
    }
  }

  if (failures.length > 0) {
    warn("validation FAILED — NOT writing snapshot:");
    for (const f of failures.slice(0, 20)) warn(`  - ${f}`);
    if (failures.length > 20) warn(`  (… ${failures.length - 20} more)`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 7. Write the snapshot.
  // ---------------------------------------------------------------------------
  const snapshot = {
    generatedAt,
    source: "computed from mf-returns.json",
    returnsSnapshotGeneratedAt: returnsFile.generatedAt,
    historyStage: returnsFile.historyStage,
    asOfDate: returnsFile.asOfDate,
    ruleVersion: RULE_VERSION,
    periods: [...PERIODS],
    minPeerCount: MIN_PEER_COUNT,
    cohortKey: "classification | plan | option",
    rankingRule: "competition ranking (1224 — ties share the higher rank, next rank skips); higher return = better; rank 1 = highest return",
    percentileRule: "percentile = 100 × (1 − (rank − 1) / n); top → 100, bottom → 100/n",
    quartileRule: "by percentile band — Q1: ≥75, Q2: 50–75, Q3: 25–50, Q4: <25",
    quantileMethod: "linear interpolation (R-7 / Excel PERCENTILE.INC) on funds with available return; thresholds reported in the same units as returns (%)",
    categories,
    fundRanks,
    coverageSummary,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  info("============== MF CATEGORY RETURNS SUMMARY ==============");
  info(`asOfDate: ${returnsFile.asOfDate}  ·  cohorts: ${cohorts.size}  ·  fundRanks: ${fundRanks.length}`);
  for (const p of PERIODS) {
    info(`  ${p}: cohortsWithStats=${cohortsWithStatsByPeriod[p]} fundsWithRank=${fundsWithRankByPeriod[p]} fundsWithoutStats=${fundsWithoutStatsByPeriod[p]}`);
    for (const r of fundsWithoutStatsTopReasonsByPeriod[p].slice(0, 3)) info(`     reason: "${r.reason}" → ${r.count}`);
  }
  info(`Guardrails: PASS`);
  info("=========================================================");
}

main().catch((e) => {
  warn(`nav-category-returns failed: ${(e as Error).message}`);
  process.exit(1);
});
