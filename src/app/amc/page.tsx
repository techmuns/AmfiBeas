import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AmcQuadrantChart } from "@/components/charts/AmcQuadrantChart";
import { MarketShareMovement } from "@/components/charts/MarketShareMovement";
import { Heatmap } from "@/components/charts/Heatmap";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
import { StrategicMovesCohortLane } from "@/components/amc/StrategicMovesCohortLane";
import { CohortUniqueInvestorShare } from "@/components/amc/CohortUniqueInvestorShare";
import { IndustryConcentrationStack } from "@/components/amc/IndustryConcentrationStack";
import { AmcCashAllocationTrend } from "@/components/amc/AmcCashAllocationTrend";
import { AmcStockConcentration } from "@/components/amc/AmcStockConcentration";
import { amcIndexRows } from "@/data/amc-detail";
import {
  amcHealthGrowthMatrix,
  amcTrajectoryQuadrant,
  cohortJourneyMap,
  latestQoqAnomalies,
  type AmcQuadrant,
  type AmcQuadrantPoint,
} from "@/data/amc-peer-universe";
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
  const health = amcHealthGrowthMatrix(8);
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

      {activeTab === "share-positioning" && journeyPoints.length >= 4 && (
        <Card
          title="Market-share movement"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Who gained or lost market share over the full available window.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`One row per AMC, sorted by change · ${journeyPoints[0].startQuarterLabel} → ${journeyPoints[0].endQuarterLabel}`}
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
          <MarketShareMovement points={journeyPoints} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Bar length = size of the move over the window · green = share
            gainers · red = share losers. &ldquo;Now&rdquo; is the latest-quarter
            market share.
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
                {`QoQ AAUM growth · ${health.quarterLabels[0]} → ${health.quarterLabels[health.quarterLabels.length - 1]} · Source: AMFI Fundwise AAUM`}
              </p>
            </div>
          }
        >
          <Heatmap
            rows={healthDisplayRows}
            columns={health.quarterLabels}
            min={-6}
            max={12}
            cellMinWidth={44}
            showAllColumnLabels
            valueSuffix="%"
          />
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Each cell = QoQ AAUM growth (%).
            <span className="text-positive">Green</span> = growth,{" "}
            <span className="text-negative">red</span> = contraction.
            <InfoTooltip label="Muted cells indicate the AMC didn't have a prior-quarter AAUM row. AMCs sorted by latest-quarter AAUM (largest at top)." />
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
