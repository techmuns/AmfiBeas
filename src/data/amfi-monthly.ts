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

/** Per-field source caption shown beneath each KPI card.
 *  PR #98: visible "Source: AMFI Monthly Report" line was retired;
 *  this helper now returns null so callers render no text under the
 *  KPI card. The full PDF filename + page numbers stay available on
 *  the row's `fieldSources[field]` object and continue to surface
 *  via the hover tooltip (formatKpiProvenanceTooltip) — that
 *  tooltip remains because hover doesn't add visual clutter to the
 *  main UI. */
export function formatKpiProvenanceLine(
  _provenance: AmfiMonthlyPdfFieldProvenance | null
): string | null {
  void _provenance;
  return null;
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
 * Active equity share of total AAUM, IIFL Figure 21-style. Returned
 * as a chronological `{ label, value }` series suitable for the
 * existing BarSeries chart with valueFormat="pct".
 *
 *   activeEquitySharePct = activeEquityAaum / totalAaum × 100
 *
 * Both numerator and denominator are period-average (AAUM) so the
 * ratio is consistently on a period-average basis. Months where
 * either field is missing are OMITTED — never zero-filled.
 */
export function monthlyActiveEquityShareTrend(
  lastN = 24
): { label: string; value: number }[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.flatMap((r) => {
    if (
      typeof r.activeEquityAaum !== "number" ||
      typeof r.totalAaum !== "number"
    ) {
      return [];
    }
    if (r.totalAaum <= 0) return [];
    return [{ label: r.month, value: (r.activeEquityAaum / r.totalAaum) * 100 }];
  });
}

/**
 * Month-over-month net additions to the industry folio count. For
 * each pair of CONSECUTIVE rows (chronological), emit the delta
 * `current.industryFolios − previous.industryFolios` labelled with
 * the CURRENT month (i.e. additions DURING that month). The first
 * row of the series has no prior month and is omitted; rows where
 * either side's `industryFolios` is missing are also skipped — no
 * synthetic zero is introduced.
 *
 * Negative deltas are surfaced as-is (industry has occasional
 * net-folio-decrease months from closures).
 *
 * Returns the latest `lastN` deltas in chronological order. Defaults
 * to 24 to match the dashboard cap.
 */
export function monthlyIndustryFolioAdditionsTrend(
  lastN = 24
): { label: string; value: number }[] {
  const rows = amfiMonthlyRows();
  const out: { label: string; value: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i].industryFolios;
    const prev = rows[i - 1].industryFolios;
    if (typeof cur === "number" && typeof prev === "number") {
      out.push({ label: rows[i].month, value: cur - prev });
    }
  }
  return out.slice(-lastN);
}

/** Latest month's `industryFolios` − previous month's. Returns null
 *  when either side is missing or there is no previous row. */
export function latestIndustryFolioAdditions(): number | null {
  const rows = amfiMonthlyRows();
  if (rows.length < 2) return null;
  const cur = rows[rows.length - 1].industryFolios;
  const prev = rows[rows.length - 2].industryFolios;
  if (typeof cur !== "number" || typeof prev !== "number") return null;
  return cur - prev;
}

/**
 * IIFL Figure 19-style equity breakdown trend (AAUM basis). Each
 * row is `{ month, activeEquity, etfIndex, arbitrage }` for the
 * latest `lastN` months (chronological). Each numeric is the
 * period-average AAUM for that bucket (₹ Cr) or `null` when
 * missing. Used by GroupedBars (or a stacked component if added
 * later) to show how the period-average equity stack evolves.
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
      typeof r.activeEquityAaum === "number" ? r.activeEquityAaum : null,
    etfIndex: typeof r.etfIndexAaum === "number" ? r.etfIndexAaum : null,
    arbitrage: typeof r.arbitrageAaum === "number" ? r.arbitrageAaum : null,
  }));
}

/**
 * Active-equity envelope net inflow trend (₹ Cr; signed) for the
 * latest `lastN` months. Returns chronological `{ label, value }` rows
 * compatible with the existing BarSeries chart. Months where
 * `activeEquityNetInflow` is missing are omitted — never zero-filled.
 *
 * The envelope itself is defined on the AmfiMonthlyPdfRow type:
 *   Sub Total - II                          (equity-oriented)
 *   + (Sub Total - III − Arbitrage Fund)    (active hybrid, ex-arbitrage)
 *   + Sub Total - IV                        (solution-oriented)
 */
