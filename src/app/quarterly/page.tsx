import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { ChartPlaceholder } from "@/components/ui/ChartPlaceholder";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  industryQuarterly,
  latestQuarter,
  qoqChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { formatINR, formatDelta } from "@/lib/format";

export default function QuarterlyPage() {
  const series = industryQuarterly();
  const latest = series[series.length - 1];

  const revenueYoy = yoyChangeQuarterly(series.map((q) => q.revenue));
  const opYoy = yoyChangeQuarterly(series.map((q) => q.operatingProfit));
  const patYoy = yoyChangeQuarterly(series.map((q) => q.pat));
  const patMargin = (latest.pat / latest.revenue) * 100;
  const opMargin = (latest.operatingProfit / latest.revenue) * 100;
  const revenueYieldBps = (latest.revenue * 4 * 10_000) / latest.avgAum;

  const prevPatMargin =
    series.length > 1
      ? (series[series.length - 2].pat / series[series.length - 2].revenue) * 100
      : patMargin;
  const patMarginQoq = qoqChange([prevPatMargin, patMargin]);

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quarterly Financials"
        subtitle={`Industry P&L (10 AMCs) · ${latestQuarter()}`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue"
          value={formatINR(latest.revenue, { compact: true })}
          delta={`${formatDelta(revenueYoy)} YoY`}
          trend={trend(revenueYoy)}
        />
        <KpiCard
          label="Operating Profit"
          value={formatINR(latest.operatingProfit, { compact: true })}
          delta={`${formatDelta(opYoy)} YoY`}
          trend={trend(opYoy)}
        />
        <KpiCard
          label="PAT"
          value={formatINR(latest.pat, { compact: true })}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
        />
        <KpiCard
          label="PAT Margin"
          value={patMargin.toFixed(1) + "%"}
          delta={`${formatDelta(patMarginQoq)} QoQ`}
          trend={trend(patMarginQoq)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Operating Margin" value={opMargin.toFixed(1) + "%"} />
        <KpiCard
          label="Revenue Yield"
          value={revenueYieldBps.toFixed(1) + " bps"}
        />
        <KpiCard
          label="Operating Yield"
          value={
            ((latest.operatingProfit * 4 * 10_000) / latest.avgAum).toFixed(1) +
            " bps"
          }
        />
        <KpiCard
          label="Profit Yield"
          value={((latest.pat * 4 * 10_000) / latest.avgAum).toFixed(1) + " bps"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Revenue / OpProfit / PAT" subtitle="Quarterly trend">
          <ChartPlaceholder />
        </Card>
        <Card title="Margin Trend" subtitle="PAT & Operating margin">
          <ChartPlaceholder />
        </Card>
        <Card
          title="Yields (bps)"
          subtitle="Revenue / Operating / Profit yield"
          className="lg:col-span-2"
        >
          <ChartPlaceholder height={240} />
        </Card>
      </section>
    </div>
  );
}
