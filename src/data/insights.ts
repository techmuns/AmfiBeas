import { monthlyTrend } from "./amfi-monthly";
import {
  categoryRowsForSlug,
  IIFL_ACTIVE_EQUITY_CATEGORIES,
} from "./amfi-monthly-category";
import { cyclePhaseHistory } from "./market-indices";
import { capFlows } from "./cap-flows";
import { classifySector } from "./sector-classification";
import insightsHoldings from "./portfolio-tracker/insights-holdings.json";

/**
 * Computed inputs for the Insights tab — the "so what?" layer the client
 * asked for. Every helper here turns raw dashboard series into a short,
 * decision-grade read: long-term context, cross-correlations, streaks,
 * share shifts and conviction bets. All values are returned raw; the page
 * formats them per the client's rules (full Indian-grouped numbers, brackets
 * for negatives, one decimal place on ratios).
 */

// ---------- Client formatting rules ----------------------------------------

/** Indian-grouped integer ("22,400"; negatives in brackets: "(64,000)"). */
export function fmtINR(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return v < 0 ? `(${abs})` : abs;
}

/** Percent with exactly one decimal place; negatives in brackets. */
export function fmtPct1(v: number): string {
  const abs = Math.abs(v).toFixed(1);
  return v < 0 ? `(${abs}%)` : `${abs}%`;
}

/** Ratio ("2.1x") with one decimal place. */
export function fmtX(v: number): string {
  return `${v.toFixed(1)}x`;
}

/** Signed bps; negatives in brackets ("(45) bps"). */
export function fmtBps(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return v < 0 ? `(${abs}) bps` : `+${abs} bps`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export function monthLong(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ---------- 1. Long-term structural trends ----------------------------------

export interface LongTermTrend {
  field: "sipContribution" | "equityAum";
  latestMonth: string;
  latestValue: number;
  firstMonth: string;
  firstValue: number;
  multiple: number;
  /** Most recent month whose value was ≤ half of the latest — i.e. the
   *  series has DOUBLED since then. null when it never was that low. */
  doubledSinceMonth: string | null;
  doubledSinceValue: number | null;
  doubledInMonths: number | null;
}

function longTermTrend(field: "sipContribution" | "equityAum"): LongTermTrend | null {
  const t = monthlyTrend(field, 10_000).filter((p) => p.value > 0);
  if (t.length < 13) return null;
  const latest = t[t.length - 1];
  const first = t[0];
  let doubled: { label: string; value: number } | null = null;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i].value <= latest.value / 2) {
      doubled = t[i];
      break;
    }
  }
  const monthsBetween = (a: string, b: string) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return (by - ay) * 12 + (bm - am);
  };
  return {
    field,
    latestMonth: latest.label,
    latestValue: latest.value,
    firstMonth: first.label,
    firstValue: first.value,
    multiple: latest.value / first.value,
    doubledSinceMonth: doubled?.label ?? null,
    doubledSinceValue: doubled?.value ?? null,
    doubledInMonths: doubled ? monthsBetween(doubled.label, latest.label) : null,
  };
}

export const sipLongTerm = () => longTermTrend("sipContribution");
export const equityAumLongTerm = () => longTermTrend("equityAum");

// ---------- 2. NFO × market-cycle correlation --------------------------------

export interface NfoCycleInsight {
  bullAvg: number; // avg monthly NFO mobilisation in Expansion/Peak months
  stressAvg: number; // avg in Correction/Base months
  recoveryAvg: number;
  bullMonths: number;
  stressMonths: number;
  multiple: number; // bullAvg / stressAvg
  latestPhase: string;
  latest3mAvg: number;
  firstMonth: string;
  lastMonth: string;
}

