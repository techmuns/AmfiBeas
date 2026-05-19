/**
 * AMC Detail Market Wrap — the three-sentence "today's read" for
 * /amc/[slug]. Built per-AMC so the page leads with a stripped-down
 * editorial summary instead of a wall of cards.
 *
 *   1. Position sentence — rank N of M, tier (Top 7 / Mid / Long
 *      tail), and rank trajectory vs 4Q ago.
 *   2. Growth sentence — AAUM YoY + QoQ + industry comparison.
 *   3. Anomaly sentence — newsworthy insight from chartInsights
 *      run on the AMC's own AAUM series.
 */
import {
  amcAaumSeries,
  amcDetail,
  amcGrowthMetrics,
  amcMarketShareSeries,
  amcRankSeries,
  industryAaumSeries,
} from "./amc-detail";
import { chartInsights } from "../lib/chart-context";

export interface AmcMarketWrap {
  asOf: string;
  lines: string[];
}

function positionSentence(slug: string): string | null {
  const detail = amcDetail(slug);
  if (!detail || !detail.latest) return null;
  const { rank, outOf, marketSharePct, isTop7, fiscalLabel } = detail.latest;

  // Rank trajectory: where was this AMC 4Q ago?
  const rankSeries = amcRankSeries(slug);
  let rankShift: number | null = null;
  if (rankSeries.length >= 5) {
    const latestR = rankSeries[rankSeries.length - 1];
    const priorR = rankSeries[rankSeries.length - 5];
    rankShift = latestR.rank - priorR.rank;
  }

  const tierLabel = isTop7
    ? "Top 7"
    : rank <= 15
      ? "Mid-tier"
      : rank <= 30
        ? "Long-tail leader"
        : "Long-tail";

  const trajectory =
    rankShift === null
      ? ""
      : rankShift === 0
        ? " — flat on rank YoY"
        : rankShift < 0
          ? ` — climbed ${Math.abs(rankShift)} rank${Math.abs(rankShift) === 1 ? "" : "s"} vs YoY`
          : ` — slipped ${rankShift} rank${rankShift === 1 ? "" : "s"} vs YoY`;

  return `${detail.displayName} ranks #${rank} of ${outOf} (${tierLabel}, ${marketSharePct.toFixed(2)}% share)${trajectory} as of ${fiscalLabel}.`;
}

function growthSentence(slug: string): string | null {
  const growth = amcGrowthMetrics(slug);
  if (!growth) return null;
  const detail = amcDetail(slug);
  if (!detail) return null;

  // Industry comparison: AMC AAUM YoY vs industry total AAUM YoY for
  // the same quarter pair.
  const amcSeries = amcAaumSeries(slug);
  const industry = industryAaumSeries();
  const industryByQuarter = new Map(industry.map((p) => [p.quarter, p.avgAum]));
  let industryYoy: number | null = null;
  if (growth.latestQuarter && growth.yoyQuarter) {
    const indLatest = industryByQuarter.get(growth.latestQuarter);
    const indPrior = industryByQuarter.get(growth.yoyQuarter);
    if (
      typeof indLatest === "number" &&
      typeof indPrior === "number" &&
      indPrior > 0
    ) {
      industryYoy = ((indLatest - indPrior) / indPrior) * 100;
    }
  }
  const latestQuarter = amcSeries[amcSeries.length - 1];
  const aaum = latestQuarter?.avgAum ?? null;
  const aaumStr =
    typeof aaum === "number"
      ? aaum >= 1e5
        ? `₹${(aaum / 1e5).toFixed(2)}L Cr`
        : aaum >= 1e3
          ? `₹${(aaum / 1e3).toFixed(1)}K Cr`
          : `₹${aaum.toFixed(0)} Cr`
      : null;

  const parts: string[] = [];
  if (aaumStr) parts.push(`AAUM ${aaumStr}`);
  if (growth.yoyGrowthPct !== null) {
    const yoy = growth.yoyGrowthPct;
    let tag = `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% YoY`;
    if (industryYoy !== null) {
      const delta = yoy - industryYoy;
      if (Math.abs(delta) >= 1) {
        tag += delta > 0 ? ` (outpaced industry by ${delta.toFixed(1)} pp)` : ` (lagged industry by ${Math.abs(delta).toFixed(1)} pp)`;
      } else {
        tag += " (roughly in line with industry)";
      }
    }
    parts.push(tag);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ") + ".";
}

function anomalySentence(slug: string): string | null {
  const series = amcAaumSeries(slug).map((p) => ({
    label: p.fiscalLabel,
    value: p.avgAum,
  }));
  const insights = chartInsights(series, {
    metricName: `${slug} AAUM`,
    unitSuffix: "₹ Cr",
    yoyLag: 4,
  });
  // Take the first newsworthy line. If only the fallback (YoY) is
  // available, we skip — sentence 2 already covers that.
  const NEWSWORTHY =
    /(at an all-time|Highest in|Lowest in|Highest since|Lowest since|biggest move|Up for|Down for)/;
  const headline = insights.find((line) => NEWSWORTHY.test(line));
  if (headline) return headline;

  // Fallback — market share trajectory comment.
  const shareSeries = amcMarketShareSeries(slug);
  if (shareSeries.length >= 5) {
    const latest = shareSeries[shareSeries.length - 1];
    const prior = shareSeries[shareSeries.length - 5];
    const pp = latest.marketSharePct - prior.marketSharePct;
    if (Math.abs(pp) >= 0.1) {
      return pp > 0
        ? `Market share ${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(2)} pp YoY — gaining ground on the cohort.`
        : `Market share ${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(2)} pp YoY — ceding ground to the cohort.`;
    }
    return `Market share flat YoY at ${latest.marketSharePct.toFixed(2)}%.`;
  }
  return null;
}

export function amcMarketWrap(slug: string): AmcMarketWrap {
  const detail = amcDetail(slug);
  const asOf = detail?.latest?.fiscalLabel ?? "—";
  const lines = [
    positionSentence(slug),
    growthSentence(slug),
    anomalySentence(slug),
  ].filter((s): s is string => typeof s === "string");
  return { asOf, lines };
}
