/**
 * Peer universe helpers for the dashboard's AMC-wise market-share
 * widgets. Driven by `amc-aaum-quarterly.json` — the AMFI Fundwise
 * AAUM disclosure (regulator-mandated, MF-only by construction).
 *
 * Two consumer surfaces:
 *
 *   1. /monthly + /quarterly peer widgets render the **top 7 AMCs by
 *      latest available AAUM**. Use `topAumAmcSlugs(7)` /
 *      `topAumAmcsForQuarter(quarter, 7)`. The set is derived
 *      dynamically from the snapshot — never hardcoded — so when AMFI
 *      reorders or new AMCs land, the widgets self-correct.
 *
 *   2. /AMCs (future) browses the FULL stored universe via
 *      `allAmcAaumRowsForQuarter(quarter)`. This is intentionally
 *      separate from the dashboard peer set so a long-tail AMC
 *      (e.g. Quant, Bandhan) shows up on its own AMC page even
 *      when it doesn't break the top 7.
 *
 * INVARIANTS:
 *   - Only `status === "ok"` rows feed the rankings — partial /
 *     stale rows are excluded so a missed quarter doesn't bump a
 *     stable AMC out of the top 7.
 *   - `latestAaumQuarter()` returns the most recent quarter that
 *     has at least one ok row. When the snapshot is empty, all
 *     helpers return empty arrays / null — never throw.
 */
import { amcAaumQuarterlySnapshot } from "./source";
import type { AmcAaumQuarterlyRow } from "./snapshots/types";

/** Return the most recent quarter id (YYYY-Qn) with at least one
 *  `status="ok"` row. Returns null when the snapshot has no ok rows. */
export function latestAaumQuarter(): string | null {
  const quarters = new Set<string>();
  for (const r of amcAaumQuarterlySnapshot.rows) {
    if (r.status === "ok") quarters.add(r.quarter);
  }
  if (quarters.size === 0) return null;
  return Array.from(quarters).sort().pop() ?? null;
}

/** All AMC AAUM rows for a specific quarter, sorted by avgAum
 *  descending. Excludes non-ok rows. Returns [] for an unknown
 *  quarter. */
export function allAmcAaumRowsForQuarter(
  quarter: string
): AmcAaumQuarterlyRow[] {
  return amcAaumQuarterlySnapshot.rows
    .filter((r) => r.quarter === quarter && r.status === "ok")
    .slice()
    .sort((a, b) => b.avgAum - a.avgAum);
}

/** Top N AMCs by AAUM for a specific quarter. Returns the AAUM rows
 *  themselves (so callers can read amcSlug, displayName, avgAum,
 *  amcNameAsReported in one pass). */
export function topAumAmcsForQuarter(
  quarter: string,
  n = 7
): AmcAaumQuarterlyRow[] {
  return allAmcAaumRowsForQuarter(quarter).slice(0, n);
}

/** Convenience: top N slugs for the LATEST quarter. Used as the
 *  default peer universe for /monthly and /quarterly market-share
 *  widgets. Returns [] when the snapshot is empty. */
export function topAumAmcSlugs(n = 7): string[] {
  const q = latestAaumQuarter();
  if (!q) return [];
  return topAumAmcsForQuarter(q, n).map((r) => r.amcSlug);
}

/** True when `slug` is in the latest-quarter top N. The default cap
 *  matches the dashboard convention (7). */
export function isTopAumAmc(slug: string, n = 7): boolean {
  return topAumAmcSlugs(n).includes(slug);
}

/** Coverage of the top N within all AMCs for `quarter`:
 *    sum(top N avgAum) / sum(all avgAum) × 100
 *  Returns null when `quarter` has no ok rows. Used by the dashboard
 *  to print "Top 7 cover X% of stored AAUM" alongside the chart. */
export function topAumCoveragePct(
  quarter: string,
  n = 7
): number | null {
  const all = allAmcAaumRowsForQuarter(quarter);
  if (all.length === 0) return null;
  const total = all.reduce((s, r) => s + r.avgAum, 0);
  if (total <= 0) return null;
  const top = all.slice(0, n).reduce((s, r) => s + r.avgAum, 0);
  return (top / total) * 100;
}

/** Helper for status reporting: how many AMCs are in each
 *  mappingStatus bucket on the latest quarter. Useful for the
 *  /AMCs admin / data-sources page. Treats absent mappingStatus
 *  on legacy rows as "mapped" (pre-migration default). */
