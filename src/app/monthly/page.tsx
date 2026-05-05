import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { StackedArea } from "@/components/charts/StackedArea";
import { Heatmap, type HeatmapRow } from "@/components/charts/Heatmap";
import {
  industryByMonth,
  latestMonth,
  momChange,
  shareSeries,
  yoyChange,
} from "@/data/aggregate";
import { AMCS } from "@/data/amcs";
import { monthlyForAmc, MONTHS_LIST } from "@/data/generator";
import { formatINR, formatDelta } from "@/lib/format";
import { AMC_COLORS, amcLabel } from "@/lib/chart-meta";

export default function MonthlyPage() {
  const series = industryByMonth();
  const latest = series[series.length - 1];

  const aumMom = momChange(series.map((m) => m.aum));
  const equityYoy = yoyChange(series.map((m) => m.equityAum));
  const sipYoy = yoyChange(series.map((m) => m.sipFlow));
  const investorsYoy = yoyChange(series.map((m) => m.newInvestors));
  const nfoMom = momChange(series.map((m) => m.nfoCount));

  const aumSeries = series.map((m) => ({ month: m.month, value: m.aum }));
  const sipSeries = series.map((m) => ({ label: m.month, value: m.sipFlow }));
  const investorsSeries = series.map((m) => ({
    label: m.month,
    value: m.newInvestors,
  }));
  const nfoSeries = series.map((m) => ({ label: m.month, value: m.nfoCount }));

  const aumShare = shareSeries("aum", 6);
  const sipShare = shareSeries("sipFlow", 6);

  const heatmapRows: HeatmapRow[] = AMCS.map((a) => ({
    label: a.ticker ?? a.name.split(" ")[0],
    values: monthlyForAmc(a.slug).map((r) => r.schemePerformance ?? null),
  }));

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly Operating"
        subtitle={`Industry-wide operating metrics · ${latestMonth()}`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="AUM"
          value={formatINR(latest.aum, { compact: true })}
          delta={`${formatDelta(aumMom)} MoM`}
          trend={trend(aumMom)}
        />
        <KpiCard
          label="Equity AUM"
          value={formatINR(latest.equityAum, { compact: true })}
          delta={`${formatDelta(equityYoy)} YoY`}
          trend={trend(equityYoy)}
        />
        <KpiCard
          label="SIP Flow"
          value={formatINR(latest.sipFlow, { compact: true })}
          delta={`${formatDelta(sipYoy)} YoY`}
          trend={trend(sipYoy)}
        />
        <KpiCard
          label="New Investors"
          value={(latest.newInvestors / 1e5).toFixed(1) + " L"}
          delta={`${formatDelta(investorsYoy)} YoY`}
          trend={trend(investorsYoy)}
        />
        <KpiCard
          label="NFO Launches"
          value={String(latest.nfoCount)}
          delta={`${formatDelta(nfoMom)} MoM`}
          trend={trend(nfoMom)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Total industry AUM, 24M">
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card title="AUM Market Share" subtitle="Top 6 AMCs + Others">
          <StackedArea
            data={aumShare.rows}
            xKey="month"
            series={aumShare.keys.map((k) => ({
              key: k,
              name: amcLabel(k),
              color: AMC_COLORS[k] ?? "hsl(var(--muted-foreground))",
            }))}
          />
        </Card>
        <Card title="SIP Flows" subtitle="Monthly inflows">
          <BarSeries data={sipSeries} name="SIP" />
        </Card>
        <Card title="SIP Market Share" subtitle="Share of monthly SIP">
          <StackedArea
            data={sipShare.rows}
            xKey="month"
            series={sipShare.keys.map((k) => ({
              key: k,
              name: amcLabel(k),
              color: AMC_COLORS[k] ?? "hsl(var(--muted-foreground))",
            }))}
          />
        </Card>
        <Card title="Investor Additions" subtitle="New folios per month">
          <BarSeries
            data={investorsSeries}
            valueFormat="lakh"
            axisFormat="lakh"
            color="hsl(var(--chart-4))"
            name="New investors"
          />
        </Card>
        <Card title="NFO Launches" subtitle="Count per month">
          <BarSeries
            data={nfoSeries}
            valueFormat="count"
            axisFormat="count"
            color="hsl(var(--chart-5))"
            name="NFOs"
          />
        </Card>
        <Card
          title="Scheme Performance"
          subtitle="AMC × month · excess return %"
          className="lg:col-span-2"
        >
          <Heatmap rows={heatmapRows} columns={MONTHS_LIST} />
        </Card>
      </section>
    </div>
  );
}
