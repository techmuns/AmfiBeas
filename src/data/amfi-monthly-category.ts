/**
 * Read accessor for the long-form AMFI category snapshot
 * (`src/data/snapshots/amfi-monthly-category.json`). Used by the
 * /monthly Category Flow Share section to render IIFL Figure 31-34
 * style charts: each category's AUM share and net-inflow share of
 * the active-equity envelope.
 *
 * The snapshot is one row per (month, categorySlug) with values
 * extracted directly from AMFI Monthly Report rows. Helpers in
 * this file:
 *   - Filter by slug + sort chronologically.
 *   - Join each row to the per-month active-equity denominator
 *     from `amfi-monthly-pdf.json` to compute share percentages.
 *   - Return null for any month where either numerator or
 *     denominator is missing — the chart shows a gap rather than
 *     a fake zero.
 */
import categoryRaw from "./snapshots/amfi-monthly-category.json";
import type {
  AmfiMonthlyCategoryRow,
  AmfiMonthlyCategorySlug,
  AmfiMonthlyCategorySnapshot,
  AmfiMonthlyPdfFieldProvenance,
} from "./snapshots/types";
import { amfiMonthlyRows } from "./amfi-monthly";

export const amfiMonthlyCategorySnapshot =
  categoryRaw as AmfiMonthlyCategorySnapshot;

/** Friendly category labels for the dashboard. Mirrors the friendly
 *  names stored on each row, but consolidated so the page can
 *  iterate over CATEGORY_DISPLAY without reading every row. */
export const CATEGORY_DISPLAY: { slug: AmfiMonthlyCategorySlug; label: string }[] = [
  { slug: "flexi-cap", label: "Flexi Cap Fund" },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund" },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds" },
  { slug: "large-cap", label: "Large Cap Fund" },
];

/** Returns category rows for `slug`, sorted chronologically by month
 *  ascending, capped to the latest `lastN` months. Used by the share
 *  trend chart per category. */
export function categoryRowsForSlug(
  slug: AmfiMonthlyCategorySlug,
  lastN = 24
): AmfiMonthlyCategoryRow[] {
  return amfiMonthlyCategorySnapshot.rows
    .filter((r) => r.categorySlug === slug)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-lastN);
}

/**
 * Per-month share percentages for a category. Each entry has
 *   { month, aumSharePct, flowSharePct }
 * where each share is the category's own AUM/flow divided by the
 * corresponding active-equity envelope figure on the same month
 * (× 100). Either share is `null` when its numerator or
 * denominator is absent — chart renders a gap rather than a fake
 * zero.
 *
 * Denominators on the per-month snapshot:
 *   AUM share        : activeEquityAum
 *   net inflow share : activeEquityNetInflow
 *
 * Both denominators were derived in the extractor (PRs #41 and
 * #44) using the same Sub II + Sub III ex-Arbitrage + Sub IV
 * envelope, so the four categories' shares are consistent and
 * comparable across the equity-oriented (Flexi/Large/Sectoral)
 * and hybrid-oriented (Multi-Asset) cases.
 */
export function monthlyCategoryShareTrend(
  slug: AmfiMonthlyCategorySlug,
  lastN = 24
): {
  month: string;
  aumSharePct: number | null;
  flowSharePct: number | null;
}[] {
  // Build a quick lookup of (month → denominators). Read the same
  // amfi-monthly snapshot the rest of /monthly uses so a single
  // ingest run keeps numerator + denominator aligned.
  const monthly = amfiMonthlyRows();
  const byMonth = new Map<
    string,
    { activeEquityAum?: number; activeEquityNetInflow?: number }
  >();
  for (const r of monthly) {
    byMonth.set(r.month, {
      activeEquityAum: r.activeEquityAum,
      activeEquityNetInflow: r.activeEquityNetInflow,
    });
  }

  const cats = categoryRowsForSlug(slug, lastN);
  return cats.map((r) => {
    const den = byMonth.get(r.month);
    const aumDen = den?.activeEquityAum;
    const flowDen = den?.activeEquityNetInflow;

    const aumSharePct =
      typeof r.categoryAum === "number" &&
      typeof aumDen === "number" &&
      aumDen > 0
        ? (r.categoryAum / aumDen) * 100
        : null;

    const flowSharePct =
      typeof r.categoryNetInflow === "number" &&
      typeof flowDen === "number" &&
      flowDen !== 0
        ? (r.categoryNetInflow / flowDen) * 100
        : null;

    return { month: r.month, aumSharePct, flowSharePct };
  });
}

/**
 * Latest per-(slug, field) provenance — used as the source pointer
 * for the chart's hover tooltip. Returns the `categoryAum`
 * provenance from the most-recent row that carries it for `slug`.
 * Returns null when no row has the field.
 */
export function latestCategoryProvenance(
  slug: AmfiMonthlyCategorySlug,
  field: "categoryAum" | "categoryNetInflow"
): AmfiMonthlyPdfFieldProvenance | null {
  const rows = categoryRowsForSlug(slug);
  for (let i = rows.length - 1; i >= 0; i--) {
    const fs = rows[i].fieldSources?.[field];
    if (fs) return fs;
  }
  return null;
}
