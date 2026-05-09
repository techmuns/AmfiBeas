import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  iiflActiveEquityQuarterlyTrendCard,
  latestCategoryProvenance,
} from "@/data/amfi-monthly-category";
import { formatKpiProvenanceTooltip } from "@/data/amfi-monthly";
import {
  formatQuarterlyProvenanceTooltip,
  latestIndustryProvenance,
  latestQuarterlyCategoryProvenance,
  quarterlyActiveEquityGrossFlowsData,
  quarterlyCategoryGrossFlowData,
  quarterlyGrossFlowsData,
} from "@/data/amfi-quarterly";
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

/** Optional per-category cards. Mirrors the four IIFL Figure 31-34
 *  reference categories surfaced on /monthly so the quarterly view
 *  gives a familiar drilldown. */
const CATEGORY_FLOW_CARDS: { slug: AmfiMonthlyCategorySlug; label: string }[] = [
  { slug: "flexi-cap", label: "Flexi Cap Fund" },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund" },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds" },
  { slug: "large-cap", label: "Large Cap Fund" },
];

export default function QuarterlyPage() {
  // Per-category quarterly series. Helper buckets months into Indian
  // fiscal quarters and applies the same active-equity envelope
  // denominators as the /monthly heatmap (NOT major-category, NOT
  // industry totals). Latest quarter labelled "{N}QFY{YY} TD" when
  // fewer than 3 months ingested.
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
  const hasAny = trendCards.some((c) => c.hasData);
  const hasExpanded = expandedCards.some((c) => c.hasData);

  // -------- Quarterly Gross Flows section (PR #64 quarterly PDFs) ------
  // These charts use the AMFI quarterly Report PDFs (gross funds
  // mobilized + repurchase + net inflow are 3-month sums) and sit
  // BELOW the IIFL trend cards above. The IIFL section keeps using
  // monthly aggregation for true QAAUM share — quarterly LastMonthAaum
  // fields are intentionally NOT consumed here.
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

  return (
    <div className="space-y-6">
      <PageHeader title="Quarterly KPIs" />

      {hasAny ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              IIFL Active-Equity Category Trends
            </h2>
            <p className="text-xs text-muted-foreground">
              QAAUM share vs net inflow share · quarterly view
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

          {hasExpanded && (
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

      {/* Quarterly Gross Flows — sourced from AMFI quarterly PDFs.
          Independent of the IIFL section above; renders even if the
          monthly-aggregated IIFL trends are unavailable. */}
      {(hasIndustryGross || hasActiveEquityGross) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Gross Flows
            </h2>
            <p className="text-xs text-muted-foreground">
              Funds mobilized, repurchase/redemption and net inflow ·
              sourced from AMFI quarterly reports
            </p>
          </div>

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
            from the AMFI quarterly Report PDF Grand Total / Sub Total
            rows. Active-Equity gross flows sum Sub II, Sub III less the
            Arbitrage Fund row, and Sub IV — the same envelope used by
            IIFL Figure 19-22. The quarterly PDF&rsquo;s Average Net AUM
            column is last-month AAUM, so QAAUM-share charts above
            continue to use monthly aggregation.
          </p>
        </div>
      )}

      {!hasIndustryGross && !hasActiveEquityGross && (
        <Card title="Quarterly Gross Flows">
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Quarterly PDF data unavailable
          </div>
        </Card>
      )}
    </div>
  );
}
