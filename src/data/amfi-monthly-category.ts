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

/** The trailing-12-month window used by both IIFL Active-Equity
 *  surfaces (heatmap and per-category trend cards). Always anchored
 *  on the latest ingested month; `?month=` is intentionally ignored
 *  so the window rolls forward automatically as new months arrive
 *  and the previous oldest month drops off. Returns fewer than 12
 *  months only when fewer real months exist — never zero-padded. */
export function iiflActiveEquityWindowMonths(): string[] {
  return amfiMonthlyRows()
    .map((r) => r.month)
    .slice(-12);
}

/** Build the per-category trailing-12-month series for the IIFL
 *  Active-Equity Category Trends card. Window comes from the same
 *  `iiflActiveEquityWindowMonths()` helper the heatmap uses, so the
 *  two surfaces never drift out of sync. Returns `aumSharePct` /
 *  `flowSharePct` per month with `null` whenever the numerator or
 *  denominator is missing — never zero-padded. */
export function iiflActiveEquityTrendCard(slug: AmfiMonthlyCategorySlug): {
  series: {
    month: string;
    aumSharePct: number | null;
    flowSharePct: number | null;
  }[];
  hasData: boolean;
} {
  const windowMonths = iiflActiveEquityWindowMonths();

  const denomByMonth = new Map<
    string,
    { aaum?: number; flow?: number }
  >();
  for (const r of amfiMonthlyRows()) {
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

/** Build the 12-month × 12-category heatmap payload. Window comes
 *  from the same `iiflActiveEquityWindowMonths()` helper the trend
 *  cards use, so the two surfaces never drift out of sync. When
 *  fewer than 12 months are available, returns only the real months
 *  that exist (never padded with fake zeros). Returns the months it
 *  actually used so the page can title the axis correctly. */
export function iiflActiveEquityHeatmapData(): {
  months: string[];
  rows: { slug: AmfiMonthlyCategorySlug; label: string; values: (number | null)[] }[];
} {
  const windowMonths = iiflActiveEquityWindowMonths();
  if (windowMonths.length === 0) return { months: [], rows: [] };

  // Per-month active-equity net-flow denominator lookup.
  const denomByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
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

// ---- IIFL Active-Equity Quarterly surfaces -------------------------
//
// /quarterly hosts a quarterly variant of the IIFL Figure 31-34 trend
// cards. Months are bucketed into Indian fiscal quarters
// (FY26 = Apr 2025 – Mar 2026) and the same active-equity envelope
// denominators are applied:
//
//   QAAUM share %    = avg(categoryAaum)      / avg(activeEquityAaum)      × 100
//   Net inflow share = sum(categoryNetInflow) / sum(activeEquityNetInflow) × 100
//
// Averages and sums use the months in the quarter where the value is
// present — never zero-padded. Quarters with neither side populated
// are omitted; the latest quarter is flagged QTD when fewer than 3
// months of data have been ingested for it so the page can append a
// "TD" suffix to the label.

/** Indian fiscal-quarter id + label for a YYYY-MM month. FY26 runs
 *  Apr 2025 – Mar 2026, so 2025-04 → 1QFY26 and 2026-01 → 4QFY26. */
function fiscalQuarterFor(month: string): {
  id: string;
  label: string;
  fyYear: number;
  fyQ: number;
} {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  let fyYear: number;
  let fyQ: number;
  if (m >= 4 && m <= 6) {
    fyYear = y + 1;
    fyQ = 1;
  } else if (m >= 7 && m <= 9) {
    fyYear = y + 1;
    fyQ = 2;
  } else if (m >= 10 && m <= 12) {
    fyYear = y + 1;
    fyQ = 3;
  } else {
    // Jan–Mar of calendar year y closes FY ending in y.
    fyYear = y;
    fyQ = 4;
  }
  return {
    id: `FY${fyYear}-Q${fyQ}`,
    label: `${fyQ}QFY${String(fyYear).slice(-2)}`,
    fyYear,
    fyQ,
  };
}

/** Per-category quarterly trend series for the /quarterly IIFL
 *  Active-Equity Category Trends cards. Buckets months into Indian
 *  fiscal quarters and applies:
 *
 *    QAAUM share %    = avg(categoryAaum)      / avg(activeEquityAaum)      × 100
 *    Net inflow share = sum(categoryNetInflow) / sum(activeEquityNetInflow) × 100
 *
 *  Averages / sums are taken over only the months that carry the
 *  value (no fake zeros). A quarter is dropped when neither share is
 *  computable. Returns the trailing 8 quarters available, oldest →
 *  newest. The most-recent quarter is flagged `qtd: true` when fewer
 *  than 3 months of data exist for it; the page appends "TD" to the
 *  display label in that case. */
export function iiflActiveEquityQuarterlyTrendCard(
  slug: AmfiMonthlyCategorySlug
): {
  series: {
    quarter: string;
    label: string;
    aumSharePct: number | null;
    flowSharePct: number | null;
  }[];
  hasData: boolean;
} {
  const monthly = amfiMonthlyRows();

  // Index this category's rows by month for O(1) lookup inside the
  // bucket loop below.
  const categoryByMonth = new Map<string, AmfiMonthlyCategoryRow>();
  for (const r of amfiMonthlyCategorySnapshot.rows) {
    if (r.categorySlug === slug) categoryByMonth.set(r.month, r);
  }

  // Active-equity envelope denominators per month.
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

  // Bucket months into fiscal quarters. `monthly` is already sorted
  // ascending so insertion order within each bucket is chronological.
  const buckets = new Map<
    string,
    {
      id: string;
      label: string;
      fyYear: number;
      fyQ: number;
      months: string[];
    }
  >();
  for (const r of monthly) {
    const q = fiscalQuarterFor(r.month);
    let bucket = buckets.get(q.id);
    if (!bucket) {
      bucket = {
        id: q.id,
        label: q.label,
        fyYear: q.fyYear,
        fyQ: q.fyQ,
        months: [],
      };
      buckets.set(q.id, bucket);
    }
    bucket.months.push(r.month);
  }

  const ordered = [...buckets.values()].sort((a, b) =>
    a.fyYear !== b.fyYear ? a.fyYear - b.fyYear : a.fyQ - b.fyQ
  );

  const computed = ordered.map((b, i) => {
    const catAaum: number[] = [];
    const aeAaum: number[] = [];
    const catFlow: number[] = [];
    const aeFlow: number[] = [];
    for (const m of b.months) {
      const cat = categoryByMonth.get(m);
      const den = denomByMonth.get(m);
      if (typeof cat?.categoryAaum === "number") catAaum.push(cat.categoryAaum);
      if (typeof den?.aaum === "number") aeAaum.push(den.aaum);
      if (typeof cat?.categoryNetInflow === "number")
        catFlow.push(cat.categoryNetInflow);
      if (typeof den?.flow === "number") aeFlow.push(den.flow);
    }

    const sum = (arr: number[]) => arr.reduce((s, x) => s + x, 0);
    const avg = (arr: number[]) => sum(arr) / arr.length;

    const aumSharePct =
      catAaum.length > 0 && aeAaum.length > 0 && avg(aeAaum) > 0
        ? (avg(catAaum) / avg(aeAaum)) * 100
        : null;

    const aeFlowSum = sum(aeFlow);
    const flowSharePct =
      catFlow.length > 0 && aeFlow.length > 0 && aeFlowSum !== 0
        ? (sum(catFlow) / aeFlowSum) * 100
        : null;

    const isLatest = i === ordered.length - 1;
    const label =
      isLatest && b.months.length < 3 ? `${b.label} TD` : b.label;

    return {
      quarter: b.id,
      label,
      aumSharePct,
      flowSharePct,
    };
  });

  // Drop quarters where both shares are null (no usable numerator or
  // denominator that quarter), then keep only the trailing 8.
  const populated = computed.filter(
    (q) => q.aumSharePct !== null || q.flowSharePct !== null
  );
  const series = populated.slice(-8);
  const hasData = series.length > 0;

  return { series, hasData };
}

/**
 * Z-score lens for the active-equity category heatmap. For each
 * (month, category) cell in the same 12-month window the share
 * heatmap uses, compute:
 *
 *   z_c,m = (categoryNetInflow_c,m − μ_c) / σ_c
 *
 * where μ_c and σ_c are the mean and population standard deviation
 * of `categoryNetInflow` for category c across ALL months in the
 * snapshot (not just the window). This answers "is this category
 * running hot vs its OWN history?" rather than "what share of the
 * envelope did it take this month?". Cells with no flow or where the
 * category has no usable history are null (rendered as "—"), never
 * fabricated.
 */
export function iiflActiveEquityHeatmapZScoreData(): {
  months: string[];
  rows: {
    slug: AmfiMonthlyCategorySlug;
    label: string;
    values: (number | null)[];
  }[];
} {
  const windowMonths = iiflActiveEquityWindowMonths();
  if (windowMonths.length === 0) return { months: [], rows: [] };

  const rows = IIFL_HEATMAP_CATEGORIES.map((c) => {
    // Build full history of this category's net inflow across the
    // snapshot — null months are dropped, never zero-padded.
    const history = amfiMonthlyCategorySnapshot.rows
      .filter((r) => r.categorySlug === c.slug)
      .filter((r): r is typeof r & { categoryNetInflow: number } =>
        typeof r.categoryNetInflow === "number"
      )
      .map((r) => ({ month: r.month, value: r.categoryNetInflow }));
    if (history.length < 2) {
      return {
        slug: c.slug,
        label: c.label,
        values: windowMonths.map(() => null),
      };
    }
    const values = history.map((p) => p.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stdDev = variance > 0 ? Math.sqrt(variance) : null;
    const byMonth = new Map(history.map((p) => [p.month, p.value]));
    const cellValues: (number | null)[] = windowMonths.map((m) => {
      if (stdDev === null) return null;
      const v = byMonth.get(m);
      if (typeof v !== "number") return null;
      return (v - mean) / stdDev;
    });
    return { slug: c.slug, label: c.label, values: cellValues };
  });
  return { months: windowMonths, rows };
}

/**
 * Category Rotation Tracker.
 *
 * For each category in the IIFL active-equity envelope, compute its
 * AVERAGE net-inflow share within the envelope over the latest N
 * months ("current window") and the N months immediately before
 * ("prior window"). The Δ between the two answers "which categories
 * are gaining or losing share in the rotation right now?".
 *
 * Share denominator each month is the active-equity envelope's net
 * inflow (the same denominator the heatmap uses). Months where
 * either side is null are skipped per category — averages use only
 * the months a category has data for. Categories with no data in
 * either window are dropped.
 *
 * Returns null when fewer than 2 × `window` months of usable data
 * exist.
 */
export interface CategoryRotationEntry {
  slug: AmfiMonthlyCategorySlug;
  label: string;
  currentSharePct: number;
  priorSharePct: number;
  deltaSharePct: number;
}

export interface CategoryRotation {
  windowMonths: number;
  currentRange: { start: string; end: string };
  priorRange: { start: string; end: string };
  gainers: CategoryRotationEntry[];
  losers: CategoryRotationEntry[];
}

export function categoryRotation(
  window = 3,
  top = 5
): CategoryRotation | null {
  // Build per-month denominator (active-equity envelope flow).
  const denomByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (typeof r.activeEquityNetInflow === "number") {
      denomByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }
  const monthsWithDenom = Array.from(denomByMonth.keys()).sort();
  if (monthsWithDenom.length < 2 * window) return null;
  const currentMonths = monthsWithDenom.slice(-window);
  const priorMonths = monthsWithDenom.slice(-2 * window, -window);

  // Build per-category share series indexed by month.
  const sharesBySlug = new Map<string, Map<string, number>>();
  for (const c of IIFL_ACTIVE_EQUITY_CATEGORIES) {
    sharesBySlug.set(c.slug, new Map());
  }
  for (const r of amfiMonthlyCategorySnapshot.rows) {
    if (typeof r.categoryNetInflow !== "number") continue;
    const denom = denomByMonth.get(r.month);
    if (typeof denom !== "number" || denom === 0) continue;
    const map = sharesBySlug.get(r.categorySlug);
    if (!map) continue;
    map.set(r.month, (r.categoryNetInflow / denom) * 100);
  }

  const avgOverMonths = (
    months: string[],
    map: Map<string, number>
  ): number | null => {
    const values: number[] = [];
    for (const m of months) {
      const v = map.get(m);
      if (typeof v === "number") values.push(v);
    }
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  };

  const entries: CategoryRotationEntry[] = [];
  for (const c of IIFL_ACTIVE_EQUITY_CATEGORIES) {
    const map = sharesBySlug.get(c.slug)!;
    const current = avgOverMonths(currentMonths, map);
    const prior = avgOverMonths(priorMonths, map);
    if (current === null || prior === null) continue;
    entries.push({
      slug: c.slug,
      label: c.label,
      currentSharePct: current,
      priorSharePct: prior,
      deltaSharePct: current - prior,
    });
  }
  if (entries.length === 0) return null;
  const byDeltaDesc = [...entries].sort(
    (a, b) => b.deltaSharePct - a.deltaSharePct
  );
  const gainers = byDeltaDesc.filter((e) => e.deltaSharePct > 0).slice(0, top);
  const losers = byDeltaDesc
    .filter((e) => e.deltaSharePct < 0)
    .slice(-top)
    .reverse();
  return {
    windowMonths: window,
    currentRange: {
      start: currentMonths[0],
      end: currentMonths[currentMonths.length - 1],
    },
    priorRange: {
      start: priorMonths[0],
      end: priorMonths[priorMonths.length - 1],
    },
    gainers,
    losers,
  };
}

/**
 * Passive Flow Share trend.
 *
 *   passiveFlow_m = categoryNetInflow_index-funds_m
 *                 + categoryNetInflow_other-etfs_m
 *   activeFlow_m  = activeEquityNetInflow_m   (from the AMFI Monthly Report)
 *   share_m       = passiveFlow_m / (passiveFlow_m + activeFlow_m) × 100
 *
 * Months where any of the three inputs is missing OR where the
 * denominator is non-positive are dropped — no fake zeros, no flipped
 * signs. Returns null when no usable months exist.
 *
 * A leading indicator of where the active-vs-passive AUM mix is heading
 * — passive share of NEW MONEY tends to move months before passive
 * share of AUM does.
 */
export interface PassiveFlowSharePoint {
  month: string;
  passiveSharePct: number;
  passiveFlow: number;
  activeFlow: number;
}

export interface PassiveFlowShareTrend {
  history: PassiveFlowSharePoint[];
  latestMonth: string;
  latestSharePct: number;
  mean: number;
  percentile: number | null;
}

export function passiveFlowShareTrend(
  months = 24,
  opts: { sanitize?: boolean } = {}
): PassiveFlowShareTrend | null {
  const { sanitize = false } = opts;
  const activeFlowByMonth = new Map<string, number>();
  for (const r of amfiMonthlyRows()) {
    if (typeof r.activeEquityNetInflow === "number") {
      activeFlowByMonth.set(r.month, r.activeEquityNetInflow);
    }
  }
  const indexByMonth = new Map<string, number>();
  const etfByMonth = new Map<string, number>();
  for (const r of amfiMonthlyCategorySnapshot.rows) {
    if (typeof r.categoryNetInflow !== "number") continue;
    if (r.categorySlug === "index-funds") {
      indexByMonth.set(r.month, r.categoryNetInflow);
    } else if (r.categorySlug === "other-etfs") {
      etfByMonth.set(r.month, r.categoryNetInflow);
    }
  }
  const allMonths = Array.from(
    new Set([
      ...activeFlowByMonth.keys(),
      ...indexByMonth.keys(),
      ...etfByMonth.keys(),
    ])
  ).sort();
  const history: PassiveFlowSharePoint[] = [];
  for (const m of allMonths) {
    const idx = indexByMonth.get(m);
    const etf = etfByMonth.get(m);
    const active = activeFlowByMonth.get(m);
    if (typeof idx !== "number" || typeof etf !== "number" || typeof active !== "number") {
      continue;
    }
    const passive = idx + etf;
    const denom = passive + active;
    if (denom <= 0) continue;
    history.push({
      month: m,
      passiveSharePct: (passive / denom) * 100,
      passiveFlow: passive,
      activeFlow: active,
    });
  }
  if (history.length === 0) return null;

  // When `sanitize` is set, drop months whose share falls outside a
  // sane 0-100% band. Those occur when active-equity net flow is an
  // OUTFLOW that month, which makes "share of NEW equity money"
  // ill-defined and throws extreme readings (>100% / <0%) that distort
  // the mean / percentile and blow out the chart's y-axis. Legacy
  // callers (sanitize=false) keep the raw full series.
  const usable = sanitize
    ? history.filter(
        (p) => p.passiveSharePct >= 0 && p.passiveSharePct <= 100
      )
    : history;
  if (usable.length === 0) return null;

  const trimmed = usable.slice(-months);
  const latest = usable[usable.length - 1];
  // Stats describe exactly what's plotted when sanitizing (same
  // window as `trimmed`); legacy callers keep the full-history basis.
  const statsBase = sanitize ? trimmed : usable;
  const values = statsBase.map((p) => p.passiveSharePct);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const lessOrEqual = values.filter((v) => v <= latest.passiveSharePct).length;
  return {
    history: trimmed,
    latestMonth: latest.month,
    latestSharePct: latest.passiveSharePct,
    mean,
    percentile: values.length > 0 ? (lessOrEqual / values.length) * 100 : null,
  };
}

/** Latest-month flow z-score per active-equity category. For each
 *  IIFL active-equity slug we replay the full historical series of
 *  `categoryNetInflow` and compute the z-score of the latest value
 *  vs its own history. Used to sort + colour the category trend
 *  cards on /monthly and /quarterly so the "hot" categories surface
 *  first. */
export interface CategoryFlowZScorePoint {
  slug: AmfiMonthlyCategorySlug;
  latestMonth: string | null;
  latestValue: number | null;
  mean: number | null;
  stdDev: number | null;
  zScore: number | null;
  percentile: number | null;
}

export function categoryFlowZScoreMap(): Map<
  AmfiMonthlyCategorySlug,
  CategoryFlowZScorePoint
> {
  const out = new Map<AmfiMonthlyCategorySlug, CategoryFlowZScorePoint>();
  for (const c of IIFL_ACTIVE_EQUITY_CATEGORIES) {
    const series = amfiMonthlyCategorySnapshot.rows
      .filter((r) => r.categorySlug === c.slug)
      .filter((r): r is typeof r & { categoryNetInflow: number } =>
        typeof r.categoryNetInflow === "number"
      )
      .map((r) => ({ month: r.month, value: r.categoryNetInflow }))
      .sort((a, b) => a.month.localeCompare(b.month));
    if (series.length === 0) {
      out.set(c.slug, {
        slug: c.slug,
        latestMonth: null,
        latestValue: null,
        mean: null,
        stdDev: null,
        zScore: null,
        percentile: null,
      });
      continue;
    }
    const latest = series[series.length - 1];
    const values = series.map((p) => p.value);
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = n >= 2 && variance > 0 ? Math.sqrt(variance) : null;
    const zScore = stdDev !== null && stdDev > 0
      ? (latest.value - mean) / stdDev
      : null;
    const lessOrEqual = values.filter((v) => v <= latest.value).length;
    const percentile = (lessOrEqual / n) * 100;
    out.set(c.slug, {
      slug: c.slug,
      latestMonth: latest.month,
      latestValue: latest.value,
      mean,
      stdDev,
      zScore,
      percentile,
    });
  }
  return out;
}
