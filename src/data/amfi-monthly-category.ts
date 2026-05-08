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
  AmfiMonthlyMajorCategorySlug,
  AmfiMonthlyPdfFieldProvenance,
  AmfiMonthlyPdfRow,
} from "./snapshots/types";
import { amfiMonthlyRows } from "./amfi-monthly";

export const amfiMonthlyCategorySnapshot =
  categoryRaw as AmfiMonthlyCategorySnapshot;

/** Friendly category labels for the dashboard. Mirrors the friendly
 *  names stored on each row, but consolidated so the page can
 *  iterate over CATEGORY_DISPLAY without reading every row.
 *
 *  These are the four IIFL Figure 31-34 reference categories — kept
 *  as the headline 4-up grid on /monthly.  The remaining 14
 *  active-equity-envelope categories appear in EXPANDED_CATEGORIES. */
export const CATEGORY_DISPLAY: { slug: AmfiMonthlyCategorySlug; label: string }[] = [
  { slug: "flexi-cap", label: "Flexi Cap Fund" },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund" },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds" },
  { slug: "large-cap", label: "Large Cap Fund" },
];

/** The active-equity envelope categories surfaced in the /monthly
 *  "All Active Equity Categories" expanded panel — a curated subset
 *  rather than every in-envelope category. The 6 long-tail
 *  categories (Conservative Hybrid, Childrens, Dividend Yield,
 *  Retirement, Equity Savings, Focused) remain extracted and
 *  reconcile in the denominator, but are hidden from the UI to keep
 *  the panel scannable. The list is display-agnostic; the page sorts
 *  by latest-month `categoryAum` descending before rendering. */
export const EXPANDED_CATEGORIES: { slug: AmfiMonthlyCategorySlug; label: string }[] = [
  // Sub II — Growth/Equity Oriented (excluding the 3 featured slugs
  // and the long-tail Dividend Yield + Focused).
  { slug: "multi-cap", label: "Multi Cap Fund" },
  { slug: "large-mid-cap", label: "Large & Mid Cap Fund" },
  { slug: "mid-cap", label: "Mid Cap Fund" },
  { slug: "small-cap", label: "Small Cap Fund" },
  { slug: "value-contra", label: "Value Fund/Contra Fund" },
  { slug: "elss", label: "ELSS" },
  // Sub III — Hybrid (excluding Multi Asset which is featured;
  // Conservative Hybrid + Equity Savings hidden as long-tail;
  // Arbitrage is excluded from the envelope by formula).
  {
    slug: "balanced-aggressive-hybrid",
    label: "Balanced Hybrid / Aggressive Hybrid Fund",
  },
  { slug: "baf-daa", label: "Balanced Advantage / Dynamic Asset Allocation" },
  // Sub IV — Solution Oriented (Retirement + Childrens hidden as
  // long-tail).
];

/** Latest-month `categoryAum` for a slug, used by the expanded panel
 *  to sort cards heaviest → lightest so the largest categories appear
 *  first. Returns `null` when no row carries `categoryAum`, which
 *  sinks the slug to the bottom of the sort. */
