/**
 * Market Wrap — the three-line "today's read" that sits at the top
 * of /monthly. The card is the dashboard's answer to the client's
 * "so what?" — every sentence is auto-generated from existing
 * snapshots, so the reader sees a regime call, a retail-flow read,
 * and an anomaly callout before any chart.
 *
 * The output is intentionally compact — three short sentences, in
 * priority order. No charts, no pills, no jargon beyond the
 * dashboard's own terms ("Correction", "Peak").
 */
import {
  amfiMonthlyRows,
  monthlyActiveEquityNetInflowTrend,
  monthlyIndustryFolioAdditionsTrend,
  monthlyTrend,
} from "./amfi-monthly";
import { categoryDrawdownResilience } from "./category-resilience";
import { cyclePhaseHistory, historicalEpisodes } from "./market-indices";
import { chartInsights } from "../lib/chart-context";

export interface MarketWrap {
  /** Snapshot month the wrap describes, formatted "April 2026". */
  asOf: string;
  lines: string[];
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatMonthLong(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return month;
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Sentence 1 — regime read. Names the cycle phase, layers on the
 *  Nifty 500 drawdown context, and (for Corrections) anchors the
 *  reader against the named episode they're inside of. */
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
    return "Industry at Peak — NFO mobilisation and flows running hot vs trend.";
  }
  if (latest.phase === "Recovery") {
    return `Industry in Recovery — Nifty 500 ${Math.abs(dd).toFixed(1)}% off recent high.`;
  }
  if (latest.phase === "Expansion") {
    return "Industry in Expansion — Nifty 500 at or near highs, flows running with trend.";
  }
  if (latest.phase === "Base") {
    return "Industry in Base — low-volatility consolidation; flows neither hot nor cold.";
  }
  return null;
}

/** Sentence 2 — SIP / retail flow read. SIP is the headline retail
 *  number; pair it with the share of net inflow so the reader sees
 *  the systematic vs lump-sum balance in one line. */
function sipSentence(): string | null {
  const rows = amfiMonthlyRows();
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  const contrib = latest.sipContribution;
  if (typeof contrib !== "number") return null;

  // ATH check across the full SIP history.
  const sipSeries = rows
    .map((r) => r.sipContribution)
    .filter((v): v is number => typeof v === "number");
  const isAth = sipSeries.length > 0 && contrib === Math.max(...sipSeries);

  const contribK = (contrib / 1000).toFixed(1);
  const net = latest.netInflow;
  const sharePct =
    typeof net === "number" && net > 0 ? (contrib / net) * 100 : null;

  if (isAth && sharePct !== null) {
    return `SIP at record ₹${contribK}K Cr — ${sharePct.toFixed(0)}% of net inflow.`;
  }
  if (isAth) {
    return `SIP at record ₹${contribK}K Cr in ${formatMonthLong(latest.month)}.`;
  }
  if (sharePct !== null) {
    return `SIP ₹${contribK}K Cr — ${sharePct.toFixed(0)}% of net inflow.`;
  }
  return `SIP ₹${contribK}K Cr in ${formatMonthLong(latest.month)}.`;
}

/** Sentence 3 — anomaly / standout. Runs the insight engine across
 *  a handful of headline series and picks the most newsworthy line:
 *  ATH / ATL, σ-spike, multi-period extreme, or episode anchor —
 *  anything routine is filtered out so the third sentence always
 *  has presence.
 *
 *  Falls back to the most-resilient category from the
 *  category-resilience helper when nothing newsworthy fires this
 *  month — that's a stable, always-meaningful third sentence.
 */
function anomalySentence(): string | null {
  const candidates: Array<{
    name: string;
    unit: string;
    series: { label: string; value: number }[];
  }> = [
    {
      name: "active-equity net inflow",
      unit: "₹ Cr",
      series: monthlyActiveEquityNetInflowTrend(36),
    },
    {
      name: "folio additions",
      unit: "",
      series: monthlyIndustryFolioAdditionsTrend(36),
    },
    {
      name: "NFO funds mobilised",
      unit: "₹ Cr",
      series: monthlyTrend("industryNfoFundsMobilized", 36),
    },
    {
      name: "NFO launches",
      unit: "",
      series: monthlyTrend("industryNfoCount", 36),
    },
  ];
  const NEWSWORTHY =
    /(at an all-time|highest in|lowest in|σ vs the typical|highest since|lowest since)/;
  for (const c of candidates) {
    const insights = chartInsights(c.series, {
      metricName: c.name,
      unitSuffix: c.unit,
      yoyLag: 12,
    });
    const headline = insights[0];
    if (headline && NEWSWORTHY.test(headline)) {
      return headline;
    }
  }
  // Stable fallback — name the most-resilient category in past
  // drawdowns. Useful read in any regime.
  const resilience = categoryDrawdownResilience();
  const top = resilience[0];
  if (top) {
    return `${top.label} most resilient across past drawdowns — positive flow in ${top.positiveFlowRatePct.toFixed(0)}% of Correction months.`;
  }
  return null;
}

/** Build the wrap. Sentences with `null` are skipped — the wrap is
 *  resilient to missing data. */
export function marketWrap(): MarketWrap {
  const rows = amfiMonthlyRows();
  const latestMonth = rows[rows.length - 1]?.month ?? null;
  const lines = [
    regimeSentence(),
    sipSentence(),
    anomalySentence(),
  ].filter((s): s is string => typeof s === "string");
  return {
    asOf: latestMonth ? formatMonthLong(latestMonth) : "—",
    lines,
  };
}
