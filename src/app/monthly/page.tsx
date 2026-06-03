import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import {
  adaptiveAverageOverlay,
  chartInsights,
  exponentialMovingAverage,
  latestYoyPct,
  slicedMovingAverage,
} from "@/lib/chart-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { BarSeries } from "@/components/charts/BarSeries";
import {
  StackedShareBar,
  type StackedShareBarSegment,
} from "@/components/charts/StackedShareBar";
import { IiflHeatmap } from "@/components/charts/IiflHeatmap";
import { MultiLine } from "@/components/charts/MultiLine";
import { StackedArea } from "@/components/charts/StackedArea";
import { indexSeriesToBase } from "@/lib/index-series";
import { latestMonth } from "@/data/aggregate";
import {
  activeEquityNetInflowSignal,
  amfiMonthlyRows,
  availableMonthsDesc,
  formatKpiProvenanceLine,
  formatKpiProvenanceTooltip,
  getKpiProvenance,
  getKpiValue,
  kpiContext,
  latestAmfiMonthlyRow,
  snapshotSectionRead,
  monthlyActivePassiveTrend,
  monthlyFlowsData,
  monthlyIndustryFolioAdditionsTrend,
  monthlySipGrossShareTrend,
  monthlyTrend,
  resolveSelectedRow,
  type AmfiMonthlyKpiField,
} from "@/data/amfi-monthly";
import type { AmfiMonthlyPdfRow } from "@/data/snapshots/types";
import {
  activeEquityFlowWithNiftyTrend,
  cyclePhaseHistory,
  historicalEpisodes,
  latestNifty500Row,
  marketIndexRows,
} from "@/data/market-indices";
import { BarsWithIndexLine } from "@/components/charts/BarsWithIndexLine";
import { BarsWithLabels } from "@/components/charts/BarsWithLabels";
import { SankeyFlow } from "@/components/charts/SankeyFlow";
import { PassiveShareInEquity } from "@/components/amc/PassiveShareInEquity";
import { CalendarHeatGrid } from "@/components/ui/CalendarHeatGrid";
import { CategoryResilienceCard } from "@/components/ui/CategoryResilienceCard";
import { categoryDrawdownResilience } from "@/data/category-resilience";
import { EpisodeRecoveryCard } from "@/components/ui/EpisodeRecoveryCard";
import { episodeRecoveryRows } from "@/data/episode-recovery";
import { EpisodeReplayStrip } from "@/components/ui/EpisodeReplayStrip";
import { KeyTakeaway, DeltaCr } from "@/components/ui/KeyTakeaway";
import { StickyContextFooter } from "@/components/ui/StickyContextFooter";
import { LensToggle } from "@/components/ui/LensToggle";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  categoryFlowZScoreMap,
  categoryRotation,
  iiflActiveEquityHeatmapData,
  iiflActiveEquityHeatmapZScoreData,
  iiflActiveEquityTrendCard,
  latestCategoryProvenance,
} from "@/data/amfi-monthly-category";
import { topAumMarketShareSeries } from "@/data/amc-peer-universe";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { VerticalBars } from "@/components/charts/VerticalBars";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MonthPicker } from "@/components/filters/MonthPicker";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { resolveTab } from "@/lib/tabs";

const MONTHLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "flows", label: "Flows" },
  { id: "sip-retail", label: "SIP & Retail" },
  { id: "active-passive", label: "Active vs Passive" },
  { id: "categories", label: "Categories" },
  { id: "market-cycle", label: "Market Cycle" },
] as const satisfies readonly DashboardTabDef[];
type MonthlyTabId = (typeof MONTHLY_TABS)[number]["id"];
const MONTHLY_TAB_IDS = MONTHLY_TABS.map((t) => t.id) as readonly MonthlyTabId[];

/** Month-end AUM mix shares (% of the month's own breakdown total) for a
 *  single row, keyed by category. Mirrors the Month-end AUM Mix card's
 *  segment logic exactly — including the residual "Other" bucket — so a
 *  month-over-month delta computed from two of these maps lines up with
 *  the shares the card renders. Returns an empty map when the row lacks
 *  a usable breakdown. */
function monthEndMixShares(
  row: AmfiMonthlyPdfRow | null
): Map<string, number> {
  const shares = new Map<string, number>();
  if (!row) return shares;
  const eq = getKpiValue(row, "equityAum");
  const db = getKpiValue(row, "debtAum");
  const lq = getKpiValue(row, "liquidAum");
  const total = getKpiValue(row, "totalAum");
  const segs: { key: string; value: number }[] = [];
  if (typeof eq === "number") segs.push({ key: "equity", value: eq });
  if (typeof db === "number") segs.push({ key: "debt", value: db });
  if (typeof lq === "number") segs.push({ key: "liquid", value: lq });
  if (
    typeof total === "number" &&
    typeof eq === "number" &&
    typeof db === "number" &&
    typeof lq === "number"
  ) {
    const residual = total - (eq + db + lq);
    if (residual > 0) segs.push({ key: "other", value: residual });
  }
  const sum = segs.reduce((s, x) => s + x.value, 0);
  if (sum > 0) {
    for (const s of segs) shares.set(s.key, (s.value / sum) * 100);
  }
  return shares;
}

type RenderedCycleBand = {
  fromLabel: string;
  toLabel: string;
  phase: "Correction" | "Peak";
  color?: string;
};

/** Prepare cycle-phase bands for a chart whose x-axis is `labels`:
 *  keep only bands fully inside the window, give single-month runs
 *  visible width (pad one label each side, clamped to the window) so a
 *  point-in-time phase reads as a band, and recolour Peak green. Shared
 *  by the Total AAUM Trend and the SIP cards so they render identically. */
function renderedCycleBands(
  bands: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[],
  labels: string[]
): RenderedCycleBand[] {
  const idx = new Map(labels.map((l, i) => [l, i]));
  return bands
    .filter((b) => idx.has(b.fromLabel) && idx.has(b.toLabel))
    .map((b) => {
      const fromIdx = idx.get(b.fromLabel) as number;
      const toIdx = idx.get(b.toLabel) as number;
      const single = fromIdx === toIdx;
      const lo = single ? Math.max(0, fromIdx - 1) : fromIdx;
      const hi = single ? Math.min(labels.length - 1, toIdx + 1) : toIdx;
      return {
        fromLabel: labels[lo],
        toLabel: labels[hi],
        phase: b.phase,
        color: b.phase === "Peak" ? "hsl(var(--positive))" : undefined,
      };
    });
}

/** Legend for the shaded cycle-phase bands. Lists only the phases that
 *  actually appear in `bands`, so a window with no correction (e.g. the
 *  SIP cards) shows just the Peak row. */
function CyclePhaseLegend({ bands }: { bands: RenderedCycleBand[] }) {
  const hasCorrection = bands.some((b) => b.phase === "Correction");
  const hasPeak = bands.some((b) => b.phase === "Peak");
  if (!hasCorrection && !hasPeak) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span>Shaded bands mark market cycle phases (Nifty 500):</span>
      {hasCorrection && (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(var(--negative) / 0.4)" }}
          />
          Correction — index in drawdown
        </span>
      )}
      {hasPeak && (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(var(--positive) / 0.4)" }}
          />
          Peak — stretched / euphoric inflows
        </span>
      )}
    </p>
  );
}

/** "2026-04" → "April 2026". Falls back to the raw YYYY-MM key for
 *  malformed input. Shared by the Flows "Where the Money Went" card and
 *  its net-outflow fallback so both label the period identically. */
