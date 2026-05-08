/**
 * Read accessor for the AMFI monthly PDF snapshot
 * (`src/data/snapshots/amfi-monthly-pdf.json`). Used by the /monthly
 * page to render the first live AMFI widget.
 *
 * The snapshot is a per-month industry-level KPI table populated by
 * the manual-PDF extractor at `scripts/ingest/amfi-monthly-pdf.ts`.
 * Every numeric KPI is OPTIONAL — fields that no uploaded PDF carried
 * stay absent on the row, never zeroed. Per-field provenance lives on
 * `row.fieldSources[<field>]`.
 *
 * Helpers in this file always:
 *   - Sort rows by month ascending so "latest" is unambiguous.
 *   - Return `null` / `undefined` for absent values (callers must
 *     branch on that — they should NOT substitute zero or any other
 *     synthetic placeholder).
 *   - Read provenance from `row.fieldSources` rather than the
 *     row-level `sourcePdf`, so a merged row reports the right PDF
 *     per KPI.
 */
import amfiMonthlyPdfRaw from "./snapshots/amfi-monthly-pdf.json";
import type {
  AmfiMonthlyPdfFieldProvenance,
  AmfiMonthlyPdfFieldSources,
  AmfiMonthlyPdfRow,
  AmfiMonthlyPdfSnapshot,
} from "./snapshots/types";

export const amfiMonthlyPdfSnapshot =
  amfiMonthlyPdfRaw as AmfiMonthlyPdfSnapshot;

/** Row keys whose values are numeric KPIs (i.e. not month / source*). */
export type AmfiMonthlyKpiField = keyof AmfiMonthlyPdfFieldSources;

/** Returns rows sorted by `month` ascending (YYYY-MM lexical order). */
export function amfiMonthlyRows(): AmfiMonthlyPdfRow[] {
  return [...amfiMonthlyPdfSnapshot.rows].sort((a, b) =>
    a.month.localeCompare(b.month)
  );
}

/** Returns the row for the most recent month, or null if no PDF has
 *  been ingested yet. The /monthly widget renders a setup hint when
 *  this is null. */