export function latestCategoryAum(
  slug: AmfiMonthlyCategorySlug
): number | null {
  const rows = categoryRowsForSlug(slug);
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].categoryAum;
    if (typeof v === "number") return v;
  }
  return null;
}

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
 * Per-month share percentages for a category in the IIFL Active-
 * Equity Lens. Each entry has
 *   { month, aumSharePct, flowSharePct }
 * where:
 *   aumSharePct  = categoryAaum / activeEquityAaum  (period-average)
 *   flowSharePct = categoryNetInflow / activeEquityNetInflow (signed)
 *
 * Either share is `null` when its numerator or denominator is
 * absent — chart renders a gap rather than a fake zero.
 *
 * The AUM-side denominator is the AAUM-based active-equity envelope
 * (Sub II AAUM + Sub III ex-Arbitrage AAUM + Sub IV AAUM) so the
 * share line uses period-average AUM consistently with IIFL Figure
 * 31-34's QAAUM framing. The flow-side denominator remains the
 * Net Inflow envelope (no AAUM analogue exists for flows).
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
    { activeEquityAaum?: number; activeEquityNetInflow?: number }
  >();
  for (const r of monthly) {
    byMonth.set(r.month, {
      activeEquityAaum: r.activeEquityAaum,
      activeEquityNetInflow: r.activeEquityNetInflow,
    });
  }

  const cats = categoryRowsForSlug(slug, lastN);
  return cats.map((r) => {
    const den = byMonth.get(r.month);
    const aumDen = den?.activeEquityAaum;
    const flowDen = den?.activeEquityNetInflow;

    const aumSharePct =
      typeof r.categoryAaum === "number" &&
      typeof aumDen === "number" &&
      aumDen > 0
        ? (r.categoryAaum / aumDen) * 100
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
 * for the chart's hover tooltip. Returns the provenance from the
 * most-recent row that carries `field` for `slug`. Returns null
 * when no row has the field.
 */
export function latestCategoryProvenance(
  slug: AmfiMonthlyCategorySlug,
  field: "categoryAum" | "categoryAaum" | "categoryNetInflow"
): AmfiMonthlyPdfFieldProvenance | null {
  const rows = categoryRowsForSlug(slug);
  for (let i = rows.length - 1; i >= 0; i--) {
    const fs = rows[i].fieldSources?.[field];
    if (fs) return fs;
  }
  return null;
}

// ---- Major-category drilldown -------------------------------------
//
// Per-major-category drilldown helpers used by the /monthly Category
// Drilldown section. Denominators are the matching Sub Total - I /
// II / III / V row fields on the per-month snapshot, NOT the
// active-equity envelope. Multi Asset, BAF/DAA, etc. now compare
// against the Hybrid total; ETFs / GOLD / FoF-Overseas compare
// against the Other Schemes total; etc.

/** Friendly label + per-month-row denominator field keys for each
 *  major category surfaced in the drilldown. */
export const MAJOR_CATEGORIES: {
  slug: AmfiMonthlyMajorCategorySlug;
  label: string;
  /** Field on `AmfiMonthlyPdfRow` carrying this group's AAUM (₹ Cr). */
  aaumField: keyof AmfiMonthlyPdfRow;
  /** Field on `AmfiMonthlyPdfRow` carrying this group's Net Inflow (₹ Cr). */
  netInflowField: keyof AmfiMonthlyPdfRow;
}[] = [
  {
    slug: "income-debt",
    label: "Income/Debt",
    aaumField: "debtAaum",
    netInflowField: "debtNetInflow",
  },
  {
    slug: "growth-equity",
    label: "Growth/Equity",
    aaumField: "equityAaum",
    netInflowField: "equityNetInflow",
  },
  {
    slug: "hybrid",
    label: "Hybrid",
    aaumField: "hybridAaum",
    netInflowField: "hybridNetInflow",
  },
  {
    slug: "other-schemes",
    label: "Other Schemes",
    aaumField: "otherSchemesAaum",
    netInflowField: "otherSchemesNetInflow",
  },
];

/** Resolve the major-category descriptor by slug, falling back to
 *  Growth/Equity (the drilldown's default selection). */
export function resolveMajorCategory(
  requested: string | undefined
): (typeof MAJOR_CATEGORIES)[number] {
  return (
    MAJOR_CATEGORIES.find((m) => m.slug === requested) ??
    MAJOR_CATEGORIES.find((m) => m.slug === "growth-equity")!
  );
}

/** All category rows belonging to `majorSlug`, sorted chronologically. */
export function categoryRowsForMajor(
  majorSlug: AmfiMonthlyMajorCategorySlug
): AmfiMonthlyCategoryRow[] {
  return amfiMonthlyCategorySnapshot.rows
    .filter((r) => r.majorCategorySlug === majorSlug)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Per-month QAAUM-share + net-inflow-share trend for `slug`, using
 * the slug's MAJOR-CATEGORY denominator (NOT the active-equity
 * envelope used by `monthlyCategoryShareTrend`).
 *
 *   aumSharePct  = categoryAaum / majorCategoryAaum × 100
 *   flowSharePct = categoryNetInflow / majorCategoryNetInflow × 100
 *
 * Either share is `null` when its numerator or denominator is
 * absent (or denominator is 0), so the chart shows a gap rather
 * than a fake zero.
 */
export function monthlyMajorCategoryShareTrend(
  slug: AmfiMonthlyCategorySlug,
  majorSlug: AmfiMonthlyMajorCategorySlug,
  lastN = 24
): {
  month: string;
  aumSharePct: number | null;
  flowSharePct: number | null;
}[] {
  const major = MAJOR_CATEGORIES.find((m) => m.slug === majorSlug);
  if (!major) return [];
  const monthly = amfiMonthlyRows();
  const denomByMonth = new Map<
    string,
    { aaum?: number; flow?: number }
  >();
  for (const r of monthly) {
    denomByMonth.set(r.month, {
      aaum: r[major.aaumField] as number | undefined,
      flow: r[major.netInflowField] as number | undefined,
    });
  }
  const cats = categoryRowsForSlug(slug, lastN);
  return cats.map((r) => {
    const den = denomByMonth.get(r.month);
    const aumSharePct =
      typeof r.categoryAaum === "number" &&
      typeof den?.aaum === "number" &&
      den.aaum > 0
        ? (r.categoryAaum / den.aaum) * 100
        : null;
    const flowSharePct =
      typeof r.categoryNetInflow === "number" &&
      typeof den?.flow === "number" &&
      den.flow !== 0
        ? (r.categoryNetInflow / den.flow) * 100
        : null;
    return { month: r.month, aumSharePct, flowSharePct };
  });
}

/**
 * Latest-month QAAUM share % for a category in its major group,
 * used by the >5% display filter. Returns `null` when the latest
 * month for this category lacks `categoryAaum` or the denominator.
 */
export function latestCategoryAaumShare(
  slug: AmfiMonthlyCategorySlug,
  majorSlug: AmfiMonthlyMajorCategorySlug,
  selectedMonth?: string
): { month: string; aaum: number; share: number } | null {
  const major = MAJOR_CATEGORIES.find((m) => m.slug === majorSlug);
  if (!major) return null;
  const cats = categoryRowsForSlug(slug);
  const monthly = amfiMonthlyRows();
  const monthRow = selectedMonth
    ? cats.find((r) => r.month === selectedMonth) ?? cats[cats.length - 1]
    : cats[cats.length - 1];
  if (!monthRow || typeof monthRow.categoryAaum !== "number") return null;
  const denomRow = monthly.find((r) => r.month === monthRow.month);
  const denom = denomRow?.[major.aaumField] as number | undefined;
  if (typeof denom !== "number" || denom <= 0) return null;
  return {
    month: monthRow.month,
    aaum: monthRow.categoryAaum,
    share: (monthRow.categoryAaum / denom) * 100,
  };
}

// ---- IIFL Active-Equity surfaces ------------------------------------
//
// Net inflow share of active-equity categories over a 12-month rolling
// window — surfaced both as a dense heatmap and as a per-category
// trend card grid. Both surfaces share the same 12-category set.
//
//   netInflowSharePct = categoryNetInflow / activeEquityNetInflow × 100
//   qaaumSharePct     = categoryAaum      / activeEquityAaum      × 100
//
// Cells / points are `null` when either numerator (the category's net
// flow / AAUM that month) or denominator (the active-equity envelope
// flow / AAUM that month) is missing — surfaces render a blank /
// muted slot, never a fake zero.
//
// Equity Savings, Dividend Yield, and ELSS remain in the envelope's
// denominator but are intentionally hidden from these display
// surfaces (long-tail / out-of-scope for the IIFL lens).

/** The 12 IIFL active-equity envelope categories surfaced in the
 *  trend cards and the heatmap, in canonical IIFL display order. */
export const IIFL_ACTIVE_EQUITY_CATEGORIES: {
  slug: AmfiMonthlyCategorySlug;
  label: string;
}[] = [
  { slug: "multi-asset", label: "Multi Asset Allocation Fund" },
  { slug: "flexi-cap", label: "Flexi Cap Fund" },
  { slug: "mid-cap", label: "Mid Cap Fund" },
  { slug: "small-cap", label: "Small Cap Fund" },
  { slug: "large-mid-cap", label: "Large & Mid Cap Fund" },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds" },
  { slug: "large-cap", label: "Large Cap Fund" },
  { slug: "multi-cap", label: "Multi Cap Fund" },
  {
    slug: "baf-daa",
    label: "Dynamic Asset Allocation / Balanced Advantage Fund",
  },
  {
    slug: "balanced-aggressive-hybrid",
    label: "Balanced Hybrid Fund / Aggressive Hybrid Fund",
  },
  { slug: "focused", label: "Focused Fund" },
  { slug: "value-contra", label: "Value Fund / Contra Fund" },
];

/** Heatmap category list — kept as an alias of the canonical IIFL
 *  set so the heatmap and card section never drift apart. */
export const IIFL_HEATMAP_CATEGORIES = IIFL_ACTIVE_EQUITY_CATEGORIES;

/** Featured 4 cards visible by default in the IIFL Active-Equity
 *  Category Trends section, in display order. */
export const IIFL_TREND_FEATURED_SLUGS: AmfiMonthlyCategorySlug[] = [
  "flexi-cap",
  "multi-asset",
  "sectoral-thematic",
  "large-cap",
];

/** The remaining 8 cards revealed by the "Show more" expand control,
 *  in display order. */
export const IIFL_TREND_EXPANDED_SLUGS: AmfiMonthlyCategorySlug[] = [
  "mid-cap",
  "small-cap",
  "large-mid-cap",
  "multi-cap",
  "baf-daa",
  "balanced-aggressive-hybrid",
  "focused",
  "value-contra",
];

/** Build the per-category trailing-12-month series for the IIFL
 *  Active-Equity Category Trends card. Always anchored on the latest
 *  available month (independent of `?month=`), oldest → newest, so
 *  the card window matches the heatmap window exactly. Returns
 *  `aumSharePct` / `flowSharePct` per month with `null` whenever the
 *  numerator or denominator is missing — never zero-padded. */
export function iiflActiveEquityTrendCard(slug: AmfiMonthlyCategorySlug): {
  series: {
    month: string;
    aumSharePct: number | null;
    flowSharePct: number | null;
  }[];
  hasData: boolean;
} {
  const monthly = amfiMonthlyRows();
  const windowMonths = monthly.map((r) => r.month).slice(-12);

  const denomByMonth = new Map<
    string,
    { aaum?: number; flow?: number }
  >();
  for (const r of monthly) {
    denomByMonth.set(r.month, {
      aaum: r.activeEquityAaum,
      flow: r.activeEquityNetInflow,
    });
  }

  const series = windowMonths.map((m) => {
    const cat = amfiMonthlyCategorySnapshot.rows.find(
      (r) => r.month === m && r.categorySlug === slug
    );
    const den = denomByMonth.get(m);
    const aumSharePct =
      typeof cat?.categoryAaum === "number" &&
      typeof den?.aaum === "number" &&
      den.aaum > 0
        ? (cat.categoryAaum / den.aaum) * 100
        : null;
    const flowSharePct =
      typeof cat?.categoryNetInflow === "number" &&
      typeof den?.flow === "number" &&
      den.flow !== 0
        ? (cat.categoryNetInflow / den.flow) * 100
        : null;
    return { month: m, aumSharePct, flowSharePct };
  });

  const hasData = series.some(
    (r) => r.aumSharePct !== null || r.flowSharePct !== null
  );

  return { series, hasData };
}

/** Build the 12-month × 12-category heatmap payload. The window
 *  always ENDS at the latest available month and includes the 11
 *  prior months chronologically — independent of any `?month=`
 *  selection on /monthly. When fewer than 12 months are available,
 *  returns only the real months that exist (never padded with fake
 *  zeros). Returns the months it actually used so the page can
 *  title the axis correctly. */
export function iiflActiveEquityHeatmapData(): {
  months: string[];
  rows: { slug: AmfiMonthlyCategorySlug; label: string; values: (number | null)[] }[];
} {
  const monthly = amfiMonthlyRows();
  const allMonths = monthly.map((r) => r.month);
  if (allMonths.length === 0) return { months: [], rows: [] };

  // Always anchor on the latest available month; slice the trailing
  // 12 (or fewer if not enough history exists yet). New months
  // ingested in future will automatically roll the oldest off.
  const windowMonths = allMonths.slice(-12);

  // Per-month active-equity net-flow denominator lookup.
  const denomByMonth = new Map<string, number>();
  for (const r of monthly) {
    if (typeof r.activeEquityNetInflow === "number") {
      denomByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }

  const rows = IIFL_HEATMAP_CATEGORIES.map((c) => {
    const values: (number | null)[] = windowMonths.map((m) => {
      const denom = denomByMonth.get(m);
      const cat = amfiMonthlyCategorySnapshot.rows.find(
        (r) => r.month === m && r.categorySlug === c.slug
      );
      const num = cat?.categoryNetInflow;
      if (
        typeof num !== "number" ||
        typeof denom !== "number" ||
        denom === 0
      ) {
        return null;
      }
      return (num / denom) * 100;
    });
    return { slug: c.slug, label: c.label, values };
  });

  return { months: windowMonths, rows };
}
