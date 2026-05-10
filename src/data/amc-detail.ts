/**
 * AMC detail-page helpers — all sourced exclusively from the AMFI
 * Fundwise AAUM disclosure (`amc-aaum-quarterly.json`). MF-only by
 * construction (AMFI does not publish PMS/AIF/offshore here).
 *
 * The /amc/[slug] page used to depend on a mix of curated AMC
 * profiles + demo data + live financials, which meant only the 10
 * curated AMCs had useful detail pages. The AAUM snapshot now covers
 * ~51 AMCs across 8 quarters, so this module exposes per-AMC helpers
 * that work for the FULL universe — every AMC in the snapshot gets
 * a detail page with header, KPIs, AAUM trend, market-share trend,
 * rank trend, QoQ / YoY growth, and peer comparison.
 *
 * No new ingest. No factsheet / RupeeVest logic. Just the data we
 * already have.
 */
import { amcAaumQuarterlySnapshot } from "./source";
import type { AmcAaumQuarterlyRow } from "./snapshots/types";
import {
  allAmcAaumRowsForQuarter,
  fiscalLabelFromCalendarQuarter,
  latestAaumQuarter,
  topAumAmcSlugs,
} from "./amc-peer-universe";

export interface AmcSummary {
  amcSlug: string;
  displayName: string;
  amcNameAsReported: string;
  /** Curated AMCs (HDFC, SBI, …) carry mappingStatus="mapped"; long-tail
   *  AMCs that landed via slug auto-generation carry "auto_slug". Both
   *  are surfaced; curated profiles are unaffected. */
  mappingStatus: AmcAaumQuarterlyRow["mappingStatus"];
}

/** All AMC slugs that appear in any `status="ok"` AAUM row, sorted
 *  alphabetically by display name. Used to drive
 *  `generateStaticParams` and the /amc index. */
export function allAaumAmcs(): AmcSummary[] {
  const seen = new Map<string, AmcSummary>();
  for (const r of amcAaumQuarterlySnapshot.rows) {
    if (r.status !== "ok") continue;
    if (seen.has(r.amcSlug)) continue;
    seen.set(r.amcSlug, {
      amcSlug: r.amcSlug,
      displayName: r.displayName ?? r.amcNameAsReported,
      amcNameAsReported: r.amcNameAsReported,
      mappingStatus: r.mappingStatus,
    });
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
}

/** Resolve a URL slug to the canonical AAUM-snapshot slug. The
 *  AAUM snapshot's slugs are already URL-safe; this is mostly a
 *  membership check. Returns null when the slug isn't in the
 *  snapshot — the caller should `notFound()` in that case. */
export function resolveAmcSlug(slug: string): string | null {
  const exists = amcAaumQuarterlySnapshot.rows.some(
    (r) => r.amcSlug === slug && r.status === "ok"
  );
  return exists ? slug : null;
}

interface QuarterPoint {
  /** "YYYY-Qn" calendar quarter (matches the snapshot's row.quarter). */
  quarter: string;
  /** Human-readable fiscal label, e.g. "1QFY26". */
  fiscalLabel: string;
  /** AAUM in ₹ Cr. */
  avgAum: number;
}

/** Per-AMC AAUM time series, sorted ascending by quarter. Empty
 *  array when the AMC has no ok rows. */
export function amcAaumSeries(slug: string): QuarterPoint[] {
  return amcAaumQuarterlySnapshot.rows
    .filter((r) => r.amcSlug === slug && r.status === "ok")
    .slice()
    .sort((a, b) => a.quarter.localeCompare(b.quarter))
    .map((r) => ({
      quarter: r.quarter,
      fiscalLabel: fiscalLabelFromCalendarQuarter(r.quarter),
      avgAum: r.avgAum,
    }));
}

interface MarketSharePoint extends QuarterPoint {
  /** Total AAUM across all AMCs in this quarter (₹ Cr). */
  industryTotalAaum: number;
  /** AMC's share of the industry, in %. */
  marketSharePct: number;
}

/** Per-AMC market-share time series. Each point's denominator is
 *  the SAME quarter's industry total — so the share % moves on the
 *  same time basis as the AAUM trend. Returns [] when the AMC has
 *  no rows. */
export function amcMarketShareSeries(slug: string): MarketSharePoint[] {
  const series = amcAaumSeries(slug);
  return series
    .map((point) => {
      const allRows = allAmcAaumRowsForQuarter(point.quarter);
      const industryTotalAaum = allRows.reduce((s, r) => s + r.avgAum, 0);
      const marketSharePct =
        industryTotalAaum > 0
          ? (point.avgAum / industryTotalAaum) * 100
          : 0;
      return {
        ...point,
        industryTotalAaum,
        marketSharePct: Number(marketSharePct.toFixed(3)),
      };
    });
}

interface RankPoint {
  quarter: string;
  fiscalLabel: string;
  /** 1-based rank within the AAUM-ordered list of all AMCs for
   *  this quarter. 1 = largest. */
  rank: number;
  /** Total AMCs ranked in this quarter (denominator). */
  outOf: number;
}

/** Per-AMC rank time series. The rank denominator (`outOf`) is the
 *  count of `status="ok"` AMCs in each quarter, so a quarter where
 *  AMFI added new AMCs widens the universe. */
export function amcRankSeries(slug: string): RankPoint[] {
  const out: RankPoint[] = [];
  const series = amcAaumSeries(slug);
  for (const point of series) {
    const ranking = allAmcAaumRowsForQuarter(point.quarter);
    const idx = ranking.findIndex((r) => r.amcSlug === slug);
    if (idx === -1) continue;
    out.push({
      quarter: point.quarter,
      fiscalLabel: point.fiscalLabel,
      rank: idx + 1,
      outOf: ranking.length,
    });
  }
  return out;
}

export interface AmcGrowthMetrics {
  qoqGrowthPct: number | null;
  yoyGrowthPct: number | null;
  /** Quarter labels driving the comparison, for the captions. */
  latestQuarter: string;
  prevQuarter: string | null;
  yoyQuarter: string | null;
}

/** QoQ (latest vs prior quarter) and YoY (latest vs same quarter
 *  one year ago) AAUM growth percentages. Returns null for any
 *  metric whose comparison quarter isn't in the snapshot. */
export function amcGrowthMetrics(slug: string): AmcGrowthMetrics | null {
  const series = amcAaumSeries(slug);
  if (series.length === 0) return null;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2] ?? null;
  // YoY = same calendar Q one year earlier.
  const [yStr, qStr] = latest.quarter.split("-");
  const yoyQuarterId = `${Number(yStr) - 1}-${qStr}`;
  const yoyPoint = series.find((p) => p.quarter === yoyQuarterId) ?? null;

  const qoq =
    prev && prev.avgAum > 0
      ? ((latest.avgAum - prev.avgAum) / prev.avgAum) * 100
      : null;
  const yoy =
    yoyPoint && yoyPoint.avgAum > 0
      ? ((latest.avgAum - yoyPoint.avgAum) / yoyPoint.avgAum) * 100
      : null;

  return {
    qoqGrowthPct: qoq !== null ? Number(qoq.toFixed(2)) : null,
    yoyGrowthPct: yoy !== null ? Number(yoy.toFixed(2)) : null,
    latestQuarter: latest.quarter,
    prevQuarter: prev?.quarter ?? null,
    yoyQuarter: yoyPoint?.quarter ?? null,
  };
}

