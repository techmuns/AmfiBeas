/**
 * Rolling-return peer ranks — the rolling-mode counterpart of
 * nav-category-returns. For every fund and rolling window (6M/1Y/3Y/5Y) we read
 * the daily NAV history, compute the AVERAGE rolling return with the exact same
 * helpers the UI uses (src/lib/rolling.ts — so the number matches the chart's
 * "avg" stat), then cohort by (classification | plan | option) and rank within
 * the cohort by that average.
 *
 * Output shape mirrors mf-category-returns.json (fundRanks[].periodRanks keyed
 * by the rolling window), so the Returns & Ranking tab reuses CategoryStrip +
 * TrendsPeerTable for rolling mode with no new rendering code.
 *
 * A fund/window is ranked only when it has ≥ MIN_WINDOWS rolling windows (the
 * same gate the UI applies before offering a window) and its cohort has ≥
 * MIN_PEER_COUNT such funds.
 *
 * Run: npm run ingest:nav:rolling-ranks
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";
import {
  ROLLING_WINDOWS,
  rollingReturns,
  rollingStats,
  type RollingWindow,
} from "../../src/lib/rolling";

const RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/mf-returns.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const OUTPUT_PATH = path.resolve(process.cwd(), "public/nav-data/mf-rolling-ranks.json");

const RULE_VERSION = 1;
const MIN_PEER_COUNT = 5;
// Matches MIN_ROLLING_WINDOWS in PortfolioTrendsTab — a window needs enough
// samples for its average to be meaningful (and to be offered in the UI).
const MIN_WINDOWS = 30;

type Plan = "direct" | "regular" | "unknown";
type OptionKind = "growth" | "idcw" | "unknown";

interface ReturnsFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: Plan;
  option: OptionKind;
}
interface ReturnsFile {
  asOfDate: string | null;
  funds: ReturnsFund[];
}
interface HistoryFile {
  series: [string, number][];
}

type Quartile = "Q1" | "Q2" | "Q3" | "Q4";

// ---------------------------------------------------------------------------
// Helpers (mirror nav-category-returns)
// ---------------------------------------------------------------------------

function cohortKey(c: string | null, plan: Plan, option: OptionKind): string {
  return `${c ?? "(unclassified)"} | ${plan} | ${option}`;
}
function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
function quantileSorted(asc: number[], p: number): number {
  if (asc.length === 0) return NaN;
  if (asc.length === 1) return asc[0];
  if (p <= 0) return asc[0];
  if (p >= 1) return asc[asc.length - 1];
  const idx = (asc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return asc[lo];
  return asc[lo] * (1 - (idx - lo)) + asc[hi] * (idx - lo);
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
/** Competition ("1224") ranking, higher value first. */
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
// Output types (subset of the category-returns shape the UI already consumes)
// ---------------------------------------------------------------------------

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
  return?: number;
  cohortKey: string;
  peerCount: number;
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
  periodRanks: Partial<Record<RollingWindow, FundPeriodEntry>>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();
  info(`reading ${path.relative(process.cwd(), RETURNS_PATH)}`);
  const returnsFile = JSON.parse(await fs.readFile(RETURNS_PATH, "utf8")) as ReturnsFile;
  info(`funds: ${returnsFile.funds.length}  asOfDate: ${returnsFile.asOfDate ?? "?"}`);

  // 1. Per-fund average rolling return per window (null when < MIN_WINDOWS).
  const perFundAvg = new Map<string, Partial<Record<RollingWindow, number>>>();
  let missingHistory = 0;
  let withAny = 0;
  for (const f of returnsFile.funds) {
    let hist: HistoryFile;
    try {
      hist = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, `${f.schemecode}.json`), "utf8")) as HistoryFile;
    } catch {
      missingHistory += 1;
      continue;
    }
    const avgs: Partial<Record<RollingWindow, number>> = {};
    let any = false;
    for (const w of ROLLING_WINDOWS) {
      const st = rollingStats(rollingReturns(hist.series, w));
      if (st && st.count >= MIN_WINDOWS && Number.isFinite(st.avg)) {
        avgs[w] = st.avg;
        any = true;
      }
    }
    if (any) { perFundAvg.set(f.schemecode, avgs); withAny += 1; }
  }
  info(`funds with ≥1 rolling window: ${withAny}  (missingHistory=${missingHistory})`);

  // 2. Cohorts.
  const cohorts = new Map<string, ReturnsFund[]>();
  for (const f of returnsFile.funds) {
    const k = cohortKey(f.classification, f.plan, f.option);
    let arr = cohorts.get(k);
    if (!arr) { arr = []; cohorts.set(k, arr); }
    arr.push(f);
  }

  // 3. Per-cohort per-window stats + ranks (n ≥ MIN_PEER_COUNT).
  interface CohortWindowStats {
    average: number;
    median: number;
    ranks: Map<string, number>;
    n: number;
  }
  const cohortStats = new Map<string, Partial<Record<RollingWindow, CohortWindowStats>>>();
  for (const [key, funds] of cohorts) {
    const byWindow: Partial<Record<RollingWindow, CohortWindowStats>> = {};
    for (const w of ROLLING_WINDOWS) {
      const valued = funds
        .map((f) => ({ schemecode: f.schemecode, value: perFundAvg.get(f.schemecode)?.[w] }))
        .filter((v): v is { schemecode: string; value: number } => typeof v.value === "number");
      if (valued.length < MIN_PEER_COUNT) continue;
      const asc = valued.map((v) => v.value).sort((a, b) => a - b);
      byWindow[w] = {
        average: round4(mean(asc)),
        median: round4(quantileSorted(asc, 0.5)),
        ranks: competitionRank(valued),
        n: valued.length,
      };
    }
    cohortStats.set(key, byWindow);
  }

  // 4. Per-fund records.
  const fundRanks: FundRank[] = returnsFile.funds.map((f) => {
    const key = cohortKey(f.classification, f.plan, f.option);
    const cohort = cohorts.get(key) ?? [];
    const stats = cohortStats.get(key) ?? {};
    const avgs = perFundAvg.get(f.schemecode) ?? {};
    const periodRanks: Partial<Record<RollingWindow, FundPeriodEntry>> = {};

    for (const w of ROLLING_WINDOWS) {
      const avg = avgs[w];
      const ws = stats[w];
      const cohortFundsWithWindow = cohort.filter((cf) => typeof perFundAvg.get(cf.schemecode)?.[w] === "number").length;
      if (avg === undefined) {
        // Fund lacks enough windows; still surface a "no stats" entry.
        periodRanks[w] = {
          cohortKey: key,
          peerCount: cohortFundsWithWindow,
          statsAvailable: false,
          reason: `fewer than ${MIN_WINDOWS} rolling ${w} windows for this fund`,
        };
        continue;
      }
      if (!ws) {
        periodRanks[w] = {
          return: round4(avg),
          cohortKey: key,
          peerCount: cohortFundsWithWindow,
          statsAvailable: false,
          reason: `cohort has only ${cohortFundsWithWindow} peers with rolling ${w} (need ${MIN_PEER_COUNT})`,
        };
        continue;
      }
      const rank = ws.ranks.get(f.schemecode)!;
      const percentile = ws.n === 1 ? 100 : 100 * (1 - (rank - 1) / ws.n);
      periodRanks[w] = {
        return: round4(avg),
        rank,
        peerCount: ws.n,
        percentile: round2(percentile),
        quartile: quartileFromPercentile(percentile),
        categoryAverage: ws.average,
        categoryMedian: ws.median,
        excessVsAverage: round4(avg - ws.average),
        excessVsMedian: round4(avg - ws.median),
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

  // 5. Guardrails.
  const failures: string[] = [];
  const rankedByWindow: Record<RollingWindow, number> = { "6M": 0, "1Y": 0, "3Y": 0, "5Y": 0 };
  for (const fr of fundRanks) {
    for (const w of ROLLING_WINDOWS) {
      const e = fr.periodRanks[w];
      if (!e || !e.statsAvailable) continue;
      rankedByWindow[w] += 1;
      for (const k of ["return", "rank", "peerCount", "percentile", "categoryAverage", "categoryMedian", "excessVsAverage", "excessVsMedian"] as const) {
        const v = e[k];
        if (typeof v !== "number" || !Number.isFinite(v)) failures.push(`${fr.schemecode} ${w} non-finite ${k}`);
      }
      if (!["Q1", "Q2", "Q3", "Q4"].includes(e.quartile)) failures.push(`${fr.schemecode} ${w} bad quartile ${e.quartile}`);
      if (e.rank < 1 || e.rank > e.peerCount) failures.push(`${fr.schemecode} ${w} rank ${e.rank}/${e.peerCount} out of range`);
    }
  }
  const totalRanked = ROLLING_WINDOWS.reduce((s, w) => s + rankedByWindow[w], 0);
  if (totalRanked < 200) failures.push(`only ${totalRanked} fund-window ranks produced (floor 200)`);
  if (failures.length > 0) {
    warn("validation FAILED — NOT writing snapshot:");
    for (const f of failures.slice(0, 20)) warn(`  - ${f}`);
    process.exit(1);
  }

  // 6. Write.
  const snapshot = {
    generatedAt,
    source: "computed from public/nav-history via src/lib/rolling",
    asOfDate: returnsFile.asOfDate,
    ruleVersion: RULE_VERSION,
    windows: [...ROLLING_WINDOWS],
    minPeerCount: MIN_PEER_COUNT,
    minWindows: MIN_WINDOWS,
    metric: "average rolling return over the window (annualised/CAGR for 3Y & 5Y)",
    cohortKey: "classification | plan | option",
    rankingRule: "competition ranking on the average rolling return; higher = better",
    fundRanks,
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  info("================ MF ROLLING RANKS SUMMARY ================");
  for (const w of ROLLING_WINDOWS) info(`  ${w}: funds ranked = ${rankedByWindow[w]}`);
  info(`Guardrails: PASS`);
  info("=========================================================");
}

main().catch((e) => {
  warn(`nav-rolling-ranks failed: ${(e as Error).message}`);
  process.exit(1);
});
