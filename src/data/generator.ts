import type { MonthlyOperating, QuarterlyFinancial } from "./types";
import {
  AMCS,
  OTHERS_BASE_AUM,
  OTHERS_CAGR,
  OTHERS_SIP_SHARE,
  OTHERS_INVESTOR_SHARE,
} from "./amcs";

export const END_MONTH = { year: 2026, month: 4 };
export const END_QUARTER = { year: 2026, q: 1 };
export const MONTHS_BACK = 24;
export const QUARTERS_BACK = 8;
export const INDUSTRY_BASE_SIP = 22_000;
export const INDUSTRY_SIP_GROWTH = 0.16;

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number, mean = 0, stdev = 1) {
  const u = 1 - rand();
  const v = rand();
  return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(rand: () => number, lambda: number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function monthStr(year: number, m: number) {
  return `${year}-${String(m).padStart(2, "0")}`;
}

export function lastNMonths(n: number): string[] {
  const out: string[] = [];
  let y = END_MONTH.year;
  let m = END_MONTH.month;
  for (let i = 0; i < n; i++) {
    out.unshift(monthStr(y, m));
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function quarterStr(year: number, q: number) {
  return `${year}-Q${q}`;
}

export function lastNQuarters(n: number): string[] {
  let q = END_QUARTER.q;
  let y = END_QUARTER.year;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(quarterStr(y, q));
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

export function quarterMonths(quarter: string): string[] {
  const [yStr, qStr] = quarter.split("-Q");
  const y = Number(yStr);
  const q = Number(qStr);
  const startMonth = (q - 1) * 3 + 1;
  return [
    monthStr(y, startMonth),
    monthStr(y, startMonth + 1),
    monthStr(y, startMonth + 2),
  ];
}

const MONTHS = lastNMonths(MONTHS_BACK);
const QUARTERS = lastNQuarters(QUARTERS_BACK);

/**
 * Demo split factors used to derive AUM-by-category from totalAum and equityPct.
 * Active equity is roughly 80% of equity, with the rest in passive (index/ETFs).
 * The non-equity remainder is split into debt / liquid / hybrid / other-schemes
 * roughly in proportion to industry-wide SEBI category mix as of 2026.
 */
const ACTIVE_OF_EQUITY = 0.82;
const DEBT_OF_NONEQUITY = 0.5;
const LIQUID_OF_NONEQUITY = 0.2;
const HYBRID_OF_NONEQUITY = 0.22;
const OTHER_OF_NONEQUITY = 0.08;

function buildAmcMonthly(
  profile: (typeof AMCS)[number]
): MonthlyOperating[] {
  const rand = mulberry32(profile.seed * 7919);
  const monthlyGrowth = Math.pow(1 + profile.aumCagr, 1 / 12) - 1;
  const sipMonthlyGrowth = Math.pow(1 + INDUSTRY_SIP_GROWTH, 1 / 12) - 1;

  return MONTHS.map((month, i) => {
    const trendFactor = Math.pow(1 + monthlyGrowth, i);
    const aumNoise = 1 + gaussian(rand, 0, 0.018);
    const totalAum = profile.baseAum * trendFactor * aumNoise;

    const equityNoise = 1 + gaussian(rand, 0, 0.012);
    const equityAum = totalAum * profile.equityPct * equityNoise;
    const activeEquityAum = equityAum * ACTIVE_OF_EQUITY;
    const passiveEquityAum = equityAum * (1 - ACTIVE_OF_EQUITY);

    const nonEquityAum = Math.max(0, totalAum - equityAum);
    const debtAum = nonEquityAum * DEBT_OF_NONEQUITY;
    const liquidAum = nonEquityAum * LIQUID_OF_NONEQUITY;
    const hybridAum = nonEquityAum * HYBRID_OF_NONEQUITY;
    const otherSchemesAum = nonEquityAum * OTHER_OF_NONEQUITY;
    const passiveAum = passiveEquityAum;

    const sipBase =
      INDUSTRY_BASE_SIP * profile.sipShare * Math.pow(1 + sipMonthlyGrowth, i);
    const sipNoise = 1 + gaussian(rand, 0, 0.04);
    const sipContribution = sipBase * sipNoise;

    const newInvestorsBase = 18_00_000 * profile.newInvestorShare;
    const investorGrowth = Math.pow(1.014, i);
    const investorAdditions = Math.max(
      0,
      Math.round(
        newInvestorsBase * investorGrowth * (1 + gaussian(rand, 0, 0.06))
      )
    );
    const baseFolios =
      profile.newInvestorShare * 22_000_000 * (0.85 + (profile.seed % 10) * 0.02);
    const folios = Math.round(baseFolios * Math.pow(1.012, i));

    const nfoCount = poisson(rand, profile.nfoLambda);
    const nfoAumCollected =
      nfoCount > 0
        ? Math.round(nfoCount * (300 + Math.abs(gaussian(rand, 0, 200))))
        : 0;

    return {
      amcSlug: profile.slug,
      month,
      totalAum: Math.round(totalAum),
      activeEquityAum: Math.round(activeEquityAum),
      passiveAum: Math.round(passiveAum),
      debtAum: Math.round(debtAum),
      liquidAum: Math.round(liquidAum),
      hybridAum: Math.round(hybridAum),
      otherSchemesAum: Math.round(otherSchemesAum),
      sipContribution: Math.round(sipContribution),
      investorAdditions,
      folios,
      nfoCount,
      nfoAumCollected,
    };
  });
}

function buildOthersMonthly(): MonthlyOperating[] {
  const rand = mulberry32(99991);
  const monthlyGrowth = Math.pow(1 + OTHERS_CAGR, 1 / 12) - 1;
  const sipMonthlyGrowth = Math.pow(1 + INDUSTRY_SIP_GROWTH, 1 / 12) - 1;

  return MONTHS.map((month, i) => {
    const trend = Math.pow(1 + monthlyGrowth, i);
    const totalAum = OTHERS_BASE_AUM * trend * (1 + gaussian(rand, 0, 0.012));
    const equityAum = totalAum * 0.45 * (1 + gaussian(rand, 0, 0.01));
    const activeEquityAum = equityAum * ACTIVE_OF_EQUITY;
    const passiveAum = equityAum * (1 - ACTIVE_OF_EQUITY);
    const nonEquityAum = Math.max(0, totalAum - equityAum);

    const sipContribution =
      INDUSTRY_BASE_SIP *
      OTHERS_SIP_SHARE *
      Math.pow(1 + sipMonthlyGrowth, i) *
      (1 + gaussian(rand, 0, 0.04));
    const investorAdditions = Math.round(
      18_00_000 *
        OTHERS_INVESTOR_SHARE *
        Math.pow(1.014, i) *
        (1 + gaussian(rand, 0, 0.06))
    );
    const folios = Math.round(8_000_000 * Math.pow(1.012, i));
    const nfoCount = poisson(rand, 3.5);

    return {
      amcSlug: "others",
      month,
      totalAum: Math.round(totalAum),
      activeEquityAum: Math.round(activeEquityAum),
      passiveAum: Math.round(passiveAum),
      debtAum: Math.round(nonEquityAum * DEBT_OF_NONEQUITY),
      liquidAum: Math.round(nonEquityAum * LIQUID_OF_NONEQUITY),
      hybridAum: Math.round(nonEquityAum * HYBRID_OF_NONEQUITY),
      otherSchemesAum: Math.round(nonEquityAum * OTHER_OF_NONEQUITY),
      sipContribution: Math.round(sipContribution),
      investorAdditions,
      folios,
      nfoCount,
      nfoAumCollected: nfoCount > 0 ? Math.round(nfoCount * 250) : 0,
    };
  });
}

function buildAmcQuarterly(
  profile: (typeof AMCS)[number],
  monthly: MonthlyOperating[]
): QuarterlyFinancial[] {
  const rand = mulberry32(profile.seed * 31337);
  return QUARTERS.map((quarter) => {
    const months = quarterMonths(quarter);
    const slice = monthly.filter((m) => months.includes(m.month));
    const avgAum =
      slice.reduce((s, m) => s + m.totalAum, 0) / Math.max(slice.length, 1);
    const yieldNoise = 1 + gaussian(rand, 0, 0.03);
    const revenue =
      (avgAum * profile.revenueYieldBps * yieldNoise) / 10_000 / 4;
    const opProfit = revenue * profile.opMargin * (1 + gaussian(rand, 0, 0.04));
    const pat = revenue * profile.patMargin * (1 + gaussian(rand, 0, 0.05));
    return {
      amcSlug: profile.slug,
      quarter,
      revenue: Math.round(revenue),
      operatingProfit: Math.round(opProfit),
      pat: Math.round(pat),
      avgAum: Math.round(avgAum),
    };
  });
}

const monthlyByAmc = new Map<string, MonthlyOperating[]>();
for (const p of AMCS) monthlyByAmc.set(p.slug, buildAmcMonthly(p));
monthlyByAmc.set("others", buildOthersMonthly());

const quarterlyByAmc = new Map<string, QuarterlyFinancial[]>();
for (const p of AMCS) {
  quarterlyByAmc.set(p.slug, buildAmcQuarterly(p, monthlyByAmc.get(p.slug)!));
}

export const MONTHS_LIST = MONTHS;
export const QUARTERS_LIST = QUARTERS;

export const MONTHLY: MonthlyOperating[] = AMCS.flatMap(
  (p) => monthlyByAmc.get(p.slug)!
).concat(monthlyByAmc.get("others")!);

export const QUARTERLY: QuarterlyFinancial[] = AMCS.flatMap(
  (p) => quarterlyByAmc.get(p.slug)!
);

export function monthlyForAmc(slug: string): MonthlyOperating[] {
  return monthlyByAmc.get(slug) ?? [];
}

export function quarterlyForAmc(slug: string): QuarterlyFinancial[] {
  return quarterlyByAmc.get(slug) ?? [];
}
