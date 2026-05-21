/**
 * Read accessor for the AMFI quarterly PDF snapshots:
 *   - `src/data/snapshots/amfi-quarterly-industry.json`
 *   - `src/data/snapshots/amfi-quarterly-category.json`
 *
 * Powers the /quarterly Quarterly Gross Flows section. Funds mobilized,
 * repurchase / redemption, and net inflow are 3-month sums extracted
 * directly from the AMFI quarterly Report PDFs.
 *
 * IMPORTANT methodological caveat — `*LastMonthAaum` fields on
 * AmfiQuarterlyIndustryRow / AmfiQuarterlyCategoryRow report the
 * AVERAGE NET AUM of only the LAST MONTH of the quarter, NOT a true
 * 3-month period average. Do NOT use any LastMonthAaum field for
 * QAAUM-share charts; aggregate the monthly snapshot instead. The
 * existing /quarterly IIFL Active-Equity Category Trends section
 * already does this and MUST be left on monthly aggregation.
 *
 * Helpers in this file always:
 *   - Sort rows by quarter ascending (FY25-Q1 → FY26-Q4) so "latest"
 *     is unambiguous.
 *   - Return `null` for absent values (callers must branch on that
 *     and render a gap rather than synthesise zero).
 */
import quarterlyIndustryRaw from "./snapshots/amfi-quarterly-industry.json";
import quarterlyCategoryRaw from "./snapshots/amfi-quarterly-category.json";
import { fiscalLabelFromCalendarQuarter } from "./amc-peer-universe";
import type {
  AmfiMonthlyCategorySlug,
  AmfiQuarterlyCategoryFieldSources,
  AmfiQuarterlyCategoryRow,
  AmfiQuarterlyCategorySnapshot,
  AmfiQuarterlyFieldSource,
  AmfiQuarterlyIndustryFieldSources,
  AmfiQuarterlyIndustryRow,
  AmfiQuarterlyIndustrySnapshot,
} from "./snapshots/types";

export const amfiQuarterlyIndustrySnapshot =
  quarterlyIndustryRaw as AmfiQuarterlyIndustrySnapshot;
export const amfiQuarterlyCategorySnapshot =
  quarterlyCategoryRaw as AmfiQuarterlyCategorySnapshot;

/** Industry rows sorted by quarter ascending (FY25-Q1 → FY26-Q4). */
export function amfiQuarterlyIndustryRows(): AmfiQuarterlyIndustryRow[] {
  return [...amfiQuarterlyIndustrySnapshot.rows].sort((a, b) =>
    a.quarter.localeCompare(b.quarter)
  );
}

