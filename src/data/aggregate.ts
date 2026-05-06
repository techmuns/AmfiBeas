import type { MonthlyOperating, QuarterlyFinancial } from "./types";
import {
  MONTHLY,
  QUARTERLY,
  MONTHS_LIST,
  QUARTERS_LIST,
  quarterlyForAmc as generatedQuarterlyForAmc,
} from "./generator";
import {
  aaumWithFallback,
  amcQuarterlySnapshot,
  industryMonthlySnapshot,
} from "./source";

const liveQuarterlyBySlug = (() => {
  const m = new Map<string, QuarterlyFinancial[]>();
  for (const r of amcQuarterlySnapshot.rows) {
    const arr = m.get(r.amcSlug) ?? [];
    // Source priority: AMFI primary → Morningstar public fallback → fall back
    // to whatever the P&L source provided. Morningstar never overrides AMFI.
    const fallback = aaumWithFallback(r.amcSlug, r.quarter);
    arr.push({
      amcSlug: r.amcSlug,
      quarter: r.quarter,
      revenue: r.revenue,
      operatingProfit: r.operatingProfit,
      pat: r.pat,
      avgAum: fallback.value ?? r.avgAum,
    });
    m.set(r.amcSlug, arr);
  }
  for (const arr of m.values())
    arr.sort((a, b) => a.quarter.localeCompare(b.quarter));
  return m;
})();

export function isLiveQuarterly(slug: string): boolean {
  return liveQuarterlyBySlug.has(slug);
}

export function quarterlyForAmc(slug: string): QuarterlyFinancial[] {
  return liveQuarterlyBySlug.get(slug) ?? generatedQuarterlyForAmc(slug);
}

export interface IndustryMonthRow {
  month: string;
  totalAum: number;
  activeEquityAum: number;
  passiveAum: number;
  debtAum: number;
  liquidAum: number;
  hybridAum: number;
  otherSchemesAum: number;
  sipContribution: number;
  investorAdditions: number;
  folios: number;
  nfoCount: number;
  nfoAumCollected: number;
}

export function industryByMonth(slugs?: string[] | null): IndustryMonthRow[] {
  const liveByMonth = new Map<
    string,
    (typeof industryMonthlySnapshot.rows)[number]
  >();
  if (!slugs && industryMonthlySnapshot.rows.length > 0) {
    for (const r of industryMonthlySnapshot.rows) liveByMonth.set(r.month, r);
  }

  return MONTHS_LIST.map((month) => {
    const rows = MONTHLY.filter(
      (r) => r.month === month && (!slugs || slugs.includes(r.amcSlug))
    );
    const generated: IndustryMonthRow = {
      month,
      totalAum: rows.reduce((s, r) => s + r.totalAum, 0),
      activeEquityAum: rows.reduce((s, r) => s + r.activeEquityAum, 0),
      passiveAum: rows.reduce((s, r) => s + r.passiveAum, 0),
      debtAum: rows.reduce((s, r) => s + r.debtAum, 0),
      liquidAum: rows.reduce((s, r) => s + r.liquidAum, 0),
      hybridAum: rows.reduce((s, r) => s + r.hybridAum, 0),
      otherSchemesAum: rows.reduce((s, r) => s + r.otherSchemesAum, 0),
      sipContribution: rows.reduce((s, r) => s + r.sipContribution, 0),
      investorAdditions: rows.reduce((s, r) => s + r.investorAdditions, 0),
      folios: rows.reduce((s, r) => s + r.folios, 0),
      nfoCount: rows.reduce((s, r) => s + r.nfoCount, 0),
      nfoAumCollected: rows.reduce((s, r) => s + r.nfoAumCollected, 0),
    };

    const live = liveByMonth.get(month);
    if (!live) return generated;
    return {
      ...generated,
      totalAum: live.totalAum || generated.totalAum,
      sipContribution: live.sipFlow || generated.sipContribution,
      folios: live.folios || generated.folios,
      nfoCount: live.nfoCount ?? generated.nfoCount,
    };
  });
}

/**
 * Deterministic market share calculation.
 * Returns a percentage (0–100). Returns 0 if total is missing/non-positive,
 * never NaN/Infinity. Use this for any AUM/SIP/folio share derivation.
 */
export function marketShare(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total)) return 0;
  if (total <= 0) return 0;
  return (value / total) * 100;
}

/**
 * AUM mix breakdown for a single month.
 * Categories are kept in fixed order; "Other Schemes" is always the residual bucket
 * and never folded into equity/debt/etc.
 */
export interface AumMixSlice {
  key:
    | "activeEquity"
    | "passive"
    | "debt"
    | "liquid"
    | "hybrid"
    | "otherSchemes";
  label: string;
  aum: number;
  pct: number;
}

export function aumMixForMonth(
  month: string,
  slugs?: string[] | null
): AumMixSlice[] {
  const rows = MONTHLY.filter(
    (r) => r.month === month && (!slugs || slugs.includes(r.amcSlug))
  );
  const totals = {
    activeEquity: rows.reduce((s, r) => s + r.activeEquityAum, 0),
    passive: rows.reduce((s, r) => s + r.passiveAum, 0),
    debt: rows.reduce((s, r) => s + r.debtAum, 0),
    liquid: rows.reduce((s, r) => s + r.liquidAum, 0),
    hybrid: rows.reduce((s, r) => s + r.hybridAum, 0),
    otherSchemes: rows.reduce((s, r) => s + r.otherSchemesAum, 0),
  };
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const order: AumMixSlice["key"][] = [
    "activeEquity",
    "passive",
    "debt",
    "liquid",
    "hybrid",
    "otherSchemes",
  ];
  const labelMap: Record<AumMixSlice["key"], string> = {
    activeEquity: "Active Equity",
    passive: "Passive (Index/ETF)",
    debt: "Debt",
    liquid: "Liquid",
    hybrid: "Hybrid",
    otherSchemes: "Other Schemes",
  };
  return order.map((key) => ({
    key,
    label: labelMap[key],
    aum: totals[key],
    pct: marketShare(totals[key], total),
  }));
}

