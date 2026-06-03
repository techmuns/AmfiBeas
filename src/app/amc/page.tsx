import Link from "next/link";
import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
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
import { amcAaumSeries, amcIndexRows } from "@/data/amc-detail";
import {
  amcHealthGrowthMatrix,
  amcHealthGrowthZScoreMatrix,
  amcTrajectoryQuadrant,
  cohortJourneyMap,
  latestQoqAnomalies,
  type AmcQuadrant,
  type AmcQuadrantPoint,
} from "@/data/amc-peer-universe";
import { LensToggle } from "@/components/ui/LensToggle";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { resolveTab } from "@/lib/tabs";

const AMC_TABS = [
  { id: "overview", label: "AMC Overview" },
  { id: "insights", label: "Insights" },
  { id: "share-positioning", label: "Share & Positioning" },
] as const satisfies readonly DashboardTabDef[];
type AmcTabId = (typeof AMC_TABS)[number]["id"];
const AMC_TAB_IDS = AMC_TABS.map((t) => t.id) as readonly AmcTabId[];

export default async function AmcListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const healthLens: "growth" | "zscore" =
    sp.healthLens === "zscore" ? "zscore" : "growth";
  const activeTab = resolveTab<AmcTabId>(sp.tab, AMC_TAB_IDS, "overview");
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

  return (
    <div className="space-y-6">
      <PageHeader title="AMCs" subtitle={subtitle} />

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