function fullMonthLabel(month: string): string {
  const FULL_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return Number.isFinite(idx) && idx >= 0 && idx < 12
    ? `${FULL_MONTHS[idx]} ${y}`
    : month;
}

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ---- Lens toggles (parsed up-front so any chart below can read them).
  // Each chart owns its own URL param so the toggles don't collide.
  const heatmapLens: "share" | "zscore" =
    typeof sp.heatmap === "string" && sp.heatmap === "zscore"
      ? "zscore"
      : "share";
  const monthlyFlowsLens: "absolute" | "share" =
    sp.flowsLens === "share" ? "share" : "absolute";
  // SIP Contribution period toggle. History now runs to ~10 years, so
  // the card offers 1Y / 3Y / 5Y / All — where "All" is capped at 84
  // months (the range that aligns with the cycle-phase / market-data
  // window and shows both correction phases). Defaults to All.
  const sipContribRange: "1y" | "3y" | "5y" | "all" =
    sp.sipContribPeriod === "1y"
      ? "1y"
      : sp.sipContribPeriod === "3y"
        ? "3y"
        : sp.sipContribPeriod === "5y"
          ? "5y"
          : "all";
  const sipContribMonths =
    sipContribRange === "1y"
      ? 12
      : sipContribRange === "3y"
        ? 36
        : sipContribRange === "5y"
          ? 60
          : 84;
  // Chart-type toggles. Each eligible bar-style time-series card on
  // the page owns its own `<thing>View` URL param. Bars is the
  // default and is never echoed into the URL — only the "trend"
  // value rides along so the default page stays URL-clean.
  // Chart-style toggles (Bars vs Trend) were removed across the
  // dashboard — every chart now renders the trend visual directly.
  // Stale `?...View=bars|trend` URLs are ignored silently.
  // Per-card lens toggles. Each one switches a trend chart between
  // an absolute number (₹ Cr / count / etc) and a meaningful share
  // / ratio specific to that card. Default is "absolute" — URL stays
  // clean unless the user actively picked "share".
  const aaumLens: "absolute" | "share" =
    sp.aaumLens === "share" ? "share" : "absolute";
  // Primary view toggle for the first SIP card: SIP flows-vs-gross-inflows
  // (default) or the SIP AUM trend (folded in from the old standalone card).
  const sipPrimaryView: "flows" | "aum" =
    sp.sipView === "aum" ? "aum" : "flows";
  // Primary view toggle for the Flows "Net inflows vs Nifty" card: the
  // bars-vs-Nifty chart (default) or the Active Equity AAUM trend (folded
  // in from the old Active vs Passive tab).
  const mfFlowsView: "flows" | "aaum" =
    sp.mfFlowsView === "aaum" ? "aaum" : "flows";
  // Pass-through params for every LensToggle so toggling A doesn't
  // lose B (or the selected month / active tab).
  const preservedQueryParams: Record<string, string | undefined> = {
    tab: typeof sp.tab === "string" ? sp.tab : undefined,
    month: typeof sp.month === "string" ? sp.month : undefined,
    heatmap: typeof sp.heatmap === "string" ? sp.heatmap : undefined,
    flowsLens: typeof sp.flowsLens === "string" ? sp.flowsLens : undefined,
    mfFlowsView:
      typeof sp.mfFlowsView === "string" ? sp.mfFlowsView : undefined,
    aeFlowView:
      typeof sp.aeFlowView === "string" ? sp.aeFlowView : undefined,
    aeFlowRange:
      typeof sp.aeFlowRange === "string" ? sp.aeFlowRange : undefined,
    activePassiveLens:
      typeof sp.activePassiveLens === "string"
        ? sp.activePassiveLens
        : undefined,
    aaumLens: typeof sp.aaumLens === "string" ? sp.aaumLens : undefined,
    sipContribLens:
      typeof sp.sipContribLens === "string" ? sp.sipContribLens : undefined,
    sipContribPeriod:
      typeof sp.sipContribPeriod === "string" ? sp.sipContribPeriod : undefined,
    sipView: typeof sp.sipView === "string" ? sp.sipView : undefined,
    sipAccountsLens:
      typeof sp.sipAccountsLens === "string" ? sp.sipAccountsLens : undefined,
    aeFlowLens:
      typeof sp.aeFlowLens === "string" ? sp.aeFlowLens : undefined,
    nfoCountLens:
      typeof sp.nfoCountLens === "string" ? sp.nfoCountLens : undefined,
    nfoFundsLens:
      typeof sp.nfoFundsLens === "string" ? sp.nfoFundsLens : undefined,
    categoryTrendsScale:
      typeof sp.categoryTrendsScale === "string"
        ? sp.categoryTrendsScale
        : undefined,
  };
  // Scale toggle for the Active-Equity Category Trends section. The two
  // series on each card (QAAUM share, Net inflow share) live on the
  // same y-axis but their typical ranges differ ~5× — QAAUM share drifts
  // a few pp; Net inflow share swings 10–30pp — so on a shared scale
  // QAAUM share's real volatility reads as a flat line. "indexed"
  // rebases each series independently to 100 at its first visible
  // point, so both lines move on the same comparable scale.
  const categoryTrendsScale: "levels" | "indexed" =
    sp.categoryTrendsScale === "indexed" ? "indexed" : "levels";

  // Resolve the active tab from the URL. Unknown / missing values
  // silently fall back to "snapshot" so stale bookmarks don't break.
  const activeTab = resolveTab<MonthlyTabId>(
    sp.tab,
    MONTHLY_TAB_IDS,
    "snapshot",
  );

  // AMFI Monthly Snapshot — first live AMFI widget. Reads directly from
  // the manually-uploaded-PDF snapshot. The selected row is whichever
  // month the URL `?month=YYYY-MM` query param picked, falling back to
  // the latest available month when missing or invalid. Cards only
  // render for KPIs the SELECTED row carries — never substitutes zero
  // or a dash for a missing value, never falls back to demo data.
  const requestedMonthRaw = sp.month;
  const requestedMonth =
    typeof requestedMonthRaw === "string" ? requestedMonthRaw : undefined;
  const amfiSelected = resolveSelectedRow(requestedMonth);
  const amfiAvailableMonths = availableMonthsDesc();
  // Header subtitle tracks the global period filter so the page title
  // agrees with the picker. Falls back to the dataset's latest month
  // when nothing is explicitly selected (keeps the default unchanged).
  const subtitle = `Industry-wide · ${
    requestedMonth ? amfiSelected?.month ?? latestMonth() : latestMonth()
  }`;

  /** All cards we'd surface if the row had every field. The render below
   *  hides any whose value is null on the latest row, so a press-release-
   *  only month would skip totalAaum/netInflow, and a Monthly-Report-only
   *  month would skip the SIP cards.
   *
   *  totalAum is intentionally NOT in this list — totalAaum (period
   *  average) is the dashboard-canonical headline and is comparable to
   *  the bps-of-MF-QAAUM yields elsewhere. The closing-balance totalAum
   *  is still extracted and stored in the snapshot for any future
   *  consumer; just not rendered here. */
  const AMFI_CARDS: {
    field: AmfiMonthlyKpiField;
    label: string;
    format: (v: number) => string;
    sparklineColor?: string;
    /** Optional ratio caption derived from the selected row (e.g. "20.6% of total AUM"). */
    ratio?: (row: NonNullable<typeof amfiSelected>) => string | undefined;
  }[] = [
    {
      field: "totalAaum",
      label: "Total AAUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-1))",
    },
    {
      field: "equityAum",
      label: "Equity AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-1))",
      ratio: (r) => {
        if (typeof r.equityAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.equityAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "debtAum",
      label: "Debt AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-2))",
      ratio: (r) => {
        if (typeof r.debtAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.debtAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "liquidAum",
      label: "Liquid AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-4))",
      ratio: (r) => {
        if (typeof r.liquidAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.liquidAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "netInflow",
      label: "Net Inflow",
      // formatCompactCrSafe handles only positive values via its compact
      // suffixes; for negative net-flow values we render the magnitude
      // with the same suffix and a leading minus so signs are obvious.
      format: (v: number) => {
        if (v >= 0) return formatCompactCrSafe(v);
        return "−" + formatCompactCrSafe(-v);
      },
      sparklineColor: "hsl(var(--chart-3))",
      ratio: (r) => {
        if (typeof r.netInflow !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.netInflow / r.totalAum) * 100).toFixed(2)}% of opening AUM`;
      },
    },
    {
      field: "sipContribution",
      label: "SIP Contribution",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-1))",
      ratio: (r) => {
        if (
          typeof r.sipContribution !== "number" ||
          typeof r.netInflow !== "number" ||
          r.netInflow <= 0
        )
          return undefined;
        return `${((r.sipContribution / r.netInflow) * 100).toFixed(0)}% of net inflow`;
      },
    },
    {
      field: "sipAum",
      label: "SIP AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-2))",
      ratio: (r) => {
        if (typeof r.sipAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.sipAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "sipAccounts",
      label: "SIP Accounts",
      // SIP accounts are stored as a raw count (e.g. 97,200,000); the
      // safe formatter divides by 1e7 and emits "9.72 Cr".
      format: (v: number) => formatCroreCountSafe(v),
      sparklineColor: "hsl(var(--chart-3))",
      ratio: (r) => {
        if (typeof r.sipAccounts !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        // Accounts per ₹ Cr of AUM — investor density.
        return `${(r.sipAccounts / r.totalAum).toFixed(1)} per ₹ Cr AUM`;
      },
    },
  ];

  const amfiCardsToRender = AMFI_CARDS.flatMap((spec) => {
    const value = getKpiValue(amfiSelected, spec.field);
    if (value === null) return [];
    const provenance = getKpiProvenance(amfiSelected, spec.field);
    // Anchor YoY / percentile / sparkline window to the user-selected
    // month, not the latest available. Otherwise the picker changes the
    // headline value but the pills stay stuck on the latest snapshot.
    const ctx = kpiContext(spec.field, 24, amfiSelected?.month);
    return [
      {
        ...spec,
        value,
        formatted: spec.format(value),
        // Visible note: "Source: AMFI Monthly Report · p.1" — short.
        // Tooltip on hover: same plus the full PDF filename for users
        // who want to verify provenance. Filename stays in the data
        // (row.fieldSources[field].sourcePdf) regardless.
        note: formatKpiProvenanceLine(provenance) ?? "",
        noteHover: formatKpiProvenanceTooltip(provenance) ?? undefined,
        sparkline: ctx.sparkline,
        yoyPct: ctx.yoyPct,
        percentile: ctx.percentile,
        ratioLine: amfiSelected ? spec.ratio?.(amfiSelected) : undefined,
      },
    ];
  });

  // Subtitle no longer carries the month; the month picker on the right
  // is the canonical place for period selection.
  const amfiSectionSubtitle = amfiSelected
    ? "Industry-wide · Source: AMFI Monthly Report"
    : "Upload AMFI monthly PDFs to manual-data/amfi-monthly/pdfs/, then run npm run ingest:amfi-pdf";

  // ---- AMFI AUM Mix & Trend section -----------------------------------
  //
  // Month-end AUM Mix. Denominator is `totalAum` (closing balance) so the
  // category fields stay on the same month-end basis as the source rows.
  // We do NOT divide month-end equityAum/debtAum/liquidAum by totalAaum
  // (period-average) — the units would not match.
  //
  // "Other" = totalAum − (equity + debt + liquid). Computed only when
  // ALL three sub-categories are present and totalAum is present, since
  // a missing sub-category would inflate the residual into a misleading
  // bucket. If the residual is ≤ 0, Other is dropped (would either be
  // a wash or imply mis-extraction).
  const mixTotalAum = getKpiValue(amfiSelected, "totalAum");
  const mixEquity = getKpiValue(amfiSelected, "equityAum");
  const mixDebt = getKpiValue(amfiSelected, "debtAum");
  const mixLiquid = getKpiValue(amfiSelected, "liquidAum");

  const mixSlices: StackedShareBarSegment[] = [];
  if (typeof mixEquity === "number") {
    mixSlices.push({
      key: "equity",
      label: "Equity",
      value: mixEquity,
      color: "hsl(var(--chart-1))",
    });
  }
  if (typeof mixDebt === "number") {
    mixSlices.push({
      key: "debt",
      label: "Debt",
      value: mixDebt,
      color: "hsl(var(--chart-2))",
    });
  }
  if (typeof mixLiquid === "number") {
    mixSlices.push({
      key: "liquid",
      label: "Liquid",
      value: mixLiquid,
      color: "hsl(var(--chart-4))",
    });
  }

  const allSubCategoriesPresent =
    typeof mixEquity === "number" &&
    typeof mixDebt === "number" &&
    typeof mixLiquid === "number";
  let mixOther: number | null = null;
  if (typeof mixTotalAum === "number" && allSubCategoriesPresent) {
    const sumKnown = mixEquity + mixDebt + mixLiquid;
    const residual = mixTotalAum - sumKnown;
    if (residual > 0) {
      mixOther = residual;
      mixSlices.push({
        key: "other",
        label: "Other",
        value: residual,
        color: "hsl(var(--muted-foreground))",
      });
    }
  }
  const mixHasData = mixSlices.length > 0;

  // Month-over-month change in each category's SHARE of the month-end
  // breakdown, in percentage points — surfaces where investor allocation
  // is shifting relative to last month. Compared against the immediately
  // preceding available month, using the same residual-"Other" basis as
  // the slices above so the delta lines up with the rendered shares.
  // Left null per-segment when there's no prior month or no comparable
  // share to subtract.
  const mixSelectedShares = monthEndMixShares(amfiSelected);
  const mixPrevRow: AmfiMonthlyPdfRow | null = (() => {
    if (!amfiSelected) return null;
    const rows = amfiMonthlyRows(); // ascending by month
    const idx = rows.findIndex((r) => r.month === amfiSelected.month);
    return idx > 0 ? rows[idx - 1] : null;
  })();
  const mixPrevShares = monthEndMixShares(mixPrevRow);
  for (const seg of mixSlices) {
    const now = mixSelectedShares.get(seg.key);
    const prev = mixPrevShares.get(seg.key);
    seg.deltaPp =
      typeof now === "number" && typeof prev === "number" ? now - prev : null;
  }

  // Subtitle clarifies the basis. When `Other` is included it's by
  // residual against totalAum; when it's dropped (e.g. if totalAum was
  // missing or sub-categories were incomplete), say so plainly.
  const mixSubtitle =
    mixHasData && mixOther !== null
      ? "Month-end AUM · share of Total AUM (residual = Other)"
      : mixHasData
        ? "Month-end AUM · partial breakdown · Other not computed"
        : "Month-end AUM not available for this month";

  // AAUM Trend across all available months. We use totalAaum (period
  // average) because that's the disclosure-comparable headline; falling
  // back to nothing when no row carries it. The chart renders 1 bar
  // when a single month is ingested, and naturally extends as more
  // PDFs land.
  const aaumTrendData = amfiMonthlyRows()
    .filter((r) => typeof r.totalAaum === "number")
    .map((r) => ({ label: r.month, value: r.totalAaum as number }));
  const aaumTrendHasData = aaumTrendData.length > 0;

  // ---- Shared chart-context helpers (used by every insight call) ----
  // Computed once so we don't recompute the same maps per chart.
  const ddByMonthForInsights: Map<string, number> = (() => {
    const m = new Map<string, number>();
    for (const r of marketIndexRows("NIFTY_500")) {
      if (typeof r.drawdownPct === "number") m.set(r.month, r.drawdownPct);
    }
    return m;
  })();
  const cyclePhaseByMonth: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const p of cyclePhaseHistory()) m.set(p.month, p.phase);
    return m;
  })();
  const episodeAnchorsForInsights: { label: string; title: string }[] =
    historicalEpisodes().map((e) => ({
      label: e.startMonth,
      title: e.title,
    }));

  // Total AAUM denominator: latest as % of trailing 12M average.
  const totalAaumDenomCaption = (() => {
    if (aaumTrendData.length < 12) return undefined;
    const trailing12 = aaumTrendData.slice(-12);
    const avg = trailing12.reduce((s, p) => s + p.value, 0) / trailing12.length;
    const latest = aaumTrendData[aaumTrendData.length - 1];
    if (avg <= 0) return undefined;
    const pct = (latest.value / avg) * 100;
    return `${pct.toFixed(1)}% of trailing 12M avg · latest ${latest.label}`;
  })();
  // "Share" view for the AAUM card: each month indexed as a % of
  // its own trailing-12M moving average. Months with fewer than 12
  // prior data points are dropped (no trailing average available
  // yet). The toggle swaps the absolute ₹ Cr series for this one
  // when the user picks "vs 12M avg".
  const aaumTrendDataShare = aaumTrendData
    .map((p, i, arr) => {
      if (i + 1 < 12) return null;
      const slice = arr.slice(i + 1 - 12, i + 1);
      const avg = slice.reduce((s, q) => s + q.value, 0) / 12;
      if (avg <= 0) return null;
      return { label: p.label, value: (p.value / avg) * 100 };
    })
    .filter((p): p is { label: string; value: number } => p !== null);
  const aaumDisplayData = aaumLens === "share" ? aaumTrendDataShare : aaumTrendData;
  const totalAaumInsights = chartInsights(aaumTrendData, {
    metricName: "total AAUM",
    unitSuffix: "₹ Cr",
    yoyLag: 12,
    cyclePhaseByLabel: cyclePhaseByMonth,
  });

  // Provenance captions for the section. All four contributing fields
  // (totalAum / equityAum / debtAum / liquidAum / totalAaum) come from
  // the AMFI Monthly Report on the current snapshot, so a single
  // "Source: AMFI Monthly Report" caption is accurate. Hover surfaces
  // the same per-field detail the KPI cards expose.

  // ---- SIP Trends section --------------------------------------------
  //
  // Three line/bar trend charts driven by the press-release Monthly
  // Notes' SIP fields. monthlyTrend(field, 24) returns the chronological
  // series of months that have a value for `field` — months where the
  // field is absent are OMITTED, never zeroed or interpolated. The
  // x-axis can therefore be non-uniform (e.g. sipAccounts is missing on
  // 2024-12 / 2025-01 because those Notes don't carry the row), but no
  // synthetic data is introduced.
  const sipContribTrend = monthlyTrend("sipContribution", sipContribMonths);
  const sipAumTrend = monthlyTrend("sipAum", 24);
  const sipAccountsTrend = monthlyTrend("sipAccounts", 24);


  const hasAnySipTrend =
    sipContribTrend.length > 0 ||
    sipAumTrend.length > 0 ||
    sipAccountsTrend.length > 0;

  // ---- "Share" series for SIP AUM (kept for the SIP AUM card) -------
  // SIP Contribution and SIP Contributing Accounts cards were replaced
  // with the IIFL Figure 6 / 7 charts above — their share series and
  // display lookups are no longer needed.
  const sipAumShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.sipAum === "number" &&
        typeof r.totalAum === "number" &&
        r.totalAum > 0
    )
    .map((r) => ({
      label: r.month,
      value: ((r.sipAum as number) / (r.totalAum as number)) * 100,
    }));

  // ---- Monthly Flows (Figure 22-style) section -----------------------
  //
  // Three category-level net-flow series: equity (Sub Total - II),
  // debt (Sub Total - I; INCLUDES liquid), and liquid (Liquid Fund
  // row alone). All from the AMFI Monthly Report. Cells are null
  // when a month's row didn't carry the field — Recharts' GroupedBars
  // skips null cells, which honours the "no fake zero" rule while
  // still rendering the other categories on the same x-axis.
  const monthlyFlowsRows = monthlyFlowsData(24);
  // Transform flows to share view when the lens is set. Denominator is
  // the sum of ABSOLUTE per-series values so signs (inflow vs outflow)
  // stay readable; the bar heights now represent each segment's share
  // of the month's total flow magnitude.
  const toShareRow = (
    row: Record<string, number | null | string>,
    keys: string[]
  ): Record<string, number | null | string> => {
    const total = keys.reduce((s, k) => {
      const v = row[k];
      return s + (typeof v === "number" ? Math.abs(v) : 0);
    }, 0);
    if (total === 0) {
      const out = { ...row };
      for (const k of keys) out[k] = null;
      return out;
    }
    const out = { ...row };
    for (const k of keys) {
      const v = row[k];
      out[k] = typeof v === "number" ? (v / total) * 100 : null;
    }
    return out;
  };
  const monthlyFlowsDisplay =
    monthlyFlowsLens === "share"
      ? monthlyFlowsRows.map((r) =>
          toShareRow(r as Record<string, number | null | string>, [
            "equity",
            "debt",
            "liquid",
          ])
        )
      : monthlyFlowsRows;
  const monthlyFlowsHasData = monthlyFlowsRows.some(
    (r) => r.equity !== null || r.debt !== null || r.liquid !== null
  );

  // Monthly Flows denominator: latest month's Equity share of total
  // flow magnitude — the headline read for "where did the month's
  // flow go?".
  const monthlyFlowsDenomCaption = (() => {
    if (monthlyFlowsRows.length === 0) return undefined;
    const latest = monthlyFlowsRows[monthlyFlowsRows.length - 1];
    const e = typeof latest.equity === "number" ? latest.equity : 0;
    const d = typeof latest.debt === "number" ? latest.debt : 0;
    const l = typeof latest.liquid === "number" ? latest.liquid : 0;
    const total = Math.abs(e) + Math.abs(d) + Math.abs(l);
    if (total === 0) return undefined;
    return `Equity = ${((Math.abs(e) / total) * 100).toFixed(0)}% / Debt = ${((Math.abs(d) / total) * 100).toFixed(0)}% / Liquid = ${((Math.abs(l) / total) * 100).toFixed(0)}% of latest flow magnitude · ${latest.month}`;
  })();
  // Insight strip on the equity series — equity is the headline
  // segment investors care about most.
  const equityFlowFromRows = monthlyFlowsRows
    .filter((r) => typeof r.equity === "number")
    .map((r) => ({ label: r.month as string, value: r.equity as number }));
  const monthlyFlowsInsights = chartInsights(equityFlowFromRows, {
    metricName: "equity net inflow",
    unitSuffix: "₹ Cr",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    episodeAnchors: episodeAnchorsForInsights,
  });
  // Series specs shared by the bars and trend views of multi-series
  // chart cards. `BarSpec` and `LineSpec` both have shape
  // `{ key, name, color }` so the same array works as `bars=` on
  // GroupedBars and `lines=` on MultiLine.
  const monthlyFlowsSeries = [
    { key: "equity", name: "Equity", color: "hsl(var(--chart-1))" },
    { key: "debt", name: "Debt", color: "hsl(var(--chart-2))" },
    { key: "liquid", name: "Liquid", color: "hsl(var(--chart-4))" },
  ];

  // Provenance: all three fields come from the AMFI Monthly Report.
  // Use the most-recent debt-net-inflow provenance for the tooltip
  // since the debt row is the most reliable across older Reports.

  // ---- Active Equity & Equity Mix (IIFL Figure 19 / 21) section -----
  //
  // Three charts driven by the IIFL-derived equity breakdown fields
  // (activeEquityAaum, etfIndexAaum, arbitrageAaum) extracted from
  // the AMFI Monthly Report. All charts in this section use the AAUM
  // (period-average) basis so the trend line and share denominator
  // are consistent with IIFL's Figure 19 / 21 framing. Missing months
  // are omitted from each per-field series — never zero-filled.
  const activeEquityTrend = monthlyTrend("activeEquityAaum", 10_000);


  // Active Equity AAUM denominator: latest as % of total industry
  // AAUM that month — separates absolute scale growth from share
  // capture vs other segments.
  const activeEquityAaumDenomCaption = (() => {
    if (activeEquityTrend.length === 0) return undefined;
    const latest = activeEquityTrend[activeEquityTrend.length - 1];
    const peerRow = amfiMonthlyRows().find((r) => r.month === latest.label);
    if (
      !peerRow ||
      typeof peerRow.totalAaum !== "number" ||
      peerRow.totalAaum <= 0
    )
      return undefined;
    const pct = (latest.value / peerRow.totalAaum) * 100;
    return `${pct.toFixed(1)}% of total industry AAUM · latest ${latest.label}`;
  })();
  const activeEquityAaumInsights = chartInsights(activeEquityTrend, {
    metricName: "active-equity AAUM",
    unitSuffix: "₹ Cr",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });



  // ---- Industry Folios & NFO section ---------------------------------
  //
  // Four live KPI cards + up to three trend charts driven by the
  // industry-wide AMFI Monthly Report fields landed by PR #48:
  //   - industryFolios            (raw folio count)
  //   - industryNfoCount          (open + close-ended NFO launches)
  //   - industryNfoFundsMobilized (₹ Cr raised during the month)
  //
  // industryFolioAdditions is DERIVED from consecutive months of
  // industryFolios (delta) — never stored, always computed at render
  // time. When the prior month's folios are missing the delta is
  // omitted (no fake zero).
  const folioLatestRow = latestAmfiMonthlyRow();
  const industryFoliosLatest =
    folioLatestRow && typeof folioLatestRow.industryFolios === "number"
      ? folioLatestRow.industryFolios
      : null;
  const folioAdditionsTrend = monthlyIndustryFolioAdditionsTrend(24);
  const folioAdditionsFullHistory = monthlyIndustryFolioAdditionsTrend(10_000);

  // Folio additions denominator: latest monthly net add as % of the
  // existing folio base. Both `latest.value` (additions) and
  // `industryFoliosLatest` (folio base) are raw counts; the ratio is
  // therefore additions / base, expressed as a percentage.
  const folioAdditionsDenomCaption = (() => {
    if (folioAdditionsTrend.length === 0 || industryFoliosLatest === null)
      return undefined;
    const latest = folioAdditionsTrend[folioAdditionsTrend.length - 1];
    if (industryFoliosLatest <= 0) return undefined;
    const pct = (latest.value / industryFoliosLatest) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% of folio base · latest ${latest.label}`;
  })();
  const folioAdditionsInsights = chartInsights(folioAdditionsTrend, {
    metricName: "folio additions",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });


  const hasAnyFolioOrNfoTrend = folioAdditionsTrend.length > 0;

  // ---- IIFL Active-Equity Category Trends (cards) -------------------
  //
  // Per-category 12-month line cards above the heatmap. Two series
  // per card:
  //   QAAUM share %    = categoryAaum      / activeEquityAaum      × 100
  //   Net inflow share = categoryNetInflow / activeEquityNetInflow × 100
  // Both denominators come from the IIFL active-equity envelope
  // (NOT major-category, NOT industry totals). Window is the same
  // trailing 12 months as the heatmap — anchored on latest, never
  // on `?month=`. Featured 4 cards render inline; the remaining 8
  // sit behind a "Show more" details element.
  const flowZScoreBySlug = categoryFlowZScoreMap();
  const iiflTrendCards = IIFL_ACTIVE_EQUITY_CATEGORIES.map((c) => {
    const { series, hasData } = iiflActiveEquityTrendCard(c.slug);
    const aumHover = formatKpiProvenanceTooltip(
      latestCategoryProvenance(c.slug, "categoryAaum")
    );
    const z = flowZScoreBySlug.get(c.slug);
    return {
      ...c,
      series,
      hasData,
      aumHover,
      latestZ: z?.zScore ?? null,
      latestPercentile: z?.percentile ?? null,
    };
  });
  const iiflTrendBySlug = new Map(iiflTrendCards.map((c) => [c.slug, c]));
  // Sort featured + expanded card lists by latest z-score (hottest
  // categories first). Cards with null z-score sink to the bottom.
  const sortByZ = (slugs: typeof IIFL_TREND_FEATURED_SLUGS) =>
    [...slugs]
      .map((s) => iiflTrendBySlug.get(s)!)
      .sort((a, b) => {
        const az = a.latestZ;
        const bz = b.latestZ;
        if (az === null && bz === null) return 0;
        if (az === null) return 1;
        if (bz === null) return -1;
        return bz - az;
      });
  const featuredTrendCards = sortByZ(IIFL_TREND_FEATURED_SLUGS);
  const expandedTrendCards = sortByZ(IIFL_TREND_EXPANDED_SLUGS);
  const iiflTrendHasAny = iiflTrendCards.some((c) => c.hasData);
  const iiflTrendHasExpanded = expandedTrendCards.some((c) => c.hasData);

  // Category Resilience Through Drawdowns — derived view that
  // crosses each IIFL active-equity category against the cycle-phase
  // classifier to surface "did investors keep buying X during the
  // last drawdown, or did they bail?".
  const categoryResilienceRows = categoryDrawdownResilience();

  // ---- Category Flow Share (IIFL Figure 31-34) section ---------------
  //
  // 12-month × 12-category heatmap of net-inflow share within the
  // IIFL active-equity envelope:
  //   netInflowSharePct = categoryNetInflow / activeEquityNetInflow × 100
  // Always anchored on the latest available month — independent of
  // the `?month=` selection elsewhere on /monthly — so the window
  // rolls forward automatically when new months are ingested. Cells
  // are null when either side is missing; the heatmap renders a
  // muted "—", never a fake zero.
  const iiflHeatmap = iiflActiveEquityHeatmapData();
  const iiflHeatmapZScore = iiflActiveEquityHeatmapZScoreData();
  const heatmapActive =
    heatmapLens === "zscore" ? iiflHeatmapZScore : iiflHeatmap;
  const iiflHeatmapHasData = iiflHeatmap.rows.some((r) =>
    r.values.some((v) => v !== null)
  );
  // Hover provenance for the source line — pull a representative
  // category's `categoryNetInflow` provenance (Flexi Cap is dense
  // across all months).

  // AUM Market Share — live Top 7 + Others from AMFI Fundwise AAUM.
  // Quarterly data on a monthly page: the source is intrinsically
  // quarterly (AMFI Fundwise AAUM disclosure) so the card label says
  // so. Same helper is reused on /quarterly.
  const aumMarketShare = topAumMarketShareSeries(7, 8);
  const aumMarketShareCoverage = aumMarketShare.coverage;

  // ---- Active Equity Flow Diagnostics ------------------------------
  // Three derived views sitting on top of the existing AMFI Monthly
  // Report fields. No new ingestion / no new categories — just
  // active-equity envelope flow vs. trailing-average, an AUM bridge
  // (Δ closing AAUM split into net flow + market-residual), and SIP
  // AUM as a % of Total AUM. Gross-inflow share is intentionally
  // dropped: the monthly snapshot only carries net flow, gross
  // (Funds Mobilized) lives on the quarterly snapshot.
  // ---- IIFL-style "MF Flows — Risk of Slowdown" (Figures 4-7) ---------
  // Composite data feeding the new combined section. Single-pass setup so
  // the JSX below stays declarative.
  const activeEquityWithNifty = activeEquityFlowWithNiftyTrend(72);
  const activeEquityWithNiftyChartData = activeEquityWithNifty.map((p) => ({
    label: p.month,
    value: p.activeEquityNetInflow,
    line: p.niftyLevel,
  }));
  const sipGrossShareSeries = monthlySipGrossShareTrend(72);
  const sipGrossShareChartData = sipGrossShareSeries.map((p) => ({
    label: p.month,
    value: p.sipContribution,
    line: p.sipShareOfGrossPct,
  }));
  const sipAccountsChartData = monthlyTrend("sipAccounts", 12).map((p) => ({
    label: p.label,
    // Raw SIP-account count; rendered in crore via the "crore-count" format
    // (e.g. 9.65 Cr) to keep the dashboard on Indian numbering.
    value: p.value,
  }));
  const hasMfFlowsSlowdownSection =
    activeEquityWithNiftyChartData.length > 0 ||
    sipGrossShareSeries.length > 0 ||
    sipAccountsChartData.length > 0;

  // Proportion diagnostics: category rotation + passive flow share. Each
  // renders independently under its own tab (rotation in categories,
  // passiveFlowShare in active-passive).
  const rotation = categoryRotation(3, 5);

  // The headline active-equity flow signal — feeds the market-tape /
  // sticky context footer at the foot of the page.
  const activeEquitySignal = activeEquityNetInflowSignal();
  const latestNifty = latestNifty500Row();
  const cyclePhasePoints = cyclePhaseHistory();
  // Cycle-phase bands — group consecutive months of "Correction" or
  // "Peak" into runs so any BarSeries on the page can draw a subtle
  // background tint over those stretches. The other phases stay
  // unshaded (most of the timeline) so the bands read as ambient
  // context, not clutter.
  const cyclePhaseBands: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[] = (() => {
    const out: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[] = [];
    let runStart: { idx: number; phase: "Correction" | "Peak" } | null = null;
    for (let i = 0; i < cyclePhasePoints.length; i++) {
      const p = cyclePhasePoints[i];
      const isNotable = p.phase === "Correction" || p.phase === "Peak";
      if (isNotable) {
        if (runStart === null || runStart.phase !== p.phase) {
          if (runStart !== null) {
            out.push({
              fromLabel: cyclePhasePoints[runStart.idx].month,
              toLabel: cyclePhasePoints[i - 1].month,
              phase: runStart.phase,
            });
          }
          runStart = { idx: i, phase: p.phase as "Correction" | "Peak" };
        }
      } else if (runStart !== null) {
        out.push({
          fromLabel: cyclePhasePoints[runStart.idx].month,
          toLabel: cyclePhasePoints[i - 1].month,
          phase: runStart.phase,
        });
        runStart = null;
      }
    }
    if (runStart !== null) {
      out.push({
        fromLabel: cyclePhasePoints[runStart.idx].month,
        toLabel: cyclePhasePoints[cyclePhasePoints.length - 1].month,
        phase: runStart.phase,
      });
    }
    return out;
  })();
  const episodes = historicalEpisodes();
  // Recovery-tracker rows derived from the same episode list — for
  // each episode, compute the pre-baseline / trough / recovery
  // metrics so we can render "how long did it take investors to
  // come back?".
  const episodeRecoveryData = episodeRecoveryRows();
  // Sankey data — composes SIP vs Lump-sum on the source side, and
  // Equity / Debt / Liquid / Other on the target side, for the month
  // the global period filter has selected (falls back to the latest).
  // Links are proportional shares (source-pct × target-pct × total).
  const sankeyData: {
    month: string;
    sources: { id: string; label: string; tone?: "positive" | "negative" | "neutral" }[];
    targets: { id: string; label: string; tone?: "positive" | "negative" | "neutral" }[];
    links: { source: string; target: string; value: number }[];
  } | null = (() => {
    const selectedRow = amfiSelected;
    if (
      !selectedRow ||
      typeof selectedRow.netInflow !== "number" ||
      typeof selectedRow.equityNetInflow !== "number" ||
      typeof selectedRow.debtNetInflow !== "number" ||
      typeof selectedRow.liquidNetInflow !== "number" ||
      typeof selectedRow.sipContribution !== "number"
    )
      return null;
    const total = selectedRow.netInflow;
    if (total <= 0) return null;
    const sip = Math.max(0, selectedRow.sipContribution);
    const lumpSum = Math.max(0, total - sip);
    const equity = Math.max(0, selectedRow.equityNetInflow);
    const debtPure = Math.max(0, selectedRow.debtNetInflow - selectedRow.liquidNetInflow);
    const liquid = Math.max(0, selectedRow.liquidNetInflow);
    const other = Math.max(0, total - equity - debtPure - liquid);
    const targetTotals: Record<string, number> = {
      equity,
      debt: debtPure,
      liquid,
      other,
    };
    const sourceTotals: Record<string, number> = { sip, lumpSum };
    const sourceSum = sip + lumpSum;
    const targetSum = equity + debtPure + liquid + other;
    if (sourceSum === 0 || targetSum === 0) return null;
    const links: { source: string; target: string; value: number }[] = [];
    for (const [sId, sVal] of Object.entries(sourceTotals)) {
      if (sVal <= 0) continue;
      for (const [tId, tVal] of Object.entries(targetTotals)) {
        if (tVal <= 0) continue;
        links.push({
          source: sId,
          target: tId,
          // Proportional split — share of source × share of target × total.
          value: (sVal / sourceSum) * tVal,
        });
      }
    }
    return {
      month: selectedRow.month,
      sources: [
        { id: "sip", label: "SIP", tone: "positive" },
        { id: "lumpSum", label: "Lump sum", tone: "neutral" },
      ],
      targets: [
        { id: "equity", label: "Equity", tone: "positive" },
        { id: "debt", label: "Debt", tone: "neutral" },
        { id: "liquid", label: "Liquid", tone: "neutral" },
        { id: "other", label: "Other", tone: "neutral" },
      ],
      links,
    };
  })();
  // Calendar heat grid cells: every month in the active-equity
  // history, value = z-score of that month's flow vs the full
  // distribution. Drives the "7-year calendar" surface below.
  const flowHeatCells: { month: string; value: number | null; hoverDetail?: string }[] = (() => {
    const rows = amfiMonthlyRows();
    const series = rows
      .filter((r) => typeof r.activeEquityNetInflow === "number")
      .map((r) => ({ month: r.month, value: r.activeEquityNetInflow as number }));
    if (series.length === 0) return [];
    const values = series.map((p) => p.value);
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = n >= 2 && variance > 0 ? Math.sqrt(variance) : null;
    return series.map((p) => ({
      month: p.month,
      value: stdDev !== null ? (p.value - mean) / stdDev : null,
      hoverDetail: `${formatCompactCrSafe(p.value)} · ${
        stdDev !== null
          ? `${((p.value - mean) / stdDev).toFixed(2)}σ`
          : "—"
      }`,
    }));
  })();
  const latestCyclePhase =
    cyclePhasePoints.length > 0
      ? cyclePhasePoints[cyclePhasePoints.length - 1].phase
      : null;
  // Section reads — short data-driven 1-liners surfaced under
  // each section title.
  const snapshotRead = snapshotSectionRead();

  // Ambit-style headline for the Snapshot card: net inflow level, its
  // MoM ₹ change, SIP contribution share, and equity's share of gross
  // flows. Built from already-computed values (selected row + flows).
  const netInflowHeadline = (() => {
    if (!amfiSelected || typeof amfiSelected.netInflow !== "number") return null;
    const rows = amfiMonthlyRows();
    const idx = rows.findIndex((r) => r.month === amfiSelected.month);
    const prev = idx > 0 ? rows[idx - 1] : null;
    const ni = amfiSelected.netInflow;
    const prevNi =
      prev && typeof prev.netInflow === "number" ? prev.netInflow : null;
    const sipShare =
      typeof amfiSelected.sipContribution === "number" && ni > 0
        ? (amfiSelected.sipContribution / ni) * 100
        : null;
    const lf =
      monthlyFlowsRows.find((r) => r.month === amfiSelected.month) ?? null;
    let equityShare: number | null = null;
    if (lf && typeof lf.equity === "number") {
      const e = Math.abs(lf.equity);
      const d = typeof lf.debt === "number" ? Math.abs(lf.debt) : 0;
      const l = typeof lf.liquid === "number" ? Math.abs(lf.liquid) : 0;
      const tot = e + d + l;
      if (tot > 0) equityShare = (e / tot) * 100;
    }
    return { month: amfiSelected.month, ni, prevNi, sipShare, equityShare };
  })();
  const fmtNi = (v: number) =>
    v >= 0 ? formatCompactCrSafe(v) : "−" + formatCompactCrSafe(-v);

  // ---- Active vs Passive series ------------------------------------
  // 96-month window so the Share-of-Passive card can pick every
  // available March year-end + the most-recent Sep marker. The chart
  // self-filters; other consumers of this trend only look at the tail
  // so the wider window costs nothing.
  const activePassiveTrend = monthlyActivePassiveTrend(96);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Monthly Operating KPIs"
        subtitle={subtitle}
      />

      <DashboardTabs
        basePath="/monthly"
        tabs={MONTHLY_TABS}
        activeId={activeTab}
        searchParams={sp}
      />

      {amfiSelected &&
        amfiAvailableMonths.length > 0 &&
        activeTab !== "sip-retail" &&
        activeTab !== "active-passive" && (
          <MonthPicker
            availableMonths={amfiAvailableMonths}
            selectedMonth={amfiSelected.month}
          />
        )}

      {activeTab === "flows" &&
        (sankeyData ? (() => {
          const sankeyGrandTotal = sankeyData.links.reduce(
            (s, l) => s + Math.abs(l.value),
            0
          );
          const formatSankeyPct = (v: number) =>
            sankeyGrandTotal > 0
              ? `${((v / sankeyGrandTotal) * 100).toFixed(1)}%`
              : "";
          return (
            <Card
              title={`Where the Money Went · ${fullMonthLabel(sankeyData.month)}`}
              subtitleNode={
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    Industry net flow split by where the money came from and where it ended up.
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    Showing {sankeyData.month} · change the period filter above to see another month.
                  </p>
                </div>
              }
            >
              <SankeyFlow
                sources={sankeyData.sources}
                targets={sankeyData.targets}
                links={sankeyData.links}
                formatValue={formatSankeyPct}
                height={320}
              />
            </Card>
          );
        })() : amfiSelected ? (
          <Card
            title={`Where the Money Went · ${fullMonthLabel(amfiSelected.month)}`}
            subtitle="Industry net flow split by where the money came from and where it ended up."
          >
            <div className="flex h-[320px] flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
              <p>
                {typeof amfiSelected.netInflow === "number" &&
                amfiSelected.netInflow <= 0
                  ? `The industry saw a net outflow in ${fullMonthLabel(amfiSelected.month)}, so the inflow split isn't shown for this month.`
                  : `The flow breakdown isn't available for ${fullMonthLabel(amfiSelected.month)}.`}
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                Pick a different month from the period filter above.
              </p>
            </div>
          </Card>
        ) : null)}

      {activeTab === "snapshot" && (
      <Card
        title="AMFI Monthly Snapshot"
        subtitle={
          snapshotRead && amfiSelected
            ? `${amfiSectionSubtitle} · ${snapshotRead}`
            : amfiSectionSubtitle
        }
        action={
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
              amfiSelected
                ? "border-positive/40 bg-positive/10 text-positive"
                : "border-border text-muted-foreground"
            )}
          >
            {amfiSelected ? "Live" : "Not connected"}
          </span>
        }
      >
        {netInflowHeadline && (
          <KeyTakeaway
            className="mb-4"
            headline={
              <>
                Industry net inflow in {netInflowHeadline.month} was{" "}
                {fmtNi(netInflowHeadline.ni)}
                {netInflowHeadline.prevNi !== null && (
                  <>
                    {" "}
                    (<DeltaCr cr={netInflowHeadline.ni - netInflowHeadline.prevNi} />{" "}
                    MoM)
                  </>
                )}
                {netInflowHeadline.sipShare !== null && (
                  <>
                    ; SIPs contributed {netInflowHeadline.sipShare.toFixed(0)}% of
                    it
                  </>
                )}
                {netInflowHeadline.equityShare !== null && (
                  <>, and equity took {netInflowHeadline.equityShare.toFixed(0)}% of gross flows</>
                )}
                .
              </>
            }
          />
        )}
        {amfiCardsToRender.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {amfiCardsToRender.map((c) => (
              <KpiCard
                key={c.field}
                label={c.label}
                value={c.formatted}
                note={c.note}
                noteHover={c.noteHover}
                sparkline={c.sparkline}
                sparklineColor={c.sparklineColor}
                yoyPct={c.yoyPct}
                percentile={c.percentile}
                ratio={c.ratioLine}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No AMFI PDF data ingested yet.
          </div>
        )}
      </Card>
      )}

      {activeTab === "flows" && amfiSelected && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              AMFI AUM Mix &amp; Trend
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
            </p>
          </div>
          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Month-end AUM Mix" subtitle={mixSubtitle}>
              {mixHasData ? (
                <StackedShareBar
                  data={mixSlices}
                  formatValue={(v) => formatCompactCrSafe(v)}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Mix unavailable · sub-category AUM not in uploaded AMFI PDFs
                </div>
              )}
            </Card>
            <ChartWithContext
              title="Total AAUM Trend"
              subtitle="Average industry AUM by month. Shows how the industry's headline asset base has grown."
              flowKind="stock"
              denominatorCaption={(() => {
                const span = `${aaumTrendData.length} month${aaumTrendData.length === 1 ? "" : "s"}`;
                if (aaumLens === "share") return `${span} · indexed to 12M avg (100 = on-trend)`;
                return totalAaumDenomCaption
                  ? `${span} · ₹ Cr · ${totalAaumDenomCaption}`
                  : `${span} · ₹ Cr`;
              })()}
              denominatorTooltip="In share view, each month's AAUM is expressed as a % of the trailing 12-month average — helps separate cyclical mean-reversion from structural growth."
              insights={totalAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(aaumTrendData, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/monthly"
                  paramName="aaumLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "vs 12M avg" },
                  ]}
                  active={aaumLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {aaumTrendHasData ? (() => {
                const showShareRef = aaumLens === "share";
                // Absolute (₹ Cr) view overlays a 12-month EMA dotted line
                // seeded over the full AAUM history. Share view keeps its
                // indexed-to-100 reference line instead.
                const aaumEma = showShareRef
                  ? undefined
                  : exponentialMovingAverage(aaumTrendData, 12);
                const aaumCycleBands = renderedCycleBands(
                  cyclePhaseBands,
                  aaumDisplayData.map((p) => p.label)
                );
                return (
                  <>
                    <BarSeries
                      data={aaumDisplayData}
                      name="AAUM"
                      color="hsl(var(--chart-1))"
                      valueFormat={aaumLens === "share" ? "pct" : "cr"}
                      axisFormat={aaumLens === "share" ? "pct" : "cr"}
                      trendline={aaumEma}
                      trendlineName={aaumEma ? "12-month EMA" : undefined}
                      referenceValue={showShareRef ? 100 : undefined}
                      referenceLabel={showShareRef ? "12-month avg" : undefined}
                      cyclePhaseBands={aaumCycleBands}
                    />
                    <CyclePhaseLegend bands={aaumCycleBands} />
                  </>
                );
              })() : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  AAUM unavailable · totalAaum not in uploaded AMFI PDFs
                </div>
              )}
            </ChartWithContext>
          </section>
        </div>
      )}

      {activeTab === "flows" && monthlyFlowsHasData && (
        <ChartWithContext
          title="Equity / Debt / Liquid Monthly Net Flows"
          subtitle="Where industry money went each month, split by category."
          denominatorCaption={(() => {
            const span = `${monthlyFlowsRows.length} month${monthlyFlowsRows.length === 1 ? "" : "s"}`;
            if (monthlyFlowsLens === "share") {
              return `${span} · % of monthly flow magnitude (signs preserved)`;
            }
            return monthlyFlowsDenomCaption
              ? `${span} · ₹ Cr · ${monthlyFlowsDenomCaption}`
              : `${span} · ₹ Cr · positive = inflow, negative = outflow`;
          })()}
          denominatorTooltip="Latest month's per-segment share of total flow magnitude — the headline read for 'where did the month's flow go?'."
          insights={monthlyFlowsInsights}
          action={
            <LensToggle
              basePath="/monthly"
              paramName="flowsLens"
              defaultValue="absolute"
              lenses={[
                { value: "absolute", label: "₹ Cr" },
                { value: "share", label: "% of flow magnitude" },
              ]}
              active={monthlyFlowsLens}
              preserveParams={preservedQueryParams}
            />
          }
        >
          {monthlyFlowsLens === "share" ? (
            <GroupedBars
              data={monthlyFlowsDisplay}
              xKey="month"
              labelFormat="month"
              valueFormat="pct"
              axisFormat="pct"
              bars={monthlyFlowsSeries}
            />
          ) : (
            <VerticalBars
              data={monthlyFlowsDisplay}
              xKey="month"
              labelFormat="month"
              valueFormat="cr"
              axisFormat="cr"
              bars={monthlyFlowsSeries}
            />
          )}
        </ChartWithContext>
      )}

      {activeTab === "sip-retail" && hasAnySipTrend && (
        <div className="space-y-3">
          <section className="space-y-4">
            {sipGrossShareSeries.length > 0 && (
              <Card
                title={
                  sipPrimaryView === "aum"
                    ? "SIP AUM Trend"
                    : "SIP flows vs Industry Gross Inflows"
                }
                action={
                  <LensToggle
                    basePath="/monthly"
                    paramName="sipView"
                    defaultValue="flows"
                    lenses={[
                      { value: "flows", label: "SIP Flows" },
                      { value: "aum", label: "SIP AUM" },
                    ]}
                    active={sipPrimaryView}
                    preserveParams={preservedQueryParams}
                  />
                }
              >
                {sipPrimaryView === "aum" ? (
                  sipAumShare.length > 0 ? (
                    (() => {
                      // SIP AUM as % of total industry AUM, over the full
                      // available SIP-AUM history (Jun '24 onward — all the
                      // months the AMFI press release reports SIP AUM for).
                      const bands = renderedCycleBands(
                        cyclePhaseBands,
                        sipAumShare.map((p) => p.label)
                      );
                      return (
                        <>
                          <BarSeries
                            data={sipAumShare}
                            name="SIP AUM (% of total AUM)"
                            color="hsl(var(--chart-2))"
                            valueFormat="pct"
                            axisFormat="pct1"
                            labelFormat="month"
                            cyclePhaseBands={bands}
                            dynamicYDomain
                          />
                          <CyclePhaseLegend bands={bands} />
                        </>
                      );
                    })()
                  ) : (
                    <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                      SIP AUM not yet ingested — appears once the next AMFI
                      Monthly Notes (press release) lands.
                    </div>
                  )
                ) : (
                  <BarsWithIndexLine
                    data={sipGrossShareChartData}
                    barColor="hsl(var(--chart-1))"
                    lineColor="hsl(var(--chart-3))"
                    valueFormat="cr"
                    axisFormat="cr"
                    lineValueFormat="pct"
                    lineAxisFormat="pct"
                    labelFormat="month"
                    barName="SIP Flows (₹ Cr)"
                    lineName="SIP Flows as % of gross Inflows (RHS)"
                    lineDomain={[0, 110]}
                    lineTicks={[0, 25, 50, 75, 100]}
                  />
                )}
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
            {hasAnyFolioOrNfoTrend && folioAdditionsTrend.length > 0 && (
              <ChartWithContext
                title="Folio Additions Trend"
                subtitle="Net new folios opened each month. A breadth-of-investor signal."
                flowKind="net"
                denominatorCaption={(() => {
                  const span = `${folioAdditionsTrend.length} month${folioAdditionsTrend.length === 1 ? "" : "s"}`;
                  return folioAdditionsDenomCaption
                    ? `${span} · lakh · ${folioAdditionsDenomCaption}`
                    : `${span} · lakh`;
                })()}
                denominatorTooltip="Net new folios opened each month, in lakh — a breadth-of-investor signal tracking how many new accounts the industry adds."
                insights={folioAdditionsInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(folioAdditionsTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                {(() => {
                  const ov = adaptiveAverageOverlay(folioAdditionsFullHistory, folioAdditionsTrend, 12);
                  return (
                    <BarSeries
                      data={folioAdditionsTrend}
                      name="Folio Additions"
                      color="hsl(var(--chart-4))"
                      valueFormat="lakh"
                      axisFormat="lakh"
                      labelFormat="month"
                      trendline={ov.kind === "trailing" ? ov.trendline : undefined}
                      trendlineName={ov.kind === "trailing" ? ov.label : undefined}
                      referenceValue={ov.kind === "visible-mean" ? ov.referenceValue : undefined}
                      referenceLabel={ov.kind === "visible-mean" ? ov.label : undefined}
                    />
                  );
                })()}
              </ChartWithContext>
            )}

            {sipAccountsChartData.length > 0 && (
              <Card
                title="SIP Active contributing accounts (Cr)"
              >
                <BarsWithLabels
                  data={sipAccountsChartData}
                  barColor="hsl(var(--chart-3))"
                  valueFormat="crore-count"
                  axisFormat="crore-count"
                  labelFormat="month"
                  name="SIP Active contributing accounts (Cr)"
                  labelValueFormat="crore-count"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Live SIP-account count, expressed in crore. Sourced from
                  the AMFI Monthly Note&apos;s SIP trend table.
                </p>
              </Card>
            )}
            </div>
          </section>
        </div>
      )}

      {activeTab === "flows" && hasMfFlowsSlowdownSection && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              MF Flows — Risk of Slowdown
            </h2>
            <p className="text-xs text-muted-foreground">
              Net inflows in subsequent periods are meaningfully impacted by
              Nifty returns. Source: AMFI Monthly Report, NSE.
            </p>
          </div>

          {activeEquityWithNiftyChartData.length > 0 &&
            (mfFlowsView === "aaum" ? (
              <ChartWithContext
                title="Active Equity AAUM Trend"
                subtitle="Period-average AUM in active equity funds. Shows the actively-managed equity asset base."
                flowKind="stock"
                denominatorCaption={(() => {
                  const span = `${activeEquityTrend.length} month${activeEquityTrend.length === 1 ? "" : "s"}`;
                  return activeEquityAaumDenomCaption
                    ? `${span} · ₹ Cr · ${activeEquityAaumDenomCaption}`
                    : `${span} · ₹ Cr · period-average`;
                })()}
                denominatorTooltip="Latest active-equity AAUM as a % of total industry AAUM — separates absolute scale growth from share capture vs other segments."
                insights={activeEquityAaumInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(activeEquityTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <LensToggle
                      basePath="/monthly"
                      paramName="mfFlowsView"
                      defaultValue="flows"
                      lenses={[
                        { value: "flows", label: "Flows vs Nifty" },
                        { value: "aaum", label: "Active Equity AAUM" },
                      ]}
                      active={mfFlowsView}
                      preserveParams={preservedQueryParams}
                    />
                  </div>
                }
              >
                {activeEquityTrend.length > 0 ? (() => {
                  const trailingAvg = slicedMovingAverage(
                    activeEquityTrend,
                    12,
                    activeEquityTrend.length
                  );
                  const aeAaumCycleBands = renderedCycleBands(
                    cyclePhaseBands,
                    activeEquityTrend.map((p) => p.label as string)
                  );
                  return (
                    <>
                      <BarSeries
                        data={activeEquityTrend}
                        name="Active Equity AAUM"
                        color="hsl(var(--chart-1))"
                        valueFormat="cr"
                        axisFormat="cr"
                        labelFormat="month"
                        cyclePhaseBands={aeAaumCycleBands}
                        signedFill="single"
                        trendline={trailingAvg}
                        trendlineName="Trailing 12-month avg"
                      />
                      <CyclePhaseLegend bands={aeAaumCycleBands} />
                    </>
                  );
                })() : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Active-equity AAUM not yet ingested — appears once IIFL category fields land in the AMFI Monthly snapshot.
                  </div>
                )}
                <HowToRead>
                  <p className="inline-flex items-start gap-1.5">
                    <span>
                      The solid line is active-equity AAUM — the period-average
                      asset base in actively-managed equity funds. Unlike a flow,
                      this is a stock that grows two ways at once: fresh net
                      inflows, and market gains marking up money already invested.
                      So a rising line in a weak-flow month means the market did the
                      lifting; a flat line despite strong inflows means prices fell.
                      The dashed line is its trailing 12-month average — on a
                      steadily-rising asset base the YoY badge above is usually the
                      sharper read.
                    </span>
                    <InfoTooltip label="Active-equity envelope = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
                  </p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      <span className="font-medium text-foreground/80">
                        Why it&apos;s the AMC revenue base:
                      </span>{" "}
                      management fees scale off AUM, not flows, and active equity
                      carries the highest expense-ratio yield of any category — so
                      this asset base is the single biggest driver of an
                      AMC&apos;s topline. The YoY growth rate, not the absolute
                      level, is what flows through to earnings.
                    </li>
                    <li>
                      <span className="font-medium text-foreground/80">
                        Read it next to flows:
                      </span>{" "}
                      toggle back to Flows vs Nifty above — AAUM rising while flows
                      are soft is a market-driven rally (fragile if prices reverse);
                      AAUM rising on strong flows is durable, investor-funded growth.
                    </li>
                  </ul>
                </HowToRead>
              </ChartWithContext>
            ) : (
              <Card
                title="Net inflows of subsequent period are meaningfully impacted by Nifty returns"
                action={
                  <LensToggle
                    basePath="/monthly"
                    paramName="mfFlowsView"
                    defaultValue="flows"
                    lenses={[
                      { value: "flows", label: "Flows vs Nifty" },
                      { value: "aaum", label: "Active Equity AAUM" },
                    ]}
                    active={mfFlowsView}
                    preserveParams={preservedQueryParams}
                  />
                }
              >
                <BarsWithIndexLine
                  data={activeEquityWithNiftyChartData}
                  barColor="hsl(var(--chart-1))"
                  lineColor="hsl(var(--foreground))"
                  valueFormat="cr"
                  axisFormat="cr"
                  lineValueFormat="count"
                  lineAxisFormat="count"
                  labelFormat="month"
                  barName="Active Equity Net Inflows (LHS)"
                  lineName="Nifty 500 Index (RHS)"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Bars: monthly active-equity net inflow (₹ Cr, left axis).
                  Line: NIFTY 500 month-end level (right axis). Active equity
                  envelope = equity-oriented schemes + hybrid schemes excluding
                  arbitrage + solution-oriented schemes.
                </p>
              </Card>
            ))}

        </div>
      )}

      {activeTab === "categories" &&
        rotation &&
        rotation.gainers.length > 0 &&
        rotation.losers.length > 0 &&
        (() => {
          const topGainer = rotation.gainers[0];
          const topLoser = rotation.losers.reduce((m, e) =>
            e.deltaSharePct < m.deltaSharePct ? e : m
          );
          return (
            <KeyTakeaway
              headline={
                <>
                  Over the last {rotation.windowMonths}M,{" "}
                  <strong>{topGainer.label}</strong> gained the most
                  active-equity flow share (
                  <span className="text-positive">
                    +{topGainer.deltaSharePct.toFixed(2)}pp
                  </span>
                  ), while <strong>{topLoser.label}</strong> lost the most (
                  <span className="text-negative">
                    {topLoser.deltaSharePct.toFixed(2)}pp
                  </span>
                  ).
                </>
              }
            />
          );
        })()}

      {activeTab === "categories" && rotation && (
        <CategoryRotationCard rotation={rotation} />
      )}


      {activeTab === "active-passive" &&
        activePassiveTrend && activePassiveTrend.history.length > 0 && (
        <div className="space-y-3">
          <section className="grid gap-4 lg:grid-cols-1">
            <PassiveShareInEquity trend={activePassiveTrend} />
          </section>
        </div>
      )}

      {activeTab === "categories" && iiflTrendHasAny && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                Active-Equity Category Trends
              </h2>
              <p className="text-xs text-muted-foreground">
                {categoryTrendsScale === "indexed"
                  ? "QAAUM share vs net inflow share · each series rebased to 100 at the first visible month · Source: AMFI Monthly Report"
                  : "QAAUM share vs net inflow share · active-equity envelope · Source: AMFI Monthly Report"}
              </p>
            </div>
            <LensToggle
              basePath="/monthly"
              paramName="categoryTrendsScale"
              defaultValue="levels"
              lenses={[
                { value: "levels", label: "Levels" },
                { value: "indexed", label: "Indexed (100)" },
              ]}
              active={categoryTrendsScale}
              preserveParams={preservedQueryParams}
            />
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            {featuredTrendCards.map((c) => (
              <Card
                key={c.slug}
                title={c.label}
                subtitle={`${c.series.length} month${c.series.length === 1 ? "" : "s"} · % of active-equity envelope`}
                action={<CategoryHeatPill z={c.latestZ} />}
              >
                {c.hasData ? (
                  <MultiLine
                    data={
                      categoryTrendsScale === "indexed"
                        ? indexSeriesToBase(c.series, [
                            "aumSharePct",
                            "flowSharePct",
                          ])
                        : c.series
                    }
                    xKey="month"
                    labelFormat="month"
                    valueFormat={
                      categoryTrendsScale === "indexed" ? "count" : "pct"
                    }
                    axisFormat={
                      categoryTrendsScale === "indexed" ? "count" : "pct"
                    }
                    dynamicYDomain
                    lines={[
                      {
                        key: "aumSharePct",
                        name: "QAAUM share",
                        color: "hsl(var(--chart-1))",
                      },
                      {
                        key: "flowSharePct",
                        name: "Net inflow share",
                        color: "hsl(var(--chart-3))",
                      },
                    ]}
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Category snapshot not yet ingested for this slug.
                  </div>
                )}
              </Card>
            ))}
          </section>

          {iiflTrendHasExpanded && (
            <section className="grid gap-4 lg:grid-cols-2">
              {expandedTrendCards.map((c) => (
                <Card
                  key={c.slug}
                  title={c.label}
                  subtitle={`${c.series.length} month${c.series.length === 1 ? "" : "s"} · % of active-equity envelope`}
                  action={<CategoryHeatPill z={c.latestZ} />}
                >
                  {c.hasData ? (
                    <MultiLine
                      data={
                        categoryTrendsScale === "indexed"
                          ? indexSeriesToBase(c.series, [
                              "aumSharePct",
                              "flowSharePct",
                            ])
                          : c.series
                      }
                      xKey="month"
                      labelFormat="month"
                      valueFormat={
                        categoryTrendsScale === "indexed" ? "count" : "pct"
                      }
                      axisFormat={
                        categoryTrendsScale === "indexed" ? "count" : "pct"
                      }
                      dynamicYDomain
                      lines={[
                        {
                          key: "aumSharePct",
                          name: "QAAUM share",
                          color: "hsl(var(--chart-1))",
                        },
                        {
                          key: "flowSharePct",
                          name: "Net inflow share",
                          color: "hsl(var(--chart-3))",
                        },
                      ]}
                    />
                  ) : (
                    <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                      Category snapshot not yet ingested for this slug.
                    </div>
                  )}
                </Card>
              ))}
            </section>
          )}

          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {categoryTrendsScale === "indexed"
              ? "Each line shows growth relative to its own first visible month (=100). Use Levels to read absolute % shares."
              : "QAAUM share and net inflow share, both within the active-equity envelope."}
            <InfoTooltip
              label={
                categoryTrendsScale === "indexed"
                  ? "Each series is rebased independently to 100 at the first visible month, so both lines move on the same comparable scale. A value of 130 means the share is 30% higher than the start of the visible window."
                  : "Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes."
              }
            />
          </p>
        </div>
      )}

      {activeTab === "categories" && categoryResilienceRows.length > 0 && (
        <CategoryResilienceCard rows={categoryResilienceRows} />
      )}

      {activeTab === "categories" && iiflHeatmapHasData && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                Active-Equity Category Heatmap
              </h2>
              <p className="text-xs text-muted-foreground">
                {heatmapLens === "zscore"
                  ? "Net inflow z-score vs each category's own history · past 12 months · Source: AMFI Monthly Report"
                  : "Net inflow share of active equity categories · past 12 months · Source: AMFI Monthly Report"}
              </p>
            </div>
            <HeatmapLensToggle
              lens={heatmapLens}
              activeTab={typeof sp.tab === "string" ? sp.tab : undefined}
            />
          </div>

          <IiflHeatmap
            months={heatmapActive.months}
            rows={heatmapActive.rows}
            lens={heatmapLens}
          />

          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {heatmapLens === "zscore" ? (
              <>
                Cell = (month value − category mean) ÷ category stdDev.
                Saturates at ±2σ.
                <InfoTooltip label="z-score is computed per category over its full available monthly history. Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
              </>
            ) : (
              <>
                Share = category net inflow ÷ active-equity net inflow.
                <InfoTooltip label="Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
              </>
            )}
          </p>
        </div>
      )}

      {activeTab === "market-cycle" && flowHeatCells.length > 0 && (
        <Card
          title="Active Equity Flow · 7-year Calendar"
          subtitle="Each cell = one month · colour = z-score vs full history"
        >
          <CalendarHeatGrid
            cells={flowHeatCells}
            saturationBound={2}
            caption="Active-equity net inflow z-score per month"
          />
        </Card>
      )}

      {activeTab === "market-cycle" && (
      <Card
        tone={aumMarketShare.isFullUniverse ? undefined : "pending"}
        title="AUM Market Share"
        subtitle={
          aumMarketShareCoverage
            ? `Top ${aumMarketShare.topAmcs.length} AMCs + Others · ${aumMarketShareCoverage.quarterLabel} · Source: AMFI Fundwise AAUM`
            : `Top ${aumMarketShare.topAmcs.length} AMCs + Others · Source: AMFI Fundwise AAUM`
        }
      >
        {aumMarketShare.rows.length > 0 ? (
          <StackedArea
            data={aumMarketShare.rows}
            xKey="quarterLabel"
            labelFormat="none"
            reverseTooltipOrder
            series={[
              ...aumMarketShare.topAmcs.map((a) => ({
                key: a.slug,
                name: amcLabel(a.slug),
                color: AMC_COLORS[a.slug] ?? "hsl(var(--muted-foreground))",
              })),
              {
                key: "others",
                name: "Others",
                color: "hsl(var(--muted-foreground))",
              },
            ]}
          />
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
            AMFI Fundwise AAUM disclosure not yet ingested for the selected quarter.
          </div>
        )}
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Top {aumMarketShare.topAmcs.length} AMCs by latest AAUM;
          Others includes all remaining AMCs.
          <InfoTooltip label="Denominator is total AAUM of all AMCs in the snapshot." />
        </p>
      </Card>
      )}

      {activeTab === "market-cycle" && episodeRecoveryData.length > 0 && (
        <EpisodeRecoveryCard rows={episodeRecoveryData} />
      )}

      {activeTab === "market-cycle" && episodes.length > 0 && (
        <Card
          title="Cycle Replay · How investors behaved in past drawdowns"
          subtitle="Each card is a distinct drawdown episode — colour pill captures the average flow z-score during the episode"
        >
          <EpisodeReplayStrip
            episodes={episodes}
            formatValue={(v) => formatCompactCrSafe(v)}
          />
        </Card>
      )}

      <StickyContextFooter
        cyclePhase={latestCyclePhase}
        flowZScore={activeEquitySignal?.zScore ?? null}
        drawdownPct={latestNifty?.drawdownPct ?? null}
        latestMonth={activeEquitySignal?.latestMonth ?? null}
      />
    </div>
  );
}

/** Sign-aware compact ₹ Cr — local helper so a negative active-equity
 *  net inflow renders as "−₹32.4K Cr" rather than the unsigned value. */
/** Heatmap lens toggle — pure-server segmented control rendered as
 *  two `<Link>`s so the App Router handles state. Each link preserves
 *  the current `?tab=` so toggling the heatmap lens doesn't bounce the
 *  reader back to the default tab. */
function HeatmapLensToggle({
  lens,
  activeTab,
}: {
  lens: "share" | "zscore";
  activeTab: string | undefined;
}) {
  const baseClass =
    "rounded-md border px-2.5 py-1 text-[11px] font-medium tracking-tight transition-colors";
  const activeClass = "border-foreground/40 bg-foreground/5 text-foreground";
  const inactiveClass =
    "border-border text-muted-foreground hover:bg-accent hover:text-foreground";
  const shareQuery: Record<string, string> = {};
  const zscoreQuery: Record<string, string> = { heatmap: "zscore" };
  if (activeTab) {
    shareQuery.tab = activeTab;
    zscoreQuery.tab = activeTab;
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5 shadow-sm">
      <Link
        href={{ pathname: "/monthly", query: shareQuery }}
        scroll={false}
        className={cn(baseClass, lens === "share" ? activeClass : inactiveClass)}
      >
        Share
      </Link>
      <Link
        href={{ pathname: "/monthly", query: zscoreQuery }}
        scroll={false}
        className={cn(baseClass, lens === "zscore" ? activeClass : inactiveClass)}
      >
        Z-score
      </Link>
    </div>
  );
}

/** Two-column compact rotation card: top gainers (green) on the left,
 *  top losers (red) on the right. Δ shown in percentage points. */
function CategoryRotationCard({
  rotation,
}: {
  rotation: NonNullable<ReturnType<typeof categoryRotation>>;
}) {
  return (
    <Card
      title="Category Rotation"
      subtitle={`${rotation.windowMonths}M avg vs prior ${rotation.windowMonths}M · share of active-equity net inflow`}
      action={
        <InfoTooltip
          label={`For each category in the active-equity envelope, the trailing ${rotation.windowMonths}-month average net-inflow share (${rotation.currentRange.start} → ${rotation.currentRange.end}) is compared to the prior ${rotation.windowMonths}-month window (${rotation.priorRange.start} → ${rotation.priorRange.end}). Δ is the difference in percentage points. Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes.`}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <RotationList
          title="Gaining flow share"
          entries={rotation.gainers}
          accent="positive"
        />
        <RotationList
          title="Losing flow share"
          entries={rotation.losers}
          accent="negative"
        />
      </div>
    </Card>
  );
}

function RotationList({
  title,
  entries,
  accent,
}: {
  title: string;
  entries: NonNullable<ReturnType<typeof categoryRotation>>["gainers"];
  accent: "positive" | "negative";
}) {
  if (entries.length === 0) {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          No category moved meaningfully in this window.
        </div>
      </div>
    );
  }
  const deltaClass =
    accent === "positive" ? "text-positive" : "text-negative";
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {entries.map((e) => (
          <li
            key={e.slug}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="truncate" title={e.label}>
              {e.label}
            </span>
            <span className="shrink-0 inline-flex items-center gap-2 text-[11px] tabular">
              <span className="text-muted-foreground">
                {e.priorSharePct.toFixed(1)}% → {e.currentSharePct.toFixed(1)}%
              </span>
              <span className={cn("font-semibold", deltaClass)}>
                {e.deltaSharePct >= 0 ? "+" : ""}
                {e.deltaSharePct.toFixed(2)}pp
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact pill rendered in the action slot of each category-trend
 *  card: shows the category's latest-flow z-score with a tone
 *  indicator. Hot categories surface a positive green pill; cold
 *  categories a negative red pill; near-norm cards get a neutral
 *  pill. Null z-score → no pill. */
function CategoryHeatPill({ z }: { z: number | null }) {
  if (z === null || !Number.isFinite(z)) return null;
  const tone =
    z >= 1
      ? "border-positive/40 bg-positive/10 text-positive"
      : z <= -1
        ? "border-negative/40 bg-negative/10 text-negative"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tabular tracking-tight whitespace-nowrap",
        tone
      )}
    >
      {z >= 0 ? "+" : ""}
      {z.toFixed(2)}σ
    </span>
  );
}


