import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  industryQuarterly,
  latestQuarter,
  qoqChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { formatINR, formatDelta } from "@/lib/format";
import { parseFilters, selectedSlugs, trimQuarters } from "@/lib/filter";
import { QUARTERS_LIST } from "@/data/generator";

export default async function QuarterlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const slugs = selectedSlugs(filters);

  const fullSeries = industryQuarterly(slugs);
  const trimmedSet = new Set(trimQuarters(QUARTERS_LIST, filters.range));
  const series = fullSeries.filter((q) => trimmedSet.has(q.quarter));

  const latest = fullSeries[fullSeries.length - 1];
  const revenueYoy = yoyChangeQuarterly(fullSeries.map((q) => q.revenue));
  const opYoy = yoyChangeQuarterly(fullSeries.map((q) => q.operatingProfit));
  const patYoy = yoyChangeQuarterly(fullSeries.map((q) => q.pat));
  const patMargin = (latest.pat / latest.revenue) * 100;
  const opMargin = (latest.operatingProfit / latest.revenue) * 100;
  const revenueYieldBps = latest.avgAum
    ? (latest.revenue * 4 * 10_000) / latest.avgAum
    : 0;
  const opYieldBps = latest.avgAum
    ? (latest.operatingProfit * 4 * 10_000) / latest.avgAum
    : 0;
  const profitYieldBps = latest.avgAum
    ? (latest.pat * 4 * 10_000) / latest.avgAum
    : 0;

  const prevPatMargin =
    fullSeries.length > 1
      ? (fullSeries[fullSeries.length - 2].pat /
          fullSeries[fullSeries.length - 2].revenue) *
        100
      : patMargin;
  const patMarginQoq = qoqChange([prevPatMargin, patMargin]);

  const pnlData = series.map((q) => ({
    quarter: q.quarter,
    revenue: q.revenue,
    op: q.operatingProfit,
    pat: q.pat,
  }));
  const marginData = series.map((q) => ({
    quarter: q.quarter,
    patMargin: Number(((q.pat / q.revenue) * 100).toFixed(2)),
    opMargin: Number(((q.operatingProfit / q.revenue) * 100).toFixed(2)),
  }));
  const yieldData = series.map((q) => ({
    quarter: q.quarter,
    revenue: q.avgAum
      ? Number(((q.revenue * 4 * 10_000) / q.avgAum).toFixed(1))
      : 0,
    op: q.avgAum
      ? Number(((q.operatingProfit * 4 * 10_000) / q.avgAum).toFixed(1))
      : 0,
    profit: q.avgAum
      ? Number(((q.pat * 4 * 10_000) / q.avgAum).toFixed(1))
      : 0,
  }));

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const subtitle = slugs
    ? `${slugs.length} AMC${slugs.length > 1 ? "s" : ""} · ${latestQuarter()}`
    : `Industry P&L (10 AMCs) · ${latestQuarter()}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Quarterly Financials" subtitle={subtitle} />
      <FilterBar showRange="quarterly" />

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
        <KpiCard label="Revenue Yield" value={revenueYieldBps.toFixed(1) + " bps"} />
        <KpiCard label="Operating Yield" value={opYieldBps.toFixed(1) + " bps"} />
        <KpiCard label="Profit Yield" value={profitYieldBps.toFixed(1) + " bps"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Revenue / Op Profit / PAT" subtitle="Quarterly">
          <GroupedBars
            data={pnlData}
            xKey="quarter"
            bars={[
              { key: "revenue", name: "Revenue", color: "hsl(var(--chart-1))" },
              { key: "op", name: "Op Profit", color: "hsl(var(--chart-2))" },
              { key: "pat", name: "PAT", color: "hsl(var(--chart-3))" },
            ]}
          />
        </Card>
        <Card title="Margin Trend" subtitle="PAT & Operating margin">
          <MultiLine
            data={marginData}
            xKey="quarter"
            valueFormat="pct"
            axisFormat="pct"
            lines={[
              { key: "patMargin", name: "PAT margin", color: "hsl(var(--chart-3))" },
              { key: "opMargin", name: "Operating margin", color: "hsl(var(--chart-2))" },
            ]}
          />
        </Card>
        <Card
          title="Yields (bps)"
          subtitle="Annualised revenue / operating / profit yield"
          className="lg:col-span-2"
        >
          <MultiLine
            data={yieldData}
            xKey="quarter"
            valueFormat="bps"
            axisFormat="bps"
            lines={[
              { key: "revenue", name: "Revenue yield", color: "hsl(var(--chart-1))" },
              { key: "op", name: "Operating yield", color: "hsl(var(--chart-2))" },
              { key: "profit", name: "Profit yield", color: "hsl(var(--chart-3))" },
            ]}
          />
        </Card>
      </section>
    </div>
  );
}
