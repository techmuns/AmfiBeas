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
  yoyChangeQuarterly,
} from "@/data/aggregate";
import {
  aaumFor,
  aaumProvenance,
  amcAaumQuarterlySnapshot,
} from "@/data/source";
import {
  formatCompactCrSafe,
  formatDelta,
  formatPctSafe,
} from "@/lib/format";
import {
  demoNote,
  liveScreenerNote,
  pendingFinancialsNote,
  unlistedFinancialsNote,
} from "@/lib/provenance";

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
  const quarterlyLive = isLiveQuarterly(slug);
  const latestQ = quarterlyLive
    ? quarterly[quarterly.length - 1]
    : undefined;

  const sipMom = momChange(monthly.map((m) => m.sipContribution));
  const patYoy = quarterlyLive
    ? yoyChangeQuarterly(quarterly.map((q) => q.pat))
    : 0;

  const industry = industryByMonth();
  const industryLatest = industry[industry.length - 1];
  const aumShare =
    industryLatest.totalAum > 0
      ? (latest.totalAum / industryLatest.totalAum) * 100
      : null;
  const sipShare =
    industryLatest.sipContribution > 0
      ? (latest.sipContribution / industryLatest.sipContribution) * 100
      : null;
  const activeEquityShare =
    industryLatest.activeEquityAum > 0
      ? (latest.activeEquityAum / industryLatest.activeEquityAum) * 100
      : null;

  const aumSeries = monthly.map((m) => ({
    month: m.month,
    value: m.totalAum,
  }));
  const sipSeries = monthly.map((m) => ({
    label: m.month,
    value: m.sipContribution,
  }));
  const pnlData = quarterly.map((q) => ({
    quarter: q.quarter,
    revenue: q.revenue,
    op: q.operatingProfit,
    pat: q.pat,
  }));
  // null (not 0) for quarters where AAUM is missing, so the line renders as
  // a gap rather than a misleading drop-to-zero.
  const yieldData = yields.map((y) => {
    const hasAaum = aaumProvenance(slug, y.quarter)?.status === "ok";
    return {
      quarter: y.quarter,
      revenue: hasAaum ? Number(y.revenueYieldBps.toFixed(1)) : null,
      op: hasAaum ? Number(y.operatingYieldBps.toFixed(1)) : null,
      profit: hasAaum ? Number(y.profitYieldBps.toFixed(1)) : null,
    };
  });
  const yieldsAvailable = yieldData.some(
    (y) => (y.revenue ?? 0) > 0 || (y.op ?? 0) > 0 || (y.profit ?? 0) > 0
  );
  const yieldsSubtitle = yieldsAvailable
    ? `bps of AAUM · quarterly P&L ×4 / same-quarter AMFI AAUM · ${new Date(amcAaumQuarterlySnapshot.meta.generatedAt).toISOString().slice(0, 10)}`
    : "AAUM not in source";

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const financialsUnavailableMessage = profile.listed
    ? "Listed · financials pending source"
    : "Unlisted · no standalone quarterly financials";

  // Live AMFI AAUM for this AMC's most recent quarter. This is the same
  // denominator the yield cards use, so the displayed AUM and the yield
  // calculation can never disagree.
  const aaumQuarters = amcAaumQuarterlySnapshot.rows
    .filter((r) => r.amcSlug === slug && r.status === "ok")
    .map((r) => r.quarter)
    .sort();
  const latestAaumQuarter = aaumQuarters[aaumQuarters.length - 1] ?? null;
  const prevAaumQuarter = aaumQuarters[aaumQuarters.length - 2] ?? null;
  const latestAaum = latestAaumQuarter
    ? aaumFor(slug, latestAaumQuarter)
    : null;
  const prevAaum = prevAaumQuarter ? aaumFor(slug, prevAaumQuarter) : null;
  const aaumQoq =
    latestAaum && prevAaum && prevAaum > 0
      ? ((latestAaum - prevAaum) / prevAaum) * 100
      : null;
  const aaumGeneratedAt = new Date(
    amcAaumQuarterlySnapshot.meta.generatedAt
  )
    .toISOString()
    .slice(0, 10);
  const aaumNote = latestAaumQuarter
    ? `Source: AMFI AAUM · ${aaumGeneratedAt}`
    : undefined;

  // Per-AMC financials provenance: live screener.in for sourced AMCs,
  // pending for listed but un-ingested (ICICI Pru), unavailable for unlisted.
  const financialsNote = quarterlyLive
    ? liveScreenerNote()
    : profile.listed
      ? pendingFinancialsNote()
      : unlistedFinancialsNote();
  const operatingDemoNote = demoNote("operating data not yet sourced");
  const sipDemoNote = demoNote("SIP not yet sourced");
  const shareDemoNote = demoNote("share not yet sourced");

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
          label="Average AUM"
          value={formatCompactCrSafe(latestAaum)}
          delta={
            aaumQoq !== null ? `${formatDelta(aaumQoq)} QoQ` : undefined
          }
          trend={aaumQoq !== null ? trend(aaumQoq / 100) : undefined}
          note={aaumNote}
        />
        <KpiCard
          label="AUM Share"
          value={formatPctSafe(aumShare, 2)}
          note={shareDemoNote}
        />
        <KpiCard
          label="Active Equity AUM"
          value={formatCompactCrSafe(latest.activeEquityAum)}
          note={operatingDemoNote}
        />
        <KpiCard
          label="SIP Contribution"
          value={formatCompactCrSafe(latest.sipContribution)}
          delta={`${formatDelta(sipMom)} MoM`}
          trend={trend(sipMom)}
          note={sipDemoNote}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active Equity Share"
          value={formatPctSafe(activeEquityShare, 2)}
          note={shareDemoNote}
        />
        <KpiCard
          label="SIP Share"
          value={formatPctSafe(sipShare, 2)}
          note={shareDemoNote}
        />
        <KpiCard
          label="Quarterly Revenue"
          value={
            quarterlyLive && latestQ
              ? formatCompactCrSafe(latestQ.revenue)
              : "—"
          }
          note={financialsNote}
        />
        <KpiCard
          label="PAT"
          value={
            quarterlyLive && latestQ ? formatCompactCrSafe(latestQ.pat) : "—"
          }
          delta={quarterlyLive ? `${formatDelta(patYoy)} YoY` : undefined}
          trend={quarterlyLive ? trend(patYoy) : undefined}
          note={financialsNote}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Demo · 24-month series · operating AUM not yet sourced">
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card title="SIP Flow" subtitle="Demo · monthly inflows · SIP not yet sourced">
          <BarSeries data={sipSeries} name="SIP" />
        </Card>
        <Card
          title="Quarterly P&L"
          subtitle={
            quarterlyLive
              ? "Revenue / Op / PAT · ₹ Cr"
              : financialsUnavailableMessage
          }
        >
          {quarterlyLive ? (
            <GroupedBars
              data={pnlData}
              xKey="quarter"
              bars={[
                { key: "revenue", name: "Revenue", color: "hsl(var(--chart-1))" },
                { key: "op", name: "Op Profit", color: "hsl(var(--chart-2))" },
                { key: "pat", name: "PAT", color: "hsl(var(--chart-3))" },
              ]}
            />
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              —
            </div>
          )}
        </Card>
        <Card
          title="Yields (bps of AAUM)"
          subtitle={
            quarterlyLive ? yieldsSubtitle : financialsUnavailableMessage
          }
        >
          {quarterlyLive && yieldsAvailable ? (
            <MultiLine
              data={yieldData}
              xKey="quarter"
              valueFormat="bps"
              axisFormat="bps"
              lines={[
                { key: "revenue", name: "Revenue realization", color: "hsl(var(--chart-1))" },
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
