import { BarSeries } from "@/components/charts/BarSeries";
import type { DonutSlice } from "@/components/charts/Donut";
import { QuarterEndMixTable } from "@/components/data/QuarterEndMixTable";
import { AaumBridgeTable } from "@/components/data/AaumBridgeTable";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import { StackedArea } from "@/components/charts/StackedArea";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { ChartTypeToggle } from "@/components/ui/ChartTypeToggle";
import { BarsWithGrowth } from "@/components/charts/BarsWithGrowth";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import { KpiCard } from "@/components/ui/KpiCard";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { quarterlyMarketWrap } from "@/data/market-wrap-quarterly";
import { FiscalQuarterPicker } from "@/components/filters/FiscalQuarterPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  adaptiveAverageOverlay,
  chartInsights,
  latestYoyPct,
  yoyPctSeries,
} from "@/lib/chart-context";
import { indexSeriesToBase } from "@/lib/index-series";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  iiflActiveEquityQuarterlyTrendCard,
  latestCategoryProvenance,
} from "@/data/amfi-monthly-category";
import { formatKpiProvenanceTooltip } from "@/data/amfi-monthly";
import { cyclePhaseHistory, historicalEpisodes } from "@/data/market-indices";
import { CycleRibbon } from "@/components/ui/CycleRibbon";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { LensToggle } from "@/components/ui/LensToggle";
import {
  availableQuartersDesc,
  formatQuarterlyProvenanceLine,
  formatQuarterlyProvenanceTooltip,
  getQuarterlyKpiProvenance,
  getQuarterlyKpiValue,
  latestOpenEndedSchemeCount,
  latestQuarterlyFolioAdditions,
  liquidAumForQuarter,
  quarterlyCategoryAumProvenance,
  quarterlyActiveEquityLastMonthAaumTrend,
  quarterlyActiveEquityLastMonthShareTrend,
  quarterlyEquityLastMonthAaumBreakdown,
  quarterlyFlowsData,
  quarterlyFolioAdditionsTrend,
  quarterlyFlowsSectionRead,
  quarterlyFoliosSectionRead,
  quarterlyKpiContext,
  quarterlyOpenEndedSchemeCountTrend,
  quarterlySnapshotSectionRead,
  quarterlyTrend,
  categoryHhiPercentileRead,
  categoryHhiSeries,
  resolveSelectedQuarter,
  quarterlyAaumBridge,
  type AmfiQuarterlyKpiField,
} from "@/data/amfi-quarterly";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
  formatPercentilePill,
} from "@/lib/format";
import {
  amcLevelHhiPercentileRead,
  amcLevelHhiSeries,
  topAumMarketShareSeries,
} from "@/data/amc-peer-universe";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { TabIntroCard } from "@/components/ui/TabIntroCard";
import { resolveTab } from "@/lib/tabs";

const QUARTERLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "aaum-flows", label: "AAUM & Flows" },
  { id: "categories", label: "Categories" },
  { id: "retail-schemes", label: "Retail & Schemes" },
  { id: "active-passive", label: "Active vs Passive" },
  { id: "concentration", label: "Market Competition" },
] as const satisfies readonly DashboardTabDef[];
type QuarterlyTabId = (typeof QUARTERLY_TABS)[number]["id"];
const QUARTERLY_TAB_IDS = QUARTERLY_TABS.map(
  (t) => t.id,
) as readonly QuarterlyTabId[];

/** Sign-aware compact ₹ Cr formatter — mirrors the equivalent helper
 *  on /monthly so a negative net inflow KPI renders as "−₹32.4K Cr"
 *  rather than the unsigned "₹32.4K Cr". */
