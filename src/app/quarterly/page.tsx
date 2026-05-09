import { BarSeries } from "@/components/charts/BarSeries";
import { Donut, type DonutSlice } from "@/components/charts/Donut";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  iiflActiveEquityQuarterlyTrendCard,
  latestCategoryProvenance,
} from "@/data/amfi-monthly-category";
import { formatKpiProvenanceTooltip } from "@/data/amfi-monthly";
import {
  formatQuarterlyProvenanceLine,
  formatQuarterlyProvenanceTooltip,
  getQuarterlyKpiProvenance,
  getQuarterlyKpiValue,
  latestIndustryProvenance,
  latestOpenEndedSchemeCount,
  latestQuarterlyCategoryProvenance,
  latestQuarterlyFolioAdditions,
  latestQuarterlyRow,
  quarterlyActiveEquityGrossFlowsData,
  quarterlyCategoryGrossFlowData,
  quarterlyFolioAdditionsTrend,
  quarterlyGrossFlowsData,
  quarterlyOpenEndedSchemeCountTrend,
  quarterlyTrend,
  type AmfiQuarterlyKpiField,
} from "@/data/amfi-quarterly";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
} from "@/lib/format";
import type { AmfiMonthlyCategorySlug } from "@/data/snapshots/types";

const GROSS_FLOW_BARS = [
  {
    key: "fundsMobilized",
    name: "Funds mobilized",
    color: "hsl(var(--chart-2))",
  },
  {
    key: "repurchase",
    name: "Repurchase / Redemption",
    color: "hsl(var(--chart-6))",
  },
  { key: "netInflow", name: "Net inflow", color: "hsl(var(--chart-1))" },
];

/** The four IIFL Figure 31-34 reference categories surfaced as the
 *  per-category drilldown — same set as /monthly's CATEGORY_DISPLAY so
 *  the quarterly view feels consistent across surfaces. */
const CATEGORY_FLOW_CARDS: { slug: AmfiMonthlyCategorySlug; label: string }[] = [
  { slug: "flexi-cap", label: "Flexi Cap Fund" },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund" },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds" },
  { slug: "large-cap", label: "Large Cap Fund" },
];

/** Sign-aware compact ₹ Cr formatter. The standard formatCompactCrSafe
 *  only handles positive values via its compact suffixes; for negative
 *  net-flow figures we render the magnitude with the same suffix and a
 *  leading minus so signs are obvious in the KPI grid. */
