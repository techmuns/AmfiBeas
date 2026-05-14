import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { BarSeries } from "@/components/charts/BarSeries";
import { Donut, type DonutSlice } from "@/components/charts/Donut";
import { IiflHeatmap } from "@/components/charts/IiflHeatmap";
import { MultiLine } from "@/components/charts/MultiLine";
import { StackedArea } from "@/components/charts/StackedArea";
import { Waterfall } from "@/components/charts/Waterfall";
import { latestMonth } from "@/data/aggregate";
import {
  amfiMonthlyRows,
  availableMonthsDesc,
  formatKpiProvenanceLine,
  formatKpiProvenanceTooltip,
  getKpiProvenance,
  getKpiValue,
  industryFlowWaterfall,
  latestAmfiMonthlyRow,
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
  resolveSelectedRow,
  trailingActiveEquityNetInflowAverage,
  type AmfiMonthlyKpiField,
} from "@/data/amfi-monthly";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  iiflActiveEquityHeatmapData,
  iiflActiveEquityTrendCard,
  latestCategoryProvenance,
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
  }[] = [
    { field: "totalAaum", label: "Total AAUM", format: formatCompactCrSafe },
    { field: "equityAum", label: "Equity AUM", format: formatCompactCrSafe },
    { field: "debtAum", label: "Debt AUM", format: formatCompactCrSafe },
    { field: "liquidAum", label: "Liquid AUM", format: formatCompactCrSafe },
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
    },
    {
      field: "sipContribution",
      label: "SIP Contribution",
      format: formatCompactCrSafe,
    },
    { field: "sipAum", label: "SIP AUM", format: formatCompactCrSafe },
    {
      field: "sipAccounts",
      label: "SIP Accounts",
      // SIP accounts are stored as a raw count (e.g. 97,200,000); the
      // safe formatter divides by 1e7 and emits "9.72 Cr".
      format: (v: number) => formatCroreCountSafe(v),
    },
  ];

  const amfiCardsToRender = AMFI_CARDS.flatMap((spec) => {
    const value = getKpiValue(amfiSelected, spec.field);
    if (value === null) return [];
    const provenance = getKpiProvenance(amfiSelected, spec.field);
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
  const sipAumTrend = monthlyTrend("sipAum", 24);
  const sipAccountsTrend = monthlyTrend("sipAccounts", 24);

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
  const monthlyFlowsHasData = monthlyFlowsRows.some(
    (r) => r.equity !== null || r.debt !== null || r.liquid !== null
  );
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
  const equityBreakdownSubtitle = latestEquityMix
    ? `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · ₹ Cr · latest mix ${latestEquityMix.activePct.toFixed(1)}% Active / ${latestEquityMix.etfPct.toFixed(1)}% ETF & Index / ${latestEquityMix.arbPct.toFixed(1)}% Arbitrage`
    : `${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · ₹ Cr · period-average · grouped bars`;

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
  const iiflTrendCards = IIFL_ACTIVE_EQUITY_CATEGORIES.map((c) => {
    const { series, hasData } = iiflActiveEquityTrendCard(c.slug);
    const aumHover = formatKpiProvenanceTooltip(
      latestCategoryProvenance(c.slug, "categoryAaum")
    );
    return { ...c, series, hasData, aumHover };
  });
  const iiflTrendBySlug = new Map(iiflTrendCards.map((c) => [c.slug, c]));
  const featuredTrendCards = IIFL_TREND_FEATURED_SLUGS.map(
    (s) => iiflTrendBySlug.get(s)!
  );
  const expandedTrendCards = IIFL_TREND_EXPANDED_SLUGS.map(
    (s) => iiflTrendBySlug.get(s)!
  );
  const iiflTrendHasAny = iiflTrendCards.some((c) => c.hasData);
  const iiflTrendHasExpanded = expandedTrendCards.some((c) => c.hasData);

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

  // ---- 12-month Industry Flow Waterfall + Active vs Passive ---------
  const flowWaterfall = industryFlowWaterfall(12);
  const activePassiveTrend = monthlyActivePassiveTrend(24);

  return (
    <div className="space-y-6">
      <PageHeader title="Monthly Operating KPIs" subtitle={subtitle} />

      <Card
        title="AMFI Monthly Snapshot"
        subtitle={amfiSectionSubtitle}
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
            <Card title="Total AAUM Trend" subtitle={aaumTrendSubtitle}>
              {aaumTrendHasData ? (
                <BarSeries
                  data={aaumTrendData}
                  name="AAUM"
                  color="hsl(var(--chart-1))"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  AAUM unavailable · totalAaum not in uploaded AMFI PDFs
                </div>
              )}
            </Card>
          </section>
        </div>
      )}

      {hasAnySipTrend && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">SIP Trends</h2>
            <p className="text-xs text-muted-foreground">
              Source: AMFI Monthly Report
            </p>
          </div>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card
              title="SIP Contribution Trend"
              subtitle={`Monthly inflow · ${sipContribTrend.length} month${sipContribTrend.length === 1 ? "" : "s"} · ₹ Cr`}
            >
              {sipContribTrend.length > 0 ? (
                <BarSeries
                  data={sipContribTrend}
                  name="SIP Contribution"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  No SIP contribution months yet
                </div>
              )}
            </Card>

            <Card
              title="SIP AUM Trend"
              subtitle={`Period-end SIP assets · ${sipAumTrend.length} month${sipAumTrend.length === 1 ? "" : "s"} · ₹ Cr`}
            >
              {sipAumTrend.length > 0 ? (
                <BarSeries
                  data={sipAumTrend}
                  name="SIP AUM"
                  color="hsl(var(--chart-2))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  No SIP AUM months yet
                </div>
              )}
            </Card>

            <Card
              title="SIP Contributing Accounts Trend"
              subtitle={`Active SIP accounts · ${sipAccountsTrend.length} month${sipAccountsTrend.length === 1 ? "" : "s"} · ₹ Cr`}
            >
              {sipAccountsTrend.length > 0 ? (
                <BarSeries
                  data={sipAccountsTrend}
                  name="SIP Accounts"
                  color="hsl(var(--chart-3))"
                  valueFormat="crore-count"
                  axisFormat="crore-count"
                  labelFormat="month"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  No SIP accounts months yet
                </div>
              )}
            </Card>
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
            </p>
          </div>
          <Card
            title="Equity / Debt / Liquid Monthly Net Flows"
            subtitle={`${monthlyFlowsRows.length} month${monthlyFlowsRows.length === 1 ? "" : "s"} · ₹ Cr · positive = inflow, negative = outflow`}
          >
            <GroupedBars
              data={monthlyFlowsRows}
              xKey="month"
              labelFormat="month"
              valueFormat="cr"
              axisFormat="cr"
              bars={[
                { key: "equity", name: "Equity", color: "hsl(var(--chart-1))" },
                { key: "debt", name: "Debt", color: "hsl(var(--chart-2))" },
                { key: "liquid", name: "Liquid", color: "hsl(var(--chart-4))" },
              ]}
            />
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Liquid is shown separately for readability.
              <InfoTooltip label="In AMFI classification, Liquid is part of debt-oriented schemes." />
            </p>
          </Card>
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
              <Card
                title="Active Equity Net Inflows vs TTM Average"
                subtitle={`Monthly net inflow · ${activeEquityFlowTrend.length} month${activeEquityFlowTrend.length === 1 ? "" : "s"}${
                  activeEquityFlowAvg !== null
                    ? ` · trailing 12M avg ${formatCompactCrSafe(activeEquityFlowAvg)}`
                    : ""
                } · ₹ Cr`}
              >
                <BarSeries
                  data={activeEquityFlowTrend}
                  name="Active Equity Net Inflow"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                  referenceValue={activeEquityFlowAvg}
                  referenceLabel={
                    activeEquityFlowAvg !== null ? "TTM avg" : undefined
                  }
                />
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Dashed line = trailing 12-month average of net inflow.
                  <InfoTooltip label="Active-equity envelope = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
                </p>
              </Card>
            )}

            {activeEquityBridge.length > 0 && (
              <Card
                title="Active Equity AUM Bridge"
                subtitle={`${activeEquityBridge.length} month${activeEquityBridge.length === 1 ? "" : "s"} · ₹ Cr · net inflow vs market impact`}
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
              </Card>
            )}

            {sipAumShareTrend.length > 0 && (
              <Card
                title="SIP AUM as % of Total AUM"
                subtitle={`${sipAumShareTrend.length} month${sipAumShareTrend.length === 1 ? "" : "s"} · SIP AUM ÷ Total AUM`}
              >
                <BarSeries
                  data={sipAumShareTrend}
                  name="SIP AUM share"
                  color="hsl(var(--chart-2))"
                  valueFormat="pct"
                  axisFormat="pct"
                  labelFormat="month"
                />
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  SIP AUM as a share of total industry AUM.
                  <InfoTooltip label="SIP contribution share of gross inflows is intentionally omitted — gross inflows (Funds Mobilized) are only available on the quarterly disclosure, not in the monthly snapshot." />
                </p>
              </Card>
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
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Active Equity AAUM Trend"
              subtitle={`${activeEquityTrend.length} month${activeEquityTrend.length === 1 ? "" : "s"} · ₹ Cr · period-average`}
            >
              {activeEquityTrend.length > 0 ? (
                <BarSeries
                  data={activeEquityTrend}
                  name="Active Equity AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity AAUM unavailable
                </div>
              )}
            </Card>

            <Card
              title="Active Equity Share of Total AAUM"
              subtitle={`${activeEquityShareTrend.length} month${activeEquityShareTrend.length === 1 ? "" : "s"} · % of period-average Total AAUM`}
            >
              {activeEquityShareTrend.length > 0 ? (
                <BarSeries
                  data={activeEquityShareTrend}
                  name="Active Equity Share"
                  color="hsl(var(--chart-3))"
                  valueFormat="pct"
                  axisFormat="pct"
                  labelFormat="month"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity Share unavailable
                </div>
              )}
            </Card>
          </section>

          <Card
            title="Equity AAUM Breakdown"
            subtitle={equityBreakdownSubtitle}
          >
            {equityBreakdownHasData ? (
              <GroupedBars
                data={equityBreakdown}
                xKey="month"
                labelFormat="month"
                valueFormat="cr"
                axisFormat="cr"
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
              <InfoTooltip label="Active Equity = Growth/Equity schemes + Hybrid ex-Arbitrage + Solution-oriented schemes. ETF & Index = Index Funds + Other ETFs." />
            </p>
          </Card>
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
            <Card
              title="Active Equity vs ETF &amp; Index AUM"
              subtitle={`${activePassiveTrend.history.length} month${activePassiveTrend.history.length === 1 ? "" : "s"} · month-end AUM · ₹ Cr`}
            >
              <MultiLine
                data={activePassiveTrend.history.map((p) => ({
                  month: p.month,
                  active: p.activeEquityAum,
                  passive: p.etfIndexAum,
                }))}
                xKey="month"
                labelFormat="month"
                valueFormat="cr"
                axisFormat="cr"
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
                <InfoTooltip label="Active equity = equity-oriented + hybrid (ex-arbitrage) + solution-oriented. ETF & Index = Index Funds + Other ETFs (excludes Gold ETFs)." />
              </p>
            </Card>

            <Card
              title="Passive Share of Equity AUM"
              subtitle={
                activePassiveTrend.forecastMonths > 0 &&
                activePassiveTrend.endOfFyProjectionPct !== null
                  ? `Latest ${activePassiveTrend.latestSharePct.toFixed(2)}% · projected FY-end ${activePassiveTrend.endOfFyProjectionPct.toFixed(2)}% · slope ${activePassiveTrend.trendSlopePctPerMonth >= 0 ? "+" : ""}${activePassiveTrend.trendSlopePctPerMonth.toFixed(3)} pp/mo`
                  : `Latest ${activePassiveTrend.latestSharePct.toFixed(2)}%`
              }
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
            </Card>
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

      {iiflHeatmapHasData && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active-Equity Category Heatmap
            </h2>
            <p className="text-xs text-muted-foreground">
              Net inflow share of active equity categories · past 12
              months · Source: AMFI Monthly Report
            </p>
          </div>

          <IiflHeatmap
            months={iiflHeatmap.months}
            rows={iiflHeatmap.rows}
          />

          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Share = category net inflow ÷ active-equity net inflow.
            <InfoTooltip label="Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
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
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Folios"
              value={formatCroreCountSafe(industryFoliosLatest)}
              note=""
              noteHover={foliosHover ?? undefined}
            />
            <KpiCard
              label="Folio Additions"
              value={formatLakhSafe(industryFolioAdditionsLatest)}
              note=""
              noteHover={foliosHover ?? undefined}
            />
            <KpiCard
              label="NFO Launches"
              value={formatIntSafe(industryNfoCountLatest)}
              note=""
              noteHover={nfoCountHover ?? undefined}
            />
            <KpiCard
              label="NFO Funds Mobilized"
              value={formatCompactCrSafe(industryNfoFundsLatest)}
              note=""
              noteHover={nfoFundsHover ?? undefined}
            />
          </section>

          {hasAnyFolioOrNfoTrend && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card
                title="Folio Additions Trend"
                subtitle={`Net new folios per month · ${folioAdditionsTrend.length} month${folioAdditionsTrend.length === 1 ? "" : "s"} · lakh`}
              >
                {folioAdditionsTrend.length > 0 ? (
                  <BarSeries
                    data={folioAdditionsTrend}
                    name="Folio Additions"
                    color="hsl(var(--chart-4))"
                    valueFormat="lakh"
                    axisFormat="lakh"
                    labelFormat="month"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Need at least two consecutive months of folios
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={foliosHover ?? undefined}
                >
                  derived MoM Δ from industryFolios
                </div>
              </Card>

              <Card
                title="NFO Launches Trend"
                subtitle={`Open + close-ended schemes · ${nfoCountTrend.length} month${nfoCountTrend.length === 1 ? "" : "s"}`}
              >
                {nfoCountTrend.length > 0 ? (
                  <BarSeries
                    data={nfoCountTrend}
                    name="NFO Launches"
                    color="hsl(var(--chart-5))"
                    valueFormat="count"
                    axisFormat="count"
                    labelFormat="month"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    No NFO count months yet
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={nfoCountHover ?? undefined}
                >
                  {nfoCountSourceLine}
                </div>
              </Card>

              <Card
                title="NFO Funds Mobilized Trend"
                subtitle={`Funds raised during NFOs · ${nfoFundsTrend.length} month${nfoFundsTrend.length === 1 ? "" : "s"} · ₹ Cr`}
              >
                {nfoFundsTrend.length > 0 ? (
                  <BarSeries
                    data={nfoFundsTrend}
                    name="NFO Funds"
                    color="hsl(var(--chart-2))"
                    valueFormat="cr"
                    axisFormat="cr"
                    labelFormat="month"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    No NFO funds months yet
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={nfoFundsHover ?? undefined}
                >
                  {nfoFundsSourceLine}
                </div>
              </Card>
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

    </div>
  );
}
