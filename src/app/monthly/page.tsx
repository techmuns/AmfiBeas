import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { ChartTypeToggle } from "@/components/ui/ChartTypeToggle";
import { BarsWithGrowth } from "@/components/charts/BarsWithGrowth";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import {
  adaptiveAverageOverlay,
  chartInsights,
  exponentialMovingAverage,
  latestYoyPct,
  slicedMovingAverage,
  yoyPctSeries,
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
  activeEquityMixSectionRead,
  foliosNfoSectionRead,
  kpiContext,
  latestAmfiMonthlyRow,
  sipTrendsSectionRead,
  snapshotSectionRead,
  latestIndustryFolioAdditions,
  latestProvenanceFor,
  activeEquityAumBridgeSnapshot,
  monthlyActiveEquityAumBridge,
  monthlyActiveEquityNetInflowTrend,
  monthlyActiveEquityShareTrend,
  monthlyActivePassiveTrend,
  monthlyEquityBreakdown,
  monthlyFlowsData,
  monthlyIndustryFolioAdditionsTrend,
  monthlySipAumShareTrend,
  monthlyTrend,
  nfoDragTrend,
  resolveSelectedRow,
  type AmfiMonthlyKpiField,
} from "@/data/amfi-monthly";
import type { AmfiMonthlyPdfRow } from "@/data/snapshots/types";
import {
  cyclePhaseHistory,
  historicalEpisodes,
  latestNifty500Row,
  marketIndexRows,
  weatherBadge,
} from "@/data/market-indices";
import { SankeyFlow } from "@/components/charts/SankeyFlow";
import { PassiveShareInEquity } from "@/components/amc/PassiveShareInEquity";
import { CalendarHeatGrid } from "@/components/ui/CalendarHeatGrid";
import { CategoryResilienceCard } from "@/components/ui/CategoryResilienceCard";
import { categoryDrawdownResilience } from "@/data/category-resilience";
import { EpisodeRecoveryCard } from "@/components/ui/EpisodeRecoveryCard";
import { episodeRecoveryRows } from "@/data/episode-recovery";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { marketWrap } from "@/data/market-wrap";
import { EpisodeReplayStrip } from "@/components/ui/EpisodeReplayStrip";
import { KeyTakeaway, DeltaCr } from "@/components/ui/KeyTakeaway";
import { StickyContextFooter } from "@/components/ui/StickyContextFooter";
import { LensToggle } from "@/components/ui/LensToggle";
import { VolatilityRibbon } from "@/components/ui/VolatilityRibbon";
import { WeatherBadge } from "@/components/ui/WeatherBadge";
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
  passiveFlowShareTrend,
} from "@/data/amfi-monthly-category";
import { topAumMarketShareSeries } from "@/data/amc-peer-universe";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { BridgeStrip } from "@/components/charts/BridgeStrip";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MonthPicker } from "@/components/filters/MonthPicker";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
  formatPercentile,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { TabIntroCard } from "@/components/ui/TabIntroCard";
import { resolveTab } from "@/lib/tabs";

const MONTHLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "flows", label: "Flows" },
  { id: "sip-retail", label: "SIP & Retail" },
  { id: "active-passive", label: "Active vs Passive" },
  { id: "nfo", label: "NFO" },
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

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const subtitle = `Industry-wide · ${latestMonth()}`;

  // ---- Lens toggles (parsed up-front so any chart below can read them).
  // Each chart owns its own URL param so the toggles don't collide.
  const heatmapLens: "share" | "zscore" =
    typeof sp.heatmap === "string" && sp.heatmap === "zscore"
      ? "zscore"
      : "share";
  const monthlyFlowsLens: "absolute" | "share" =
    sp.flowsLens === "share" ? "share" : "absolute";
  // Chart-type toggle for the Active Equity Net Inflows Bars + Growth
  // callsite on /monthly. Default is "trend" — only "bars" is echoed
  // back into the URL so canonical links stay clean.
  const aeFlowView: "trend" | "bars" =
    sp.aeFlowView === "bars" ? "bars" : "trend";
  // Visible-window range for the Active Equity Net Inflows card. The
  // full stored history runs back to 2019-04 (78 months); this toggle
  // lets the reader pick how much of it to show. Default 3Y. "all" maps
  // to a value larger than the stored history so the cap is a no-op.
  const aeFlowRange: "1y" | "3y" | "5y" | "all" =
    sp.aeFlowRange === "1y"
      ? "1y"
      : sp.aeFlowRange === "5y"
        ? "5y"
        : sp.aeFlowRange === "all"
          ? "all"
          : "3y";
  const aeFlowMonths =
    aeFlowRange === "1y"
      ? 12
      : aeFlowRange === "5y"
        ? 60
        : aeFlowRange === "all"
          ? 10_000
          : 36;
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
  const equityBreakdownLens: "absolute" | "share" | "indexed" =
    sp.equityMixLens === "share"
      ? "share"
      : sp.equityMixLens === "indexed"
        ? "indexed"
        : "absolute";
  // Per-card lens toggles. Each one switches a trend chart between
  // an absolute number (₹ Cr / count / etc) and a meaningful share
  // / ratio specific to that card. Default is "absolute" — URL stays
  // clean unless the user actively picked "share".
  const aaumLens: "absolute" | "share" =
    sp.aaumLens === "share" ? "share" : "absolute";
  const sipContribLens: "absolute" | "share" =
    sp.sipContribLens === "share" ? "share" : "absolute";
  const sipAumLens: "absolute" | "share" =
    sp.sipAumLens === "share" ? "share" : "absolute";
  const sipAccountsLens: "absolute" | "share" =
    sp.sipAccountsLens === "share" ? "share" : "absolute";
  const aeFlowLens: "absolute" | "share" =
    sp.aeFlowLens === "share" ? "share" : "absolute";
  const aeAaumLens: "absolute" | "share" =
    sp.aeAaumLens === "share" ? "share" : "absolute";
  // Visible-window range for the Active Equity AAUM Trend card. Mirrors
  // the Active Equity Net Inflows card: full stored history runs back to
  // 2019-04 (78 months); this toggle picks how much to show. Default 3Y.
  const aeAaumRange: "1y" | "3y" | "5y" | "all" =
    sp.aeAaumRange === "1y"
      ? "1y"
      : sp.aeAaumRange === "5y"
        ? "5y"
        : sp.aeAaumRange === "all"
          ? "all"
          : "3y";
  const aeAaumMonths =
    aeAaumRange === "1y"
      ? 12
      : aeAaumRange === "5y"
        ? 60
        : aeAaumRange === "all"
          ? 10_000
          : 36;
  const folioAddLens: "absolute" | "share" =
    sp.folioAddLens === "share" ? "share" : "absolute";
  const nfoCountLens: "absolute" | "share" =
    sp.nfoCountLens === "share" ? "share" : "absolute";
  const nfoFundsLens: "absolute" | "share" =
    sp.nfoFundsLens === "share" ? "share" : "absolute";
  // Pass-through params for every LensToggle so toggling A doesn't
  // lose B (or the selected month / active tab).
  const preservedQueryParams: Record<string, string | undefined> = {
    tab: typeof sp.tab === "string" ? sp.tab : undefined,
    month: typeof sp.month === "string" ? sp.month : undefined,
    heatmap: typeof sp.heatmap === "string" ? sp.heatmap : undefined,
    flowsLens: typeof sp.flowsLens === "string" ? sp.flowsLens : undefined,
    aeFlowView:
      typeof sp.aeFlowView === "string" ? sp.aeFlowView : undefined,
    aeFlowRange:
      typeof sp.aeFlowRange === "string" ? sp.aeFlowRange : undefined,
    equityMixLens:
      typeof sp.equityMixLens === "string" ? sp.equityMixLens : undefined,
    activePassiveLens:
      typeof sp.activePassiveLens === "string"
        ? sp.activePassiveLens
        : undefined,
    aaumLens: typeof sp.aaumLens === "string" ? sp.aaumLens : undefined,
    sipContribLens:
      typeof sp.sipContribLens === "string" ? sp.sipContribLens : undefined,
    sipContribPeriod:
      typeof sp.sipContribPeriod === "string" ? sp.sipContribPeriod : undefined,
    sipAumLens:
      typeof sp.sipAumLens === "string" ? sp.sipAumLens : undefined,
    sipAccountsLens:
      typeof sp.sipAccountsLens === "string" ? sp.sipAccountsLens : undefined,
    aeFlowLens:
      typeof sp.aeFlowLens === "string" ? sp.aeFlowLens : undefined,
    aeAaumLens:
      typeof sp.aeAaumLens === "string" ? sp.aeAaumLens : undefined,
    aeAaumRange:
      typeof sp.aeAaumRange === "string" ? sp.aeAaumRange : undefined,
    folioAddLens:
      typeof sp.folioAddLens === "string" ? sp.folioAddLens : undefined,
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
  const industryNetInflowPeerSeries = amfiMonthlyRows()
    .filter((r) => typeof r.netInflow === "number")
    .map((r) => ({ label: r.month, value: r.netInflow as number }));
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
  // Full history (un-sliced) so the 12M EMA has real prior data to draw
  // on for the leftmost visible months.
  const sipContribFullHistory = monthlyTrend("sipContribution", 10_000);
  // SIP-contribution-specific context for the ChartWithContext wrapper.
  // Denominator: industry net inflow that month — answers "what share
  // of the month's net flow came from systematic SIPs?".
  const sipContribLatestDenomCaption = (() => {
    const rows = amfiMonthlyRows();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (
        typeof r.sipContribution === "number" &&
        typeof r.netInflow === "number" &&
        r.netInflow > 0
      ) {
        const pct = (r.sipContribution / r.netInflow) * 100;
        return `${pct.toFixed(0)}% of industry net inflow · latest ${r.month}`;
      }
    }
    return undefined;
  })();
  const sipContribInsights = chartInsights(sipContribTrend, {
    metricName: "SIP contribution",
    unitSuffix: "₹ Cr",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    episodeAnchors: episodeAnchorsForInsights,
    yoyLag: 12,
    peer: {
      name: "industry net inflow",
      data: industryNetInflowPeerSeries,
    },
  });
  const sipAumTrend = monthlyTrend("sipAum", 24);
  const sipAumFullHistory = monthlyTrend("sipAum", 10_000);
  const sipAccountsTrend = monthlyTrend("sipAccounts", 24);
  const sipAccountsFullHistory = monthlyTrend("sipAccounts", 10_000);

  // SIP AUM denominator caption: latest SIP AUM as % of total AUM.
  const sipAumDenomCaption = (() => {
    const rows = amfiMonthlyRows();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (
        typeof r.sipAum === "number" &&
        typeof r.totalAum === "number" &&
        r.totalAum > 0
      ) {
        const pct = (r.sipAum / r.totalAum) * 100;
        return `${pct.toFixed(1)}% of total AUM · latest ${r.month}`;
      }
    }
    return undefined;
  })();
  const sipAumInsights = chartInsights(sipAumTrend, {
    metricName: "SIP AUM",
    unitSuffix: "₹ Cr",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });

  // SIP accounts denominator caption: accounts per ₹ Cr AUM (density).
  const sipAccountsDenomCaption = (() => {
    const rows = amfiMonthlyRows();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (
        typeof r.sipAccounts === "number" &&
        typeof r.totalAum === "number" &&
        r.totalAum > 0
      ) {
        const density = r.sipAccounts / r.totalAum;
        return `${density.toFixed(0)} SIP accounts per ₹ Cr AUM · latest ${r.month}`;
      }
    }
    return undefined;
  })();
  const sipAccountsInsights = chartInsights(sipAccountsTrend, {
    metricName: "SIP accounts",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    episodeAnchors: episodeAnchorsForInsights,
    yoyLag: 12,
  });

  const hasAnySipTrend =
    sipContribTrend.length > 0 ||
    sipAumTrend.length > 0 ||
    sipAccountsTrend.length > 0;

  // ---- "Share" series for each SIP card -----------------------------
  // Built once so the toggle below just picks between absolute and
  // share. Each share series uses the SAME row's denominator so the
  // ratio is computable without cross-row lookups; rows where the
  // denominator is missing or zero are filtered out.
  const sipContribShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.sipContribution === "number" &&
        typeof r.netInflow === "number" &&
        r.netInflow > 0
    )
    .map((r) => ({
      label: r.month,
      value: ((r.sipContribution as number) / (r.netInflow as number)) * 100,
    }))
    .slice(-sipContribMonths);
  const sipContribDisplay =
    sipContribLens === "share" ? sipContribShare : sipContribTrend;

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
    }))
    .slice(-24);
  const sipAumDisplay = sipAumLens === "share" ? sipAumShare : sipAumTrend;

  // SIP accounts density: accounts per ₹ Cr AUM. Accounts come in raw
  // count; totalAum is in ₹ Cr. The ratio is a pure scalar.
  const sipAccountsShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.sipAccounts === "number" &&
        typeof r.totalAum === "number" &&
        r.totalAum > 0
    )
    .map((r) => ({
      label: r.month,
      value: (r.sipAccounts as number) / (r.totalAum as number),
    }))
    .slice(-24);
  const sipAccountsDisplay =
    sipAccountsLens === "share" ? sipAccountsShare : sipAccountsTrend;

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
  const equityBreakdownSeries = [
    { key: "activeEquity", name: "Active Equity", color: "hsl(var(--chart-1))" },
    { key: "etfIndex", name: "ETF & Index", color: "hsl(var(--chart-5))" },
    { key: "arbitrage", name: "Arbitrage", color: "hsl(var(--chart-2))" },
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
  const activeEquityTrend = monthlyTrend("activeEquityAaum", aeAaumMonths);
  const activeEquityFullHistory = monthlyTrend("activeEquityAaum", 10_000);
  const activeEquityShareTrend = monthlyActiveEquityShareTrend(24);
  // Equity AAUM breakdown, restricted to months where ALL THREE series
  // (Active Equity / ETF & Index / Arbitrage) were extracted. Months
  // missing any segment — e.g. early-2020 reports that predate AMFI's
  // separate Solution-oriented Sub-Total — are dropped from BOTH the
  // ₹ Cr and the % view, so the share denominator is never a partial
  // sum (which previously rendered e.g. ETF & Index = 100% in Feb-2020).
  const equityBreakdown = monthlyEquityBreakdown(10_000).filter(
    (r) =>
      r.month >= "2019-05" &&
      typeof r.activeEquity === "number" &&
      typeof r.etfIndex === "number" &&
      typeof r.arbitrage === "number"
  );
  const equityBreakdownHasData = equityBreakdown.some(
    (r) => r.activeEquity !== null || r.etfIndex !== null || r.arbitrage !== null
  );
  const hasAnyEquityMix =
    activeEquityTrend.length > 0 ||
    activeEquityShareTrend.length > 0 ||
    equityBreakdownHasData;

  // Latest active/passive/arbitrage share of equity AAUM — surfaces the
  // proportion-first read at a glance in the breakdown subtitle.
  const latestEquityMix = (() => {
    for (let i = equityBreakdown.length - 1; i >= 0; i--) {
      const r = equityBreakdown[i];
      const a = r.activeEquity;
      const e = r.etfIndex;
      const x = r.arbitrage;
      if (typeof a === "number" && typeof e === "number" && typeof x === "number") {
        const total = a + e + x;
        if (total > 0) {
          return {
            month: r.month,
            activePct: (a / total) * 100,
            etfPct: (e / total) * 100,
            arbPct: (x / total) * 100,
          };
        }
      }
    }
    return null;
  })();
  // Indexed-to-start view: each series' SHARE of equity AAUM rebased
  // to 100 at its first available month. On a shared % axis the ETF &
  // Index share (~18%) is flattened by the much larger Active Equity
  // share (~85%), so a slow passive creep reads as a flat line. Here
  // each line shows its share's relative trajectory — ETF & Index
  // climbs above 100 while Active drifts below — decoupled from
  // absolute scale, and GroupedBars' dynamic y-domain tightens around
  // the resulting ~90-140 band so the movement is legible.
  const equityBreakdownIndexed = (() => {
    const keys = ["activeEquity", "etfIndex", "arbitrage"] as const;
    // Per-month 3-way shares — only when all three are present, so the
    // denominator is whole (no inflation from a missing segment).
    const shareRows = equityBreakdown.map((r) => {
      const allPresent = keys.every((k) => typeof r[k] === "number");
      const total = allPresent
        ? keys.reduce((s, k) => s + (r[k] as number), 0)
        : 0;
      const out: Record<string, number | null | string> = { month: r.month };
      for (const k of keys) {
        out[k] = allPresent && total > 0 ? ((r[k] as number) / total) * 100 : null;
      }
      return out;
    });
    const base: Record<string, number | null> = {};
    for (const k of keys) {
      const firstPoint = shareRows.find(
        (r) => typeof r[k] === "number" && (r[k] as number) > 0
      );
      base[k] = firstPoint ? (firstPoint[k] as number) : null;
    }
    return shareRows.map((r) => {
      const out: Record<string, number | null | string> = {
        month: r.month as string,
      };
      for (const k of keys) {
        const v = r[k];
        const b = base[k];
        out[k] =
          typeof v === "number" && typeof b === "number" && b > 0
            ? Math.round((v / b) * 100)
            : null;
      }
      return out;
    });
  })();
  // Share-mode equity breakdown: each segment as % of the month's
  // sum of Active + ETF & Index + Arbitrage. Months missing any
  // segment render that segment as null.
  const equityBreakdownDisplay =
    equityBreakdownLens === "share"
      ? equityBreakdown.map((r) =>
          toShareRow(r as Record<string, number | null | string>, [
            "activeEquity",
            "etfIndex",
            "arbitrage",
          ])
        )
      : equityBreakdownLens === "indexed"
        ? equityBreakdownIndexed
        : equityBreakdown;
  const equityBreakdownSubtitle = latestEquityMix
    ? `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · ₹ Cr · latest mix ${latestEquityMix.activePct.toFixed(1)}% Active / ${latestEquityMix.etfPct.toFixed(1)}% ETF & Index / ${latestEquityMix.arbPct.toFixed(1)}% Arbitrage`
    : `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · ₹ Cr · period-average · grouped bars`;

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

  // Active Equity AAUM share view: % of total industry AAUM.
  const activeEquityAaumShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.activeEquityAaum === "number" &&
        typeof r.totalAaum === "number" &&
        r.totalAaum > 0
    )
    .map((r) => ({
      label: r.month,
      value: ((r.activeEquityAaum as number) / (r.totalAaum as number)) * 100,
    }))
    .slice(-aeAaumMonths);
  const activeEquityAaumDisplay =
    aeAaumLens === "share" ? activeEquityAaumShare : activeEquityTrend;

  // Equity AAUM Breakdown denominator: ETF & Index share of equity AUM
  // = passive penetration. Most analytically interesting cross-data
  // point for this chart since the subtitle already shows the full
  // mix.
  const equityBreakdownDenomCaption = latestEquityMix
    ? `ETF & Index = ${latestEquityMix.etfPct.toFixed(1)}% of equity AUM · ${latestEquityMix.month}`
    : undefined;
  // Insight strip on the active-equity AAUM series — the dominant
  // segment and the one investors care about most.
  const activeEquityFromBreakdown = equityBreakdown
    .filter((r) => typeof r.activeEquity === "number")
    .map((r) => ({ label: r.month, value: r.activeEquity as number }));
  const equityBreakdownInsights = chartInsights(activeEquityFromBreakdown, {
    metricName: "active-equity AAUM",
    unitSuffix: "₹ Cr",
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
  const industryFolioAdditionsLatest = latestIndustryFolioAdditions();
  const industryNfoCountLatest =
    folioLatestRow && typeof folioLatestRow.industryNfoCount === "number"
      ? folioLatestRow.industryNfoCount
      : null;
  const industryNfoFundsLatest =
    folioLatestRow &&
    typeof folioLatestRow.industryNfoFundsMobilized === "number"
      ? folioLatestRow.industryNfoFundsMobilized
      : null;

  const folioAdditionsTrend = monthlyIndustryFolioAdditionsTrend(24);
  const folioAdditionsFullHistory = monthlyIndustryFolioAdditionsTrend(10_000);
  const nfoCountTrend = monthlyTrend("industryNfoCount", 24);
  const nfoCountFullHistory = monthlyTrend("industryNfoCount", 10_000);
  const nfoFundsTrend = monthlyTrend("industryNfoFundsMobilized", 24);
  const nfoFundsFullHistory = monthlyTrend("industryNfoFundsMobilized", 10_000);
  const foliosCtx = kpiContext("industryFolios", 24);
  const nfoCountCtx = kpiContext("industryNfoCount", 24);
  const nfoFundsCtx = kpiContext("industryNfoFundsMobilized", 24);

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

  // NFO count denominator: latest as % of trailing 5Y (60M) average.
  // 2019-era rows are unit-bugged (1900+ NFOs/month) so we clamp
  // anything > 200 — well above any plausible monthly count.
  const NFO_COUNT_PLAUSIBLE_CAP = 200;
  const nfoCountDenomCaption = (() => {
    const allNfoMonths = amfiMonthlyRows()
      .map((r) => r.industryNfoCount)
      .filter(
        (v): v is number => typeof v === "number" && v <= NFO_COUNT_PLAUSIBLE_CAP
      );
    if (allNfoMonths.length < 12) return undefined;
    const trailing60 = allNfoMonths.slice(-60);
    const avg = trailing60.reduce((s, v) => s + v, 0) / trailing60.length;
    if (avg <= 0) return undefined;
    const latest = nfoCountTrend[nfoCountTrend.length - 1];
    if (!latest) return undefined;
    const pct = (latest.value / avg) * 100;
    return `${pct.toFixed(0)}% of 5Y monthly avg (${avg.toFixed(0)}/mo) · latest ${latest.label}`;
  })();
  const nfoCountInsights = chartInsights(nfoCountTrend, {
    metricName: "NFO launches",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    episodeAnchors: episodeAnchorsForInsights,
    yoyLag: 12,
  });

  // NFO funds denominator: latest as % of industry net inflow that month.
  const nfoFundsDenomCaption = (() => {
    if (
      !folioLatestRow ||
      typeof folioLatestRow.industryNfoFundsMobilized !== "number" ||
      typeof folioLatestRow.netInflow !== "number" ||
      folioLatestRow.netInflow <= 0
    )
      return undefined;
    const pct =
      (folioLatestRow.industryNfoFundsMobilized / folioLatestRow.netInflow) *
      100;
    return `${pct.toFixed(1)}% of industry net inflow · latest ${folioLatestRow.month}`;
  })();
  const nfoFundsInsights = chartInsights(nfoFundsTrend, {
    metricName: "NFO funds mobilised",
    unitSuffix: "₹ Cr",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    episodeAnchors: episodeAnchorsForInsights,
    yoyLag: 12,
    peer: {
      name: "industry net inflow",
      data: industryNetInflowPeerSeries,
    },
  });

  // ---- "Share" series for folio + NFO toggle ------------------------
  const folioAdditionsShare = (() => {
    // For each month with a folio-additions value, expressed as % of
    // the existing folio base. Both `value` (additions) and the folio
    // base are stored as raw counts in the snapshot; the ratio is
    // therefore additions ÷ base × 100.
    const out: { label: string; value: number }[] = [];
    const rows = amfiMonthlyRows();
    const folioByMonth = new Map<string, number>();
    for (const r of rows) {
      if (typeof r.industryFolios === "number") {
        folioByMonth.set(r.month, r.industryFolios);
      }
    }
    for (const p of folioAdditionsTrend) {
      const base = folioByMonth.get(p.label);
      if (typeof base !== "number" || base <= 0) continue;
      const pct = (p.value / base) * 100;
      out.push({ label: p.label, value: pct });
    }
    return out;
  })();
  const folioAdditionsDisplay =
    folioAddLens === "share" ? folioAdditionsShare : folioAdditionsTrend;

  // NFO launches: % of trailing 5Y (60M) average. The plausibility
  // cap from the denominator caption is reused via the shared
  // constant declared above.
  const nfoCountShare = (() => {
    const allValid = amfiMonthlyRows()
      .map((r) => r.industryNfoCount)
      .filter(
        (v): v is number =>
          typeof v === "number" && v <= NFO_COUNT_PLAUSIBLE_CAP
      );
    if (allValid.length < 12) return [];
    const trailing60 = allValid.slice(-60);
    const avg = trailing60.reduce((s, v) => s + v, 0) / trailing60.length;
    if (avg <= 0) return [];
    return nfoCountTrend.map((p) => ({
      label: p.label,
      value: (p.value / avg) * 100,
    }));
  })();
  const nfoCountDisplay =
    nfoCountLens === "share" ? nfoCountShare : nfoCountTrend;

  // NFO funds: % of industry net inflow that month.
  const nfoFundsShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.industryNfoFundsMobilized === "number" &&
        typeof r.netInflow === "number" &&
        r.netInflow > 0
    )
    .map((r) => ({
      label: r.month,
      value:
        ((r.industryNfoFundsMobilized as number) / (r.netInflow as number)) *
        100,
    }))
    .slice(-24);
  const nfoFundsDisplay =
    nfoFundsLens === "share" ? nfoFundsShare : nfoFundsTrend;

  const foliosHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("industryFolios")
  );
  const nfoCountHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("industryNfoCount")
  );
  const nfoFundsHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("industryNfoFundsMobilized")
  );
  const nfoCountSourceLine =
    formatKpiProvenanceLine(latestProvenanceFor("industryNfoCount")) ?? "";
  const nfoFundsSourceLine =
    formatKpiProvenanceLine(latestProvenanceFor("industryNfoFundsMobilized")) ?? "";

  const hasAnyFolioOrNfo =
    industryFoliosLatest !== null ||
    industryNfoCountLatest !== null ||
    industryNfoFundsLatest !== null;
  const hasAnyFolioOrNfoTrend =
    folioAdditionsTrend.length > 0 ||
    nfoCountTrend.length > 0 ||
    nfoFundsTrend.length > 0;

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
  const activeEquityFlowTrend = monthlyActiveEquityNetInflowTrend(aeFlowMonths);
  const activeEquityFlowFullHistory = monthlyActiveEquityNetInflowTrend(10_000);
  // YoY (lag=12) for the Bars + Growth view on the Active Equity Net
  // Inflow card. Same full-history computation pattern as the equity
  // flow card above.
  const aeFlowYoyByLabel = new Map(
    yoyPctSeries(activeEquityFlowFullHistory, 12).map((p) => [p.label, p.value])
  );
  const aeFlowBarsData = activeEquityFlowTrend.map((p) => ({
    label: p.label,
    value: p.value,
    growthPct: aeFlowYoyByLabel.get(p.label) ?? null,
  }));
  const activeEquityBridge = monthlyActiveEquityAumBridge(24);
  const activeEquityBridgeStrip = activeEquityAumBridgeSnapshot(12);
  const sipAumShareTrend = monthlySipAumShareTrend(24);
  const hasActiveEquityFlowDiagnostics =
    activeEquityFlowTrend.length > 0 ||
    activeEquityBridge.length > 0 ||
    sipAumShareTrend.length > 0;

  // Active Equity Net Inflow denominator: latest month's active-equity
  // net inflow as a % of industry net inflow that month — answers
  // "what share of the month's total flow ended up in active equity?".
  const activeEquityFlowDenomCaption = (() => {
    if (activeEquityFlowTrend.length === 0) return undefined;
    const latest = activeEquityFlowTrend[activeEquityFlowTrend.length - 1];
    const rows = amfiMonthlyRows();
    const peerRow = rows.find((r) => r.month === latest.label);
    if (
      !peerRow ||
      typeof peerRow.netInflow !== "number" ||
      peerRow.netInflow === 0
    )
      return undefined;
    const pct = (latest.value / peerRow.netInflow) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% of industry net inflow · latest ${latest.label}`;
  })();
  const activeEquityFlowInsights = chartInsights(activeEquityFlowTrend, {
    metricName: "active-equity net inflow",
    unitSuffix: "₹ Cr",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    episodeAnchors: episodeAnchorsForInsights,
    yoyLag: 12,
    peer: {
      name: "industry net inflow",
      data: industryNetInflowPeerSeries,
    },
  });

  // Active Equity Flow share view: % of industry net inflow that
  // month. Same pattern as SIP contribution share — clearer "who's
  // pulling the flow" read than the absolute ₹ Cr.
  const activeEquityFlowShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.activeEquityNetInflow === "number" &&
        typeof r.netInflow === "number" &&
        r.netInflow !== 0
    )
    .map((r) => ({
      label: r.month,
      value:
        ((r.activeEquityNetInflow as number) / (r.netInflow as number)) * 100,
    }))
    .slice(-24);
  const activeEquityFlowDisplay =
    aeFlowLens === "share" ? activeEquityFlowShare : activeEquityFlowTrend;

  // Active Equity AUM Bridge — single-series chartInsights doesn't
  // map cleanly to a 2-series bridge. We surface the analytical
  // denominator as "market impact made up X% of the latest ΔAUM"
  // and run insights on the synthetic ΔAUM series so the strip
  // still reads as a coherent narrative about the bridge.
  const activeEquityBridgeDenomCaption = (() => {
    if (activeEquityBridge.length === 0) return undefined;
    const latest = activeEquityBridge[activeEquityBridge.length - 1];
    const net = latest.netInflow;
    const mkt = latest.marketResidual;
    if (typeof net !== "number" || typeof mkt !== "number") return undefined;
    const total = Math.abs(net) + Math.abs(mkt);
    if (total === 0) return undefined;
    const mktPct = (Math.abs(mkt) / total) * 100;
    return `Market impact = ${mktPct.toFixed(0)}% of latest ΔAUM magnitude · ${latest.month}`;
  })();
  const activeEquityBridgeDeltaSeries = activeEquityBridge
    .filter(
      (r) =>
        typeof r.netInflow === "number" && typeof r.marketResidual === "number"
    )
    .map((r) => ({
      label: r.month,
      value: (r.netInflow as number) + (r.marketResidual as number),
    }));
  const activeEquityBridgeInsights = chartInsights(
    activeEquityBridgeDeltaSeries,
    {
      metricName: "ΔAUM",
      unitSuffix: "₹ Cr",
      drawdownByLabel: ddByMonthForInsights,
      cyclePhaseByLabel: cyclePhaseByMonth,
      episodeAnchors: episodeAnchorsForInsights,
    }
  );

  // Proportion diagnostics: category rotation, NFO drag, passive flow share.
  // Each renders independently under its own tab now (rotation in categories,
  // nfoDrag in nfo, passiveFlowShare in active-passive), so there's no
  // longer a combined visibility gate.
  const rotation = categoryRotation(3, 5);
  const nfoDrag = nfoDragTrend(24);
  // Wide window + sanitize so the card shows the full clean history
  // (outflow-distorted months dropped) and the footer mean / percentile
  // describe the same set of months that are actually plotted.
  const passiveFlowShare = passiveFlowShareTrend(120, { sanitize: true });

  // The headline active-equity flow signal — feeds the weather badge
  // and the market-tape / sticky context footer at the foot of the page.
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
  // Market Wrap — the three-sentence "today's read" surfaced at
  // the top of the page. Composed off cycle phase, SIP, and an
  // anomaly scan across headline series.
  const marketWrapData = marketWrap();
  // Sankey data — composes SIP vs Lump-sum on the source side, and
  // Equity / Debt / Liquid / Other on the target side, all from the
  // latest month with usable totals. Links are proportional shares
  // (source-pct × target-pct × total).
  const sankeyData: {
    month: string;
    sources: { id: string; label: string; tone?: "positive" | "negative" | "neutral" }[];
    targets: { id: string; label: string; tone?: "positive" | "negative" | "neutral" }[];
    links: { source: string; target: string; value: number }[];
  } | null = (() => {
    const latestRow = latestAmfiMonthlyRow();
    if (
      !latestRow ||
      typeof latestRow.netInflow !== "number" ||
      typeof latestRow.equityNetInflow !== "number" ||
      typeof latestRow.debtNetInflow !== "number" ||
      typeof latestRow.liquidNetInflow !== "number" ||
      typeof latestRow.sipContribution !== "number"
    )
      return null;
    const total = latestRow.netInflow;
    if (total <= 0) return null;
    const sip = Math.max(0, latestRow.sipContribution);
    const lumpSum = Math.max(0, total - sip);
    const equity = Math.max(0, latestRow.equityNetInflow);
    const debtPure = Math.max(0, latestRow.debtNetInflow - latestRow.liquidNetInflow);
    const liquid = Math.max(0, latestRow.liquidNetInflow);
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
      month: latestRow.month,
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
  const weather = weatherBadge({
    drawdownPct: latestNifty?.drawdownPct ?? null,
    flowZScore: activeEquitySignal?.zScore ?? null,
    cyclePhase: latestCyclePhase,
  });
  // Section reads — short data-driven 1-liners surfaced under
  // each section title.
  const snapshotRead = snapshotSectionRead();
  const sipTrendsRead = sipTrendsSectionRead();
  const activeEquityMixRead = activeEquityMixSectionRead();
  const foliosNfoRead = foliosNfoSectionRead();

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
    const lf = monthlyFlowsRows[monthlyFlowsRows.length - 1];
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
        action={<WeatherBadge headline={weather.headline} tone={weather.tone} />}
      />

      {activeTab !== "snapshot" && activeTab !== "flows" && (
        <MarketWrapCard wrap={marketWrapData} />
      )}

      {activeTab === "flows" && sankeyData && (() => {
        const sankeyGrandTotal = sankeyData.links.reduce(
          (s, l) => s + Math.abs(l.value),
          0
        );
        const formatSankeyPct = (v: number) =>
          sankeyGrandTotal > 0
            ? `${((v / sankeyGrandTotal) * 100).toFixed(1)}%`
            : "";
        const sankeyMonthLabel = (() => {
          const FULL_MONTHS = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
          ];
          const [y, m] = sankeyData.month.split("-");
          const idx = Number(m) - 1;
          return Number.isFinite(idx) && idx >= 0 && idx < 12
            ? `${FULL_MONTHS[idx]} ${y}`
            : sankeyData.month;
        })();
        return (
          <Card
            title={`Where the Money Went · ${sankeyMonthLabel}`}
            subtitleNode={
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">
                  Industry net flow split by where the money came from and where it ended up.
                </p>
                <p className="text-[11px] text-muted-foreground/80">
                  Latest month: {sankeyData.month}
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
      })()}

      {activeTab === "snapshot" && (
      <Card
        title="AMFI Monthly Snapshot"
        subtitle={
          snapshotRead && amfiSelected
            ? `${amfiSectionSubtitle} · ${snapshotRead}`
            : amfiSectionSubtitle
        }
        action={
          <div className="flex flex-col items-end gap-2">
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
            {amfiSelected && amfiAvailableMonths.length > 0 && (
              <MonthPicker
                availableMonths={amfiAvailableMonths}
                selectedMonth={amfiSelected.month}
              />
            )}
          </div>
        }
      >
        {netInflowHeadline && (
          <KeyTakeaway
            className="mb-4"
            headline={
              <>
                Industry net inflow in {netInflowHeadline.month} was ₹
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
          <GroupedBars
            data={monthlyFlowsDisplay}
            xKey="month"
            labelFormat="month"
            valueFormat={monthlyFlowsLens === "share" ? "pct" : "cr"}
            axisFormat={monthlyFlowsLens === "share" ? "pct" : "cr"}
            bars={monthlyFlowsSeries}
          />
        </ChartWithContext>
      )}

      {activeTab === "sip-retail" && (
        <TabIntroCard
          headline="Is systematic retail flow holding up?"
          summary="SIP contribution, SIP AUM and folio additions show whether investor participation is broad, growing, and sticky — or starting to thin."
          watchNext="Whether SIP contribution growth stays above the folio-base growth rate."
        />
      )}

      {activeTab === "sip-retail" && hasAnySipTrend && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">SIP Trends</h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {sipTrendsRead ? ` · ${sipTrendsRead}` : ""}
            </p>
          </div>
          {/* SIP Contribution leads full-width — it carries the deepest
              history (period toggle, cycle bands). SIP AUM + SIP
              Contributing Accounts sit 2-up below it. */}
          <section className="space-y-4">
            <ChartWithContext
              title="SIP Contribution Trend"
              subtitle="Gross monthly SIP inflows. Shows how much retail money entered through SIPs."
              flowKind="gross"
              denominatorCaption={(() => {
                if (sipContribLens === "share") {
                  return `${sipContribShare.length} month${sipContribShare.length === 1 ? "" : "s"} · % of industry net inflow`;
                }
                const span = `${sipContribTrend.length} month${sipContribTrend.length === 1 ? "" : "s"}`;
                return sipContribLatestDenomCaption
                  ? `${span} · ₹ Cr · ${sipContribLatestDenomCaption}`
                  : `${span} · ₹ Cr`;
              })()}
              denominatorTooltip="SIP gross contribution as a share of industry net inflow. Rising share = retail systematic flow is doing more of the heavy lifting; falling share = lump-sum / institutional money dominates."
              insights={sipContribInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipContribTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <>
                  <LensToggle
                    basePath="/monthly"
                    paramName="sipContribPeriod"
                    defaultValue="all"
                    lenses={[
                      { value: "1y", label: "1Y" },
                      { value: "3y", label: "3Y" },
                      { value: "5y", label: "5Y" },
                      { value: "all", label: "All" },
                    ]}
                    active={sipContribRange}
                    preserveParams={preservedQueryParams}
                  />
                  <LensToggle
                    basePath="/monthly"
                    paramName="sipContribLens"
                    defaultValue="absolute"
                    lenses={[
                      { value: "absolute", label: "₹ Cr" },
                      { value: "share", label: "% of net inflow" },
                    ]}
                    active={sipContribLens}
                    preserveParams={preservedQueryParams}
                  />
                </>
              }
            >
              {sipContribTrend.length > 0 ? (() => {
                // Absolute (₹ Cr) view overlays a 12-month EMA dotted line
                // seeded over the full SIP history, then sliced to the
                // visible window. Share view shows no overlay.
                const useOverlay = sipContribLens !== "share";
                const ema = useOverlay
                  ? exponentialMovingAverage(sipContribFullHistory, 12).slice(
                      -sipContribDisplay.length
                    )
                  : undefined;
                const bands = renderedCycleBands(
                  cyclePhaseBands,
                  sipContribDisplay.map((p) => p.label)
                );
                return (
                  <>
                    <BarSeries
                      data={sipContribDisplay}
                      name="SIP Contribution"
                      color="hsl(var(--chart-1))"
                      valueFormat={sipContribLens === "share" ? "pct" : "cr"}
                      axisFormat={sipContribLens === "share" ? "pct" : "cr"}
                      labelFormat="month"
                      trendline={ema}
                      trendlineName={ema ? "12-month EMA" : undefined}
                      cyclePhaseBands={bands}
                      dynamicYDomain={sipContribLens === "share"}
                    />
                    <CyclePhaseLegend bands={bands} />
                  </>
                );
              })() : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  SIP contribution not yet ingested — appears once the next AMFI Monthly Notes (press release) lands.
                </div>
              )}
            </ChartWithContext>

            <div className="grid gap-4 lg:grid-cols-2">
            <ChartWithContext
              title="SIP AUM Trend"
              subtitle="Period-end SIP assets. Higher share means stickier retail AUM."
              flowKind="stock"
              denominatorCaption={(() => {
                if (sipAumLens === "share") {
                  return `${sipAumShare.length} month${sipAumShare.length === 1 ? "" : "s"} · % of total industry AUM`;
                }
                const span = `${sipAumTrend.length} month${sipAumTrend.length === 1 ? "" : "s"}`;
                return sipAumDenomCaption
                  ? `${span} · ₹ Cr · ${sipAumDenomCaption}`
                  : `${span} · ₹ Cr`;
              })()}
              denominatorTooltip="SIP AUM as a % of total industry AUM. Captures how much of the industry's asset base sits in committed, recurring flows — a structural-stability indicator."
              insights={sipAumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipAumTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/monthly"
                  paramName="sipAumLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "% of total AUM" },
                  ]}
                  active={sipAumLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {sipAumTrend.length > 0 ? (() => {
                // Absolute (₹ Cr) view overlays a 12-month EMA dotted line
                // seeded over the full SIP history, then sliced to the
                // visible window. Share view shows no overlay.
                const useOverlay = sipAumLens !== "share";
                const ema = useOverlay
                  ? exponentialMovingAverage(sipAumFullHistory, 12).slice(
                      -sipAumDisplay.length
                    )
                  : undefined;
                const bands = renderedCycleBands(
                  cyclePhaseBands,
                  sipAumDisplay.map((p) => p.label)
                );
                return (
                  <>
                    <BarSeries
                      data={sipAumDisplay}
                      name="SIP AUM"
                      color="hsl(var(--chart-2))"
                      valueFormat={sipAumLens === "share" ? "pct" : "cr"}
                      axisFormat={sipAumLens === "share" ? "pct" : "cr"}
                      labelFormat="month"
                      trendline={ema}
                      trendlineName={ema ? "12-month EMA" : undefined}
                      cyclePhaseBands={bands}
                      dynamicYDomain={sipAumLens === "share"}
                    />
                    <CyclePhaseLegend bands={bands} />
                  </>
                );
              })() : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  SIP AUM not yet ingested — appears once the next AMFI Monthly Notes (press release) lands.
                </div>
              )}
            </ChartWithContext>

            <ChartWithContext
              title="SIP Contributing Accounts Trend"
              subtitle="Number of live SIP accounts. Captures retail breadth."
              flowKind="stock"
              denominatorCaption={(() => {
                if (sipAccountsLens === "share") {
                  return `${sipAccountsShare.length} month${sipAccountsShare.length === 1 ? "" : "s"} · accounts per ₹ Cr AUM`;
                }
                const span = `${sipAccountsTrend.length} month${sipAccountsTrend.length === 1 ? "" : "s"}`;
                return sipAccountsDenomCaption
                  ? `${span} · ${sipAccountsDenomCaption}`
                  : span;
              })()}
              denominatorTooltip="SIP accounts per ₹ Cr of industry AUM — a density measure of investor participation per unit of capital. Rising = more retail-density per Cr; falling = AUM growing faster than account base."
              insights={sipAccountsInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipAccountsTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/monthly"
                  paramName="sipAccountsLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "Count" },
                    { value: "share", label: "Per ₹ Cr AUM" },
                  ]}
                  active={sipAccountsLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {sipAccountsTrend.length > 0 ? (() => {
                // Absolute (count) view overlays a 12-month EMA dotted line
                // seeded over the full SIP history, then sliced to the
                // visible window. Share view shows no overlay.
                const useOverlay = sipAccountsLens !== "share";
                const ema = useOverlay
                  ? exponentialMovingAverage(sipAccountsFullHistory, 12).slice(
                      -sipAccountsDisplay.length
                    )
                  : undefined;
                const bands = renderedCycleBands(
                  cyclePhaseBands,
                  sipAccountsDisplay.map((p) => p.label)
                );
                return (
                  <>
                    <BarSeries
                      data={sipAccountsDisplay}
                      name="SIP Accounts"
                      color="hsl(var(--chart-3))"
                      valueFormat={sipAccountsLens === "share" ? "count" : "crore-count"}
                      axisFormat={sipAccountsLens === "share" ? "count" : "crore-count"}
                      labelFormat="month"
                      trendline={ema}
                      trendlineName={ema ? "12-month EMA" : undefined}
                      cyclePhaseBands={bands}
                      dynamicYDomain={sipAccountsLens === "share"}
                    />
                    <CyclePhaseLegend bands={bands} />
                  </>
                );
              })() : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  SIP accounts not yet ingested — appears once the next AMFI Monthly Notes (press release) lands.
                </div>
              )}
            </ChartWithContext>
            </div>
          </section>
        </div>
      )}

      {activeTab === "flows" && hasActiveEquityFlowDiagnostics && (
        <>
          {/* Active Equity Net Inflows: full-width on its own row. The
              card packs Basis + YoY + LensToggle + ChartTypeToggle —
              too many controls for a 2-up grid. Bridge card sits below
              on its own row for the same reason. */}
          {activeEquityFlowTrend.length > 0 && (
            <ChartWithContext
              title="Active Equity Net Inflows"
              subtitle="Monthly active-equity net inflow. Positive values mean money entered active equity funds."
              flowKind="net"
              denominatorCaption={(() => {
                if (aeFlowView === "bars") {
                  return `${activeEquityFlowTrend.length} month${activeEquityFlowTrend.length === 1 ? "" : "s"} · ₹ Cr · YoY growth overlaid`;
                }
                if (aeFlowLens === "share") {
                  return `${activeEquityFlowShare.length} month${activeEquityFlowShare.length === 1 ? "" : "s"} · % of industry net inflow`;
                }
                const span = `${activeEquityFlowTrend.length} month${activeEquityFlowTrend.length === 1 ? "" : "s"}`;
                return activeEquityFlowDenomCaption
                  ? `${span} · ₹ Cr · ${activeEquityFlowDenomCaption}`
                  : `${span} · ₹ Cr`;
              })()}
              denominatorTooltip={
                aeFlowView === "bars"
                  ? undefined
                  : "Latest active-equity net inflow as a % of industry net inflow for the same month — captures how much of the month's flow ended up in the active-equity envelope."
              }
              insights={activeEquityFlowInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(activeEquityFlowTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <>
                  <LensToggle
                    basePath="/monthly"
                    paramName="aeFlowRange"
                    defaultValue="3y"
                    lenses={[
                      { value: "1y", label: "1Y" },
                      { value: "3y", label: "3Y" },
                      { value: "5y", label: "5Y" },
                      { value: "all", label: "All" },
                    ]}
                    active={aeFlowRange}
                    preserveParams={preservedQueryParams}
                  />
                  <ChartTypeToggle
                    basePath="/monthly"
                    paramName="aeFlowView"
                    active={aeFlowView}
                    preserveParams={preservedQueryParams}
                  />
                </>
              }
            >
              {aeFlowView === "bars" ? (
                <BarsWithGrowth
                  data={aeFlowBarsData}
                  barColor="hsl(var(--chart-1))"
                  growthColor="hsl(var(--foreground))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                  name="Active Equity net inflow"
                  growthLabel="YoY %"
                />
              ) : (() => {
                const useOverlay = aeFlowLens !== "share";
                const trailingAvg = slicedMovingAverage(
                  activeEquityFlowFullHistory,
                  12,
                  activeEquityFlowDisplay.length
                );
                const flowCycleBands = renderedCycleBands(
                  cyclePhaseBands,
                  activeEquityFlowDisplay.map((p) => p.label as string)
                );
                return (
                  <>
                    <BarSeries
                      data={activeEquityFlowDisplay}
                      name="Active Equity Net Inflow"
                      color="hsl(var(--chart-1))"
                      valueFormat={aeFlowLens === "share" ? "pct" : "cr"}
                      axisFormat={aeFlowLens === "share" ? "pct" : "cr"}
                      labelFormat="month"
                      signedFill="single"
                      trendline={useOverlay ? trailingAvg : undefined}
                      trendlineName={useOverlay ? "Trailing 12-month avg" : undefined}
                      cyclePhaseBands={flowCycleBands}
                    />
                    {aeFlowLens === "absolute" && (
                      <div className="mt-2">
                        <VolatilityRibbon series={activeEquityFlowTrend} />
                      </div>
                    )}
                    <CyclePhaseLegend bands={flowCycleBands} />
                  </>
                );
              })()}
              <HowToRead>
                {aeFlowView === "bars" ? (
                  <p>
                    Bars are the monthly net inflow in ₹ Cr; the dashed line
                    (right axis) is its YoY % change, which strips seasonality so
                    you can see whether a month beat the same month a year ago.
                    YoY is suppressed (shown as &ldquo;—&rdquo;, with a gap in the
                    line) for months whose year-ago base was near-zero or
                    sign-flipped, because the % there is a base-effect artefact,
                    not real momentum. The clearest example:{" "}
                    <span className="font-medium text-foreground/80">
                      November 2022 was a rare active-equity net <em>outflow</em>{" "}
                      (−₹51.5 Cr)
                    </span>
                    , so November 2023&apos;s inflow of ₹19.9K Cr would otherwise
                    read a meaningless <span className="text-negative font-medium">+38,654%</span>{" "}
                    YoY — a year-on-year &ldquo;growth&rdquo; across an
                    outflow→inflow swing is undefined, so we hide it rather than
                    print the exploded figure.
                  </p>
                ) : (
                  <p className="inline-flex items-start gap-1.5">
                    <span>
                      The solid line is monthly active-equity net inflow — fresh
                      money minus redemptions across equity, hybrid (ex-arbitrage)
                      and solution-oriented schemes. The dashed line is its
                      trailing 12-month average. The thin strip beneath shades any
                      month whose move was ≥ ±2σ versus the series&apos; own
                      history — sharp jumps green, sharp drops red.
                    </span>
                    <InfoTooltip label="Active-equity envelope = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
                  </p>
                )}
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    <span className="font-medium text-foreground/80">
                      Why it rarely turns negative:
                    </span>{" "}
                    active-equity flow is anchored by automated monthly SIPs,
                    which keep buying through corrections. A dip usually means
                    lump-sum or HNI profit-booking after a rally — not retail
                    stopping — so an actual negative print is a genuine demand
                    event worth flagging.
                  </li>
                  <li>
                    <span className="font-medium text-foreground/80">
                      Why it&apos;s the number to watch for AMCs:
                    </span>{" "}
                    active equity is the industry&apos;s highest-margin book (top
                    expense-ratio yield), so a sustained rise lifts high-margin
                    AUM and tends to show up in listed-AMC revenue and profit a
                    quarter or two later — this line leads earnings.
                  </li>
                  {aeFlowView !== "bars" && (
                    <li>
                      <span className="font-medium text-foreground/80">
                        The trailing-average gap is the signal:
                      </span>{" "}
                      when the line runs above its 12-month average, demand is
                      hotter than its own recent norm (risk-on, often late-cycle);
                      sustained months below have historically front-run AUM-growth
                      slowdowns, and a clean break back above flags re-acceleration.
                      The crossing matters more than the absolute ₹ figure.
                    </li>
                  )}
                </ul>
              </HowToRead>
            </ChartWithContext>
          )}

          {activeEquityBridgeStrip && (
            <ChartWithContext
              title="Active Equity AUM Bridge"
              subtitle="How active-equity AAUM moved this window: opening → net flow → market → closing."
              flowKind="gross"
              denominatorCaption={(() => {
                const span = `${activeEquityBridgeStrip.windowMonths}-month window`;
                return activeEquityBridgeDenomCaption
                  ? `${span} · ${activeEquityBridgeDenomCaption}`
                  : span;
              })()}
              denominatorTooltip="Net flow vs market / residual share of the trailing-window ΔAUM — tells you whether AAUM growth was driven by money in or by mark-to-market."
              insights={activeEquityBridgeInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(activeEquityBridgeDeltaSeries, 12);
                return v === null ? undefined : { label: "ΔAUM YoY", pct: v };
              })()}
            >
                <BridgeStrip
                  data={{
                    startLabel: activeEquityBridgeStrip.startMonth,
                    endLabel: activeEquityBridgeStrip.endMonth,
                    openingValue: activeEquityBridgeStrip.openingAum,
                    netFlowContribution: activeEquityBridgeStrip.netInflowTotal,
                    marketResidualContribution:
                      activeEquityBridgeStrip.marketResidualTotal,
                    closingValue: activeEquityBridgeStrip.closingAum,
                    sparkline: activeEquityBridgeStrip.deltaSparkline,
                    subject: "Active Equity AAUM",
                  }}
                />
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Market / residual = ΔAUM − net inflow, summed across the window.
                  <InfoTooltip label="Captures mark-to-market and minor reclassification effects on the active-equity envelope. AUM uses month-end values." />
                </p>
              </ChartWithContext>
            )}
        </>
      )}

      {activeTab === "nfo" && (
        <TabIntroCard
          headline="How active is the NFO pipeline?"
          summary="NFO launches and gross funds mobilised — new money raised by new schemes vs absorbed by existing ones. The leading indicator of fund-launch sentiment and AMC product appetite."
          watchNext="Whether NFO drag falls back below its 5-year norm as winning categories absorb most of the flow."
        />
      )}

      {activeTab === "categories" && (
        <TabIntroCard
          headline="Where is flow rotating across categories?"
          summary="Category-level QAAUM share and net-inflow share inside the active-equity envelope, plus the rotation magnitude and category heatmap. Read for which categories are winning new money — and which ones investors trust through drawdowns."
          watchNext="Which categories show a sustained rise in net-inflow share before AUM share follows."
        />
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

      {activeTab === "nfo" && nfoDrag && (
        <NfoDragCard trend={nfoDrag} />
      )}

      {activeTab === "active-passive" && passiveFlowShare && (
        <PassiveFlowShareCard trend={passiveFlowShare} />
      )}

      {activeTab === "sip-retail" && hasAnyFolioOrNfo && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Industry Folios
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {foliosNfoRead ? ` · ${foliosNfoRead}` : ""}
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2">
            <KpiCard
              label="Folios"
              value={formatCroreCountSafe(industryFoliosLatest)}
              note=""
              noteHover={foliosHover ?? undefined}
              sparkline={foliosCtx.sparkline}
              sparklineColor="hsl(var(--chart-4))"
              yoyPct={foliosCtx.yoyPct}
              percentile={foliosCtx.percentile}
              ratio={
                folioLatestRow &&
                typeof folioLatestRow.industryFolios === "number" &&
                typeof folioLatestRow.totalAum === "number" &&
                folioLatestRow.totalAum > 0
                  ? `${(folioLatestRow.industryFolios / folioLatestRow.totalAum).toFixed(1)} folios per ₹ Cr AUM`
                  : undefined
              }
            />
            <KpiCard
              label="Folio Additions"
              value={formatLakhSafe(industryFolioAdditionsLatest)}
              note=""
              noteHover={foliosHover ?? undefined}
              sparkline={folioAdditionsTrend}
              sparklineColor="hsl(var(--chart-4))"
            />
          </section>

          {hasAnyFolioOrNfoTrend && folioAdditionsTrend.length > 0 && (
            <ChartWithContext
              title="Folio Additions Trend"
              subtitle="Net new folios opened each month. A breadth-of-investor signal."
              flowKind="net"
              denominatorCaption={(() => {
                if (folioAddLens === "share") {
                  return `${folioAdditionsShare.length} month${folioAdditionsShare.length === 1 ? "" : "s"} · % of folio base`;
                }
                const span = `${folioAdditionsTrend.length} month${folioAdditionsTrend.length === 1 ? "" : "s"}`;
                return folioAdditionsDenomCaption
                  ? `${span} · lakh · ${folioAdditionsDenomCaption}`
                  : `${span} · lakh`;
              })()}
              denominatorTooltip="Monthly folio additions expressed as a percentage of the existing folio base. Normalises growth against the (large, growing) base so the trend is comparable across years."
              insights={folioAdditionsInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(folioAdditionsTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/monthly"
                  paramName="folioAddLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "Lakh" },
                    { value: "share", label: "% of base" },
                  ]}
                  active={folioAddLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {(() => {
                const ov = adaptiveAverageOverlay(folioAdditionsFullHistory, folioAdditionsDisplay, 12);
                const useOverlay = folioAddLens !== "share";
                return (
                  <BarSeries
                    data={folioAdditionsDisplay}
                    name="Folio Additions"
                    color="hsl(var(--chart-4))"
                    valueFormat={folioAddLens === "share" ? "pct" : "lakh"}
                    axisFormat={folioAddLens === "share" ? "pct" : "lakh"}
                    labelFormat="month"
                    trendline={useOverlay && ov.kind === "trailing" ? ov.trendline : undefined}
                    trendlineName={useOverlay && ov.kind === "trailing" ? ov.label : undefined}
                    referenceValue={useOverlay && ov.kind === "visible-mean" ? ov.referenceValue : undefined}
                    referenceLabel={useOverlay && ov.kind === "visible-mean" ? ov.label : undefined}
                  />
                );
              })()}
            </ChartWithContext>
          )}
        </div>
      )}

      {activeTab === "nfo" && hasAnyFolioOrNfo && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              NFO Activity
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {foliosNfoRead ? ` · ${foliosNfoRead}` : ""}
            </p>
          </div>

          <HowToRead>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><span className="text-foreground">NFOs</span> are new fund launches — schemes that don&rsquo;t yet have an existing AUM.</li>
              <li>Very high NFO activity can signal product-launch euphoria; investors should check whether the new schemes are durable categories or one-offs.</li>
              <li>Low NFO activity means money is mostly flowing into existing, established schemes.</li>
            </ul>
          </HowToRead>

          <section className="grid gap-4 md:grid-cols-2">
            <KpiCard
              label="NFO Launches"
              value={formatIntSafe(industryNfoCountLatest)}
              note=""
              noteHover={nfoCountHover ?? undefined}
              sparkline={nfoCountCtx.sparkline}
              sparklineColor="hsl(var(--chart-5))"
              yoyPct={nfoCountCtx.yoyPct}
              percentile={nfoCountCtx.percentile}
              ratio={
                typeof industryNfoFundsLatest === "number" &&
                typeof industryNfoCountLatest === "number" &&
                industryNfoCountLatest > 0
                  ? `${formatCompactCrSafe(industryNfoFundsLatest / industryNfoCountLatest)} per launch`
                  : undefined
              }
            />
            <KpiCard
              label="NFO Funds Mobilized"
              value={formatCompactCrSafe(industryNfoFundsLatest)}
              note=""
              noteHover={nfoFundsHover ?? undefined}
              sparkline={nfoFundsCtx.sparkline}
              sparklineColor="hsl(var(--chart-2))"
              yoyPct={nfoFundsCtx.yoyPct}
              percentile={nfoFundsCtx.percentile}
              ratio={
                folioLatestRow &&
                typeof folioLatestRow.industryNfoFundsMobilized === "number" &&
                typeof folioLatestRow.netInflow === "number" &&
                folioLatestRow.netInflow > 0
                  ? `${((folioLatestRow.industryNfoFundsMobilized / folioLatestRow.netInflow) * 100).toFixed(1)}% of net inflow`
                  : undefined
              }
            />
          </section>

          {hasAnyFolioOrNfoTrend &&
            (nfoCountTrend.length > 0 || nfoFundsTrend.length > 0) && (
              <section className="grid gap-4 md:grid-cols-2">
                  {nfoCountTrend.length > 0 && (
                    <ChartWithContext
                      title="NFO Launches Trend"
                      subtitle="New fund launches each month. A signal of product-launch sentiment."
                      flowKind="stock"
                      denominatorCaption={(() => {
                        if (nfoCountLens === "share") {
                          return `${nfoCountShare.length} month${nfoCountShare.length === 1 ? "" : "s"} · % of trailing 5Y monthly avg`;
                        }
                        const span = `${nfoCountTrend.length} month${nfoCountTrend.length === 1 ? "" : "s"}`;
                        return nfoCountDenomCaption
                          ? `${span} · ${nfoCountDenomCaption}`
                          : `${span} · ${nfoCountSourceLine}`;
                      })()}
                      denominatorTooltip="Monthly NFO launches as a % of the trailing 5-year monthly average. Values above 100% = launch activity hotter than the 5Y norm (often coincides with bullish market regimes)."
                      insights={nfoCountInsights}
                      yoyBadge={(() => {
                        const v = latestYoyPct(nfoCountTrend, 12);
                        return v === null ? undefined : { label: "YoY", pct: v };
                      })()}
                      action={
                        <LensToggle
                          basePath="/monthly"
                          paramName="nfoCountLens"
                          defaultValue="absolute"
                          lenses={[
                            { value: "absolute", label: "Count" },
                            { value: "share", label: "% of 5Y avg" },
                          ]}
                          active={nfoCountLens}
                          preserveParams={preservedQueryParams}
                        />
                      }
                    >
                      {(() => {
                        const ov = adaptiveAverageOverlay(nfoCountFullHistory, nfoCountDisplay, 12);
                        const useOverlay = nfoCountLens !== "share";
                        const showShareRef = nfoCountLens === "share";
                        return (
                          <BarSeries
                            data={nfoCountDisplay}
                            name="NFO Launches"
                            color="hsl(var(--chart-5))"
                            valueFormat={nfoCountLens === "share" ? "pct" : "count"}
                            axisFormat={nfoCountLens === "share" ? "pct" : "count"}
                            labelFormat="month"
                            trendline={useOverlay && ov.kind === "trailing" ? ov.trendline : undefined}
                            trendlineName={useOverlay && ov.kind === "trailing" ? ov.label : undefined}
                            referenceValue={
                              showShareRef
                                ? 100
                                : useOverlay && ov.kind === "visible-mean"
                                  ? ov.referenceValue
                                  : undefined
                            }
                            referenceLabel={
                              showShareRef
                                ? "5Y avg"
                                : useOverlay && ov.kind === "visible-mean"
                                  ? ov.label
                                  : undefined
                            }
                          />
                        );
                      })()}
                    </ChartWithContext>
                  )}
                  {nfoFundsTrend.length > 0 && (
                    <ChartWithContext
                      title="NFO Funds Mobilised Trend"
                      subtitle="Gross money raised by NFOs each month. Captures product-launch capital intake."
                      flowKind="gross"
                      denominatorCaption={(() => {
                        if (nfoFundsLens === "share") {
                          return `${nfoFundsShare.length} month${nfoFundsShare.length === 1 ? "" : "s"} · % of industry net inflow`;
                        }
                        const span = `${nfoFundsTrend.length} month${nfoFundsTrend.length === 1 ? "" : "s"}`;
                        return nfoFundsDenomCaption
                          ? `${span} · ₹ Cr · ${nfoFundsDenomCaption}`
                          : `${span} · ₹ Cr · ${nfoFundsSourceLine}`;
                      })()}
                      denominatorTooltip="NFO gross funds mobilised as a % of industry net inflow that month — i.e., how much of the month's net flow was absorbed by new fund launches vs going to existing schemes."
                      insights={nfoFundsInsights}
                      yoyBadge={(() => {
                        const v = latestYoyPct(nfoFundsTrend, 12);
                        return v === null ? undefined : { label: "YoY", pct: v };
                      })()}
                      action={
                        <LensToggle
                          basePath="/monthly"
                          paramName="nfoFundsLens"
                          defaultValue="absolute"
                          lenses={[
                            { value: "absolute", label: "₹ Cr" },
                            { value: "share", label: "% of net inflow" },
                          ]}
                          active={nfoFundsLens}
                          preserveParams={preservedQueryParams}
                        />
                      }
                    >
                      {(() => {
                        const ov = adaptiveAverageOverlay(nfoFundsFullHistory, nfoFundsDisplay, 12);
                        const useOverlay = nfoFundsLens !== "share";
                        return (
                          <BarSeries
                            data={nfoFundsDisplay}
                            name="NFO Funds"
                            color="hsl(var(--chart-2))"
                            valueFormat={nfoFundsLens === "share" ? "pct" : "cr"}
                            axisFormat={nfoFundsLens === "share" ? "pct" : "cr"}
                            labelFormat="month"
                            trendline={useOverlay && ov.kind === "trailing" ? ov.trendline : undefined}
                            trendlineName={useOverlay && ov.kind === "trailing" ? ov.label : undefined}
                            referenceValue={useOverlay && ov.kind === "visible-mean" ? ov.referenceValue : undefined}
                            referenceLabel={useOverlay && ov.kind === "visible-mean" ? ov.label : undefined}
                          />
                        );
                      })()}
                    </ChartWithContext>
                  )}
                </section>
            )}
        </div>
      )}

      {activeTab === "active-passive" && (
        <TabIntroCard
          headline="Where is new equity money going?"
          summary="Active-equity AAUM, ETF & Index share, and the equity breakdown show how fast passive is closing the gap on actively managed equity."
          watchNext="Whether ETF & Index share keeps gaining ground in net inflows even when active equity AAUM is rising."
        />
      )}

      {activeTab === "active-passive" && hasAnyEquityMix && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active Equity &amp; Equity Mix
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {activeEquityMixRead ? ` · ${activeEquityMixRead}` : ""}
            </p>
          </div>

          <section>
            <ChartWithContext
              title="Active Equity AAUM Trend"
              subtitle="Period-average AUM in active equity funds. Shows the actively-managed equity asset base."
              flowKind="stock"
              denominatorCaption={(() => {
                if (aeAaumLens === "share") {
                  return `${activeEquityAaumShare.length} month${activeEquityAaumShare.length === 1 ? "" : "s"} · % of total industry AAUM`;
                }
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
                <>
                  <LensToggle
                    basePath="/monthly"
                    paramName="aeAaumLens"
                    defaultValue="absolute"
                    lenses={[
                      { value: "absolute", label: "₹ Cr" },
                      { value: "share", label: "% of total AAUM" },
                    ]}
                    active={aeAaumLens}
                    preserveParams={preservedQueryParams}
                  />
                  <LensToggle
                    basePath="/monthly"
                    paramName="aeAaumRange"
                    defaultValue="3y"
                    lenses={[
                      { value: "1y", label: "1Y" },
                      { value: "3y", label: "3Y" },
                      { value: "5y", label: "5Y" },
                      { value: "all", label: "All" },
                    ]}
                    active={aeAaumRange}
                    preserveParams={preservedQueryParams}
                  />
                </>
              }
            >
              {activeEquityTrend.length > 0 ? (() => {
                const useOverlay = aeAaumLens !== "share";
                const trailingAvg = slicedMovingAverage(
                  activeEquityFullHistory,
                  12,
                  activeEquityAaumDisplay.length
                );
                const aeAaumCycleBands = renderedCycleBands(
                  cyclePhaseBands,
                  activeEquityAaumDisplay.map((p) => p.label as string)
                );
                return (
                  <>
                    <BarSeries
                      data={activeEquityAaumDisplay}
                      name="Active Equity AAUM"
                      color="hsl(var(--chart-1))"
                      valueFormat={aeAaumLens === "share" ? "pct" : "cr"}
                      axisFormat={aeAaumLens === "share" ? "pct" : "cr"}
                      labelFormat="month"
                      cyclePhaseBands={aeAaumCycleBands}
                      signedFill="single"
                      trendline={useOverlay ? trailingAvg : undefined}
                      trendlineName={useOverlay ? "Trailing 12-month avg" : undefined}
                      dynamicYDomain={aeAaumLens === "share"}
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
                {aeAaumLens === "share" ? (
                  <p className="inline-flex items-start gap-1.5">
                    <span>
                      This is active-equity AAUM as a share of the whole
                      industry&apos;s assets. It strips out market-driven scale so
                      you can see the structural question this tab is about: is
                      actively-managed equity gaining or ceding ground to passive
                      (ETF &amp; Index) and debt? A flat share while the ₹ line
                      climbs means active equity is only riding the market up, not
                      winning share.
                    </span>
                    <InfoTooltip label="Active-equity envelope = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
                  </p>
                ) : (
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
                )}
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
                    cross-check against Active Equity Net Inflows on the Flows
                    tab. AAUM rising while flows are soft is a market-driven rally
                    (fragile if prices reverse); AAUM rising on strong flows is
                    durable, investor-funded growth.
                  </li>
                </ul>
              </HowToRead>
            </ChartWithContext>
          </section>

          <ChartWithContext
            title="Equity AAUM Breakdown"
            subtitle="How active equity AAUM splits across sub-categories (large-cap, mid, small, etc.)."
            flowKind="stock"
            denominatorCaption={(() => {
              const base = equityBreakdownLens === "share"
                ? `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · stacked share of equity AAUM`
                : equityBreakdownLens === "indexed"
                  ? `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · each segment's share indexed to 100 at ${equityBreakdown[0]?.month ?? "start"} (relative trajectory)`
                  : equityBreakdownSubtitle;
              return equityBreakdownDenomCaption
                ? `${base} · ${equityBreakdownDenomCaption}`
                : base;
            })()}
            denominatorTooltip="ETF & Index share of equity AAUM — the headline passive-penetration number tracked across this section."
            insights={equityBreakdownInsights}
            yoyBadge={(() => {
              const v = latestYoyPct(activeEquityFromBreakdown, 12);
              return v === null
                ? undefined
                : { label: "Active YoY", pct: v };
            })()}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <LensToggle
                  basePath="/monthly"
                  paramName="equityMixLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "% of equity AAUM" },
                    { value: "indexed", label: "Indexed" },
                  ]}
                  active={equityBreakdownLens}
                  preserveParams={preservedQueryParams}
                />
              </div>
            }
          >
            {equityBreakdownHasData ? (
              <GroupedBars
                data={equityBreakdownDisplay}
                xKey="month"
                labelFormat="month"
                valueFormat={
                  equityBreakdownLens === "share"
                    ? "pct"
                    : equityBreakdownLens === "indexed"
                      ? "count"
                      : "cr"
                }
                axisFormat={
                  equityBreakdownLens === "share"
                    ? "pct"
                    : equityBreakdownLens === "indexed"
                      ? "count"
                      : "cr"
                }
                bars={equityBreakdownSeries}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Equity breakdown (Active / ETF & Index / Arbitrage) not yet ingested for any month.
              </div>
            )}
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {equityBreakdownLens === "indexed"
                ? `Each segment's share of equity AAUM, indexed to 100 at ${equityBreakdown[0]?.month ?? "the start"} — a line above 100 means that segment is gaining share, below 100 means losing it (relative move, not absolute ₹ or share %).`
                : "Active Equity, ETF & Index, and Arbitrage shown separately."}
              <InfoTooltip label="Active Equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-oriented schemes. ETF & Index = Index Funds + Other ETFs. Share view divides each segment by the sum of all three for that month. Indexed view rebases each segment's share to 100 at the first month so the relative trajectory is visible regardless of absolute level." />
            </p>
          </ChartWithContext>
        </div>
      )}

      {activeTab === "active-passive" &&
        activePassiveTrend && activePassiveTrend.history.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active vs Passive
            </h2>
            <p className="text-xs text-muted-foreground">
              Active equity AUM vs ETF &amp; Index AUM · passive share trend
              {activePassiveTrend.forecastMonths > 0
                ? " + simple trend projection"
                : ""}{" "}
              · Source: AMFI Monthly Report
            </p>
          </div>

          <HowToRead>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><span className="text-foreground">Active funds</span> are managed by a fund manager — they pick stocks and aim to beat an index.</li>
              <li><span className="text-foreground">Passive funds</span> simply track an index (e.g. Nifty 50) at a lower fee.</li>
              <li>A rising passive share pressures fee yields for active-heavy AMCs over time, even when active AUM is still growing in absolute terms.</li>
            </ul>
          </HowToRead>

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

      {activeTab === "market-cycle" && (
        <TabIntroCard
          headline="When did this happen before?"
          summary="Cycle replay, the 7-year calendar of flow z-scores, episode recovery latencies, and AMC concentration place the current month in historical context."
          watchNext="Whether flow z-scores stay positive when Nifty draws down — that's the buy-the-dip signal."
        />
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

function NfoDragCard({
  trend,
}: {
  trend: NonNullable<ReturnType<typeof nfoDragTrend>>;
}) {
  const data = trend.history.map((p) => ({
    label: p.month,
    value: p.ratioPct,
  }));
  return (
    <Card
      title="NFO Drag Ratio"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            How much of the industry&rsquo;s net inflow each month was absorbed by NFOs.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            NFO mobilisation ÷ industry net inflow · {trend.history.length} months · ₹ Cr
          </p>
        </div>
      }
      action={
        trend.isHeavy ? (
          <span className="shrink-0 rounded-full border border-foreground/30 bg-muted px-2 py-0.5 text-[10px] font-medium tracking-tight text-foreground">
            NFO heavy
          </span>
        ) : undefined
      }
    >
      <BarSeries
        data={data}
        name="NFO drag"
        color="hsl(var(--chart-2))"
        valueFormat="pct"
        axisFormat="pct"
        labelFormat="month"
      />
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Latest {trend.latestRatioPct.toFixed(1)}%
        {formatPercentile(trend.percentile) !== "—"
          ? ` · ${formatPercentile(trend.percentile)}`
          : ""}
        . Mean {trend.mean.toFixed(1)}%.
        <InfoTooltip label="Ratio = industryNfoFundsMobilized ÷ netInflow × 100. Months with non-positive total industry net inflow are skipped (the ratio is undefined). High ratios = NFOs absorbing more of the month's industry net inflow than usual — historically a froth cue, not a buy/sell call." />
      </p>
    </Card>
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

function PassiveFlowShareCard({
  trend,
}: {
  trend: NonNullable<ReturnType<typeof passiveFlowShareTrend>>;
}) {
  const data = trend.history.map((p) => ({
    label: p.month,
    value: p.passiveSharePct,
  }));
  return (
    <Card
      title="Passive Share of New Equity Flow"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            What share of each month&rsquo;s new equity money went into ETFs and index funds.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {trend.history.length} months
          </p>
        </div>
      }
    >
      <BarSeries
        data={data}
        name="Passive flow share"
        color="hsl(var(--chart-5))"
        valueFormat="pct"
        axisFormat="pct"
        labelFormat="month"
      />
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Latest {trend.latestSharePct.toFixed(1)}%
        {formatPercentile(trend.percentile) !== "—"
          ? ` · ${formatPercentile(trend.percentile)}`
          : ""}
        . Mean {trend.mean.toFixed(1)}%.
        <InfoTooltip label="Passive flow share = (Index Funds + Other ETFs net inflow) ÷ (Index Funds + Other ETFs + active-equity net inflow) × 100. Leading indicator of where the active-vs-passive AUM mix is heading — passive share of NEW money tends to move months before passive share of AUM. Gold ETFs are excluded. Months with non-positive denominator are skipped." />
      </p>
      <HowToRead>
        <p>
          Of every ₹100 of <strong>new</strong> equity money each month, this is
          the share that chose index funds and ETFs over active funds —
          (Index&nbsp;+&nbsp;ETF net inflow) ÷ (Index&nbsp;+&nbsp;ETF&nbsp;+&nbsp;active-equity net inflow).
          It&rsquo;s a leading indicator: passive&rsquo;s share of <em>new</em> flow
          tends to move months before passive&rsquo;s share of total AUM does.
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            A rising line means investors are increasingly picking passive for
            fresh money — a structural revenue-yield headwind for active-heavy AMCs.
          </li>
          <li>
            The footer reads the <strong>latest</strong> month against this
            history: &ldquo;Bottom 44%&rdquo; means 44% of months on record had a
            passive share at or below today&rsquo;s — i.e. the current month ranks
            in the lower-middle. It is <em>not</em> the chart&rsquo;s minimum.
          </li>
          <li>
            Months where active equity saw a net <em>outflow</em> are excluded —
            the &ldquo;share of new money&rdquo; ratio is undefined when there&rsquo;s no
            net new active money to share. Gold ETFs are excluded throughout.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}

