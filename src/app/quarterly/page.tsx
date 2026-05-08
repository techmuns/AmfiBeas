import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  IIFL_ACTIVE_EQUITY_CATEGORIES,
  IIFL_TREND_EXPANDED_SLUGS,
  IIFL_TREND_FEATURED_SLUGS,
  iiflActiveEquityQuarterlyTrendCard,
  latestCategoryProvenance,
} from "@/data/amfi-monthly-category";
import { formatKpiProvenanceTooltip } from "@/data/amfi-monthly";

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
    </div>
  );
}
