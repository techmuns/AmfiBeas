import type { DonutSlice } from "@/components/charts/Donut";
import { QuarterEndMixTable } from "@/components/data/QuarterEndMixTable";
import { AaumBridgeTable } from "@/components/data/AaumBridgeTable";
import { MultiLine } from "@/components/charts/MultiLine";
import { StackedArea } from "@/components/charts/StackedArea";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { quarterlyMarketWrap } from "@/data/market-wrap-quarterly";
import { FiscalQuarterPicker } from "@/components/filters/FiscalQuarterPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  chartInsights,
  yoyPctSeries,
} from "@/lib/chart-context";
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
import { resolveTabWithAliases } from "@/lib/tabs";

const QUARTERLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "aaum-flows", label: "AUM & Flows" },
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

  const activeTab = resolveTabWithAliases<QuarterlyTabId>(
    sp.tab,
    QUARTERLY_TAB_IDS,
    {
      categories: "aaum-flows",
      "retail-schemes": "concentration",
      "active-passive": "concentration",
    },
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
        </div>
      )}

      {activeTab === "aaum-flows" && aaumBridge.length > 0 && (
        <Card title="AUM Change: Flows vs Residual">
          <AaumBridgeTable rows={aaumBridge} />
        </Card>
      )}


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
