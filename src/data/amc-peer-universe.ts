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
  /** Latest-quarter coverage diagnostics — drives the "Coverage:
   *  top N shown / denominator uses currently stored AMCs" caption
   *  rendered beneath the chart. */
  coverage: {
    quarter: string;            // calendar id of the latest qtr
    quarterLabel: string;       // fiscal display label
    storedAmcCount: number;     // how many ok rows the latest qtr has
    storedAaumTotal: number;    // ₹ Cr — sum of all ok rows that qtr
    topNAaumTotal: number;      // ₹ Cr — sum of just the top N
    topNCoveragePct: number;    // topNAaumTotal / storedAaumTotal × 100
  } | null;
}

/**
 * Build the StackedArea-ready market-share series for the top N AMCs
 * over the latest `lastN` quarters.
 *
 *   industryCoveredAaum_q = Σ avgAum across all stored ok rows in q
 *   shareSlug_q           = avgAum_q(slug) / industryCoveredAaum_q × 100
 *
 * The top-N AMC set is fixed at the LATEST quarter's ranking so the
 * stack order doesn't reshuffle quarter to quarter (a stable visual
 * for trend reading). When an AMC has no row for an earlier quarter
 * — e.g. it joined the universe mid-window — that cell is OMITTED
 * from the data row (no fake zero, no fake AMC). Recharts treats an
 * absent stack key as a gap; the slice resumes when the AMC's data
 * reappears.
 *
 * Returns `rows: []` and `coverage: null` when the snapshot is empty.
 */
export function topAumMarketShareSeries(
  n = 7,
  lastN = 8
): AumMarketShareData {
  const latestQ = latestAaumQuarter();
  if (!latestQ) return { rows: [], topAmcs: [], coverage: null };

  const topRows = topAumAmcsForQuarter(latestQ, n);
  const topAmcs = topRows.map((r) => ({
    slug: r.amcSlug,
    displayName: r.displayName ?? r.amcSlug,
    amcNameAsReported: r.amcNameAsReported,
    latestAaum: r.avgAum,
  }));

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
    const total = allInQ.reduce((s, r) => s + r.avgAum, 0);
    const row: AumMarketShareRow = {
      quarter: q,
      quarterLabel: fiscalLabelFromCalendarQuarter(q),
    };
    if (total > 0) {
      for (const top of topAmcs) {
        const amcRow = allInQ.find((r) => r.amcSlug === top.slug);
        if (amcRow) {
          row[top.slug] = (amcRow.avgAum / total) * 100;
        }
        // Absent → omit the key, Recharts renders a gap on that
        // AMC's slice for that quarter.
      }
    }
    return row;
  });

  const allInLatest = allAmcAaumRowsForQuarter(latestQ);
  const storedAaumTotal = allInLatest.reduce((s, r) => s + r.avgAum, 0);
  const topNAaumTotal = topRows.reduce((s, r) => s + r.avgAum, 0);

  return {
    rows,
    topAmcs,
    coverage: {
      quarter: latestQ,
      quarterLabel: fiscalLabelFromCalendarQuarter(latestQ),
      storedAmcCount: allInLatest.length,
      storedAaumTotal,
      topNAaumTotal,
      topNCoveragePct:
        storedAaumTotal > 0 ? (topNAaumTotal / storedAaumTotal) * 100 : 0,
    },
  };
}
