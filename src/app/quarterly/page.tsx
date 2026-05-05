import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
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
  const opYieldBps = (latest.operatingProfit * 4 * 10_000) / latest.avgAum;
  const profitYieldBps = (latest.pat * 4 * 10_000) / latest.avgAum;

  const prevPatMargin =
    series.length > 1
      ? (series[series.length - 2].pat / series[series.length - 2].revenue) * 100
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
    revenue: Number(((q.revenue * 4 * 10_000) / q.avgAum).toFixed(1)),
    op: Number(((q.operatingProfit * 4 * 10_000) / q.avgAum).toFixed(1)),
    profit: Number(((q.pat * 4 * 10_000) / q.avgAum).toFixed(1)),
  }));

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