export function latestAmfiMonthlyRow(): AmfiMonthlyPdfRow | null {
  const rows = amfiMonthlyRows();
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** Resolve a numeric KPI from a row. Returns `null` if the row is
 *  null OR the field is absent — callers should hide / show "—" in
 *  that case rather than synthesising a value. */
export function getKpiValue(
  row: AmfiMonthlyPdfRow | null,
  field: AmfiMonthlyKpiField
): number | null {
  if (!row) return null;
  const v = row[field];
  return typeof v === "number" ? v : null;
}

/** Resolve the per-field provenance for a row + field. Returns
 *  `null` when no value was extracted for that field — provenance is
 *  always paired with a value by the extractor. */
export function getKpiProvenance(
  row: AmfiMonthlyPdfRow | null,
  field: AmfiMonthlyKpiField
): AmfiMonthlyPdfFieldProvenance | null {
  if (!row) return null;
  const fs = row.fieldSources;
  return fs?.[field] ?? null;
}

/** Mapping of `sourceFormat` to the human-readable AMFI publication
 *  name shown in card source captions. */
export function sourceFormatLabel(
  format: AmfiMonthlyPdfFieldProvenance["sourceFormat"]
): string {
  switch (format) {
    case "monthly-report":
      return "AMFI Monthly Report";
    case "press-release":
      return "AMFI Monthly Note";
    case "unknown":
      return "AMFI PDF";
  }
}

/** Compose the per-field source caption shown beneath each KPI card.
 *  Format: "Source: AMFI Monthly Report". Intentionally minimal — the
 *  publication name is enough for at-a-glance recognition; the full
 *  PDF filename and page numbers are preserved on the row's
 *  `fieldSources[field]` object and surfaced via the hover tooltip
 *  (formatKpiProvenanceTooltip). Returns null when no provenance
 *  exists. */
export function formatKpiProvenanceLine(
  provenance: AmfiMonthlyPdfFieldProvenance | null
): string | null {
  if (!provenance) return null;
  return "Source: " + sourceFormatLabel(provenance.sourceFormat);
}

/** Hover-only caption that surfaces the full PDF filename for users who
 *  need to verify provenance. Returned as a single line suitable for a
 *  `title` attribute. Returns null when no provenance exists. */
export function formatKpiProvenanceTooltip(
  provenance: AmfiMonthlyPdfFieldProvenance | null
): string | null {
  if (!provenance) return null;
  const pages = provenance.sourcePages.length
    ? "p." + provenance.sourcePages.join(",")
    : "";
  const parts = [
    sourceFormatLabel(provenance.sourceFormat),
    provenance.sourcePdf,
    pages,
  ].filter(Boolean);
  if (provenance.sourceLabel) parts.push(provenance.sourceLabel);
  return parts.join(" · ");
}

/** Resolve the row for a specific YYYY-MM month, or null if absent. */
export function rowForMonth(month: string): AmfiMonthlyPdfRow | null {
  return amfiMonthlyRows().find((r) => r.month === month) ?? null;
}

/** List available months newest → oldest. Used by the month picker. */
export function availableMonthsDesc(): string[] {
  return amfiMonthlyRows()
    .map((r) => r.month)
    .sort((a, b) => b.localeCompare(a));
}

/** Resolve the row to display given a `?month=YYYY-MM` URL value:
 *   - If `requested` matches an available month, return that row.
 *   - Otherwise (missing, malformed, or for a month with no data) fall
 *     back to the latest row.
 *  Always paired with `resolveSelectedMonth` so the page and the picker
 *  agree on which month is active. */
export function resolveSelectedRow(
  requested: string | undefined
): AmfiMonthlyPdfRow | null {
  if (requested) {
    const hit = rowForMonth(requested);
    if (hit) return hit;
  }
  return latestAmfiMonthlyRow();
}

/** Returns the YYYY-MM key the page is showing (selected or latest)
 *  given a `?month=` URL value. Returns null when no rows exist. */
export function resolveSelectedMonth(
  requested: string | undefined
): string | null {
  const row = resolveSelectedRow(requested);
  return row?.month ?? null;
}

/**
 * Return a chronological trend series for `field`. Each entry has
 * `{label, value}` where `label` is the YYYY-MM month (passed through
 * `formatMonthLabel` by the chart's labelFormat="month" axis) and
 * `value` is the numeric KPI on that month.
 *
 * Months WHERE `field` IS ABSENT are OMITTED from the array — the
 * chart's x-axis is non-uniform but no synthetic zero / interpolation
 * is introduced (the spec for SIP Trends says "omit that month for
 * that specific series rather than showing zero" when the chart can't
 * render gaps cleanly, which is the case for the existing BarSeries).
 *
 * `lastN` clamps the series length to the most recent N months so a
 * very long backfill of uploaded PDFs doesn't crowd the trend axis.
 * Defaults to 24 to match the spec.
 */
export function monthlyTrend(
  field: AmfiMonthlyKpiField,
  lastN = 24
): { label: string; value: number }[] {
  const rows = amfiMonthlyRows();
  const all = rows
    .filter((r) => typeof r[field] === "number")
    .map((r) => ({ label: r.month, value: r[field] as number }));
  return all.slice(-lastN);
}

/**
 * Resolve the freshest per-field provenance for a field across the
 * entire snapshot, used as a single source caption for a trend chart
 * that may span months from multiple PDFs. Returns the provenance of
 * the LATEST month that carries the field — typically the most-recent
 * AMFI publication, which is the most useful pointer for a tooltip.
 * Returns null when no row has the field.
 */
export function latestProvenanceFor(
  field: AmfiMonthlyKpiField
): AmfiMonthlyPdfFieldProvenance | null {
  const rows = amfiMonthlyRows();
  for (let i = rows.length - 1; i >= 0; i--) {
    const fs = rows[i].fieldSources?.[field];
    if (fs) return fs;
  }
  return null;
}

/**
 * Category-level monthly net-flow series for a Figure 22-style chart.
 * Each row is `{ month, equity, debt, liquid }` where each numeric is
 * either the field value (signed; positive on inflow months, negative
 * on outflow months) or `null` when that month's row didn't carry the
 * field. Recharts' GroupedBars treats `null` cells as gaps and renders
 * the other categories normally — that's how we honour the
 * "no-fake-zero" rule.
 *
 * The latest `lastN` months are returned, in chronological order.
 * `lastN` defaults to 24 to match the dashboard cap.
 */
export function monthlyFlowsData(
  lastN = 24
): { month: string; equity: number | null; debt: number | null; liquid: number | null }[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.map((r) => ({
    month: r.month,
    equity: typeof r.equityNetInflow === "number" ? r.equityNetInflow : null,
    debt: typeof r.debtNetInflow === "number" ? r.debtNetInflow : null,
    liquid: typeof r.liquidNetInflow === "number" ? r.liquidNetInflow : null,
  }));
}

/**
 * Active equity share of total AUM, IIFL Figure 21-style. Returned
 * as a chronological `{ label, value }` series suitable for the
 * existing BarSeries chart with valueFormat="pct".
 *
 *   activeEquitySharePct = activeEquityAum / totalAum × 100
 *
 * IMPORTANT: divides by totalAum (closing balance), NOT totalAaum
 * (period average), because activeEquityAum itself is a closing-
 * balance figure derived from AMFI Monthly Report Sub Total rows.
 *
 * Months where either field is missing are OMITTED — never zero-
 * filled. The resulting series may have an uneven x-axis if some
 * months have data and others don't.
 */
export function monthlyActiveEquityShareTrend(
  lastN = 24
): { label: string; value: number }[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.flatMap((r) => {
    if (typeof r.activeEquityAum !== "number" || typeof r.totalAum !== "number") {
      return [];
    }
    if (r.totalAum <= 0) return [];
    return [{ label: r.month, value: (r.activeEquityAum / r.totalAum) * 100 }];
  });
}

/**
 * IIFL Figure 19-style equity breakdown trend. Each row is
 * `{ month, activeEquity, etfIndex, arbitrage }` for the latest
 * `lastN` months (chronological). Each numeric is either the field
 * value (₹ Cr) or `null` when missing. Used by GroupedBars (or a
 * stacked component if added later) to show how the equity stack
 * evolves over time.
 */
export function monthlyEquityBreakdown(
  lastN = 24
): {
  month: string;
  activeEquity: number | null;
  etfIndex: number | null;
  arbitrage: number | null;
}[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.map((r) => ({
    month: r.month,
    activeEquity:
      typeof r.activeEquityAum === "number" ? r.activeEquityAum : null,
    etfIndex: typeof r.etfIndexAum === "number" ? r.etfIndexAum : null,
    arbitrage: typeof r.arbitrageAum === "number" ? r.arbitrageAum : null,
  }));
}
