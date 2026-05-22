/**
 * Data adapters for the six "hero" exhibits defined in Phase 3 of the
 * design-language roadmap. Each adapter pulls from the existing
 * snapshot accessors, applies whatever shaping the exhibit needs
 * (fiscal-year rollup, post-gap window selection, Top-N over the
 * AMC universe), and returns a clean shape ready for StackedBarCombo
 * — plus an honest `availability` field the page renderer uses to
 * decide between a fully-data-backed exhibit and an empty / partial
 * state.
 *
 * INVARIANT: never synthesise values. If a month / quarter is absent
 * from the underlying snapshot, drop it; never zero-fill, never
 * interpolate.
 */
import { amfiMonthlyRows } from "./amfi-monthly";
import { marketIndexRows } from "./market-indices";
import {
  allAmcAaumRowsForQuarter,
  fiscalLabelFromCalendarQuarter,
} from "./amc-peer-universe";
import { amcAaumQuarterlySnapshot } from "./source";
import { fyLabel, monthToFy, monthsToFySum } from "@/lib/fiscal";
import { formatMonthLabel } from "@/lib/format";

const NIFTY_500 = "NIFTY_500";

interface ExhibitAvailability {
  /** True when the exhibit has enough data to render its primary
   *  series. False when the underlying snapshot is empty or missing
   *  the load-bearing field. */
  hasData: boolean;
  /** Short, user-facing note shown under the chart explaining what
   *  the rendered window covers and what's missing (if anything). */
  note: string;
}

interface FyEndRow {
  fy: number;
  month: string;
  row: ReturnType<typeof amfiMonthlyRows>[number];
}

function collectFyEndRows(): FyEndRow[] {
  const byFy = new Map<number, FyEndRow>();
  for (const r of amfiMonthlyRows()) {
    const fy = monthToFy(r.month);
    if (!Number.isFinite(fy)) continue;
    const existing = byFy.get(fy);
    if (!existing || r.month > existing.month) {
      byFy.set(fy, { fy, month: r.month, row: r });
    }
  }
  return Array.from(byFy.values()).sort((a, b) => a.fy - b.fy);
}

function isFyEndMarch(row: FyEndRow): boolean {
  return row.month.endsWith("-03");
}

// ---------------------------------------------------------------------
// Exhibit 1 — Passive share (Archetype B)
// ---------------------------------------------------------------------

export interface PassiveSharePoint {
  label: string;
  fy: number;
  bottom: number;
  top: number;
  line: number;
}

export interface PassiveShareExhibit {
  data: PassiveSharePoint[];
  availability: ExhibitAvailability;
  latestMonth: string | null;
}

export function passiveShareExhibit(): PassiveShareExhibit {
  const fyRows = collectFyEndRows().filter(isFyEndMarch);
  const points: PassiveSharePoint[] = [];
  let latestMonth: string | null = null;
  for (const { fy, month, row } of fyRows) {
    const active = row.activeEquityAaum ?? row.activeEquityAum;
    const passive = row.etfIndexAaum ?? row.etfIndexAum;
    if (
      typeof active !== "number" ||
      typeof passive !== "number" ||
      !Number.isFinite(active) ||
      !Number.isFinite(passive)
    ) {
      continue;
    }
    const envelope = active + passive;
    if (envelope <= 0) continue;
    points.push({
      label: fyLabel(fy),
      fy,
      bottom: active,
      top: passive,
      line: (passive / envelope) * 100,
    });
    latestMonth = month;
  }
  return {
    data: points,
    availability: {
      hasData: points.length >= 2,
      note: gapNote(points.length, fyRows.length),
    },
    latestMonth,
  };
}

// ---------------------------------------------------------------------
// Exhibit 2 — SIP flows vs NIFTY 500 (Archetype D)
// ---------------------------------------------------------------------

export interface SipFlowsPoint {
  label: string;
  bar: number;
  index: number;
}

export interface SipFlowsExhibit {
  data: SipFlowsPoint[];
  availability: ExhibitAvailability;
  windowStart: string | null;
  windowEnd: string | null;
}