export function nfoCycleInsight(): NfoCycleInsight | null {
  // Rows before 2020-03 carry a folio-count extraction glitch — anything
  // above ₹1,00,000 Cr/month is not a believable NFO mobilisation.
  const nfo = monthlyTrend("industryNfoFundsMobilized", 10_000).filter(
    (p) => p.value > 0 && p.value < 100_000
  );
  if (nfo.length < 12) return null;
  const phaseByMonth = new Map(cyclePhaseHistory().map((p) => [p.month, p.phase]));
  const buckets: Record<"bull" | "stress" | "recovery", number[]> = {
    bull: [],
    stress: [],
    recovery: [],
  };
  for (const p of nfo) {
    const phase = phaseByMonth.get(p.label);
    if (!phase) continue;
    if (phase === "Expansion" || phase === "Peak") buckets.bull.push(p.value);
    else if (phase === "Correction" || phase === "Base") buckets.stress.push(p.value);
    else buckets.recovery.push(p.value);
  }
  if (buckets.bull.length < 3 || buckets.stress.length < 3) return null;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const phases = cyclePhaseHistory();
  const tail3 = nfo.slice(-3);
  return {
    bullAvg: avg(buckets.bull),
    stressAvg: avg(buckets.stress),
    recoveryAvg: avg(buckets.recovery),
    bullMonths: buckets.bull.length,
    stressMonths: buckets.stress.length,
    multiple: avg(buckets.bull) / avg(buckets.stress),
    latestPhase: phases[phases.length - 1]?.phase ?? "—",
    latest3mAvg: avg(tail3.map((p) => p.value)),
    firstMonth: nfo[0].label,
    lastMonth: nfo[nfo.length - 1].label,
  };
}

// ---------- 3. Consecutive-flow streaks --------------------------------------

export interface CategoryStreak {
  category: string;
  /** Consecutive months of positive net inflow, ending at the latest month. */
  streakMonths: number;
  cumulativeCr: number;
  latestInflowCr: number;
  latestMonth: string;
  /** True when the streak spans the whole available history (could be longer). */
  cappedByHistory: boolean;
}

export function categoryStreaks(minStreak = 3): CategoryStreak[] {
  const out: CategoryStreak[] = [];
  for (const c of IIFL_ACTIVE_EQUITY_CATEGORIES) {
    const rows = categoryRowsForSlug(c.slug).filter(
      (r) => typeof r.categoryNetInflow === "number"
    );
    if (rows.length === 0) continue;
    let streak = 0;
    let cumulative = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i].categoryNetInflow as number;
      if (v > 0) {
        streak += 1;
        cumulative += v;
      } else break;
    }
    if (streak >= minStreak) {
      out.push({
        category: c.label,
        streakMonths: streak,
        cumulativeCr: cumulative,
        latestInflowCr: rows[rows.length - 1].categoryNetInflow as number,
        latestMonth: rows[rows.length - 1].month,
        cappedByHistory: streak === rows.length,
      });
    }
  }
  return out.sort((a, b) => b.streakMonths - a.streakMonths || b.cumulativeCr - a.cumulativeCr);
}

/** Categories whose latest month BROKE a meaningful positive streak —
 *  often the more actionable signal than the streak itself. */
export interface StreakBreak {
  category: string;
  priorStreakMonths: number;
  latestInflowCr: number;
  latestMonth: string;
}

export function streakBreaks(minPriorStreak = 4): StreakBreak[] {
  const out: StreakBreak[] = [];
  for (const c of IIFL_ACTIVE_EQUITY_CATEGORIES) {
    const rows = categoryRowsForSlug(c.slug).filter(
      (r) => typeof r.categoryNetInflow === "number"
    );
    if (rows.length < minPriorStreak + 1) continue;
    const latest = rows[rows.length - 1].categoryNetInflow as number;
    if (latest > 0) continue;
    let prior = 0;
    for (let i = rows.length - 2; i >= 0; i--) {
      if ((rows[i].categoryNetInflow as number) > 0) prior += 1;
      else break;
    }
    if (prior >= minPriorStreak) {
      out.push({
        category: c.label,
        priorStreakMonths: prior,
        latestInflowCr: latest,
        latestMonth: rows[rows.length - 1].month,
      });
    }
  }
  return out.sort((a, b) => b.priorStreakMonths - a.priorStreakMonths);
}

