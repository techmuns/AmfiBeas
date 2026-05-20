import Link from "next/link";
import { ArrowLeftRight, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AmcBattleCard } from "@/components/ui/AmcBattleCard";
import { AmcQuadrantChart } from "@/components/charts/AmcQuadrantChart";
import { CohortJourneyMap } from "@/components/charts/CohortJourneyMap";
import { Heatmap } from "@/components/charts/Heatmap";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
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
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { TabIntroCard } from "@/components/ui/TabIntroCard";
import { resolveTab } from "@/lib/tabs";

const AMC_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "share-movers", label: "Share Movers" },
  { id: "positioning", label: "Positioning" },
  { id: "roster", label: "Roster" },
  { id: "health", label: "Health" },
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
  const activeTab = resolveTab<AmcTabId>(sp.tab, AMC_TAB_IDS, "snapshot");
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

  // Cohort journey arrows (5Y / full-history span).
  const journeyPoints = cohortJourneyMap(20) ?? [];

  // Battle-cards rolodex — top 12 AMCs by AAUM, with their AAUM
  // sparkline pulled from amc-detail. The card grid replaces the
  // tabular row scan with a visual scan.
  const battleCards = quadrant
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
      <PageHeader
        title="AMCs"
        subtitle={subtitle}
        action={
          <Link
            href="/compare"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Compare two AMCs
          </Link>
        }
      />

      <DashboardTabs
        tabs={AMC_TABS}
        activeId={activeTab}
        searchParams={sp}
      />

      {activeTab === "snapshot" && (
        <TabIntroCard
          headline="Which AMCs moved the most this quarter?"
          summary="Outliers vs the cohort median — names that grew or shrank ≥ 2σ from the median QoQ AAUM growth. Tiny-base names are flagged so a fast-grower from a small denominator doesn't get mistaken for a franchise shift."
          watchNext="Whether the same names show up in the Share Movers and Positioning tabs."
        />
      )}

      {activeTab === "snapshot" && anomalies && anomalies.outliers.length > 0 && (
        <Card
          title="Outliers this quarter"
          subtitle={`${anomalies.outliers.length} AMC${anomalies.outliers.length === 1 ? "" : "s"} with QoQ AAUM growth ≥2σ from the cohort median in ${anomalies.quarterLabel} · ${anomalies.participantCount} AMCs measured · Source: AMFI Fundwise AAUM`}
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

      {activeTab === "roster" && (
        <TabIntroCard
          headline="Who are the top AMCs at a glance?"
          summary="One card per AMC in the top cohort. Rank, share-tier, market share, QoQ and YoY growth, and the trailing AAUM line — everything you need for a fast cross-name scan."
          watchNext="Whether any rank-7 to rank-15 names are quietly compounding faster than the Top-7."
        />
      )}

      {activeTab === "roster" && battleCards.length > 0 && (
        <Card
          title="AMC Roster"
          subtitle="Each card is one AMC · rank, tier, share, growth and trailing AAUM at a glance"
        >
          <div className="overflow-x-auto">
            <div className="flex gap-3" style={{ minWidth: "max-content" }}>
              {battleCards.map((c) => (
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

      {activeTab === "share-movers" && (
        <TabIntroCard
          headline="Which AMCs are gaining or losing market share?"
          summary="Each arrow tracks one AMC's market-share move over the full available window. Green arrows are share gainers, red are losers, grey are roughly flat."
          watchNext="A deeper share-drift breakdown — momentum vs incumbent moat — is tracked in issue #177."
        />
      )}

      {activeTab === "share-movers" && journeyPoints.length >= 4 && (
        <Card
          title="Market-share movement"
          subtitle={`Each arrow = one AMC's market-share move from ${journeyPoints[0].startQuarterLabel} to ${journeyPoints[0].endQuarterLabel}`}
        >
          <CohortJourneyMap points={journeyPoints} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Green arrows = share gainers · red = share losers · grey = roughly flat.
            Hover an arrow for the precise pp move.
          </p>
        </Card>
      )}

      {activeTab === "positioning" && (
        <TabIntroCard
          headline="Who are the leaders, gainers, defenders and laggards?"
          summary="Top AMCs plotted against their share of cohort AAUM and their QoQ growth rate. Cohort-median splits separate the four buckets so the quadrants stay meaningful even when the whole industry is growing or contracting."
          watchNext="Whether names migrate between buckets quarter-over-quarter — challengers crossing into 'Leaders' is the structural signal."
        />
      )}

      {activeTab === "positioning" && quadrant && quadrant.points.length >= 4 && (
        <Card
          title="AMC Share vs Growth Quadrant"
          subtitle={`Top ${quadrant.points.length} AMCs by AAUM · ${quadrant.latestQuarterLabel} · cohort medians shown as dashed lines`}
        >
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <AmcQuadrantChart
              data={quadrant.points}
              medianSharePct={quadrant.medianSharePct}
              medianGrowthPct={quadrant.medianGrowthPct}
            />
            <QuadrantBucketsList buckets={quadrant.buckets} />
          </div>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Leaders: high share + above-median growth. Gainers: low share but
            growing faster than peers. Defenders: high share but slowing.
            Laggards: low share + below-median growth.
            <InfoTooltip
              label={`Y-axis: AMC's share of total cohort AAUM (top ${quadrant.points.length} AMCs). X-axis: QoQ AAUM growth (this quarter vs last). Both quadrant splits use the cohort median, not zero — so the buckets stay meaningful when the whole industry is growing or contracting. Dot size scales with market share.`}
            />
          </p>
        </Card>
      )}

      {activeTab === "health" && (
        <TabIntroCard
          headline="Which AMCs have been consistently healthy or fragile?"
          summary="QoQ AAUM growth rates (or z-scores vs the cohort) across the trailing 8 quarters. Stripes of green pick out steady compounders; stripes of red pick out structural laggards."
          watchNext="Whether the z-score view shows any AMC consistently > +1σ — that's a cohort-relative compounding signal."
        />
      )}

      {activeTab === "health" && health.rows.length > 0 && (
        <Card
          title="AMC Health Heatmap"
          subtitle={
            healthLens === "zscore"
              ? `QoQ growth z-score vs cohort each quarter · ${health.quarterLabels[0]} → ${health.quarterLabels[health.quarterLabels.length - 1]} · Source: AMFI Fundwise AAUM`
              : `QoQ AAUM growth · ${health.quarterLabels[0]} → ${health.quarterLabels[health.quarterLabels.length - 1]} · Source: AMFI Fundwise AAUM`
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

      {activeTab === "health" && <AmcSearchTable rows={data.rows} />}

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