/**
 * Active equity market share for a single AMC in a given month.
 * Definition:
 *   active_equity_market_share =
 *     amc.activeEquityAum / industry.activeEquityAum
 * Industry total is computed across ALL AMCs (not the peer set).
 */
export function activeEquityMarketShareFor(
  amcSlug: string,
  month: string
): number {
  const amcRow = MONTHLY.find(
    (r) => r.amcSlug === amcSlug && r.month === month
  );
  const industryTotal = MONTHLY.filter((r) => r.month === month).reduce(
    (s, r) => s + r.activeEquityAum,
    0
  );
  return marketShare(amcRow?.activeEquityAum ?? 0, industryTotal);
}

export function marketShareByMonth(
  metric:
    | "totalAum"
    | "activeEquityAum"
    | "passiveAum"
    | "debtAum"
    | "liquidAum"
    | "hybridAum"
    | "otherSchemesAum"
    | "sipContribution"
    | "folios"
): { month: string; shares: Record<string, number> }[] {
  return MONTHS_LIST.map((month) => {
    const rows = MONTHLY.filter((r) => r.month === month);
    const total = rows.reduce((s, r) => s + r[metric], 0);
    const shares: Record<string, number> = {};
    for (const r of rows) {
      shares[r.amcSlug] = marketShare(r[metric], total);
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

/**
 * Month-over-month change (%) — uses the last two values in the series.
 * Returns 0 if the series has fewer than 2 points or the previous value is 0.
 */
export function momChange(values: number[]): number {
  if (values.length < 2) return 0;
  const cur = values[values.length - 1];
  const prev = values[values.length - 2];
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((cur - prev) / prev) * 100;
}

/**
 * Year-over-year change (%) for monthly series — compares last value to value 12 months prior.
 * Returns 0 if the series has fewer than 13 points or the year-ago value is 0.
 */
export function yoyChange(values: number[]): number {
  if (values.length < 13) return 0;
  const cur = values[values.length - 1];
  const prev = values[values.length - 13];
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((cur - prev) / prev) * 100;
}

export function qoqChange(values: number[]): number {
  return momChange(values);
}

export function yoyChangeQuarterly(values: number[]): number {
  if (values.length < 5) return 0;
  const cur = values[values.length - 1];
  const prev = values[values.length - 5];
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return 0;
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
  const rows = quarterlyForAmc(slug);
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

export function industryQuarterly(
  slugs?: string[] | null
): QuarterlyFinancial[] {
  return QUARTERS_LIST.map((quarter) => {
    const generatedRows = QUARTERLY.filter(
      (q) => q.quarter === quarter && (!slugs || slugs.includes(q.amcSlug))
    );
    const merged = generatedRows.map((q) => {
      const live = liveQuarterlyBySlug
        .get(q.amcSlug)
        ?.find((r) => r.quarter === quarter);
      return live ?? q;
    });
    return {
      amcSlug: "industry",
      quarter,
      revenue: merged.reduce((s, r) => s + r.revenue, 0),
      operatingProfit: merged.reduce((s, r) => s + r.operatingProfit, 0),
      pat: merged.reduce((s, r) => s + r.pat, 0),
      avgAum: merged.reduce((s, r) => s + r.avgAum, 0),
    };
  });
}

export interface ShareSeriesPoint {
  month: string;
  [amcSlug: string]: string | number;
}

export function shareSeries(
  metric:
    | "totalAum"
    | "activeEquityAum"
    | "passiveAum"
    | "sipContribution"
    | "folios",
  topN = 6,
  slugs?: string[] | null
): { rows: ShareSeriesPoint[]; keys: string[] } {
  const universe = MONTHLY.filter(
    (r) => r.amcSlug !== "others" && (!slugs || slugs.includes(r.amcSlug))
  );
  const latest = MONTHS_LIST[MONTHS_LIST.length - 1];
  const latestRows = universe.filter((r) => r.month === latest);
  const ranked = [...latestRows]
    .sort((a, b) => b[metric] - a[metric])
    .map((r) => r.amcSlug);
  const top = ranked.slice(0, topN);
  const includeOthers = !slugs;
  const keys = includeOthers ? [...top, "others"] : top;

  const rows = MONTHS_LIST.map((month) => {
    const all = slugs
      ? universe.filter((r) => r.month === month)
      : MONTHLY.filter((r) => r.month === month);
    const total = all.reduce((s, r) => s + r[metric], 0) || 1;
    const point: ShareSeriesPoint = { month };
    let topSum = 0;
    for (const slug of top) {
      const r = all.find((x) => x.amcSlug === slug);
      const v = r ? (r[metric] / total) * 100 : 0;
      point[slug] = Number(v.toFixed(2));
      topSum += v;
    }
    if (includeOthers) {
      point["others"] = Number(Math.max(0, 100 - topSum).toFixed(2));
    }
    return point;
  });

  return { rows, keys };
}

export function pickMonthly(
  slug: string,
  field: keyof Pick<
    MonthlyOperating,
    | "totalAum"
    | "activeEquityAum"
    | "passiveAum"
    | "debtAum"
    | "liquidAum"
    | "hybridAum"
    | "otherSchemesAum"
    | "sipContribution"
    | "investorAdditions"
    | "folios"
    | "nfoCount"
    | "nfoAumCollected"
  >
): number[] {
  return MONTHLY.filter((r) => r.amcSlug === slug).map((r) => r[field]);
}
