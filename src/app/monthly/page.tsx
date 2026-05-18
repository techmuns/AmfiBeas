import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import { chartInsights, latestYoyPct, movingAverage } from "@/lib/chart-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { BarSeries } from "@/components/charts/BarSeries";
import { Donut, type DonutSlice } from "@/components/charts/Donut";
import { IiflHeatmap } from "@/components/charts/IiflHeatmap";
import { MultiLine } from "@/components/charts/MultiLine";
import { StackedArea } from "@/components/charts/StackedArea";
import { Waterfall } from "@/components/charts/Waterfall";
import { latestMonth } from "@/data/aggregate";
import {
  activeEquityNetInflowSignal,
  activeEquityNetInflowSparkline,
  amfiMonthlyRows,
  availableMonthsDesc,
  formatKpiProvenanceLine,
  formatKpiProvenanceTooltip,
  getKpiProvenance,
  getKpiValue,
  activeEquityMixSectionRead,
  foliosNfoSectionRead,
  industryFlowWaterfall,
  investorRead,
  kpiContext,
  latestAmfiMonthlyRow,
  monthlyFlowsSectionRead,
  sipTrendsSectionRead,
  snapshotSectionRead,
  latestIndustryFolioAdditions,
  latestProvenanceFor,
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
  nfoHeatSignal,
  nfoMobilisationSparkline,
  passiveShareSparkline,
  passiveShiftSignal,
  resolveSelectedRow,
  sipStickinessSignal,
  sipStickinessSparkline,
  trailingActiveEquityNetInflowAverage,
  type ActiveEquityNetInflowSignal,
  type ActiveEquitySignalLabel,
  type AmfiMonthlyKpiField,
  type CyclePhase,
  type NfoHeatSignal,
  type PassiveShiftLabel,
  type PassiveShiftSignal,
  type SipStickinessSignal,
  type SparklinePoint,
} from "@/data/amfi-monthly";
import {
  cyclePhaseHistory,
  flowStressHistory,
  historicalEpisodes,
  investorMood,
  latestNifty500Row,
  marketIndexRows,
  marketStressFlowSignal,
  narrativeComposer,
  weatherBadge,
  type MarketStressLabel,
  type MarketStressSignal,
} from "@/data/market-indices";
import { FlowStressHistoryChart } from "@/components/charts/FlowStressHistoryChart";
import { SankeyFlow } from "@/components/charts/SankeyFlow";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { CalendarHeatGrid } from "@/components/ui/CalendarHeatGrid";
import { CalloutCard } from "@/components/ui/CalloutCard";
import { CategoryResilienceCard } from "@/components/ui/CategoryResilienceCard";
import { categoryDrawdownResilience } from "@/data/category-resilience";
import { CoachPill } from "@/components/ui/CoachPill";
import { CycleRibbon } from "@/components/ui/CycleRibbon";
import { EpisodeReplayStrip } from "@/components/ui/EpisodeReplayStrip";
import { HeadlineCard } from "@/components/ui/HeadlineCard";
import { MarketTape } from "@/components/ui/MarketTape";
import { NarrativeBlock } from "@/components/ui/NarrativeBlock";
import { SandboxCard } from "@/components/ui/SandboxCard";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { StickyContextFooter } from "@/components/ui/StickyContextFooter";
import { TwinScopeCard } from "@/components/ui/TwinScopeCard";
import { LensToggle } from "@/components/ui/LensToggle";
import { MoodGauge } from "@/components/ui/MoodGauge";
import { Sparkline } from "@/components/charts/Sparkline";
import { VolatilityRibbon } from "@/components/ui/VolatilityRibbon";
import { WeatherBadge } from "@/components/ui/WeatherBadge";
import { ordinalSuffix } from "@/lib/format";
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
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MonthPicker } from "@/components/filters/MonthPicker";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
} from "@/lib/format";
import { cn } from "@/lib/cn";
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
  const equityBreakdownLens: "absolute" | "share" =
    sp.equityMixLens === "share" ? "share" : "absolute";
  const activePassiveLens: "absolute" | "share" =
    sp.activePassiveLens === "share" ? "share" : "absolute";
  // Pass-through params for every LensToggle so toggling A doesn't
  // lose B (or the selected month).
  const preservedQueryParams: Record<string, string | undefined> = {
    month: typeof sp.month === "string" ? sp.month : undefined,
    heatmap: typeof sp.heatmap === "string" ? sp.heatmap : undefined,
    flowsLens: typeof sp.flowsLens === "string" ? sp.flowsLens : undefined,
    equityMixLens:
      typeof sp.equityMixLens === "string" ? sp.equityMixLens : undefined,
    activePassiveLens:
      typeof sp.activePassiveLens === "string"
        ? sp.activePassiveLens
        : undefined,
  };

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
    const ctx = kpiContext(spec.field, 24);
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

  const mixSlices: DonutSlice[] = [];
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
  const aaumTrendSubtitle = aaumTrendHasData
    ? `Total AAUM · ${aaumTrendData.length} month${aaumTrendData.length === 1 ? "" : "s"} · ₹ Cr`
    : "Total AAUM not available";

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
  const sipContribTrend = monthlyTrend("sipContribution", 24);
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
  const sipAccountsTrend = monthlyTrend("sipAccounts", 24);

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
  const activeEquityTrend = monthlyTrend("activeEquityAaum", 24);
  const activeEquityShareTrend = monthlyActiveEquityShareTrend(24);
  const equityBreakdown = monthlyEquityBreakdown(24);
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

  // Active Equity Share denominator: pp shift vs trailing 12M average
  // — the absolute share moves slowly, so the pp delta is the more
  // informative read.
  const activeEquityShareDenomCaption = (() => {
    if (activeEquityShareTrend.length < 12) return undefined;
    const latest = activeEquityShareTrend[activeEquityShareTrend.length - 1];
    const trailing12 = activeEquityShareTrend.slice(-12);
    const avg = trailing12.reduce((s, p) => s + p.value, 0) / trailing12.length;
    const pp = latest.value - avg;
    return `${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(2)} pp vs trailing 12M avg · latest ${latest.label}`;
  })();
  const activeEquityShareInsights = chartInsights(activeEquityShareTrend, {
    metricName: "active-equity share",
    unitSuffix: "%",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });

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
  const nfoCountTrend = monthlyTrend("industryNfoCount", 24);
  const nfoFundsTrend = monthlyTrend("industryNfoFundsMobilized", 24);
  const foliosCtx = kpiContext("industryFolios", 24);
  const nfoCountCtx = kpiContext("industryNfoCount", 24);
  const nfoFundsCtx = kpiContext("industryNfoFundsMobilized", 24);

  // Folio additions denominator: latest monthly net add as bps of the
  // existing folio base. Normalises growth against the (large) base
  // so the trend is comparable across years.
  const folioAdditionsDenomCaption = (() => {
    if (folioAdditionsTrend.length === 0 || industryFoliosLatest === null)
      return undefined;
    const latest = folioAdditionsTrend[folioAdditionsTrend.length - 1];
    if (industryFoliosLatest <= 0) return undefined;
    // additions in lakh, base in crore — convert: 1 Cr = 100 lakh.
    const bps =
      (latest.value / 100 / (industryFoliosLatest / 1e7)) * 10000;
    return `${bps.toFixed(0)} bps of total folio base · latest ${latest.label}`;
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
  const activeEquityFlowTrend = monthlyActiveEquityNetInflowTrend(24);
  const activeEquityFlowAvg = trailingActiveEquityNetInflowAverage(12);
  const activeEquityBridge = monthlyActiveEquityAumBridge(24);
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

  // SIP AUM share — already a %. Denominator caption highlights pp
  // shift vs trailing 12M average, which is more informative than the
  // % itself (which barely moves MoM).
  const sipAumShareDenomCaption = (() => {
    if (sipAumShareTrend.length < 12) return undefined;
    const latest = sipAumShareTrend[sipAumShareTrend.length - 1];
    const trailing12 = sipAumShareTrend.slice(-12);
    const avg = trailing12.reduce((s, p) => s + p.value, 0) / trailing12.length;
    const pp = latest.value - avg;
    return `${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(2)} pp vs trailing 12M avg · latest ${latest.label}`;
  })();
  const sipAumShareInsights = chartInsights(sipAumShareTrend, {
    metricName: "SIP AUM share",
    unitSuffix: "%",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });

  // Proportion diagnostics: category rotation, NFO drag, passive flow share.
  const rotation = categoryRotation(3, 5);
  const nfoDrag = nfoDragTrend(24);
  const passiveFlowShare = passiveFlowShareTrend(24);
  const hasProportionDiagnostics =
    rotation !== null || nfoDrag !== null || passiveFlowShare !== null;

  // ---- Investor Signals Panel --------------------------------------
  // Five historical-context signals computed off the existing AMFI
  // monthly + market-indices snapshots. No new ingestion. The Equity
  // Flow Share signal is intentionally omitted — 20 / 62 monthly rows
  // carry a non-positive total net inflow, which would make the
  // (equityNetInflow ÷ totalNetInflow) ratio fragile.
  const activeEquitySignal = activeEquityNetInflowSignal();
  const nfoSignal = nfoHeatSignal();
  const passiveSignal = passiveShiftSignal();
  const sipStickiness = sipStickinessSignal();
  const marketStress = marketStressFlowSignal();
  const investorSignals = [
    activeEquitySignal,
    nfoSignal,
    passiveSignal,
    sipStickiness,
    marketStress,
  ].filter((s): s is NonNullable<typeof s> => s !== null);
  const hasInvestorSignals = investorSignals.length > 0;
  // Sparkline series per tile — trailing 24 months unless the series
  // itself is shorter (e.g. SIP). Sparkline component handles empty.
  const activeEquitySparkline = activeEquityNetInflowSparkline(24);
  const nfoSparkline = nfoMobilisationSparkline(24);
  const passiveSparkline = passiveShareSparkline(24);
  const sipSparkline = sipStickinessSparkline(24);
  const latestNifty = latestNifty500Row();
  const cyclePhasePoints = cyclePhaseHistory();
  // Investor Sandbox: ₹10,000 invested in the Nifty 500 at the
  // earliest available month-end vs today (latest month-end). Uses
  // the index level as a clean proxy for "average market return"
  // before fees.
  const sandboxScenario: {
    startLabel: string;
    endLabel: string;
    startAmount: number;
    endAmount: number;
    cagrPct: number | null;
    caveat?: string;
  } | null = (() => {
    const niftyRows = marketIndexRows("NIFTY_500");
    if (niftyRows.length < 13) return null;
    const start = niftyRows[0];
    const end = niftyRows[niftyRows.length - 1];
    if (!start || !end || start.level <= 0) return null;
    const seed = 10_000;
    const multiple = end.level / start.level;
    const finalValue = seed * multiple;
    const [sy, sm] = start.month.split("-").map(Number);
    const [ey, em] = end.month.split("-").map(Number);
    const yrs = Math.max(0.1, ey - sy + (em - sm) / 12);
    const cagrPct = (Math.pow(multiple, 1 / yrs) - 1) * 100;
    return {
      startLabel: start.month,
      endLabel: end.month,
      startAmount: seed,
      endAmount: finalValue,
      cagrPct,
      caveat:
        "Uses the Nifty 500 index level as a clean pre-fee proxy. Active-equity fund returns vary by scheme; this is a sandbox illustration, not a fund recommendation.",
    };
  })();
  // Coach message: surfaces the single most striking signal on the page.
  const coachMessage = (() => {
    const stress = marketStressFlowSignal();
    if (stress?.label === "Buy-the-dip flow") {
      return `Nifty 500 is in a ${Math.abs(stress.drawdownPct).toFixed(1)}% drawdown but active-equity flow sits in the ${stress.flowPercentileRank?.toFixed(0) ?? "—"}th percentile — investors are buying the dip.`;
    }
    if (stress?.label === "Flow stress") {
      return `Nifty 500 is in drawdown AND flow is at the bottom decile — historically a stress signal.`;
    }
    if (
      activeEquitySignal &&
      activeEquitySignal.percentileRank !== null &&
      activeEquitySignal.percentileRank >= 95
    ) {
      return `Active-equity flow is in the ${activeEquitySignal.percentileRank.toFixed(0)}th percentile — a top-decile inflow month.`;
    }
    return null;
  })();
  const tapeCells = cyclePhasePoints.map((p) => ({
    month: p.month,
    phase: p.phase,
    flowZScore: p.flowZScore,
    drawdownPct: p.drawdownPct,
  }));
  // Twin scope: compare trailing 12M of active-equity flow with the
  // 12M immediately before that.
  const twinScopeData = (() => {
    const series = amfiMonthlyRows()
      .filter((r) => typeof r.activeEquityNetInflow === "number")
      .map((r) => ({ label: r.month, value: r.activeEquityNetInflow as number }));
    if (series.length < 13) return null;
    const current = series.slice(-12);
    const prior = series.slice(-24, -12);
    if (current.length === 0 || prior.length === 0) return null;
    return { current, prior };
  })();
  const episodes = historicalEpisodes();
  const latestCyclePhaseForNarrative =
    cyclePhasePoints.length > 0
      ? cyclePhasePoints[cyclePhasePoints.length - 1].phase
      : null;
  const narrative = narrativeComposer({
    latestMonth: activeEquitySignal?.latestMonth ?? null,
    activeEquity: activeEquitySignal
      ? {
          value: activeEquitySignal.latestValue,
          zScore: activeEquitySignal.zScore,
          percentile: activeEquitySignal.percentileRank,
        }
      : null,
    nfo: nfoSignal
      ? { zScore: nfoSignal.zScore, percentile: nfoSignal.percentileRank }
      : null,
    passive: passiveSignal
      ? {
          latestSharePct: passiveSignal.latestSharePct,
          percentile: passiveSignal.percentileRank,
        }
      : null,
    sip: sipStickiness
      ? {
          latestSharePct: sipStickiness.latestSharePct,
          percentile: sipStickiness.percentileRank,
        }
      : null,
    drawdownPct: latestNifty?.drawdownPct ?? null,
    cyclePhase: latestCyclePhaseForNarrative,
  });
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
      hoverDetail: `₹${formatCompactCrSafe(p.value)} · ${
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
  // Mood + weather + headline takeaway need active-equity / NFO / passive
  // / SIP percentile inputs. The signals are computed below — but mood
  // depends only on percentile fields which we can fetch directly here.
  const mood = investorMood({
    activeEquityPercentile: activeEquitySignal?.percentileRank ?? null,
    nfoPercentile: nfoSignal?.percentileRank ?? null,
    passivePercentile: passiveSignal?.percentileRank ?? null,
    sipPercentile: sipStickiness?.percentileRank ?? null,
    drawdownPct: latestNifty?.drawdownPct ?? null,
  });
  const weather = weatherBadge({
    drawdownPct: latestNifty?.drawdownPct ?? null,
    flowZScore: activeEquitySignal?.zScore ?? null,
    cyclePhase: latestCyclePhase,
  });
  // ---- Headline-style "callout" cards just below the hero ----
  // Editorial statements (not KPI tiles). Each card presents one
  // notable finding from the existing helpers in plain English.
  type Callout = {
    id: string;
    statement: string;
    context?: string;
    tone: "positive" | "negative" | "neutral";
    accentNumber?: string;
  };
  const topCallouts: Callout[] = [];
  if (
    activeEquitySignal &&
    activeEquitySignal.percentileRank !== null &&
    activeEquitySignal.percentileRank >= 90
  ) {
    topCallouts.push({
      id: "ae-flow-hot",
      tone: "positive",
      accentNumber:
        activeEquitySignal.percentileRank.toFixed(0) +
        ordinalSuffix(Math.round(activeEquitySignal.percentileRank)),
      statement: `Active-equity inflow in the top ${(100 - activeEquitySignal.percentileRank).toFixed(0)}% of months on record`,
      context: `Latest ${activeEquitySignal.latestMonth} · ₹${formatCompactCrSafe(activeEquitySignal.latestValue)} vs historical mean ₹${formatCompactCrSafe(activeEquitySignal.mean)}`,
    });
  } else if (
    activeEquitySignal &&
    activeEquitySignal.percentileRank !== null &&
    activeEquitySignal.percentileRank <= 10
  ) {
    topCallouts.push({
      id: "ae-flow-cold",
      tone: "negative",
      accentNumber: activeEquitySignal.percentileRank.toFixed(0) + "th",
      statement: `Active-equity inflow in the bottom ${activeEquitySignal.percentileRank.toFixed(0)}% of months on record`,
      context: `Latest ${activeEquitySignal.latestMonth} · ₹${formatCompactCrSafe(activeEquitySignal.latestValue)} vs historical mean ₹${formatCompactCrSafe(activeEquitySignal.mean)}`,
    });
  }
  if (
    nfoSignal &&
    nfoSignal.percentileRank !== null &&
    nfoSignal.percentileRank <= 15
  ) {
    topCallouts.push({
      id: "nfo-cold",
      tone: "neutral",
      accentNumber: `${nfoSignal.percentileRank.toFixed(0)}${ordinalSuffix(Math.round(nfoSignal.percentileRank))}`,
      statement: `NFO mobilisation at the low end of history — investors prefer existing schemes`,
      context: `Latest ${nfoSignal.latestMonth} · ₹${formatCompactCrSafe(nfoSignal.latestValue)} vs ₹${formatCompactCrSafe(nfoSignal.mean)} historical mean`,
    });
  } else if (
    nfoSignal &&
    nfoSignal.percentileRank !== null &&
    nfoSignal.percentileRank >= 80
  ) {
    topCallouts.push({
      id: "nfo-hot",
      tone: "neutral",
      accentNumber: `${nfoSignal.percentileRank.toFixed(0)}${ordinalSuffix(Math.round(nfoSignal.percentileRank))}`,
      statement: "NFO mobilisation at the high end of history — bull-market cue",
      context: `Latest ${nfoSignal.latestMonth} · ₹${formatCompactCrSafe(nfoSignal.latestValue)}`,
    });
  }
  if (passiveSignal && passiveSignal.latestSharePct !== null) {
    topCallouts.push({
      id: "passive-share",
      tone: "neutral",
      accentNumber: `${passiveSignal.latestSharePct.toFixed(1)}%`,
      statement: `Passive funds command ${passiveSignal.latestSharePct.toFixed(1)}% of equity AUM — ${
        passiveSignal.percentileRank !== null && passiveSignal.percentileRank >= 80
          ? "near recent highs"
          : passiveSignal.percentileRank !== null && passiveSignal.percentileRank <= 20
            ? "near recent lows"
            : "in line with history"
      }`,
      context: `Latest ${passiveSignal.latestMonth} · historical avg ${passiveSignal.mean.toFixed(1)}%`,
    });
  }
  if (latestNifty && latestNifty.drawdownPct !== null && latestNifty.drawdownPct <= -5) {
    topCallouts.push({
      id: "drawdown",
      tone: latestNifty.drawdownPct <= -10 ? "negative" : "neutral",
      accentNumber: `${latestNifty.drawdownPct.toFixed(1)}%`,
      statement: `Nifty 500 ${Math.abs(latestNifty.drawdownPct).toFixed(1)}% off its all-time peak`,
      context: `As of ${latestNifty.month} · level ${latestNifty.level.toLocaleString("en-IN")}`,
    });
  }
  // Cap at 3 callouts to keep the hero zone tight.
  if (topCallouts.length > 3) topCallouts.length = 3;
  // Section reads — short data-driven 1-liners surfaced under
  // each section title.
  const snapshotRead = snapshotSectionRead();
  const sipTrendsRead = sipTrendsSectionRead();
  const monthlyFlowsRead = monthlyFlowsSectionRead();
  const activeEquityMixRead = activeEquityMixSectionRead();
  const foliosNfoRead = foliosNfoSectionRead();
  // Historical Flow Stress timeline — drawdown line + Buy-the-dip /
  // Flow stress markers across the full overlapping history.
  const flowStress = flowStressHistory();
  const flowStressHasEvents = flowStress.some((p) => p.label !== "Normal");
  // Build the Investor Read composite from the five signals + Nifty 500.
  const read = investorRead({
    activeEquityZ: activeEquitySignal?.zScore ?? null,
    activeEquityPercentile: activeEquitySignal?.percentileRank ?? null,
    nfoZ: nfoSignal?.zScore ?? null,
    passivePercentile: passiveSignal?.percentileRank ?? null,
    passiveLatestSharePct: passiveSignal?.latestSharePct ?? null,
    sipPercentile: sipStickiness?.percentileRank ?? null,
    drawdownPct: latestNifty?.drawdownPct ?? null,
    marketMonth: latestNifty?.month ?? null,
  });

  // ---- 12-month Industry Flow Waterfall + Active vs Passive ---------
  const flowWaterfall = industryFlowWaterfall(12);
  const activePassiveTrend = monthlyActivePassiveTrend(24);

  // Active vs ETF AUM denominator: latest passive AUM ÷ active AUM
  // ratio — captures how far passive has closed the gap, more
  // discriminating than the share % which compresses both sides.
  const activeVsEtfDenomCaption = (() => {
    if (!activePassiveTrend) return undefined;
    const hist = activePassiveTrend.history;
    if (hist.length === 0) return undefined;
    const latest = hist[hist.length - 1];
    if (latest.activeEquityAum <= 0) return undefined;
    const ratio = latest.etfIndexAum / latest.activeEquityAum;
    return `Passive = ${(ratio * 100).toFixed(1)}% of active-equity AUM · ${latest.month}`;
  })();
  const activeVsEtfPassiveSeries = activePassiveTrend
    ? activePassiveTrend.history.map((p) => ({
        label: p.month,
        value: p.etfIndexAum,
      }))
    : [];
  const activeVsEtfInsights = chartInsights(activeVsEtfPassiveSeries, {
    metricName: "ETF & Index AUM",
    unitSuffix: "₹ Cr",
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });

  // Passive share denominator: pp shift YoY — more useful than the
  // absolute share since the share moves slowly month-to-month.
  const passiveShareHistorySeries = activePassiveTrend
    ? activePassiveTrend.history.map((p) => ({
        label: p.month,
        value: p.passiveSharePct,
      }))
    : [];
  const passiveShareDenomCaption = (() => {
    if (passiveShareHistorySeries.length < 13) return undefined;
    const latest = passiveShareHistorySeries[passiveShareHistorySeries.length - 1];
    const prior = passiveShareHistorySeries[passiveShareHistorySeries.length - 13];
    if (prior === undefined) return undefined;
    const pp = latest.value - prior.value;
    return `${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(2)} pp YoY · latest ${latest.label}`;
  })();
  const passiveShareInsights = chartInsights(passiveShareHistorySeries, {
    metricName: "passive share",
    unitSuffix: "%",
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Monthly Operating KPIs"
        subtitle={subtitle}
        action={<WeatherBadge headline={weather.headline} tone={weather.tone} />}
      />

      {activeEquitySignal && (
        <HeadlineCard
          eyebrow={`AMFI · ${activeEquitySignal.latestMonth}`}
          headline={(() => {
            const v = Math.abs(activeEquitySignal.latestValue);
            // Pick a compact scale + suffix on the server so we can
            // pass a SERIALISABLE numeric value to the AnimatedNumber
            // client component. Functions can't cross the server →
            // client boundary in RSC.
            let scaled = v;
            let suffix = "Cr";
            let decimals = 0;
            if (v >= 1e5) {
              scaled = v / 1e5;
              suffix = "L Cr";
              decimals = 2;
            } else if (v >= 1e3) {
              scaled = v / 1e3;
              suffix = "K Cr";
              decimals = 1;
            }
            return (
              <span>
                <span className="text-3xl font-medium text-foreground/80 sm:text-4xl">
                  {activeEquitySignal.latestValue < 0 ? "−₹" : "₹"}
                </span>
                <AnimatedNumber value={scaled} decimals={decimals} />
                <span className="ml-1 text-3xl font-medium text-foreground/80 sm:text-4xl">
                  {suffix}
                </span>
              </span>
            );
          })()}
          context={
            activeEquitySignal.percentileRank !== null
              ? `Active-equity inflow · ${
                  activeEquitySignal.percentileRank >= 50
                    ? `top ${(100 - activeEquitySignal.percentileRank).toFixed(0)}%`
                    : `bottom ${activeEquitySignal.percentileRank.toFixed(0)}%`
                } of months on record · Cycle: ${read.phase}`
              : `Active-equity inflow · Cycle: ${read.phase}`
          }
          takeaway={read.narrative}
          accent={
            <MoodGauge
              index={mood.index}
              label={mood.label}
            />
          }
        />
      )}

      {coachMessage && <CoachPill message={coachMessage} />}

      {topCallouts.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {topCallouts.map((c) => (
            <CalloutCard
              key={c.id}
              statement={c.statement}
              context={c.context}
              tone={c.tone}
              accentNumber={c.accentNumber}
            />
          ))}
        </section>
      )}

      {narrative && (
        <NarrativeBlock
          eyebrow={`Markets column · ${activeEquitySignal?.latestMonth ?? ""}`}
          strapline={`The ${read.phase.toLowerCase()} read`}
          paragraphs={narrative}
        />
      )}

      {episodes.length > 0 && (
        <Card
          title="Cycle Replay · How investors behaved in past drawdowns"
          subtitle="Each card is a distinct drawdown episode — colour pill captures the average flow z-score during the episode"
        >
          <EpisodeReplayStrip
            episodes={episodes}
            formatValue={(v) => `₹${formatCompactCrSafe(v)}`}
          />
        </Card>
      )}

      {cyclePhasePoints.length > 0 && (
        <Card
          title="Market Tape · 7-year regime + flow"
          subtitle={`Background colour = cycle phase · bar height = active-equity flow z-score · since ${cyclePhasePoints[0].month}`}
        >
          <MarketTape cells={tapeCells} lastN={84} height={72} />
          <div className="mt-3">
            <CycleRibbon points={cyclePhasePoints} lastN={84} />
          </div>
        </Card>
      )}

      {twinScopeData && (
        <TwinScopeCard
          label="Active Equity Net Inflow"
          current={twinScopeData.current}
          prior={twinScopeData.prior}
          formatValue={(v) => `₹${formatCompactCrSafe(v)}`}
        />
      )}

      {sandboxScenario && <SandboxCard scenario={sandboxScenario} />}

      <SectionDivider
        eyebrow="Section II"
        label="AMFI Industry Snapshot"
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        context="Live KPIs from the latest AMFI Monthly Report — totals, mix, and flow."
      />

      {flowHeatCells.length > 0 && (
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

      {sankeyData && (
        <Card
          title="Where the Money Went · Latest Month"
          subtitle={`Industry net flow split by source × destination · ${sankeyData.month}`}
        >
          <SankeyFlow
            sources={sankeyData.sources}
            targets={sankeyData.targets}
            links={sankeyData.links}
            formatValue={(v) => `₹${formatCompactCrSafe(v)}`}
            height={320}
          />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Source widths show SIP vs lump-sum split of net inflow.
            Destination widths show Equity / Debt / Liquid / Other shares.
            Source-to-destination ribbons are proportional approximations
            (the AMFI release does not split SIP destinations by category).
          </p>
        </Card>
      )}

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

      {hasInvestorSignals && (
        <Card
          title="Investor Signals"
          subtitle="Historical context · AMFI monthly + Nifty 500 since Apr 2019"
        >
          <InvestorReadStrip read={read} />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {activeEquitySignal && (
              <ActiveEquityFlowTile
                signal={activeEquitySignal}
                sparkline={activeEquitySparkline}
              />
            )}
            {nfoSignal && (
              <NfoHeatTile signal={nfoSignal} sparkline={nfoSparkline} />
            )}
            {passiveSignal && (
              <PassiveShiftTile
                signal={passiveSignal}
                sparkline={passiveSparkline}
              />
            )}
            {sipStickiness && (
              <SipStickinessTile
                signal={sipStickiness}
                sparkline={sipSparkline}
              />
            )}
            {marketStress && <MarketStressTile signal={marketStress} />}
          </div>
          {flowStress.length > 0 && (
            <div className="mt-4 rounded-md border bg-card/50 p-4 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                    Flow Stress History
                    <InfoTooltip label="For every month with both a Nifty 500 drawdown and an active-equity net inflow, the Market Stress Flow rule is replayed. Green dots = Buy-the-dip flow (drawdown ≤ −10% with active-equity flow in the top 40% of history). Red dots = Flow stress (drawdown ≤ −10% with active-equity flow in the bottom 40%). Dashed line marks the −10% drawdown threshold. Historical context only — not a market-bottom model." />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {flowStressHasEvents
                      ? "Buy-the-dip and Flow stress events overlaid on the Nifty 500 drawdown timeline."
                      : "No drawdown / flow stress events on record over the available history."}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[10px] tabular text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-positive" />
                    Buy-the-dip
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-negative" />
                    Flow stress
                  </span>
                </div>
              </div>
              <div className="mt-2">
                <FlowStressHistoryChart data={flowStress} />
              </div>
            </div>
          )}
        </Card>
      )}

      {amfiSelected && (
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
                <Donut data={mixSlices} />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Mix unavailable · sub-category AUM not in uploaded AMFI PDFs
                </div>
              )}
            </Card>
            <ChartWithContext
              title="Total AAUM Trend"
              subtitle={aaumTrendSubtitle}
              flowKind="stock"
              denominatorCaption={totalAaumDenomCaption}
              denominatorTooltip="Each month's total AAUM expressed as a % of the trailing 12-month average AAUM. Helps separate cyclical mean-reversion from structural growth."
              insights={totalAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(aaumTrendData, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
            >
              {aaumTrendHasData ? (
                <BarSeries
                  data={aaumTrendData}
                  name="AAUM"
                  color="hsl(var(--chart-1))"
                  trendline={movingAverage(aaumTrendData, 12)}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  AAUM unavailable · totalAaum not in uploaded AMFI PDFs
                </div>
              )}
            </ChartWithContext>
          </section>
        </div>
      )}

      {hasAnySipTrend && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">SIP Trends</h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {sipTrendsRead ? ` · ${sipTrendsRead}` : ""}
            </p>
          </div>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartWithContext
              title="SIP Contribution Trend"
              subtitle={`Monthly gross SIP inflow · ${sipContribTrend.length} month${sipContribTrend.length === 1 ? "" : "s"} · ₹ Cr · no SIP redemptions are netted`}
              flowKind="gross"
              denominatorCaption={sipContribLatestDenomCaption}
              denominatorTooltip="SIP gross contribution as a share of the industry's net inflow that month. When the share trends up, retail systematic flow is doing more of the heavy lifting; when it falls, lump-sum / institutional money dominates."
              insights={sipContribInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipContribTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
            >
              {sipContribTrend.length > 0 ? (
                <BarSeries
                  data={sipContribTrend}
                  name="SIP Contribution"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                  trendline={movingAverage(sipContribTrend, 12)}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  No SIP contribution months yet
                </div>
              )}
            </ChartWithContext>

            <ChartWithContext
              title="SIP AUM Trend"
              subtitle={`Period-end SIP assets · ${sipAumTrend.length} month${sipAumTrend.length === 1 ? "" : "s"} · ₹ Cr`}
              flowKind="stock"
              denominatorCaption={sipAumDenomCaption}
              denominatorTooltip="SIP AUM as a % of total industry AUM. Captures how much of the industry's asset base sits in committed, recurring flows — a structural-stability indicator."
              insights={sipAumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipAumTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
            >
              {sipAumTrend.length > 0 ? (
                <BarSeries
                  data={sipAumTrend}
                  name="SIP AUM"
                  color="hsl(var(--chart-2))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                  trendline={movingAverage(sipAumTrend, 12)}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  No SIP AUM months yet
                </div>
              )}
            </ChartWithContext>

            <ChartWithContext
              title="SIP Contributing Accounts Trend"
              subtitle={`Active SIP accounts · ${sipAccountsTrend.length} month${sipAccountsTrend.length === 1 ? "" : "s"}`}
              flowKind="stock"
              denominatorCaption={sipAccountsDenomCaption}
              denominatorTooltip="SIP accounts per ₹ Cr of industry AUM — a density measure of investor participation per unit of capital. Rising = more retail-density per Cr; falling = AUM growing faster than account base."
              insights={sipAccountsInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipAccountsTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
            >
              {sipAccountsTrend.length > 0 ? (
                <BarSeries
                  data={sipAccountsTrend}
                  name="SIP Accounts"
                  color="hsl(var(--chart-3))"
                  valueFormat="crore-count"
                  axisFormat="crore-count"
                  labelFormat="month"
                  trendline={movingAverage(sipAccountsTrend, 12)}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  No SIP accounts months yet
                </div>
              )}
            </ChartWithContext>
          </section>
        </div>
      )}

      {monthlyFlowsHasData && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Monthly Flows
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {monthlyFlowsRead ? ` · ${monthlyFlowsRead}` : ""}
            </p>
          </div>
          <ChartWithContext
            title="Equity / Debt / Liquid Monthly Net Flows"
            subtitle={
              monthlyFlowsLens === "share"
                ? `${monthlyFlowsRows.length} month${monthlyFlowsRows.length === 1 ? "" : "s"} · % of monthly flow magnitude (signs preserved)`
                : `${monthlyFlowsRows.length} month${monthlyFlowsRows.length === 1 ? "" : "s"} · ₹ Cr · positive = inflow, negative = outflow`
            }
            flowKind="net"
            denominatorCaption={monthlyFlowsDenomCaption}
            denominatorTooltip="Latest month's per-segment share of total flow magnitude — the headline read for 'where did the month's flow go?'."
            insights={monthlyFlowsInsights}
            yoyBadge={(() => {
              const v = latestYoyPct(equityFlowFromRows, 12);
              return v === null ? undefined : { label: "Equity YoY", pct: v };
            })()}
            action={
              <LensToggle
                basePath="/monthly"
                paramName="flowsLens"
                defaultValue="absolute"
                lenses={[
                  { value: "absolute", label: "₹ Cr" },
                  { value: "share", label: "Share %" },
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
              bars={[
                { key: "equity", name: "Equity", color: "hsl(var(--chart-1))" },
                { key: "debt", name: "Debt", color: "hsl(var(--chart-2))" },
                { key: "liquid", name: "Liquid", color: "hsl(var(--chart-4))" },
              ]}
            />
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Liquid is shown separately for readability.
              <InfoTooltip label="In AMFI classification, Liquid is part of debt-oriented schemes. In share view, each value is divided by the sum of absolute flow magnitudes in that month, so signs (inflow vs outflow) stay intact." />
            </p>
          </ChartWithContext>
        </div>
      )}

      {hasActiveEquityFlowDiagnostics && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active Equity Flow Diagnostics
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            {activeEquityFlowTrend.length > 0 && (
              <ChartWithContext
                title="Active Equity Net Inflows"
                subtitle={`Monthly net inflow · ${activeEquityFlowTrend.length} month${activeEquityFlowTrend.length === 1 ? "" : "s"}${
                  activeEquityFlowAvg !== null
                    ? ` · trailing 12M avg ${formatCompactCrSafe(activeEquityFlowAvg)}`
                    : ""
                } · ₹ Cr`}
                flowKind="net"
                denominatorCaption={activeEquityFlowDenomCaption}
                denominatorTooltip="Latest active-equity net inflow as a % of industry net inflow for the same month — captures how much of the month's flow ended up in the active-equity envelope."
                insights={activeEquityFlowInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(activeEquityFlowTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                <BarSeries
                  data={activeEquityFlowTrend}
                  name="Active Equity Net Inflow"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                  trendline={movingAverage(activeEquityFlowTrend, 12)}
                  trendlineName="12M avg"
                />
                <div className="mt-2">
                  <VolatilityRibbon series={activeEquityFlowTrend} />
                </div>
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Dashed line = trailing 12-month average of net inflow.
                  Strip below = ≥ ±2σ MoM moves shaded green / red.
                  <InfoTooltip label="Active-equity envelope = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
                </p>
              </ChartWithContext>
            )}

            {activeEquityBridge.length > 0 && (
              <ChartWithContext
                title="Active Equity AUM Bridge"
                subtitle={`${activeEquityBridge.length} month${activeEquityBridge.length === 1 ? "" : "s"} · ₹ Cr · net inflow vs market impact`}
                flowKind="gross"
                denominatorCaption={activeEquityBridgeDenomCaption}
                denominatorTooltip="Latest month's market-impact share of |ΔAUM| — tells you whether MoM AUM change was driven by flow or mark-to-market."
                insights={activeEquityBridgeInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(activeEquityBridgeDeltaSeries, 12);
                  return v === null ? undefined : { label: "ΔAUM YoY", pct: v };
                })()}
              >
                <GroupedBars
                  data={activeEquityBridge}
                  xKey="month"
                  labelFormat="month"
                  valueFormat="cr"
                  axisFormat="cr"
                  bars={[
                    {
                      key: "netInflow",
                      name: "Net inflow",
                      color: "hsl(var(--chart-1))",
                    },
                    {
                      key: "marketResidual",
                      name: "Market impact",
                      color: "hsl(var(--chart-3))",
                    },
                  ]}
                />
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Market impact = ΔAUM − net inflow for the month.
                  <InfoTooltip label="Captures mark-to-market and minor reclassification effects on the active-equity envelope. AUM uses month-end values." />
                </p>
              </ChartWithContext>
            )}

            {sipAumShareTrend.length > 0 && (
              <ChartWithContext
                title="SIP AUM as % of Total AUM"
                subtitle={`${sipAumShareTrend.length} month${sipAumShareTrend.length === 1 ? "" : "s"} · SIP AUM ÷ Total AUM`}
                flowKind="stock"
                denominatorCaption={sipAumShareDenomCaption}
                denominatorTooltip="Latest SIP-AUM share minus the trailing 12-month average, in percentage points — separates structural drift from MoM noise on a metric that barely moves."
                insights={sipAumShareInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(sipAumShareTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                <BarSeries
                  data={sipAumShareTrend}
                  name="SIP AUM share"
                  color="hsl(var(--chart-2))"
                  valueFormat="pct"
                  axisFormat="pct"
                  labelFormat="month"
                  trendline={movingAverage(sipAumShareTrend, 12)}
                  trendlineName="12M avg"
                />
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  SIP AUM as a share of total industry AUM.
                  <InfoTooltip label="SIP contribution share of gross inflows is intentionally omitted — gross inflows (Funds Mobilized) are only available on the quarterly disclosure, not in the monthly snapshot." />
                </p>
              </ChartWithContext>
            )}
          </section>
        </div>
      )}

      {hasProportionDiagnostics && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Proportion Diagnostics
            </h2>
            <p className="text-xs text-muted-foreground">
              Rotation, NFO drag, and where new money is going · Source: AMFI Monthly Report
            </p>
          </div>
          {rotation && <CategoryRotationCard rotation={rotation} />}
          <section className="grid gap-4 lg:grid-cols-2">
            {nfoDrag && <NfoDragCard trend={nfoDrag} />}
            {passiveFlowShare && (
              <PassiveFlowShareCard trend={passiveFlowShare} />
            )}
          </section>
        </div>
      )}

      {hasAnyEquityMix && (
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

          <section className="grid gap-4 lg:grid-cols-2">
            <ChartWithContext
              title="Active Equity AAUM Trend"
              subtitle={`${activeEquityTrend.length} month${activeEquityTrend.length === 1 ? "" : "s"} · ₹ Cr · period-average`}
              flowKind="stock"
              denominatorCaption={activeEquityAaumDenomCaption}
              denominatorTooltip="Latest active-equity AAUM as a % of total industry AAUM — separates absolute scale growth from share capture vs other segments."
              insights={activeEquityAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(activeEquityTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
            >
              {activeEquityTrend.length > 0 ? (
                <BarSeries
                  data={activeEquityTrend}
                  name="Active Equity AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                  trendline={movingAverage(activeEquityTrend, 12)}
                  trendlineName="12M avg"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity AAUM unavailable
                </div>
              )}
            </ChartWithContext>

            <ChartWithContext
              title="Active Equity Share of Total AAUM"
              subtitle={`${activeEquityShareTrend.length} month${activeEquityShareTrend.length === 1 ? "" : "s"} · % of period-average Total AAUM`}
              flowKind="stock"
              denominatorCaption={activeEquityShareDenomCaption}
              denominatorTooltip="Latest share minus the trailing 12-month average, in percentage points — the absolute share moves slowly so the pp delta is the more informative read."
              insights={activeEquityShareInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(activeEquityShareTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
            >
              {activeEquityShareTrend.length > 0 ? (
                <BarSeries
                  data={activeEquityShareTrend}
                  name="Active Equity Share"
                  color="hsl(var(--chart-3))"
                  valueFormat="pct"
                  axisFormat="pct"
                  labelFormat="month"
                  trendline={movingAverage(activeEquityShareTrend, 12)}
                  trendlineName="12M avg"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity Share unavailable
                </div>
              )}
            </ChartWithContext>
          </section>

          <ChartWithContext
            title="Equity AAUM Breakdown"
            subtitle={
              equityBreakdownLens === "share"
                ? `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · stacked share of equity AAUM`
                : equityBreakdownSubtitle
            }
            flowKind="stock"
            denominatorCaption={equityBreakdownDenomCaption}
            denominatorTooltip="ETF & Index share of equity AAUM — the headline passive-penetration number tracked across this section."
            insights={equityBreakdownInsights}
            yoyBadge={(() => {
              const v = latestYoyPct(activeEquityFromBreakdown, 12);
              return v === null
                ? undefined
                : { label: "Active YoY", pct: v };
            })()}
            action={
              <LensToggle
                basePath="/monthly"
                paramName="equityMixLens"
                defaultValue="absolute"
                lenses={[
                  { value: "absolute", label: "₹ Cr" },
                  { value: "share", label: "Share %" },
                ]}
                active={equityBreakdownLens}
                preserveParams={preservedQueryParams}
              />
            }
          >
            {equityBreakdownHasData ? (
              <GroupedBars
                data={equityBreakdownDisplay}
                xKey="month"
                labelFormat="month"
                valueFormat={equityBreakdownLens === "share" ? "pct" : "cr"}
                axisFormat={equityBreakdownLens === "share" ? "pct" : "cr"}
                bars={[
                  { key: "activeEquity", name: "Active Equity", color: "hsl(var(--chart-1))" },
                  { key: "etfIndex", name: "ETF & Index", color: "hsl(var(--chart-5))" },
                  { key: "arbitrage", name: "Arbitrage", color: "hsl(var(--chart-2))" },
                ]}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Equity breakdown unavailable
              </div>
            )}
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Active Equity, ETF &amp; Index, and Arbitrage shown separately.
              <InfoTooltip label="Active Equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-oriented schemes. ETF & Index = Index Funds + Other ETFs. Share view divides each segment by the sum of all three for that month." />
            </p>
          </ChartWithContext>
        </div>
      )}

      {activePassiveTrend && activePassiveTrend.history.length > 0 && (
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

          <section className="grid gap-4 lg:grid-cols-2">
            <ChartWithContext
              title="Active Equity vs ETF &amp; Index AUM"
              subtitle={
                activePassiveLens === "share"
                  ? `${activePassiveTrend.history.length} month${activePassiveTrend.history.length === 1 ? "" : "s"} · share of total equity AUM`
                  : `${activePassiveTrend.history.length} month${activePassiveTrend.history.length === 1 ? "" : "s"} · month-end AUM · ₹ Cr`
              }
              flowKind="stock"
              denominatorCaption={activeVsEtfDenomCaption}
              denominatorTooltip="Latest ETF & Index AUM expressed as a percentage of active-equity AUM — captures how far passive has closed the gap. More discriminating than the symmetric share % which compresses both sides."
              insights={activeVsEtfInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(activeVsEtfPassiveSeries, 12);
                return v === null
                  ? undefined
                  : { label: "ETF AUM YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/monthly"
                  paramName="activePassiveLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "Share %" },
                  ]}
                  active={activePassiveLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              <MultiLine
                data={activePassiveTrend.history.map((p) => {
                  const denom = p.activeEquityAum + p.etfIndexAum;
                  if (activePassiveLens === "share") {
                    return {
                      month: p.month,
                      active: denom > 0 ? (p.activeEquityAum / denom) * 100 : null,
                      passive: denom > 0 ? (p.etfIndexAum / denom) * 100 : null,
                    };
                  }
                  return {
                    month: p.month,
                    active: p.activeEquityAum,
                    passive: p.etfIndexAum,
                  };
                })}
                xKey="month"
                labelFormat="month"
                valueFormat={activePassiveLens === "share" ? "pct" : "cr"}
                axisFormat={activePassiveLens === "share" ? "pct" : "cr"}
                lines={[
                  {
                    key: "active",
                    name: "Active equity",
                    color: "hsl(var(--chart-1))",
                  },
                  {
                    key: "passive",
                    name: "ETF & Index",
                    color: "hsl(var(--chart-5))",
                  },
                ]}
              />
              <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Active equity vs ETF &amp; Index AUM.
                <InfoTooltip label="Active equity = equity-oriented + hybrid (ex-arbitrage) + solution-oriented. ETF & Index = Index Funds + Other ETFs (excludes Gold ETFs). Share view divides each by their sum so the two lines always add to 100%." />
              </p>
            </ChartWithContext>

            <ChartWithContext
              title="Passive Share of Equity AUM"
              subtitle={
                activePassiveTrend.forecastMonths > 0 &&
                activePassiveTrend.endOfFyProjectionPct !== null
                  ? `Latest ${activePassiveTrend.latestSharePct.toFixed(2)}% · projected FY-end ${activePassiveTrend.endOfFyProjectionPct.toFixed(2)}% · slope ${activePassiveTrend.trendSlopePctPerMonth >= 0 ? "+" : ""}${activePassiveTrend.trendSlopePctPerMonth.toFixed(3)} pp/mo`
                  : `Latest ${activePassiveTrend.latestSharePct.toFixed(2)}%`
              }
              flowKind="stock"
              denominatorCaption={passiveShareDenomCaption}
              denominatorTooltip="Latest share minus the value 12 months ago, in percentage points — the headline read for passive penetration. Slow-moving, so YoY pp shift is the most informative cut."
              insights={passiveShareInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(passiveShareHistorySeries, 12);
                return v === null
                  ? undefined
                  : { label: "YoY", pct: v };
              })()}
            >
              <MultiLine
                data={activePassiveTrend.share}
                xKey="month"
                labelFormat="month"
                valueFormat="pct"
                axisFormat="pct"
                showDots
                dynamicYDomain
                lines={[
                  {
                    key: "passiveSharePct",
                    name: "Passive share",
                    color: "hsl(var(--chart-5))",
                  },
                ]}
              />
              <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Passive share = ETF &amp; Index ÷ (Active equity + ETF &amp; Index).
                <InfoTooltip label="Forecast (when shown) is a simple trend projection of the historical slope to the upcoming fiscal-year-end (March). Not a predictive model — a directional reference." />
              </p>
            </ChartWithContext>
          </section>
        </div>
      )}

      {iiflTrendHasAny && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active-Equity Category Trends
            </h2>
            <p className="text-xs text-muted-foreground">
              QAAUM share vs net inflow share · active-equity envelope ·
              Source: AMFI Monthly Report
            </p>
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
                    data={c.series}
                    xKey="month"
                    labelFormat="month"
                    valueFormat="pct"
                    axisFormat="pct"
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
                    Category data unavailable
                  </div>
                )}
              </Card>
            ))}
          </section>

          {iiflTrendHasExpanded && (
            <details className="group rounded-md border border-dashed border-border bg-muted/20">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium tracking-tight marker:hidden">
                <span className="inline-flex items-center gap-2">
                  <span className="text-foreground">
                    Show more active-equity categories
                  </span>
                  <span className="rounded-full border border-border bg-background px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {expandedTrendCards.length} more
                  </span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">
                    ›
                  </span>
                </span>
              </summary>
              <div className="border-t border-border/60 p-4">
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
                          data={c.series}
                          xKey="month"
                          labelFormat="month"
                          valueFormat="pct"
                          axisFormat="pct"
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
                          Category data unavailable
                        </div>
                      )}
                    </Card>
                  ))}
                </section>
              </div>
            </details>
          )}

          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            QAAUM share and net inflow share, both within the
            active-equity envelope.
            <InfoTooltip label="Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
          </p>
        </div>
      )}

      {categoryResilienceRows.length > 0 && (
        <CategoryResilienceCard rows={categoryResilienceRows} />
      )}

      {iiflHeatmapHasData && (
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
            <HeatmapLensToggle lens={heatmapLens} />
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

      {hasAnyFolioOrNfo && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Industry Folios &amp; NFO
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
              {foliosNfoRead ? ` · ${foliosNfoRead}` : ""}
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

          {hasAnyFolioOrNfoTrend && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ChartWithContext
                title="Folio Additions Trend"
                subtitle={`Net new folios per month · ${folioAdditionsTrend.length} month${folioAdditionsTrend.length === 1 ? "" : "s"} · lakh · ${foliosHover ?? ""}`}
                flowKind="net"
                denominatorCaption={folioAdditionsDenomCaption}
                denominatorTooltip="Monthly folio additions expressed as basis points of the existing folio base. The bps view normalises growth against the (large, growing) base so the trend is comparable across years."
                insights={folioAdditionsInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(folioAdditionsTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                {folioAdditionsTrend.length > 0 ? (
                  <BarSeries
                    data={folioAdditionsTrend}
                    name="Folio Additions"
                    color="hsl(var(--chart-4))"
                    valueFormat="lakh"
                    axisFormat="lakh"
                    labelFormat="month"
                    trendline={movingAverage(folioAdditionsTrend, 12)}
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Need at least two consecutive months of folios
                  </div>
                )}
              </ChartWithContext>

              <ChartWithContext
                title="NFO Launches Trend"
                subtitle={`Open + close-ended schemes · ${nfoCountTrend.length} month${nfoCountTrend.length === 1 ? "" : "s"} · ${nfoCountSourceLine}`}
                flowKind="stock"
                denominatorCaption={nfoCountDenomCaption}
                denominatorTooltip="Monthly NFO launches as a % of the trailing 5-year monthly average. Values above 100% = launch activity hotter than the 5Y norm (often coincides with bullish market regimes)."
                insights={nfoCountInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(nfoCountTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                {nfoCountTrend.length > 0 ? (
                  <BarSeries
                    data={nfoCountTrend}
                    name="NFO Launches"
                    color="hsl(var(--chart-5))"
                    valueFormat="count"
                    axisFormat="count"
                    labelFormat="month"
                    trendline={movingAverage(nfoCountTrend, 12)}
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    No NFO count months yet
                  </div>
                )}
              </ChartWithContext>

              <ChartWithContext
                title="NFO Funds Mobilised Trend"
                subtitle={`Gross funds raised during NFOs · ${nfoFundsTrend.length} month${nfoFundsTrend.length === 1 ? "" : "s"} · ₹ Cr · no redemptions netted · ${nfoFundsSourceLine}`}
                flowKind="gross"
                denominatorCaption={nfoFundsDenomCaption}
                denominatorTooltip="NFO gross funds mobilised as a % of industry net inflow that month — i.e., how much of the month's net flow was absorbed by new fund launches vs going to existing schemes."
                insights={nfoFundsInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(nfoFundsTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                {nfoFundsTrend.length > 0 ? (
                  <BarSeries
                    data={nfoFundsTrend}
                    name="NFO Funds"
                    color="hsl(var(--chart-2))"
                    valueFormat="cr"
                    axisFormat="cr"
                    labelFormat="month"
                    trendline={movingAverage(nfoFundsTrend, 12)}
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    No NFO funds months yet
                  </div>
                )}
              </ChartWithContext>
            </section>
          )}
        </div>
      )}

      {flowWaterfall && (
        <Card
          title="Industry AUM Bridge — 12-month flow decomposition"
          subtitle={`Opening ${flowWaterfall.startMonth} → Closing ${flowWaterfall.endMonth} · SIP + Lump sum + Market = ΔAUM · Source: AMFI Monthly Report`}
        >
          <Waterfall data={flowWaterfall.steps} valueFormat="cr" axisFormat="cr" />
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            ΔAUM split into SIP, lump sum, and market / residual impact.
            <InfoTooltip label="(1) Cumulative SIP contributions. (2) Lump sum / other net flow = total industry net inflow − SIP. (3) Market / residual impact = ΔAUM − total net inflow (captures mark-to-market and reclassification). SIP and total net inflow come from the AMFI Monthly Report; the market residual is derived." />
          </p>
        </Card>
      )}

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
            AAUM disclosure unavailable
          </div>
        )}
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Top {aumMarketShare.topAmcs.length} AMCs by latest AAUM;
          Others includes all remaining AMCs.
          <InfoTooltip label="Denominator is total AAUM of all AMCs in the snapshot." />
        </p>
      </Card>

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
 *  two <a> tags so server routing handles state. No client component
 *  overhead. Each link preserves the rest of the URL params we care
 *  about (currently just `?month=`, which the heatmap window doesn't
 *  use, so we keep it simple and reset to a single param). */
function HeatmapLensToggle({ lens }: { lens: "share" | "zscore" }) {
  const baseClass =
    "rounded-md border px-2.5 py-1 text-[11px] font-medium tracking-tight transition-colors";
  const activeClass = "border-foreground/40 bg-foreground/5 text-foreground";
  const inactiveClass =
    "border-border text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5 shadow-sm">
      <Link
        href={{ pathname: "/monthly" }}
        scroll={false}
        className={cn(baseClass, lens === "share" ? activeClass : inactiveClass)}
      >
        Share
      </Link>
      <Link
        href={{ pathname: "/monthly", query: { heatmap: "zscore" } }}
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
      subtitle={`NFO mobilisation ÷ industry net inflow · ${trend.history.length} months · ₹ Cr`}
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
        Latest {trend.latestRatioPct.toFixed(1)}% · {trend.percentile?.toFixed(0) ?? "—"}th
        percentile of available history. Mean {trend.mean.toFixed(1)}%.
        <InfoTooltip label="Ratio = industryNfoFundsMobilized ÷ netInflow × 100. Months with non-positive total industry net inflow are skipped (the ratio is undefined). Bars cap at 200% for readability; raw values preserved in the percentile read. High ratios = NFOs absorbing more of the month's industry net inflow than usual — historically a froth cue, not a buy/sell call." />
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
      subtitle={`Where the latest month's equity money is going · ${trend.history.length} months`}
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
        Latest {trend.latestSharePct.toFixed(1)}% · {trend.percentile?.toFixed(0) ?? "—"}th
        percentile of available history. Mean {trend.mean.toFixed(1)}%.
        <InfoTooltip label="Passive flow share = (Index Funds + Other ETFs net inflow) ÷ (Index Funds + Other ETFs + active-equity net inflow) × 100. Leading indicator of where the active-vs-passive AUM mix is heading — passive share of NEW money tends to move months before passive share of AUM. Gold ETFs are excluded. Months with non-positive denominator are skipped." />
      </p>
    </Card>
  );
}

