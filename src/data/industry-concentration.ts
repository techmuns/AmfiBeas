/**
 * Industry concentration data — Top 10 AMCs vs the rest by Fundwise
 * AAUM, computed at each fiscal year-end available in the snapshot
 * (plus an optional H1 marker). Powers the Industry Concentration
 * stacked-bar card on `/amc?tab=insights`.
 */

import { amcAaumQuarterlySnapshot } from "./source";

export interface ConcentrationPoint {
  /** Calendar quarter id, e.g. "2023-Q1" for Mar-23. */
  quarter: string;
  /** Display label preferred over the raw quarter id ("Mar-23", "H1FY26"). */
  label: string;
  /** Sum of QAAUM across the top 10 AMCs for the quarter, in ₹ Cr. */
  top10AumCr: number;
  /** Sum of QAAUM across all other AMCs, in ₹ Cr. */
  restAumCr: number;
  /** Total industry QAAUM (top10 + rest), in ₹ Cr. */
  totalAumCr: number;
  /** Top-10 share as a 0-100 percent. */
  top10SharePct: number;
}

/** Calendar quarter id `${YYYY}-Q${n}` → human label. Mar fiscal year
 *  ends and the half-year marker (Sep) get short labels matching the
 *  industry's conventions; other quarters fall back to the raw id. */
function labelForQuarter(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return quarter;
  const yr = Number(m[1]);
  const q = Number(m[2]);
  if (q === 1) return `Mar-${String(yr).slice(2)}`;
  if (q === 3) {
    // Sep-YY → H1 of the fiscal year that ENDS the following March.
    // E.g. Sep 2025 → H1FY26.
    const fy = yr + 1;
    return `H1FY${String(fy).slice(2)}`;
  }
  if (q === 2) return `Jun-${String(yr).slice(2)}`;
  return `Dec-${String(yr).slice(2)}`;
}

/** Build the concentration time-series. By default returns the seven
 *  visible columns from the source chart (fiscal year-ends Mar-20 →
 *  Mar-26 plus the most-recent H1 if available). Quarters that aren't
 *  in the underlying snapshot are silently dropped — the resulting
 *  chart simply has fewer columns. */
export function industryConcentrationSeries(): ConcentrationPoint[] {
  const rows = amcAaumQuarterlySnapshot.rows ?? [];
  const byQuarter = new Map<string, { slug: string; aum: number }[]>();
  for (const r of rows) {
    if (typeof r.avgAum !== "number" || !Number.isFinite(r.avgAum)) continue;
    if (r.status && r.status !== "ok") continue;
    if (!byQuarter.has(r.quarter)) byQuarter.set(r.quarter, []);
    byQuarter.get(r.quarter)!.push({ slug: r.amcSlug, aum: r.avgAum });
  }

  // Preferred display window: every fiscal-year-end we have, plus the
  // latest H1 marker (Q3 of the prior calendar year) if present.
  const allQuarters = [...byQuarter.keys()].sort();
  const fiscalYearEnds = allQuarters.filter((q) => q.endsWith("-Q1"));
  // Pick the most recent Q3 (= H1 of the following fiscal year) if it
  // sits between the second-to-last and last fiscal year-end (or after).
  const latestQ3 = [...allQuarters]
    .reverse()
    .find((q) => q.endsWith("-Q3"));
  const visibleSet = new Set<string>(fiscalYearEnds);
  if (latestQ3) {
    const latestFye = fiscalYearEnds[fiscalYearEnds.length - 1];
    if (!latestFye || latestQ3 > latestFye) visibleSet.add(latestQ3);
  }
  const visible = [...visibleSet].sort();

  return visible
    .map((quarter): ConcentrationPoint | null => {
      const entries = byQuarter.get(quarter) ?? [];
      if (entries.length < 11) return null; // need at least Top 10 + 1 rest
      const sorted = [...entries].sort((a, b) => b.aum - a.aum);
      const top10AumCr = sorted.slice(0, 10).reduce((s, e) => s + e.aum, 0);
      const totalAumCr = sorted.reduce((s, e) => s + e.aum, 0);
      const restAumCr = totalAumCr - top10AumCr;
      const top10SharePct =
        totalAumCr > 0 ? (top10AumCr / totalAumCr) * 100 : 0;
      return {
        quarter,
        label: labelForQuarter(quarter),
        top10AumCr,
        restAumCr,
        totalAumCr,
        top10SharePct,
      };
    })
    .filter((p): p is ConcentrationPoint => p !== null);
}

/** Compute CAGR % between the first and last visible points of a
 *  series, applied to a chosen numeric field. Returns null when the
 *  span is < 1 year or the start value is non-positive. */
export function concentrationCagrPct(
  points: ConcentrationPoint[],
  field: "top10AumCr" | "restAumCr"
): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const startYear = Number(first.quarter.slice(0, 4));
  const endYear = Number(last.quarter.slice(0, 4));
  // Approximate years between Q-ids, e.g. Mar-20 → Sep-25 ≈ 5.5 yrs.
  const startQ = Number(first.quarter.slice(-1));
  const endQ = Number(last.quarter.slice(-1));
  const years = endYear - startYear + (endQ - startQ) / 4;
  if (years < 1) return null;
  const startVal = first[field];
  const endVal = last[field];
  if (startVal <= 0) return null;
  return (Math.pow(endVal / startVal, 1 / years) - 1) * 100;
}
