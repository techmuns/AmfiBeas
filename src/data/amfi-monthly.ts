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
import { formatPercentile } from "@/lib/format";

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
 * Unified historical context for a KPI field. Used by every `KpiCard`
 * on `/monthly` to surface a sparkline + YoY% + percentile + a Δ-pp
 * directional tone without each call site reimplementing the lookup.
 *
 *   - sparkline      : trailing-`lastN` { label, value } series (drops
 *                      months where the field is missing — same shape
 *                      `<Sparkline />` consumes).
 *   - latest         : the most recent value (null when no value).
 *   - yoyPct         : % change vs same calendar month last year, or
 *                      null when the comparison row is missing or
 *                      yearAgo ≤ 0 (sign undefined).
 *   - percentile     : rank of `latest` against the FULL field history
 *                      using `≤` semantics, in %.
 *   - zScore         : (latest − mean) / population stdDev across the
 *                      full field history. Null when stdDev is null.
 */
export interface KpiContext {
  latest: number | null;
  latestMonth: string | null;
  sparkline: { label: string; value: number }[];
  yoyPct: number | null;
  percentile: number | null;
  zScore: number | null;
}

export function kpiContext(
  field: AmfiMonthlyKpiField,
  lastN = 24,
  asOfMonth?: string
): KpiContext {
  const rows = amfiMonthlyRows();
  const series = rows
    .filter((r) => typeof r[field] === "number")
    .map((r) => ({ month: r.month, value: r[field] as number }));
  if (series.length === 0) {
    return {
      latest: null,
      latestMonth: null,
      sparkline: [],
      yoyPct: null,
      percentile: null,
      zScore: null,
    };
  }
  // Anchor = caller-selected month when present, else the most recent row.
  // YoY / percentile / z-score / sparkline window all key off the anchor so
  // the snapshot card stays in sync when the user picks a non-latest month.
  // If the requested month isn't in the series for this field, fall back to
  // latest so cards never go blank.
  const anchorIdx = asOfMonth
    ? series.findIndex((p) => p.month === asOfMonth)
    : -1;
  const anchorPos = anchorIdx >= 0 ? anchorIdx : series.length - 1;
  const anchor = series[anchorPos];
  const sparkline = series.slice(Math.max(0, anchorPos - lastN + 1), anchorPos + 1).map((p) => ({
    label: p.month,
    value: p.value,
  }));
  const yearAgoMonth = (() => {
    const [y, m] = anchor.month.split("-").map(Number);
    return `${y - 1}-${String(m).padStart(2, "0")}`;
  })();
  const yearAgoRow = series.find((p) => p.month === yearAgoMonth);
  const yoyPct =
    yearAgoRow && yearAgoRow.value !== 0
      ? ((anchor.value - yearAgoRow.value) / Math.abs(yearAgoRow.value)) * 100
      : null;
  const values = series.map((p) => p.value);
  const stats = historicalSignalStats(values, anchor.value);
  return {
    latest: anchor.value,
    latestMonth: anchor.month,
    sparkline,
    yoyPct,
    percentile: stats.percentileRank,
    zScore: stats.zScore,
  };
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

export interface ActiveEquityBridgeSnapshot {
  startMonth: string;
  endMonth: string;
  windowMonths: number;
  openingAum: number;
  closingAum: number;
  netInflowTotal: number;
  marketResidualTotal: number;
  /** Monthly ΔAUM series (closing − previous closing) across the
   *  window — used for the temporal sparkline under the BridgeStrip. */
  deltaSparkline: { label: string; value: number }[];
}

/**
 * Aggregated Active-Equity AUM bridge over the most recent
 * `windowMonths`. Returns the opening / closing AUM, the cumulative
 * net flow and market residual across the window, and a monthly
 * ΔAUM series for the BridgeStrip sparkline.
 *
 * Identity: closingAum − openingAum ≈ netInflowTotal + marketResidualTotal
 * (drift only from reclassifications captured in the monthly residual).
 */
export function activeEquityAumBridgeSnapshot(
  windowMonths = 12
): ActiveEquityBridgeSnapshot | null {
  const rows = amfiMonthlyRows().filter(
    (r) => typeof r.activeEquityAum === "number"
  );
  if (rows.length < 2) return null;

  // Take windowMonths + 1 rows so the bridge spans `windowMonths`
  // month-end-to-month-end transitions.
  const tail = rows.slice(-(windowMonths + 1));
  if (tail.length < 2) return null;

  const startRow = tail[0];
  const endRow = tail[tail.length - 1];

  let netInflowTotal = 0;
  let marketResidualTotal = 0;
  const deltaSparkline: { label: string; value: number }[] = [];
  for (let i = 1; i < tail.length; i++) {
    const cur = tail[i];
    const prev = tail[i - 1];
    if (typeof cur.activeEquityNetInflow !== "number") continue;
    const delta = (cur.activeEquityAum as number) - (prev.activeEquityAum as number);
    netInflowTotal += cur.activeEquityNetInflow;
    marketResidualTotal += delta - cur.activeEquityNetInflow;
    deltaSparkline.push({ label: cur.month, value: delta });
  }

  return {
    startMonth: startRow.month,
    endMonth: endRow.month,
    windowMonths: tail.length - 1,
    openingAum: startRow.activeEquityAum as number,
    closingAum: endRow.activeEquityAum as number,
    netInflowTotal,
    marketResidualTotal,
    deltaSparkline,
  };
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

/**
 * IIFL Figure 6-style series: per-month SIP gross contribution alongside
 * SIP's share of the equity-channel inflow envelope.
 *
 * The AMFI Monthly Report does not surface a clean per-month equity
 * gross-subscription number — that requires the gross subscribe and
 * repurchase columns from the Monthly Press Release, which the
 * extractor does not currently pull. We approximate the equity-channel
 * flow envelope by FLOW MAGNITUDE:
 *
 *   equityFlowProxy = sipContribution + |activeEquityNetInflow|
 *
 * Taking the absolute value keeps the share well-behaved in net-outflow
 * months: SIP is measured against total active-equity flow throughput,
 * so heavy-redemption months read as a LOWER SIP share instead of
 * collapsing the denominator to SIP alone and pegging the line at a
 * misleading 100%. The share therefore stays within [0,100] and
 * normalises smoothly across the whole window rather than spiking to
 * the ceiling.
 *
 * The resulting share tracks the underlying STRUCTURAL trend the chart
 * is meant to surface: SIP's rising contribution to the industry's
 * equity flow. Rows missing either field are dropped from the share
 * series; the bars still render whenever sipContribution is present.
 */
export interface SipGrossSharePoint {
  month: string;
  /** SIP gross monthly contribution, ₹ Cr. */
  sipContribution: number | null;
  /** SIP contribution as a % of the equity-channel flow proxy (by magnitude). */
  sipShareOfGrossPct: number | null;
}

export function monthlySipGrossShareTrend(
  lastN = 84
): SipGrossSharePoint[] {
  const rows = amfiMonthlyRows().slice(-lastN);
  return rows.map((r) => {
    const sip = typeof r.sipContribution === "number" ? r.sipContribution : null;
    const ae =
      typeof r.activeEquityNetInflow === "number"
        ? r.activeEquityNetInflow
        : null;
    let share: number | null = null;
    if (sip !== null && ae !== null) {
      const proxy = sip + Math.abs(ae);
      if (proxy > 0) share = (sip / proxy) * 100;
    }
    return {
      month: r.month,
      sipContribution: sip,
      sipShareOfGrossPct: share,
    };
  });
}

// =============================================================
// Industry flow-decomposition waterfall (12-month bridge)
// =============================================================

export interface FlowWaterfallStep {
  key: "openingAum" | "sipContribution" | "lumpSum" | "marketImpact" | "closingAum";
  label: string;
  value: number;          // ₹ Cr
  cumulative: number;     // ₹ Cr — running total of the bridge
  delta: number;          // ₹ Cr — signed magnitude (positive for adds; opening/closing reuse value)
  type: "total" | "up" | "down";
}

export interface FlowWaterfall {
  startMonth: string;
  endMonth: string;
  windowMonths: number;
  steps: FlowWaterfallStep[];
  /** Sum of SIP contribution + lump sum (industry net flow) over the
   *  window. Equal to `closingAum − openingAum − marketImpact`. */
  netFlowTotal: number;
}

/**
 * Industry AUM bridge over the most recent `windowMonths` (default
 * 12). Decomposes the change in `totalAum` into:
 *
 *   SIP contribution   = Σ sipContribution_m              (₹ Cr, positive)
 *   Lump sum / other   = Σ netInflow_m − Σ sipContribution_m
 *                        (the residual flow component; signed —
 *                        equity outflows + debt inflows still net
 *                        to industry netInflow)
 *   Market / residual  = (totalAum_end − totalAum_start) − Σ netInflow_m
 *                        (mark-to-market + minor reclassification)
 *
 * Returns `null` when the snapshot doesn't carry both bookend
 * `totalAum` rows OR when fewer than `windowMonths` months exist
 * with `sipContribution` + `netInflow` — we avoid a partial-window
 * bridge that would mis-state the contribution split.
 */
export function industryFlowWaterfall(
  windowMonths = 12
): FlowWaterfall | null {
  const rows = amfiMonthlyRows();
  if (rows.length < windowMonths + 1) return null;
  const endRow = rows[rows.length - 1];
  const startRow = rows[rows.length - 1 - windowMonths];
  if (typeof endRow.totalAum !== "number") return null;
  if (typeof startRow.totalAum !== "number") return null;

  const window = rows.slice(rows.length - windowMonths);
  let sipSum = 0;
  let netFlowSum = 0;
  for (const r of window) {
    if (typeof r.sipContribution === "number") sipSum += r.sipContribution;
    if (typeof r.netInflow === "number") netFlowSum += r.netInflow;
  }
  const lumpSum = netFlowSum - sipSum;
  const marketImpact = endRow.totalAum - startRow.totalAum - netFlowSum;

  const opening = startRow.totalAum;
  const afterSip = opening + sipSum;
  const afterLump = afterSip + lumpSum;
  const afterMarket = afterLump + marketImpact;

  const steps: FlowWaterfallStep[] = [
    {
      key: "openingAum",
      label: `Opening AUM (${startRow.month})`,
      value: opening,
      cumulative: opening,
      delta: opening,
      type: "total",
    },
    {
      key: "sipContribution",
      label: "SIP contributions",
      value: sipSum,
      cumulative: afterSip,
      delta: sipSum,
      type: sipSum >= 0 ? "up" : "down",
    },
    {
      key: "lumpSum",
      label: "Lump sum / other flows",
      value: lumpSum,
      cumulative: afterLump,
      delta: lumpSum,
      type: lumpSum >= 0 ? "up" : "down",
    },
    {
      key: "marketImpact",
      label: "Market / residual impact",
      value: marketImpact,
      cumulative: afterMarket,
      delta: marketImpact,
      type: marketImpact >= 0 ? "up" : "down",
    },
    {
      key: "closingAum",
      label: `Closing AUM (${endRow.month})`,
      value: endRow.totalAum,
      cumulative: endRow.totalAum,
      delta: endRow.totalAum,
      type: "total",
    },
  ];

  return {
    startMonth: startRow.month,
    endMonth: endRow.month,
    windowMonths,
    steps,
    netFlowTotal: netFlowSum,
  };
}

// =============================================================
// Active vs Passive monthly trend (+ simple linear forecast)
// =============================================================

export interface ActivePassivePoint {
  month: string;
  activeEquityAum: number;
  etfIndexAum: number;
  passiveSharePct: number;   // etf+index / (active + etf+index) × 100
}

export interface ActivePassiveForecastPoint {
  month: string;
  passiveSharePct: number;
  /** Numeric index signature so the type is assignable to
   *  `Record<string, string | number | null>` used by MultiLine.
   *  `forecast` was previously a boolean flag but is omitted from
   *  this type — callers can detect forecast points by month-string
   *  comparison against `history` if dashed-styling is needed. */
  [key: string]: string | number | null;
}

export interface ActivePassiveTrend {
  history: ActivePassivePoint[];
  /** Combined history + forecast points for charting. Forecast
   *  rows carry `forecast=true` so the renderer can dash the
   *  extrapolated portion. */
  share: ActivePassiveForecastPoint[];
  /** Last historical share %; useful for KPI display. */
  latestSharePct: number;
  /** OLS slope over the historical window (percentage-points per
   *  month). Positive = passive gaining share. */
  trendSlopePctPerMonth: number;
  /** Number of months extrapolated. 0 when fewer than 6 historical
   *  points exist (slope too noisy). */
  forecastMonths: number;
  /** End-of-FY (Mar) projection from the latest historical point.
   *  Null when extrapolation is suppressed. */
  endOfFyProjectionPct: number | null;
}

/**
 * Active equity AUM vs ETF & Index AUM over the most recent
 * `historyMonths` months, with a simple linear (OLS) forecast of
 * the passive-share line out to the next fiscal-year end.
 *
 *   passiveSharePct = etfIndexAum / (activeEquityAum + etfIndexAum) × 100
 *
 * Rows where either field is missing are skipped — no fake zeros.
 * Forecast suppressed when fewer than 6 historical points exist
 * (slope unstable).
 */
export function monthlyActivePassiveTrend(
  historyMonths = 24
): ActivePassiveTrend | null {
  const rows = amfiMonthlyRows().slice(-historyMonths);
  const history: ActivePassivePoint[] = [];
  for (const r of rows) {
    if (
      typeof r.activeEquityAum !== "number" ||
      typeof r.etfIndexAum !== "number"
    ) {
      continue;
    }
    const denom = r.activeEquityAum + r.etfIndexAum;
    if (denom <= 0) continue;
    history.push({
      month: r.month,
      activeEquityAum: r.activeEquityAum,
      etfIndexAum: r.etfIndexAum,
      passiveSharePct: (r.etfIndexAum / denom) * 100,
    });
  }
  if (history.length === 0) return null;

  // OLS slope on (monthIndex, passiveSharePct). monthIndex is the
  // 0-based position within `history`, so the slope is in
  // %-points-per-month.
  const n = history.length;
  const xs = history.map((_, i) => i);
  const ys = history.map((h) => h.passiveSharePct);
  const xBar = xs.reduce((s, v) => s + v, 0) / n;
  const yBar = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xBar) * (ys[i] - yBar);
    den += (xs[i] - xBar) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yBar - slope * xBar;

  // Forecast horizon: from the latest historical month out to the
  // next FY-end (March of the next fiscal-year boundary). For a
  // history ending in Mar-2026 we extend to Mar-2027.
  const last = history[history.length - 1];
  let forecastMonths = 0;
  let endOfFy: number | null = null;
  const shareSeries: ActivePassiveForecastPoint[] = history.map((h) => ({
    month: h.month,
    passiveSharePct: h.passiveSharePct,
  }));

  if (history.length >= 6) {
    const [yyyy, mm] = last.month.split("-").map((s) => parseInt(s, 10));
    // Next FY end: the upcoming March-31. If the current month is
    // before March of the current calendar year, target this March;
    // otherwise target next March.
    let targetYear = yyyy;
    if (mm >= 3) targetYear = yyyy + 1;
    const targetMonth = 3;
    let cy = yyyy;
    let cm = mm;
    while (cy < targetYear || (cy === targetYear && cm < targetMonth)) {
      cm += 1;
      if (cm > 12) {
        cm = 1;
        cy += 1;
      }
      forecastMonths += 1;
      const fcastIdx = history.length - 1 + forecastMonths;
      const fcastValue = intercept + slope * fcastIdx;
      const monthStr = `${cy}-${String(cm).padStart(2, "0")}`;
      shareSeries.push({
        month: monthStr,
        passiveSharePct: fcastValue,
      });
      if (cy === targetYear && cm === targetMonth) {
        endOfFy = fcastValue;
      }
    }
  }

  return {
    history,
    share: shareSeries,
    latestSharePct: last.passiveSharePct,
    trendSlopePctPerMonth: slope,
    forecastMonths,
    endOfFyProjectionPct: endOfFy,
  };
}

/**
 * Historical-context signal for the active-equity envelope net inflow.
 *
 * Compares the latest available month's `activeEquityNetInflow` against
 * the full available history (from April 2019 onwards on the current
 * snapshot). Surfaces five outputs the dashboard binds to the signal
 * card:
 *
 *   - latest          : month + value for the most recent observation
 *   - mean            : arithmetic mean of every prior month with a value
 *   - stdDev          : population standard deviation of the same set
 *   - zScore          : (latest − mean) / stdDev
 *   - percentileRank  : share of months ≤ latest, expressed in %
 *
 * Population (not sample) standard deviation is used to keep the
 * z-score stable when the history is small — the dashboard surfaces
 * "Insufficient history" when stdDev is zero or undefined, which
 * itself only happens if fewer than two data points exist.
 *
 * Returns null when the snapshot has no `activeEquityNetInflow` rows
 * at all, so the UI can short-circuit cleanly.
 */
export type ActiveEquitySignalLabel =
  | "Very strong"
  | "Strong"
  | "Normal"
  | "Weak"
  | "Very weak"
  | "Insufficient history";

export interface HistoricalSignalStats {
  /** Arithmetic mean of `values`. */
  mean: number;
  /** Population standard deviation (n divisor). Null when n < 2 or
   *  variance is zero — both cases would produce a divide-by-zero in
   *  the z-score. */
  stdDev: number | null;
  /** (latest − mean) / stdDev. Null when stdDev is null. */
  zScore: number | null;
  /** Share of observations with value ≤ latest, in %. Null when the
   *  series is empty. */
  percentileRank: number | null;
}

/** Generic historical-context stats for any monthly numeric series.
 *  Mean is arithmetic; standard deviation is population (n divisor)
 *  so a short series still produces a usable z-score. Percentile
 *  rank uses `≤` so ties give the latest observation credit. */
export function historicalSignalStats(
  values: number[],
  latest: number
): HistoricalSignalStats {
  const n = values.length;
  if (n === 0) {
    return { mean: latest, stdDev: null, zScore: null, percentileRank: null };
  }
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = n >= 2 && variance > 0 ? Math.sqrt(variance) : null;
  const zScore =
    stdDev !== null && Number.isFinite(stdDev) && stdDev > 0
      ? (latest - mean) / stdDev
      : null;
  const lessOrEqual = values.filter((v) => v <= latest).length;
  const percentileRank = (lessOrEqual / n) * 100;
  return { mean, stdDev, zScore, percentileRank };
}

/** Map a z-score to the standard 5-bucket label. */
export function zScoreLabel(z: number | null): ActiveEquitySignalLabel {
  if (z === null || !Number.isFinite(z)) return "Insufficient history";
  if (z >= 2) return "Very strong";
  if (z >= 1) return "Strong";
  if (z <= -2) return "Very weak";
  if (z <= -1) return "Weak";
  return "Normal";
}

export interface ActiveEquityNetInflowSignal {
  latestMonth: string;
  latestValue: number;
  historyMonths: number;
  mean: number;
  stdDev: number | null;
  zScore: number | null;
  percentileRank: number | null;
  label: ActiveEquitySignalLabel;
  historyStart: string;
  historyEnd: string;
}

export function activeEquityNetInflowSignal(): ActiveEquityNetInflowSignal | null {
  const rows = amfiMonthlyRows();
  const withValue = rows.flatMap((r) =>
    typeof r.activeEquityNetInflow === "number"
      ? [{ month: r.month, value: r.activeEquityNetInflow }]
      : []
  );
  if (withValue.length === 0) return null;
  const latest = withValue[withValue.length - 1];
  const values = withValue.map((p) => p.value);
  const stats = historicalSignalStats(values, latest.value);
  return {
    latestMonth: latest.month,
    latestValue: latest.value,
    historyMonths: values.length,
    mean: stats.mean,
    stdDev: stats.stdDev,
    zScore: stats.zScore,
    percentileRank: stats.percentileRank,
    label: zScoreLabel(stats.zScore),
    historyStart: withValue[0].month,
    historyEnd: latest.month,
  };
}

/** NFO Heat: z-score / percentile of latest `industryNfoFundsMobilized`. */
export interface NfoHeatSignal {
  latestMonth: string;
  latestValue: number;
  historyMonths: number;
  mean: number;
  stdDev: number | null;
  zScore: number | null;
  percentileRank: number | null;
  label: ActiveEquitySignalLabel;
  historyStart: string;
}

// Sanity cap on monthly industry NFO mobilization in ₹ Cr. India's
// largest single-month NFO mobilization on record is ~₹15-20K Cr; the
// 2019-era press-release ingestion stored a handful of months in
// pre-divided units (~88 million), which corrupt any mean / stdDev /
// percentile read built on the raw field. Rows above this cap are
// excluded from the statistical helpers below; the snapshot itself is
// untouched.
const NFO_MONTHLY_PLAUSIBLE_CAP_CR = 50_000;

export function nfoHeatSignal(): NfoHeatSignal | null {
  const rows = amfiMonthlyRows();
  const withValue = rows.flatMap((r) =>
    typeof r.industryNfoFundsMobilized === "number" &&
    r.industryNfoFundsMobilized <= NFO_MONTHLY_PLAUSIBLE_CAP_CR
      ? [{ month: r.month, value: r.industryNfoFundsMobilized }]
      : []
  );
  if (withValue.length === 0) return null;
  const latest = withValue[withValue.length - 1];
  const values = withValue.map((p) => p.value);
  const stats = historicalSignalStats(values, latest.value);
  return {
    latestMonth: latest.month,
    latestValue: latest.value,
    historyMonths: values.length,
    mean: stats.mean,
    stdDev: stats.stdDev,
    zScore: stats.zScore,
    percentileRank: stats.percentileRank,
    label: zScoreLabel(stats.zScore),
    historyStart: withValue[0].month,
  };
}

/** Passive Shift: latest passive share % vs history.
 *
 *   passiveShare = etfIndexAum ÷ (activeEquityAum + etfIndexAum) × 100
 *
 * Uses closing-balance AUM so the share is comparable across months.
 * Direction-aware label:
 *   - percentile ≥ 80 → "Passive gaining share"
 *   - percentile ≤ 20 → "Active-heavy"
 *   - else            → "Normal"
 */
export type PassiveShiftLabel =
  | "Passive gaining share"
  | "Active-heavy"
  | "Normal"
  | "Insufficient history";

export interface PassiveShiftSignal {
  latestMonth: string;
  latestSharePct: number;
  historyMonths: number;
  mean: number;
  stdDev: number | null;
  zScore: number | null;
  percentileRank: number | null;
  label: PassiveShiftLabel;
  historyStart: string;
}

export function passiveShiftSignal(): PassiveShiftSignal | null {
  const rows = amfiMonthlyRows();
  const series = rows.flatMap((r) => {
    if (
      typeof r.activeEquityAum !== "number" ||
      typeof r.etfIndexAum !== "number"
    ) {
      return [];
    }
    const denom = r.activeEquityAum + r.etfIndexAum;
    if (denom <= 0) return [];
    return [{ month: r.month, value: (r.etfIndexAum / denom) * 100 }];
  });
  if (series.length === 0) return null;
  const latest = series[series.length - 1];
  const values = series.map((p) => p.value);
  const stats = historicalSignalStats(values, latest.value);
  let label: PassiveShiftLabel = "Normal";
  if (stats.percentileRank === null) {
    label = "Insufficient history";
  } else if (stats.percentileRank >= 80) {
    label = "Passive gaining share";
  } else if (stats.percentileRank <= 20) {
    label = "Active-heavy";
  }
  return {
    latestMonth: latest.month,
    latestSharePct: latest.value,
    historyMonths: values.length,
    mean: stats.mean,
    stdDev: stats.stdDev,
    zScore: stats.zScore,
    percentileRank: stats.percentileRank,
    label,
    historyStart: series[0].month,
  };
}

/** SIP Stickiness: latest (sipAum ÷ totalAum) × 100 vs history.
 *  SIP press-release history is shorter than the AMFI Monthly Report
 *  history — `historyStart` lets the caller surface the limitation. */
export interface SipStickinessSignal {
  latestMonth: string;
  latestSharePct: number;
  historyMonths: number;
  mean: number;
  stdDev: number | null;
  zScore: number | null;
  percentileRank: number | null;
  label: ActiveEquitySignalLabel;
  historyStart: string;
}

export function sipStickinessSignal(): SipStickinessSignal | null {
  const rows = amfiMonthlyRows();
  const series = rows.flatMap((r) => {
    if (typeof r.sipAum !== "number" || typeof r.totalAum !== "number") {
      return [];
    }
    if (r.totalAum <= 0) return [];
    return [{ month: r.month, value: (r.sipAum / r.totalAum) * 100 }];
  });
  if (series.length === 0) return null;
  const latest = series[series.length - 1];
  const values = series.map((p) => p.value);
  const stats = historicalSignalStats(values, latest.value);
  return {
    latestMonth: latest.month,
    latestSharePct: latest.value,
    historyMonths: values.length,
    mean: stats.mean,
    stdDev: stats.stdDev,
    zScore: stats.zScore,
    percentileRank: stats.percentileRank,
    label: zScoreLabel(stats.zScore),
    historyStart: series[0].month,
  };
}

// -------- Sparkline series for Investor Signals tiles -------------------
//
// Each signal in the Investor Signals panel renders a 24-month sparkline
// at the foot of its tile so the latest reading is visible in context.
// The helpers below return a chronological { label, value } array — same
// shape the MultiLine chart consumes. Months without a value are
// dropped, not zero-filled.

export interface SparklinePoint {
  label: string;
  value: number;
}

/** Trailing 24-month series of active-equity net inflow (₹ Cr). */
export function activeEquityNetInflowSparkline(months = 24): SparklinePoint[] {
  return amfiMonthlyRows()
    .flatMap((r) =>
      typeof r.activeEquityNetInflow === "number"
        ? [{ label: r.month, value: r.activeEquityNetInflow }]
        : []
    )
    .slice(-months);
}

/** Trailing 24-month series of industry NFO funds mobilised (₹ Cr).
 *  Skips months where the stored value exceeds the plausible monthly
 *  cap — 2019-era ingestion has a handful of unit-bugged rows. */
export function nfoMobilisationSparkline(months = 24): SparklinePoint[] {
  return amfiMonthlyRows()
    .flatMap((r) =>
      typeof r.industryNfoFundsMobilized === "number" &&
      r.industryNfoFundsMobilized <= NFO_MONTHLY_PLAUSIBLE_CAP_CR
        ? [{ label: r.month, value: r.industryNfoFundsMobilized }]
        : []
    )
    .slice(-months);
}

/** Trailing 24-month series of passive share of equity AUM (%). */
export function passiveShareSparkline(months = 24): SparklinePoint[] {
  return amfiMonthlyRows()
    .flatMap((r) => {
      if (
        typeof r.activeEquityAum !== "number" ||
        typeof r.etfIndexAum !== "number"
      ) {
        return [];
      }
      const denom = r.activeEquityAum + r.etfIndexAum;
      if (denom <= 0) return [];
      return [{ label: r.month, value: (r.etfIndexAum / denom) * 100 }];
    })
    .slice(-months);
}

/** Trailing N-month series of SIP AUM ÷ Total AUM (%). Defaults to 24
 *  but the underlying SIP history is shorter; callers should treat the
 *  series as best-effort. */
export function sipStickinessSparkline(months = 24): SparklinePoint[] {
  return amfiMonthlyRows()
    .flatMap((r) => {
      if (typeof r.sipAum !== "number" || typeof r.totalAum !== "number") {
        return [];
      }
      if (r.totalAum <= 0) return [];
      return [{ label: r.month, value: (r.sipAum / r.totalAum) * 100 }];
    })
    .slice(-months);
}

// -------- Cycle Phase classifier ----------------------------------------
//
// Synthesises the five Investor Signals into a single human-readable
// "cycle phase" tag plus a 1-2 sentence English narrative. Rules are
// explicit so the InfoTooltip can surface them — this is NOT a model.
//
// Inputs (all optional — the classifier degrades gracefully when a
// signal is null):
//   - activeEquityZ      : z-score from activeEquityNetInflowSignal()
//   - nfoZ               : z-score from nfoHeatSignal()
//   - passivePercentile  : 0-100 percentile from passiveShiftSignal()
//   - drawdownPct        : latest Nifty 500 drawdown vs rolling peak
//
// Phase rules (evaluated in order):
//   - drawdown ≤ −10% AND flowZ ≥ 0      → "Recovery"        (buy-the-dip)
//   - drawdown ≤ −10% AND flowZ <  0     → "Correction"      (flow stress)
//   - drawdown >  −3% AND flowZ ≥ 1.5
//                       AND nfoZ ≥ 1.0   → "Peak"            (frothy)
//   - drawdown >  −3% AND flowZ ≥ 0      → "Expansion"
//   - drawdown ≤ −3% AND drawdown > −10% AND flowZ < 0
//                                        → "Base"
//   - else                                → "Expansion"
//
// The thresholds are documented in the tooltip; tweaking them is a
// trivial edit here.

export type CyclePhase =
  | "Expansion"
  | "Peak"
  | "Correction"
  | "Recovery"
  | "Base"
  | "Insufficient data";

export interface InvestorReadInput {
  activeEquityZ: number | null;
  activeEquityPercentile: number | null;
  nfoZ: number | null;
  passivePercentile: number | null;
  passiveLatestSharePct: number | null;
  sipPercentile: number | null;
  drawdownPct: number | null;
  marketMonth: string | null;
}

export interface InvestorRead {
  phase: CyclePhase;
  narrative: string;
  /** Plain-English breakdown of the rules used. Surfaced behind an
   *  InfoTooltip so the classifier never feels like a black box. */
  methodologyTooltip: string;
}

export function classifyPhase(input: InvestorReadInput): CyclePhase {
  const { activeEquityZ, nfoZ, drawdownPct } = input;
  if (activeEquityZ === null && drawdownPct === null) {
    return "Insufficient data";
  }
  const z = activeEquityZ ?? 0;
  const nfo = nfoZ ?? 0;
  const dd = drawdownPct ?? 0;
  if (dd <= -10 && z >= 0) return "Recovery";
  if (dd <= -10 && z < 0) return "Correction";
  if (dd > -3 && z >= 1.5 && nfo >= 1) return "Peak";
  if (dd > -3 && z >= 0) return "Expansion";
  if (dd <= -3 && dd > -10 && z < 0) return "Base";
  return "Expansion";
}

function describeFlowLevel(z: number | null, pct: number | null): string {
  if (z === null || pct === null) return "with limited flow history";
  if (z >= 2) return `with active-equity inflows running unusually high (${formatPercentile(pct).toLowerCase()})`;
  if (z >= 1) return `with active-equity inflows in the top ${(100 - pct).toFixed(0)}% of months`;
  if (z <= -2) return `with active-equity inflows running unusually low (${formatPercentile(pct).toLowerCase()})`;
  if (z <= -1) return `with active-equity inflows in the bottom ${pct.toFixed(0)}% of months`;
  return `with active-equity inflows close to the long-run average`;
}

function describeDrawdown(dd: number | null): string {
  if (dd === null) return "Market drawdown not available";
  if (dd >= -3) return `Nifty 500 is within ${Math.abs(dd).toFixed(1)}% of its all-time peak`;
  if (dd >= -10) return `Nifty 500 is ${Math.abs(dd).toFixed(1)}% off its peak`;
  return `Nifty 500 is in drawdown (${dd.toFixed(1)}% off its peak)`;
}

function describePassiveAndSip(input: InvestorReadInput): string {
  const parts: string[] = [];
  if (input.passivePercentile !== null && input.passiveLatestSharePct !== null) {
    if (input.passivePercentile >= 80) {
      parts.push(`passive share at ${input.passiveLatestSharePct.toFixed(1)}% (top quintile of history)`);
    } else if (input.passivePercentile <= 20) {
      parts.push(`passive share subdued at ${input.passiveLatestSharePct.toFixed(1)}%`);
    } else {
      parts.push(`passive share at ${input.passiveLatestSharePct.toFixed(1)}%`);
    }
  }
  if (input.sipPercentile !== null && input.sipPercentile >= 70) {
    parts.push("SIP base near recent highs");
  } else if (input.sipPercentile !== null && input.sipPercentile <= 30) {
    parts.push("SIP base near recent lows");
  }
  return parts.join("; ");
}

/** Build the Investor Read narrative + cycle phase from the panel
 *  signals. The narrative reads as a 1-2 sentence summary; the phase
 *  badge is the at-a-glance tag. */
export function investorRead(input: InvestorReadInput): InvestorRead {
  const phase = classifyPhase(input);
  const drawdownSentence = describeDrawdown(input.drawdownPct);
  const flowSentence = describeFlowLevel(
    input.activeEquityZ,
    input.activeEquityPercentile
  );
  const supplement = describePassiveAndSip(input);
  const narrative =
    phase === "Insufficient data"
      ? "Not enough overlapping AMFI + Nifty 500 history yet to build a cycle read."
      : `${drawdownSentence}, ${flowSentence}.` +
        (supplement ? ` ${capitalise(supplement)}.` : "");
  return {
    phase,
    narrative,
    methodologyTooltip:
      "Cycle phase is rule-based, not a model. Recovery: Nifty 500 drawdown ≤ −10% and active-equity flow z ≥ 0. Correction: drawdown ≤ −10% and flow z < 0. Peak: drawdown > −3% and flow z ≥ 1.5 and NFO z ≥ 1.0 (frothy). Expansion: drawdown > −3% and flow z ≥ 0. Base: drawdown between −3% and −10% with flow z < 0. Inputs from the existing Investor Signals panel; thresholds visible here.",
  };
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * NFO Drag Ratio trend.
 *
 *   ratio_m = industryNfoFundsMobilized_m  ÷  netInflow_m  × 100
 *
 * Answers "how much of the industry's net inflow this month was
 * absorbed by new fund launches?". A high ratio means new money is
 * being captured by NFOs rather than flowing to existing schemes —
 * historically a marker of frothy markets.
 *
 * Safety guards (denominator is fragile):
 *   - `netInflow` ≤ 0 → ratio undefined (industry outflow makes the
 *     concept meaningless). Returned as null.
 *   - `industryNfoFundsMobilized` missing → null.
 *   - Cap visible ratio at 200% to keep the chart bounded; clamping
 *     is purely a display-side limit, the underlying figure is
 *     preserved on the point.
 *
 * Returns null when no usable months exist.
 */
export interface NfoDragPoint {
  month: string;
  ratioPct: number;
  rawRatioPct: number;
  nfo: number;
  netInflow: number;
}

export interface NfoDragTrend {
  history: NfoDragPoint[];
  latestMonth: string;
  latestRatioPct: number;
  mean: number;
  percentile: number | null;
  /** True when the latest ratio is in the top quartile of the full
   *  available history — a small "NFO heavy" pill on the chart. */
  isHeavy: boolean;
}

const NFO_DRAG_DISPLAY_CAP_PCT = 200;
const NFO_HEAVY_PERCENTILE = 75;

export function nfoDragTrend(months = 24): NfoDragTrend | null {
  const all: NfoDragPoint[] = [];
  for (const r of amfiMonthlyRows()) {
    if (
      typeof r.industryNfoFundsMobilized !== "number" ||
      typeof r.netInflow !== "number" ||
      r.netInflow <= 0
    ) {
      continue;
    }
    // Skip rows where the NFO value exceeds the plausible monthly
    // cap — these are unit-bugged in the older ingestion and would
    // poison every downstream statistic.
    if (r.industryNfoFundsMobilized > NFO_MONTHLY_PLAUSIBLE_CAP_CR) continue;
    const raw = (r.industryNfoFundsMobilized / r.netInflow) * 100;
    all.push({
      month: r.month,
      ratioPct: Math.min(raw, NFO_DRAG_DISPLAY_CAP_PCT),
      rawRatioPct: raw,
      nfo: r.industryNfoFundsMobilized,
      netInflow: r.netInflow,
    });
  }
  if (all.length === 0) return null;
  const latest = all[all.length - 1];
  const ratios = all.map((p) => p.rawRatioPct);
  const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  const lessOrEqual = ratios.filter((v) => v <= latest.rawRatioPct).length;
  const percentile = (lessOrEqual / ratios.length) * 100;
  return {
    history: all.slice(-months),
    latestMonth: latest.month,
    latestRatioPct: latest.rawRatioPct,
    mean,
    percentile,
    isHeavy: percentile >= NFO_HEAVY_PERCENTILE,
  };
}

// ---- Per-section 1-line narrative reads -------------------------------
//
// Each section header gets an optional 1-sentence summary computed from
// the same kpiContext helpers the KPI cards already use. Output is a
// short, factual English sentence — never speculative, never multi-line.
// Returns null when the section's primary inputs are missing.

function percentileLabel(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const r = Math.round(pct);
  // Inline ordinal suffix — avoids a cross-module import for this
  // tiny formatting helper.
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

function yoyLabel(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% YoY`;
}

/** "AMFI Monthly Snapshot" 1-liner: Total AAUM YoY + Net Inflow
 *  percentile context. */
export function snapshotSectionRead(): string | null {
  const aaum = kpiContext("totalAaum");
  const flow = kpiContext("netInflow");
  if (aaum.latest === null && flow.latest === null) return null;
  const parts: string[] = [];
  if (aaum.yoyPct !== null) {
    parts.push(`Total AAUM ${yoyLabel(aaum.yoyPct)}`);
  }
  if (flow.percentile !== null) {
    parts.push(`Net inflow ${percentileLabel(flow.percentile)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "SIP Trends" 1-liner: SIP contribution + SIP AUM percentile reads. */
export function sipTrendsSectionRead(): string | null {
  const contrib = kpiContext("sipContribution");
  const sipAum = kpiContext("sipAum");
  const parts: string[] = [];
  if (contrib.yoyPct !== null && contrib.percentile !== null) {
    parts.push(
      `SIP contribution ${yoyLabel(contrib.yoyPct)} · ${percentileLabel(contrib.percentile)}`
    );
  }
  if (sipAum.yoyPct !== null) {
    parts.push(`SIP AUM ${yoyLabel(sipAum.yoyPct)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Monthly Flows" 1-liner: equity / debt percentiles. Risk-on vs
 *  risk-off cue based on relative percentile of equity to debt. */
export function monthlyFlowsSectionRead(): string | null {
  const equity = kpiContext("equityNetInflow");
  const debt = kpiContext("debtNetInflow");
  if (equity.percentile === null && debt.percentile === null) return null;
  const parts: string[] = [];
  if (equity.percentile !== null) {
    parts.push(`Equity flow ${percentileLabel(equity.percentile)}`);
  }
  if (debt.percentile !== null) {
    parts.push(`Debt flow ${percentileLabel(debt.percentile)}`);
  }
  if (equity.percentile !== null && debt.percentile !== null) {
    const cue =
      equity.percentile >= 60 && debt.percentile <= 40
        ? "risk-on"
        : equity.percentile <= 40 && debt.percentile >= 60
          ? "risk-off"
          : "mixed";
    parts.push(cue);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Industry Folios & NFO" 1-liner: folio growth + NFO percentile. */
export function foliosNfoSectionRead(): string | null {
  const folios = kpiContext("industryFolios");
  const nfo = kpiContext("industryNfoFundsMobilized");
  const parts: string[] = [];
  if (folios.yoyPct !== null) parts.push(`Folios ${yoyLabel(folios.yoyPct)}`);
  if (nfo.percentile !== null) parts.push(`NFO ${percentileLabel(nfo.percentile)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Active Equity & Equity Mix" 1-liner: active-equity share of AAUM. */
export function activeEquityMixSectionRead(): string | null {
  const ae = kpiContext("activeEquityAaum");
  const ttl = kpiContext("totalAaum");
  if (ae.latest === null || ttl.latest === null || ttl.latest <= 0) return null;
  const share = (ae.latest / ttl.latest) * 100;
  const parts: string[] = [
    `Active-equity share ${share.toFixed(1)}% of AAUM`,
  ];
  if (ae.yoyPct !== null) parts.push(`Active AAUM ${yoyLabel(ae.yoyPct)}`);
  return parts.join(" · ");
}
