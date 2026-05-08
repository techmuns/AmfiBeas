import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { industryMonthlyNote } from "@/lib/provenance";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { StackedArea } from "@/components/charts/StackedArea";
import { Donut, type DonutSlice } from "@/components/charts/Donut";
import { Heatmap, type HeatmapRow } from "@/components/charts/Heatmap";
import {
  aumMixForMonth,
  industryByMonth,
  latestMonth,
  marketShare,
  momChange,
  shareSeries,
  yoyChange,
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
  latestProvenanceFor,
  monthlyActiveEquityShareTrend,
  monthlyEquityBreakdown,
  monthlyFlowsData,
  monthlyTrend,
  resolveSelectedRow,
  type AmfiMonthlyKpiField,
} from "@/data/amfi-monthly";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MonthPicker } from "@/components/filters/MonthPicker";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatDelta,
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
  const fullShareAum = shareSeries("totalAum", 6, slugs);
  const fullShareSip = shareSeries("sipContribution", 6, slugs);
  const activeEquityShareSeries = shareSeries(
    "activeEquityAum",
    6,
    slugs
  );

  const trimmedMonths = new Set(trimMonths(MONTHS_LIST, filters.range));
  const series = fullSeries.filter((r) => trimmedMonths.has(r.month));
  const aumShareRows = fullShareAum.rows.filter((r) =>
    trimmedMonths.has(r.month as string)
  );
  const sipShareRows = fullShareSip.rows.filter((r) =>
    trimmedMonths.has(r.month as string)
  );
  const activeEquityShareRows = activeEquityShareSeries.rows.filter((r) =>
    trimmedMonths.has(r.month as string)
  );

  const latest = fullSeries[fullSeries.length - 1];
  const industryLatest = industrySeries[industrySeries.length - 1];

  const aumMom = momChange(fullSeries.map((m) => m.totalAum));
  const activeEquityYoy = yoyChange(
    fullSeries.map((m) => m.activeEquityAum)
  );
  const sipYoy = yoyChange(fullSeries.map((m) => m.sipContribution));
  const investorsYoy = yoyChange(
    fullSeries.map((m) => m.investorAdditions)
  );
  const foliosYoy = yoyChange(fullSeries.map((m) => m.folios));
  const nfoMom = momChange(fullSeries.map((m) => m.nfoCount));

  // Peer-vs-industry market share KPIs (only meaningful when filtered)
  const aumShareTotal = slugs
    ? marketShare(latest.totalAum, industryLatest.totalAum)
    : null;
  const activeEquityShareTotal = slugs
    ? marketShare(latest.activeEquityAum, industryLatest.activeEquityAum)
    : null;
  const sipShareTotal = slugs
    ? marketShare(latest.sipContribution, industryLatest.sipContribution)
    : null;

  const aumChartSeries = series.map((m) => ({
    month: m.month,
    value: m.totalAum,
  }));
  const sipChartSeries = series.map((m) => ({
    label: m.month,
    value: m.sipContribution,
  }));
  const investorsChartSeries = series.map((m) => ({
    label: m.month,
    value: m.investorAdditions,
  }));
  const nfoChartSeries = series.map((m) => ({
    label: m.month,
    value: m.nfoCount,
  }));

  // AUM Mix donut. Other Schemes is preserved as its own residual bucket.
  const AUM_MIX_COLORS: Record<string, string> = {
    activeEquity: "hsl(var(--chart-1))",
    passive: "hsl(var(--chart-5))",
    debt: "hsl(var(--chart-2))",
    liquid: "hsl(var(--chart-4))",
    hybrid: "hsl(var(--chart-3))",
    otherSchemes: "hsl(var(--muted-foreground))",
  };
  const aumMix = aumMixForMonth(latestMonth(), slugs);
  const aumMixSlices: DonutSlice[] = aumMix.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.aum,
    color: AUM_MIX_COLORS[s.key] ?? "hsl(var(--muted-foreground))",
  }));
  const aumMixHasData = aumMix.some((s) => s.aum > 0);

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

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

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
  // (activeEquityAum, etfIndexAum, arbitrageAum) extracted from the
  // AMFI Monthly Report. All cells are real per-month values; missing
  // months are omitted from each per-field series — never zero-filled.
  const activeEquityTrend = monthlyTrend("activeEquityAum", 24);
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
    latestProvenanceFor("activeEquityAum")
  );
  const etfIndexHover = formatKpiProvenanceTooltip(
    latestProvenanceFor("etfIndexAum")
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Monthly Operating" subtitle={subtitle} />
      <FilterBar showRange="monthly" />

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
              title="Active Equity AUM Trend"
              subtitle={`${activeEquityTrend.length} month${activeEquityTrend.length === 1 ? "" : "s"} · ₹ Cr · IIFL Figure 21-style`}
            >
              {activeEquityTrend.length > 0 ? (
                <BarSeries
                  data={activeEquityTrend}
                  name="Active Equity AUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="month"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Active Equity AUM unavailable
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
              title="Active Equity Share of Total AUM"
              subtitle={`${activeEquityShareTrend.length} month${activeEquityShareTrend.length === 1 ? "" : "s"} · % of month-end Total AUM`}
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
            title="Equity Breakdown Trend"
            subtitle={`${equityBreakdown.length} month${equityBreakdown.length === 1 ? "" : "s"} · ₹ Cr · grouped bars`}
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total AUM"
          value={formatCompactCrSafe(latest.totalAum)}
          delta={`${formatDelta(aumMom)} MoM`}
          trend={trend(aumMom)}
          note={demoIndustryNote}
        />
        <KpiCard
          label={slugs ? "AUM Share" : "Active Equity AUM"}
          value={
            slugs
              ? formatPctSafe(aumShareTotal, 2)
              : formatCompactCrSafe(latest.activeEquityAum)
          }
          delta={
            slugs ? undefined : `${formatDelta(activeEquityYoy)} YoY`
          }
          trend={slugs ? "flat" : trend(activeEquityYoy)}
          note={demoIndustryNote}
        />
        <KpiCard
          label={
            slugs ? "Active Equity Share" : "SIP Contribution"
          }
          value={
            slugs
              ? formatPctSafe(activeEquityShareTotal, 2)
              : formatCompactCrSafe(latest.sipContribution)
          }
          delta={slugs ? undefined : `${formatDelta(sipYoy)} YoY`}
          trend={slugs ? "flat" : trend(sipYoy)}
          note={demoIndustryNote}
        />
        <KpiCard
          label={slugs ? "SIP Share" : "Investor Additions"}
          value={
            slugs
              ? formatPctSafe(sipShareTotal, 2)
              : formatLakhSafe(latest.investorAdditions)
          }
          delta={slugs ? undefined : `${formatDelta(investorsYoy)} YoY`}
          trend={slugs ? "flat" : trend(investorsYoy)}
          note={demoIndustryNote}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {slugs && (
          <KpiCard
            label="Active Equity AUM"
            value={formatCompactCrSafe(latest.activeEquityAum)}
            delta={`${formatDelta(activeEquityYoy)} YoY`}
            trend={trend(activeEquityYoy)}
            note={demoIndustryNote}
          />
        )}
        {slugs && (
          <KpiCard
            label="SIP Contribution"
            value={formatCompactCrSafe(latest.sipContribution)}
            delta={`${formatDelta(sipYoy)} YoY`}
            trend={trend(sipYoy)}
            note={demoIndustryNote}
          />
        )}
        <KpiCard
          label="Folios"
          value={formatCroreCountSafe(latest.folios)}
          delta={`${formatDelta(foliosYoy)} YoY`}
          trend={trend(foliosYoy)}
          note={demoIndustryNote}
        />
        <KpiCard
          label="NFO Launches"
          value={formatIntSafe(latest.nfoCount)}
          delta={`${formatDelta(nfoMom)} MoM`}
          trend={trend(nfoMom)}
          note={demoIndustryNote}
        />
        {!slugs && (
          <KpiCard
            label="NFO AUM Collected"
            value={formatCompactCrSafe(latest.nfoAumCollected)}
            note={demoIndustryNote}
          />
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle={`Total AUM · ${demoIndustryNote}`}>
          <AreaTrend data={aumChartSeries} name="AUM" />
        </Card>
        <Card
          title="AUM Market Share"
          subtitle={`${slugs ? "Within selected peers" : "Top 6 + Others"} · ${demoIndustryNote}`}
        >
          <StackedArea
            data={aumShareRows}
            xKey="month"
            series={fullShareAum.keys.map((k) => ({
              key: k,
              name: amcLabel(k),
              color: AMC_COLORS[k] ?? "hsl(var(--muted-foreground))",
            }))}
          />
        </Card>
        <Card
          title="AUM Mix"
          subtitle="Latest month · category share"
          className="lg:col-span-2"
          action={
            <Link
              href="/other-schemes"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View Passive &amp; Other Schemes
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          }
        >
          {aumMixHasData ? (
            <Donut data={aumMixSlices} />
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              —
            </div>
          )}
        </Card>
        <Card title="SIP Flows" subtitle="Monthly inflows">
          <BarSeries data={sipChartSeries} name="SIP" />
        </Card>
        <Card
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
        <Card title="Investor Additions" subtitle="New folios per month">
          <BarSeries
            data={investorsChartSeries}
            valueFormat="lakh"
            axisFormat="lakh"
            color="hsl(var(--chart-4))"
            name="New investors"
          />
        </Card>
        <Card title="NFO Launches" subtitle="Count per month">
          <BarSeries
            data={nfoChartSeries}
            valueFormat="count"
            axisFormat="count"
            color="hsl(var(--chart-5))"
            name="NFOs"
          />
        </Card>
        <Card
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
          title="Scheme Outperformance"
          subtitle="AMC × month · % over benchmark, centered on 50"
          className="lg:col-span-2"
        >
          <Heatmap rows={heatmapRows} columns={heatmapColumns} />
        </Card>
        <Card
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
