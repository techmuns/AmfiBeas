import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import {
  dataMode,
  latestOtherSchemesCategoryBreakdown,
  otherSchemesByMonth,
} from "@/data/source";
import { formatINR, formatDelta, formatMonthLabel } from "@/lib/format";
import { momChange, yoyChange } from "@/data/aggregate";
import { liveOtherSchemesNote } from "@/lib/provenance";
import { cn } from "@/lib/cn";

export default function OtherSchemesPage() {
  const isLive = dataMode().otherSchemes === "live";
  const series = otherSchemesByMonth();
  const breakdown = latestOtherSchemesCategoryBreakdown();
  const latest = series[series.length - 1];

  if (!isLive || !latest || !breakdown) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Passive & Other Schemes"
          subtitle="No data yet"
        />
        <Card>
          <p className="text-sm text-muted-foreground">
            Awaiting first ingest.
          </p>
        </Card>
      </div>
    );
  }

  const aumMom = momChange(series.map((s) => s.totalAum));
  const aumYoy = yoyChange(series.map((s) => s.totalAum));
  const flowMom = momChange(series.map((s) => s.netFlow));

  const aumSeries = series.map((s) => ({
    month: s.month,
    value: s.totalAum,
  }));
  const flowSeries = series.map((s) => ({
    label: s.month,
    value: s.netFlow,
  }));
  const mobilizedSeries = series.map((s) => ({
    label: s.month,
    value: s.fundsMobilized,
  }));

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const totalAum = breakdown.rows.reduce((s, r) => s + r.aum, 0);
  const otherSchemesNote = liveOtherSchemesNote();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Passive & Other Schemes"
        subtitle={`Live AMFI data · SEBI Group V · ${formatMonthLabel(latest.month)} · ${series.length}M history`}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[10px] tabular text-positive">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
            Live
          </span>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total AUM"
          value={formatINR(latest.totalAum, { compact: true })}
          delta={`${formatDelta(aumYoy)} YoY`}
          trend={trend(aumYoy)}
          note={otherSchemesNote}
        />
        <KpiCard
          label="Net Flow"
          value={formatINR(latest.netFlow, { compact: true })}
          delta={`${formatDelta(flowMom)} MoM`}
          trend={trend(flowMom)}
          note={otherSchemesNote}
        />
        <KpiCard
          label="Funds Mobilised"
          value={formatINR(latest.fundsMobilized, { compact: true })}
          note={otherSchemesNote}
        />
        <KpiCard
          label="Folios"
          value={(latest.totalFolios / 1e7).toFixed(2) + " Cr"}
          delta={`${formatDelta(aumMom)} MoM AUM`}
          trend={trend(aumMom)}
          note={otherSchemesNote}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Group V total · 11 months">
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card title="Net Flow" subtitle="Inflow (+) / Outflow (−) per month">
          <BarSeries data={flowSeries} color="hsl(var(--chart-2))" name="Net flow" />
        </Card>
        <Card
          title="Funds Mobilised"
          subtitle="Gross monthly inflow before redemptions"
          className="lg:col-span-2"
        >
          <BarSeries
            data={mobilizedSeries}
            color="hsl(var(--chart-1))"
            name="Mobilised"
          />
        </Card>
      </section>

      <Card
        title={`Category Breakdown · ${formatMonthLabel(breakdown.month)}`}
        subtitle="Sub-categories of SEBI Group V, sorted by AUM"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 text-right font-medium tabular">AUM</th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  Share
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  Net Flow
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  Folios
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((r) => (
                <tr key={r.category} className="border-b last:border-0">
                  <td className="py-3 pr-4 font-medium">{r.category}</td>
                  <td className="py-3 pr-4 text-right tabular">
                    {formatINR(r.aum, { compact: true })}
                  </td>
                  <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                    {((r.aum / totalAum) * 100).toFixed(1)}%
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular",
                      r.netFlow > 0 && "text-positive",
                      r.netFlow < 0 && "text-negative",
                      r.netFlow === 0 && "text-muted-foreground"
                    )}
                  >
                    {r.netFlow > 0 ? "+" : ""}
                    {formatINR(r.netFlow, { compact: true })}
                  </td>
                  <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                    {(r.folios / 1e5).toFixed(1)} L
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
