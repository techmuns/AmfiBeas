import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartPlaceholder } from "@/components/ui/ChartPlaceholder";
import { AMCS, getAMC } from "@/data/amcs";
import { monthlyForAmc, quarterlyForAmc } from "@/data/generator";
import {
  momChange,
  yoyChange,
  yoyChangeQuarterly,
  yieldsForAmc,
  industryByMonth,
} from "@/data/aggregate";
import { formatINR, formatDelta } from "@/lib/format";

export function generateStaticParams() {
  return AMCS.map((a) => ({ slug: a.slug }));
}

export default async function AmcPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = getAMC(slug);
  if (!profile) notFound();

  const monthly = monthlyForAmc(slug);
  const quarterly = quarterlyForAmc(slug);
  const yields = yieldsForAmc(slug);
  const latest = monthly[monthly.length - 1];
  const latestQ = quarterly[quarterly.length - 1];
  const latestYield = yields[yields.length - 1];

  const aumYoy = yoyChange(monthly.map((m) => m.aum));
  const sipMom = momChange(monthly.map((m) => m.sipFlow));
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

  const industry = industryByMonth();
  const industryLatest = industry[industry.length - 1];
  const aumShare = (latest.aum / industryLatest.aum) * 100;
  const sipShare = (latest.sipFlow / industryLatest.sipFlow) * 100;

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.name}
        subtitle={
          [
            profile.ticker,
            profile.listed ? "Listed" : "Unlisted",
          ]
            .filter(Boolean)
            .join(" · ") + ` · ${latest.month}`
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="AUM"
          value={formatINR(latest.aum, { compact: true })}
          delta={`${formatDelta(aumYoy)} YoY`}
          trend={trend(aumYoy)}
        />
        <KpiCard label="AUM Share" value={aumShare.toFixed(2) + "%"} />
        <KpiCard
          label="Equity AUM"
          value={formatINR(latest.equityAum, { compact: true })}
        />
        <KpiCard
          label="SIP Flow"
          value={formatINR(latest.sipFlow, { compact: true })}
          delta={`${formatDelta(sipMom)} MoM`}
          trend={trend(sipMom)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="SIP Share" value={sipShare.toFixed(2) + "%"} />
        <KpiCard
          label="Quarterly Revenue"
          value={formatINR(latestQ.revenue, { compact: true })}
        />
        <KpiCard
          label="PAT"
          value={formatINR(latestQ.pat, { compact: true })}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
        />
        <KpiCard
          label="PAT Margin"
          value={latestYield.patMargin.toFixed(1) + "%"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="24-month series">
          <ChartPlaceholder />
        </Card>
        <Card title="SIP Flow" subtitle="Monthly inflows">
          <ChartPlaceholder />
        </Card>
        <Card title="Quarterly P&L" subtitle="Revenue / OpProfit / PAT">
          <ChartPlaceholder />
        </Card>
        <Card title="Yields (bps)" subtitle="Revenue / Operating / Profit">
          <ChartPlaceholder />
        </Card>
      </section>
    </div>
  );
}
