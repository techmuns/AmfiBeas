import type { MonthlyOperating, QuarterlyFinancial } from "./types";
import { MONTHLY, QUARTERLY, MONTHS_LIST, QUARTERS_LIST } from "./generator";

export interface IndustryMonthRow {
  month: string;
  aum: number;
  equityAum: number;
  sipFlow: number;
  newInvestors: number;
  nfoCount: number;
}

export function industryByMonth(): IndustryMonthRow[] {
  return MONTHS_LIST.map((month) => {
    const rows = MONTHLY.filter((r) => r.month === month);
    return {
      month,
      aum: rows.reduce((s, r) => s + r.aum, 0),
      equityAum: rows.reduce((s, r) => s + r.equityAum, 0),
      sipFlow: rows.reduce((s, r) => s + r.sipFlow, 0),
      newInvestors: rows.reduce((s, r) => s + r.newInvestors, 0),
      nfoCount: rows.reduce((s, r) => s + r.nfoCount, 0),
    };
  });
}

export function marketShareByMonth(
  metric: "aum" | "equityAum" | "sipFlow"
): { month: string; shares: Record<string, number> }[] {
  return MONTHS_LIST.map((month) => {
    const rows = MONTHLY.filter((r) => r.month === month);
    const total = rows.reduce((s, r) => s + r[metric], 0);
    const shares: Record<string, number> = {};
    for (const r of rows) {
      shares[r.amcSlug] = total === 0 ? 0 : (r[metric] / total) * 100;
    }
    return { month, shares };
  });
}

export function latestMonth(): string {
  return MONTHS_LIST[MONTHS_LIST.length - 1];
}

export function latestQuarter(): string {
  return QUARTERS_LIST[QUARTERS_LIST.length - 1];
}

export function momChange(values: number[]): number {
  if (values.length < 2) return 0;
  const cur = values[values.length - 1];
  const prev = values[values.length - 2];
  if (prev === 0) return 0;
  return ((cur - prev) / prev) * 100;
}

export function yoyChange(values: number[]): number {
  if (values.length < 13) return 0;
  const cur = values[values.length - 1];
  const prev = values[values.length - 13];
  if (prev === 0) return 0;
  return ((cur - prev) / prev) * 100;
}

export function qoqChange(values: number[]): number {
  return momChange(values);
}

export function yoyChangeQuarterly(values: number[]): number {
  if (values.length < 5) return 0;
  const cur = values[values.length - 1];
  const prev = values[values.length - 5];
  if (prev === 0) return 0;
  return ((cur - prev) / prev) * 100;
}

export interface QuarterlyYields {
  quarter: string;
  revenueYieldBps: number;
  operatingYieldBps: number;
  profitYieldBps: number;
  patMargin: number;
  opMargin: number;
}

export function yieldsForAmc(slug: string): QuarterlyYields[] {
  const rows = QUARTERLY.filter((q) => q.amcSlug === slug);
  return rows.map((q) => ({
    quarter: q.quarter,
    revenueYieldBps: q.avgAum === 0 ? 0 : (q.revenue * 4 * 10_000) / q.avgAum,
    operatingYieldBps:
      q.avgAum === 0 ? 0 : (q.operatingProfit * 4 * 10_000) / q.avgAum,
    profitYieldBps: q.avgAum === 0 ? 0 : (q.pat * 4 * 10_000) / q.avgAum,
    patMargin: q.revenue === 0 ? 0 : (q.pat / q.revenue) * 100,
    opMargin: q.revenue === 0 ? 0 : (q.operatingProfit / q.revenue) * 100,
  }));
}

export function industryQuarterly(): QuarterlyFinancial[] {
  return QUARTERS_LIST.map((quarter) => {
    const rows = QUARTERLY.filter((q) => q.quarter === quarter);
    return {
      amcSlug: "industry",
      quarter,
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      operatingProfit: rows.reduce((s, r) => s + r.operatingProfit, 0),
      pat: rows.reduce((s, r) => s + r.pat, 0),
      avgAum: rows.reduce((s, r) => s + r.avgAum, 0),
    };
  });
}

export function pickMonthly(
  slug: string,
  field: keyof Pick<
    MonthlyOperating,
    "aum" | "equityAum" | "sipFlow" | "newInvestors" | "nfoCount"
  >
): number[] {
  return MONTHLY.filter((r) => r.amcSlug === slug).map((r) => r[field]);
}
