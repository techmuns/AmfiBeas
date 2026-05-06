import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { LockedKpiList } from "@/components/data/LockedKpiList";
import { PAID_LOCKED_KPIS } from "@/config/morningstar-kpis";
import {
  industryByMonth,
  industryQuarterly,
  latestMonth,
  latestQuarter,
  momChange,
  yoyChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import {
  formatCompactCrSafe,
  formatDelta,
  formatLakhSafe,
  formatPctSafe,
} from "@/lib/format";

export default function HomePage() {
  const monthly = industryByMonth();
  const quarterly = industryQuarterly();
  const latest = monthly[monthly.length - 1];
  const latestQ = quarterly[quarterly.length - 1];

  const aumYoy = yoyChange(monthly.map((m) => m.totalAum));
  const activeEquityMom = momChange(
    monthly.map((m) => m.activeEquityAum)
  );
  const sipMom = momChange(monthly.map((m) => m.sipContribution));
  const investorsMom = momChange(monthly.map((m) => m.investorAdditions));
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

  const aumSeries = monthly.map((m) => ({
    month: m.month,
    value: m.totalAum,
  }));
  const sipSeries = monthly.map((m) => ({
    label: m.month,
    value: m.sipContribution,
  }));

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const patMargin =
    latestQ.revenue > 0 ? (latestQ.pat / latestQ.revenue) * 100 : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={`Industry snapshot · ${latestMonth()} (operating) · ${latestQuarter()} (financial)`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Industry AUM"
          value={formatCompactCrSafe(latest.totalAum)}
          delta={`${formatDelta(aumYoy)} YoY`}
          trend={trend(aumYoy)}
        />
        <KpiCard
          label="Active Equity AUM"
          value={formatCompactCrSafe(latest.activeEquityAum)}
          delta={`${formatDelta(activeEquityMom)} MoM`}
          trend={trend(activeEquityMom)}
        />
        <KpiCard
          label="Monthly SIP"
          value={formatCompactCrSafe(latest.sipContribution)}
          delta={`${formatDelta(sipMom)} MoM`}
          trend={trend(sipMom)}
        />
        <KpiCard
          label="Investor Additions"
          value={formatLakhSafe(latest.investorAdditions)}
          delta={`${formatDelta(investorsMom)} MoM`}
          trend={trend(investorsMom)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Industry Revenue"
          value={formatCompactCrSafe(latestQ.revenue)}
        />
        <KpiCard
          label="Operating Profit"
          value={formatCompactCrSafe(latestQ.operatingProfit)}
        />
        <KpiCard
          label="PAT"
          value={formatCompactCrSafe(latestQ.pat)}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
        />
        <KpiCard label="PAT Margin" value={formatPctSafe(patMargin)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Industry total · 24 months">
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card title="SIP Flows" subtitle="Monthly inflows · industry">
          <BarSeries data={sipSeries} name="SIP" />
        </Card>
      </section>

      <Card
        title="Locked Morningstar KPIs"
        subtitle="Requires Morningstar License"
        action={
          <Link
            href="/data-sources"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View all sources
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        <LockedKpiList items={PAID_LOCKED_KPIS} compact />
      </Card>
    </div>
  );
}
