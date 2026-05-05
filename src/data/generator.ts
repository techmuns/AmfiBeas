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

function buildAmcMonthly(
  profile: (typeof AMCS)[number]
): MonthlyOperating[] {
  const rand = mulberry32(profile.seed * 7919);
  const monthlyGrowth = Math.pow(1 + profile.aumCagr, 1 / 12) - 1;
  const sipMonthlyGrowth = Math.pow(1 + INDUSTRY_SIP_GROWTH, 1 / 12) - 1;

  return MONTHS.map((month, i) => {
    const trendFactor = Math.pow(1 + monthlyGrowth, i);
    const aumNoise = 1 + gaussian(rand, 0, 0.018);
    const aum = profile.baseAum * trendFactor * aumNoise;

    const equityNoise = 1 + gaussian(rand, 0, 0.012);
    const equityAum = aum * profile.equityPct * equityNoise;

    const sipBase =
      INDUSTRY_BASE_SIP * profile.sipShare * Math.pow(1 + sipMonthlyGrowth, i);
    const sipNoise = 1 + gaussian(rand, 0, 0.04);
    const sipFlow = sipBase * sipNoise;

    const newInvestorsBase = 18_00_000 * profile.newInvestorShare;
    const investorGrowth = Math.pow(1.014, i);
    const newInvestors = Math.max(
      0,
      Math.round(newInvestorsBase * investorGrowth * (1 + gaussian(rand, 0, 0.06)))
    );

    const nfoCount = poisson(rand, profile.nfoLambda);

    const schemePerformance = gaussian(rand, 1.4, 0.9);

    return {
      amcSlug: profile.slug,
      month,
      aum: Math.round(aum),
      equityAum: Math.round(equityAum),
      sipFlow: Math.round(sipFlow),
      newInvestors,
      nfoCount,
      schemePerformance: Number(schemePerformance.toFixed(2)),
    };
  });
}

function buildOthersMonthly(): MonthlyOperating[] {
  const rand = mulberry32(99991);
  const monthlyGrowth = Math.pow(1 + OTHERS_CAGR, 1 / 12) - 1;
  const sipMonthlyGrowth = Math.pow(1 + INDUSTRY_SIP_GROWTH, 1 / 12) - 1;

  return MONTHS.map((month, i) => {
    const trend = Math.pow(1 + monthlyGrowth, i);
    const aum = OTHERS_BASE_AUM * trend * (1 + gaussian(rand, 0, 0.012));
    const equityAum = aum * 0.45 * (1 + gaussian(rand, 0, 0.01));
    const sipFlow =
      INDUSTRY_BASE_SIP *
      OTHERS_SIP_SHARE *
      Math.pow(1 + sipMonthlyGrowth, i) *
      (1 + gaussian(rand, 0, 0.04));
    const newInvestors = Math.round(
      18_00_000 *
        OTHERS_INVESTOR_SHARE *
        Math.pow(1.014, i) *
        (1 + gaussian(rand, 0, 0.06))
    );
    return {
      amcSlug: "others",
      month,
      aum: Math.round(aum),
      equityAum: Math.round(equityAum),
      sipFlow: Math.round(sipFlow),
      newInvestors,
      nfoCount: poisson(rand, 3.5),
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
      slice.reduce((s, m) => s + m.aum, 0) / Math.max(slice.length, 1);
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