function formatSignedCompactCr(v: number): string {
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

function signalToneClass(label: ActiveEquitySignalLabel): string {
  switch (label) {
    case "Very strong":
    case "Strong":
      return "border-positive/40 bg-positive/10 text-positive";
    case "Weak":
    case "Very weak":
      return "border-negative/40 bg-negative/10 text-negative";
    case "Insufficient history":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/** NFO Heat is a *contextual* indicator: high readings often coincide
 *  with bullish, NFO-heavy phases of the cycle (think 2021, late 2024)
 *  — historically interesting, not directly "good" for investors.
 *  Keep all bands on a muted tone so the panel doesn't imply that a
 *  Strong / Very strong NFO reading is a positive signal. */
function nfoToneClass(label: ActiveEquitySignalLabel): string {
  if (label === "Insufficient history") {
    return "border-border bg-muted text-muted-foreground";
  }
  return "border-foreground/30 bg-muted text-foreground";
}

function passiveToneClass(label: PassiveShiftLabel): string {
  // "Passive gaining share" and "Active-heavy" are structural reads,
  // not directional good/bad — keep both on a muted style so the
  // panel doesn't suggest a winner.
  switch (label) {
    case "Passive gaining share":
      return "border-foreground/30 bg-muted text-foreground";
    case "Active-heavy":
      return "border-foreground/30 bg-muted text-foreground";
    case "Insufficient history":
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function marketStressToneClass(label: MarketStressLabel): string {
  switch (label) {
    case "Buy-the-dip flow":
      return "border-positive/40 bg-positive/10 text-positive";
    case "Flow stress":
      return "border-negative/40 bg-negative/10 text-negative";
    case "Insufficient history":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/** Shared compact tile used by every signal in the Investor Signals
 *  panel. Keeps spacing and typography consistent across signals. */
function SignalTile({
  name,
  primary,
  primaryNote,
  badge,
  badgeClass,
  metrics,
  read,
  infoLabel,
  sparkline,
  sparklineColor,
}: {
  name: string;
  primary: string;
  primaryNote?: string;
  badge: string;
  badgeClass: string;
  metrics: { key: string; label: string; value: string }[];
  read: string;
  infoLabel: string;
  sparkline?: SparklinePoint[];
  sparklineColor?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {name}
          <InfoTooltip label={infoLabel} />
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-tight whitespace-nowrap",
            badgeClass
          )}
        >
          {badge}
        </span>
      </div>
      <div>
        <div className="text-xl font-semibold tabular tracking-tight">
          {primary}
        </div>
        {primaryNote && (
          <div className="text-[10px] tabular text-muted-foreground/80">
            {primaryNote}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((m) => (
          <div key={m.key}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {m.label}
            </div>
            <div className="text-sm font-medium tabular">{m.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{read}</p>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-1 -mx-1">
          <Sparkline data={sparkline} color={sparklineColor} height={32} />
          <div className="mt-0.5 flex items-center justify-between text-[9px] tabular text-muted-foreground/70">
            <span>{sparkline[0].label}</span>
            <span className="uppercase tracking-wide">
              {sparkline.length}m trend
            </span>
            <span>{sparkline[sparkline.length - 1].label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function cyclePhaseToneClass(phase: CyclePhase): string {
  switch (phase) {
    case "Recovery":
    case "Expansion":
      return "border-positive/40 bg-positive/10 text-positive";
    case "Correction":
      return "border-negative/40 bg-negative/10 text-negative";
    case "Peak":
      return "border-foreground/40 bg-muted text-foreground";
    case "Base":
      return "border-foreground/30 bg-muted text-foreground";
    case "Insufficient data":
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/** Composite Investor Read strip rendered at the top of the Investor
 *  Signals panel. Synthesises the five signals into a 1-2 sentence
 *  English narrative plus a Cycle Phase pill. Methodology lives behind
 *  the InfoTooltip so the strip itself stays compact. */
function InvestorReadStrip({
  read,
}: {
  read: ReturnType<typeof investorRead>;
}) {
  return (
    <div className="mb-4 rounded-md border bg-card/50 p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
          Investor Read
          <InfoTooltip label={read.methodologyTooltip} />
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight whitespace-nowrap",
            cyclePhaseToneClass(read.phase)
          )}
        >
          Cycle phase · {read.phase}
        </span>
      </div>
      <p className="mt-2 text-sm text-foreground/90">{read.narrative}</p>
    </div>
  );
}

function ActiveEquityFlowTile({
  signal,
  sparkline,
}: {
  signal: ActiveEquityNetInflowSignal;
  sparkline?: SparklinePoint[];
}) {
  const z = signal.zScore;
  const pct = signal.percentileRank;
  const read =
    signal.label === "Insufficient history"
      ? "Not enough history yet to score the latest month."
      : signal.label === "Very strong" || signal.label === "Strong"
        ? `Active-equity inflow is in the top ${pct !== null ? (100 - pct).toFixed(0) : "—"}% of months on record.`
        : signal.label === "Weak" || signal.label === "Very weak"
          ? `Active-equity inflow is in the bottom ${pct !== null ? pct.toFixed(0) : "—"}% of months on record.`
          : "Active-equity inflow is broadly in line with the historical norm.";
  return (
    <SignalTile
      name="Active Equity Flow"
      primary={formatSignedCompactCr(signal.latestValue)}
      primaryNote={`Net inflow · ${signal.latestMonth}`}
      badge={signal.label}
      badgeClass={signalToneClass(signal.label)}
      metrics={[
        {
          key: "z",
          label: "Z-score",
          value: z !== null ? z.toFixed(2) + "σ" : "—",
        },
        {
          key: "pct",
          label: "Percentile",
          value: pct !== null ? pct.toFixed(0) + "th" : "—",
        },
      ]}
      read={read}
      infoLabel={`Z-score = how many standard deviations the latest active-equity net inflow sits from the historical mean. Percentile = share of months with value ≤ latest. High readings = inflows running above the long-run norm. History: ${signal.historyStart} → ${signal.historyEnd} (${signal.historyMonths} months).`}
      sparkline={sparkline}
      sparklineColor="hsl(var(--chart-1))"
    />
  );
}

function NfoHeatTile({
  signal,
  sparkline,
}: {
  signal: NfoHeatSignal;
  sparkline?: SparklinePoint[];
}) {
  const z = signal.zScore;
  const pct = signal.percentileRank;
  const read =
    signal.label === "Insufficient history"
      ? "Not enough history yet to score the latest month."
      : signal.label === "Very strong" || signal.label === "Strong"
        ? "NFO activity is at the high end of history — often a bull-market cue, not a buy signal."
        : signal.label === "Weak" || signal.label === "Very weak"
          ? "NFO activity is at the low end of history — fewer new fund launches than usual."
          : "NFO activity is broadly in line with the historical norm.";
  return (
    <SignalTile
      name="NFO Heat"
      primary={formatSignedCompactCr(signal.latestValue)}
      primaryNote={`NFO funds mobilised · ${signal.latestMonth}`}
      badge={signal.label}
      badgeClass={nfoToneClass(signal.label)}
      metrics={[
        {
          key: "z",
          label: "Z-score",
          value: z !== null ? z.toFixed(2) + "σ" : "—",
        },
        {
          key: "pct",
          label: "Percentile",
          value: pct !== null ? pct.toFixed(0) + "th" : "—",
        },
      ]}
      read={read}
      infoLabel={`Z-score = how many standard deviations the latest NFO mobilisation sits from the historical mean. Percentile = share of months with value ≤ latest. High readings often coincide with bullish, NFO-heavy phases — context, not a buy/sell call. History: ${signal.historyStart} onwards (${signal.historyMonths} months).`}
      sparkline={sparkline}
      sparklineColor="hsl(var(--chart-2))"
    />
  );
}

function PassiveShiftTile({
  signal,
  sparkline,
}: {
  signal: PassiveShiftSignal;
  sparkline?: SparklinePoint[];
}) {
  const pct = signal.percentileRank;
  const read =
    signal.label === "Passive gaining share"
      ? `Passive share of equity AUM is in the top ${pct !== null ? (100 - pct).toFixed(0) : "—"}% of months on record.`
      : signal.label === "Active-heavy"
        ? `Passive share of equity AUM is in the bottom ${pct !== null ? pct.toFixed(0) : "—"}% of months on record.`
        : signal.label === "Insufficient history"
          ? "Not enough history yet to score the latest month."
          : "Passive share is broadly in line with the historical norm.";
  return (
    <SignalTile
      name="Passive Shift"
      primary={signal.latestSharePct.toFixed(2) + "%"}
      primaryNote={`Passive share · ${signal.latestMonth}`}
      badge={signal.label}
      badgeClass={passiveToneClass(signal.label)}
      metrics={[
        {
          key: "mean",
          label: "Historical avg",
          value: signal.mean.toFixed(2) + "%",
        },
        {
          key: "pct",
          label: "Percentile",
          value: pct !== null ? pct.toFixed(0) + "th" : "—",
        },
      ]}
      read={read}
      infoLabel={`Passive share = ETF & Index AUM ÷ (Active Equity AUM + ETF & Index AUM) × 100. Percentile shows where the latest reading sits in the slowly-rising passive trend. History: ${signal.historyStart} onwards (${signal.historyMonths} months).`}
      sparkline={sparkline}
      sparklineColor="hsl(var(--chart-5))"
    />
  );
}

function SipStickinessTile({
  signal,
  sparkline,
}: {
  signal: SipStickinessSignal;
  sparkline?: SparklinePoint[];
}) {
  const z = signal.zScore;
  const pct = signal.percentileRank;
  const read =
    signal.label === "Insufficient history"
      ? "Not enough SIP history yet to score the latest month."
      : signal.label === "Very strong" || signal.label === "Strong"
        ? "SIP-based AUM share is at the high end of the available history."
        : signal.label === "Weak" || signal.label === "Very weak"
          ? "SIP-based AUM share is at the low end of the available history."
          : "SIP-based AUM share is broadly in line with the historical norm.";
  return (
    <SignalTile
      name="SIP Stickiness"
      primary={signal.latestSharePct.toFixed(2) + "%"}
      primaryNote={`SIP AUM share · ${signal.latestMonth}`}
      badge={signal.label}
      badgeClass={signalToneClass(signal.label)}
      metrics={[
        {
          key: "z",
          label: "Z-score",
          value: z !== null ? z.toFixed(2) + "σ" : "—",
        },
        {
          key: "pct",
          label: "Percentile",
          value: pct !== null ? pct.toFixed(0) + "th" : "—",
        },
      ]}
      read={read}
      infoLabel={`SIP stickiness = SIP AUM ÷ Total AUM × 100. Captures the structural, recurring portion of industry AUM. AMFI's SIP press-release coverage starts later than the Monthly Report — available SIP history starts from ${signal.historyStart} (${signal.historyMonths} months).`}
      sparkline={sparkline}
      sparklineColor="hsl(var(--chart-3))"
    />
  );
}

function MarketStressTile({ signal }: { signal: MarketStressSignal }) {
  const pct = signal.flowPercentileRank;
  const read =
    signal.label === "Buy-the-dip flow"
      ? "Nifty 500 is in drawdown and active-equity flows are running high."
      : signal.label === "Flow stress"
        ? "Nifty 500 is in drawdown and active-equity flows are running low."
        : signal.label === "Insufficient history"
          ? "Not enough overlapping history yet to score the latest month."
          : "No combined drawdown / flow stress signal on the latest aligned month.";
  return (
    <SignalTile
      name="Market Stress Flow"
      primary={signal.drawdownPct.toFixed(2) + "%"}
      primaryNote={`Nifty 500 drawdown · ${signal.alignedMonth}`}
      badge={signal.label}
      badgeClass={marketStressToneClass(signal.label)}
      metrics={[
        {
          key: "flow",
          label: "Active-equity flow",
          value: formatSignedCompactCr(signal.flowValue),
        },
        {
          key: "pct",
          label: "Flow percentile",
          value: pct !== null ? pct.toFixed(0) + "th" : "—",
        },
      ]}
      read={read}
      infoLabel={`Drawdown = Nifty 500 month-end vs its rolling all-time high. Flow percentile = share of months with active-equity net inflow ≤ aligned month. Labels: "Buy-the-dip flow" when drawdown ≤ −10% and flow percentile ≥ 60; "Flow stress" when drawdown ≤ −10% and flow percentile ≤ 40. Historical context only — not a market-bottom model.`}
    />
  );
}
