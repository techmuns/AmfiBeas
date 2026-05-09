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
