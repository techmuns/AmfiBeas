import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  SOURCED_FINANCIALS_SLUGS,
  industryQuarterly,
  latestQuarter,
  qoqChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { amcAaumQuarterlySnapshot } from "@/data/source";
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
  const requestedSlugs = selectedSlugs(filters);
  // Only AMCs with sourced P&L can be summed. Drop unlisted slugs from the
  // selection so we never accidentally aggregate demo data.
  const slugs = requestedSlugs
    ? requestedSlugs.filter((s) => SOURCED_FINANCIALS_SLUGS.has(s))
    : null;
  const droppedUnsourced =
    requestedSlugs &&
    requestedSlugs.length !== (slugs?.length ?? 0);
  const noSourcedSelection =
    requestedSlugs !== null && (slugs?.length ?? 0) === 0;

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
  // null (not 0) for quarters where AAUM is missing, so the line renders as
  // a gap rather than a misleading drop-to-zero.
  const yieldData = series.map((q) => ({
    quarter: q.quarter,
    revenue: q.avgAum
      ? Number(((q.revenue * 4 * 10_000) / q.avgAum).toFixed(1))
      : null,
    op: q.avgAum
      ? Number(((q.operatingProfit * 4 * 10_000) / q.avgAum).toFixed(1))
      : null,
    profit: q.avgAum
      ? Number(((q.pat * 4 * 10_000) / q.avgAum).toFixed(1))
      : null,
  }));

  const aaumMeta = amcAaumQuarterlySnapshot.meta;
  const aaumLive = amcAaumQuarterlySnapshot.rows.length > 0;
  const yieldsSubtitle = aaumLive
    ? `Source: AMFI AAUM · ${new Date(aaumMeta.generatedAt).toISOString().slice(0, 10)}`
    : "Annualised revenue / operating / profit yield";

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const sourcedCount = SOURCED_FINANCIALS_SLUGS.size;
  const subtitle = slugs
    ? `${slugs.length} listed AMC${slugs.length > 1 ? "s" : ""} · ${latestQuarter()}`
    : `Listed AMC P&L · ${sourcedCount} AMCs · ${latestQuarter()}`;

  if (noSourcedSelection) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Quarterly Financials"
          subtitle="Selection contains no listed AMCs — financials unavailable"
        />
        <FilterBar showRange="quarterly" />
        <Card
          title="Financials unavailable"
          subtitle="Quarterly P&L is sourced only for the 4 listed AMCs (HDFC AMC, Nippon, ABSL, UTI). Unlisted AMCs have no standalone quarterly disclosures."
        >
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Quarterly Financials" subtitle={subtitle} />
      <FilterBar showRange="quarterly" />

      {droppedUnsourced && (
        <Card
          title="Filter scope reduced"
          subtitle="Some selected AMCs have no sourced quarterly financials and were excluded from the aggregate."
        >
          <div className="text-sm text-muted-foreground">
            Showing {slugs?.length ?? 0} of {requestedSlugs?.length ?? 0}{" "}
            selected AMCs.
          </div>
        </Card>
      )}

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
          value={
            latest.avgAum > 0 ? revenueYieldBps.toFixed(1) + " bps" : "—"
          }
        />
        <KpiCard
          label="Operating Yield"
          value={latest.avgAum > 0 ? opYieldBps.toFixed(1) + " bps" : "—"}
        />
        <KpiCard
          label="Profit Yield"
          value={
            latest.avgAum > 0 ? profitYieldBps.toFixed(1) + " bps" : "—"
          }
        />
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
          subtitle={yieldsSubtitle}
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
