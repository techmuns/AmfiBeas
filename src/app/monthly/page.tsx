import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { ChartPlaceholder } from "@/components/ui/ChartPlaceholder";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  industryByMonth,
  latestMonth,
  momChange,
  yoyChange,
} from "@/data/aggregate";
import { formatINR, formatDelta } from "@/lib/format";

export default function MonthlyPage() {
  const series = industryByMonth();
  const latest = series[series.length - 1];

  const aumMom = momChange(series.map((m) => m.aum));
  const equityYoy = yoyChange(series.map((m) => m.equityAum));
  const sipYoy = yoyChange(series.map((m) => m.sipFlow));
  const investorsYoy = yoyChange(series.map((m) => m.newInvestors));
  const nfoMom = momChange(series.map((m) => m.nfoCount));

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
          <ChartPlaceholder />
        </Card>
        <Card title="AUM Market Share" subtitle="Stacked, by AMC">
          <ChartPlaceholder />
        </Card>
        <Card title="SIP Flows" subtitle="Monthly inflows">
          <ChartPlaceholder />
        </Card>
        <Card title="SIP Market Share" subtitle="Share of monthly SIP">
          <ChartPlaceholder />
        </Card>
        <Card title="Investor Additions" subtitle="New folios per month">
          <ChartPlaceholder />
        </Card>
        <Card title="NFO Launches" subtitle="Count per month">
          <ChartPlaceholder />
        </Card>
        <Card
          title="Scheme Performance"
          subtitle="AMC × month heatmap (excess return %)"
          className="lg:col-span-2"
        >
          <ChartPlaceholder height={220} />
        </Card>
      </section>
    </div>
  );
}