export interface PeerComparisonRow {
  amcSlug: string;
  displayName: string;
  avgAum: number;
  marketSharePct: number;
  /** 1 = highest AAUM in this quarter. */
  rank: number;
  isFocused: boolean;
  /** Whether this peer falls within the top 7 by latest AAUM. The
   *  focused AMC may carry isInTop7=false when it's been appended
   *  to the table because the user opened a long-tail AMC's page. */
  isInTop7: boolean;
  /** QoQ AAUM growth % for this peer. null when the prior quarter
   *  isn't in the snapshot for this peer. */
  qoqGrowthPct: number | null;
  /** YoY AAUM growth % for this peer (latest vs. same calendar
   *  quarter one year earlier). null when that quarter isn't in
   *  the snapshot for this peer. */
  yoyGrowthPct: number | null;
}

/** Peer-comparison rows for the AMC's latest quarter. Returns the
 *  top 7 AMCs plus the focused AMC if it falls outside the top 7,
 *  ordered by rank ascending. Highlights the focused AMC with
 *  `isFocused = true`. Empty when the snapshot has no data. */
export function peerComparisonForAmc(slug: string): {
  quarter: string;
  fiscalLabel: string;
  rows: PeerComparisonRow[];
} | null {
  const q = latestAaumQuarter();
  if (!q) return null;
  const ranking = allAmcAaumRowsForQuarter(q);
  if (ranking.length === 0) return null;
  const total = ranking.reduce((s, r) => s + r.avgAum, 0);
  const top7 = topAumAmcSlugs(7);
  const top7Set = new Set(top7);
  const focusedIdx = ranking.findIndex((r) => r.amcSlug === slug);
  // If the AMC is OUTSIDE the top 7, append it; otherwise top 7 already
  // includes it.
  const includeSlugs = new Set(top7);
  if (focusedIdx >= 0) includeSlugs.add(slug);
  const rows: PeerComparisonRow[] = ranking
    .filter((r) => includeSlugs.has(r.amcSlug))
    .map((r) => {
      const growth = amcGrowthMetrics(r.amcSlug);
      return {
        amcSlug: r.amcSlug,
        displayName: r.displayName ?? r.amcNameAsReported,
        avgAum: r.avgAum,
        marketSharePct:
          total > 0 ? Number(((r.avgAum / total) * 100).toFixed(3)) : 0,
        rank: ranking.findIndex((row) => row.amcSlug === r.amcSlug) + 1,
        isFocused: r.amcSlug === slug,
        isInTop7: top7Set.has(r.amcSlug),
        qoqGrowthPct: growth?.qoqGrowthPct ?? null,
        yoyGrowthPct: growth?.yoyGrowthPct ?? null,
      };
    })
    .sort((a, b) => a.rank - b.rank);
  return {
    quarter: q,
    fiscalLabel: fiscalLabelFromCalendarQuarter(q),
    rows,
  };
}

