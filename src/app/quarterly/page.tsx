import { BarSeries } from "@/components/charts/BarSeries";
import { Donut, type DonutSlice } from "@/components/charts/Donut";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import { StackedArea } from "@/components/charts/StackedArea";
import { Card } from "@/components/ui/Card";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import { KpiCard } from "@/components/ui/KpiCard";
import { FiscalQuarterPicker } from "@/components/filters/FiscalQuarterPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import { chartInsights, movingAverage } from "@/lib/chart-context";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  iiflActiveEquityQuarterlyTrendCard,
  latestCategoryProvenance,
} from "@/data/amfi-monthly-category";
import { formatKpiProvenanceTooltip } from "@/data/amfi-monthly";
import { cyclePhaseHistory } from "@/data/market-indices";
import { CycleRibbon } from "@/components/ui/CycleRibbon";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { LensToggle } from "@/components/ui/LensToggle";
import {
  availableQuartersDesc,
  formatQuarterlyProvenanceLine,
  formatQuarterlyProvenanceTooltip,
  getQuarterlyKpiProvenance,
  getQuarterlyKpiValue,
  latestIndustryProvenance,
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
  type AmfiQuarterlyKpiField,
} from "@/data/amfi-quarterly";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
} from "@/lib/format";
import {
  amcLevelHhiPercentileRead,
  amcLevelHhiSeries,
  topAumMarketShareSeries,
} from "@/data/amc-peer-universe";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";
import { cn } from "@/lib/cn";

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
  // Pass-through params for every LensToggle on this page.
  const preservedQueryParams: Record<string, string | undefined> = {
    quarter: typeof sp.quarter === "string" ? sp.quarter : undefined,
    qFlowsLens:
      typeof sp.qFlowsLens === "string" ? sp.qFlowsLens : undefined,
    qEquityMixLens:
      typeof sp.qEquityMixLens === "string" ? sp.qEquityMixLens : undefined,
  };

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
    const ctx = quarterlyKpiContext(field, 16);
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
  const aaumTrendHasData = aaumTrendData.length > 0;
  const aaumTrendSubtitle = aaumTrendHasData
    ? `Last-month AAUM · ${aaumTrendData.length} quarter${aaumTrendData.length === 1 ? "" : "s"} · ₹ Cr`
    : "Last-month AAUM not available";
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
  });

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
  const aeAaumHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("equityLastMonthAaum")
  );
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

  // ---- Folios & Scheme Count ----------------------------------------
  const totalFolios = selectedRow?.grandTotalFolios ?? null;
  const folioAdditions = latestQuarterlyFolioAdditions();
  const foliosCtx = quarterlyKpiContext("grandTotalFolios", 16);
  const openEndedSchemes = latestOpenEndedSchemeCount();
  const foliosTrend = quarterlyTrend("grandTotalFolios", 16);
  const folioAdditionsTrend = quarterlyFolioAdditionsTrend(16);
  const schemesTrend = quarterlyOpenEndedSchemeCountTrend(16);
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
  });

  // Folio additions denominator: latest quarterly net adds as bps of
  // the existing folio base — normalises growth against the (large)
  // base so the trend is comparable across years. additions in lakh,
  // base in crore — convert: 1 Cr = 100 lakh.
  const folioAdditionsDenomCaption = (() => {
    if (folioAdditionsTrend.length === 0) return undefined;
    const latest = folioAdditionsTrend[folioAdditionsTrend.length - 1];
    const baseCr = totalFolios;
    if (typeof baseCr !== "number" || baseCr <= 0) return undefined;
    const bps = (latest.value / 100 / (baseCr / 1e7)) * 10000;
    return `${bps.toFixed(0)} bps of total folio base · latest ${latest.label}`;
  })();
  const folioAdditionsInsights = chartInsights(folioAdditionsTrend, {
    metricName: "folio additions",
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
  });

  // AUM Market Share — live Top 7 + Others from AMFI Fundwise AAUM.
  // Same helper as /monthly so the two pages render an identical view.
  const aumMarketShare = topAumMarketShareSeries(7, 8);
  const aumMarketShareCoverage = aumMarketShare.coverage;

  // Cycle regime + section reads.
  const cyclePhasePoints = cyclePhaseHistory();
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

      {cyclePhasePoints.length > 0 && (
        <Card
          title="Cycle Regime"
          subtitle={`Per-month cycle phase since ${cyclePhasePoints[0].month} · derived from active-equity flow z-score + Nifty 500 drawdown`}
        >
          <CycleRibbon points={cyclePhasePoints} lastN={84} />
        </Card>
      )}

      {/* AMFI Quarterly Snapshot — first live section, mirrors /monthly. */}
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

      {/* AMFI Quarterly AUM Mix & Trend — Donut bound to the selected
          quarter; bar trend shows the full 8-quarter history. */}
      {selectedRow && (
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
                <Donut data={mixSlices} />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Mix unavailable for the selected quarter
                </div>
              )}
            </Card>
            <ChartWithContext
              title="Last-month AAUM Trend"
              subtitle={`${aaumTrendSubtitle} · Average AUM column is last-month only — not a true quarterly average`}
              flowKind="stock"
              denominatorCaption={lastMonthAaumDenomCaption}
              denominatorTooltip="Latest last-month AAUM as a % of the trailing 4-quarter average — separates structural growth from quarter-to-quarter mean-reversion."
              insights={lastMonthAaumInsights}
            >
              {aaumTrendHasData ? (
                <BarSeries
                  data={aaumTrendData}
                  name="Last-month AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="none"
                  trendline={movingAverage(aaumTrendData, 4)}
                  trendlineName="4Q avg"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Last-month AAUM unavailable
                </div>
              )}
            </ChartWithContext>
          </section>
        </div>
      )}

      {/* Quarterly Flows — full-width grouped bar chart mirroring
          /monthly's Equity / Debt / Liquid Monthly Net Flows. */}
      {flowsHasData && (
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
          <Card
            title="Equity / Debt / Liquid Quarterly Net Flows"
            subtitle={
              quarterlyFlowsLens === "share"
                ? `${flowsData.length} quarter${flowsData.length === 1 ? "" : "s"} · % of quarterly flow magnitude (signs preserved)`
                : `${flowsData.length} quarter${flowsData.length === 1 ? "" : "s"} · ₹ Cr · positive = inflow, negative = outflow`
            }
            action={
              <LensToggle
                basePath="/quarterly"
                paramName="qFlowsLens"
                defaultValue="absolute"
                lenses={[
                  { value: "absolute", label: "₹ Cr" },
                  { value: "share", label: "Share %" },
                ]}
                active={quarterlyFlowsLens}
                preserveParams={preservedQueryParams}
              />
            }
          >
            <GroupedBars
              data={flowsDataDisplay}
              xKey="quarterLabel"
              labelFormat="none"
              valueFormat={quarterlyFlowsLens === "share" ? "pct" : "cr"}
              axisFormat={quarterlyFlowsLens === "share" ? "pct" : "cr"}
              bars={[
                {
                  key: "equity",
                  name: "Equity",
                  color: "hsl(var(--chart-1))",
                },
                { key: "debt", name: "Debt", color: "hsl(var(--chart-2))" },
                {
                  key: "liquid",
                  name: "Liquid",
                  color: "hsl(var(--chart-4))",
                },
              ]}
            />
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Liquid is shown separately for readability.
              <InfoTooltip label="In AMFI classification, Liquid is part of debt-oriented schemes. Share view divides each value by the quarter's sum of absolute flow magnitudes so signs (inflow vs outflow) stay intact." />
            </p>
          </Card>
        </div>
      )}

      {/* Active Equity & Equity Mix — 3 cards mirroring /monthly. */}
      {hasAnyEquityMix && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active Equity &amp; Equity Mix
            </h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Quarterly Report
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Active Equity Last-month AAUM Trend"
              subtitle={`${aeAaumTrend.length} quarter${aeAaumTrend.length === 1 ? "" : "s"} · ₹ Cr · last-month AAUM (not QAAUM)`}
            >
              {aeAaumTrend.length > 0 ? (
                <BarSeries
                  data={aeAaumTrend}
                  name="Active Equity Last-month AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="none"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity Last-month AAUM unavailable
                </div>
              )}
            </Card>

            <Card
              title="Active Equity Share of Total Last-month AAUM"
              subtitle={`${aeShareTrend.length} quarter${aeShareTrend.length === 1 ? "" : "s"} · % of total last-month AAUM`}
            >
              {aeShareTrend.length > 0 ? (
                <BarSeries
                  data={aeShareTrend}
                  name="Active Equity Share"
                  color="hsl(var(--chart-3))"
                  valueFormat="pct"
                  axisFormat="pct"
                  labelFormat="none"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity Share unavailable
                </div>
              )}
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={aeAaumHover ?? undefined}
              >
                Last-month AAUM ratio — not a true QAAUM share
              </div>
            </Card>
          </section>

          <Card
            title="Equity Last-month AAUM Breakdown"
            subtitle={
              equityMixLens === "share"
                ? `${aeBreakdown.length} quarter${aeBreakdown.length === 1 ? "" : "s"} · stacked share of equity AAUM (last-month basis)`
                : aeBreakdownSubtitle
            }
            action={
              <LensToggle
                basePath="/quarterly"
                paramName="qEquityMixLens"
                defaultValue="absolute"
                lenses={[
                  { value: "absolute", label: "₹ Cr" },
                  { value: "share", label: "Share %" },
                ]}
                active={equityMixLens}
                preserveParams={preservedQueryParams}
              />
            }
          >
            {aeBreakdownHasData ? (
              <GroupedBars
                data={aeBreakdownDisplay}
                xKey="quarterLabel"
                labelFormat="none"
                valueFormat={equityMixLens === "share" ? "pct" : "cr"}
                axisFormat={equityMixLens === "share" ? "pct" : "cr"}
                bars={[
                  {
                    key: "activeEquity",
                    name: "Active Equity",
                    color: "hsl(var(--chart-1))",
                  },
                  {
                    key: "etfIndex",
                    name: "ETF & Index",
                    color: "hsl(var(--chart-5))",
                  },
                  {
                    key: "arbitrage",
                    name: "Arbitrage",
                    color: "hsl(var(--chart-2))",
                  },
                ]}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Equity breakdown unavailable
              </div>
            )}
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Active Equity, ETF &amp; Index, and Arbitrage shown separately.
              All values use last-month AAUM, not a true 3-month average.
              <InfoTooltip label="Active Equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-oriented schemes. ETF & Index = Index Funds + Other ETFs. Source: AMFI Quarterly Report's last-month AAUM column. Share view divides each by the quarter's sum of all three segments." />
            </p>
          </Card>
        </div>
      )}

      {/* Quarterly Folios & Scheme Count — mirrors /monthly's Industry
          Folios & NFO. NFO Launches / NFO Funds Mobilized are NOT
          mirrored because the quarterly PDF page 2 doesn't carry the
          industry-wide Grand Total NFO row. */}
      {(hasAnyFolioKpi || hasAnyFolioTrend) && (
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
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ChartWithContext
                title="Folios Trend"
                subtitle={`Industry-wide · ${foliosTrend.length} quarter${foliosTrend.length === 1 ? "" : "s"} · crore folios`}
                flowKind="stock"
                denominatorCaption={foliosTrendDenomCaption}
                denominatorTooltip="Latest folio base as a % of the trailing 4-quarter average — separates a fresh wave of investor onboarding from a flat shelf."
                insights={foliosTrendInsights}
              >
                {foliosTrend.length > 0 ? (
                  <BarSeries
                    data={foliosTrend}
                    name="Folios"
                    color="hsl(var(--chart-1))"
                    valueFormat="crore-count"
                    axisFormat="crore-count"
                    labelFormat="none"
                    trendline={movingAverage(foliosTrend, 4)}
                    trendlineName="4Q avg"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Folios unavailable
                  </div>
                )}
              </ChartWithContext>

              <ChartWithContext
                title="Folio Additions Trend"
                subtitle={`Net new folios per quarter · ${folioAdditionsTrend.length} quarter${folioAdditionsTrend.length === 1 ? "" : "s"} · lakh`}
                flowKind="net"
                denominatorCaption={folioAdditionsDenomCaption}
                denominatorTooltip="Latest quarterly net adds expressed in basis points of the total folio base — strips out base-rate growth so different years are comparable."
                insights={folioAdditionsInsights}
              >
                {folioAdditionsTrend.length > 0 ? (
                  <BarSeries
                    data={folioAdditionsTrend}
                    name="Folio Additions"
                    color="hsl(var(--chart-4))"
                    valueFormat="lakh"
                    axisFormat="lakh"
                    labelFormat="none"
                    trendline={movingAverage(folioAdditionsTrend, 4)}
                    trendlineName="4Q avg"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Need at least two consecutive quarters of folios
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
                subtitle={`Sum across 39 open-ended categories · ${schemesTrend.length} quarter${schemesTrend.length === 1 ? "" : "s"}`}
                flowKind="stock"
                denominatorCaption={schemesTrendDenomCaption}
                denominatorTooltip="Latest open-ended scheme count as a % of the trailing 4-quarter average — captures shelf expansion (NFOs net of mergers / closures) without the line going flat at this slow-moving scale."
                insights={schemesTrendInsights}
              >
                {schemesTrend.length > 0 ? (
                  <BarSeries
                    data={schemesTrend}
                    name="Open-Ended Schemes"
                    color="hsl(var(--chart-5))"
                    valueFormat="count"
                    axisFormat="count"
                    labelFormat="none"
                    trendline={movingAverage(schemesTrend, 4)}
                    trendlineName="4Q avg"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Scheme count unavailable
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

      {/* IIFL Active-Equity Category Trends — LIVE. Sourced from
          AMFI Monthly Reports aggregated into fiscal quarters. The
          one section on /quarterly that is allowed to source from
          AMFI Monthly Reports (true QAAUM share requires monthly
          period-average AAUM). */}
      {hasAnyIiflTrend ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active-Equity Category Trends
            </h2>
            <p className="text-xs text-muted-foreground">
              QAAUM share vs net inflow share · Source: AMFI Monthly
              Reports, aggregated quarterly
            </p>
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
                    data={c.series}
                    xKey="label"
                    labelFormat="none"
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

          {hasExpandedIiflTrend && (
            <details className="group rounded-md border border-dashed border-border bg-muted/20">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium tracking-tight marker:hidden">
                <span className="inline-flex items-center gap-2">
                  <span className="text-foreground">
                    Show more active-equity categories
                  </span>
                  <span className="rounded-full border border-border bg-background px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {iiflExpandedCards.length} more
                  </span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">
                    ›
                  </span>
                </span>
              </summary>
              <div className="border-t border-border/60 p-4">
                <section className="grid gap-4 lg:grid-cols-2">
                  {iiflExpandedCards.map((c) => (
                    <Card
                      key={c.slug}
                      title={c.label}
                      subtitle={`${c.series.length} quarter${c.series.length === 1 ? "" : "s"} · % of active-equity envelope`}
                    >
                      {c.hasData ? (
                        <MultiLine
                          data={c.series}
                          xKey="label"
                          labelFormat="none"
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
            QAAUM share and net inflow share, aggregated monthly into
            fiscal quarters.
            <InfoTooltip label="QAAUM share = avg(category AAUM) ÷ avg(active-equity AAUM) over the months in each fiscal quarter. Net inflow share = sum(category net inflow) ÷ sum(active-equity net inflow) over the same months. Active equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-Oriented schemes." />
          </p>
        </div>
      ) : null}

      {hhiHasData && (
        <Card
          title="Industry Concentration · HHI"
          subtitle={`Herfindahl–Hirschman Index · 0–10,000 · lower = more competitive · Source: AMFI Fundwise AAUM + AMFI Quarterly Report${
            latestAmcHhi || latestCatHhi
              ? " · latest "
              : ""
          }${latestAmcHhi ? `AMC ${Math.round(latestAmcHhi.hhi)}` : ""}${
            latestAmcHhi && latestCatHhi ? " · " : ""
          }${latestCatHhi ? `Category ${Math.round(latestCatHhi.hhi)}` : ""}`}
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
                name: "AMC HHI",
                color: "hsl(var(--chart-1))",
              },
              {
                key: "categoryHhi",
                name: "Category HHI",
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
          {pct.toFixed(0)}th percentile · {interpret}
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
