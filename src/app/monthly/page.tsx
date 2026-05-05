import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { StackedArea } from "@/components/charts/StackedArea";
import { Heatmap, type HeatmapRow } from "@/components/charts/Heatmap";
import {
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
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatDelta,
  formatIntSafe,
  formatLakhSafe,
  formatPctSafe,
} from "@/lib/format";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";
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

  return (
    <div className="space-y-6">
      <PageHeader title="Monthly Operating" subtitle={subtitle} />
      <FilterBar showRange="monthly" />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total AUM"
          value={formatCompactCrSafe(latest.totalAum)}
          delta={`${formatDelta(aumMom)} MoM`}
          trend={trend(aumMom)}
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
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {slugs && (
          <KpiCard
            label="Active Equity AUM"
            value={formatCompactCrSafe(latest.activeEquityAum)}
            delta={`${formatDelta(activeEquityYoy)} YoY`}
            trend={trend(activeEquityYoy)}
          />
        )}
        {slugs && (
          <KpiCard
            label="SIP Contribution"
            value={formatCompactCrSafe(latest.sipContribution)}
            delta={`${formatDelta(sipYoy)} YoY`}
            trend={trend(sipYoy)}
          />
        )}
        <KpiCard
          label="Folios"
          value={formatCroreCountSafe(latest.folios)}
          delta={`${formatDelta(foliosYoy)} YoY`}
          trend={trend(foliosYoy)}
        />
        <KpiCard
          label="NFO Launches"
          value={formatIntSafe(latest.nfoCount)}
          delta={`${formatDelta(nfoMom)} MoM`}
          trend={trend(nfoMom)}
        />
        {!slugs && (
          <KpiCard
            label="NFO AUM Collected"
            value={formatCompactCrSafe(latest.nfoAumCollected)}
          />
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Total AUM">
          <AreaTrend data={aumChartSeries} name="AUM" />
        </Card>
        <Card
          title="AUM Market Share"
          subtitle={slugs ? "Within selected peers" : "Top 6 + Others"}
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