export function monthlyActiveEquityNetInflowTrend(
  lastN = 24
): { label: string; value: number }[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.flatMap((r) =>
    typeof r.activeEquityNetInflow === "number"
      ? [{ label: r.month, value: r.activeEquityNetInflow }]
      : []
  );
}

/**
 * Trailing N-month average of `activeEquityNetInflow` evaluated AT
 * the latest available month. Defaults to a 12-month window. Returns
 * null when fewer than `window` months of data are available so the
 * UI can hide the reference line gracefully rather than rendering a
 * partial-window average.
 */
export function trailingActiveEquityNetInflowAverage(
  window = 12
): number | null {
  const rows = amfiMonthlyRows();
  const series = rows
    .map((r) => r.activeEquityNetInflow)
    .filter((v): v is number => typeof v === "number");
  if (series.length < window) return null;
  const tail = series.slice(-window);
  const sum = tail.reduce((s, v) => s + v, 0);
  return sum / tail.length;
}

/**
 * Active-equity AUM bridge trend. For every pair of consecutive
 * months where both `activeEquityAum` values AND the current month's
 * `activeEquityNetInflow` are available, emit:
 *
 *   netInflow        = activeEquityNetInflow_t              (₹ Cr, signed)
 *   marketResidual   = (activeEquityAum_t − activeEquityAum_t-1)
 *                      − activeEquityNetInflow_t            (₹ Cr, signed)
 *
 * `marketResidual` captures everything that moves AUM between two
 * month-end snapshots other than net flow — primarily mark-to-market
 * but also small reclassification effects. Months without a prior
 * row or without `activeEquityNetInflow` are skipped; no fake zeros.
 *
 * Uses CLOSING-balance `activeEquityAum` (month-end Net AUM) so the
 * identity (ΔAUM = flow + market) holds against the disclosed flow
 * field. The period-average `activeEquityAaum` is not appropriate
 * here because it averages over the month rather than measuring
 * end-of-period stock change.
 */
export function monthlyActiveEquityAumBridge(
  lastN = 24
): {
  month: string;
  netInflow: number;
  marketResidual: number;
}[] {
  const rows = amfiMonthlyRows();
  const out: {
    month: string;
    netInflow: number;
    marketResidual: number;
  }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (
      typeof cur.activeEquityAum !== "number" ||
      typeof prev.activeEquityAum !== "number" ||
      typeof cur.activeEquityNetInflow !== "number"
    ) {
      continue;
    }
    const delta = cur.activeEquityAum - prev.activeEquityAum;
    out.push({
      month: cur.month,
      netInflow: cur.activeEquityNetInflow,
      marketResidual: delta - cur.activeEquityNetInflow,
    });
  }
  return out.slice(-lastN);
}

/**
 * SIP AUM as a % share of Total AUM for the latest `lastN` months.
 *
 *   sipAumSharePct = sipAum / totalAum × 100
 *
 * Uses closing-balance `totalAum` to match `sipAum` (also a press-
 * release closing figure). Months missing either field are omitted.
 */
export function monthlySipAumShareTrend(
  lastN = 24
): { label: string; value: number }[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.flatMap((r) => {
    if (typeof r.sipAum !== "number" || typeof r.totalAum !== "number") {
      return [];
    }
    if (r.totalAum <= 0) return [];
    return [{ label: r.month, value: (r.sipAum / r.totalAum) * 100 }];
  });
}
