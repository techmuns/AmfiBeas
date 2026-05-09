import { industryMonthlyNote } from "@/lib/provenance";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import { BarSeries } from "@/components/charts/BarSeries";
import { StackedArea } from "@/components/charts/StackedArea";
import { Donut, type DonutSlice } from "@/components/charts/Donut";
import { Heatmap, type HeatmapRow } from "@/components/charts/Heatmap";
import { IiflHeatmap } from "@/components/charts/IiflHeatmap";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  industryByMonth,
  latestMonth,
  marketShare,
  shareSeries,
} from "@/data/aggregate";
import { AMCS } from "@/data/amcs";
import { monthlyForAmc, MONTHS_LIST } from "@/data/generator";
import {
  amfiMonthlyRows,
  availableMonthsDesc,
  formatKpiProvenanceLine,
  formatKpiProvenanceTooltip,
  getKpiProvenance,
  getKpiValue,
  latestAmfiMonthlyRow,
  latestIndustryFolioAdditions,
  latestProvenanceFor,
  monthlyActiveEquityShareTrend,
  monthlyEquityBreakdown,
  monthlyFlowsData,
  monthlyIndustryFolioAdditionsTrend,
  monthlyTrend,
  resolveSelectedRow,
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
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MonthPicker } from "@/components/filters/MonthPicker";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
  formatPctSafe,
} from "@/lib/format";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";
import { cn } from "@/lib/cn";
import { parseFilters, selectedSlugs, trimMonths } from "@/lib/filter";

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const slugs = selectedSlugs(filters);

  // Filtered series (peer subset). Unfiltered industry series is needed
  // only when peer filter is active so we can compute market share %.
  const fullSeries = industryByMonth(slugs);
  const industrySeries = slugs ? industryByMonth(null) : fullSeries;
  // AUM Market Share is now sourced live from AMFI Fundwise AAUM via
  // amc-peer-universe.ts (see aumMarketShare below) — `shareSeries
  // ("totalAum", …)` is no longer needed because that demo card was
  // replaced with a live top-7 quarterly chart.
  const fullShareSip = shareSeries("sipContribution", 6, slugs);
  const activeEquityShareSeries = shareSeries(
    "activeEquityAum",
    6,
    slugs
  );

  const trimmedMonths = new Set(trimMonths(MONTHS_LIST, filters.range));
  const sipShareRows = fullShareSip.rows.filter((r) =>
    trimmedMonths.has(r.month as string)
  );
  const activeEquityShareRows = activeEquityShareSeries.rows.filter((r) =>
    trimmedMonths.has(r.month as string)
  );

  const latest = fullSeries[fullSeries.length - 1];
  const industryLatest = industrySeries[industrySeries.length - 1];

  // Peer-vs-industry market share KPIs (only meaningful when filtered).
  // Currently only sipShareTotal feeds a still-rendered demo card; the
  // AUM- and active-equity-share KPIs were retired with their cards.
  const sipShareTotal = slugs
    ? marketShare(latest.sipContribution, industryLatest.sipContribution)
    : null;

  const heatmapAmcs = slugs ? AMCS.filter((a) => slugs.includes(a.slug)) : AMCS;
  const heatmapRows: HeatmapRow[] = heatmapAmcs.map((a) => ({
    label: a.ticker ?? a.name.split(" ")[0],
    values: monthlyForAmc(a.slug)
      .filter((r) => trimmedMonths.has(r.month))
      .map((r) => {
        const v = r.schemeOutperformanceRatio;
        if (v === undefined || v === null) return null;
        // Center the heatmap colour scale around 50% (industry-typical
        // outperformance ratio). Negative = under, positive = over.
        return Number((v - 50).toFixed(1));
      }),
  }));
  const heatmapColumns = MONTHS_LIST.filter((m) => trimmedMonths.has(m));

  // Quartile-rank summary (top quartile %) for the latest month, peer-aware
  const quartileLatestRows = (slugs ? AMCS.filter((a) => slugs.includes(a.slug)) : AMCS).map(
    (a) => {
      const rec = monthlyForAmc(a.slug).find(
        (r) => r.month === latestMonth()
      );
      return {
        slug: a.slug,
        ticker: a.ticker ?? a.name.split(" ")[0],
        q1: rec?.quartileRankSummary?.q1 ?? null,
      };
    }
  );

  const subtitle = slugs
    ? `${slugs.length} peer${slugs.length > 1 ? "s" : ""} · ${latestMonth()}`
    : `Industry-wide · ${latestMonth()}`;
  const demoIndustryNote = industryMonthlyNote();

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
    ? "Industry-wide · live from uploaded AMFI PDFs"
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
      ? "Month-end Net AUM · share of Total AUM (residual = Other)"
      : mixHasData
        ? "Month-end Net AUM · partial breakdown · Other not computed"
        : "Month-end Net AUM not available for this month";

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
  const mixHoverProvenance = formatKpiProvenanceTooltip(
    getKpiProvenance(amfiSelected, "totalAum")
  );
  const trendHoverProvenance = formatKpiProvenanceTooltip(
    getKpiProvenance(amfiSelected, "totalAaum")
  );

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

  const sipContribHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("sipContribution")
  );
  const sipAumHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("sipAum")
  );
  const sipAccountsHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("sipAccounts")
  );

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
  const monthlyFlowsHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("debtNetInflow")
  );

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
  const activeEquityHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("activeEquityAaum")
  );
  const etfIndexHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("etfIndexAaum")
  );

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
  const foliosSourceLine =
    formatKpiProvenanceLine(latestProvenanceFor("industryFolios")) ??
    "Source: AMFI Monthly Report";
  const nfoCountSourceLine =
    formatKpiProvenanceLine(latestProvenanceFor("industryNfoCount")) ??
    "Source: AMFI Monthly Report";
  const nfoFundsSourceLine =
    formatKpiProvenanceLine(latestProvenanceFor("industryNfoFundsMobilized")) ??
    "Source: AMFI Monthly Report";

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
  const iiflHeatmapHover = formatKpiProvenanceTooltip(
    latestCategoryProvenance("flexi-cap", "categoryNetInflow")
  );

  // ---- AUM Market Share — live top 7 from AMFI Fundwise AAUM -------
  // Quarterly data on a monthly page: the source is intrinsically
  // quarterly (AMFI Fundwise AAUM disclosure) so the card label says
  // so. Same chart + helper are reused on /quarterly so the two
  // pages render an identical view.
  const aumMarketShare = topAumMarketShareSeries(7, 8);
  const aumMarketShareCoverage = aumMarketShare.coverage;

  return (
    <div className="space-y-6">
      <PageHeader title="Monthly Operating" subtitle={subtitle} />
      <FilterBar showRange="monthly" />

      {/* Data-status legend — quick visual key for the colorful (live)
          vs muted/dashed (demo) treatments used across the page. */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Data status:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-positive" />
          Live · sourced data
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm border border-dashed border-muted-foreground/60 bg-muted" />
          Demo · placeholder
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          Pending · not connected
        </span>
      </div>

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
              Live from uploaded AMFI PDFs
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={mixHoverProvenance ?? undefined}
              >
                Source: AMFI Monthly Report
              </div>
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={trendHoverProvenance ?? undefined}
              >
                Source: AMFI Monthly Report
              </div>
            </Card>
          </section>
        </div>
      )}

      {hasAnySipTrend && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">SIP Trends</h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Monthly Notes
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={sipContribHover ?? undefined}
              >
                Source: AMFI Monthly Note
              </div>
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={sipAumHover ?? undefined}
              >
                Source: AMFI Monthly Note
              </div>
            </Card>

            <Card
              title="SIP Contributing Accounts Trend"
              subtitle={`Active SIP accounts · ${sipAccountsTrend.length} month${sipAccountsTrend.length === 1 ? "" : "s"} · crore accounts`}
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={sipAccountsHover ?? undefined}
              >
                Source: AMFI Monthly Note
              </div>
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
              Live from uploaded AMFI Monthly Reports
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
            <p className="mt-3 text-[11px] text-muted-foreground">
              Liquid is shown separately; it is part of debt-oriented
              schemes in AMFI classification.
            </p>
            <div
              className="mt-2 text-[10px] tabular text-muted-foreground/80"
              title={monthlyFlowsHover ?? undefined}
            >
              Source: AMFI Monthly Report
            </div>
          </Card>
        </div>
      )}

      {hasAnyEquityMix && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Active Equity &amp; Equity Mix
            </h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Monthly Reports
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Active Equity AAUM Trend"
              subtitle={`${activeEquityTrend.length} month${activeEquityTrend.length === 1 ? "" : "s"} · ₹ Cr · IIFL Figure 21-style (period-average)`}
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={activeEquityHover ?? undefined}
              >
                Source: AMFI Monthly Report
              </div>
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
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={activeEquityHover ?? undefined}
              >
                Source: AMFI Monthly Report
              </div>
            </Card>
          </section>

          <Card
            title="Equity AAUM Breakdown"
            subtitle={`${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · ₹ Cr · period-average · grouped bars`}
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
            <p className="mt-3 text-[11px] text-muted-foreground">
              Active Equity = Growth/Equity schemes + Hybrid ex-Arbitrage +
              Solution-oriented schemes. ETF &amp; Index = Index Funds + Other
              ETFs. Arbitrage shown separately.
            </p>
            <div
              className="mt-2 text-[10px] tabular text-muted-foreground/80"
              title={etfIndexHover ?? undefined}
            >
              Source: AMFI Monthly Report
            </div>
          </Card>
        </div>
      )}

      {iiflTrendHasAny && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              IIFL Active-Equity Category Trends
            </h2>
            <p className="text-xs text-muted-foreground">
              QAAUM share vs net inflow share · active-equity envelope
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
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={c.aumHover ?? undefined}
                >
                  Source: AMFI Monthly Report
                </div>
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
                      <div
                        className="mt-3 text-[10px] tabular text-muted-foreground/80"
                        title={c.aumHover ?? undefined}
                      >
                        Source: AMFI Monthly Report
                      </div>
                    </Card>
                  ))}
                </section>
              </div>
            </details>
          )}

          <p className="text-[11px] text-muted-foreground">
            QAAUM share uses active-equity AAUM. Net inflow share uses
            active-equity net inflow. Active equity includes equity-
            oriented schemes, hybrid schemes excluding arbitrage, and
            solution-oriented schemes.
          </p>
        </div>
      )}

      {iiflHeatmapHasData && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              IIFL Active-Equity Heatmap
            </h2>
            <p className="text-xs text-muted-foreground">
              Net inflow share of active equity categories · past 12
              months
            </p>
          </div>

          <IiflHeatmap
            months={iiflHeatmap.months}
            rows={iiflHeatmap.rows}
          />

          <div
            className="text-[10px] tabular text-muted-foreground/80"
            title={iiflHeatmapHover ?? undefined}
          >
            Source: AMFI Monthly Report
          </div>
          <p className="text-[11px] text-muted-foreground">
            Note: Share is calculated as category net inflow divided by
            active-equity net inflow. Active equity includes equity-
            oriented schemes, hybrid schemes excluding arbitrage, and
            solution-oriented schemes.
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
              Live from uploaded AMFI Monthly Reports
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Folios"
              value={formatCroreCountSafe(industryFoliosLatest)}
              note={foliosSourceLine}
              noteHover={foliosHover ?? undefined}
            />
            <KpiCard
              label="Folio Additions"
              value={formatLakhSafe(industryFolioAdditionsLatest)}
              note={foliosSourceLine}
              noteHover={foliosHover ?? undefined}
            />
            <KpiCard
              label="NFO Launches"
              value={formatIntSafe(industryNfoCountLatest)}
              note={nfoCountSourceLine}
              noteHover={nfoCountHover ?? undefined}
            />
            <KpiCard
              label="NFO Funds Mobilized"
              value={formatCompactCrSafe(industryNfoFundsLatest)}
              note={nfoFundsSourceLine}
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
                  {foliosSourceLine} · derived MoM Δ from industryFolios
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

      {slugs && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            tone="demo"
            label="SIP Share"
            value={formatPctSafe(sipShareTotal, 2)}
            note={demoIndustryNote}
          />
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          title="AUM Market Share"
          subtitle={
            aumMarketShareCoverage
              ? `Top ${aumMarketShare.topAmcs.length} AMCs · quarterly AMFI Fundwise AAUM · ${aumMarketShareCoverage.quarterLabel}`
              : `Top ${aumMarketShare.topAmcs.length} AMCs · quarterly AMFI Fundwise AAUM`
          }
          className="lg:col-span-2"
        >
          {aumMarketShare.rows.length > 0 ? (
            <StackedArea
              data={aumMarketShare.rows}
              xKey="quarterLabel"
              labelFormat="none"
              series={aumMarketShare.topAmcs.map((a) => ({
                key: a.slug,
                name: amcLabel(a.slug),
                color: AMC_COLORS[a.slug] ?? "hsl(var(--muted-foreground))",
              }))}
            />
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              AAUM disclosure unavailable
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Coverage: top {aumMarketShare.topAmcs.length} shown from AMFI
            Fundwise AAUM disclosure; denominator uses currently stored
            AMCs
            {aumMarketShareCoverage
              ? ` (${aumMarketShareCoverage.storedAmcCount} AMCs, ` +
                `top ${aumMarketShare.topAmcs.length} cover ` +
                `${aumMarketShareCoverage.topNCoveragePct.toFixed(1)}% ` +
                `of stored AAUM)`
              : ""}
            .
          </p>
          <div className="mt-2 text-[10px] tabular text-muted-foreground/80">
            Source: AMFI Fundwise AAUM disclosure
          </div>
        </Card>
        <Card
          tone="demo"
          title="SIP Market Share"
          subtitle={slugs ? "Within selected peers" : "Top 6 + Others"}
        >
          <StackedArea
            data={sipShareRows}
            xKey="month"
            series={fullShareSip.keys.map((k) => ({
              key: k,
              name: amcLabel(k),
              color: AMC_COLORS[k] ?? "hsl(var(--muted-foreground))",
            }))}
          />
        </Card>
        <Card
          tone="demo"
          title="Active Equity Market Share"
          subtitle={slugs ? "Within selected peers" : "Top 6 + Others"}
          className="lg:col-span-2"
        >
          <StackedArea
            data={activeEquityShareRows}
            xKey="month"
            series={activeEquityShareSeries.keys.map((k) => ({
              key: k,
              name: amcLabel(k),
              color: AMC_COLORS[k] ?? "hsl(var(--muted-foreground))",
            }))}
          />
        </Card>
        <Card
          tone="demo"
          title="Scheme Outperformance"
          subtitle="AMC × month · % over benchmark, centered on 50"
          className="lg:col-span-2"
        >
          <Heatmap rows={heatmapRows} columns={heatmapColumns} />
        </Card>
        <Card
          tone="demo"
          title="Top Quartile %"
          subtitle="Share of AMC funds ranked Q1 · latest month"
          className="lg:col-span-2"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {quartileLatestRows.map((r) => (
              <div
                key={r.slug}
                className="rounded-md border px-3 py-2"
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {r.ticker}
                </div>
                <div className="mt-1 text-lg font-semibold tabular">
                  {formatPctSafe(r.q1)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
