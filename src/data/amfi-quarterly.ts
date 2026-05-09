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

