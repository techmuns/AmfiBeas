import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import { AMCS, getAMC } from "@/data/amcs";
import { monthlyForAmc } from "@/data/generator";
import {
  industryByMonth,
  isLiveQuarterly,
  momChange,
  quarterlyForAmc,
  yieldsForAmc,
  yoyChange,
  yoyChangeQuarterly,
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

  const aumSeries = monthly.map((m) => ({ month: m.month, value: m.aum }));
  const sipSeries = monthly.map((m) => ({ label: m.month, value: m.sipFlow }));
  const pnlData = quarterly.map((q) => ({
    quarter: q.quarter,
    revenue: q.revenue,
    op: q.operatingProfit,
    pat: q.pat,
  }));
  const yieldData = yields.map((y) => ({
    quarter: y.quarter,
    revenue: Number(y.revenueYieldBps.toFixed(1)),
    op: Number(y.operatingYieldBps.toFixed(1)),
    profit: Number(y.profitYieldBps.toFixed(1)),
  }));
  const yieldsAvailable = yieldData.some(
    (y) => y.revenue > 0 || y.op > 0 || y.profit > 0
  );

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const quarterlyLive = isLiveQuarterly(slug);

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
        action={
          quarterlyLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[10px] tabular text-positive">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
              Live financials
            </span>
          ) : undefined
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
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card title="SIP Flow" subtitle="Monthly inflows">
          <BarSeries data={sipSeries} name="SIP" />
        </Card>
        <Card title="Quarterly P&L" subtitle="Revenue / Op / PAT">
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
        <Card
          title="Yields (bps)"
          subtitle={yieldsAvailable ? "Annualised" : "AAUM not in source"}
        >
          {yieldsAvailable ? (
            <MultiLine
              data={yieldData}
              xKey="quarter"
              valueFormat="bps"
              axisFormat="bps"
              lines={[
                { key: "revenue", name: "Revenue yield", color: "hsl(var(--chart-1))" },
                { key: "op", name: "Operating", color: "hsl(var(--chart-2))" },
                { key: "profit", name: "Profit", color: "hsl(var(--chart-3))" },
              ]}
            />
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              —
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
