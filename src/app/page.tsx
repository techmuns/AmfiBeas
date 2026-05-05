import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import {
  industryByMonth,
  industryQuarterly,
  latestMonth,
  latestQuarter,
  momChange,
  yoyChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { formatINR, formatDelta } from "@/lib/format";

export default function HomePage() {
  const monthly = industryByMonth();
  const quarterly = industryQuarterly();
  const latest = monthly[monthly.length - 1];
  const latestQ = quarterly[quarterly.length - 1];

  const aumYoy = yoyChange(monthly.map((m) => m.aum));
  const equityMom = momChange(monthly.map((m) => m.equityAum));
  const sipMom = momChange(monthly.map((m) => m.sipFlow));
  const investorsMom = momChange(monthly.map((m) => m.newInvestors));
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

  const aumSeries = monthly.map((m) => ({ month: m.month, value: m.aum }));
  const sipSeries = monthly.map((m) => ({ label: m.month, value: m.sipFlow }));

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={`Industry snapshot · ${latestMonth()} (operating) · ${latestQuarter()} (financial)`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Industry AUM"
          value={formatINR(latest.aum, { compact: true })}
          delta={`${formatDelta(aumYoy)} YoY`}
          trend={trend(aumYoy)}
        />
        <KpiCard
          label="Equity AUM"
          value={formatINR(latest.equityAum, { compact: true })}
          delta={`${formatDelta(equityMom)} MoM`}
          trend={trend(equityMom)}
        />
        <KpiCard
          label="Monthly SIP"
          value={formatINR(latest.sipFlow, { compact: true })}
          delta={`${formatDelta(sipMom)} MoM`}
          trend={trend(sipMom)}
        />
        <KpiCard
          label="New Investors"
          value={(latest.newInvestors / 1e5).toFixed(1) + " L"}
          delta={`${formatDelta(investorsMom)} MoM`}
          trend={trend(investorsMom)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Industry Revenue"
          value={formatINR(latestQ.revenue, { compact: true })}
        />
        <KpiCard
          label="Operating Profit"
          value={formatINR(latestQ.operatingProfit, { compact: true })}
        />
        <KpiCard
          label="PAT"
          value={formatINR(latestQ.pat, { compact: true })}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
        />
        <KpiCard
          label="PAT Margin"
          value={((latestQ.pat / latestQ.revenue) * 100).toFixed(1) + "%"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Industry total · 24 months">
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card title="SIP Flows" subtitle="Monthly inflows · industry">
          <BarSeries data={sipSeries} name="SIP" />
        </Card>
      </section>
    </div>
  );
}