export function sipFlowsVsNiftyExhibit(): SipFlowsExhibit {
  const amfi = amfiMonthlyRows();
  const nifty = marketIndexRows(NIFTY_500);
  const niftyByMonth = new Map(nifty.map((r) => [r.month, r.level]));

  const continuousMonths = pickContinuousTail(
    amfi
      .filter(
        (r) => typeof r.sipContribution === "number" && niftyByMonth.has(r.month)
      )
      .map((r) => r.month)
  );
  const monthSet = new Set(continuousMonths);

  const rowsInWindow = amfi
    .filter((r) => monthSet.has(r.month))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (rowsInWindow.length === 0) {
    return {
      data: [],
      availability: { hasData: false, note: "SIP / NIFTY data not available." },
      windowStart: null,
      windowEnd: null,
    };
  }
  const baseLevel = niftyByMonth.get(rowsInWindow[0].month) ?? null;
  if (!baseLevel) {
    return {
      data: [],
      availability: { hasData: false, note: "Unable to rebase NIFTY 500." },
      windowStart: rowsInWindow[0].month,
      windowEnd: rowsInWindow[rowsInWindow.length - 1].month,
    };
  }
  const points: SipFlowsPoint[] = rowsInWindow.map((r) => ({
    label: formatMonthLabel(r.month),
    bar: r.sipContribution as number,
    index: ((niftyByMonth.get(r.month) as number) / baseLevel) * 100,
  }));
  return {
    data: points,
    availability: {
      hasData: points.length >= 6,
      note: windowNote(rowsInWindow[0].month, rowsInWindow[rowsInWindow.length - 1].month),
    },
    windowStart: rowsInWindow[0].month,
    windowEnd: rowsInWindow[rowsInWindow.length - 1].month,
  };
}

// ---------------------------------------------------------------------
// Exhibit 3 — SIP AUM + SIP share of equity AUM (Archetype C)
// ---------------------------------------------------------------------

export interface SipAumPoint {
  label: string;
  fy: number;
  bottom: number;
  line: number;
}

export interface SipAumExhibit {
  data: SipAumPoint[];
  availability: ExhibitAvailability;
}

export function sipAumStickinessExhibit(): SipAumExhibit {
  const fyRows = collectFyEndRows().filter(isFyEndMarch);
  const points: SipAumPoint[] = [];
  for (const { fy, row } of fyRows) {
    const sip = row.sipAum;
    const equity = row.equityAum;
    if (typeof sip !== "number" || typeof equity !== "number") continue;
    if (sip <= 0 || equity <= 0) continue;
    points.push({
      label: fyLabel(fy),
      fy,
      bottom: sip,
      line: (sip / equity) * 100,
    });
  }
  return {
    data: points,
    availability: {
      hasData: points.length >= 2,
      note: gapNote(points.length, fyRows.length),
    },
  };
}

// ---------------------------------------------------------------------
// Exhibit 4 — Top-N AMC concentration basis QAAUM (Archetype A)
// ---------------------------------------------------------------------

export interface TopNAmcPoint {
  label: string;
  bottom: number; // Top 5 share %
  top: number; // 6-10 share %
}

export interface TopNAmcExhibit {
  data: TopNAmcPoint[];
  /** Either 10 (true Top 10) or the largest N supported by the
   *  data. The card title is computed from this so the label is
   *  honest. */
  n: number;
  totalAmcCountLatest: number;
  availability: ExhibitAvailability;
}

