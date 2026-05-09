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
