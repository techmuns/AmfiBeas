/**
 * Quarterly Market Wrap — the three-sentence "today's read" for
 * /quarterly. Mirrors /monthly's `market-wrap.ts` but pulls its
 * data from the AMFI Quarterly Report snapshot and works in
 * fiscal-quarter labels.
 *
 * Sentence 1: regime read (cycle phase at quarter end + drawdown
 *             context). Same logic as the monthly wrap because the
 *             cycle classifier is monthly — we just describe what
 *             the latest month inside the latest quarter is doing.
 * Sentence 2: industry flow / AAUM headline for the latest quarter.
 * Sentence 3: anomaly scan across headline quarterly series.
 */
import {
  amfiQuarterlyIndustryRows,
  quarterlyTrend,
  quarterlyFolioAdditionsTrend,
  quarterlyActiveEquityLastMonthAaumTrend,
  quarterlyActiveEquityLastMonthShareTrend,
} from "./amfi-quarterly";
import { cyclePhaseHistory, historicalEpisodes } from "./market-indices";
import { chartInsights } from "../lib/chart-context";

export interface QuarterlyMarketWrap {
  /** Latest quarter label (e.g. "4QFY26"). */
  asOf: string;
  lines: string[];
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function regimeSentence(): string | null {
  const history = cyclePhaseHistory();
  const latest = history[history.length - 1];
  if (!latest) return null;
  const dd = latest.drawdownPct;
  if (latest.phase === "Correction") {
    const eps = historicalEpisodes();
    const current = eps.find(
      (e) =>
        e.startMonth.localeCompare(latest.month) <= 0 &&
        e.endMonth.localeCompare(latest.month) >= 0
    );
    if (current) {
      const monthsIn = monthDiff(current.startMonth, latest.month) + 1;
      return `Industry in ${current.title} — Nifty 500 ${dd.toFixed(1)}% drawdown, month ${monthsIn}.`;
    }
    return `Industry in Correction — Nifty 500 ${dd.toFixed(1)}% drawdown.`;
  }
  if (latest.phase === "Peak") {
    return "Industry at Peak — flows and NFOs running hot vs trend.";
  }
  if (latest.phase === "Recovery") {
    return `Industry in Recovery — Nifty 500 ${Math.abs(dd).toFixed(1)}% off recent high.`;
  }
  if (latest.phase === "Expansion") {
    return "Industry in Expansion — Nifty 500 at or near highs.";
  }
  if (latest.phase === "Base") {
    return "Industry in Base — low-volatility consolidation.";
  }
  return null;
}

/** Sentence 2 — quarterly headline. Combines latest AAUM with
 *  net-inflow context so the reader sees the scale AND the flow
 *  pace in one line. */
function flowHeadlineSentence(): string | null {
  const rows = amfiQuarterlyIndustryRows();
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  const parts: string[] = [];
  if (typeof latest.grandTotalLastMonthAaum === "number") {
    const aaum = latest.grandTotalLastMonthAaum;
    const aaumStr =
      aaum >= 1e5
        ? `₹${(aaum / 1e5).toFixed(2)}L Cr`
        : aaum >= 1e3
          ? `₹${(aaum / 1e3).toFixed(1)}K Cr`
          : `₹${aaum.toFixed(0)} Cr`;
    parts.push(`Industry AAUM ${aaumStr}`);
  }
  if (typeof latest.grandTotalNetInflow === "number") {
    const flow = latest.grandTotalNetInflow;
    const sign = flow < 0 ? "−" : "";
    const abs = Math.abs(flow);
    const flowStr =
      abs >= 1e5
        ? `${sign}₹${(abs / 1e5).toFixed(2)}L Cr`
        : abs >= 1e3
          ? `${sign}₹${(abs / 1e3).toFixed(1)}K Cr`
          : `${sign}₹${abs.toFixed(0)} Cr`;
    parts.push(`net inflow ${flowStr}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(" · ")} in ${latest.quarterLabel}.`;
}

/** Sentence 3 — anomaly / standout from the engine across key
 *  quarterly series. Same approach as the monthly wrap but with
 *  quarterly-cadence series and yoyLag of 4. Falls back to the
 *  industry AAUM YoY % if nothing newsworthy fires. */
function anomalySentence(): string | null {
  const candidates: Array<{
    name: string;
    unit: string;
    series: { label: string; value: number }[];
  }> = [
    {
      name: "industry AAUM",
      unit: "₹ Cr",
      series: quarterlyTrend("grandTotalLastMonthAaum", 24),
    },
    {
      name: "industry net inflow",
      unit: "₹ Cr",
      series: quarterlyTrend("grandTotalNetInflow", 24),
    },
    {
      name: "folio additions",
      unit: "",
      series: quarterlyFolioAdditionsTrend(24),
    },
    {
      name: "active-equity AAUM",
      unit: "₹ Cr",
      series: quarterlyActiveEquityLastMonthAaumTrend(24),
    },
    {
      name: "active-equity share",
      unit: "%",
      series: quarterlyActiveEquityLastMonthShareTrend(24),
    },
  ];
  const NEWSWORTHY =
    /(at an all-time|Highest in|Lowest in|Highest since|Lowest since|biggest move|MoM)/;
  for (const c of candidates) {
    const insights = chartInsights(c.series, {
      metricName: c.name,
      unitSuffix: c.unit,
      yoyLag: 4,
    });
    const headline = insights[0];
    if (headline && NEWSWORTHY.test(headline)) {
      return headline;
    }
  }
  // Fallback — the first available insight (likely a YoY line).
  for (const c of candidates) {
    const insights = chartInsights(c.series, {
      metricName: c.name,
      unitSuffix: c.unit,
      yoyLag: 4,
    });
    if (insights.length > 0) return insights[0];
  }
  return null;
}

export function quarterlyMarketWrap(): QuarterlyMarketWrap {
  const rows = amfiQuarterlyIndustryRows();
  const latestQuarterLabel = rows[rows.length - 1]?.quarterLabel ?? "—";
  const lines = [
    regimeSentence(),
    flowHeadlineSentence(),
    anomalySentence(),
  ].filter((s): s is string => typeof s === "string");
  return {
    asOf: latestQuarterLabel,
    lines,
  };
}