export function topNAmcConcentrationExhibit(): TopNAmcExhibit {
  const quarters = Array.from(
    new Set(
      amcAaumQuarterlySnapshot.rows
        .filter((r) => r.status === "ok")
        .map((r) => r.quarter)
    )
  ).sort();
  if (quarters.length === 0) {
    return {
      data: [],
      n: 0,
      totalAmcCountLatest: 0,
      availability: { hasData: false, note: "AMC AAUM disclosures not ingested." },
    };
  }
  const latestQuarter = quarters[quarters.length - 1];
  const latestRows = allAmcAaumRowsForQuarter(latestQuarter);
  const totalAmcCountLatest = latestRows.length;
  const n = totalAmcCountLatest >= 10 ? 10 : Math.min(7, totalAmcCountLatest);
  if (n < 5) {
    return {
      data: [],
      n,
      totalAmcCountLatest,
      availability: {
        hasData: false,
        note: `Only ${totalAmcCountLatest} AMC(s) in latest disclosure — too few to render a top-N stack.`,
      },
    };
  }
  const points: TopNAmcPoint[] = quarters.map((q) => {
    const rows = allAmcAaumRowsForQuarter(q);
    const total = rows.reduce((acc, r) => acc + r.avgAum, 0);
    if (total <= 0) return { label: fiscalLabelFromCalendarQuarter(q), bottom: 0, top: 0 };
    const sortedAum = rows.map((r) => r.avgAum);
    const top5 = sortedAum.slice(0, 5).reduce((acc, v) => acc + v, 0);
    const topN = sortedAum.slice(0, n).reduce((acc, v) => acc + v, 0);
    return {
      label: fiscalLabelFromCalendarQuarter(q),
      bottom: (top5 / total) * 100,
      top: ((topN - top5) / total) * 100,
    };
  });
  return {
    data: points,
    n,
    totalAmcCountLatest,
    availability: {
      hasData: points.length >= 2,
      note: `${quarters.length} quarter(s) ingested (${fiscalLabelFromCalendarQuarter(
        quarters[0]
      )} – ${fiscalLabelFromCalendarQuarter(latestQuarter)}). Top ${n} of ${totalAmcCountLatest} AMCs.`,
    },
  };
}

// ---------------------------------------------------------------------
// Exhibit 5 — NFO mobilisation vs industry flows (Archetype C)
// ---------------------------------------------------------------------

export interface NfoMobilisationPoint {
  label: string;
  fy: number;
  bottom: number;
  line: number;
}

export interface NfoMobilisationExhibit {
  data: NfoMobilisationPoint[];
  availability: ExhibitAvailability;
}

/**
 * Implausibly large NFO share (NFO mobilised exceeding total net
 * inflow by 10x or more). The AMFI Monthly Report's "New Schemes"
 * page is parsed by an extractor that sometimes mis-reads scheme-
 * count columns as funds-mobilised columns for older vintages; the
 * resulting fiscal year sum can land in the hundreds of millions of
 * ₹ Cr. Skipping anomalous FYs is the honest move — we surface what
 * was filtered in the source caption rather than render a meaningless
 * line value. */
const NFO_SHARE_PLAUSIBLE_MAX_PCT = 200;

export function nfoMobilisationExhibit(): NfoMobilisationExhibit {
  const rows = amfiMonthlyRows();
  const nfoByFy = monthsToFySum(rows, "month", "industryNfoFundsMobilized");
  const flowByFy = monthsToFySum(rows, "month", "netInflow");
  const flowMap = new Map(flowByFy.map((r) => [r.fy, r]));
  const points: NfoMobilisationPoint[] = [];
  const skipped: number[] = [];
  for (const nfo of nfoByFy) {
    if (nfo.months < 12) continue;
    const matchingFlow = flowMap.get(nfo.fy);
    if (!matchingFlow || matchingFlow.months < 12) continue;
    if (matchingFlow.value <= 0) continue;
    const sharePct = (nfo.value / matchingFlow.value) * 100;
    if (sharePct > NFO_SHARE_PLAUSIBLE_MAX_PCT) {
      skipped.push(nfo.fy);
      continue;
    }
    points.push({
      label: fyLabel(nfo.fy),
      fy: nfo.fy,
      bottom: nfo.value,
      line: sharePct,
    });
  }
  let note: string;
  if (points.length === 0) {
    note = "No fiscal year has full 12-month NFO + net-flow coverage yet.";
  } else {
    note = `${points.length} full fiscal year(s) of coverage.`;
    if (skipped.length > 0) {
      note += ` Excluded as upstream extraction anomalies: ${skipped
        .map(fyLabel)
        .join(", ")}.`;
    }
  }
  return {
    data: points,
    availability: { hasData: points.length >= 2, note },
  };
}

