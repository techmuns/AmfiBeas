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
  investorRead,
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
  nfoHeatSignal,
  passiveShiftSignal,
  resolveSelectedRow,
  sipStickinessSignal,
  trailingActiveEquityNetInflowAverage,
  type AmfiMonthlyKpiField,
} from "@/data/amfi-monthly";
import {
  cyclePhaseHistory,
  historicalEpisodes,
  investorMood,
  latestNifty500Row,
  marketIndexRows,
  marketStressFlowSignal,
  weatherBadge,
} from "@/data/market-indices";
import { SankeyFlow } from "@/components/charts/SankeyFlow";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { CalendarHeatGrid } from "@/components/ui/CalendarHeatGrid";
import { CalloutCard } from "@/components/ui/CalloutCard";
import { CategoryResilienceCard } from "@/components/ui/CategoryResilienceCard";
import { categoryDrawdownResilience } from "@/data/category-resilience";
import { EpisodeRecoveryCard } from "@/components/ui/EpisodeRecoveryCard";
import { episodeRecoveryRows } from "@/data/episode-recovery";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { marketWrap } from "@/data/market-wrap";
import { CoachPill } from "@/components/ui/CoachPill";
import { EpisodeReplayStrip } from "@/components/ui/EpisodeReplayStrip";
import { HeadlineCard } from "@/components/ui/HeadlineCard";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { StickyContextFooter } from "@/components/ui/StickyContextFooter";
import { LensToggle } from "@/components/ui/LensToggle";
import { MoodGauge } from "@/components/ui/MoodGauge";
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
  // Chart-type toggles. Each eligible bar-style time-series card on
  // the page owns its own `<thing>View` URL param. Bars is the
  // default and is never echoed into the URL — only the "trend"
  // value rides along so the default page stays URL-clean.
  // Chart-style toggles (Bars vs Trend) were removed across the
  // dashboard — every chart now renders the trend visual directly.
  // Stale `?...View=bars|trend` URLs are ignored silently.
  const equityBreakdownLens: "absolute" | "share" =
    sp.equityMixLens === "share" ? "share" : "absolute";
  const activePassiveLens: "absolute" | "share" =
    sp.activePassiveLens === "share" ? "share" : "absolute";
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
  const folioAddLens: "absolute" | "share" =
    sp.folioAddLens === "share" ? "share" : "absolute";
  const nfoCountLens: "absolute" | "share" =
    sp.nfoCountLens === "share" ? "share" : "absolute";
  const nfoFundsLens: "absolute" | "share" =
    sp.nfoFundsLens === "share" ? "share" : "absolute";
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
    aaumLens: typeof sp.aaumLens === "string" ? sp.aaumLens : undefined,
    sipContribLens:
      typeof sp.sipContribLens === "string" ? sp.sipContribLens : undefined,
    sipAumLens:
      typeof sp.sipAumLens === "string" ? sp.sipAumLens : undefined,
    sipAccountsLens:
      typeof sp.sipAccountsLens === "string" ? sp.sipAccountsLens : undefined,
    aeFlowLens:
      typeof sp.aeFlowLens === "string" ? sp.aeFlowLens : undefined,
    aeAaumLens:
      typeof sp.aeAaumLens === "string" ? sp.aeAaumLens : undefined,
    folioAddLens:
      typeof sp.folioAddLens === "string" ? sp.folioAddLens : undefined,
    nfoCountLens:
      typeof sp.nfoCountLens === "string" ? sp.nfoCountLens : undefined,
    nfoFundsLens:
      typeof sp.nfoFundsLens === "string" ? sp.nfoFundsLens : undefined,
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
    .slice(-24);
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
    .slice(-24);
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
  const nfoCountTrend = monthlyTrend("industryNfoCount", 24);
  const nfoFundsTrend = monthlyTrend("industryNfoFundsMobilized", 24);
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
  const activeEquityFlowTrend = monthlyActiveEquityNetInflowTrend(24);
  const activeEquityFlowAvg = trailingActiveEquityNetInflowAverage(12);
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
  const rotation = categoryRotation(3, 5);
  const nfoDrag = nfoDragTrend(24);
  const passiveFlowShare = passiveFlowShareTrend(24);
  const hasProportionDiagnostics =
    rotation !== null || nfoDrag !== null || passiveFlowShare !== null;

  // The headline active-equity signal drives the HeadlineCard at the
  // top of the page; nfo/passive/sip/market-stress signals feed the
  // top-callouts row and the InvestorRead composite used by the
  // HeadlineCard takeaway line. The 5-tile Investor Signals card
  // itself was deleted (PR #171) — its sparklines went with it.
  const activeEquitySignal = activeEquityNetInflowSignal();
  const nfoSignal = nfoHeatSignal();
  const passiveSignal = passiveShiftSignal();
  const sipStickiness = sipStickinessSignal();
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
  // Coach message: surfaces the single most striking signal on the page.
  const coachMessage = (() => {
    const stress = marketStressFlowSignal();
    if (stress?.label === "Buy-the-dip flow") {
      return `Nifty 500 is in a ${Math.abs(stress.drawdownPct).toFixed(1)}% drawdown but active-equity flow sits in the ${formatPercentile(stress.flowPercentileRank)} — investors are buying the dip.`;
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
      context: `Latest ${activeEquitySignal.latestMonth} · ${formatCompactCrSafe(activeEquitySignal.latestValue)} vs historical mean ${formatCompactCrSafe(activeEquitySignal.mean)}`,
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
      context: `Latest ${activeEquitySignal.latestMonth} · ${formatCompactCrSafe(activeEquitySignal.latestValue)} vs historical mean ${formatCompactCrSafe(activeEquitySignal.mean)}`,
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
      context: `Latest ${nfoSignal.latestMonth} · ${formatCompactCrSafe(nfoSignal.latestValue)} vs ${formatCompactCrSafe(nfoSignal.mean)} historical mean`,
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
      context: `Latest ${nfoSignal.latestMonth} · ${formatCompactCrSafe(nfoSignal.latestValue)}`,
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
  const activeEquityMixRead = activeEquityMixSectionRead();
  const foliosNfoRead = foliosNfoSectionRead();
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

  // ---- Active vs Passive series ------------------------------------
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Monthly Operating KPIs"
        subtitle={subtitle}
        action={<WeatherBadge headline={weather.headline} tone={weather.tone} />}
      />

      <MarketWrapCard wrap={marketWrapData} />

      <SectionDivider
        eyebrow="Section 1"
        label="Today's read"
        context="The single-glance regime call, headline signal and any newsworthy anomaly."
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

      <SectionDivider
        eyebrow="Section 2"
        label="Industry flow"
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        context="What's happening with industry-wide assets and the latest month's net flow."
      />

      {(flowHeatCells.length > 0 || sankeyData) && (
        <details className="group">
          <summary className="cursor-pointer list-none rounded-md border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm font-medium tracking-tight marker:hidden hover:bg-muted/30">
            <span className="inline-flex items-center gap-2">
              <span className="text-foreground">
                Show detailed industry views (7-year calendar + Sankey)
              </span>
              <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
            </span>
          </summary>
          <div className="mt-3 space-y-4">
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
                  formatValue={(v) => formatCompactCrSafe(v)}
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
          </div>
        </details>
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
              subtitle={
                aaumLens === "share"
                  ? `${aaumTrendDataShare.length} month${aaumTrendDataShare.length === 1 ? "" : "s"} · indexed to trailing 12M avg`
                  : aaumTrendSubtitle
              }
              flowKind="stock"
              denominatorCaption={
                aaumLens === "share" ? undefined : totalAaumDenomCaption
              }
              denominatorTooltip="Each month's total AAUM expressed as a % of the trailing 12-month average AAUM. Helps separate cyclical mean-reversion from structural growth."
              insights={totalAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(aaumTrendData, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              {aaumTrendHasData ? (
                <BarSeries
                  data={aaumDisplayData}
                  name="AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat={aaumLens === "share" ? "pct" : "cr"}
                  axisFormat={aaumLens === "share" ? "pct" : "cr"}
                  trendline={
                    aaumLens === "share"
                      ? undefined
                      : movingAverage(aaumTrendData, 12)
                  }
                  referenceValue={aaumLens === "share" ? 100 : undefined}
                  referenceLabel={aaumLens === "share" ? "12M avg" : undefined}
                  cyclePhaseBands={cyclePhaseBands}
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

      {monthlyFlowsHasData && (
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
            <div className="flex flex-wrap items-center gap-2">
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
            </div>
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
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Liquid is shown separately for readability.
            <InfoTooltip label="In AMFI classification, Liquid is part of debt-oriented schemes. In share view, each value is divided by the sum of absolute flow magnitudes in that month, so signs (inflow vs outflow) stay intact." />
          </p>
        </ChartWithContext>
      )}

      <SectionDivider
        eyebrow="Section 3"
        label="Retail / SIP pulse"
        context="Are systematic flows holding up, slowing, or accelerating? Folio growth read."
      />

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
              subtitle={
                sipContribLens === "share"
                  ? `${sipContribShare.length} month${sipContribShare.length === 1 ? "" : "s"} · % of industry net inflow`
                  : `Monthly gross SIP inflow · ${sipContribTrend.length} month${sipContribTrend.length === 1 ? "" : "s"} · ₹ Cr · no SIP redemptions are netted`
              }
              flowKind="gross"
              denominatorCaption={
                sipContribLens === "share" ? undefined : sipContribLatestDenomCaption
              }
              denominatorTooltip="SIP gross contribution as a share of the industry's net inflow that month. When the share trends up, retail systematic flow is doing more of the heavy lifting; when it falls, lump-sum / institutional money dominates."
              insights={sipContribInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipContribTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              {sipContribTrend.length > 0 ? (
                <BarSeries
                  data={sipContribDisplay}
                  name="SIP Contribution"
                  color="hsl(var(--chart-1))"
                  valueFormat={sipContribLens === "share" ? "pct" : "cr"}
                  axisFormat={sipContribLens === "share" ? "pct" : "cr"}
                  labelFormat="month"
                  trendline={
                    sipContribLens === "share"
                      ? undefined
                      : movingAverage(sipContribTrend, 12)
                  }
                  cyclePhaseBands={cyclePhaseBands}
                  dynamicYDomain={sipContribLens === "share"}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  SIP contribution not yet ingested — appears once the next AMFI Monthly Notes (press release) lands.
                </div>
              )}
            </ChartWithContext>

            <ChartWithContext
              title="SIP AUM Trend"
              subtitle={
                sipAumLens === "share"
                  ? `${sipAumShare.length} month${sipAumShare.length === 1 ? "" : "s"} · % of total industry AUM`
                  : `Period-end SIP assets · ${sipAumTrend.length} month${sipAumTrend.length === 1 ? "" : "s"} · ₹ Cr`
              }
              flowKind="stock"
              denominatorCaption={
                sipAumLens === "share" ? undefined : sipAumDenomCaption
              }
              denominatorTooltip="SIP AUM as a % of total industry AUM. Captures how much of the industry's asset base sits in committed, recurring flows — a structural-stability indicator."
              insights={sipAumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipAumTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              {sipAumTrend.length > 0 ? (
                <BarSeries
                  data={sipAumDisplay}
                  name="SIP AUM"
                  color="hsl(var(--chart-2))"
                  valueFormat={sipAumLens === "share" ? "pct" : "cr"}
                  axisFormat={sipAumLens === "share" ? "pct" : "cr"}
                  labelFormat="month"
                  trendline={
                    sipAumLens === "share"
                      ? undefined
                      : movingAverage(sipAumTrend, 12)
                  }
                  cyclePhaseBands={cyclePhaseBands}
                  dynamicYDomain={sipAumLens === "share"}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  SIP AUM not yet ingested — appears once the next AMFI Monthly Notes (press release) lands.
                </div>
              )}
            </ChartWithContext>

            <ChartWithContext
              title="SIP Contributing Accounts Trend"
              subtitle={
                sipAccountsLens === "share"
                  ? `${sipAccountsShare.length} month${sipAccountsShare.length === 1 ? "" : "s"} · accounts per ₹ Cr AUM`
                  : `Active SIP accounts · ${sipAccountsTrend.length} month${sipAccountsTrend.length === 1 ? "" : "s"}`
              }
              flowKind="stock"
              denominatorCaption={
                sipAccountsLens === "share" ? undefined : sipAccountsDenomCaption
              }
              denominatorTooltip="SIP accounts per ₹ Cr of industry AUM — a density measure of investor participation per unit of capital. Rising = more retail-density per Cr; falling = AUM growing faster than account base."
              insights={sipAccountsInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(sipAccountsTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              {sipAccountsTrend.length > 0 ? (
                <BarSeries
                  data={sipAccountsDisplay}
                  name="SIP Accounts"
                  color="hsl(var(--chart-3))"
                  valueFormat={sipAccountsLens === "share" ? "count" : "crore-count"}
                  axisFormat={sipAccountsLens === "share" ? "count" : "crore-count"}
                  labelFormat="month"
                  trendline={
                    sipAccountsLens === "share"
                      ? undefined
                      : movingAverage(sipAccountsTrend, 12)
                  }
                  cyclePhaseBands={cyclePhaseBands}
                  dynamicYDomain={sipAccountsLens === "share"}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  SIP accounts not yet ingested — appears once the next AMFI Monthly Notes (press release) lands.
                </div>
              )}
            </ChartWithContext>
          </section>
        </div>
      )}

      {hasActiveEquityFlowDiagnostics && (
        <details className="group">
          <summary className="cursor-pointer list-none rounded-md border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm font-medium tracking-tight marker:hidden hover:bg-muted/30">
            <span className="inline-flex items-center gap-2">
              <span className="text-foreground">
                Show active equity flow diagnostics
              </span>
              <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
            </span>
          </summary>
          <section className="mt-3 grid gap-4 lg:grid-cols-2">
            {activeEquityFlowTrend.length > 0 && (
              <ChartWithContext
                title="Active Equity Net Inflows"
                subtitle={
                  aeFlowLens === "share"
                    ? `${activeEquityFlowShare.length} month${activeEquityFlowShare.length === 1 ? "" : "s"} · % of industry net inflow`
                    : `Monthly net inflow · ${activeEquityFlowTrend.length} month${activeEquityFlowTrend.length === 1 ? "" : "s"}${
                        activeEquityFlowAvg !== null
                          ? ` · trailing 12M avg ${formatCompactCrSafe(activeEquityFlowAvg)}`
                          : ""
                      } · ₹ Cr`
                }
                flowKind="net"
                denominatorCaption={
                  aeFlowLens === "share" ? undefined : activeEquityFlowDenomCaption
                }
                denominatorTooltip="Latest active-equity net inflow as a % of industry net inflow for the same month — captures how much of the month's flow ended up in the active-equity envelope."
                insights={activeEquityFlowInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(activeEquityFlowTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <LensToggle
                      basePath="/monthly"
                      paramName="aeFlowLens"
                      defaultValue="absolute"
                      lenses={[
                        { value: "absolute", label: "₹ Cr" },
                        { value: "share", label: "% of net inflow" },
                      ]}
                      active={aeFlowLens}
                      preserveParams={preservedQueryParams}
                    />
                  </div>
                }
              >
                <BarSeries
                  data={activeEquityFlowDisplay}
                  name="Active Equity Net Inflow"
                  color="hsl(var(--chart-1))"
                  valueFormat={aeFlowLens === "share" ? "pct" : "cr"}
                  axisFormat={aeFlowLens === "share" ? "pct" : "cr"}
                  labelFormat="month"
                  trendline={
                    aeFlowLens === "share"
                      ? undefined
                      : movingAverage(activeEquityFlowTrend, 12)
                  }
                  trendlineName="12M avg"
                  cyclePhaseBands={cyclePhaseBands}
                />
                {aeFlowLens === "absolute" && (
                  <div className="mt-2">
                    <VolatilityRibbon series={activeEquityFlowTrend} />
                  </div>
                )}
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {aeFlowLens === "absolute"
                    ? "Dashed line = trailing 12-month average of net inflow. Strip below = ≥ ±2σ MoM moves shaded green / red."
                    : "Share of industry net inflow captured by the active-equity envelope each month."}
                  <InfoTooltip label="Active-equity envelope = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
                </p>
              </ChartWithContext>
            )}

            {activeEquityBridgeStrip && (
              <ChartWithContext
                title="Active Equity AUM Bridge"
                subtitle={`${activeEquityBridgeStrip.windowMonths}-month bridge · opening → flow → market → closing`}
                flowKind="gross"
                denominatorCaption={activeEquityBridgeDenomCaption}
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
          </section>
        </details>
      )}

      {hasProportionDiagnostics && (
        <details className="group">
          <summary className="cursor-pointer list-none rounded-md border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm font-medium tracking-tight marker:hidden hover:bg-muted/30">
            <span className="inline-flex items-center gap-2">
              <span className="text-foreground">
                Show rotation, NFO drag and passive flow share
              </span>
              <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {rotation && <CategoryRotationCard rotation={rotation} />}
            <section className="grid gap-4 lg:grid-cols-2">
              {nfoDrag && <NfoDragCard trend={nfoDrag} />}
              {passiveFlowShare && (
                <PassiveFlowShareCard trend={passiveFlowShare} />
              )}
            </section>
          </div>
        </details>
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

          {hasAnyFolioOrNfoTrend && folioAdditionsTrend.length > 0 && (
            <ChartWithContext
              title="Folio Additions Trend"
              subtitle={
                folioAddLens === "share"
                  ? `${folioAdditionsShare.length} month${folioAdditionsShare.length === 1 ? "" : "s"} · % of folio base`
                  : `Net new folios per month · ${folioAdditionsTrend.length} month${folioAdditionsTrend.length === 1 ? "" : "s"} · lakh · ${foliosHover ?? ""}`
              }
              flowKind="net"
              denominatorCaption={
                folioAddLens === "share" ? undefined : folioAdditionsDenomCaption
              }
              denominatorTooltip="Monthly folio additions expressed as a percentage of the existing folio base. Normalises growth against the (large, growing) base so the trend is comparable across years."
              insights={folioAdditionsInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(folioAdditionsTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              <BarSeries
                data={folioAdditionsDisplay}
                name="Folio Additions"
                color="hsl(var(--chart-4))"
                valueFormat={folioAddLens === "share" ? "pct" : "lakh"}
                axisFormat={folioAddLens === "share" ? "pct" : "lakh"}
                labelFormat="month"
                trendline={
                  folioAddLens === "share"
                    ? undefined
                    : movingAverage(folioAdditionsTrend, 12)
                }
              />
            </ChartWithContext>
          )}

          {hasAnyFolioOrNfoTrend &&
            (nfoCountTrend.length > 0 || nfoFundsTrend.length > 0) && (
              <details className="group">
                <summary className="cursor-pointer list-none rounded-md border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm font-medium tracking-tight marker:hidden hover:bg-muted/30">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-foreground">
                      Show NFO launch + funds-mobilised trends
                    </span>
                    <span className="text-muted-foreground transition-transform group-open:rotate-90">
                      ›
                    </span>
                  </span>
                </summary>
                <section className="mt-3 grid gap-4 md:grid-cols-2">
                  {nfoCountTrend.length > 0 && (
                    <ChartWithContext
                      title="NFO Launches Trend"
                      subtitle={
                        nfoCountLens === "share"
                          ? `${nfoCountShare.length} month${nfoCountShare.length === 1 ? "" : "s"} · % of trailing 5Y monthly avg`
                          : `Open + close-ended schemes · ${nfoCountTrend.length} month${nfoCountTrend.length === 1 ? "" : "s"} · ${nfoCountSourceLine}`
                      }
                      flowKind="stock"
                      denominatorCaption={
                        nfoCountLens === "share" ? undefined : nfoCountDenomCaption
                      }
                      denominatorTooltip="Monthly NFO launches as a % of the trailing 5-year monthly average. Values above 100% = launch activity hotter than the 5Y norm (often coincides with bullish market regimes)."
                      insights={nfoCountInsights}
                      yoyBadge={(() => {
                        const v = latestYoyPct(nfoCountTrend, 12);
                        return v === null ? undefined : { label: "YoY", pct: v };
                      })()}
                      action={
                        <div className="flex flex-wrap items-center gap-2">
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
                        </div>
                      }
                    >
                      <BarSeries
                        data={nfoCountDisplay}
                        name="NFO Launches"
                        color="hsl(var(--chart-5))"
                        valueFormat={nfoCountLens === "share" ? "pct" : "count"}
                        axisFormat={nfoCountLens === "share" ? "pct" : "count"}
                        labelFormat="month"
                        trendline={
                          nfoCountLens === "share"
                            ? undefined
                            : movingAverage(nfoCountTrend, 12)
                        }
                        referenceValue={nfoCountLens === "share" ? 100 : undefined}
                        referenceLabel={nfoCountLens === "share" ? "5Y avg" : undefined}
                      />
                    </ChartWithContext>
                  )}
                  {nfoFundsTrend.length > 0 && (
                    <ChartWithContext
                      title="NFO Funds Mobilised Trend"
                      subtitle={
                        nfoFundsLens === "share"
                          ? `${nfoFundsShare.length} month${nfoFundsShare.length === 1 ? "" : "s"} · % of industry net inflow`
                          : `Gross funds raised during NFOs · ${nfoFundsTrend.length} month${nfoFundsTrend.length === 1 ? "" : "s"} · ₹ Cr · no redemptions netted · ${nfoFundsSourceLine}`
                      }
                      flowKind="gross"
                      denominatorCaption={
                        nfoFundsLens === "share" ? undefined : nfoFundsDenomCaption
                      }
                      denominatorTooltip="NFO gross funds mobilised as a % of industry net inflow that month — i.e., how much of the month's net flow was absorbed by new fund launches vs going to existing schemes."
                      insights={nfoFundsInsights}
                      yoyBadge={(() => {
                        const v = latestYoyPct(nfoFundsTrend, 12);
                        return v === null ? undefined : { label: "YoY", pct: v };
                      })()}
                      action={
                        <div className="flex flex-wrap items-center gap-2">
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
                        </div>
                      }
                    >
                      <BarSeries
                        data={nfoFundsDisplay}
                        name="NFO Funds"
                        color="hsl(var(--chart-2))"
                        valueFormat={nfoFundsLens === "share" ? "pct" : "cr"}
                        axisFormat={nfoFundsLens === "share" ? "pct" : "cr"}
                        labelFormat="month"
                        trendline={
                          nfoFundsLens === "share"
                            ? undefined
                            : movingAverage(nfoFundsTrend, 12)
                        }
                      />
                    </ChartWithContext>
                  )}
                </section>
              </details>
            )}
        </div>
      )}

      <SectionDivider
        eyebrow="Section 4"
        label="Active vs Passive"
        context="Where new equity money is going and whether the passive shift is accelerating."
      />

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
              subtitle={
                aeAaumLens === "share"
                  ? `${activeEquityAaumShare.length} month${activeEquityAaumShare.length === 1 ? "" : "s"} · % of total industry AAUM`
                  : `${activeEquityTrend.length} month${activeEquityTrend.length === 1 ? "" : "s"} · ₹ Cr · period-average`
              }
              flowKind="stock"
              denominatorCaption={
                aeAaumLens === "share" ? undefined : activeEquityAaumDenomCaption
              }
              denominatorTooltip="Latest active-equity AAUM as a % of total industry AAUM — separates absolute scale growth from share capture vs other segments."
              insights={activeEquityAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(activeEquityTrend, 12);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              {activeEquityTrend.length > 0 ? (
                <BarSeries
                  data={activeEquityAaumDisplay}
                  name="Active Equity AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat={aeAaumLens === "share" ? "pct" : "cr"}
                  axisFormat={aeAaumLens === "share" ? "pct" : "cr"}
                  labelFormat="month"
                  cyclePhaseBands={cyclePhaseBands}
                  trendline={
                    aeAaumLens === "share"
                      ? undefined
                      : movingAverage(activeEquityTrend, 12)
                  }
                  trendlineName="12M avg"
                  dynamicYDomain={aeAaumLens === "share"}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active-equity AAUM not yet ingested — appears once IIFL category fields land in the AMFI Monthly snapshot.
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
              <div className="flex flex-wrap items-center gap-2">
                <LensToggle
                  basePath="/monthly"
                  paramName="equityMixLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "% of equity AAUM" },
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
                valueFormat={equityBreakdownLens === "share" ? "pct" : "cr"}
                axisFormat={equityBreakdownLens === "share" ? "pct" : "cr"}
                bars={equityBreakdownSeries}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Equity breakdown (Active / ETF & Index / Arbitrage) not yet ingested for any month.
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
                    { value: "share", label: "% of total equity AUM" },
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
          </section>
        </div>
      )}

      <SectionDivider
        eyebrow="Section 5"
        label="Category rotation"
        context="Which categories are winning flow share and which categories investors trust through drawdowns."
      />

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
                    Category snapshot not yet ingested for this slug.
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
                          Category snapshot not yet ingested for this slug.
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

      <SectionDivider
        eyebrow="Section 6"
        label="Historical context"
        context="When did this happen before? Cycle replay, episode recovery latencies, and the regime narrative."
      />

      {episodeRecoveryData.length > 0 && (
        <EpisodeRecoveryCard rows={episodeRecoveryData} />
      )}

      {episodes.length > 0 && (
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
        Latest {trend.latestRatioPct.toFixed(1)}%
        {formatPercentile(trend.percentile) !== "—"
          ? ` · ${formatPercentile(trend.percentile)} of available history`
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
        Latest {trend.latestSharePct.toFixed(1)}%
        {formatPercentile(trend.percentile) !== "—"
          ? ` · ${formatPercentile(trend.percentile)} of available history`
          : ""}
        . Mean {trend.mean.toFixed(1)}%.
        <InfoTooltip label="Passive flow share = (Index Funds + Other ETFs net inflow) ÷ (Index Funds + Other ETFs + active-equity net inflow) × 100. Leading indicator of where the active-vs-passive AUM mix is heading — passive share of NEW money tends to move months before passive share of AUM. Gold ETFs are excluded. Months with non-positive denominator are skipped." />
      </p>
    </Card>
  );
}