/** Category rows for `slug`, sorted by quarter ascending. */
export function amfiQuarterlyCategoryRows(
  slug: AmfiMonthlyCategorySlug
): AmfiQuarterlyCategoryRow[] {
  return amfiQuarterlyCategorySnapshot.rows
    .filter((r) => r.categorySlug === slug)
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** One per-quarter row ready for binding to GroupedBars. Values are
 *  `null` (rather than missing keys) so Recharts can render a gap on
 *  that quarter's bar without a synthetic zero.
 *
 *  The index signature is declared so the type satisfies the
 *  GroupedBars `data: Record<string, string | number | null>[]` prop —
 *  every named property is already a `string | number | null` subtype. */
export interface QuarterlyGrossFlowsRow {
  quarter: string;
  quarterLabel: string;
  fundsMobilized: number | null;
  repurchase: number | null;
  netInflow: number | null;
  [key: string]: string | number | null;
}

/**
 * Industry-wide quarterly gross flows from the Grand Total row of each
 * AMFI quarterly Report. fundsMobilized + repurchase are positive
 * gross flows; netInflow is signed (positive = inflow, negative =
 * outflow). All three are 3-month sums.
 */
export function quarterlyGrossFlowsData(): QuarterlyGrossFlowsRow[] {
  return amfiQuarterlyIndustryRows().map((r) => ({
    quarter: r.quarter,
    quarterLabel: r.quarterLabel,
    fundsMobilized: r.grandTotalFundsMobilized ?? null,
    repurchase: r.grandTotalRepurchase ?? null,
    netInflow: r.grandTotalNetInflow ?? null,
  }));
}

/**
 * Per-quarter active-equity envelope gross flows, derived from the
 * industry row's Sub II / Sub III columns plus arbitrage / solution
 * components pulled from the category snapshot:
 *
 *   activeEquityFundsMobilized = equityFundsMobilized
 *                              + (hybridFundsMobilized − arbitrageFundsMobilized)
 *                              + retirementFundsMobilized
 *                              + childrensFundsMobilized
 *
 *   activeEquityRepurchase = same with repurchase
 *
 * The arbitrage / retirement / children's gross fields are NOT on the
 * industry row schema (only Sub I/II/III/V are exposed; Sub IV is
 * intermediate-only on the schema, and the Arbitrage Fund row inside
 * Sub III is only captured for its net-inflow), so we read them from
 * the category snapshot and join by `quarter`. The signed
 * `activeEquityNetInflow` is already on the industry row as a derived
 * field.
 *
 * A row's gross-flow value is `null` when ANY contributing field is
 * missing — the chart renders a gap rather than a partial total.
 */
export function quarterlyActiveEquityGrossFlowsData(): QuarterlyGrossFlowsRow[] {
  const arbitrageBy = byQuarter(amfiQuarterlyCategoryRows("arbitrage"));
  const retirementBy = byQuarter(amfiQuarterlyCategoryRows("retirement"));
  const childrensBy = byQuarter(amfiQuarterlyCategoryRows("childrens"));
  return amfiQuarterlyIndustryRows().map((r) => {
    const arb = arbitrageBy.get(r.quarter);
    const ret = retirementBy.get(r.quarter);
    const chi = childrensBy.get(r.quarter);
    const fundsMobilized = computeActiveEquityFlow(
      r.equityFundsMobilized,
      r.hybridFundsMobilized,
      arb?.categoryFundsMobilized,
      ret?.categoryFundsMobilized,
      chi?.categoryFundsMobilized
    );
    const repurchase = computeActiveEquityFlow(
      r.equityRepurchase,
      r.hybridRepurchase,
      arb?.categoryRepurchase,
      ret?.categoryRepurchase,
      chi?.categoryRepurchase
    );
    return {
      quarter: r.quarter,
      quarterLabel: r.quarterLabel,
      fundsMobilized,
      repurchase,
      netInflow: r.activeEquityNetInflow ?? null,
    };
  });
}

function byQuarter(
  rows: AmfiQuarterlyCategoryRow[]
): Map<string, AmfiQuarterlyCategoryRow> {
  return new Map(rows.map((r) => [r.quarter, r]));
}

function computeActiveEquityFlow(
  equity: number | undefined,
  hybrid: number | undefined,
  arbitrage: number | undefined,
  retirement: number | undefined,
  childrens: number | undefined
): number | null {
  if (
    typeof equity !== "number" ||
    typeof hybrid !== "number" ||
    typeof arbitrage !== "number" ||
    typeof retirement !== "number" ||
    typeof childrens !== "number"
  ) {
    return null;
  }
  return equity + (hybrid - arbitrage) + retirement + childrens;
}

/**
 * Per-quarter category-level gross flow series. Used for the optional
 * per-category cards. Returns one row per quarter the slug appears in,
 * sorted by quarter ascending.
 */
export function quarterlyCategoryGrossFlowData(
  slug: AmfiMonthlyCategorySlug
): QuarterlyGrossFlowsRow[] {
  return amfiQuarterlyCategoryRows(slug).map((r) => ({
    quarter: r.quarter,
    quarterLabel: r.quarterLabel,
    fundsMobilized: r.categoryFundsMobilized ?? null,
    repurchase: r.categoryRepurchase ?? null,
    netInflow: r.categoryNetInflow ?? null,
  }));
}

/**
 * Latest-quarter provenance for an industry-row field, e.g.
 * `latestIndustryProvenance("grandTotalFundsMobilized")` returns the
 * source PDF / page / row label for the most recent quarter's value
 * of that field. Used to populate the section's hover tooltip.
 * Returns `null` when no row carries the field.
 */
export function latestIndustryProvenance(
  field: keyof AmfiQuarterlyIndustryFieldSources
): AmfiQuarterlyFieldSource | null {
  const rows = amfiQuarterlyIndustryRows();
  for (let i = rows.length - 1; i >= 0; i--) {
    const fs = rows[i].fieldSources?.[field];
    if (fs) return fs;
  }
  return null;
}

/** Latest-quarter provenance for a category-row field. */
export function latestQuarterlyCategoryProvenance(
  slug: AmfiMonthlyCategorySlug,
  field: keyof AmfiQuarterlyCategoryFieldSources
): AmfiQuarterlyFieldSource | null {
  const rows = amfiQuarterlyCategoryRows(slug);
  for (let i = rows.length - 1; i >= 0; i--) {
    const fs = rows[i].fieldSources?.[field];
    if (fs) return fs;
  }
  return null;
}

/** Hover-tooltip caption for a quarterly provenance entry — surfaces
 *  PDF filename + pages + row/column label so users can verify a value
 *  against the source. Visible-text caption stays "Source: AMFI
 *  Quarterly Report"; this string is only attached to a `title=` attr. */
export function formatQuarterlyProvenanceTooltip(
  p: AmfiQuarterlyFieldSource | null
): string | null {
  if (!p) return null;
  const pages = p.sourcePages.length ? "p." + p.sourcePages.join(",") : "";
  const parts = ["AMFI Quarterly Report", p.sourcePdf, pages];
  if (p.sourceLabel) parts.push(p.sourceLabel);
  return parts.filter(Boolean).join(" · ");
}

/** Latest (most-recent) industry row, or null when the snapshot is
 *  empty. Mirrors `latestAmfiMonthlyRow()` on the monthly side so the
 *  /quarterly Snapshot section can render in the same shape. */
export function latestQuarterlyRow(): AmfiQuarterlyIndustryRow | null {
  const rows = amfiQuarterlyIndustryRows();
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** Alias for `amfiQuarterlyIndustryRows()` matching the spec naming on
 *  the /quarterly rebuild. Returns rows sorted by `quarter` ascending. */
export function quarterlyRows(): AmfiQuarterlyIndustryRow[] {
  return amfiQuarterlyIndustryRows();
}

/** List available fiscal quarters newest → oldest, ready for the
 *  FiscalQuarterPicker. Each entry carries the canonical id
 *  ("FY26-Q4") plus its display label ("4QFY26") so the picker
 *  doesn't have to derive labels from ids — the snapshot already
 *  carries both. */
export function availableQuartersDesc(): { id: string; label: string }[] {
  return amfiQuarterlyIndustryRows()
    .map((r) => ({ id: r.quarter, label: r.quarterLabel }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** Resolve the row for a specific quarter id (e.g. "FY26-Q4"), or
 *  `null` if the snapshot doesn't carry that quarter. */
export function rowForQuarter(
  quarterId: string
): AmfiQuarterlyIndustryRow | null {
  return amfiQuarterlyIndustryRows().find((r) => r.quarter === quarterId) ?? null;
}

/** Resolve the row to display given a `?quarter=FY26-Q4` URL value:
 *   - If `requested` matches an available quarter, return that row.
 *   - Otherwise (missing, malformed, or pointing to a quarter we don't
 *     have) fall back to the latest row.
 *  Always paired with `resolveSelectedQuarterId` so the page and the
 *  picker agree on which quarter is active. */
export function resolveSelectedQuarter(
  requested: string | undefined
): AmfiQuarterlyIndustryRow | null {
  if (requested) {
    const hit = rowForQuarter(requested);
    if (hit) return hit;
  }
  return latestQuarterlyRow();
}

/** YYYY-Qn-style id the page is showing (selected or latest) given a
 *  `?quarter=` URL value. Returns `null` when no rows exist. */
export function resolveSelectedQuarterId(
  requested: string | undefined
): string | null {
  return resolveSelectedQuarter(requested)?.quarter ?? null;
}

/** Numeric KPI fields on AmfiQuarterlyIndustryRow. The keys match the
 *  AmfiQuarterlyIndustryFieldSources shape — only fields the schema
 *  actually carries can be passed to `quarterlyTrend` and the
 *  provenance helpers, so the type is closed at compile time. */
export type AmfiQuarterlyKpiField = keyof AmfiQuarterlyIndustryFieldSources;

/** Resolve a numeric KPI from a row. Returns `null` when the row is
 *  null OR the field is absent — callers should hide / show "—" in
 *  that case rather than synthesising a value. */
export function getQuarterlyKpiValue(
  row: AmfiQuarterlyIndustryRow | null,
  field: AmfiQuarterlyKpiField
): number | null {
  if (!row) return null;
  const v = (row as unknown as Record<string, unknown>)[field];
  return typeof v === "number" ? v : null;
}

/** Resolve the per-field provenance for a row + field. Returns `null`
 *  when no value was extracted — provenance is always paired with a
 *  value by the extractor. */
export function getQuarterlyKpiProvenance(
  row: AmfiQuarterlyIndustryRow | null,
  field: AmfiQuarterlyKpiField
): AmfiQuarterlyFieldSource | null {
  if (!row) return null;
  return row.fieldSources?.[field] ?? null;
}

/** Spec-named alias for getQuarterlyKpiProvenance. Same behaviour. */
export function getQuarterlyProvenance(
  row: AmfiQuarterlyIndustryRow | null,
  field: AmfiQuarterlyKpiField
): AmfiQuarterlyFieldSource | null {
  return getQuarterlyKpiProvenance(row, field);
}

/** AUM mix slices for a specific quarter row. Returns the four
 *  major-category sub-totals (Equity / Debt / Hybrid / Other Schemes)
 *  the schema exposes, plus a residual slice when the four parts plus
 *  any implicit Solution-Oriented bucket sum to less than the row's
 *  Grand Total AUM. The residual catches Solution-Oriented (which is
 *  intermediate-only on the schema) plus close-ended schemes. The
 *  residual is suppressed when ≤ 0 (a wash, or implies extraction
 *  noise). Returned in a chart-ready shape — the page can spread it
 *  straight into the Donut. */
export function quarterlyAumMixForQuarter(
  row: AmfiQuarterlyIndustryRow | null
): { slices: { key: string; label: string; value: number; color: string }[]; residual: number | null } {
  if (!row) return { slices: [], residual: null };
  const slices: { key: string; label: string; value: number; color: string }[] = [];
  if (typeof row.equityAum === "number") {
    slices.push({
      key: "equity",
      label: "Equity",
      value: row.equityAum,
      color: "hsl(var(--chart-1))",
    });
  }
  if (typeof row.debtAum === "number") {
    slices.push({
      key: "debt",
      label: "Debt",
      value: row.debtAum,
      color: "hsl(var(--chart-2))",
    });
  }
  if (typeof row.hybridAum === "number") {
    slices.push({
      key: "hybrid",
      label: "Hybrid",
      value: row.hybridAum,
      color: "hsl(var(--chart-3))",
    });
  }
  if (typeof row.otherSchemesAum === "number") {
    slices.push({
      key: "otherSchemes",
      label: "Other Schemes",
      value: row.otherSchemesAum,
      color: "hsl(var(--chart-4))",
    });
  }
  let residual: number | null = null;
  if (
    typeof row.equityAum === "number" &&
    typeof row.debtAum === "number" &&
    typeof row.hybridAum === "number" &&
    typeof row.otherSchemesAum === "number" &&
    typeof row.grandTotalAum === "number"
  ) {
    const sumKnown =
      row.equityAum + row.debtAum + row.hybridAum + row.otherSchemesAum;
    const r = row.grandTotalAum - sumKnown;
    if (r > 0) {
      residual = r;
      slices.push({
        key: "residual",
        label: "Solution / Close-ended",
        value: r,
        color: "hsl(var(--muted-foreground))",
      });
    }
  }
  return { slices, residual };
}

/** Visible "Source: AMFI Quarterly Report" caption rendered beneath
 *  every quarterly-PDF-backed card. Returns null when no provenance is
 *  set so callers can fall back to a static string. */
export function formatQuarterlyProvenanceLine(
  p: AmfiQuarterlyFieldSource | null
): string | null {
  if (!p) return null;
  return "Source: AMFI Quarterly Report";
}

/** Chronological trend series for an industry-row KPI. Each entry is
 *  `{ label, value }` where `label` is the fiscal quarter display
 *  string ("4QFY26") so the chart's labelFormat="none" renders it
 *  verbatim. Quarters where `field` is absent are OMITTED — never
 *  zero-filled. The latest `lastN` quarters are returned in
 *  chronological order; `lastN` defaults to 8 (the full history we
 *  have). */
export function quarterlyTrend(
  field: AmfiQuarterlyKpiField,
  lastN = 8
): { label: string; value: number }[] {
  const rows = amfiQuarterlyIndustryRows();
  const all = rows.flatMap((r) => {
    const v = (r as unknown as Record<string, unknown>)[field];
    if (typeof v !== "number") return [];
    return [{ label: r.quarterLabel, value: v }];
  });
  return all.slice(-lastN);
}

/**
 * Unified historical context for a quarterly KPI field. Mirrors the
 * monthly `kpiContext` helper — returns trailing sparkline, YoY%
 * (vs same quarter 4 quarters ago), percentile, and z-score across
 * the full available quarterly history.
 */
export interface QuarterlyKpiContext {
  latest: number | null;
  latestQuarter: string | null;
  sparkline: { label: string; value: number }[];
  yoyPct: number | null;
  percentile: number | null;
  zScore: number | null;
}

export function quarterlyKpiContext(
  field: AmfiQuarterlyKpiField,
  lastN = 16,
  asOfQuarter?: string
): QuarterlyKpiContext {
  const rows = amfiQuarterlyIndustryRows();
  const series = rows.flatMap((r) => {
    const v = (r as unknown as Record<string, unknown>)[field];
    if (typeof v !== "number") return [];
    return [{ quarter: r.quarter, label: r.quarterLabel, value: v }];
  });
  if (series.length === 0) {
    return {
      latest: null,
      latestQuarter: null,
      sparkline: [],
      yoyPct: null,
      percentile: null,
      zScore: null,
    };
  }
  // Anchor = caller-selected quarter when present, else the most recent
  // row. YoY (vs row 4 quarters back from anchor), percentile / z-score,
  // and the sparkline window all key off the anchor so the snapshot card
  // stays in sync when the user picks a non-latest quarter. Fallback to
  // latest if the requested quarter isn't in the field's series.
  const anchorIdx = asOfQuarter
    ? series.findIndex((p) => p.quarter === asOfQuarter)
    : -1;
  const anchorPos = anchorIdx >= 0 ? anchorIdx : series.length - 1;
  const anchor = series[anchorPos];
  const sparkline = series
    .slice(Math.max(0, anchorPos - lastN + 1), anchorPos + 1)
    .map((p) => ({ label: p.label, value: p.value }));
  // YoY = vs the row 4 quarters back from anchor (same fiscal quarter,
  // prior year).
  const yearAgoIdx = anchorPos - 4;
  const yearAgo = yearAgoIdx >= 0 ? series[yearAgoIdx] : null;
  const yoyPct =
    yearAgo && yearAgo.value !== 0
      ? ((anchor.value - yearAgo.value) / Math.abs(yearAgo.value)) * 100
      : null;
  const values = series.map((p) => p.value);
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = n >= 2 && variance > 0 ? Math.sqrt(variance) : null;
  const zScore =
    stdDev !== null && stdDev > 0 ? (anchor.value - mean) / stdDev : null;
  const lessOrEqual = values.filter((v) => v <= anchor.value).length;
  const percentile = (lessOrEqual / n) * 100;
  return {
    latest: anchor.value,
    latestQuarter: anchor.quarter,
    sparkline,
    yoyPct,
    percentile,
    zScore,
  };
}

/** Quarter-over-quarter net additions to industry folios. Computed at
 *  render time as `current.grandTotalFolios − previous.grandTotalFolios`
 *  labelled with the CURRENT quarter (i.e. additions DURING that
 *  quarter). The first quarter has no prior quarter and is omitted;
 *  any quarter where either side's folios is missing is also skipped
 *  — no synthetic zero is introduced. Negative deltas are surfaced
 *  as-is. */
export function quarterlyFolioAdditionsTrend(
  lastN = 8
): { label: string; value: number }[] {
  const rows = amfiQuarterlyIndustryRows();
  const out: { label: string; value: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].grandTotalFolios;
    const cur = rows[i].grandTotalFolios;
    if (typeof prev !== "number" || typeof cur !== "number") continue;
    out.push({ label: rows[i].quarterLabel, value: cur - prev });
  }
  return out.slice(-lastN);
}

/** Latest-quarter folio additions = grandTotalFolios on the latest row
 *  minus grandTotalFolios on the prior row. Returns `null` when fewer
 *  than two quarters carry the field, OR when either side is missing. */
export function latestQuarterlyFolioAdditions(): number | null {
  const trend = quarterlyFolioAdditionsTrend(8);
  return trend.length > 0 ? trend[trend.length - 1].value : null;
}

/** Per-quarter open-ended scheme count. DERIVED as the sum of
 *  `categorySchemes` across all 39 open-ended category slugs the
 *  extractor captures. The result is the count of OPEN-ENDED schemes
 *  only — the AMFI quarterly Report's Grand Total scheme count
 *  additionally includes close-ended and interval schemes (~93 more
 *  on the latest quarter), but those buckets are intentionally not
 *  extracted since they aren't surfaced by the dashboard. The card
 *  label is therefore "Open-Ended Scheme Count" so the basis is
 *  explicit. Quarters where any contributing category is missing
 *  `categorySchemes` are computed on the partial sum (each missing
 *  category is treated as 0 for the count, since adding 0 is
 *  arithmetically identical to skipping the slug — but a category
 *  with NO row at all for the quarter contributes 0 silently; in
 *  practice all 39 slugs have a row in every quarter). */
export function quarterlyOpenEndedSchemeCountTrend(
  lastN = 8
): { label: string; value: number }[] {
  const byQuarter = new Map<
    string,
    { quarterLabel: string; total: number; sourceCount: number }
  >();
  for (const r of amfiQuarterlyCategorySnapshot.rows) {
    if (typeof r.categorySchemes !== "number") continue;
    const entry =
      byQuarter.get(r.quarter) ??
      { quarterLabel: r.quarterLabel, total: 0, sourceCount: 0 };
    entry.total += r.categorySchemes;
    entry.sourceCount += 1;
    byQuarter.set(r.quarter, entry);
  }
  return Array.from(byQuarter.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ label: v.quarterLabel, value: v.total }))
    .slice(-lastN);
}

/** Latest-quarter open-ended scheme count. */
export function latestOpenEndedSchemeCount(): number | null {
  const trend = quarterlyOpenEndedSchemeCountTrend(1);
  return trend.length > 0 ? trend[0].value : null;
}


// ---------------------------------------------------------------------
// Helpers for the /quarterly final-alignment rebuild.
//
// All numbers below come from amfi-quarterly-{industry,category}.json.
// LastMonthAaum semantics are documented at the top of this file —
// none of these helpers should be used to compute QAAUM share. The
// IIFL Active-Equity Category Trends section continues to use the
// monthly snapshot via amfi-monthly-category.ts for that purpose.
// ---------------------------------------------------------------------

/** Quarter-end Liquid Fund AUM. The industry row schema does NOT
 *  expose a Liquid Fund bucket directly (Liquid is a sub-row of
 *  Sub Total - I, not its own sub-total), so we read it from the
 *  category snapshot. Used by the Snapshot card and the AUM Mix
 *  donut. Returns `null` when the category row is absent. */
export function liquidAumForQuarter(
  quarterId: string
): number | null {
  const r = amfiQuarterlyCategoryRows("liquid").find(
    (x) => x.quarter === quarterId
  );
  return typeof r?.categoryAum === "number" ? r.categoryAum : null;
}

/** Per-quarter Equity / Debt / Liquid net inflow series, ready for
 *  the Quarterly Flows GroupedBars chart. Cells are null when a
 *  source field is missing — Recharts skips null bars and the chart
 *  renders without a fake-zero placeholder. Mirrors
 *  monthlyFlowsData() shape so the bars chart can swap implementations
 *  with minimal config drift.
 *
 *  Liquid is sourced from the Liquid Fund row's categoryNetInflow
 *  (it's a sub-component of debt; debtNetInflow already includes
 *  Liquid, but the chart shows them separately for parity with the
 *  monthly Equity/Debt/Liquid flows view). */
export function quarterlyFlowsData(
  lastN = 8
): {
  quarter: string;
  quarterLabel: string;
  equity: number | null;
  debt: number | null;
  liquid: number | null;
}[] {
  const liquidByQuarter = new Map<string, number>(
    amfiQuarterlyCategoryRows("liquid").flatMap((r) =>
      typeof r.categoryNetInflow === "number"
        ? [[r.quarter, r.categoryNetInflow] as [string, number]]
        : []
    )
  );
  return amfiQuarterlyIndustryRows()
    .slice(-lastN)
    .map((r) => ({
      quarter: r.quarter,
      quarterLabel: r.quarterLabel,
      equity:
        typeof r.equityNetInflow === "number" ? r.equityNetInflow : null,
      debt:
        typeof r.debtNetInflow === "number" ? r.debtNetInflow : null,
      liquid: liquidByQuarter.get(r.quarter) ?? null,
    }));
}

/**
 * Active-Equity Last-month AAUM derived per quarter:
 *   activeEquityLastMonthAaum = equityLastMonthAaum
 *                             + (hybridLastMonthAaum − arbitrageLastMonthAaum_cat)
 *                             + retirementLastMonthAaum_cat
 *                             + childrensLastMonthAaum_cat
 *
 * Sub Total - II (Growth/Equity) and Sub Total - III (Hybrid) are
 * exposed on the industry row directly. Sub Total - IV (Solution) is
 * intermediate-only on the schema, so we sum its two component
 * categories from the category snapshot. Arbitrage is similarly read
 * from the category snapshot to subtract it out of Hybrid.
 *
 * IMPORTANT: this is LAST-MONTH AAUM, not a true quarterly average.
 * The /quarterly Active Equity & Equity Mix section labels every
 * surface "Last-month AAUM" so consumers don't conflate it with the
 * monthly QAAUM-share denominators.
 */
export function quarterlyActiveEquityLastMonthAaumTrend(
  lastN = 8
): { label: string; value: number }[] {
  const arbitrageBy = new Map<string, number>(
    amfiQuarterlyCategoryRows("arbitrage").flatMap((r) =>
      typeof r.categoryLastMonthAaum === "number"
        ? [[r.quarter, r.categoryLastMonthAaum] as [string, number]]
        : []
    )
  );
  const retirementBy = new Map<string, number>(
    amfiQuarterlyCategoryRows("retirement").flatMap((r) =>
      typeof r.categoryLastMonthAaum === "number"
        ? [[r.quarter, r.categoryLastMonthAaum] as [string, number]]
        : []
    )
  );
  const childrensBy = new Map<string, number>(
    amfiQuarterlyCategoryRows("childrens").flatMap((r) =>
      typeof r.categoryLastMonthAaum === "number"
        ? [[r.quarter, r.categoryLastMonthAaum] as [string, number]]
        : []
    )
  );
  return amfiQuarterlyIndustryRows()
    .slice(-lastN)
    .flatMap((r) => {
      const eq = r.equityLastMonthAaum;
      const hy = r.hybridLastMonthAaum;
      const arb = arbitrageBy.get(r.quarter);
      const ret = retirementBy.get(r.quarter);
      const chi = childrensBy.get(r.quarter);
      if (
        typeof eq !== "number" ||
        typeof hy !== "number" ||
        typeof arb !== "number" ||
        typeof ret !== "number" ||
        typeof chi !== "number"
      ) {
        return [];
      }
      const value = eq + (hy - arb) + ret + chi;
      return [{ label: r.quarterLabel, value }];
    });
}

/** Active-Equity Share of Total Last-month AAUM trend.
 *   share % = activeEquityLastMonthAaum / grandTotalLastMonthAaum × 100
 *
 *  IMPORTANT: Both numerator and denominator are LAST-MONTH AAUM.
 *  This is NOT a QAAUM-share metric — it's the quarterly Report
 *  column-versus-column ratio. The IIFL section that uses true
 *  QAAUM share remains on monthly aggregation. */
export function quarterlyActiveEquityLastMonthShareTrend(
  lastN = 8
): { label: string; value: number }[] {
  const aeByQuarter = new Map<string, number>(
    quarterlyActiveEquityLastMonthAaumTrend(lastN).map(
      (e) => [labelToQuarter(e.label), e.value] as [string, number]
    )
  );
  return amfiQuarterlyIndustryRows()
    .slice(-lastN)
    .flatMap((r) => {
      const ae = aeByQuarter.get(r.quarter);
      const tot = r.grandTotalLastMonthAaum;
      if (typeof ae !== "number" || typeof tot !== "number" || tot <= 0) {
        return [];
      }
      return [{ label: r.quarterLabel, value: (ae / tot) * 100 }];
    });
}

/** Inverse of quarterLabel→quarter resolution: given the display
 *  label ("4QFY26"), return the canonical id ("FY26-Q4"). Used only
 *  to bridge two helpers that report on the same quarter via
 *  different keys. */
function labelToQuarter(label: string): string {
  const r = amfiQuarterlyIndustryRows().find((x) => x.quarterLabel === label);
  return r?.quarter ?? "";
}

/**
 * Equity Last-month AAUM Breakdown per quarter — IIFL Figure 19-style
 * grouping (Active Equity / ETF & Index / Arbitrage). Returns one row
 * per quarter ready for the GroupedBars chart.
 *
 *   activeEquity = derived as above
 *   etfIndex     = Index Funds + Other ETFs categoryLastMonthAaum
 *                  (excludes Gold ETFs and Fund of Funds investing
 *                  overseas, matching the monthly Equity AAUM
 *                  Breakdown definition).
 *   arbitrage    = Arbitrage Fund categoryLastMonthAaum
 *
 * Each cell is `null` when its component is absent — chart renders a
 * gap, never a fake zero.
 */
export function quarterlyEquityLastMonthAaumBreakdown(
  lastN = 8
): {
  quarter: string;
  quarterLabel: string;
  activeEquity: number | null;
  etfIndex: number | null;
  arbitrage: number | null;
}[] {
  const arbitrageBy = new Map<string, number>(
    amfiQuarterlyCategoryRows("arbitrage").flatMap((r) =>
      typeof r.categoryLastMonthAaum === "number"
        ? [[r.quarter, r.categoryLastMonthAaum] as [string, number]]
        : []
    )
  );
  const indexBy = new Map<string, number>(
    amfiQuarterlyCategoryRows("index-funds").flatMap((r) =>
      typeof r.categoryLastMonthAaum === "number"
        ? [[r.quarter, r.categoryLastMonthAaum] as [string, number]]
        : []
    )
  );
  const otherEtfsBy = new Map<string, number>(
    amfiQuarterlyCategoryRows("other-etfs").flatMap((r) =>
      typeof r.categoryLastMonthAaum === "number"
        ? [[r.quarter, r.categoryLastMonthAaum] as [string, number]]
        : []
    )
  );
  const aeByQuarter = new Map<string, number>();
  for (const e of quarterlyActiveEquityLastMonthAaumTrend(lastN)) {
    aeByQuarter.set(labelToQuarter(e.label), e.value);
  }
  return amfiQuarterlyIndustryRows()
    .slice(-lastN)
    .map((r) => {
      const idx = indexBy.get(r.quarter);
      const oth = otherEtfsBy.get(r.quarter);
      const arb = arbitrageBy.get(r.quarter);
      const ae = aeByQuarter.get(r.quarter);
      const etfIndex =
        typeof idx === "number" && typeof oth === "number" ? idx + oth : null;
      return {
        quarter: r.quarter,
        quarterLabel: r.quarterLabel,
        activeEquity: typeof ae === "number" ? ae : null,
        etfIndex,
        arbitrage: typeof arb === "number" ? arb : null,
      };
    });
}

/** Provenance for a category row's `categoryAum` on a specific
 *  quarter. Used by the AMFI Quarterly Snapshot's Liquid AUM card —
 *  Liquid is read from the category snapshot (the industry-row
 *  schema doesn't expose it as its own bucket). */
export function quarterlyCategoryAumProvenance(
  slug: AmfiMonthlyCategorySlug,
  quarterId: string
): AmfiQuarterlyFieldSource | null {
  const r = amfiQuarterlyCategoryRows(slug).find((x) => x.quarter === quarterId);
  return r?.fieldSources?.categoryAum ?? null;
}

// =============================================================
// Category-level HHI (concentration tracker)
// =============================================================

export interface CategoryHhiPoint {
  quarter: string;
  quarterLabel: string;
  hhi: number;
  participantCount: number;
  topCategorySharePct: number;
  topCategorySlug: string | null;
}

/**
 * Industry concentration measured across SEBI/AMFI scheme
 * categories. For each quarter we treat every category as a
 * "participant," compute its share of the closing industry AUM,
 * and emit HHI = Σ(share²) × 10,000.
 *
 *   share_c = categoryAum_c / Σ categoryAum_*
 *
 * The denominator is the sum of categories present in the quarter
 * (not `grandTotalAum`), so absent categories don't artificially
 * deflate the index. Quarters with zero categories are skipped.
 *
 * Returned series is chronological, latest `lastN` quarters.
 */
export function categoryHhiSeries(lastN = 8): CategoryHhiPoint[] {
  const rows = quarterlyCategoryRaw.rows;
  const byQuarter = new Map<string, { slug: string; aum: number }[]>();
  for (const r of rows) {
    if (typeof r.categoryAum !== "number") continue;
    const arr = byQuarter.get(r.quarter) ?? [];
    arr.push({ slug: r.categorySlug, aum: r.categoryAum });
    byQuarter.set(r.quarter, arr);
  }
  const quarters = Array.from(byQuarter.keys()).sort().slice(-lastN);

  return quarters.map((q) => {
    const entries = byQuarter.get(q) ?? [];
    const total = entries.reduce((s, e) => s + e.aum, 0);
    let hhi = 0;
    let topShare = 0;
    let topSlug: string | null = null;
    if (total > 0) {
      for (const e of entries) {
        const share = (e.aum / total) * 100;
        hhi += share * share;
        if (share > topShare) {
          topShare = share;
          topSlug = e.slug;
        }
      }
    }
    return {
      quarter: q,
      quarterLabel: fiscalLabelFromCalendarQuarter(q),
      hhi,
      participantCount: entries.length,
      topCategorySharePct: topShare,
      topCategorySlug: topSlug,
    };
  });
}

/** Category-level HHI percentile read for the latest quarter against
 *  a trailing window. Mirrors `amcLevelHhiPercentileRead`. */
export interface CategoryHhiPercentileRead {
  latestHhi: number;
  latestQuarter: string;
  latestQuarterLabel: string;
  windowQuarters: number;
  percentile: number;
  changeVsAnchor: number | null;
  anchorQuarterLabel: string | null;
}

export function categoryHhiPercentileRead(
  windowQuarters = 20,
  compareQuartersBack = 20
): CategoryHhiPercentileRead | null {
  const series = categoryHhiSeries(windowQuarters);
  if (series.length < 4) return null;
  const latest = series[series.length - 1];
  const lessOrEqual = series.filter((p) => p.hhi <= latest.hhi).length;
  const percentile = (lessOrEqual / series.length) * 100;
  const full = categoryHhiSeries(1000);
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

// ---- Per-section 1-line narrative reads for /quarterly ---------------

function pctLabel(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  const r = Math.round(p);
  const v = Math.abs(r) % 100;
  const suffix =
    v >= 11 && v <= 13
      ? "th"
      : r % 10 === 1
        ? "st"
        : r % 10 === 2
          ? "nd"
          : r % 10 === 3
            ? "rd"
            : "th";
  return `${r}${suffix} pct`;
}

function yoyText(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}% YoY`;
}

/** Quarterly Snapshot 1-liner — total AUM YoY + net inflow percentile. */
export function quarterlySnapshotSectionRead(): string | null {
  const aum = quarterlyKpiContext("grandTotalAum", 16);
  const flow = quarterlyKpiContext("grandTotalNetInflow", 16);
  const parts: string[] = [];
  if (aum.yoyPct !== null) parts.push(`Total AUM ${yoyText(aum.yoyPct)}`);
  if (flow.percentile !== null) parts.push(`Net inflow ${pctLabel(flow.percentile)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Quarterly Flows 1-liner — equity / debt flow percentiles. */
export function quarterlyFlowsSectionRead(): string | null {
  const eq = quarterlyKpiContext("equityNetInflow", 16);
  const dbt = quarterlyKpiContext("debtNetInflow", 16);
  const parts: string[] = [];
  if (eq.percentile !== null) parts.push(`Equity flow ${pctLabel(eq.percentile)}`);
  if (dbt.percentile !== null) parts.push(`Debt flow ${pctLabel(dbt.percentile)}`);
  if (eq.percentile !== null && dbt.percentile !== null) {
    const cue =
      eq.percentile >= 60 && dbt.percentile <= 40
        ? "risk-on"
        : eq.percentile <= 40 && dbt.percentile >= 60
          ? "risk-off"
          : "mixed";
    parts.push(cue);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Folios 1-liner — total folios YoY + open-ended scheme count growth. */
export function quarterlyFoliosSectionRead(): string | null {
  const folios = quarterlyKpiContext("grandTotalFolios", 16);
  const parts: string[] = [];
  if (folios.yoyPct !== null) parts.push(`Folios ${yoyText(folios.yoyPct)}`);
  if (folios.percentile !== null) parts.push(pctLabel(folios.percentile));
  return parts.length > 0 ? parts.join(" · ") : null;
}