// ---------------------------------------------------------------------
// Exhibit 6 — Active equity flow vs NIFTY 500 (Archetype D)
// ---------------------------------------------------------------------

export interface ActiveEquityFlowPoint {
  label: string;
  bar: number;
  index: number;
}

export interface ActiveEquityFlowExhibit {
  data: ActiveEquityFlowPoint[];
  availability: ExhibitAvailability;
  windowStart: string | null;
  windowEnd: string | null;
}

export function activeEquityFlowVsNiftyExhibit(): ActiveEquityFlowExhibit {
  const amfi = amfiMonthlyRows();
  const nifty = marketIndexRows(NIFTY_500);
  const niftyByMonth = new Map(nifty.map((r) => [r.month, r.level]));
  const continuousMonths = pickContinuousTail(
    amfi
      .filter(
        (r) =>
          typeof r.activeEquityNetInflow === "number" &&
          niftyByMonth.has(r.month)
      )
      .map((r) => r.month)
  );
  const monthSet = new Set(continuousMonths);
  const rowsInWindow = amfi
    .filter((r) => monthSet.has(r.month))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (rowsInWindow.length === 0) {
    return {
      data: [],
      availability: {
        hasData: false,
        note: "Active equity net-flow series not yet ingested for the post-gap window.",
      },
      windowStart: null,
      windowEnd: null,
    };
  }
  const baseLevel = niftyByMonth.get(rowsInWindow[0].month);
  if (typeof baseLevel !== "number") {
    return {
      data: [],
      availability: { hasData: false, note: "Unable to rebase NIFTY 500." },
      windowStart: rowsInWindow[0].month,
      windowEnd: rowsInWindow[rowsInWindow.length - 1].month,
    };
  }
  const points: ActiveEquityFlowPoint[] = rowsInWindow.map((r) => ({
    label: formatMonthLabel(r.month),
    bar: r.activeEquityNetInflow as number,
    index: ((niftyByMonth.get(r.month) as number) / baseLevel) * 100,
  }));
  return {
    data: points,
    availability: {
      hasData: points.length >= 6,
      note: windowNote(rowsInWindow[0].month, rowsInWindow[rowsInWindow.length - 1].month),
    },
    windowStart: rowsInWindow[0].month,
    windowEnd: rowsInWindow[rowsInWindow.length - 1].month,
  };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Given a list of months present in the underlying snapshot (already
 * sorted ascending), returns the longest CONTIGUOUS tail of months
 * with no gaps. Used by the Archetype-D exhibits so the monthly time
 * series only shows the current continuous window — never bridges
 * across the AMFI 23-month gap with an interpolated line.
 */
function pickContinuousTail(months: string[]): string[] {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  let start = 0;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (!isAdjacentMonth(sorted[i - 1], sorted[i])) {
      start = i;
      break;
    }
  }
  return sorted.slice(start);
}

function isAdjacentMonth(a: string, b: string): boolean {
  const [aY, aM] = a.split("-").map(Number);
  const [bY, bM] = b.split("-").map(Number);
  if (!Number.isFinite(aY) || !Number.isFinite(aM) || !Number.isFinite(bY) || !Number.isFinite(bM)) {
    return false;
  }
  const diff = (bY - aY) * 12 + (bM - aM);
  return diff === 1;
}

function gapNote(pointCount: number, fyEndCount: number): string {
  if (pointCount === 0) return "No fiscal year has the required data.";
  if (pointCount === fyEndCount) return `${pointCount} fiscal year(s) of continuous coverage.`;
  return `${pointCount} of ${fyEndCount} fiscal year-ends with data (gaps skipped, never interpolated).`;
}

function windowNote(start: string, end: string): string {
  return `Window: ${start} → ${end} (continuous; gap months upstream are excluded).`;
}