function formatSignedCompactCrSafe(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

export default function QuarterlyPage() {
  // ---- IIFL Active-Equity Category Trends (UNCHANGED from PR #61) ----
  // Per-category quarterly series. Helper buckets MONTHS into Indian
  // fiscal quarters and applies the same active-equity envelope
  // denominators as the /monthly heatmap (NOT major-category, NOT
  // industry totals). Latest quarter labelled "{N}QFY{YY} TD" when
  // fewer than 3 months ingested. Source remains AMFI Monthly Report
  // because true QAAUM share requires period-average AAUM, which the
  // quarterly PDF does NOT provide (its Average Net AUM column is
  // last-month AAUM only).
  const trendCards = IIFL_ACTIVE_EQUITY_CATEGORIES.map((c) => {
    const { series, hasData } = iiflActiveEquityQuarterlyTrendCard(c.slug);
    const aumHover = formatKpiProvenanceTooltip(
      latestCategoryProvenance(c.slug, "categoryAaum")
    );
    return { ...c, series, hasData, aumHover };
  });
  const trendBySlug = new Map(trendCards.map((c) => [c.slug, c]));
  const featuredCards = IIFL_TREND_FEATURED_SLUGS.map(
    (s) => trendBySlug.get(s)!
  );
  const expandedCards = IIFL_TREND_EXPANDED_SLUGS.map(
    (s) => trendBySlug.get(s)!
  );
  const hasAnyIifl = trendCards.some((c) => c.hasData);
  const hasExpandedIifl = expandedCards.some((c) => c.hasData);

  // ---- AMFI Quarterly Snapshot (KPI cards) ---------------------------
  // Mirrors /monthly's AMFI Monthly Snapshot: same Card chrome, same
  // KPI card grid, same source caption. Renders one KPI card per field
  // the latest quarterly row carries. SIP fields are intentionally
  // omitted because they come from AMFI Monthly Notes, not the
  // Quarterly Report — replicating them here would mis-source the
  // value. Total AUM, Last-month AAUM, Equity / Debt / Hybrid / Other
  // Schemes AUM, plus the three flow fields and Folios are all
  // sourced directly from the Grand Total + Sub Total rows of the
  // quarterly report.
  const quarterlyLatest = latestQuarterlyRow();
  const quarterlySectionSubtitle = quarterlyLatest
    ? `Industry-wide · live from uploaded AMFI Quarterly Report PDFs · ${quarterlyLatest.quarterLabel}`
    : "Upload AMFI Quarterly PDFs to manual-data/amfi-quarterly/pdfs/, then run npm run ingest:amfi-quarterly-pdf";

  const QUARTERLY_KPI_CARDS: {
    field: AmfiQuarterlyKpiField;
    label: string;
    format: (v: number | null) => string;
  }[] = [
    { field: "grandTotalAum", label: "Total AUM", format: formatCompactCrSafe },
    {
      field: "grandTotalLastMonthAaum",
      label: "Last-month AAUM",
      format: formatCompactCrSafe,
    },
    { field: "equityAum", label: "Equity AUM", format: formatCompactCrSafe },
    { field: "debtAum", label: "Debt AUM", format: formatCompactCrSafe },
    { field: "hybridAum", label: "Hybrid AUM", format: formatCompactCrSafe },
    {
      field: "otherSchemesAum",
      label: "Other Schemes AUM",
      format: formatCompactCrSafe,
    },
    {
      field: "grandTotalNetInflow",
      label: "Net Inflow",
      format: formatSignedCompactCrSafe,
    },
    {
      field: "grandTotalFundsMobilized",
      label: "Funds Mobilized",
      format: formatCompactCrSafe,
    },
    {
      field: "grandTotalRepurchase",
      label: "Repurchase / Redemption",
      format: formatCompactCrSafe,
    },
    {
      field: "grandTotalFolios",
      label: "Folios",
      format: (v: number | null) => formatCroreCountSafe(v),
    },
  ];
  const quarterlyKpiCards = QUARTERLY_KPI_CARDS.flatMap((spec) => {
    const value = getQuarterlyKpiValue(quarterlyLatest, spec.field);
    if (value === null) return [];
    const provenance = getQuarterlyKpiProvenance(quarterlyLatest, spec.field);
    return [
      {
        ...spec,
        value,
        formatted: spec.format(value),
        note: formatQuarterlyProvenanceLine(provenance) ?? "",
        noteHover: formatQuarterlyProvenanceTooltip(provenance) ?? undefined,
      },
    ];
  });

  // ---- AMFI Quarterly AUM Mix & Trend --------------------------------
  // Donut + Last-month AAUM trend, mirroring /monthly's AMFI AUM Mix &
  // Trend. The Donut is built from the four major-category sub-totals
  // (Equity / Debt / Hybrid / Other Schemes) on the latest row; a
  // residual "Other" slice is added when the four parts plus any
  // implicit Solution-Oriented bucket would otherwise sum to less
  // than `grandTotalAum`. Solution-Oriented is intermediate-only on
  // the schema; we therefore compute the residual against grandTotalAum
  // and surface anything > 0.
  const mixEquity = quarterlyLatest?.equityAum ?? null;
  const mixDebt = quarterlyLatest?.debtAum ?? null;
  const mixHybrid = quarterlyLatest?.hybridAum ?? null;
  const mixOther = quarterlyLatest?.otherSchemesAum ?? null;
  const mixGrand = quarterlyLatest?.grandTotalAum ?? null;
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
  if (typeof mixHybrid === "number") {
    mixSlices.push({
      key: "hybrid",
      label: "Hybrid",
      value: mixHybrid,
      color: "hsl(var(--chart-3))",
    });
  }
  if (typeof mixOther === "number") {
    mixSlices.push({
      key: "otherSchemes",
      label: "Other Schemes",
      value: mixOther,
      color: "hsl(var(--chart-4))",
    });
  }
  // Residual = grandTotalAum − (equity + debt + hybrid + otherSchemes).
  // The intermediate-only Solution-Oriented bucket lands here.
  // Computed only when ALL four sub-categories AND grandTotalAum are
  // present. Suppressed when ≤ 0 (a wash or implies extraction noise).
  let residual: number | null = null;
  if (
    typeof mixEquity === "number" &&
    typeof mixDebt === "number" &&
    typeof mixHybrid === "number" &&
    typeof mixOther === "number" &&
    typeof mixGrand === "number"
  ) {
    const sumKnown = mixEquity + mixDebt + mixHybrid + mixOther;
    const r = mixGrand - sumKnown;
    if (r > 0) {
      residual = r;
      mixSlices.push({
        key: "residual",
        label: "Solution / Close-ended",
        value: r,
        color: "hsl(var(--muted-foreground))",
      });
    }
  }
  const mixHasData = mixSlices.length > 0;
  const mixSubtitle =
    mixHasData && residual !== null
      ? `Quarter-end Net AUM · share of Total AUM · residual = Solution-Oriented + close-ended schemes · ${quarterlyLatest?.quarterLabel ?? ""}`
      : mixHasData
        ? `Quarter-end Net AUM · partial breakdown · residual not computed · ${quarterlyLatest?.quarterLabel ?? ""}`
        : "Quarter-end Net AUM not available for the latest quarter";
  const mixHoverProvenance = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(quarterlyLatest, "grandTotalAum")
  );

  // Last-month AAUM trend across the 8 ingested quarters. Labelled
  // "Last-month AAUM" so consumers don't mistake it for a true
  // 3-month period average — that semantics is reserved for the
  // monthly snapshot.
  const aaumTrendData = quarterlyTrend("grandTotalLastMonthAaum", 8);
  const aaumTrendHasData = aaumTrendData.length > 0;
  const aaumTrendSubtitle = aaumTrendHasData
    ? `Last-month AAUM · ${aaumTrendData.length} quarter${aaumTrendData.length === 1 ? "" : "s"} · ₹ Cr`
    : "Last-month AAUM not available";
  const aaumTrendHoverProvenance = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalLastMonthAaum")
  );

  // ---- Quarterly Gross Flows -----------------------------------------
  const industryGrossFlows = quarterlyGrossFlowsData();
  const activeEquityGrossFlows = quarterlyActiveEquityGrossFlowsData();
  const hasIndustryGross = industryGrossFlows.some(
    (r) =>
      r.fundsMobilized !== null ||
      r.repurchase !== null ||
      r.netInflow !== null
  );
  const hasActiveEquityGross = activeEquityGrossFlows.some(
    (r) =>
      r.fundsMobilized !== null ||
      r.repurchase !== null ||
      r.netInflow !== null
  );
  const industryFundsHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalFundsMobilized")
  );
  const activeEquityHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("equityFundsMobilized")
  );
  // KPI cards for the Gross Flows section — quick-read summary of the
  // latest quarter so the user can see the headline numbers without
  // scanning the bar charts.
  const latestFundsMobilized = quarterlyLatest?.grandTotalFundsMobilized ?? null;
  const latestRepurchase = quarterlyLatest?.grandTotalRepurchase ?? null;
  const latestNetInflow = quarterlyLatest?.grandTotalNetInflow ?? null;
  const latestActiveEquityNetInflow =
    quarterlyLatest?.activeEquityNetInflow ?? null;
  const grossFlowsSourceLine =
    formatQuarterlyProvenanceLine(
      latestIndustryProvenance("grandTotalFundsMobilized")
    ) ?? "Source: AMFI Quarterly Report";
  const repurchaseHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalRepurchase")
  );
  const netInflowHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalNetInflow")
  );
  const activeEquityNetInflowHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("activeEquityNetInflow")
  );

  const categoryFlowCards = CATEGORY_FLOW_CARDS.map((c) => {
    const data = quarterlyCategoryGrossFlowData(c.slug);
    const hasData = data.some(
      (r) =>
        r.fundsMobilized !== null ||
        r.repurchase !== null ||
        r.netInflow !== null
    );
    const hover = formatQuarterlyProvenanceTooltip(
      latestQuarterlyCategoryProvenance(c.slug, "categoryFundsMobilized")
    );
    return { ...c, data, hasData, hover };
  });
  const hasCategoryGross = categoryFlowCards.some((c) => c.hasData);

  // ---- Quarterly Folios & Scheme Count -------------------------------
  // grandTotalFolios is industry-wide (open + close + interval).
  // Folio additions QoQ are derived from consecutive grandTotalFolios.
  // Open-ended scheme count is derived from the sum of categorySchemes
  // across the 39 open-ended slugs the extractor captures (close-ended
  // and interval scheme counts aren't surfaced by the schema, so the
  // KPI label is "Open-Ended Scheme Count" — basis is explicit). All
  // three trends are clamped to the latest 8 quarters.
  const totalFolios = quarterlyLatest?.grandTotalFolios ?? null;
  const folioAdditions = latestQuarterlyFolioAdditions();
  const openEndedSchemes = latestOpenEndedSchemeCount();
  const foliosTrend = quarterlyTrend("grandTotalFolios", 8);
  const folioAdditionsTrend = quarterlyFolioAdditionsTrend(8);
  const schemesTrend = quarterlyOpenEndedSchemeCountTrend(8);
  const foliosHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalFolios")
  );
  const foliosSourceLine =
    formatQuarterlyProvenanceLine(
      latestIndustryProvenance("grandTotalFolios")
    ) ?? "Source: AMFI Quarterly Report";
  const hasAnyFolioKpi =
    totalFolios !== null || folioAdditions !== null || openEndedSchemes !== null;
  const hasAnyFolioTrend =
    foliosTrend.length > 0 ||
    folioAdditionsTrend.length > 0 ||
    schemesTrend.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quarterly KPIs"
        subtitle={
          quarterlyLatest
            ? `Industry-wide · ${quarterlyLatest.quarterLabel}`
            : undefined
        }
      />

      {/* IIFL Active-Equity Category Trends — UNCHANGED. Still uses the
          monthly snapshot for true QAAUM share; the quarterly PDF's
          Average Net AUM column is last-month AAUM only and would
          mis-state QAAUM share if substituted. */}
      {hasAnyIifl ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              IIFL Active-Equity Category Trends
            </h2>
            <p className="text-xs text-muted-foreground">
              QAAUM share vs net inflow share · quarterly view ·
              aggregated from AMFI Monthly Reports
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            {featuredCards.map((c) => (
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
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={c.aumHover ?? undefined}
                >
                  Source: AMFI Monthly Report
                </div>
              </Card>
            ))}
          </section>

          {hasExpandedIifl && (
            <details className="group rounded-md border border-dashed border-border bg-muted/20">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium tracking-tight marker:hidden">
                <span className="inline-flex items-center gap-2">
                  <span className="text-foreground">
                    Show more active-equity categories
                  </span>
                  <span className="rounded-full border border-border bg-background px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {expandedCards.length} more
                  </span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">
                    ›
                  </span>
                </span>
              </summary>
              <div className="border-t border-border/60 p-4">
                <section className="grid gap-4 lg:grid-cols-2">
                  {expandedCards.map((c) => (
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
      ) : (
        <Card title="IIFL Active-Equity Category Trends">
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Quarterly active-equity envelope data unavailable
          </div>
        </Card>
      )}

      {/* AMFI Quarterly Snapshot — KPI overview from the latest
          quarterly Report. Mirrors /monthly's AMFI Monthly Snapshot. */}
      <Card
        title="AMFI Quarterly Snapshot"
        subtitle={quarterlySectionSubtitle}
        action={
          <span
            className={
              quarterlyLatest
                ? "shrink-0 rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-positive"
                : "shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            }
          >
            {quarterlyLatest ? "Live" : "Not connected"}
          </span>
        }
      >
        {quarterlyKpiCards.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {quarterlyKpiCards.map((c) => (
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
            No AMFI quarterly PDF data ingested yet.
          </div>
        )}
      </Card>

      {/* AMFI Quarterly AUM Mix & Trend — Donut + Last-month AAUM
          trend across 8 quarters. */}
      {quarterlyLatest && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              AMFI Quarterly AUM Mix &amp; Trend
            </h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Quarterly Report PDFs
            </p>
          </div>
          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Quarter-end AUM Mix" subtitle={mixSubtitle}>
              {mixHasData ? (
                <Donut data={mixSlices} />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Mix unavailable · sub-category AUM not in the latest
                  quarter
                </div>
              )}
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={mixHoverProvenance ?? undefined}
              >
                Source: AMFI Quarterly Report
              </div>
            </Card>
            <Card
              title="Last-month AAUM Trend"
              subtitle={aaumTrendSubtitle}
            >
              {aaumTrendHasData ? (
                <BarSeries
                  data={aaumTrendData}
                  name="Last-month AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="none"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Last-month AAUM unavailable
                </div>
              )}
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={aaumTrendHoverProvenance ?? undefined}
              >
                Source: AMFI Quarterly Report · Average Net AUM column
                is last-month only — not a true quarterly average
              </div>
            </Card>
          </section>
        </div>
      )}

      {/* Quarterly Gross Flows — KPI summary + bar charts. */}
      {(hasIndustryGross || hasActiveEquityGross) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Gross Flows
            </h2>
            <p className="text-xs text-muted-foreground">
              Funds mobilized, repurchase / redemption and net inflow ·
              sourced from AMFI Quarterly Reports
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Industry Funds Mobilized"
              value={formatCompactCrSafe(latestFundsMobilized)}
              note={grossFlowsSourceLine}
              noteHover={industryFundsHover ?? undefined}
            />
            <KpiCard
              label="Industry Repurchase / Redemption"
              value={formatCompactCrSafe(latestRepurchase)}
              note={grossFlowsSourceLine}
              noteHover={repurchaseHover ?? undefined}
            />
            <KpiCard
              label="Industry Net Inflow"
              value={formatSignedCompactCrSafe(latestNetInflow)}
              note={grossFlowsSourceLine}
              noteHover={netInflowHover ?? undefined}
            />
            <KpiCard
              label="Active-Equity Net Inflow"
              value={formatSignedCompactCrSafe(latestActiveEquityNetInflow)}
              note={grossFlowsSourceLine}
              noteHover={activeEquityNetInflowHover ?? undefined}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {hasIndustryGross && (
              <Card
                title="Industry Gross Flows"
                subtitle={`${industryGrossFlows.length} quarter${industryGrossFlows.length === 1 ? "" : "s"} · ₹ Cr`}
              >
                <GroupedBars
                  data={industryGrossFlows}
                  xKey="quarterLabel"
                  bars={GROSS_FLOW_BARS}
                  labelFormat="none"
                  valueFormat="cr"
                  axisFormat="cr"
                />
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={industryFundsHover ?? undefined}
                >
                  Source: AMFI Quarterly Report
                </div>
              </Card>
            )}

            {hasActiveEquityGross && (
              <Card
                title="Active-Equity Gross Flows"
                subtitle={`${activeEquityGrossFlows.length} quarter${activeEquityGrossFlows.length === 1 ? "" : "s"} · ₹ Cr · Sub II + (Sub III − Arbitrage) + Sub IV`}
              >
                <GroupedBars
                  data={activeEquityGrossFlows}
                  xKey="quarterLabel"
                  bars={GROSS_FLOW_BARS}
                  labelFormat="none"
                  valueFormat="cr"
                  axisFormat="cr"
                />
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={activeEquityHover ?? undefined}
                >
                  Source: AMFI Quarterly Report
                </div>
              </Card>
            )}
          </section>

          {hasCategoryGross && (
            <section className="grid gap-4 lg:grid-cols-2">
              {categoryFlowCards.map((c) => (
                <Card
                  key={c.slug}
                  title={c.label}
                  subtitle={`${c.data.length} quarter${c.data.length === 1 ? "" : "s"} · ₹ Cr`}
                >
                  {c.hasData ? (
                    <GroupedBars
                      data={c.data}
                      xKey="quarterLabel"
                      bars={GROSS_FLOW_BARS}
                      labelFormat="none"
                      valueFormat="cr"
                      axisFormat="cr"
                      height={220}
                    />
                  ) : (
                    <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
                      Category data unavailable
                    </div>
                  )}
                  <div
                    className="mt-3 text-[10px] tabular text-muted-foreground/80"
                    title={c.hover ?? undefined}
                  >
                    Source: AMFI Quarterly Report
                  </div>
                </Card>
              ))}
            </section>
          )}

          <p className="text-[11px] text-muted-foreground">
            Funds mobilized + repurchase + net inflow are 3-month sums
            from the AMFI Quarterly Report Grand Total / Sub Total
            rows. Active-Equity gross flows sum Sub II, Sub III less
            the Arbitrage Fund row, and Sub IV — the same envelope used
            by IIFL Figure 19-22. The quarterly PDF&rsquo;s Average Net
            AUM column is last-month AAUM, so the QAAUM-share charts
            above continue to use monthly aggregation.
          </p>
        </div>
      )}

      {/* Quarterly Folios & Scheme Count. */}
      {(hasAnyFolioKpi || hasAnyFolioTrend) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Folios &amp; Scheme Count
            </h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Quarterly Report PDFs
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="Total Folios"
              value={formatCroreCountSafe(totalFolios)}
              note={foliosSourceLine}
              noteHover={foliosHover ?? undefined}
            />
            <KpiCard
              label="Folio Additions QoQ"
              value={formatLakhSafe(folioAdditions)}
              note={foliosSourceLine}
              noteHover={
                foliosHover
                  ? `${foliosHover} · derived QoQ Δ from grandTotalFolios`
                  : undefined
              }
            />
            <KpiCard
              label="Open-Ended Scheme Count"
              value={formatIntSafe(openEndedSchemes)}
              note="Source: AMFI Quarterly Report"
              noteHover="AMFI Quarterly Report · Sum of categorySchemes across 39 open-ended categories (close-ended + interval excluded)"
            />
          </section>

          {hasAnyFolioTrend && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card
                title="Folios Trend"
                subtitle={`Industry-wide · ${foliosTrend.length} quarter${foliosTrend.length === 1 ? "" : "s"} · crore folios`}
              >
                {foliosTrend.length > 0 ? (
                  <BarSeries
                    data={foliosTrend}
                    name="Folios"
                    color="hsl(var(--chart-1))"
                    valueFormat="crore-count"
                    axisFormat="crore-count"
                    labelFormat="none"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Folios unavailable
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={foliosHover ?? undefined}
                >
                  Source: AMFI Quarterly Report
                </div>
              </Card>

              <Card
                title="Folio Additions Trend"
                subtitle={`Net new folios per quarter · ${folioAdditionsTrend.length} quarter${folioAdditionsTrend.length === 1 ? "" : "s"} · lakh`}
              >
                {folioAdditionsTrend.length > 0 ? (
                  <BarSeries
                    data={folioAdditionsTrend}
                    name="Folio Additions"
                    color="hsl(var(--chart-4))"
                    valueFormat="lakh"
                    axisFormat="lakh"
                    labelFormat="none"
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
                  Source: AMFI Quarterly Report · derived QoQ Δ
                </div>
              </Card>

              <Card
                title="Open-Ended Scheme Count Trend"
                subtitle={`Sum across 39 open-ended categories · ${schemesTrend.length} quarter${schemesTrend.length === 1 ? "" : "s"}`}
              >
                {schemesTrend.length > 0 ? (
                  <BarSeries
                    data={schemesTrend}
                    name="Open-Ended Schemes"
                    color="hsl(var(--chart-5))"
                    valueFormat="count"
                    axisFormat="count"
                    labelFormat="none"
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
                  Source: AMFI Quarterly Report · derived from categorySchemes
                </div>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