function formatSignedCompactCrSafe(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

export default async function QuarterlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ---- Lens toggles (parsed up-front) ----
  const quarterlyFlowsLens: "absolute" | "share" =
    sp.qFlowsLens === "share" ? "share" : "absolute";
  // Chart-type toggle for the one approved Bars + Growth callsite on
  // /quarterly. Default is "trend" — only "bars" is echoed into the URL.
  const quarterlyFlowsView: "trend" | "bars" =
    sp.quarterlyFlowsView === "bars" ? "bars" : "trend";
  const equityMixLens: "absolute" | "share" =
    sp.qEquityMixLens === "share" ? "share" : "absolute";
  // Per-card lens toggles for /quarterly. Each one switches a trend
  // chart between absolute and a card-specific share/ratio view.
  const qAaumLens: "absolute" | "share" =
    sp.qAaumLens === "share" ? "share" : "absolute";
  const qAeAaumLens: "absolute" | "share" =
    sp.qAeAaumLens === "share" ? "share" : "absolute";
  const qFoliosLens: "absolute" | "share" =
    sp.qFoliosLens === "share" ? "share" : "absolute";
  const qFolioAddLens: "absolute" | "share" =
    sp.qFolioAddLens === "share" ? "share" : "absolute";
  const qSchemesLens: "absolute" | "share" =
    sp.qSchemesLens === "share" ? "share" : "absolute";
  // Chart-type toggles. Each eligible bar-style time-series card on
  // the page owns its own `q<thing>View` URL param. Bars is the
  // default and is never echoed into the URL — only the "trend"
  // value rides along so the default page stays URL-clean.
  // Chart-style toggles (Bars vs Trend) were removed across the
  // dashboard — every chart now renders the trend visual directly.
  // Stale `?q...View=bars|trend` URLs are ignored silently.
  // Pass-through params for every LensToggle on this page. `tab` is
  // included so toggling a lens doesn't bounce the reader back to the
  // default tab.
  const preservedQueryParams: Record<string, string | undefined> = {
    tab: typeof sp.tab === "string" ? sp.tab : undefined,
    quarter: typeof sp.quarter === "string" ? sp.quarter : undefined,
    qFlowsLens:
      typeof sp.qFlowsLens === "string" ? sp.qFlowsLens : undefined,
    quarterlyFlowsView:
      typeof sp.quarterlyFlowsView === "string"
        ? sp.quarterlyFlowsView
        : undefined,
    qEquityMixLens:
      typeof sp.qEquityMixLens === "string" ? sp.qEquityMixLens : undefined,
    qAaumLens: typeof sp.qAaumLens === "string" ? sp.qAaumLens : undefined,
    qAeAaumLens:
      typeof sp.qAeAaumLens === "string" ? sp.qAeAaumLens : undefined,
    qFoliosLens:
      typeof sp.qFoliosLens === "string" ? sp.qFoliosLens : undefined,
    qFolioAddLens:
      typeof sp.qFolioAddLens === "string" ? sp.qFolioAddLens : undefined,
    qSchemesLens:
      typeof sp.qSchemesLens === "string" ? sp.qSchemesLens : undefined,
    qCategoryTrendsScale:
      typeof sp.qCategoryTrendsScale === "string"
        ? sp.qCategoryTrendsScale
        : undefined,
    // Chart-type `q<thing>View` toggles — only the non-default
    // "trend" value is preserved so other toggles never re-attach
    // `q<thing>View=bars` to the URL.
  };
  // Scale toggle for the Active-Equity Category Trends section. Mirrors
  // /monthly's categoryTrendsScale — see that file for rationale.
  const qCategoryTrendsScale: "levels" | "indexed" =
    sp.qCategoryTrendsScale === "indexed" ? "indexed" : "levels";

  const activeTab = resolveTab<QuarterlyTabId>(
    sp.tab,
    QUARTERLY_TAB_IDS,
    "snapshot",
  );

  // Share-mode transform helper for grouped-bar series.
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

  // Quarter selector — `?quarter=FY26-Q4` resolves to the matching
  // row when valid; otherwise we fall back to the latest available
  // quarter.
  const requestedQuarterRaw = sp.quarter;
  const requestedQuarter =
    typeof requestedQuarterRaw === "string" ? requestedQuarterRaw : undefined;
  const selectedRow = resolveSelectedQuarter(requestedQuarter);
  const availableQuarters = availableQuartersDesc();

  // ---- IIFL Active-Equity Category Trends ---------------------------
  // The single section on /quarterly allowed to source from AMFI
  // Monthly Reports — true QAAUM share requires period-average AAUM
  // across all months in the quarter, which the quarterly Report's
  // Average Net AUM column (last-month only) cannot provide.
  const iiflTrendCards = IIFL_ACTIVE_EQUITY_CATEGORIES.map((c) => {
    const { series, hasData } = iiflActiveEquityQuarterlyTrendCard(c.slug);
    const aumHover = formatKpiProvenanceTooltip(
      latestCategoryProvenance(c.slug, "categoryAaum")
    );
    return { ...c, series, hasData, aumHover };
  });
  const iiflTrendBySlug = new Map(iiflTrendCards.map((c) => [c.slug, c]));
  const iiflFeaturedCards = IIFL_TREND_FEATURED_SLUGS.map(
    (s) => iiflTrendBySlug.get(s)!
  );
  const iiflExpandedCards = IIFL_TREND_EXPANDED_SLUGS.map(
    (s) => iiflTrendBySlug.get(s)!
  );
  const hasAnyIiflTrend = iiflTrendCards.some((c) => c.hasData);
  const hasExpandedIiflTrend = iiflExpandedCards.some((c) => c.hasData);

  // ---- AMFI Quarterly Snapshot — KPI cards (selected quarter) -------
  // Mirrors /monthly's AMFI Monthly Snapshot card list:
  //   Total AAUM / Equity AUM / Debt AUM / Liquid AUM / Net Inflow.
  // Liquid AUM is read from the Liquid Fund category row (the
  // industry-row schema doesn't expose it as its own bucket — Liquid
  // is a sub-row of Sub Total - I). Funds Mobilized / Repurchase /
  // Folios / Hybrid / Other Schemes are intentionally NOT here:
  //   - Funds Mobilized + Repurchase belong in Quarterly Flows.
  //   - Folios belongs in Quarterly Folios & Scheme Count.
  //   - Hybrid + Other Schemes don't appear on /monthly's Snapshot
  //     and would clutter the headline grid; the AUM Mix donut
  //     handles those buckets.
  const liquidAum = selectedRow ? liquidAumForQuarter(selectedRow.quarter) : null;
  const liquidProvenance = selectedRow
    ? quarterlyCategoryAumProvenance("liquid", selectedRow.quarter)
    : null;

  type SnapshotCardSpec = {
    key: string;
    label: string;
    value: number | null;
    formatted: string;
    note: string;
    noteHover?: string;
    sparkline?: { label: string; value: number }[];
    sparklineColor?: string;
    yoyPct?: number | null;
    percentile?: number | null;
    ratio?: string;
  };
  const SNAPSHOT_KPI_CARDS: SnapshotCardSpec[] = [];
  const pushSnapshotCard = (
    field: AmfiQuarterlyKpiField,
    label: string,
    format: (v: number | null) => string,
    sparklineColor?: string,
    ratio?: string
  ) => {
    const value = getQuarterlyKpiValue(selectedRow, field);
    if (value === null) return;
    const provenance = getQuarterlyKpiProvenance(selectedRow, field);
    // Anchor YoY / percentile / sparkline to the user-selected quarter,
    // not the latest. Without this the picker only changes the headline
    // value while the pills stay pinned to the most recent quarter.
    const ctx = quarterlyKpiContext(field, 16, selectedRow?.quarter);
    SNAPSHOT_KPI_CARDS.push({
      key: field,
      label,
      value,
      formatted: format(value),
      note: formatQuarterlyProvenanceLine(provenance) ?? "",
      noteHover: formatQuarterlyProvenanceTooltip(provenance) ?? undefined,
      sparkline: ctx.sparkline,
      sparklineColor,
      yoyPct: ctx.yoyPct,
      percentile: ctx.percentile,
      ratio,
    });
  };
  // Per-AUM ratios anchored on the selected row's grandTotalAum.
  const ratioOfTotalAum = (numerator: number | null | undefined): string | undefined => {
    if (
      typeof numerator !== "number" ||
      typeof selectedRow?.grandTotalAum !== "number" ||
      selectedRow.grandTotalAum <= 0
    )
      return undefined;
    return `${((numerator / selectedRow.grandTotalAum) * 100).toFixed(1)}% of total AUM`;
  };
  pushSnapshotCard(
    "grandTotalLastMonthAaum",
    "Last-month AAUM",
    formatCompactCrSafe,
    "hsl(var(--chart-1))"
  );
  pushSnapshotCard(
    "equityAum",
    "Equity AUM",
    formatCompactCrSafe,
    "hsl(var(--chart-1))",
    ratioOfTotalAum(selectedRow?.equityAum)
  );
  pushSnapshotCard(
    "debtAum",
    "Debt AUM",
    formatCompactCrSafe,
    "hsl(var(--chart-2))",
    ratioOfTotalAum(selectedRow?.debtAum)
  );
  if (liquidAum !== null) {
    SNAPSHOT_KPI_CARDS.push({
      key: "liquidAum",
      label: "Liquid AUM",
      value: liquidAum,
      formatted: formatCompactCrSafe(liquidAum),
      note: formatQuarterlyProvenanceLine(liquidProvenance) ?? "",
      noteHover:
        formatQuarterlyProvenanceTooltip(liquidProvenance) ?? undefined,
      sparklineColor: "hsl(var(--chart-4))",
      ratio: ratioOfTotalAum(liquidAum),
    });
  }
  pushSnapshotCard(
    "grandTotalNetInflow",
    "Net Inflow",
    formatSignedCompactCrSafe,
    "hsl(var(--chart-3))",
    typeof selectedRow?.grandTotalNetInflow === "number" &&
      typeof selectedRow?.grandTotalAum === "number" &&
      selectedRow.grandTotalAum > 0
      ? `${((selectedRow.grandTotalNetInflow / selectedRow.grandTotalAum) * 100).toFixed(2)}% of opening AUM`
      : undefined
  );
  // Total AUM rounds out the row to a clean grid; comes last so the
  // AAUM-driven cards lead.
  pushSnapshotCard(
    "grandTotalAum",
    "Total AUM",
    formatCompactCrSafe,
    "hsl(var(--chart-1))"
  );

  const snapshotSubtitle = selectedRow
    ? `Industry-wide · ${selectedRow.quarterLabel} · Source: AMFI Quarterly Report`
    : "Upload AMFI Quarterly PDFs to manual-data/amfi-quarterly/pdfs/, then run npm run ingest:amfi-quarterly-pdf";

  const aaumBridge = quarterlyAaumBridge(10);

  // ---- AMFI Quarterly AUM Mix & Trend -------------------------------
  // Mirrors /monthly's AMFI AUM Mix & Trend exactly:
  //   Donut slices: Equity / Debt / Liquid / Other (residual).
  //   Same colors as /monthly:
  //     Equity = chart-1 (blue)
  //     Debt   = chart-2 (green)
  //     Liquid = chart-4 (purple)
  //     Other  = muted-foreground (grey)
  //   Other = grandTotalAum − (equity + debt + liquid). Only shown
  //   when ALL three sub-categories AND grandTotalAum are present and
  //   the residual is > 0 (otherwise rendering it would mis-state
  //   share). Hybrid / Other Schemes / Solution / close-ended schemes
  //   all sit inside the residual.
  const mixEquity = selectedRow?.equityAum ?? null;
  const mixDebt = selectedRow?.debtAum ?? null;
  const mixLiquid = liquidAum;
  const mixGrand = selectedRow?.grandTotalAum ?? null;
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
  let mixOther: number | null = null;
  if (
    typeof mixEquity === "number" &&
    typeof mixDebt === "number" &&
    typeof mixLiquid === "number" &&
    typeof mixGrand === "number"
  ) {
    const residual = mixGrand - mixEquity - mixDebt - mixLiquid;
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
  const mixSubtitle =
    mixHasData && mixOther !== null
      ? `Quarter-end AUM · share of Total AUM (residual = Other) · ${selectedRow?.quarterLabel ?? ""}`
      : mixHasData
        ? `Quarter-end AUM · partial breakdown · Other not computed · ${selectedRow?.quarterLabel ?? ""}`
        : "Quarter-end AUM not available for the selected quarter";

  // Last-month AAUM trend across the full AMFI quarterly history.
  const aaumTrendData = quarterlyTrend("grandTotalLastMonthAaum", 16);
  // Full quarterly history so the 4Q trailing average has real prior
  // data to draw on for the leftmost visible quarters.
  const aaumTrendFullHistory = quarterlyTrend("grandTotalLastMonthAaum", 10_000);
  const aaumTrendHasData = aaumTrendData.length > 0;
  const aaumTrendSubtitle = aaumTrendHasData
    ? `Last-month AAUM · ${aaumTrendData.length} quarter${aaumTrendData.length === 1 ? "" : "s"} · ₹ Cr`
    : "Last-month AAUM not available";

  // ---- Shared chart-context helpers (used by every insight call) ----
  // Convert YYYY-MM → fiscal-quarter display label ("4QFY26") used by
  // every quarterly chart series. Indian FY ends in March: Apr-Jun =
  // Q1, Jul-Sep = Q2, Oct-Dec = Q3, Jan-Mar = Q4. FY{YY} is the year
  // ending in March of that YY.
  const monthToFiscalQuarterLabel = (month: string): string | null => {
    const [yStr, mStr] = month.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
    let fyYear: number;
    let fyQ: number;
    if (m >= 1 && m <= 3) {
      fyYear = y;
      fyQ = 4;
    } else if (m >= 4 && m <= 6) {
      fyYear = y + 1;
      fyQ = 1;
    } else if (m >= 7 && m <= 9) {
      fyYear = y + 1;
      fyQ = 2;
    } else if (m >= 10 && m <= 12) {
      fyYear = y + 1;
      fyQ = 3;
    } else {
      return null;
    }
    return `${fyQ}QFY${String(fyYear).slice(-2)}`;
  };
  // Cycle phase by quarter — walking the monthly phase history in
  // order and overwriting per-quarter means the LAST month of each
  // quarter wins. That's the most representative read for a
  // quarter-end snapshot.
  const cyclePhaseByQuarterLabel: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const p of cyclePhaseHistory()) {
      const q = monthToFiscalQuarterLabel(p.month);
      if (q) m.set(q, p.phase);
    }
    return m;
  })();
  // Episode anchors translated to fiscal-quarter labels. Multiple
  // episode months can map to the same quarter (e.g. COVID 2020 spans
  // Feb-Mar 2020 → both in FY20-Q4) — dedupe so each quarter has one
  // anchor.
  const episodeAnchorsForQuarter: { label: string; title: string }[] =
    (() => {
      const seen = new Set<string>();
      const out: { label: string; title: string }[] = [];
      for (const e of historicalEpisodes()) {
        const q = monthToFiscalQuarterLabel(e.startMonth);
        if (!q || seen.has(q)) continue;
        seen.add(q);
        out.push({ label: q, title: e.title });
      }
      return out;
    })();

  // Last-month AAUM denominator: latest as % of trailing 4Q (1Y) average
  // — separates structural growth from quarter-to-quarter mean reversion.
  const lastMonthAaumDenomCaption = (() => {
    if (aaumTrendData.length < 4) return undefined;
    const trailing4 = aaumTrendData.slice(-4);
    const avg = trailing4.reduce((s, p) => s + p.value, 0) / trailing4.length;
    const latest = aaumTrendData[aaumTrendData.length - 1];
    if (avg <= 0) return undefined;
    const pct = (latest.value / avg) * 100;
    return `${pct.toFixed(1)}% of trailing 4Q avg · latest ${latest.label}`;
  })();
  const lastMonthAaumInsights = chartInsights(aaumTrendData, {
    metricName: "last-month AAUM",
    unitSuffix: "₹ Cr",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    yoyLag: 4,
  });
  // "Share" view: each quarter indexed as a % of its own trailing
  // 4Q (1Y) moving average. Drops the first 3 points where no
  // trailing average is available.
  const aaumTrendShare = aaumTrendData
    .map((p, i, arr) => {
      if (i + 1 < 4) return null;
      const slice = arr.slice(i + 1 - 4, i + 1);
      const avg = slice.reduce((s, q) => s + q.value, 0) / 4;
      if (avg <= 0) return null;
      return { label: p.label, value: (p.value / avg) * 100 };
    })
    .filter((p): p is { label: string; value: number } => p !== null);
  const aaumDisplayData = qAaumLens === "share" ? aaumTrendShare : aaumTrendData;

  // ---- Quarterly Flows ----------------------------------------------
  // Mirrors /monthly's "Equity / Debt / Liquid Monthly Net Flows"
  // grouped bar chart exactly. One full-width Card; same colors as
  // /monthly (Equity = chart-1 blue / Debt = chart-2 green /
  // Liquid = chart-4 purple). Liquid is shown separately for chart
  // parity with /monthly even though debtNetInflow already includes
  // it on the AMFI classification.
  const flowsData = quarterlyFlowsData(16);
  const flowsDataDisplay =
    quarterlyFlowsLens === "share"
      ? flowsData.map((r) =>
          toShareRow(r as Record<string, number | null | string>, [
            "equity",
            "debt",
            "liquid",
          ])
        )
      : flowsData;
  const flowsHasData = flowsData.some(
    (r) => r.equity !== null || r.debt !== null || r.liquid !== null
  );

  // ---- Quarterly Active Equity & Equity Mix -------------------------
  // Mirrors /monthly's Active Equity & Equity Mix section. All three
  // cards use LAST-MONTH AAUM (not true QAAUM) — labelled explicitly
  // so the methodology is unambiguous.
  const aeAaumTrend = quarterlyActiveEquityLastMonthAaumTrend(16);
  const aeAaumFullHistory = quarterlyActiveEquityLastMonthAaumTrend(10_000);
  const aeShareTrend = quarterlyActiveEquityLastMonthShareTrend(16);
  const aeBreakdown = quarterlyEquityLastMonthAaumBreakdown(16);
  const aeBreakdownDisplay =
    equityMixLens === "share"
      ? aeBreakdown.map((r) =>
          toShareRow(r as Record<string, number | null | string>, [
            "activeEquity",
            "etfIndex",
            "arbitrage",
          ])
        )
      : aeBreakdown;
  const aeBreakdownHasData = aeBreakdown.some(
    (r) =>
      r.activeEquity !== null || r.etfIndex !== null || r.arbitrage !== null
  );
  const hasAnyEquityMix =
    aeAaumTrend.length > 0 ||
    aeShareTrend.length > 0 ||
    aeBreakdownHasData;
  // Latest active/etf/arbitrage mix — proportion-first read for the
  // breakdown subtitle.
  const latestQuarterlyEquityMix = (() => {
    for (let i = aeBreakdown.length - 1; i >= 0; i--) {
      const r = aeBreakdown[i];
      const a = r.activeEquity;
      const e = r.etfIndex;
      const x = r.arbitrage;
      if (typeof a === "number" && typeof e === "number" && typeof x === "number") {
        const total = a + e + x;
        if (total > 0) {
          return {
            activePct: (a / total) * 100,
            etfPct: (e / total) * 100,
            arbPct: (x / total) * 100,
          };
        }
      }
    }
    return null;
  })();
  const aeBreakdownSubtitle = latestQuarterlyEquityMix
    ? `${aeBreakdown.length} quarter${aeBreakdown.length === 1 ? "" : "s"} · ₹ Cr · latest mix ${latestQuarterlyEquityMix.activePct.toFixed(1)}% Active / ${latestQuarterlyEquityMix.etfPct.toFixed(1)}% ETF & Index / ${latestQuarterlyEquityMix.arbPct.toFixed(1)}% Arbitrage`
    : `${aeBreakdown.length} quarter${aeBreakdown.length === 1 ? "" : "s"} · ₹ Cr · grouped bars · last-month AAUM`;

  // Quarterly Flows denominator: latest quarter's per-segment share
  // of total flow magnitude — mirrors /monthly's headline read.
  const quarterlyFlowsDenomCaption = (() => {
    if (flowsData.length === 0) return undefined;
    const latest = flowsData[flowsData.length - 1];
    const e = typeof latest.equity === "number" ? latest.equity : 0;
    const d = typeof latest.debt === "number" ? latest.debt : 0;
    const l = typeof latest.liquid === "number" ? latest.liquid : 0;
    const total = Math.abs(e) + Math.abs(d) + Math.abs(l);
    if (total === 0) return undefined;
    return `Equity = ${((Math.abs(e) / total) * 100).toFixed(0)}% / Debt = ${((Math.abs(d) / total) * 100).toFixed(0)}% / Liquid = ${((Math.abs(l) / total) * 100).toFixed(0)}% of latest flow magnitude · ${latest.quarterLabel}`;
  })();
  const equityFlowFromQuarterly = flowsData
    .filter((r) => typeof r.equity === "number")
    .map((r) => ({ label: r.quarterLabel, value: r.equity as number }));
  // Full quarterly equity-flow history + YoY (lag=4) for the optional
  // Bars + Growth view on this card.
  const quarterlyFlowsFullHistory = quarterlyFlowsData(10_000);
  const quarterlyEquityFullSeries = quarterlyFlowsFullHistory
    .filter((r) => typeof r.equity === "number")
    .map((r) => ({ label: r.quarterLabel, value: r.equity as number }));
  const quarterlyEquityYoyByLabel = new Map(
    yoyPctSeries(quarterlyEquityFullSeries, 4).map((p) => [p.label, p.value])
  );
  const quarterlyFlowsBarsData = equityFlowFromQuarterly.map((p) => ({
    label: p.label,
    value: p.value,
    growthPct: quarterlyEquityYoyByLabel.get(p.label) ?? null,
  }));
  const quarterlyFlowsInsights = chartInsights(equityFlowFromQuarterly, {
    metricName: "equity net inflow",
    unitSuffix: "₹ Cr",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    episodeAnchors: episodeAnchorsForQuarter,
    yoyLag: 4,
  });
  // Series specs shared by the bars and trend views of multi-series
  // chart cards on /quarterly. `BarSpec` and `LineSpec` are both
  // `{ key, name, color }` so the same array works as `bars=` on
  // GroupedBars and `lines=` on MultiLine.
  const qFlowsSeries = [
    { key: "equity", name: "Equity", color: "hsl(var(--chart-1))" },
    { key: "debt", name: "Debt", color: "hsl(var(--chart-2))" },
    { key: "liquid", name: "Liquid", color: "hsl(var(--chart-4))" },
  ];
  const qEquityMixSeries = [
    { key: "activeEquity", name: "Active Equity", color: "hsl(var(--chart-1))" },
    { key: "etfIndex", name: "ETF & Index", color: "hsl(var(--chart-5))" },
    { key: "arbitrage", name: "Arbitrage", color: "hsl(var(--chart-2))" },
  ];

  // Active Equity Last-month AAUM denominator: latest as % of total
  // industry last-month AAUM — same framing as /monthly but on the
  // quarterly basis.
  const aeAaumDenomCaption = (() => {
    if (aeAaumTrend.length === 0) return undefined;
    const latest = aeAaumTrend[aeAaumTrend.length - 1];
    // Pull the matching quarter's grandTotalLastMonthAaum from
    // aaumTrendData computed earlier in the page.
    const totalRow = aaumTrendData.find((p) => p.label === latest.label);
    if (!totalRow || totalRow.value <= 0) return undefined;
    const pct = (latest.value / totalRow.value) * 100;
    return `${pct.toFixed(1)}% of total industry last-month AAUM · latest ${latest.label}`;
  })();
  const aeAaumInsights = chartInsights(aeAaumTrend, {
    metricName: "active-equity AAUM",
    unitSuffix: "₹ Cr",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    yoyLag: 4,
  });
  // Active Equity AAUM share: % of total industry last-month AAUM.
  const aeAaumShare = aeAaumTrend
    .map((p) => {
      const totalRow = aaumTrendData.find((q) => q.label === p.label);
      if (!totalRow || totalRow.value <= 0) return null;
      return { label: p.label, value: (p.value / totalRow.value) * 100 };
    })
    .filter((p): p is { label: string; value: number } => p !== null);
  const aeAaumDisplay = qAeAaumLens === "share" ? aeAaumShare : aeAaumTrend;

  // Equity Breakdown denominator: ETF & Index share = passive
  // penetration — same framing as /monthly so the quarterly read
  // is comparable.
  const aeBreakdownDenomCaption = latestQuarterlyEquityMix
    ? `ETF & Index = ${latestQuarterlyEquityMix.etfPct.toFixed(1)}% of equity AUM · latest available quarter`
    : undefined;
  const activeEquityFromQBreakdown = aeBreakdown
    .filter((r) => typeof r.activeEquity === "number")
    .map((r) => ({
      label: r.quarterLabel,
      value: r.activeEquity as number,
    }));
  const aeBreakdownInsights = chartInsights(activeEquityFromQBreakdown, {
    metricName: "active-equity AAUM",
    unitSuffix: "₹ Cr",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    yoyLag: 4,
  });

  // ---- Folios & Scheme Count ----------------------------------------
  const totalFolios = selectedRow?.grandTotalFolios ?? null;
  const folioAdditions = latestQuarterlyFolioAdditions();
  const foliosCtx = quarterlyKpiContext("grandTotalFolios", 16);
  const openEndedSchemes = latestOpenEndedSchemeCount();
  const foliosTrend = quarterlyTrend("grandTotalFolios", 16);
  const foliosFullHistory = quarterlyTrend("grandTotalFolios", 10_000);
  const folioAdditionsTrend = quarterlyFolioAdditionsTrend(16);
  const folioAdditionsFullHistory = quarterlyFolioAdditionsTrend(10_000);
  const schemesTrend = quarterlyOpenEndedSchemeCountTrend(16);
  const schemesFullHistory = quarterlyOpenEndedSchemeCountTrend(10_000);
  const foliosHover = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "grandTotalFolios")
  );
  const hasAnyFolioKpi =
    totalFolios !== null || folioAdditions !== null || openEndedSchemes !== null;
  const hasAnyFolioTrend =
    foliosTrend.length > 0 ||
    folioAdditionsTrend.length > 0 ||
    schemesTrend.length > 0;

  // Folios denominator: latest as % of trailing 4Q (1Y) average — the
  // folio base grows monotonically, so the read separates fresh
  // investor onboarding from a flat shelf.
  const foliosTrendDenomCaption = (() => {
    if (foliosTrend.length < 4) return undefined;
    const trailing4 = foliosTrend.slice(-4);
    const avg = trailing4.reduce((s, p) => s + p.value, 0) / trailing4.length;
    const latest = foliosTrend[foliosTrend.length - 1];
    if (avg <= 0) return undefined;
    const pct = (latest.value / avg) * 100;
    return `${pct.toFixed(1)}% of trailing 4Q avg · latest ${latest.label}`;
  })();
  const foliosTrendInsights = chartInsights(foliosTrend, {
    metricName: "folios",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    yoyLag: 4,
  });

  // Folio additions denominator: latest quarterly net adds as bps of
  // the existing folio base — normalises growth against the (large)
  // base so the trend is comparable across years. Both values are raw
  // counts; ratio is additions ÷ base, expressed as a percentage.
  const folioAdditionsDenomCaption = (() => {
    if (folioAdditionsTrend.length === 0) return undefined;
    const latest = folioAdditionsTrend[folioAdditionsTrend.length - 1];
    const base = totalFolios;
    if (typeof base !== "number" || base <= 0) return undefined;
    const pct = (latest.value / base) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% of folio base · latest ${latest.label}`;
  })();
  const folioAdditionsInsights = chartInsights(folioAdditionsTrend, {
    metricName: "folio additions",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    episodeAnchors: episodeAnchorsForQuarter,
    yoyLag: 4,
  });

  // Scheme count denominator: latest as % of trailing 4Q avg — keeps
  // an eye on shelf expansion (NFOs net of mergers/closures) without
  // the chart looking flat at this slow-moving scale.
  const schemesTrendDenomCaption = (() => {
    if (schemesTrend.length < 4) return undefined;
    const trailing4 = schemesTrend.slice(-4);
    const avg = trailing4.reduce((s, p) => s + p.value, 0) / trailing4.length;
    const latest = schemesTrend[schemesTrend.length - 1];
    if (avg <= 0) return undefined;
    const pct = (latest.value / avg) * 100;
    return `${pct.toFixed(1)}% of trailing 4Q avg · latest ${latest.label}`;
  })();
  const schemesTrendInsights = chartInsights(schemesTrend, {
    metricName: "open-ended scheme count",
    cyclePhaseByLabel: cyclePhaseByQuarterLabel,
    yoyLag: 4,
  });

  // ---- "Share" series for each folio + scheme card ----------------
  // Folios indexed to trailing 4Q (1Y) average — turns the slow
  // mostly-monotonic line into a meaningful "above/below trend"
  // read.
  const foliosTrendShare = foliosTrend
    .map((p, i, arr) => {
      if (i + 1 < 4) return null;
      const slice = arr.slice(i + 1 - 4, i + 1);
      const avg = slice.reduce((s, q) => s + q.value, 0) / 4;
      if (avg <= 0) return null;
      return { label: p.label, value: (p.value / avg) * 100 };
    })
    .filter((p): p is { label: string; value: number } => p !== null);
  const foliosDisplay =
    qFoliosLens === "share" ? foliosTrendShare : foliosTrend;

  // Folio additions as % of the folio base. The base value comes
  // from the matching `quarterlyTrend("grandTotalFolios", 16)` row.
  // Both `value` (additions) and the folio base are stored as raw
  // counts in the snapshot, so the ratio is additions ÷ base × 100.
  const folioAdditionsShare = (() => {
    const baseByQuarter = new Map<string, number>();
    for (const p of foliosTrend) baseByQuarter.set(p.label, p.value);
    return folioAdditionsTrend.flatMap((p) => {
      const base = baseByQuarter.get(p.label);
      if (typeof base !== "number" || base <= 0) return [];
      const pct = (p.value / base) * 100;
      return [{ label: p.label, value: pct }];
    });
  })();
  const folioAdditionsDisplay =
    qFolioAddLens === "share" ? folioAdditionsShare : folioAdditionsTrend;

  // Open-ended scheme count: % of trailing 4Q average.
  const schemesTrendShare = schemesTrend
    .map((p, i, arr) => {
      if (i + 1 < 4) return null;
      const slice = arr.slice(i + 1 - 4, i + 1);
      const avg = slice.reduce((s, q) => s + q.value, 0) / 4;
      if (avg <= 0) return null;
      return { label: p.label, value: (p.value / avg) * 100 };
    })
    .filter((p): p is { label: string; value: number } => p !== null);
  const schemesDisplay =
    qSchemesLens === "share" ? schemesTrendShare : schemesTrend;

  // AUM Market Share — live Top 7 + Others from AMFI Fundwise AAUM.
  // Same helper as /monthly so the two pages render an identical view.
  const aumMarketShare = topAumMarketShareSeries(7, 8);
  const aumMarketShareCoverage = aumMarketShare.coverage;

  // Cycle regime + section reads.
  const cyclePhasePoints = cyclePhaseHistory();
  // Three-sentence "today's read" surfaced at the top of the page.
  const marketWrapData = quarterlyMarketWrap();
  const quarterlySnapshotRead = quarterlySnapshotSectionRead();
  const quarterlyFlowsRead = quarterlyFlowsSectionRead();
  const quarterlyFoliosRead = quarterlyFoliosSectionRead();

  // Concentration tracker — HHI of AMC-level + category-level AUM.
  const amcHhi = amcLevelHhiSeries(8);
  const catHhi = categoryHhiSeries(16);
  // HHI percentile reads vs the trailing 5 years of history, with
  // change vs the anchor quarter exactly 20 quarters back (= 5Y).
  const amcHhiPercentile = amcLevelHhiPercentileRead(20, 20);
  const catHhiPercentile = categoryHhiPercentileRead(20, 20);
  const hhiHasData = amcHhi.length > 0 || catHhi.length > 0;
  const concentrationLabels = Array.from(
    new Set([
      ...amcHhi.map((p) => p.quarterLabel),
      ...catHhi.map((p) => p.quarterLabel),
    ])
  );
  const amcHhiByLabel = new Map(amcHhi.map((p) => [p.quarterLabel, p.hhi]));
  const catHhiByLabel = new Map(catHhi.map((p) => [p.quarterLabel, p.hhi]));
  const hhiData = concentrationLabels.map((label) => ({
    label,
    amcHhi: amcHhiByLabel.get(label) ?? null,
    categoryHhi: catHhiByLabel.get(label) ?? null,
  }));
  const latestAmcHhi = amcHhi[amcHhi.length - 1] ?? null;
  const latestCatHhi = catHhi[catHhi.length - 1] ?? null;

  // ---- Quarterly Signal Summary --------------------------------------
  // Five buy-side tiles synthesised from data already loaded above.
  // Each tile answers what changed · why it matters · what to watch.
  const aaumLatest =
    aaumTrendData.length > 0 ? aaumTrendData[aaumTrendData.length - 1] : null;
  const aaumTrailing4Avg = (() => {
    if (aaumTrendData.length < 4) return null;
    const tail = aaumTrendData.slice(-4);
    return tail.reduce((s, p) => s + p.value, 0) / tail.length;
  })();
  const aaumDeltaVs4Q =
    aaumLatest && aaumTrailing4Avg && aaumTrailing4Avg > 0
      ? ((aaumLatest.value - aaumTrailing4Avg) / aaumTrailing4Avg) * 100
      : null;

  const latestFlowsRow =
    flowsData.length > 0 ? flowsData[flowsData.length - 1] : null;
  const flowQualityPct = (() => {
    if (!latestFlowsRow) return null;
    const eq =
      typeof latestFlowsRow.equity === "number" ? latestFlowsRow.equity : null;
    const debt =
      typeof latestFlowsRow.debt === "number" ? latestFlowsRow.debt : 0;
    const liquid =
      typeof latestFlowsRow.liquid === "number" ? latestFlowsRow.liquid : 0;
    if (eq === null) return null;
    const totalMagnitude = Math.abs(eq) + Math.abs(debt) + Math.abs(liquid);
    if (totalMagnitude === 0) return null;
    return (eq / totalMagnitude) * 100;
  })();

  const passiveShareLatest = (() => {
    if (aeBreakdown.length === 0) return null;
    const latest = aeBreakdown[aeBreakdown.length - 1];
    const active =
      typeof latest.activeEquity === "number" ? latest.activeEquity : null;
    const etf =
      typeof latest.etfIndex === "number" ? latest.etfIndex : null;
    const arb =
      typeof latest.arbitrage === "number" ? latest.arbitrage : 0;
    if (active === null || etf === null) return null;
    const total = active + etf + arb;
    if (total <= 0) return null;
    return (etf / total) * 100;
  })();

  const folioAddLatest = folioAdditionsTrend[folioAdditionsTrend.length - 1] ?? null;
  const folioAddPriorQ =
    folioAdditionsTrend.length >= 2
      ? folioAdditionsTrend[folioAdditionsTrend.length - 2]
      : null;
  const folioAddQoqPct =
    folioAddLatest && folioAddPriorQ && folioAddPriorQ.value !== 0
      ? ((folioAddLatest.value - folioAddPriorQ.value) /
          Math.abs(folioAddPriorQ.value)) *
        100
      : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Quarterly Operating KPIs"
        subtitle={
          selectedRow
            ? `Industry-wide · ${selectedRow.quarterLabel}`
            : "Industry-wide"
        }
      />

      <DashboardTabs
        basePath="/quarterly"
        tabs={QUARTERLY_TABS}
        activeId={activeTab}
        searchParams={sp}
      />

      <MarketWrapCard wrap={marketWrapData} />

      {activeTab === "snapshot" && (
        <TabIntroCard
          headline="What's the state of the industry this quarter?"
          summary="Five quarterly signals — AAUM trend, flow quality, active vs passive, retail health, and concentration — synthesised from the latest live quarter."
          watchNext="Whether the signals reinforce each other (broad recovery / broad drawdown) or pull in opposite directions (rotation underway)."
        />
      )}

      {activeTab === "snapshot" && (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Quarterly Signal Summary
          </h2>
          <p className="text-xs text-muted-foreground">
            What changed · why it matters · what to watch — synthesised
            from the latest live quarter.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <QSignalTile
            label="Quarterly AAUM trend"
            pill={
              aaumDeltaVs4Q === null
                ? "—"
                : `${aaumDeltaVs4Q >= 0 ? "+" : ""}${aaumDeltaVs4Q.toFixed(1)}%`
            }
            pillTone={
              aaumDeltaVs4Q === null
                ? "neutral"
                : aaumDeltaVs4Q > 0
                ? "positive"
                : "negative"
            }
            valueLine={
              aaumLatest
                ? `Latest ${aaumLatest.label} · ${formatCompactCrSafe(aaumLatest.value)}`
                : null
            }
            read={(() => {
              if (aaumDeltaVs4Q === null)
                return "AAUM trend unavailable — need at least 4 quarters.";
              if (aaumDeltaVs4Q >= 5)
                return "Quarterly AAUM is running well ahead of its trailing-4Q average — sector earnings should be expanding. Watch whether the gap holds or fades next quarter.";
              if (aaumDeltaVs4Q >= 0)
                return "AAUM is at or just above trailing-4Q average — sector tone steady. Watch flow quality + market drawdown for early signs of inflection.";
              return "AAUM is below trailing-4Q average — sector under pressure. Watch which AMCs defend AAUM (active flow + market beta) vs which contract.";
            })()}
          />
          <QSignalTile
            label="Flow Quality"
            pill={
              flowQualityPct === null
                ? "—"
                : `${flowQualityPct >= 0 ? "+" : ""}${flowQualityPct.toFixed(0)}% equity`
            }
            pillTone={
              flowQualityPct === null
                ? "neutral"
                : flowQualityPct >= 40
                ? "positive"
                : flowQualityPct <= 0
                ? "negative"
                : "neutral"
            }
            valueLine={
              latestFlowsRow
                ? `Equity share of ${latestFlowsRow.quarterLabel ?? latestFlowsRow.quarter} flow magnitude`
                : null
            }
            read={(() => {
              if (flowQualityPct === null)
                return "Quarterly flow split unavailable for the latest period.";
              if (flowQualityPct >= 50)
                return "Equity dominates the quarter's flow magnitude — risk-on mix supports AMC revenue yield. Watch for SIP vs lumpsum split persistence.";
              if (flowQualityPct >= 0)
                return "Mixed flow quality — equity contributes but debt/liquid still meaningful. Watch the equity share trend across the next 2-3 quarters.";
              return "Equity flow is net-negative this quarter — defensive rotation underway. Watch whether redemptions are concentrated in a few categories or industry-wide.";
            })()}
          />
          <QSignalTile
            label="Active vs Passive"
            pill={
              passiveShareLatest === null
                ? "—"
                : `${passiveShareLatest.toFixed(1)}% passive`
            }
            pillTone={
              passiveShareLatest === null
                ? "neutral"
                : passiveShareLatest >= 25
                ? "negative"
                : "neutral"
            }
            valueLine={
              aeBreakdown.length > 0
                ? `Latest ${aeBreakdown[aeBreakdown.length - 1].quarterLabel ?? aeBreakdown[aeBreakdown.length - 1].quarter} · ETF & Index share of equity AAUM`
                : null
            }
            read={(() => {
              if (passiveShareLatest === null)
                return "Active / Passive split unavailable for the latest quarter.";
              if (passiveShareLatest >= 30)
                return "Passive share is structurally elevated — revenue-yield headwind for active-heavy franchises. Watch which active AMCs are still defending margin via flow share.";
              if (passiveShareLatest >= 15)
                return "Passive share is growing but active still dominates equity AUM. Watch the QoQ delta — accelerating passive is the slow-moving risk to traditional MF yields.";
              return "Active-heavy era persists — favourable for traditional MF revenue yield. Watch whether ETF share starts compounding faster than active AAUM growth.";
            })()}
          />
          <QSignalTile
            label="Retail Health"
            pill={
              folioAddQoqPct === null
                ? folioAddLatest
                  ? `${folioAddLatest.value >= 0 ? "+" : ""}${formatLakhSafe(folioAddLatest.value)}`
                  : "—"
                : `${folioAddQoqPct >= 0 ? "+" : ""}${folioAddQoqPct.toFixed(0)}% QoQ`
            }
            pillTone={
              folioAddQoqPct === null
                ? "neutral"
                : folioAddQoqPct >= 0
                ? "positive"
                : "negative"
            }
            valueLine={
              folioAddLatest
                ? `Quarterly folio adds · ${folioAddLatest.label} · ${formatLakhSafe(folioAddLatest.value)}`
                : null
            }
            read={(() => {
              if (folioAddLatest === null)
                return "Quarterly folio additions unavailable.";
              if (folioAddQoqPct !== null && folioAddQoqPct >= 5)
                return "Retail participation accelerating — folio adds running ahead of prior quarter. Watch whether the cohort is sticky (SIP) or transient (lumpsum).";
              if (folioAddQoqPct !== null && folioAddQoqPct >= -5)
                return "Retail participation steady. Watch SIP stickiness percentile + scheme count — both signal whether engagement is structural or cyclical.";
              return "Folio adds slowing QoQ — early sign of retail fatigue or rotation. Watch whether SIP cancellations rise alongside.";
            })()}
          />
          <QSignalTile
            label="Market Concentration"
            pill={
              amcHhiPercentile
                ? formatPercentilePill(amcHhiPercentile.percentile)
                : "—"
            }
            pillTone={
              amcHhiPercentile === null
                ? "neutral"
                : amcHhiPercentile.percentile >= 80
                ? "negative"
                : amcHhiPercentile.percentile <= 20
                ? "positive"
                : "neutral"
            }
            valueLine={
              amcHhiPercentile
                ? `AMC-level HHI ${amcHhiPercentile.latestHhi.toFixed(0)} · ${amcHhiPercentile.changeVsAnchor !== null ? `${amcHhiPercentile.changeVsAnchor >= 0 ? "+" : ""}${amcHhiPercentile.changeVsAnchor.toFixed(0)} vs ${amcHhiPercentile.anchorQuarterLabel}` : "—"}`
                : null
            }
            read={(() => {
              if (!amcHhiPercentile)
                return "HHI percentile unavailable — need at least a 20-quarter window.";
              if (amcHhiPercentile.percentile >= 80)
                return "Industry concentration sits in the top 20% of recent history — top AMCs are pulling away. Watch challenger AMCs for share-gain inflection.";
              if (amcHhiPercentile.percentile <= 20)
                return "Industry is unusually fragmented vs recent history — challengers competing harder. Watch which AMCs are gaining and whether the trend reverses.";
              return "Concentration is in line with the trailing-5Y norm. Watch HHI direction (rising = oligopolisation, falling = challenger window).";
            })()}
          />
        </div>
      </section>
      )}

      {activeTab === "snapshot" && cyclePhasePoints.length > 0 && (
        <Card
          title="Cycle Regime"
          subtitle={`Per-month cycle phase since ${cyclePhasePoints[0].month} · derived from active-equity flow z-score + Nifty 500 drawdown`}
        >
          <CycleRibbon points={cyclePhasePoints} lastN={84} />
        </Card>
      )}

      {activeTab === "aaum-flows" && (
        <TabIntroCard
          headline="Where did the industry's quarterly AAUM and flow go?"
          summary="Headline AAUM, AUM mix donut, last-month AAUM trend, quarterly net flows by category, and category-level QAAUM/flow share. The full quarterly flow picture in one tab."
          watchNext="Whether equity continues to dominate flow magnitude as AAUM expands."
        />
      )}

      {activeTab === "aaum-flows" && (
      <Card
        title="AMFI Quarterly Snapshot"
        subtitle={
          quarterlySnapshotRead && selectedRow
            ? `${snapshotSubtitle} · ${quarterlySnapshotRead}`
            : snapshotSubtitle
        }
        action={
          <div className="flex flex-col items-end gap-2">
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                selectedRow
                  ? "border-positive/40 bg-positive/10 text-positive"
                  : "border-border text-muted-foreground"
              )}
            >
              {selectedRow ? "Live" : "Not connected"}
            </span>
            {selectedRow && availableQuarters.length > 0 && (
              <FiscalQuarterPicker
                availableQuarters={availableQuarters}
                selectedQuarterId={selectedRow.quarter}
              />
            )}
          </div>
        }
      >
        {SNAPSHOT_KPI_CARDS.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {SNAPSHOT_KPI_CARDS.map((c) => (
              <KpiCard
                key={c.key}
                label={c.label}
                value={c.formatted}
                note={c.note}
                noteHover={c.noteHover}
                sparkline={c.sparkline}
                sparklineColor={c.sparklineColor}
                yoyPct={c.yoyPct ?? undefined}
                percentile={c.percentile ?? undefined}
                ratio={c.ratio}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No AMFI quarterly PDF data ingested yet.
          </div>
        )}
      </Card>
      )}

      {activeTab === "aaum-flows" && selectedRow && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              AMFI Quarterly AUM Mix &amp; Trend
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Quarterly Report
            </p>
          </div>
          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Quarter-end AUM Mix" subtitle={mixSubtitle}>
              {mixHasData ? (
                <QuarterEndMixTable
                  slices={mixSlices}
                  quarterLabel={selectedRow.quarterLabel}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  AUM mix not published for the selected quarter — pick a more recent quarter or upload the AMFI Quarterly PDF.
                </div>
              )}
            </Card>
            <ChartWithContext
              title="Last-month AAUM Trend"
              subtitle="Industry AUM at each quarter's last month. Tracks the headline asset base."
              flowKind="stock"
              denominatorCaption={(() => {
                if (qAaumLens === "share") {
                  return `${aaumTrendShare.length} quarter${aaumTrendShare.length === 1 ? "" : "s"} · indexed to 4Q avg (100 = on-trend)`;
                }
                return lastMonthAaumDenomCaption
                  ? `${aaumTrendSubtitle} · ${lastMonthAaumDenomCaption}`
                  : `${aaumTrendSubtitle} · last-month value (not a true quarterly average)`;
              })()}
              denominatorTooltip="Latest last-month AAUM as a % of the trailing 4-quarter average — separates structural growth from quarter-to-quarter mean-reversion."
              insights={lastMonthAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(aaumTrendData, 4);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/quarterly"
                  paramName="qAaumLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "vs 4Q avg" },
                  ]}
                  active={qAaumLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {aaumTrendHasData ? (() => {
                const ov = adaptiveAverageOverlay(aaumTrendFullHistory, aaumDisplayData, 4);
                const useOverlay = qAaumLens !== "share";
                const showShareRef = qAaumLens === "share";
                return (
                  <BarSeries
                    data={aaumDisplayData}
                    name="Last-month AAUM"
                    color="hsl(var(--chart-1))"
                    valueFormat={qAaumLens === "share" ? "pct" : "cr"}
                    axisFormat={qAaumLens === "share" ? "pct" : "cr"}
                    labelFormat="none"
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
                        ? "4-quarter avg"
                        : useOverlay && ov.kind === "visible-mean"
                          ? ov.label
                          : undefined
                    }
                  />
                );
              })() : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Last-month AAUM not yet published — appears after the next AMFI Quarterly Report is ingested.
                </div>
              )}
            </ChartWithContext>
          </section>
        </div>
      )}

      {activeTab === "aaum-flows" && aaumBridge.length > 0 && (
        <Card title="AUM Change: Flows vs Residual">
          <AaumBridgeTable rows={aaumBridge} />
        </Card>
      )}

      {activeTab === "aaum-flows" && flowsHasData && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Flows
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Quarterly Report
              {quarterlyFlowsRead ? ` · ${quarterlyFlowsRead}` : ""}
            </p>
          </div>
          <ChartWithContext
            title="Equity / Debt / Liquid Quarterly Net Flows"
            subtitle="Where industry money went each quarter, split by category."
            flowKind="net"
            denominatorCaption={(() => {
              const span = `${flowsData.length} quarter${flowsData.length === 1 ? "" : "s"}`;
              if (quarterlyFlowsView === "bars") {
                return `${span} · Equity flow only · ₹ Cr · YoY growth overlaid`;
              }
              if (quarterlyFlowsLens === "share") {
                return `${span} · % of quarterly flow magnitude (signs preserved)`;
              }
              return quarterlyFlowsDenomCaption
                ? `${span} · ₹ Cr · ${quarterlyFlowsDenomCaption}`
                : `${span} · ₹ Cr · positive = inflow, negative = outflow`;
            })()}
            denominatorTooltip={
              quarterlyFlowsView === "bars"
                ? undefined
                : "Latest quarter's per-segment share of total flow magnitude — the headline read for 'where did the quarter's flow go?'."
            }
            insights={quarterlyFlowsInsights}
            yoyBadge={(() => {
              const v = latestYoyPct(equityFlowFromQuarterly, 4);
              return v === null
                ? undefined
                : { label: "Equity YoY", pct: v };
            })()}
            action={
              <>
                {quarterlyFlowsView === "trend" && (
                  <LensToggle
                    basePath="/quarterly"
                    paramName="qFlowsLens"
                    defaultValue="absolute"
                    lenses={[
                      { value: "absolute", label: "₹ Cr" },
                      { value: "share", label: "% of flow magnitude" },
                    ]}
                    active={quarterlyFlowsLens}
                    preserveParams={preservedQueryParams}
                  />
                )}
                <ChartTypeToggle
                  basePath="/quarterly"
                  paramName="quarterlyFlowsView"
                  active={quarterlyFlowsView}
                  preserveParams={preservedQueryParams}
                />
              </>
            }
          >
            {quarterlyFlowsView === "bars" ? (
              <BarsWithGrowth
                data={quarterlyFlowsBarsData}
                barColor="hsl(var(--chart-1))"
                growthColor="hsl(var(--foreground))"
                valueFormat="cr"
                axisFormat="cr"
                labelFormat="none"
                name="Equity quarterly net flow"
                growthLabel="Equity YoY %"
              />
            ) : (
              <GroupedBars
                data={flowsDataDisplay}
                xKey="quarterLabel"
                labelFormat="none"
                valueFormat={quarterlyFlowsLens === "share" ? "pct" : "cr"}
                axisFormat={quarterlyFlowsLens === "share" ? "pct" : "cr"}
                bars={qFlowsSeries}
              />
            )}
            <HowToRead>
              {quarterlyFlowsView === "bars" ? (
                <p>
                  Bars show actual quarterly Equity flow. The line shows
                  YoY growth. Debt and Liquid remain visible in Trend view.
                </p>
              ) : (
                <p className="inline-flex items-center gap-1.5">
                  Liquid is shown separately for readability.
                  <InfoTooltip label="In AMFI classification, Liquid is part of debt-oriented schemes. Share view divides each value by the quarter's sum of absolute flow magnitudes so signs (inflow vs outflow) stay intact." />
                </p>
              )}
              <ul className="list-disc space-y-0.5 pl-4">
                <li>Positive bars mean money entered the category; negative bars mean it left.</li>
                <li>Rising equity usually signals risk-on; rising debt or liquid often signals defensive allocation.</li>
                <li>Compare the latest quarter to the trailing-4-quarter average (the dotted line in Trend view) to spot unusually large moves.</li>
              </ul>
            </HowToRead>
          </ChartWithContext>
        </div>
      )}

      {activeTab === "active-passive" && (
        <TabIntroCard
          headline="How fast is passive closing the gap?"
          summary="Active-equity last-month AAUM and the equity AAUM breakdown show whether ETF & Index is gaining share against actively managed equity."
          watchNext="Whether the ETF & Index share keeps climbing even as active-equity AAUM rises."
        />
      )}

      {activeTab === "active-passive" && hasAnyEquityMix && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active Equity &amp; Equity Mix
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Quarterly Report
            </p>
          </div>

          <HowToRead>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><span className="text-foreground">Active funds</span> are managed by a fund manager who picks stocks and aims to beat an index.</li>
              <li><span className="text-foreground">Passive funds</span> (ETFs and index funds) simply track an index at a lower fee.</li>
              <li>A rising passive share pressures fee yields for active-heavy AMCs over time, even when active AUM is still growing.</li>
            </ul>
          </HowToRead>

          <section className="grid gap-4 lg:grid-cols-2">
            <ChartWithContext
              title="Active Equity Last-month AAUM Trend"
              subtitle="AUM in active equity funds at each quarter's last month. The actively-managed equity asset base."
              flowKind="stock"
              denominatorCaption={(() => {
                if (qAeAaumLens === "share") {
                  return `${aeAaumShare.length} quarter${aeAaumShare.length === 1 ? "" : "s"} · % of total industry last-month AAUM`;
                }
                const span = `${aeAaumTrend.length} quarter${aeAaumTrend.length === 1 ? "" : "s"}`;
                return aeAaumDenomCaption
                  ? `${span} · ₹ Cr · ${aeAaumDenomCaption}`
                  : `${span} · ₹ Cr · last-month AAUM (not QAAUM)`;
              })()}
              denominatorTooltip="Latest active-equity AAUM as a % of total industry last-month AAUM — separates absolute scale growth from share capture against other segments."
              insights={aeAaumInsights}
              yoyBadge={(() => {
                const v = latestYoyPct(aeAaumTrend, 4);
                return v === null ? undefined : { label: "YoY", pct: v };
              })()}
              action={
                <LensToggle
                  basePath="/quarterly"
                  paramName="qAeAaumLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "% of total AAUM" },
                  ]}
                  active={qAeAaumLens}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {aeAaumTrend.length > 0 ? (() => {
                const ov = adaptiveAverageOverlay(aeAaumFullHistory, aeAaumDisplay, 4);
                const useOverlay = qAeAaumLens !== "share";
                return (
                  <BarSeries
                    data={aeAaumDisplay}
                    name="Active Equity Last-month AAUM"
                    color="hsl(var(--chart-1))"
                    valueFormat={qAeAaumLens === "share" ? "pct" : "cr"}
                    axisFormat={qAeAaumLens === "share" ? "pct" : "cr"}
                    labelFormat="none"
                    trendline={useOverlay && ov.kind === "trailing" ? ov.trendline : undefined}
                    trendlineName={useOverlay && ov.kind === "trailing" ? ov.label : undefined}
                    referenceValue={useOverlay && ov.kind === "visible-mean" ? ov.referenceValue : undefined}
                    referenceLabel={useOverlay && ov.kind === "visible-mean" ? ov.label : undefined}
                  />
                );
              })() : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active-equity AAUM not yet published — appears after the next AMFI Quarterly Report is ingested.
                </div>
              )}
            </ChartWithContext>
          </section>

          <ChartWithContext
            title="Equity Last-month AAUM Breakdown"
            subtitle="Active equity AUM split into Active, ETF & Index, and Arbitrage (last-month basis)."
            flowKind="stock"
            denominatorCaption={(() => {
              const base = equityMixLens === "share"
                ? `${aeBreakdown.length} quarter${aeBreakdown.length === 1 ? "" : "s"} · stacked share of equity AAUM (last-month basis)`
                : aeBreakdownSubtitle;
              return aeBreakdownDenomCaption
                ? `${base} · ${aeBreakdownDenomCaption}`
                : base;
            })()}
            denominatorTooltip="ETF & Index share of equity AUM — the headline passive-penetration number, computed on the last-month-AAUM basis from the quarterly disclosure."
            insights={aeBreakdownInsights}
            yoyBadge={(() => {
              const v = latestYoyPct(activeEquityFromQBreakdown, 4);
              return v === null
                ? undefined
                : { label: "Active YoY", pct: v };
            })()}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <LensToggle
                  basePath="/quarterly"
                  paramName="qEquityMixLens"
                  defaultValue="absolute"
                  lenses={[
                    { value: "absolute", label: "₹ Cr" },
                    { value: "share", label: "% of equity AAUM" },
                  ]}
                  active={equityMixLens}
                  preserveParams={preservedQueryParams}
                />
              </div>
            }
          >
            {aeBreakdownHasData ? (
              <GroupedBars
                data={aeBreakdownDisplay}
                xKey="quarterLabel"
                labelFormat="none"
                valueFormat={equityMixLens === "share" ? "pct" : "cr"}
                axisFormat={equityMixLens === "share" ? "pct" : "cr"}
                bars={qEquityMixSeries}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Equity breakdown (Active / ETF & Index / Arbitrage) not yet published for this quarter.
              </div>
            )}
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Active Equity, ETF &amp; Index, and Arbitrage shown separately.
              All values use last-month AAUM, not a true 3-month average.
              <InfoTooltip label="Active Equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-oriented schemes. ETF & Index = Index Funds + Other ETFs. Source: AMFI Quarterly Report's last-month AAUM column. Share view divides each by the quarter's sum of all three segments." />
            </p>
          </ChartWithContext>
        </div>
      )}

      {activeTab === "retail-schemes" && (
        <TabIntroCard
          headline="How broad is retail participation?"
          summary="Total folios, quarterly folio additions, and open-ended scheme count. Together they show whether participation is widening and whether the AMC shelf is expanding to absorb it."
          watchNext="Whether folio additions accelerate while the scheme count stabilises — a sign of consolidation in winning categories."
        />
      )}

      {activeTab === "retail-schemes" && (hasAnyFolioKpi || hasAnyFolioTrend) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Folios &amp; Scheme Count
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Quarterly Report
              {quarterlyFoliosRead ? ` · ${quarterlyFoliosRead}` : ""}
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="Total Folios"
              value={formatCroreCountSafe(totalFolios)}
              note=""
              noteHover={foliosHover ?? undefined}
              sparkline={foliosCtx.sparkline}
              sparklineColor="hsl(var(--chart-1))"
              yoyPct={foliosCtx.yoyPct ?? undefined}
              percentile={foliosCtx.percentile ?? undefined}
              ratio={
                typeof totalFolios === "number" &&
                typeof selectedRow?.grandTotalAum === "number" &&
                selectedRow.grandTotalAum > 0
                  ? `${(totalFolios / selectedRow.grandTotalAum).toFixed(1)} folios per ₹ Cr AUM`
                  : undefined
              }
            />
            <KpiCard
              label="Folio Additions QoQ"
              value={formatLakhSafe(folioAdditions)}
              note=""
              noteHover={
                foliosHover
                  ? `${foliosHover} · derived QoQ Δ from grandTotalFolios`
                  : undefined
              }
              sparkline={folioAdditionsTrend}
              sparklineColor="hsl(var(--chart-4))"
            />
            <KpiCard
              label="Open-Ended Scheme Count"
              value={formatIntSafe(openEndedSchemes)}
              note=""
              noteHover="AMFI Quarterly Report · Sum of categorySchemes across 39 open-ended categories (close-ended + interval excluded)"
              sparkline={schemesTrend}
              sparklineColor="hsl(var(--chart-5))"
            />
          </section>

          {hasAnyFolioTrend && (
            /* Downgraded to 2-up: chart cards with LensToggles squeezed
               at xl:grid-cols-3 and wrapped titles awkwardly. */
            <section className="grid gap-4 lg:grid-cols-2">
              <ChartWithContext
                title="Folios Trend"
                subtitle="Total industry folio count by quarter. A breadth-of-investor measure."
                flowKind="stock"
                denominatorCaption={(() => {
                  if (qFoliosLens === "share") {
                    return `${foliosTrendShare.length} quarter${foliosTrendShare.length === 1 ? "" : "s"} · indexed to 4Q avg (100 = on-trend)`;
                  }
                  const span = `${foliosTrend.length} quarter${foliosTrend.length === 1 ? "" : "s"}`;
                  return foliosTrendDenomCaption
                    ? `${span} · crore folios · ${foliosTrendDenomCaption}`
                    : `${span} · crore folios · industry-wide`;
                })()}
                denominatorTooltip="Latest folio base as a % of the trailing 4-quarter average — separates a fresh wave of investor onboarding from a flat shelf."
                insights={foliosTrendInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(foliosTrend, 4);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
                action={
                  <LensToggle
                    basePath="/quarterly"
                    paramName="qFoliosLens"
                    defaultValue="absolute"
                    lenses={[
                      { value: "absolute", label: "Cr" },
                      { value: "share", label: "vs 4Q avg" },
                    ]}
                    active={qFoliosLens}
                    preserveParams={preservedQueryParams}
                  />
                }
              >
                {foliosTrend.length > 0 ? (() => {
                  const ov = adaptiveAverageOverlay(foliosFullHistory, foliosDisplay, 4);
                  const useOverlay = qFoliosLens !== "share";
                  const showShareRef = qFoliosLens === "share";
                  return (
                    <BarSeries
                      data={foliosDisplay}
                      name="Folios"
                      color="hsl(var(--chart-1))"
                      valueFormat={qFoliosLens === "share" ? "pct" : "crore-count"}
                      axisFormat={qFoliosLens === "share" ? "pct" : "crore-count"}
                      labelFormat="none"
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
                          ? "4-quarter avg"
                          : useOverlay && ov.kind === "visible-mean"
                            ? ov.label
                            : undefined
                      }
                    />
                  );
                })() : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Folio count not yet ingested for any quarter.
                  </div>
                )}
              </ChartWithContext>

              <ChartWithContext
                title="Folio Additions Trend"
                subtitle="Net new folios opened each quarter. Shows retail-onboarding momentum."
                flowKind="net"
                denominatorCaption={(() => {
                  if (qFolioAddLens === "share") {
                    return `${folioAdditionsShare.length} quarter${folioAdditionsShare.length === 1 ? "" : "s"} · % of folio base`;
                  }
                  const span = `${folioAdditionsTrend.length} quarter${folioAdditionsTrend.length === 1 ? "" : "s"}`;
                  return folioAdditionsDenomCaption
                    ? `${span} · lakh · ${folioAdditionsDenomCaption}`
                    : `${span} · lakh`;
                })()}
                denominatorTooltip="Latest quarterly net adds expressed as a percentage of the total folio base — strips out base-rate growth so different years are comparable."
                insights={folioAdditionsInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(folioAdditionsTrend, 4);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
                action={
                  <LensToggle
                    basePath="/quarterly"
                    paramName="qFolioAddLens"
                    defaultValue="absolute"
                    lenses={[
                      { value: "absolute", label: "Lakh" },
                      { value: "share", label: "% of base" },
                    ]}
                    active={qFolioAddLens}
                    preserveParams={preservedQueryParams}
                  />
                }
              >
                {folioAdditionsTrend.length > 0 ? (() => {
                  const ov = adaptiveAverageOverlay(folioAdditionsFullHistory, folioAdditionsDisplay, 4);
                  const useOverlay = qFolioAddLens !== "share";
                  return (
                    <BarSeries
                      data={folioAdditionsDisplay}
                      name="Folio Additions"
                      color="hsl(var(--chart-4))"
                      valueFormat={qFolioAddLens === "share" ? "pct" : "lakh"}
                      axisFormat={qFolioAddLens === "share" ? "pct" : "lakh"}
                      labelFormat="none"
                      trendline={useOverlay && ov.kind === "trailing" ? ov.trendline : undefined}
                      trendlineName={useOverlay && ov.kind === "trailing" ? ov.label : undefined}
                      referenceValue={useOverlay && ov.kind === "visible-mean" ? ov.referenceValue : undefined}
                      referenceLabel={useOverlay && ov.kind === "visible-mean" ? ov.label : undefined}
                    />
                  );
                })() : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Need at least two consecutive quarters of folio data to derive additions.
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={foliosHover ?? undefined}
                >
                  derived QoQ Δ
                </div>
              </ChartWithContext>

              <ChartWithContext
                title="Open-Ended Scheme Count Trend"
                subtitle="Number of open-ended schemes on the industry shelf. Tracks shelf expansion."
                flowKind="stock"
                denominatorCaption={(() => {
                  if (qSchemesLens === "share") {
                    return `${schemesTrendShare.length} quarter${schemesTrendShare.length === 1 ? "" : "s"} · indexed to 4Q avg (100 = on-trend)`;
                  }
                  const span = `${schemesTrend.length} quarter${schemesTrend.length === 1 ? "" : "s"}`;
                  return schemesTrendDenomCaption
                    ? `${span} · ${schemesTrendDenomCaption}`
                    : `${span} · sum across 39 open-ended categories`;
                })()}
                denominatorTooltip="Latest open-ended scheme count as a % of the trailing 4-quarter average — captures shelf expansion (NFOs net of mergers / closures) without the line going flat at this slow-moving scale."
                insights={schemesTrendInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(schemesTrend, 4);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
                action={
                  <LensToggle
                    basePath="/quarterly"
                    paramName="qSchemesLens"
                    defaultValue="absolute"
                    lenses={[
                      { value: "absolute", label: "Count" },
                      { value: "share", label: "vs 4Q avg" },
                    ]}
                    active={qSchemesLens}
                    preserveParams={preservedQueryParams}
                  />
                }
              >
                {schemesTrend.length > 0 ? (() => {
                  const ov = adaptiveAverageOverlay(schemesFullHistory, schemesDisplay, 4);
                  const useOverlay = qSchemesLens !== "share";
                  const showShareRef = qSchemesLens === "share";
                  return (
                    <BarSeries
                      data={schemesDisplay}
                      name="Open-Ended Schemes"
                      color="hsl(var(--chart-5))"
                      valueFormat={qSchemesLens === "share" ? "pct" : "count"}
                      axisFormat={qSchemesLens === "share" ? "pct" : "count"}
                      labelFormat="none"
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
                          ? "4-quarter avg"
                          : useOverlay && ov.kind === "visible-mean"
                            ? ov.label
                            : undefined
                      }
                    />
                  );
                })() : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Open-ended scheme count not yet ingested.
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title="AMFI Quarterly Report · Sum of categorySchemes across 39 open-ended categories"
                >
                  derived from categorySchemes
                </div>
              </ChartWithContext>
            </section>
          )}
        </div>
      )}

      {activeTab === "categories" && (
        <TabIntroCard
          headline="Where is flow rotating across categories?"
          summary="Quarterly QAAUM share and net-inflow share for each active-equity category. Read for which categories are absorbing money and which are quietly losing share through the cycle."
          watchNext="Which categories show a sustained rise in net-inflow share before AUM share follows — the leading multi-quarter rotation signal."
        />
      )}

      {activeTab === "categories" && hasAnyIiflTrend ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                Active-Equity Category Trends
              </h2>
              <p className="text-xs text-muted-foreground">
                {qCategoryTrendsScale === "indexed"
                  ? "QAAUM share vs net inflow share · each series rebased to 100 at the first visible quarter · Source: AMFI Monthly Reports, aggregated quarterly"
                  : "QAAUM share vs net inflow share · Source: AMFI Monthly Reports, aggregated quarterly"}
              </p>
            </div>
            <LensToggle
              basePath="/quarterly"
              paramName="qCategoryTrendsScale"
              defaultValue="levels"
              lenses={[
                { value: "levels", label: "Levels" },
                { value: "indexed", label: "Indexed (100)" },
              ]}
              active={qCategoryTrendsScale}
              preserveParams={preservedQueryParams}
            />
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            {iiflFeaturedCards.map((c) => (
              <Card
                key={c.slug}
                title={c.label}
                subtitle={`${c.series.length} quarter${c.series.length === 1 ? "" : "s"} · % of active-equity envelope`}
              >
                {c.hasData ? (
                  <MultiLine
                    data={
                      qCategoryTrendsScale === "indexed"
                        ? indexSeriesToBase(c.series, [
                            "aumSharePct",
                            "flowSharePct",
                          ])
                        : c.series
                    }
                    xKey="label"
                    labelFormat="none"
                    valueFormat={
                      qCategoryTrendsScale === "indexed" ? "count" : "pct"
                    }
                    axisFormat={
                      qCategoryTrendsScale === "indexed" ? "count" : "pct"
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

          {hasExpandedIiflTrend && (
            <section className="grid gap-4 lg:grid-cols-2">
                  {iiflExpandedCards.map((c) => (
                    <Card
                      key={c.slug}
                      title={c.label}
                      subtitle={`${c.series.length} quarter${c.series.length === 1 ? "" : "s"} · % of active-equity envelope`}
                    >
                      {c.hasData ? (
                        <MultiLine
                          data={
                            qCategoryTrendsScale === "indexed"
                              ? indexSeriesToBase(c.series, [
                                  "aumSharePct",
                                  "flowSharePct",
                                ])
                              : c.series
                          }
                          xKey="label"
                          labelFormat="none"
                          valueFormat={
                            qCategoryTrendsScale === "indexed" ? "count" : "pct"
                          }
                          axisFormat={
                            qCategoryTrendsScale === "indexed" ? "count" : "pct"
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
            {qCategoryTrendsScale === "indexed"
              ? "Each line shows growth relative to its own first visible quarter (=100). Use Levels to read absolute % shares."
              : "QAAUM share and net inflow share, aggregated monthly into fiscal quarters."}
            <InfoTooltip
              label={
                qCategoryTrendsScale === "indexed"
                  ? "Each series is rebased independently to 100 at the first visible quarter. A value of 130 means the share is 30% higher than the start of the visible window."
                  : "QAAUM share = avg(category AAUM) ÷ avg(active-equity AAUM) over the months in each fiscal quarter. Net inflow share = sum(category net inflow) ÷ sum(active-equity net inflow) over the same months. Active equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-Oriented schemes."
              }
            />
          </p>
        </div>
      ) : null}

      {activeTab === "concentration" && (
        <TabIntroCard
          headline="How concentrated is the industry?"
          summary="AMC and category Herfindahl–Hirschman Indexes, plus the Top-7 AMC share of industry AUM. Together they show whether incumbents are pulling away or whether challengers have a window."
          watchNext="Whether the AMC HHI percentile holds in the top decile — the structural signal for incumbent moat strength."
        />
      )}

      {activeTab === "concentration" && hhiHasData && (
        <Card
          title="Industry Concentration Index"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                How concentrated the industry is each quarter — lower numbers mean more competition; higher means one or a few players dominate.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Herfindahl–Hirschman Index · 0–10,000 · Source: AMFI Fundwise AAUM + AMFI Quarterly Report${
                  latestAmcHhi || latestCatHhi ? " · latest " : ""
                }${latestAmcHhi ? `AMC ${Math.round(latestAmcHhi.hhi)}` : ""}${
                  latestAmcHhi && latestCatHhi ? " · " : ""
                }${latestCatHhi ? `Category ${Math.round(latestCatHhi.hhi)}` : ""}`}
              </p>
            </div>
          }
        >
          <MultiLine
            data={hhiData}
            xKey="label"
            valueFormat="count"
            axisFormat="count"
            labelFormat="none"
            lines={[
              {
                key: "amcHhi",
                name: "AMC Concentration",
                color: "hsl(var(--chart-1))",
              },
              {
                key: "categoryHhi",
                name: "Category Concentration",
                color: "hsl(var(--chart-3))",
              },
            ]}
          />
          {(amcHhiPercentile || catHhiPercentile) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {amcHhiPercentile && (
                <HhiPercentileBlock
                  label="AMC concentration"
                  read={amcHhiPercentile}
                />
              )}
              {catHhiPercentile && (
                <HhiPercentileBlock
                  label="Category concentration"
                  read={catHhiPercentile}
                />
              )}
            </div>
          )}
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            HHI = Σ(share²) × 10,000 across participants in each quarter.
            {latestAmcHhi
              ? ` Latest top-AMC share: ${latestAmcHhi.topShareLeaderPct.toFixed(2)}%.`
              : ""}
            <InfoTooltip
              label={`AMC HHI uses ${latestAmcHhi?.participantCount ?? "—"} AMCs from the AMFI Fundwise AAUM disclosure. Category HHI uses ${latestCatHhi?.participantCount ?? "—"} scheme categories from the AMFI Quarterly Report. U.S. DOJ thresholds: <1,500 unconcentrated, 1,500–2,500 moderately concentrated, >2,500 highly concentrated.`}
            />
          </p>
        </Card>
      )}

      {activeTab === "concentration" && (
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
            AMFI Fundwise AAUM disclosure not yet ingested for the latest quarter.
          </div>
        )}
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Top {aumMarketShare.topAmcs.length} AMCs by latest AAUM;
          Others includes all remaining AMCs.
          <InfoTooltip label="Denominator is total AAUM of all AMCs in the snapshot." />
        </p>
      </Card>
      )}

    </div>
  );
}

