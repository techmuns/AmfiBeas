import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { IndustryNarrative } from "@/components/data/IndustryNarrative";
import {
  industryQuarterly,
  latestMonth,
  latestQuarter,
  momChange,
  yoyChange,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import {
  amfiMonthlyRows,
  latestIndustryFolioAdditions,
  monthlyIndustryFolioAdditionsTrend,
} from "@/data/amfi-monthly";
import { industryNarrative } from "@/data/narrative";
import {
  formatCompactCrSafe,
  formatDelta,
  formatLakhSafe,
  formatPctSafe,
  formatQuarterLabelLong,
} from "@/lib/format";

const AMFI_MONTHLY_SOURCE = "Source: AMFI Monthly Report";
const SCREENER_SOURCE = "Source: Company filings";

export default function HomePage() {
  // Live industry monthly snapshot (amfi-monthly-pdf.json) is now the
  // source of truth for every industry-level KPI on the Overview. The
  // synthetic `industryByMonth()` helper is no longer called here —
  // each KPI builds its own per-field series and drops months where the
  // field is absent in the snapshot. Demo April-2026 ticks gone.
  const amfiRows = amfiMonthlyRows();
  const totalAumSeries = amfiRows
    .filter((r): r is typeof r & { totalAum: number } => typeof r.totalAum === "number")
    .map((r) => r.totalAum);
  const activeEquityAumSeries = amfiRows
    .filter(
      (r): r is typeof r & { activeEquityAum: number } =>
        typeof r.activeEquityAum === "number"
    )
    .map((r) => r.activeEquityAum);
  const sipContribSeries = amfiRows
    .filter(
      (r): r is typeof r & { sipContribution: number } =>
        typeof r.sipContribution === "number"
    )
    .map((r) => r.sipContribution);

  const aumLatest =
    totalAumSeries.length > 0 ? totalAumSeries[totalAumSeries.length - 1] : null;
  const activeEquityLatest =
    activeEquityAumSeries.length > 0
      ? activeEquityAumSeries[activeEquityAumSeries.length - 1]
      : null;
  const sipLatest =
    sipContribSeries.length > 0
      ? sipContribSeries[sipContribSeries.length - 1]
      : null;

  const aumYoy = yoyChange(totalAumSeries);
  const activeEquityMom = momChange(activeEquityAumSeries);
  const sipMom = momChange(sipContribSeries);

  // Folio Additions replaces the previously-synthetic "Investor Additions"
  // tile. Value = latest month's industryFolios − previous month's
  // industryFolios (lakh scale). MoM delta compares that to the prior
  // month's additions so the tile reads as "how much did this month's
  // pace change vs last month's pace."
  const folioAdditionsTrend = monthlyIndustryFolioAdditionsTrend(24);
  const folioAdditionsLatest = latestIndustryFolioAdditions();
  const folioAdditionsMom =
    folioAdditionsTrend.length >= 2
      ? momChange(folioAdditionsTrend.map((r) => r.value))
      : 0;

  const quarterly = industryQuarterly();
  const latestQ = quarterly[quarterly.length - 1];
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

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
          value={formatCompactCrSafe(aumLatest)}
          delta={`${formatDelta(aumYoy)} YoY`}
          trend={trend(aumYoy)}
          note={AMFI_MONTHLY_SOURCE}
        />
        <KpiCard
          label="Active Equity AUM"
          value={formatCompactCrSafe(activeEquityLatest)}
          delta={`${formatDelta(activeEquityMom)} MoM`}
          trend={trend(activeEquityMom)}
          note={AMFI_MONTHLY_SOURCE}
        />
        <KpiCard
          label="Monthly SIP"
          value={formatCompactCrSafe(sipLatest)}
          delta={`${formatDelta(sipMom)} MoM`}
          trend={trend(sipMom)}
          note={AMFI_MONTHLY_SOURCE}
        />
        <KpiCard
          label="Industry Folio Additions"
          value={formatLakhSafe(folioAdditionsLatest)}
          delta={`${formatDelta(folioAdditionsMom)} MoM`}
          trend={trend(folioAdditionsMom)}
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
