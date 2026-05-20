import Link from "next/link";
import { ArrowLeftRight, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AmcBattleCard } from "@/components/ui/AmcBattleCard";
import { AmcQuadrantChart } from "@/components/charts/AmcQuadrantChart";
import { CohortJourneyMap } from "@/components/charts/CohortJourneyMap";
import { Heatmap } from "@/components/charts/Heatmap";
import { SkyscraperCity } from "@/components/charts/SkyscraperCity";
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
import { isUnavailable } from "@/lib/format";
import { cn } from "@/lib/cn";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default async function AmcListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const healthLens: "growth" | "zscore" =
    sp.healthLens === "zscore" ? "zscore" : "growth";
  const driftLens: "topMovers" | "all" =
    sp.drift === "all" ? "all" : "topMovers";
  const data = amcIndexRows();

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="AMCs" subtitle="No AAUM data available." />
      </div>
    );
  }

  const subtitle = `${data.rows.length} AMCs · ${data.fiscalLabel}`;
  // We pull BOTH growth and z-score matrices so the summary cards above
  // the heatmap can read from either without recomputing.
  const healthGrowth = amcHealthGrowthMatrix(8);
  const healthZScore = amcHealthGrowthZScoreMatrix(8);
  const health = healthLens === "zscore" ? healthZScore : healthGrowth;
  const healthDisplayRows = health.rows.map((r) => ({
    label: r.displayName,
    values: r.values,
  }));
  const anomalies = latestQoqAnomalies(2);
  const quadrant = amcTrajectoryQuadrant(30);

  // Slug → AmcIndexRow lookup so YoY / rank can be joined into both
  // the Skyline rows and the Quadrant tooltips without recomputing
  // them from the snapshot.
  const indexBySlug = new Map(data.rows.map((r) => [r.amcSlug, r]));

  // Cohort 25th-percentile AAUM threshold for the tiny-base outlier
  // chip — tiny names with massive % growth often sit below this.
  const tinyBaseThreshold: number | null = (() => {
    if (!quadrant || quadrant.points.length === 0) return null;
    const aums = quadrant.points
      .map((p) => p.avgAum)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (aums.length === 0) return null;
    const idx = Math.floor(aums.length * 0.25);
    return aums[idx];
  })();

  // Ranked market-share table — top 15 AMCs by latest market share,
  // enriched with AAUM, rank, YoY and an 8-quarter AAUM sparkline so
  // each row carries the analytical context investors actually read.
  const skylineBars = quadrant
    ? [...quadrant.points]
        .sort((a, b) => b.marketSharePct - a.marketSharePct)
        .slice(0, 15)
        .map((p) => {
          const ir = indexBySlug.get(p.slug);
          const sparkline = amcAaumSeries(p.slug)
            .slice(-8)
            .map((s) => ({ label: s.fiscalLabel, value: s.avgAum }));
          return {
            slug: p.slug,
            displayName: p.displayName,
            marketSharePct: p.marketSharePct,
            qoqGrowthPct: p.qoqGrowthPct,
            aum: p.avgAum,
            rank: ir?.rank ?? null,
            yoyGrowthPct: ir?.yoyGrowthPct ?? null,
            sparkline,
          };
        })
    : [];

  // Cohort drift points (start-quarter to end-quarter market share
  // change). The journey helper returns the top-N AMCs by latest
  // AAUM; we apply our own gainers/losers slicing below.
  const allDriftPoints = cohortJourneyMap(20) ?? [];
  const gainers = [...allDriftPoints]
    .filter((p) => p.shareDeltaPp > 0)
    .sort((a, b) => b.shareDeltaPp - a.shareDeltaPp)
    .slice(0, 5);
  const losers = [...allDriftPoints]
    .filter((p) => p.shareDeltaPp < 0)
    .sort((a, b) => a.shareDeltaPp - b.shareDeltaPp)
    .slice(0, 5);
  const driftDisplayPoints =
    driftLens === "all" ? allDriftPoints : [...gainers, ...losers];

  // ---- AMC Signal Summary --------------------------------------------
  // Three columns: top share gainers, top share losers, emerging
  // challengers (sub-median-share AMCs with above-median growth, QoQ
  // first then YoY-fallback).
  const topGainers = [...allDriftPoints]
    .sort((a, b) => b.shareDeltaPp - a.shareDeltaPp)
    .slice(0, 3);
  const topLosers = [...allDriftPoints]
    .sort((a, b) => a.shareDeltaPp - b.shareDeltaPp)
    .slice(0, 3);
  const driftBySlug = new Map(allDriftPoints.map((p) => [p.amcSlug, p]));

  // Cohort median for QoQ growth (from quadrant.medianGrowthPct) and
  // for YoY (computed from indexRows, since AmcQuadrantPoint doesn't
  // carry yoyGrowthPct). Both default to null when the cohort doesn't
  // expose enough values to compute a median.
  const yoyGrowthValues: number[] = quadrant
    ? quadrant.points
        .map((p) => indexBySlug.get(p.slug)?.yoyGrowthPct ?? null)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  const medianYoyGrowthPct = median(yoyGrowthValues);
  const medianQoqGrowthPct = quadrant?.medianGrowthPct ?? null;
  const medianSharePct = quadrant?.medianSharePct ?? null;

  type EmergingChallenger = {
    slug: string;
    displayName: string;
    growthPct: number;
    growthDenom: "QoQ" | "YoY";
    shareGainBps: number | null;
  };
  const emergingChallengers: EmergingChallenger[] = (() => {
    if (
      !quadrant ||
      medianSharePct === null ||
      (medianQoqGrowthPct === null && medianYoyGrowthPct === null)
    ) {
      return [];
    }
    const out: EmergingChallenger[] = [];
    for (const p of quadrant.points) {
      if (p.marketSharePct >= medianSharePct) continue;
      const yoy = indexBySlug.get(p.slug)?.yoyGrowthPct ?? null;
      let growthPct: number | null = null;
      let growthDenom: "QoQ" | "YoY" | null = null;
      if (
        !isUnavailable(p.qoqGrowthPct) &&
        medianQoqGrowthPct !== null &&
        p.qoqGrowthPct > medianQoqGrowthPct
      ) {
        growthPct = p.qoqGrowthPct;
        growthDenom = "QoQ";
      } else if (
        isUnavailable(p.qoqGrowthPct) &&
        !isUnavailable(yoy) &&
        medianYoyGrowthPct !== null &&
        (yoy as number) > medianYoyGrowthPct
      ) {
        growthPct = yoy as number;
        growthDenom = "YoY";
      }
      if (growthPct === null || growthDenom === null) continue;
      const drift = driftBySlug.get(p.slug);
      const shareGainBps = drift ? drift.shareDeltaPp * 100 : null;
      out.push({
        slug: p.slug,
        displayName: p.displayName,
        growthPct,
        growthDenom,
        shareGainBps,
      });
    }
    out.sort((a, b) => {
      if (b.growthPct !== a.growthPct) return b.growthPct - a.growthPct;
      const aSg = a.shareGainBps ?? -Infinity;
      const bSg = b.shareGainBps ?? -Infinity;
      return bSg - aSg;
    });
    return out.slice(0, 3);
  })();
  const emergingUnavailable =
    quadrant &&
    medianSharePct !== null &&
    medianQoqGrowthPct === null &&
    medianYoyGrowthPct === null;

  // Health Heatmap summary cards — three institutional reads computed
  // off the same 8-quarter matrices as the heatmap itself.
  type HealthSummaryEntry = {
    slug: string;
    label: string;
    value: number;
    quarterLabel?: string;
  };
  const consistentGrowers: HealthSummaryEntry[] = (() => {
    const out: { row: typeof healthGrowth.rows[number]; mean: number; std: number }[] = [];
    for (const r of healthGrowth.rows) {
      const vals = r.values.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v)
      );
      if (vals.length < 4) continue;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (mean <= 0) continue;
      const variance =
        vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      const std = Math.sqrt(variance);
      out.push({ row: r, mean, std });
    }
    out.sort((a, b) => a.std / Math.max(a.mean, 0.001) - b.std / Math.max(b.mean, 0.001));
    return out.slice(0, 3).map((e) => ({
      slug: e.row.amcSlug,
      label: e.row.displayName,
      value: e.mean,
    }));
  })();
  const sharpestContractions: HealthSummaryEntry[] = (() => {
    const out: HealthSummaryEntry[] = [];
    for (const r of healthGrowth.rows) {
      let worst: number | null = null;
      let worstIdx = -1;
      r.values.forEach((v, i) => {
        if (typeof v === "number" && Number.isFinite(v)) {
          if (worst === null || v < worst) {
            worst = v;
            worstIdx = i;
          }
        }
      });
      if (worst !== null && worst < 0) {
        out.push({
          slug: r.amcSlug,
          label: r.displayName,
          value: worst,
          quarterLabel: healthGrowth.quarterLabels[worstIdx],
        });
      }
    }
    out.sort((a, b) => a.value - b.value);
    return out.slice(0, 3);
  })();
  const highestZScoreMovers: HealthSummaryEntry[] = (() => {
    const out: HealthSummaryEntry[] = [];
    const latestIdx = healthZScore.quarterLabels.length - 1;
    if (latestIdx < 0) return out;
    for (const r of healthZScore.rows) {
      const v = r.values[latestIdx];
      if (typeof v === "number" && Number.isFinite(v)) {
        out.push({ slug: r.amcSlug, label: r.displayName, value: v });
      }
    }
    out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return out.slice(0, 3);
  })();
  const hasHealthSummary =
    consistentGrowers.length > 0 ||
    sharpestContractions.length > 0 ||
    highestZScoreMovers.length > 0;

  // Quadrant points enriched with YoY so the chart tooltip carries it.
  const quadrantPointsWithYoy: AmcQuadrantPoint[] = quadrant
    ? quadrant.points.map((p) => ({
        ...p,
        yoyGrowthPct: indexBySlug.get(p.slug)?.yoyGrowthPct ?? null,
      }))
    : [];

  // Battle-cards rolodex — top 12 AMCs by AAUM with their AAUM
  // sparkline pulled from amc-detail.
  const battleCards = quadrant
    ? [...quadrant.points]
        .slice(0, 12)
        .map((p) => {
          const indexRow = indexBySlug.get(p.slug);
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

      {anomalies && anomalies.outliers.length > 0 && (
        <Card
          title="Outliers this quarter"
          subtitle={`${anomalies.outliers.length} AMC${anomalies.outliers.length === 1 ? "" : "s"} with QoQ AAUM growth ≥2σ from the cohort median in ${anomalies.quarterLabel} · ${anomalies.participantCount} AMCs measured · Source: AMFI Fundwise AAUM`}
        >
          <ul className="flex flex-wrap gap-2">
            {anomalies.outliers.map((a) => {
              const Icon = a.direction === "up" ? TrendingUp : TrendingDown;
              const aum = indexBySlug.get(a.amcSlug)?.avgAum ?? null;
              const isTinyBase =
                tinyBaseThreshold !== null &&
                typeof aum === "number" &&
                aum < tinyBaseThreshold;
              return (
                <li key={a.amcSlug}>
                  <Link
                    href={`/amc/${a.amcSlug}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                      a.direction === "up"
                        ? "border-positive/40 bg-positive/10 text-positive"
                        : "border-negative/40 bg-negative/10 text-negative"
                    )}
                    title={`QoQ ${a.qoqGrowthPct.toFixed(2)}% · ${a.zScore >= 0 ? "+" : ""}${a.zScore.toFixed(2)}σ from median ${anomalies.medianQoqPct.toFixed(2)}%${isTinyBase ? " · Tiny base — growth % inflated by a small denominator" : ""}`}
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
                    {isTinyBase && (
                      <span className="ml-1 rounded border border-muted-foreground/30 bg-background/60 px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        Tiny base
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
            stdDev {anomalies.stdDevPct.toFixed(2)} pp.
            <InfoTooltip label="Outliers are AMCs whose latest QoQ growth sits ≥2 standard deviations from the cohort median — investigate before drawing conclusions; could be a new AMC ramping up, a one-off reclassification, or a structural shift. AMCs flagged 'Tiny base' sit below the cohort 25th-percentile AAUM, so their % growth is inflated by a small denominator and should be treated as a watchlist signal rather than a headline." />
          </p>
        </Card>
      )}

      {(topGainers.length > 0 || topLosers.length > 0 || emergingChallengers.length > 0 || emergingUnavailable) && (
        <Card
          title="AMC Signal Summary"
          subtitle="Top share gainers, losers and emerging challengers in one scan"
        >
          <AmcSignalSummary
            gainers={topGainers}
            losers={topLosers}
            emerging={emergingChallengers}
            emergingUnavailable={Boolean(emergingUnavailable)}
          />
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Gainers and losers ranked by quarterly change in market-share
            bps. Emerging challengers = sub-median-share AMCs growing
            faster than the cohort median.
            <InfoTooltip label="Top gainers and losers are ranked by quarter-over-quarter change in market-share basis points. Emerging challengers are AMCs with market share below the cohort median and QoQ AAUM growth above the cohort median; if QoQ growth is unavailable, the YoY fallback is used and the entry is tagged · YoY. Active/passive mix and listed-AMC revenue/yield will surface once those fields are ingested." />
          </p>
        </Card>
      )}

      {allDriftPoints.length >= 4 && (
        <Card
          title="AMC Market-Share Drift"
          subtitle={`Start-quarter (${allDriftPoints[0].startQuarterLabel}) → latest (${allDriftPoints[0].endQuarterLabel}) movement in market share · ${driftLens === "all" ? `${allDriftPoints.length} AMCs` : `top ${gainers.length} gainers + top ${losers.length} losers`}`}
          action={
            <LensToggle
              basePath="/amc"
              paramName="drift"
              defaultValue="topMovers"
              lenses={[
                { value: "topMovers", label: "Top movers" },
                { value: "all", label: "Show all" },
              ]}
              active={driftLens}
            />
          }
        >
          <CohortJourneyMap points={driftDisplayPoints} />
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Green = share gain, red = share loss, grey = within ±2 bps
            of flat. Hover an arrow for the precise bps move.
            <InfoTooltip label="Drift = end-quarter market share − start-quarter market share, expressed in basis points. Flat band is |Δ| ≤ 2 bps. Top-movers view shows the largest five gainers and five losers; Show-all surfaces every AMC in the cohort." />
          </p>
        </Card>
      )}

      {skylineBars.length >= 4 && (
        <Card
          title="AMC Ranked Market Share"
          subtitle={`Top ${skylineBars.length} AMCs · latest market share · ${quadrant?.latestQuarterLabel ?? ""}`}
        >
          <SkyscraperCity buildings={skylineBars} />
        </Card>
      )}

      {quadrant && quadrantPointsWithYoy.length >= 4 && (
        <Card
          title="AMC Share vs Growth Quadrant"
          subtitle={`Top ${quadrant.points.length} AMCs by AAUM · ${quadrant.latestQuarterLabel} · cohort medians shown as dashed lines`}
        >
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <AmcQuadrantChart
              data={quadrantPointsWithYoy}
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

      {battleCards.length > 0 && (
        <Card
          title="AMC Roster"
          subtitle="Each card = one AMC · rank, tier, share, growth and trailing AAUM at a glance"
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

      {hasHealthSummary && (
        <Card
          title="AMC Health Signal Summary"
          subtitle="Most consistent growers, sharpest contractions and biggest z-score movers in one scan"
        >
          <HealthSummaryPanel
            consistent={consistentGrowers}
            contractions={sharpestContractions}
            zMovers={highestZScoreMovers}
          />
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            All three reads use the 8-quarter Health Heatmap window
            below.
            <InfoTooltip label="Most consistent growers = AMCs with positive mean QoQ growth and lowest coefficient of variation across the 8Q window. Sharpest contractions = largest single-quarter negative QoQ growth in the window. Highest z-score movers = largest |latest-quarter z-score vs cohort|. Drill into the heatmap below for the full per-quarter detail." />
          </p>
        </Card>
      )}

      {health.rows.length > 0 && (
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

      <AmcSearchTable rows={data.rows} />

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

/** Three-column signal panel: top share gainers, top share losers,
 *  emerging challengers (sub-median-share AMCs with above-median
 *  growth). Each entry is a link to the AMC's detail page styled like
 *  the Outliers pills above. */
function AmcSignalSummary({
  gainers,
  losers,
  emerging,
  emergingUnavailable,
}: {
  gainers: { amcSlug: string; displayName: string; shareDeltaPp: number }[];
  losers: { amcSlug: string; displayName: string; shareDeltaPp: number }[];
  emerging: {
    slug: string;
    displayName: string;
    growthPct: number;
    growthDenom: "QoQ" | "YoY";
    shareGainBps: number | null;
  }[];
  emergingUnavailable: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Top share gainers
        </div>
        {gainers.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">—</div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {gainers.map((g) => (
              <li key={g.amcSlug}>
                <Link
                  href={`/amc/${g.amcSlug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2.5 py-1 text-xs text-positive transition-colors hover:bg-positive/20"
                  title={`${g.displayName} · +${(g.shareDeltaPp * 100).toFixed(0)} bps share gain`}
                >
                  <TrendingUp className="h-3 w-3" />
                  <span className="font-medium">{g.displayName}</span>
                  <span className="tabular">
                    +{(g.shareDeltaPp * 100).toFixed(0)} bps
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Top share losers
        </div>
        {losers.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">—</div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {losers.map((l) => (
              <li key={l.amcSlug}>
                <Link
                  href={`/amc/${l.amcSlug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-negative/40 bg-negative/10 px-2.5 py-1 text-xs text-negative transition-colors hover:bg-negative/20"
                  title={`${l.displayName} · ${(l.shareDeltaPp * 100).toFixed(0)} bps share loss`}
                >
                  <TrendingDown className="h-3 w-3" />
                  <span className="font-medium">{l.displayName}</span>
                  <span className="tabular">
                    {(l.shareDeltaPp * 100).toFixed(0)} bps
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Emerging challengers
        </div>
        {emergingUnavailable ? (
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>—</span>
            <InfoTooltip label="Emerging-challenger ranking unavailable: cohort growth data is missing for this period." />
          </div>
        ) : emerging.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">
            No sub-median-share AMCs above cohort growth median this period.
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {emerging.map((e) => (
              <li key={e.slug}>
                <Link
                  href={`/amc/${e.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--chart-1))]/40 bg-[hsl(var(--chart-1))]/10 px-2.5 py-1 text-xs text-[hsl(var(--chart-1))] transition-colors hover:bg-[hsl(var(--chart-1))]/20"
                  title={`${e.displayName} · ${e.growthDenom} ${e.growthPct >= 0 ? "+" : ""}${e.growthPct.toFixed(1)}% growth · ${e.shareGainBps !== null ? `${e.shareGainBps >= 0 ? "+" : ""}${e.shareGainBps.toFixed(0)} bps share` : "share change unavailable"}`}
                >
                  <TrendingUp className="h-3 w-3" />
                  <span className="font-medium">{e.displayName}</span>
                  <span className="tabular">
                    {e.growthPct >= 0 ? "+" : ""}
                    {e.growthPct.toFixed(1)}%
                  </span>
                  {e.growthDenom === "YoY" && (
                    <span className="text-[10px] tabular opacity-75">· YoY</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
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
  const interpretation: Record<AmcQuadrant, string> = {
    Leaders:
      "Holding share while growing faster than the cohort — durable franchises.",
    Gainers:
      "Sub-scale today but capturing flow — watchlist for share migration.",
    Defenders:
      "Large but slowing — vulnerable to share erosion if growth doesn't recover.",
    Laggards:
      "Sub-scale and below-trend — likely structural or strategic drag.",
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
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              {interpretation[q]}
            </p>
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

interface HealthSummaryRow {
  slug: string;
  label: string;
  value: number;
  quarterLabel?: string;
}

/** Three-column summary above the AMC Health Heatmap: most consistent
 *  growers, sharpest contractions, biggest latest-quarter z-score
 *  movers. Driven entirely off the heatmap matrices — no new data. */
function HealthSummaryPanel({
  consistent,
  contractions,
  zMovers,
}: {
  consistent: HealthSummaryRow[];
  contractions: HealthSummaryRow[];
  zMovers: HealthSummaryRow[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <HealthSummaryColumn
        title="Most consistent growers"
        rows={consistent}
        formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}% mean`}
        toneClass="text-positive"
      />
      <HealthSummaryColumn
        title="Sharpest contractions"
        rows={contractions}
        formatValue={(v) => `${v.toFixed(1)}%`}
        toneClass="text-negative"
        suffixFromRow={(r) => (r.quarterLabel ? ` · ${r.quarterLabel}` : "")}
      />
      <HealthSummaryColumn
        title="Highest z-score movers (latest qtr)"
        rows={zMovers}
        formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}σ`}
        toneClass="text-foreground"
      />
    </div>
  );
}

function HealthSummaryColumn({
  title,
  rows,
  formatValue,
  toneClass,
  suffixFromRow,
}: {
  title: string;
  rows: HealthSummaryRow[];
  formatValue: (v: number) => string;
  toneClass: string;
  suffixFromRow?: (r: HealthSummaryRow) => string;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">—</div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/amc/${r.slug}`}
                className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-xs hover:border-border hover:bg-accent/40"
              >
                <span className="truncate text-foreground" title={r.label}>
                  {r.label}
                </span>
                <span className={cn("shrink-0 tabular", toneClass)}>
                  {formatValue(r.value)}
                  {suffixFromRow ? suffixFromRow(r) : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