// ---------- 4. Ownership moves by % of shares outstanding --------------------

export interface OwnershipMove {
  company: string;
  pctOutstanding: number; // signed: + bought / − sold
  netCr: number; // signed
  amcs: string[];
  sector: string;
}

export function topOwnershipMoves(n = 6): {
  month: string;
  rows: OwnershipMove[];
  divergenceNote: string | null;
} {
  const rows: OwnershipMove[] = [];
  const tiers: { key: "large" | "mid" | "small"; label: string }[] = [
    { key: "large", label: "Large-cap" },
    { key: "mid", label: "Mid-cap" },
    { key: "small", label: "Small-cap" },
  ];
  for (const t of tiers) {
    for (const r of capFlows[t.key].bought) {
      if (r.pctOutstanding !== null) {
        rows.push({
          company: r.company.replace(/\s+(Ltd\.?|Limited)$/i, ""),
          pctOutstanding: r.pctOutstanding,
          netCr: r.netCr,
          amcs: r.amcs,
          sector: classifySector(r.fincode, r.company),
        });
      }
    }
    for (const r of capFlows[t.key].sold) {
      if (r.pctOutstanding !== null) {
        rows.push({
          company: r.company.replace(/\s+(Ltd\.?|Limited)$/i, ""),
          pctOutstanding: -r.pctOutstanding,
          netCr: -r.netCr,
          amcs: r.amcs,
          sector: classifySector(r.fincode, r.company),
        });
      }
    }
  }
  rows.sort((a, b) => Math.abs(b.pctOutstanding) - Math.abs(a.pctOutstanding));
  // Divergence: the biggest ₹ move vs the biggest %-of-equity move.
  const byCr = [...rows].sort((a, b) => Math.abs(b.netCr) - Math.abs(a.netCr));
  let divergenceNote: string | null = null;
  if (rows.length > 0 && byCr.length > 0 && rows[0].company !== byCr[0].company) {
    divergenceNote = `${byCr[0].company} tops the ₹-value ranking, but as a share of the company MFs moved ${rows[0].company} far harder — the rupee lens understates it.`;
  }
  return { month: capFlows.meta.monthCur, rows: rows.slice(0, n), divergenceNote };
}

// ---------- 5. Prebuilt holdings-scan insights -------------------------------

export interface UniqueHolding {
  company: string;
  fundHouse: string;
  valueCr: number;
  shares: number;
  newThisMonth: boolean;
}
export interface AmcShareRow {
  amc: string;
  latestSharePct: number;
  momBps: number | null;
  latestBookCr: number;
}

interface InsightsHoldings {
  meta: { monthCur: string; monthPrev: string; universeSchemes: number };
  uniques: { total: number; newThisMonth: number; rows: UniqueHolding[] };
  amcShare: { months: string[]; rows: AmcShareRow[] };
}

export const holdingsInsights = insightsHoldings as InsightsHoldings;

// ---------- 6. Sector rotation (sector-allocation shifts) --------------------

export type { SectorShiftRow, SectorShiftStock } from "./cap-flows";

export interface SectorRotation {
  month: string;
  monthPrev: string;
  /** Biggest active-equity AUM-share gainers then losers (up to 2 + 2). */
  rows: import("./cap-flows").SectorShiftRow[];
}

/**
 * The sectors whose SHARE of total active-equity MF AUM moved most this month —
 * the biggest gainers and losers — with the names driving each move. This is
 * size-normalised (a big sector like Financials only surfaces when its *share*
 * actually shifts, not just because it has the most names) and robust to
 * fincode changes. Computed by build-cap-flows over the full holdings universe.
 */
export function sectorRotation(): SectorRotation {
  const s = capFlows.sectorShifts;
  return {
    month: s?.monthCur ?? capFlows.meta.monthCur,
    monthPrev: s?.monthPrev ?? capFlows.meta.monthPrev,
    rows: s?.rows ?? [],
  };
}