export interface AmcDetail {
  amcSlug: string;
  displayName: string;
  amcNameAsReported: string;
  mappingStatus: AmcAaumQuarterlyRow["mappingStatus"];
  latest: {
    quarter: string;
    fiscalLabel: string;
    avgAum: number;
    marketSharePct: number;
    rank: number;
    outOf: number;
    isTop7: boolean;
  } | null;
  /** ISO date string for the snapshot's lastSuccessfulFetchAt — used
   *  in the page header source caption. */
  fetchedAt: string;
  source: string;
}

/** Compose a detail bundle for the AMC's HEADER + KPI cards.
 *  Returns null if the AMC isn't in the snapshot. */
export function amcDetail(slug: string): AmcDetail | null {
  const summaryRow = amcAaumQuarterlySnapshot.rows.find(
    (r) => r.amcSlug === slug && r.status === "ok"
  );
  if (!summaryRow) return null;

  const series = amcAaumSeries(slug);
  const shareSeries = amcMarketShareSeries(slug);
  const rankSeries = amcRankSeries(slug);
  const last = series[series.length - 1] ?? null;
  const lastShare = shareSeries[shareSeries.length - 1] ?? null;
  const lastRank = rankSeries[rankSeries.length - 1] ?? null;
  const top7 = new Set(topAumAmcSlugs(7));

  const latest = last
    ? {
        quarter: last.quarter,
        fiscalLabel: last.fiscalLabel,
        avgAum: last.avgAum,
        marketSharePct: lastShare?.marketSharePct ?? 0,
        rank: lastRank?.rank ?? 0,
        outOf: lastRank?.outOf ?? 0,
        isTop7: top7.has(slug),
      }
    : null;

  return {
    amcSlug: slug,
    displayName: summaryRow.displayName ?? summaryRow.amcNameAsReported,
    amcNameAsReported: summaryRow.amcNameAsReported,
    mappingStatus: summaryRow.mappingStatus,
    latest,
    fetchedAt: amcAaumQuarterlySnapshot.meta.generatedAt,
    source: "AMFI Fundwise AAUM disclosure",
  };
}

/** Index-page row for the /amc list. One row per AAUM-snapshot AMC. */
export interface AmcIndexRow {
  amcSlug: string;
  displayName: string;
  rank: number;
  avgAum: number;
  marketSharePct: number;
  qoqGrowthPct: number | null;
  yoyGrowthPct: number | null;
  isTop7: boolean;
}

export function amcIndexRows(): {
  quarter: string;
  fiscalLabel: string;
  rows: AmcIndexRow[];
} | null {
  const q = latestAaumQuarter();
  if (!q) return null;
  const ranking = allAmcAaumRowsForQuarter(q);
  if (ranking.length === 0) return null;
  const total = ranking.reduce((s, r) => s + r.avgAum, 0);
  const top7 = new Set(topAumAmcSlugs(7));
  const rows: AmcIndexRow[] = ranking.map((r, idx) => {
    const growth = amcGrowthMetrics(r.amcSlug);
    return {
      amcSlug: r.amcSlug,
      displayName: r.displayName ?? r.amcNameAsReported,
      rank: idx + 1,
      avgAum: r.avgAum,
      marketSharePct:
        total > 0 ? Number(((r.avgAum / total) * 100).toFixed(3)) : 0,
      qoqGrowthPct: growth?.qoqGrowthPct ?? null,
      yoyGrowthPct: growth?.yoyGrowthPct ?? null,
      isTop7: top7.has(r.amcSlug),
    };
  });
  return { quarter: q, fiscalLabel: fiscalLabelFromCalendarQuarter(q), rows };
}
