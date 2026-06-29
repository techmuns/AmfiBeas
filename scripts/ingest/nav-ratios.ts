/**
 * MF risk/return ratios — Std Dev, Beta, Sharpe, Sortino, Alpha.
 *
 * For every plan-key in mf-returns.json we read its daily NAV history
 * (public/nav-history/{schemecode}.json), reduce it to month-end NAVs, and
 * derive the trailing WINDOW_MONTHS (36) monthly returns ending at the latest
 * common month. From those monthly returns — and the Nifty 500 benchmark's
 * monthly returns over the same months — we compute the five ratios using the
 * conventions documented below, then cohort by (classification | plan | option)
 * to attach a category average, a competition rank, and the number of funds in
 * the category for each ratio (only when the cohort has ≥ MIN_PEER_COUNT funds
 * with a full window). Output: public/nav-data/mf-ratios.json, keyed by
 * schemecode (the plan-key) for O(1) lookup from the Returns & Ranking tab.
 *
 * Conventions (monthly returns r as decimals; benchmark b likewise):
 *   - Risk-free rate Rf      = RISK_FREE_RATE   (annual; India 1Y T-bill ≈ 6.5%)
 *   - Assumed market return  = MARKET_RETURN    (annual; client default 11%)
 *   - rfM = Rf / 12 (monthly risk-free)
 *   - Std Dev (%)  = sampleStdev(r) × √12 × 100              (annualised)
 *   - Beta         = Cov(r, b) / Var(b)                      (population, monthly)
 *   - annReturn    = mean(r) × 12                            (arithmetic, decimal)
 *   - annStdDev    = sampleStdev(r) × √12                    (decimal)
 *   - Sharpe       = (annReturn − Rf) / annStdDev
 *   - downsideDev  = √( mean( min(0, r − rfM)² ) )           (monthly, target=rfM)
 *   - Sortino      = (annReturn − Rf) / (downsideDev × √12)
 *   - Alpha (%)    = (annReturn − [Rf + Beta × (MARKET_RETURN − Rf)]) × 100  (Jensen/CAPM)
 *
 * Ranking direction (rank 1 = best): Std Dev ascending (less risk), Beta
 * ascending (closer-to-market / less leveraged), Sharpe/Sortino/Alpha
 * descending (more reward). Competition ("1224") ranking — ties share the
 * higher rank, the next distinct value skips.
 *
 * Run: npm run ingest:nav:ratios
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/mf-returns.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const BENCHMARK_PATH = path.resolve(process.cwd(), "public/index-history/NIFTY_500.json");
const OUTPUT_PATH = path.resolve(process.cwd(), "public/nav-data/mf-ratios.json");

const RULE_VERSION = 1;
const MIN_PEER_COUNT = 5;
const WINDOW_MONTHS = 36; // trailing months of returns (needs 37 month-end NAVs)
// Risk-free: India 1-year T-bill (~6.5% as of 2026). Assumed market return per
// the client. Both are documented, configurable constants — not data-derived.
const RISK_FREE_RATE = 0.065;
const MARKET_RETURN = 0.11;
const BENCHMARK_ID = "NIFTY_500";

type Plan = "direct" | "regular" | "unknown";
type OptionKind = "growth" | "idcw" | "unknown";

type Metric = "stdDev" | "beta" | "sharpe" | "sortino" | "alpha";
const METRICS: Metric[] = ["stdDev", "beta", "sharpe", "sortino", "alpha"];
// true → higher is better (rank desc); false → lower is better (rank asc).
const HIGHER_BETTER: Record<Metric, boolean> = {
  stdDev: false,
  beta: false,
  sharpe: true,
  sortino: true,
  alpha: true,
};

interface ReturnsFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: Plan;
  option: OptionKind;
  isEtf: boolean;
  isFof: boolean;
}
interface ReturnsFile {
  asOfDate: string | null;
  funds: ReturnsFund[];
}

interface HistoryFile {
  series: [string, number][];
}

interface MetricCell {
  value: number;
  categoryAverage: number;
  rank: number;
  count: number;
  percentile: number;
}
interface FundRatios {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: Plan;
  option: OptionKind;
  cohortKey: string;
  monthsUsed: number;
  stdDev: MetricCell;
  beta: MetricCell;
  sharpe: MetricCell;
  sortino: MetricCell;
  alpha: MetricCell;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
/** Sample (n−1) standard deviation. */
function sampleStdev(xs: number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}
/** Population covariance of two equal-length series. */
function covariance(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / xs.length;
}
/** Population variance. */
function variance(xs: number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / xs.length;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Month-end reduction + monthly returns
// ---------------------------------------------------------------------------

/** Map "YYYY-MM" → last NAV in that month (chronological last entry). */
function monthEndNavs(series: [string, number][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [date, nav] of series) {
    if (!Number.isFinite(nav) || nav <= 0) continue;
    m.set(date.slice(0, 7), nav); // series is ascending → last write wins
  }
  return m;
}

/** Build the list of WINDOW_MONTHS+1 consecutive "YYYY-MM" labels ending at
 *  `anchor` (inclusive), oldest first. */
function targetMonths(anchor: string): string[] {
  const [ay, am] = anchor.split("-").map(Number);
  const out: string[] = [];
  let y = ay;
  let mo = am;
  for (let i = 0; i <= WINDOW_MONTHS; i++) {
    out.push(`${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}`);
    mo -= 1;
    if (mo === 0) { mo = 12; y -= 1; }
  }
  return out.reverse();
}

/** Monthly returns (decimals) over `months` from a month-end map. Returns null
 *  if any required month is missing. `months` has WINDOW_MONTHS+1 entries →
 *  WINDOW_MONTHS returns. */
function monthlyReturns(monthEnds: Map<string, number>, months: string[]): number[] | null {
  const navs: number[] = [];
  for (const mk of months) {
    const nav = monthEnds.get(mk);
    if (nav === undefined) return null;
    navs.push(nav);
  }
  const rets: number[] = [];
  for (let i = 1; i < navs.length; i++) rets.push(navs[i] / navs[i - 1] - 1);
  return rets;
}

// ---------------------------------------------------------------------------
// Ratio computation
// ---------------------------------------------------------------------------

const SQRT12 = Math.sqrt(12);
const RF_M = RISK_FREE_RATE / 12;

interface RawRatios {
  stdDev: number;
  beta: number;
  sharpe: number;
  sortino: number;
  alpha: number;
}

function computeRatios(r: number[], b: number[]): RawRatios {
  const sd = sampleStdev(r); // monthly
  const annReturn = mean(r) * 12;
  const annStdDev = sd * SQRT12;
  const beta = variance(b) === 0 ? 0 : covariance(r, b) / variance(b);

  let downSq = 0;
  for (const x of r) {
    const d = Math.min(0, x - RF_M);
    downSq += d * d;
  }
  const downsideDev = Math.sqrt(downSq / r.length); // monthly
  const annDownside = downsideDev * SQRT12;

  const sharpe = annStdDev === 0 ? 0 : (annReturn - RISK_FREE_RATE) / annStdDev;
  const sortino = annDownside === 0 ? 0 : (annReturn - RISK_FREE_RATE) / annDownside;
  const alpha = annReturn - (RISK_FREE_RATE + beta * (MARKET_RETURN - RISK_FREE_RATE));

  return {
    stdDev: round2(annStdDev * 100), // %
    beta: round2(beta),
    sharpe: round2(sharpe),
    sortino: round2(sortino),
    alpha: round2(alpha * 100), // %
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Competition ("1224") ranking. `higherBetter` flips the sort direction.
 *  Returns schemecode → rank. */
function competitionRank(
  funds: Array<{ schemecode: string; value: number }>,
  higherBetter: boolean
): Map<string, number> {
  const sorted = funds.slice().sort((a, b) => (higherBetter ? b.value - a.value : a.value - b.value));
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

function cohortKey(c: string | null, plan: Plan, option: OptionKind): string {
  return `${c ?? "(unclassified)"} | ${plan} | ${option}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();

  info(`reading ${path.relative(process.cwd(), RETURNS_PATH)}`);
  const returnsFile = JSON.parse(await fs.readFile(RETURNS_PATH, "utf8")) as ReturnsFile;
  info(`returns snapshot: funds=${returnsFile.funds.length} asOfDate=${returnsFile.asOfDate ?? "?"}`);

  info(`reading benchmark ${path.relative(process.cwd(), BENCHMARK_PATH)}`);
  const benchmark = JSON.parse(await fs.readFile(BENCHMARK_PATH, "utf8")) as HistoryFile;

  // Anchor month = latest month present in BOTH the benchmark and the snapshot
  // as-of date. Use the benchmark's last month (it tracks the same trading
  // calendar) — falls back to the returns asOfDate month.
  const benchMonths = monthEndNavs(benchmark.series);
  const benchLastMonth = benchmark.series[benchmark.series.length - 1][0].slice(0, 7);
  const asOfMonth = returnsFile.asOfDate ? returnsFile.asOfDate.slice(0, 7) : benchLastMonth;
  const anchor = benchLastMonth <= asOfMonth ? benchLastMonth : asOfMonth;
  const months = targetMonths(anchor);
  info(`window: ${WINDOW_MONTHS} monthly returns, ${months[0]} … ${months[months.length - 1]} (anchor ${anchor})`);

  const benchReturns = monthlyReturns(benchMonths, months);
  if (!benchReturns) {
    warn(`benchmark ${BENCHMARK_ID} lacks a full ${WINDOW_MONTHS + 1}-month window ending ${anchor}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 1. Compute raw ratios per fund (only equity-style funds with full window).
  // -------------------------------------------------------------------------
  const raw = new Map<string, { fund: ReturnsFund; ratios: RawRatios }>();
  let missingHistory = 0;
  let shortWindow = 0;
  for (const fund of returnsFile.funds) {
    // ETFs / FoFs are excluded — these risk ratios target active open-ended
    // schemes benchmarked to the broad market.
    if (fund.isEtf || fund.isFof) continue;
    let hist: HistoryFile;
    try {
      hist = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, `${fund.schemecode}.json`), "utf8")) as HistoryFile;
    } catch {
      missingHistory += 1;
      continue;
    }
    const rets = monthlyReturns(monthEndNavs(hist.series), months);
    if (!rets) { shortWindow += 1; continue; }
    const ratios = computeRatios(rets, benchReturns);
    if (METRICS.some((m) => !Number.isFinite(ratios[m]))) { shortWindow += 1; continue; }
    raw.set(fund.schemecode, { fund, ratios });
  }
  info(`funds with full window: ${raw.size}  (missingHistory=${missingHistory}, shortWindow=${shortWindow})`);

  // -------------------------------------------------------------------------
  // 2. Cohort + per-metric category average / rank / count.
  // -------------------------------------------------------------------------
  const cohorts = new Map<string, string[]>(); // cohortKey → schemecodes
  for (const [code, { fund }] of raw) {
    const k = cohortKey(fund.classification, fund.plan, fund.option);
    let arr = cohorts.get(k);
    if (!arr) { arr = []; cohorts.set(k, arr); }
    arr.push(code);
  }

  // Per cohort, per metric: category average + rank map (when n ≥ MIN_PEER_COUNT).
  const cohortAvg = new Map<string, Partial<Record<Metric, number>>>();
  const cohortRank = new Map<string, Partial<Record<Metric, Map<string, number>>>>();
  const cohortCount = new Map<string, number>();
  for (const [k, codes] of cohorts) {
    cohortCount.set(k, codes.length);
    if (codes.length < MIN_PEER_COUNT) continue;
    const avg: Partial<Record<Metric, number>> = {};
    const ranks: Partial<Record<Metric, Map<string, number>>> = {};
    for (const m of METRICS) {
      const vals = codes.map((c) => ({ schemecode: c, value: raw.get(c)!.ratios[m] }));
      avg[m] = round4(mean(vals.map((v) => v.value)));
      ranks[m] = competitionRank(vals, HIGHER_BETTER[m]);
    }
    cohortAvg.set(k, avg);
    cohortRank.set(k, ranks);
  }

  // -------------------------------------------------------------------------
  // 3. Emit per-fund records — only funds whose cohort cleared MIN_PEER_COUNT
  //    (otherwise there is no category context to show).
  // -------------------------------------------------------------------------
  const funds: Record<string, FundRatios> = {};
  for (const [code, { fund, ratios }] of raw) {
    const k = cohortKey(fund.classification, fund.plan, fund.option);
    const avg = cohortAvg.get(k);
    const ranks = cohortRank.get(k);
    const n = cohortCount.get(k) ?? 0;
    if (!avg || !ranks) continue; // cohort below MIN_PEER_COUNT

    const cell = (m: Metric): MetricCell => {
      const rank = ranks[m]!.get(code)!;
      return {
        value: ratios[m],
        categoryAverage: avg[m]!,
        rank,
        count: n,
        percentile: n === 1 ? 100 : round2(100 * (1 - (rank - 1) / n)),
      };
    };

    funds[code] = {
      schemecode: code,
      fundName: fund.fundName,
      classification: fund.classification,
      plan: fund.plan,
      option: fund.option,
      cohortKey: k,
      monthsUsed: WINDOW_MONTHS,
      stdDev: cell("stdDev"),
      beta: cell("beta"),
      sharpe: cell("sharpe"),
      sortino: cell("sortino"),
      alpha: cell("alpha"),
    };
  }

  const fundCount = Object.keys(funds).length;

  // -------------------------------------------------------------------------
  // 4. Guardrails.
  // -------------------------------------------------------------------------
  const failures: string[] = [];
  if (fundCount < 200) failures.push(`only ${fundCount} funds emitted (floor 200)`);
  for (const [code, fr] of Object.entries(funds)) {
    for (const m of METRICS) {
      const c = fr[m];
      for (const key of ["value", "categoryAverage", "rank", "count", "percentile"] as const) {
        if (!Number.isFinite(c[key])) failures.push(`${code} ${m} non-finite ${key}`);
      }
      if (c.count < MIN_PEER_COUNT) failures.push(`${code} ${m} count=${c.count} < ${MIN_PEER_COUNT}`);
      if (c.rank < 1 || c.rank > c.count) failures.push(`${code} ${m} rank=${c.rank} out of 1..${c.count}`);
    }
  }
  if (failures.length > 0) {
    warn("validation FAILED — NOT writing snapshot:");
    for (const f of failures.slice(0, 20)) warn(`  - ${f}`);
    if (failures.length > 20) warn(`  (… ${failures.length - 20} more)`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 5. Write.
  // -------------------------------------------------------------------------
  const cohortsPublished = [...cohortRank.keys()].length;
  const snapshot = {
    generatedAt,
    source: "computed from public/nav-history + Nifty 500 monthly returns",
    asOfDate: returnsFile.asOfDate,
    asOfMonth: anchor,
    benchmark: BENCHMARK_ID,
    windowMonths: WINDOW_MONTHS,
    monthRange: { from: months[1], to: months[months.length - 1] },
    ruleVersion: RULE_VERSION,
    minPeerCount: MIN_PEER_COUNT,
    cohortKey: "classification | plan | option",
    params: {
      riskFreeRate: RISK_FREE_RATE,
      riskFreeRateLabel: "India 1-year T-bill (annual)",
      marketReturn: MARKET_RETURN,
      marketReturnLabel: "assumed long-run market return (annual)",
    },
    formulas: {
      stdDev: "sampleStdev(monthlyReturns) × √12 × 100  (annualised, %)",
      beta: "Cov(fund, benchmark) / Var(benchmark)  (monthly)",
      sharpe: "(mean(r)×12 − Rf) / (sampleStdev(r) × √12)",
      sortino: "(mean(r)×12 − Rf) / (downsideDev × √12), downside target = Rf/12",
      alpha: "(mean(r)×12 − [Rf + Beta×(Rm − Rf)]) × 100  (Jensen/CAPM, %)",
    },
    ranking: {
      rule: "competition (1224) within cohort",
      direction: { stdDev: "ascending", beta: "ascending", sharpe: "descending", sortino: "descending", alpha: "descending" },
    },
    cohortsPublished,
    fundCount,
    funds,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  info("================== MF RATIOS SUMMARY ==================");
  info(`asOfMonth: ${anchor}  ·  window: ${WINDOW_MONTHS}m  ·  benchmark: ${BENCHMARK_ID}`);
  info(`Rf=${RISK_FREE_RATE} Rm=${MARKET_RETURN}  ·  cohortsPublished=${cohortsPublished}  ·  funds=${fundCount}`);
  info(`Guardrails: PASS`);
  info("======================================================");
}

main().catch((e) => {
  warn(`nav-ratios failed: ${(e as Error).message}`);
  process.exit(1);
});
