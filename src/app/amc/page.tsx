import Link from "next/link";
import { ArrowLeftRight, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AmcBattleCard } from "@/components/ui/AmcBattleCard";
import { AmcQuadrantChart } from "@/components/charts/AmcQuadrantChart";
import { CohortJourneyMap } from "@/components/charts/CohortJourneyMap";
import { Heatmap } from "@/components/charts/Heatmap";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
import { StrategicMovesCohortLane } from "@/components/amc/StrategicMovesCohortLane";
import { CohortUniqueInvestorShare } from "@/components/amc/CohortUniqueInvestorShare";
import { IndustryConcentrationStack } from "@/components/amc/IndustryConcentrationStack";
import { AmcCashAllocationTrend } from "@/components/amc/AmcCashAllocationTrend";
import { AmcStockConcentration } from "@/components/amc/AmcStockConcentration";
import { amcAaumSeries, amcIndexRows, type AmcIndexRow } from "@/data/amc-detail";
import {
  amcHealthGrowthMatrix,
  amcHealthGrowthZScoreMatrix,
  amcTrajectoryQuadrant,
  cohortJourneyMap,
  latestQoqAnomalies,
  type AmcQuadrant,
  type AmcQuadrantPoint,
} from "@/data/amc-peer-universe";
import {
  SOURCED_FINANCIALS_SLUGS,
  quarterlyForAmc,
  yieldsForAmc,
  type QuarterlyYields,
} from "@/data/aggregate";
import type { QuarterlyFinancial } from "@/data/types";
import { AMCS } from "@/data/amcs";
import { AMC_COLORS, amcShortLabel } from "@/lib/chart-meta";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import type { ValueFormat, AxisFormat } from "@/components/charts/format";
import { LensToggle } from "@/components/ui/LensToggle";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { TabIntroCard } from "@/components/ui/TabIntroCard";
import { resolveTab } from "@/lib/tabs";

const AMC_TABS = [
  { id: "overview", label: "AMC Overview" },
  { id: "insights", label: "Insights" },
  { id: "share-positioning", label: "Share & Positioning" },
  { id: "compare", label: "Compare" },
] as const satisfies readonly DashboardTabDef[];
type AmcTabId = (typeof AMC_TABS)[number]["id"];
const AMC_TAB_IDS = AMC_TABS.map((t) => t.id) as readonly AmcTabId[];

// ---- Compare tab: switchable KPIs for the two horizontal-bar charts ----
// Every metric here is REAL (company filings + AMFI Fundwise AAUM); the
// synthetic per-AMC monthly series in generator.ts is deliberately excluded.
type KpiSpec = {
  label: string;
  short: string;
  valueFormat: ValueFormat;
  axisFormat: AxisFormat;
};

const FIN_KPIS = {
  pat: { label: "Net Profit (PAT)", short: "PAT", valueFormat: "cr", axisFormat: "cr" },
  revenue: { label: "Operating Revenue", short: "Revenue", valueFormat: "cr", axisFormat: "cr" },
  operatingProfit: { label: "Operating Profit", short: "Op. Profit", valueFormat: "cr", axisFormat: "cr" },
  patMargin: { label: "PAT Margin", short: "PAT Margin", valueFormat: "pct", axisFormat: "pct" },
  opMargin: { label: "Operating Margin", short: "Op. Margin", valueFormat: "pct", axisFormat: "pct" },
  revenueYield: { label: "Revenue Yield", short: "Rev. Yield", valueFormat: "bps", axisFormat: "bps" },
  profitYield: { label: "Profit Yield", short: "Profit Yield", valueFormat: "bps", axisFormat: "bps" },
} satisfies Record<string, KpiSpec>;
type FinKpiId = keyof typeof FIN_KPIS;
const FIN_KPI_DEFAULT: FinKpiId = "pat";
const finLenses = (Object.keys(FIN_KPIS) as FinKpiId[]).map((k) => ({
  value: k,
  label: FIN_KPIS[k].short,
}));

const AUM_KPIS = {
  avgAum: { label: "Average AUM", short: "AAUM", valueFormat: "cr", axisFormat: "cr" },
  marketShare: { label: "Market Share", short: "Mkt Share", valueFormat: "pct", axisFormat: "pct" },
  qoqGrowth: { label: "QoQ AAUM Growth", short: "QoQ", valueFormat: "pct", axisFormat: "pct" },
  yoyGrowth: { label: "YoY AAUM Growth", short: "YoY", valueFormat: "pct", axisFormat: "pct" },
} satisfies Record<string, KpiSpec>;
type AumKpiId = keyof typeof AUM_KPIS;
const AUM_KPI_DEFAULT: AumKpiId = "avgAum";
const aumLenses = (Object.keys(AUM_KPIS) as AumKpiId[]).map((k) => ({
  value: k,
  label: AUM_KPIS[k].short,
}));