export function mappingStatusCountsForLatestQuarter(): {
  mapped: number;
  autoSlug: number;
  unmapped: number;
  total: number;
} {
  const q = latestAaumQuarter();
  const counts = { mapped: 0, autoSlug: 0, unmapped: 0, total: 0 };
  if (!q) return counts;
  for (const r of allAmcAaumRowsForQuarter(q)) {
    counts.total += 1;
    const ms = r.mappingStatus ?? "mapped";
    if (ms === "auto_slug") counts.autoSlug += 1;
    else if (ms === "unmapped") counts.unmapped += 1;
    else counts.mapped += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------
// Chart-ready helper for the AUM Market Share card on /monthly and
// /quarterly. Both pages render the SAME chart from the SAME data —
// quarterly AAUM is the only AMC-wise share source we have, so even
// /monthly's card is labelled "quarterly AMFI Fundwise AAUM".
// ---------------------------------------------------------------------

/** Calendar quarter "YYYY-Qn" → fiscal display label "{N}QFY{YY}".
 *  Indian fiscal year ends in March: 2026-Q1 (Jan-Mar 2026) closes
 *  FY26 → "4QFY26"; 2025-Q2 (Apr-Jun 2025) opens FY26 → "1QFY26"; etc.
 *  Mirrors `fiscalQuarterFor` in src/data/amfi-monthly-category.ts but
 *  takes a calendar-quarter id directly so the AMC AAUM snapshot
 *  (which uses calendar quarters) renders with the same fiscal labels
 *  the rest of /quarterly displays. */
export function fiscalLabelFromCalendarQuarter(quarter: string): string {
  const [yStr, qStr] = quarter.split("-");
  const y = Number(yStr);
  if (!Number.isFinite(y) || !qStr) return quarter;
  let fyYear: number;
  let fyQ: number;
  switch (qStr) {
    case "Q1":
      fyYear = y;
      fyQ = 4;
      break;
    case "Q2":
      fyYear = y + 1;
      fyQ = 1;
      break;
    case "Q3":
      fyYear = y + 1;
      fyQ = 2;
      break;
    case "Q4":
      fyYear = y + 1;
      fyQ = 3;
      break;
    default:
      return quarter;
  }
  return `${fyQ}QFY${String(fyYear).slice(-2)}`;
}

export interface AumMarketShareRow extends Record<string, string | number> {
  /** Calendar quarter id, e.g. "2026-Q1". */
  quarter: string;
  /** Fiscal display label, e.g. "4QFY26". This is the StackedArea
   *  xKey so the chart shows fiscal labels everywhere /quarterly does. */
  quarterLabel: string;
}

export interface AumMarketShareData {
  rows: AumMarketShareRow[];
  /** The top-N AMCs in **latest-quarter** AAUM order, so the chart
   *  legend / stack order is stable across the full series. */
  topAmcs: {
    slug: string;
    displayName: string;
    amcNameAsReported: string;
    latestAaum: number;
  }[];
  /** Whether the snapshot covers a credibly-complete AMC universe.
   *  AMFI publishes ~45-50 AMCs per quarter; threshold of
   *  MIN_FULL_UNIVERSE = 30 lets us flip to "live" once a fresh
   *  ingest has expanded the snapshot beyond the legacy 10-AMC
   *  curated set. When false, dashboard consumers should render
   *  the chart with `tone="pending"` and surface a partial-coverage
   *  note — the share % is still correctly calculated against the
   *  stored sum, but the denominator is incomplete relative to AMFI. */
  isFullUniverse: boolean;
  /** Latest-quarter coverage diagnostics — drives the "Top 7 cover
   *  X% of total AMFI Fundwise AAUM" caption rendered beneath the
   *  chart. */
  coverage: {
    quarter: string;            // calendar id of the latest qtr
    quarterLabel: string;       // fiscal display label
    storedAmcCount: number;     // how many ok rows the latest qtr has
    storedAaumTotal: number;    // ₹ Cr — sum of all ok rows that qtr
    topNAaumTotal: number;      // ₹ Cr — sum of just the top N
    /** Sum of all stored AMCs OUTSIDE the top N (i.e. the Others
     *  residual). Always = storedAaumTotal − topNAaumTotal. */
    othersAaumTotal: number;    // ₹ Cr
    /** Top-N share of the stored denominator. Equal to the chart's
     *  top-7 stack height in the latest quarter. */
    topNCoveragePct: number;    // %
    /** Others residual share. Equal to the chart's "Others" slice
     *  in the latest quarter. Always = 100 − topNCoveragePct
     *  (within float rounding). */
    othersCoveragePct: number;  // %
  } | null;
}

/** Minimum number of AMCs in the latest quarter for the snapshot to
 *  be considered a credibly-complete AMFI universe. AMFI typically
 *  publishes 45-50 AMCs per quarter; 30 is a forgiving floor that
 *  flips the dashboard to "live" once the bulk of the long tail has
 *  been ingested. Below this threshold, the chart renders with
 *  `tone="pending"` and a partial-coverage note. */
export const MIN_FULL_UNIVERSE = 30;

/**
 * Build the StackedArea-ready market-share series for the top N AMCs
 * + an "Others" residual over the latest `lastN` quarters.
 *
 *   denominator_q = Σ avgAum across ALL stored ok rows in q
 *                   (i.e. all AMFI Fundwise AAUM rows the snapshot
 *                    has for that quarter — never just the top N)
 *   shareSlug_q   = avgAum_q(slug) / denominator_q × 100
 *   shareOthers_q = Σ avgAum_q(non-top-N) / denominator_q × 100
 *                 = 100 − Σ shareSlug_q
 *
 * The top-N AMC set is fixed at the LATEST quarter's ranking so the
 * stack order doesn't reshuffle quarter to quarter (a stable visual
 * for trend reading). When an AMC has no row for an earlier quarter
 * — e.g. it joined the universe mid-window — that cell is OMITTED
 * from the data row (no fake zero, no fake AMC). Others ALWAYS rolls
 * up the residual against the same denominator, so per-quarter
 * top N + Others = 100% (within float rounding) when every top-N
 * AMC has data in the quarter.
 *
 * The `isFullUniverse` flag on the result is true when the latest
 * quarter has at least `MIN_FULL_UNIVERSE` (30) AMC rows — a signal
 * that the snapshot has been ingested since the all-AMC parser fix
 * (PR #72) and the denominator is a credibly-complete AMFI universe.
 * When false, dashboard consumers should render the chart with
 * `tone="pending"` and a partial-coverage note explaining the gap.
 *
 * Returns `rows: []`, `topAmcs: []`, `coverage: null`, and
 * `isFullUniverse: false` when the snapshot is empty.
 */
export function topAumMarketShareSeries(
  n = 7,
  lastN = 8
): AumMarketShareData {
  const latestQ = latestAaumQuarter();
  if (!latestQ) {
    return { rows: [], topAmcs: [], coverage: null, isFullUniverse: false };
  }

  const topRows = topAumAmcsForQuarter(latestQ, n);
  const topAmcs = topRows.map((r) => ({
    slug: r.amcSlug,
    displayName: r.displayName ?? r.amcSlug,
    amcNameAsReported: r.amcNameAsReported,
    latestAaum: r.avgAum,
  }));
  const topSlugSet = new Set(topAmcs.map((a) => a.slug));

  // Window: last N quarters that have at least one ok row.
  const allQuarters = Array.from(
    new Set(
      amcAaumQuarterlySnapshot.rows
        .filter((r) => r.status === "ok")
        .map((r) => r.quarter)
    )
  )
    .sort()
    .slice(-lastN);

  const rows: AumMarketShareRow[] = allQuarters.map((q) => {
    const allInQ = allAmcAaumRowsForQuarter(q);
    // Denominator = ALL stored AMCs for the quarter (not just top N).
    // After the next AMFI ingest run this is the full ~50-AMC industry
    // universe. Until then it's the legacy 10-AMC stored set; share %
    // is still correctly calculated against whatever denominator is
    // available, and the page surfaces an `isFullUniverse=false` flag
    // so the card renders as Pending.
    const total = allInQ.reduce((s, r) => s + r.avgAum, 0);
    const row: AumMarketShareRow = {
      quarter: q,
      quarterLabel: fiscalLabelFromCalendarQuarter(q),
    };
    if (total > 0) {
      let topSum = 0;
      for (const top of topAmcs) {
        const amcRow = allInQ.find((r) => r.amcSlug === top.slug);
        if (amcRow) {
          const share = (amcRow.avgAum / total) * 100;
          row[top.slug] = share;
          topSum += share;
        }
        // Absent → omit the key. Recharts renders a gap.
      }
      // Others = the residual share contributed by all AMCs OUTSIDE
      // the top-N set in this quarter. Computed as a sum over actual
      // non-top-N rows so an absent top-N AMC doesn't inflate Others
      // (it would just leave a gap in the stack instead). Equivalent
      // to (100 - topSum) when every top-N AMC has data this quarter,
      // which matches the spec's "top 7 + Others = 100%" invariant.
      let othersAaum = 0;
      for (const r of allInQ) {
        if (!topSlugSet.has(r.amcSlug)) othersAaum += r.avgAum;
      }
      if (othersAaum > 0) {
        row["others"] = (othersAaum / total) * 100;
      }
      // Suppress unused-var warning for `topSum` while keeping it
      // around as documentation for the share-residual identity.
      void topSum;
    }
    return row;
  });

  const allInLatest = allAmcAaumRowsForQuarter(latestQ);
  const storedAaumTotal = allInLatest.reduce((s, r) => s + r.avgAum, 0);
  const topNAaumTotal = topRows.reduce((s, r) => s + r.avgAum, 0);
  const othersAaumTotal = storedAaumTotal - topNAaumTotal;
  const topNCoveragePct =
    storedAaumTotal > 0 ? (topNAaumTotal / storedAaumTotal) * 100 : 0;
  const othersCoveragePct =
    storedAaumTotal > 0 ? (othersAaumTotal / storedAaumTotal) * 100 : 0;

  return {
    rows,
    topAmcs,
    isFullUniverse: allInLatest.length >= MIN_FULL_UNIVERSE,
    coverage: {
      quarter: latestQ,
      quarterLabel: fiscalLabelFromCalendarQuarter(latestQ),
      storedAmcCount: allInLatest.length,
      storedAaumTotal,
      topNAaumTotal,
      othersAaumTotal,
      topNCoveragePct,
      othersCoveragePct,
    },
  };
}

// =============================================================
// AMC Health Heatmap data
// =============================================================

export interface AmcHealthRow {
  amcSlug: string;
  displayName: string;
  values: (number | null)[];
}

export interface AmcHealthMatrix {
  quarters: string[];          // calendar quarters in chronological order
  quarterLabels: string[];     // matching fiscal-quarter display labels
  rows: AmcHealthRow[];
}

/**
 * Per-AMC QoQ AAUM growth matrix for a /amc-style heatmap. Returns
 * the latest `lastN` quarters (chronological) and, for each AMC that
 * has at least one ok row in the window, the QoQ growth % at each
 * quarter relative to the prior quarter's AAUM for that same AMC.
 *
 *   growthPct_q = (aaum_q − aaum_{q-1}) / aaum_{q-1} × 100
 *
 * Cells where the prior quarter is missing (e.g. a new AMC that
 * only entered the AAUM disclosure recently) render `null`, which
 * the Heatmap component shows as a muted "—" cell. No fake zeros.
 *
 * AMCs sorted by latest-quarter AAUM descending so the largest
 * AMCs render at the top of the heatmap.
 */
export function amcHealthGrowthMatrix(lastN = 8): AmcHealthMatrix {
  // Build the chronological quarter window.
  const allQuarters = Array.from(
    new Set(
      amcAaumQuarterlySnapshot.rows
        .filter((r) => r.status === "ok")
        .map((r) => r.quarter)
    )
  ).sort();
  const quarters = allQuarters.slice(-lastN);
  if (quarters.length === 0) {
    return { quarters: [], quarterLabels: [], rows: [] };
  }

  // We need one prior quarter beyond the visible window to compute
  // the QoQ growth for the very first visible quarter. If there is
  // no quarter before `quarters[0]`, that cell will be null.
  const priorQuarter =
    allQuarters.indexOf(quarters[0]) > 0
      ? allQuarters[allQuarters.indexOf(quarters[0]) - 1]
      : null;
  const computeWindow = priorQuarter ? [priorQuarter, ...quarters] : quarters;

  // Build a slug → quarter → avgAum map for fast lookup, only for
  // rows that fall inside the compute window.
  const aaumBySlug = new Map<string, Map<string, number>>();
  const displayBySlug = new Map<string, string>();
  for (const r of amcAaumQuarterlySnapshot.rows) {
    if (r.status !== "ok") continue;
    if (!computeWindow.includes(r.quarter)) continue;
    const inner = aaumBySlug.get(r.amcSlug) ?? new Map<string, number>();
    inner.set(r.quarter, r.avgAum);
    aaumBySlug.set(r.amcSlug, inner);
    if (r.displayName && !displayBySlug.has(r.amcSlug)) {
      displayBySlug.set(r.amcSlug, r.displayName);
    } else if (!displayBySlug.has(r.amcSlug)) {
      displayBySlug.set(r.amcSlug, r.amcNameAsReported);
    }
  }

  // Build rows.
  const latestQ = quarters[quarters.length - 1];
  const rows: AmcHealthRow[] = [];
  for (const [amcSlug, inner] of aaumBySlug) {
    const values: (number | null)[] = quarters.map((q, i) => {
      const cur = inner.get(q);
      const priorQ = i === 0 ? priorQuarter : quarters[i - 1];
      if (cur === undefined || priorQ === null) return null;
      const prior = inner.get(priorQ);
      if (prior === undefined || prior <= 0) return null;
      return ((cur - prior) / prior) * 100;
    });
    rows.push({
      amcSlug,
      displayName: displayBySlug.get(amcSlug) ?? amcSlug,
      values,
    });
  }

  // Sort by latest-quarter AAUM descending (largest AMC on top).
  rows.sort((a, b) => {
    const aLatest = aaumBySlug.get(a.amcSlug)?.get(latestQ) ?? 0;
    const bLatest = aaumBySlug.get(b.amcSlug)?.get(latestQ) ?? 0;
    return bLatest - aLatest;
  });

  return {
    quarters,
    quarterLabels: quarters.map(fiscalLabelFromCalendarQuarter),
    rows,
  };
}

// =============================================================
// Concentration tracker — HHI (Herfindahl–Hirschman Index)
// =============================================================

export interface HhiPoint {
  quarter: string;
  quarterLabel: string;
  hhi: number;             // 0..10_000 (sum of share² × 10_000)
  participantCount: number;
  topShareLeaderPct: number;
}

// =============================================================
// Anomaly detection — latest-quarter QoQ growth z-score
// =============================================================

export interface AmcAnomaly {
  amcSlug: string;
  displayName: string;
  qoqGrowthPct: number;
  zScore: number;
  direction: "up" | "down";
}

export interface AmcAnomalyReport {
  quarter: string;
  quarterLabel: string;
  medianQoqPct: number;
  stdDevPct: number;
  participantCount: number;
  outliers: AmcAnomaly[];
}

/**
 * Flags AMCs whose latest-quarter QoQ AAUM growth is more than
 * `threshold` standard deviations away from the universe median.
 *
 * Method:
 *   1. Compute QoQ growth % for every AMC that has both the latest
 *      quarter AND the prior quarter present in the AAUM snapshot
 *      (status="ok", avgAum > 0). Missing-row AMCs are excluded;
 *      they're not "outliers," just unmeasured.
 *   2. Compute the median + standard deviation across that set.
 *   3. Return AMCs with |growth − median| / stdDev ≥ `threshold`.
 *
 * Median (not mean) avoids letting a single outlier inflate the
 * threshold. StdDev is still population-style for simplicity.
 *
 * Returns `null` when fewer than 10 AMCs have a measurable QoQ
 * — the cohort is too small for a meaningful z-score.
 */
export function latestQoqAnomalies(threshold = 2): AmcAnomalyReport | null {
  const allQuarters = Array.from(
    new Set(
      amcAaumQuarterlySnapshot.rows
        .filter((r) => r.status === "ok")
        .map((r) => r.quarter)
    )
  ).sort();
  if (allQuarters.length < 2) return null;
  const latestQ = allQuarters[allQuarters.length - 1];
  const priorQ = allQuarters[allQuarters.length - 2];

  // Build slug → { latest, prior } lookup.
  const latestBySlug = new Map<string, { aum: number; displayName: string }>();
  const priorBySlug = new Map<string, number>();
  for (const r of amcAaumQuarterlySnapshot.rows) {
    if (r.status !== "ok") continue;
    if (r.quarter === latestQ) {
      latestBySlug.set(r.amcSlug, {
        aum: r.avgAum,
        displayName: r.displayName ?? r.amcNameAsReported,
      });
    } else if (r.quarter === priorQ) {
      priorBySlug.set(r.amcSlug, r.avgAum);
    }
  }

  const cohort: { slug: string; displayName: string; growth: number }[] = [];
  for (const [slug, latest] of latestBySlug) {
    const prior = priorBySlug.get(slug);
    if (prior === undefined || prior <= 0) continue;
    cohort.push({
      slug,
      displayName: latest.displayName,
      growth: ((latest.aum - prior) / prior) * 100,
    });
  }
  if (cohort.length < 10) return null;

  const sorted = cohort.map((c) => c.growth).sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[(sorted.length - 1) / 2];

  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const variance =
    sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  const stdDev = Math.sqrt(variance);

  const outliers: AmcAnomaly[] = [];
  if (stdDev > 0) {
    for (const c of cohort) {
      const z = (c.growth - median) / stdDev;
      if (Math.abs(z) >= threshold) {
        outliers.push({
          amcSlug: c.slug,
          displayName: c.displayName,
          qoqGrowthPct: Number(c.growth.toFixed(2)),
          zScore: Number(z.toFixed(2)),
          direction: z >= 0 ? "up" : "down",
        });
      }
    }
  }
  // Sort by absolute z descending — most striking first.
  outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  return {
    quarter: latestQ,
    quarterLabel: fiscalLabelFromCalendarQuarter(latestQ),
    medianQoqPct: Number(median.toFixed(2)),
    stdDevPct: Number(stdDev.toFixed(2)),
    participantCount: cohort.length,
    outliers,
  };
}

/**
 * AMC-level HHI per quarter. Computed as Σ((avgAum_i / totalAaum)²)
 * × 10,000 across every AMC with a `status==='ok'` row in that
 * quarter. Range: 0 (perfectly competitive) to 10,000 (monopoly).
 * U.S. DOJ thresholds: <1,500 unconcentrated, 1,500–2,500 moderate,
 * >2,500 highly concentrated.
 *
 * Returns the latest `lastN` quarters in chronological order.
 */
export function amcLevelHhiSeries(lastN = 8): HhiPoint[] {
  const quarters = Array.from(
    new Set(
      amcAaumQuarterlySnapshot.rows
        .filter((r) => r.status === "ok")
        .map((r) => r.quarter)
    )
  )
    .sort()
    .slice(-lastN);

  return quarters.map((q) => {
    const rows = allAmcAaumRowsForQuarter(q);
    const total = rows.reduce((s, r) => s + r.avgAum, 0);
    let hhi = 0;
    let topShare = 0;
    if (total > 0) {
      for (const r of rows) {
        const share = (r.avgAum / total) * 100;
        hhi += share * share;
        if (share > topShare) topShare = share;
      }
    }
    return {
      quarter: q,
      quarterLabel: fiscalLabelFromCalendarQuarter(q),
      hhi,
      participantCount: rows.length,
      topShareLeaderPct: topShare,
    };
  });
}

/** HHI percentile read for the latest quarter against a trailing
 *  window (default 5 years = 20 quarters). Returned percentile uses
 *  ≤ semantics: it answers "what share of the trailing window had an
 *  HHI ≤ today's value?" → low percentile = industry currently more
 *  competitive / less concentrated than typical recent history.
 *
 *  Returns null when fewer than 4 quarters of history are available
 *  (i.e. the window is too short for a percentile to be meaningful).
 */
export interface HhiPercentileRead {
  latestHhi: number;
  latestQuarter: string;
  latestQuarterLabel: string;
  windowQuarters: number;
  percentile: number;
  /** HHI change versus the row exactly `compareQuartersBack` quarters
   *  prior to the latest, in absolute HHI points (positive = more
   *  concentrated). Null when that anchor row is missing. */
  changeVsAnchor: number | null;
  anchorQuarterLabel: string | null;
}

export function amcLevelHhiPercentileRead(
  windowQuarters = 20,
  compareQuartersBack = 20
): HhiPercentileRead | null {
  const series = amcLevelHhiSeries(windowQuarters);
  if (series.length < 4) return null;
  const latest = series[series.length - 1];
  const lessOrEqual = series.filter((p) => p.hhi <= latest.hhi).length;
  const percentile = (lessOrEqual / series.length) * 100;
  // Anchor: prefer the row exactly `compareQuartersBack` before the
  // latest. When the available history is shorter than that, fall back
  // to the earliest quarter on record so the read still surfaces a
  // direction-of-change comparison (clearly labelled with the anchor's
  // quarter so the reader knows the window).
  const full = amcLevelHhiSeries(1000);
  const latestIdx = full.findIndex((p) => p.quarter === latest.quarter);
  const anchor =
    latestIdx >= compareQuartersBack
      ? full[latestIdx - compareQuartersBack]
      : full.length > 1
        ? full[0]
        : null;
  return {
    latestHhi: latest.hhi,
    latestQuarter: latest.quarter,
    latestQuarterLabel: latest.quarterLabel,
    windowQuarters: series.length,
    percentile,
    changeVsAnchor: anchor ? latest.hhi - anchor.hhi : null,
    anchorQuarterLabel: anchor ? anchor.quarterLabel : null,
  };
}
