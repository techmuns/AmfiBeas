import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import type { AmcStatus } from "@/components/filters/FilterBar";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  SOURCED_FINANCIALS_SLUGS,
  qoqChange,
  quarterlyForAmc,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { aaumProvenance, amcAaumQuarterlySnapshot } from "@/data/source";
import { AMCS, getAMC } from "@/data/amcs";
import { formatINR, formatDelta } from "@/lib/format";
import { parseFilters, trimQuarters } from "@/lib/filter";
import { QUARTERS_LIST } from "@/data/generator";

const DEFAULT_SLUG = "hdfc";

function buildAmcStatus(): Record<string, AmcStatus> {
  const out: Record<string, AmcStatus> = {};
  for (const a of AMCS) {
    if (SOURCED_FINANCIALS_SLUGS.has(a.slug)) out[a.slug] = "live";
    else if (a.listed) out[a.slug] = "pending";
    else out[a.slug] = "unavailable";
  }
  return out;
}

export default async function QuarterlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const status = buildAmcStatus();

  // Single-select: pick the first sourced AMC from the URL, else fall back to
  // hdfc. Unlisted / pending slugs in the URL are ignored.
  const requested = filters.amcs.find((s) => status[s] === "live");
  const slug = requested ?? DEFAULT_SLUG;
  const profile = getAMC(slug);

  const fullSeries = quarterlyForAmc(slug);
  const trimmedSet = new Set(trimQuarters(QUARTERS_LIST, filters.range));
  const series = fullSeries.filter((q) => trimmedSet.has(q.quarter));
  const latest = fullSeries[fullSeries.length - 1];

  const aaumMeta = amcAaumQuarterlySnapshot.meta;
  const yieldsSubtitle =
    amcAaumQuarterlySnapshot.rows.length > 0
      ? `Source: AMFI AAUM · ${new Date(aaumMeta.generatedAt).toISOString().slice(0, 10)}`
      : "Annualised revenue / operating / profit yield";

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  // No data → render empty state. Reaches this branch only if the default
  // slug somehow has no rows (defensive — hdfc is always sourced today).
  if (!latest || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Quarterly Financials"
          subtitle="Single-AMC view · sourced quarterly P&L"
        />
        <FilterBar
          showRange="quarterly"
          amcMode="single"
          amcStatus={status}
          defaultSlug={DEFAULT_SLUG}
        />
        <Card
          title="Financials unavailable"
          subtitle="No sourced quarterly P&L for the selected AMC."
        >
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        </Card>
      </div>
    );
  }

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
  const yieldData = series.map((q) => {
    const hasAaum = aaumProvenance(slug, q.quarter)?.status === "ok";
    return {
      quarter: q.quarter,
      revenue: hasAaum
        ? Number(((q.revenue * 4 * 10_000) / q.avgAum).toFixed(1))
        : null,
      op: hasAaum
        ? Number(((q.operatingProfit * 4 * 10_000) / q.avgAum).toFixed(1))
        : null,
      profit: hasAaum
        ? Number(((q.pat * 4 * 10_000) / q.avgAum).toFixed(1))
        : null,
    };
  });

  const subtitle = `${profile.name}${profile.ticker ? ` (${profile.ticker})` : ""} · ${latest.quarter}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Quarterly Financials" subtitle={subtitle} />
      <FilterBar
        showRange="quarterly"
        amcMode="single"
        amcStatus={status}
        defaultSlug={DEFAULT_SLUG}
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