function finValue(kpi: FinKpiId, f: QuarterlyFinancial, y: QuarterlyYields): number {
  switch (kpi) {
    case "pat": return f.pat;
    case "revenue": return f.revenue;
    case "operatingProfit": return f.operatingProfit;
    case "patMargin": return y.patMargin;
    case "opMargin": return y.opMargin;
    case "revenueYield": return y.revenueYieldBps;
    case "profitYield": return y.profitYieldBps;
  }
}

function aumValue(kpi: AumKpiId, r: AmcIndexRow): number | null {
  switch (kpi) {
    case "avgAum": return r.avgAum;
    case "marketShare": return r.marketSharePct;
    case "qoqGrowth": return r.qoqGrowthPct;
    case "yoyGrowth": return r.yoyGrowthPct;
  }
}

export default async function AmcListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const healthLens: "growth" | "zscore" =
    sp.healthLens === "zscore" ? "zscore" : "growth";
  const activeTab = resolveTab<AmcTabId>(sp.tab, AMC_TAB_IDS, "overview");
  const finKpi: FinKpiId =
    typeof sp.finKpi === "string" && sp.finKpi in FIN_KPIS
      ? (sp.finKpi as FinKpiId)
      : FIN_KPI_DEFAULT;
  const aumKpi: AumKpiId =
    typeof sp.aumKpi === "string" && sp.aumKpi in AUM_KPIS
      ? (sp.aumKpi as AumKpiId)
      : AUM_KPI_DEFAULT;
  const data = amcIndexRows();

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="AMCs" subtitle="No AAUM data available." />
      </div>
    );
  }

  const subtitle = `${data.rows.length} AMCs · ${data.fiscalLabel}`;
  const health =
    healthLens === "zscore"
      ? amcHealthGrowthZScoreMatrix(8)
      : amcHealthGrowthMatrix(8);
  const healthDisplayRows = health.rows.map((r) => ({
    label: r.displayName,
    values: r.values,
  }));
  const anomalies = latestQoqAnomalies(2);
  const quadrant = amcTrajectoryQuadrant(30);

  // Market-share movement arrows over the full available window.
  const journeyPoints = cohortJourneyMap(20) ?? [];

  // Leaderboard read for the share-movement card: biggest share gainer /
  // loser over the window and the top-5 concentration.
  const shareLeaders =
    journeyPoints.length >= 4
      ? (() => {
          const byDelta = [...journeyPoints].sort(
            (a, b) => b.shareDeltaPp - a.shareDeltaPp
          );
          const top5 = [...journeyPoints]
            .sort((a, b) => b.endMarketSharePct - a.endMarketSharePct)
            .slice(0, 5)
            .reduce((s, p) => s + p.endMarketSharePct, 0);
          return {
            gainer: byDelta[0],
            loser: byDelta[byDelta.length - 1],
            top5,
            start: journeyPoints[0].startQuarterLabel,
            end: journeyPoints[0].endQuarterLabel,
          };
        })()
      : null;

  // AMC Roster cards — top 12 AMCs by AAUM, with their AAUM
  // sparkline pulled from amc-detail. The card grid replaces the
  // tabular row scan with a visual scan.
  const rosterCards = quadrant
    ? [...quadrant.points]
        .slice(0, 12)
        .map((p) => {
          const indexRow = data.rows.find((r) => r.amcSlug === p.slug);
          const series = amcAaumSeries(p.slug);
          return {
            slug: p.slug,
            displayName: p.displayName,
            rank: indexRow?.rank ?? 0,
            outOf: data.rows.length,
            marketSharePct: p.marketSharePct,
            qoqGrowthPct: p.qoqGrowthPct,
            yoyGrowthPct: indexRow?.yoyGrowthPct ?? null,
            isTop7: indexRow?.isTop7 ?? false,
            sparkline: series.map((s) => ({
              label: s.fiscalLabel,
              value: s.avgAum,
            })),
          };
        })
    : [];

  // ---- Compare tab data: listed AMCs only -----------------------------
  const listedAmcs = AMCS.filter((a) => a.listed);
  const listedSlugSet = new Set(listedAmcs.map((a) => a.slug));

  // Chart 2 — AUM & market position: every listed AMC from the AAUM ranking.
  const aumCompareBars = data.rows
    .filter((r) => listedSlugSet.has(r.amcSlug))
    .map((r) => ({
      label: amcShortLabel(r.amcSlug),
      value: aumValue(aumKpi, r),
      color: AMC_COLORS[r.amcSlug],
    }))
    .filter((d): d is { label: string; value: number; color: string } =>
      typeof d.value === "number" && Number.isFinite(d.value)
    )
    .sort((a, b) => b.value - a.value);

  // Chart 1 — financial performance: listed AMCs with a sourced P&L,
  // aligned to the latest reported quarter present across them.
  const sourcedListed = listedAmcs.filter((a) =>
    SOURCED_FINANCIALS_SLUGS.has(a.slug)
  );
  const finQuarters = sourcedListed.flatMap((a) =>
    quarterlyForAmc(a.slug).map((q) => q.quarter)
  );
  const finQuarter =
    finQuarters.length > 0 ? [...finQuarters].sort().pop()! : null;
  const finCompareBars = sourcedListed
    .map((a) => {
      const series = quarterlyForAmc(a.slug);
      const yields = yieldsForAmc(a.slug);
      const f =
        series.find((q) => q.quarter === finQuarter) ??
        series[series.length - 1];
      const y =
        yields.find((q) => q.quarter === finQuarter) ??
        yields[yields.length - 1];
      if (!f || !y) return null;
      return {
        label: amcShortLabel(a.slug),
        value: finValue(finKpi, f, y),
        color: AMC_COLORS[a.slug],
      };
    })
    .filter((d): d is { label: string; value: number; color: string } =>
      d !== null && Number.isFinite(d.value)
    )
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AMCs"
        subtitle={subtitle}
        action={
          <Link
            href="/amc?tab=compare"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Compare AMCs
          </Link>
        }
      />

      <DashboardTabs
        basePath="/amc"
        tabs={AMC_TABS}
        activeId={activeTab}
        searchParams={sp}
      />

      {activeTab === "overview" && anomalies && anomalies.outliers.length > 0 && (
        <Card
          title="Outliers this quarter"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                AMCs whose QoQ AAUM growth is far above or below the cohort median this quarter.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`${anomalies.outliers.length} AMC${anomalies.outliers.length === 1 ? "" : "s"} ≥2σ from cohort median in ${anomalies.quarterLabel} · ${anomalies.participantCount} AMCs measured · Source: AMFI Fundwise AAUM`}
              </p>
            </div>
          }
        >
          <ul className="flex flex-wrap gap-2">
            {anomalies.outliers.map((a) => {
              const Icon = a.direction === "up" ? TrendingUp : TrendingDown;
              return (
                <li key={a.amcSlug}>
                  <Link
                    href={`/amc/${a.amcSlug}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                      a.direction === "up"
                        ? "border-positive/40 bg-positive/10 text-positive"
                        : "border-negative/40 bg-negative/10 text-negative",
                      a.isTinyBase && "opacity-80"
                    )}
                    title={`QoQ ${a.qoqGrowthPct.toFixed(2)}% · ${a.zScore >= 0 ? "+" : ""}${a.zScore.toFixed(2)}σ from median ${anomalies.medianQoqPct.toFixed(2)}% · Latest AAUM ${a.latestAumCr.toFixed(0)} Cr${a.isTinyBase ? " (tiny base — % growth amplified by small denominator)" : ""}`}
                  >
                    <Icon className="h-3 w-3" />
                    <span className="font-medium">{a.displayName}</span>
                    <span className="tabular">
                      {a.qoqGrowthPct >= 0 ? "+" : ""}
                      {a.qoqGrowthPct.toFixed(1)}%
                    </span>
                    <span className="text-[10px] tabular opacity-75">
                      {a.zScore >= 0 ? "+" : ""}
                      {a.zScore.toFixed(1)}σ
                    </span>
                    {a.isTinyBase && (
                      <span className="rounded-full border border-foreground/20 bg-muted px-1.5 py-0 text-[9px] uppercase tracking-wide text-muted-foreground">
                        Tiny-base
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" />
            Cohort median QoQ growth: {anomalies.medianQoqPct.toFixed(2)}% ·
            stdDev {anomalies.stdDevPct.toFixed(2)} pp. Tiny-base names sit
            below 0.25% of the cohort AUM — their % growth is amplified by
            a small denominator, not by a franchise shift.
            <InfoTooltip label="Outliers are AMCs whose latest QoQ growth sits ≥2 standard deviations from the cohort median — investigate before drawing conclusions; could be a new AMC ramping up, a one-off reclassification, or a structural shift. Ordering: non-tiny-base names first, ranked by absolute ₹ Cr ΔAUM." />
          </p>
        </Card>
      )}

      {activeTab === "insights" && <AmcStockConcentration />}

      {activeTab === "insights" && <CohortUniqueInvestorShare />}

      {activeTab === "insights" && (
        <StrategicMovesCohortLane
          selectedAmc={typeof sp.moveAmc === "string" ? sp.moveAmc : undefined}
          selectedPeriod={
            typeof sp.movePeriod === "string" ? sp.movePeriod : undefined
          }
        />
      )}

      {activeTab === "overview" && rosterCards.length > 0 && (
        <Card
          title="AMC Roster"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Every AMC at a glance, sorted by rank. Each card shows market share, growth, and the trailing AAUM sparkline.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                Scroll horizontally to see all AMCs.
              </p>
            </div>
          }
        >
          <HowToRead>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><span className="text-foreground">Rank</span> is by AAUM (lower number = larger AMC).</li>
              <li><span className="text-foreground">Top 7</span> AMCs typically hold ~70% of total industry AUM — the rest is a long tail.</li>
              <li>Sparkline shows the trailing AAUM path; the QoQ / YoY growth numbers next to it tell you the recent direction.</li>
            </ul>
          </HowToRead>
          <div className="overflow-x-auto">
            <div className="flex gap-3" style={{ minWidth: "max-content" }}>
              {rosterCards.map((c) => (
                <div key={c.slug} className="w-[200px] shrink-0">
                  <AmcBattleCard
                    slug={c.slug}
                    displayName={c.displayName}
                    rank={c.rank}
                    outOf={c.outOf}
                    marketSharePct={c.marketSharePct}
                    qoqGrowthPct={c.qoqGrowthPct}
                    yoyGrowthPct={c.yoyGrowthPct}
                    isTop7={c.isTop7}
                    sparkline={c.sparkline}
                  />
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {activeTab === "share-positioning" && (
        <TabIntroCard
          headline="Who is gaining or losing share, and how are AMCs positioned?"
          summary="Market-share movement arrows over the full available window, paired with the share-vs-growth quadrant and Leaders / Gainers / Defenders / Laggards bucket lists. Read for cohort-relative positioning, not absolute scale."
          watchNext="Whether names that show up as share gainers also sit in the Leaders or Gainers buckets — that's the durable franchise signal."
        />
      )}

      {activeTab === "share-positioning" && journeyPoints.length >= 4 && (
        <Card
          title="Market-share movement"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Who gained or lost market share over the full available window.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Each arrow = one AMC · ${journeyPoints[0].startQuarterLabel} → ${journeyPoints[0].endQuarterLabel}`}
              </p>
            </div>
          }
        >
          {shareLeaders && (
            <KeyTakeaway
              className="mb-3"
              headline={
                <>
                  Over {shareLeaders.start} → {shareLeaders.end},{" "}
                  <strong>{shareLeaders.gainer.displayName}</strong> gained the
                  most market share (
                  <span className="text-positive">
                    +{shareLeaders.gainer.shareDeltaPp.toFixed(2)}pp
                  </span>{" "}
                  to {shareLeaders.gainer.endMarketSharePct.toFixed(2)}%), while{" "}
                  <strong>{shareLeaders.loser.displayName}</strong> lost the most
                  (
                  <span className="text-negative">
                    {shareLeaders.loser.shareDeltaPp.toFixed(2)}pp
                  </span>{" "}
                  to {shareLeaders.loser.endMarketSharePct.toFixed(2)}%).
                </>
              }
              detail={
                <>
                  Top-5 AMCs now hold {shareLeaders.top5.toFixed(1)}% of cohort
                  AAUM.
                </>
              }
            />
          )}
          <CohortJourneyMap points={journeyPoints} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Green arrows = share gainers · red = share losers · grey = roughly flat.
            Hover an arrow for the precise pp move.
          </p>
        </Card>
      )}

      {activeTab === "share-positioning" && quadrant && quadrant.points.length >= 4 && (
        <Card
          title="AMC Share vs Growth Quadrant"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Each AMC plotted by market share (Y-axis) and QoQ growth (X-axis). The two dashed lines split the cohort at its medians, not at zero.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Top ${quadrant.points.length} AMCs by AAUM · ${quadrant.latestQuarterLabel} · cohort medians shown as dashed lines`}
              </p>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <AmcQuadrantChart
              data={quadrant.points}
              medianSharePct={quadrant.medianSharePct}
              medianGrowthPct={quadrant.medianGrowthPct}
            />
            <QuadrantBucketsList buckets={quadrant.buckets} />
          </div>
          <HowToRead>
            <p className="inline-flex items-center gap-1.5">
              Leaders: high share + above-median growth. Gainers: low share but
              growing faster than peers. Defenders: high share but slowing.
              Laggards: low share + below-median growth.
              <InfoTooltip
                label={`Y-axis: AMC's share of total cohort AAUM (top ${quadrant.points.length} AMCs). X-axis: QoQ AAUM growth (this quarter vs last). Both quadrant splits use the cohort median, not zero — so the buckets stay meaningful when the whole industry is growing or contracting. Dot size scales with market share.`}
              />
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><span className="text-foreground">Leader</span> = high share + high growth (compounding from a strong base).</li>
              <li><span className="text-foreground">Challenger / Gainer</span> = low share + high growth (catching up).</li>
              <li><span className="text-foreground">Defender</span> = high share + slowing growth (mature franchise, risk of share loss).</li>
              <li><span className="text-foreground">Laggard</span> = low share + weak growth (no momentum signal yet).</li>
            </ul>
          </HowToRead>
        </Card>
      )}

      {activeTab === "share-positioning" && <AmcCashAllocationTrend />}

      {activeTab === "share-positioning" && <IndustryConcentrationStack />}

      {activeTab === "overview" && health.rows.length > 0 && (
        <Card
          title="AMC Health Heatmap"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Each row is one AMC. Each cell colours the quarter green or red depending on whether that AMC outperformed or underperformed the cohort.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`${healthLens === "zscore" ? "QoQ growth z-score vs cohort" : "QoQ AAUM growth"} · ${health.quarterLabels[0]} → ${health.quarterLabels[health.quarterLabels.length - 1]} · Source: AMFI Fundwise AAUM`}
              </p>
            </div>
          }
          action={
            <LensToggle
              basePath="/amc"
              paramName="healthLens"
              defaultValue="growth"
              lenses={[
                { value: "growth", label: "Growth %" },
                { value: "zscore", label: "Z-score" },
              ]}
              active={healthLens}
              preserveParams={{
                tab: typeof sp.tab === "string" ? sp.tab : undefined,
              }}
            />
          }
        >
          <Heatmap
            rows={healthDisplayRows}
            columns={health.quarterLabels}
            min={healthLens === "zscore" ? -2 : -6}
            max={healthLens === "zscore" ? 2 : 12}
            cellMinWidth={44}
            showAllColumnLabels
            valueSuffix={healthLens === "zscore" ? "σ" : "%"}
          />
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {healthLens === "zscore" ? (
              <>
                Each cell = AMC&rsquo;s QoQ growth z-score vs the cohort&rsquo;s
                mean that quarter. Saturates at ±2σ.
                <InfoTooltip label="z = (AMC's QoQ growth − cohort mean) ÷ cohort stdDev (population). Quarters where the cohort has fewer than 2 AMCs with a growth value, or where stdDev is zero, render as muted." />
              </>
            ) : (
              <>
                Each cell = QoQ AAUM growth (%).
                <span className="text-positive">Green</span> = growth,{" "}
                <span className="text-negative">red</span> = contraction.
                <InfoTooltip label="Muted cells indicate the AMC didn't have a prior-quarter AAUM row. AMCs sorted by latest-quarter AAUM (largest at top)." />
              </>
            )}
          </p>
        </Card>
      )}

      {activeTab === "overview" && <AmcSearchTable rows={data.rows} />}

      {activeTab === "compare" && (
        <TabIntroCard
          headline="How do the listed AMCs stack up on financials and AUM?"
          summary="Side-by-side bars across the publicly-listed AMCs. Switch the KPI on each chart to re-rank the cohort — financial performance (company filings) on top, AUM & market position (AMFI Fundwise AAUM) below."
          watchNext="Whether the AMC that leads on AUM scale also leads on profitability — size and margin don't always travel together."
        />
      )}

      {activeTab === "compare" && (
        <Card
          title="Financial performance"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Listed AMCs ranked on the selected financial KPI.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`${finCompareBars.length} listed AMC${finCompareBars.length === 1 ? "" : "s"} with reported financials${finQuarter ? ` · ${finQuarter}` : ""} · Source: Company filings · AMFI Fundwise AAUM (yield base)`}
              </p>
            </div>
          }
        >
          <div className="mb-3">
            <LensToggle
              basePath="/amc"
              paramName="finKpi"
              defaultValue={FIN_KPI_DEFAULT}
              lenses={finLenses}
              active={finKpi}
              wrap
              preserveParams={{
                tab: "compare",
                aumKpi: aumKpi === AUM_KPI_DEFAULT ? undefined : aumKpi,
              }}
            />
          </div>
          {finCompareBars.length > 0 ? (
            <HorizontalBars
              data={finCompareBars}
              seriesName={FIN_KPIS[finKpi].label}
              valueFormat={FIN_KPIS[finKpi].valueFormat}
              axisFormat={FIN_KPIS[finKpi].axisFormat}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No sourced financials available yet.
            </div>
          )}
        </Card>
      )}

      {activeTab === "compare" && (
        <Card
          title="AUM & market position"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Listed AMCs ranked on the selected AUM / market KPI.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`${aumCompareBars.length} listed AMC${aumCompareBars.length === 1 ? "" : "s"} · ${data.fiscalLabel} · Source: AMFI Fundwise AAUM`}
              </p>
            </div>
          }
        >
          <div className="mb-3">
            <LensToggle
              basePath="/amc"
              paramName="aumKpi"
              defaultValue={AUM_KPI_DEFAULT}
              lenses={aumLenses}
              active={aumKpi}
              wrap
              preserveParams={{
                tab: "compare",
                finKpi: finKpi === FIN_KPI_DEFAULT ? undefined : finKpi,
              }}
            />
          </div>
          {aumCompareBars.length > 0 ? (
            <HorizontalBars
              data={aumCompareBars}
              seriesName={AUM_KPIS[aumKpi].label}
              valueFormat={AUM_KPIS[aumKpi].valueFormat}
              axisFormat={AUM_KPIS[aumKpi].axisFormat}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No AAUM data available.
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            <strong className="text-foreground">Source:</strong> AMFI
            Fundwise AAUM.
          </div>
          <div>
            <strong className="text-foreground">Universe:</strong> all AMCs
            with at least one quarter of <code>status=&quot;ok&quot;</code> AAUM
            data in the snapshot. PMS / AIF / offshore / advisory / alternates
            are not included.
          </div>
          <div>
            <strong className="text-foreground">Snapshot quarter:</strong>{" "}
            {data.fiscalLabel} ({data.quarter}).
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Compact 2×2 list view next to the quadrant chart. Each bucket
 *  shows up to 5 AMCs ordered by market share so the read scans
 *  largest-first. */
function QuadrantBucketsList({
  buckets,
}: {
  buckets: Record<AmcQuadrant, AmcQuadrantPoint[]>;
}) {
  const order: AmcQuadrant[] = ["Leaders", "Gainers", "Defenders", "Laggards"];
  const accent: Record<AmcQuadrant, string> = {
    Leaders: "border-positive/40 bg-positive/10 text-positive",
    Gainers: "border-[hsl(var(--chart-1))]/40 bg-[hsl(var(--chart-1))]/10 text-[hsl(var(--chart-1))]",
    Defenders: "border-[hsl(var(--chart-3))]/40 bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]",
    Laggards: "border-negative/40 bg-negative/10 text-negative",
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {order.map((q) => {
        const items = buckets[q].slice(0, 5);
        return (
          <div key={q} className="rounded-md border bg-card p-3 shadow-sm">
            <div className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              accent[q]
            )}>
              {q} · {buckets[q].length}
            </div>
            {items.length === 0 ? (
              <div className="mt-2 text-xs text-muted-foreground">No AMCs in this bucket this quarter.</div>
            ) : (
              <ul className="mt-2 space-y-1">
                {items.map((p) => (
                  <li key={p.slug} className="flex items-center justify-between gap-2 text-[11px]">
                    <Link
                      href={`/amc/${p.slug}`}
                      className="truncate hover:underline"
                      title={p.displayName}
                    >
                      {p.displayName}
                    </Link>
                    <span className="shrink-0 tabular text-muted-foreground">
                      {p.marketSharePct.toFixed(1)}% · {p.qoqGrowthPct >= 0 ? "+" : ""}
                      {p.qoqGrowthPct.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