/** Compact percentile-vs-history read for an HHI series. Renders the
 *  trailing-window percentile of the latest reading plus the absolute
 *  HHI change vs an anchor quarter (default 5 years back). Visual
 *  shorthand for "is the industry more or less concentrated than its
 *  recent norm?" */
function HhiPercentileBlock({
  label,
  read,
}: {
  label: string;
  read: { latestHhi: number; latestQuarterLabel: string; windowQuarters: number; percentile: number; changeVsAnchor: number | null; anchorQuarterLabel: string | null };
}) {
  const pct = read.percentile;
  const change = read.changeVsAnchor;
  const arrow = change === null ? "" : change > 50 ? "↑" : change < -50 ? "↓" : "→";
  const direction =
    change === null
      ? null
      : change > 50
        ? "industry more concentrated"
        : change < -50
          ? "industry less concentrated"
          : "broadly unchanged";
  const interpret =
    pct >= 80
      ? "near the high end of recent history"
      : pct <= 20
        ? "near the low end of recent history"
        : "in line with recent history";
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label} · {read.latestQuarterLabel}
      </div>
      <div className="mt-1 text-lg font-semibold tabular tracking-tight">
        HHI {Math.round(read.latestHhi)}
        <span className="ml-2 text-[11px] font-medium text-muted-foreground">
          {formatPercentilePill(pct)} · {interpret}
        </span>
      </div>
      {change !== null && read.anchorQuarterLabel && (
        <div className="mt-1 text-[11px] tabular text-muted-foreground">
          {arrow} {Math.abs(Math.round(change))} pts vs {read.anchorQuarterLabel}
          {direction ? ` · ${direction}` : ""}
        </div>
      )}
    </div>
  );
}

/** Quarterly Signal Summary tile — title chip, value line, 3-beat
 *  read. Mirrors the Sector Read tiles on `/` so the visual identity
 *  is consistent across pages. */
function QSignalTile({
  label,
  pill,
  pillTone,
  valueLine,
  read,
}: {
  label: string;
  pill: string;
  pillTone: "positive" | "negative" | "neutral";
  valueLine: string | null;
  read: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tabular tracking-tight",
            pillTone === "positive" &&
              "border-positive/40 bg-positive/10 text-positive",
            pillTone === "negative" &&
              "border-negative/40 bg-negative/10 text-negative",
            pillTone === "neutral" &&
              "border-border bg-muted text-muted-foreground"
          )}
        >
          {pill}
        </span>
      </div>
      {valueLine && (
        <div className="text-[11px] tabular text-foreground/80">{valueLine}</div>
      )}
      <p className="text-[12px] leading-snug text-muted-foreground">{read}</p>
    </div>
  );
}
