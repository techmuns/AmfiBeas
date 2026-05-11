import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { IndustryNarrative } from "@/components/data/IndustryNarrative";
import {
  industryByMonth,
  industryQuarterly,
  latestMonth,
  latestQuarter,
  momChange,
  yoyChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { amfiMonthlyRows } from "@/data/amfi-monthly";
import { industryNarrative } from "@/data/narrative";
import {
  formatCompactCrSafe,
  formatDelta,
  formatLakhSafe,
  formatPctSafe,
  formatQuarterLabelLong,
} from "@/lib/format";

const AMFI_MONTHLY_SOURCE = "Source: AMFI Monthly Report";
const SCREENER_SOURCE = "Source: Screener / company filings";

export default function HomePage() {
  const monthly = industryByMonth();
  const quarterly = industryQuarterly();
  const latest = monthly[monthly.length - 1];
  const latestQ = quarterly[quarterly.length - 1];

  const aumYoy = yoyChange(monthly.map((m) => m.totalAum));
  const activeEquityMom = momChange(monthly.map((m) => m.activeEquityAum));
  const sipMom = momChange(monthly.map((m) => m.sipContribution));
  const investorsMom = momChange(monthly.map((m) => m.investorAdditions));
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

  // AUM Trend + SIP Flows on the Overview now read directly from the
  // live AMFI Monthly Report snapshot (amfi-monthly-pdf.json via
  // amfiMonthlyRows). Each chart filters to months where the relevant
  // field is actually present in the snapshot — no synthetic months
  // and no fake future ticks.
  const amfiRows = amfiMonthlyRows();
  const aumSeries = amfiRows.flatMap((r) =>
    typeof r.totalAum === "number"
      ? [{ month: r.month, value: r.totalAum }]
      : []
  );
  const sipSeries = amfiRows.flatMap((r) =>
    typeof r.sipContribution === "number"
      ? [{ label: r.month, value: r.sipContribution }]
      : []
  );

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const patMargin =
    latestQ.revenue > 0 ? (latestQ.pat / latestQ.revenue) * 100 : null;

  const narrative = industryNarrative(6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={`Industry snapshot · ${latestMonth()} (operating) · ${formatQuarterLabelLong(latestQuarter())} (financial)`}
      />

      {narrative.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              What changed this month
            </h2>
            <p className="text-xs text-muted-foreground">
              Rule-based facts derived from the latest snapshot · sorted by
              significance · top {narrative.length}
            </p>
          </div>
          <IndustryNarrative facts={narrative} />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Industry AUM"
          value={formatCompactCrSafe(latest.totalAum)}
          delta={`${formatDelta(aumYoy)} YoY`}
          trend={trend(aumYoy)}
          note={AMFI_MONTHLY_SOURCE}
        />
        <KpiCard
          label="Active Equity AUM"
          value={formatCompactCrSafe(latest.activeEquityAum)}
          delta={`${formatDelta(activeEquityMom)} MoM`}
          trend={trend(activeEquityMom)}
          note={AMFI_MONTHLY_SOURCE}
        />
        <KpiCard
          label="Monthly SIP"
          value={formatCompactCrSafe(latest.sipContribution)}
          delta={`${formatDelta(sipMom)} MoM`}
          trend={trend(sipMom)}
          note={AMFI_MONTHLY_SOURCE}
        />
        <KpiCard
          label="Investor Additions"
          value={formatLakhSafe(latest.investorAdditions)}
          delta={`${formatDelta(investorsMom)} MoM`}
          trend={trend(investorsMom)}
          note={AMFI_MONTHLY_SOURCE}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Listed AMC Revenue"
          value={formatCompactCrSafe(latestQ.revenue)}
          note={SCREENER_SOURCE}
        />
        <KpiCard
          label="Listed AMC Op Profit"
          value={formatCompactCrSafe(latestQ.operatingProfit)}
          note={SCREENER_SOURCE}
        />
        <KpiCard
          label="Listed AMC PAT"
          value={formatCompactCrSafe(latestQ.pat)}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
          note={SCREENER_SOURCE}
        />
        <KpiCard
          label="Listed AMC PAT Margin"
          value={formatPctSafe(patMargin)}
          note={SCREENER_SOURCE}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          title="AUM Trend"
          subtitle={`Industry total · ${aumSeries.length} month${aumSeries.length === 1 ? "" : "s"} · ${AMFI_MONTHLY_SOURCE}`}
        >
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
        <Card
          title="SIP Flows"
          subtitle={`Monthly inflows · industry · ${sipSeries.length} month${sipSeries.length === 1 ? "" : "s"} · ${AMFI_MONTHLY_SOURCE}`}
        >
          <BarSeries data={sipSeries} name="SIP" />
        </Card>
      </section>

      <Card
        title="Premium Data"
        subtitle="Licensed Morningstar datasets that unlock scheme-level KPIs"
        action={
          <Link
            href="/premium"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View licensed data options
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        <div className="flex items-start gap-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="text-muted-foreground">
            Scheme ratings, fund factsheets, holdings, risk metrics, and peer
            quartiles become available with a Morningstar license. The
            dashboard does not synthesise these values when no license is
            connected.{" "}
            <Link
              href="/premium"
              className="text-foreground underline-offset-2 hover:underline"
            >
              See the full list →
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
