import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import { DistributionStrip } from "@/components/ui/DistributionStrip";
import { KpiCard } from "@/components/ui/KpiCard";
import { LensToggle } from "@/components/ui/LensToggle";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { BarSeries } from "@/components/charts/BarSeries";
import { MultiLine } from "@/components/charts/MultiLine";
import { RankTrendChart } from "@/components/charts/RankTrendChart";
import { chartInsights, latestYoyPct } from "@/lib/chart-context";
import { amcMarketWrap } from "@/data/market-wrap-amc";
import {
  allAaumAmcs,
  amcAaumSeries,
  amcDetail,
  amcGrowthMetrics,
  amcMarketShareSeries,
  amcRankSeries,
  cohortMedianMarketShareSeries,
  industryAaumSeries,
  peerComparisonForAmc,
  resolveAmcSlug,
} from "@/data/amc-detail";
import { latestQoqAnomalies } from "@/data/amc-peer-universe";
import { amcNarrativeLatest } from "@/data/amc-narratives";
import { ConcallDigest } from "@/components/amc/ConcallDigest";
import { PostureRadar } from "@/components/amc/PostureRadar";
import {
  formatCompactCrSafe,
  formatDelta,
  formatPctSafe,
} from "@/lib/format";
import { cn } from "@/lib/cn";

export function generateStaticParams() {
  return allAaumAmcs().map((a) => ({ slug: a.amcSlug }));
}

export default async function AmcPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: rawSlug } = await params;
  const sp = await searchParams;
  const aaumLens: "absolute" | "share" =
    sp.aaumLens === "share" ? "share" : "absolute";
  const preservedQueryParams: Record<string, string | undefined> = {
    aaumLens: typeof sp.aaumLens === "string" ? sp.aaumLens : undefined,
  };
  const slug = resolveAmcSlug(rawSlug);
  if (!slug) notFound();

  const detail = amcDetail(slug);
  if (!detail) notFound();

  // Three-sentence "today's read" surfaced at the top of the page.
  const marketWrapData = amcMarketWrap(slug);

  const aaumSeries = amcAaumSeries(slug);
  const shareSeries = amcMarketShareSeries(slug);
  const rankSeries = amcRankSeries(slug);
  const growth = amcGrowthMetrics(slug);
  const peer = peerComparisonForAmc(slug);

  const aaumChart = aaumSeries.map((p) => ({
    month: p.fiscalLabel,
    value: p.avgAum,
  }));
  const shareChart = shareSeries.map((p) => ({
    label: p.fiscalLabel,
    value: p.marketSharePct,
  }));
  const rankChart = rankSeries.map((p) => ({
    quarter: p.fiscalLabel,
    rank: p.rank,
  }));

  // ---- Peer-context overlays for the AMC detail charts ----
  // AAUM rebased to 100 at the start of the AMC's series. Industry
  // total is reindexed using the SAME first-quarter anchor so both
  // lines start at 100 and diverge / converge as the AMC out- or
  // under-performs the industry. Quarters where either side is
  // missing are dropped to keep the lines aligned.
  const industryAaum = industryAaumSeries();
  const industryByQuarter = new Map(
    industryAaum.map((p) => [p.quarter, p.avgAum])
  );
  const baselineAmc = aaumSeries[0]?.avgAum ?? null;
  const baselineIndustry =
    aaumSeries[0] !== undefined
      ? industryByQuarter.get(aaumSeries[0].quarter) ?? null
      : null;
  const aaumRebased =
    baselineAmc !== null && baselineIndustry !== null && baselineAmc > 0 && baselineIndustry > 0
      ? aaumSeries.flatMap((p) => {
          const ind = industryByQuarter.get(p.quarter);
          if (typeof ind !== "number" || ind <= 0) return [];
          return [
            {
              label: p.fiscalLabel,
              amc: Number(((p.avgAum / baselineAmc) * 100).toFixed(2)),
              industry: Number(((ind / baselineIndustry) * 100).toFixed(2)),
            },
          ];
        })
      : [];

  // Market share trend with cohort-median overlay.
  const cohortMedianShare = cohortMedianMarketShareSeries();
  const cohortMedianByQuarter = new Map(
    cohortMedianShare.map((p) => [p.quarter, p.marketSharePct])
  );
  const shareWithMedian = shareSeries.map((p) => ({
    label: p.fiscalLabel,
    amc: p.marketSharePct,
    median: cohortMedianByQuarter.get(p.quarter) ?? null,
  }));

  // ---- ChartWithContext insight inputs for the three trend charts.
  // Built so each card carries an analytically-distinct denominator
  // and a rule-based insight strip — matches the /monthly + /quarterly
  // template.
  // AAUM Trend insights: run on the AMC's own AAUM series in ₹ Cr so
  // YoY / multi-period / σ-spike rules read naturally.
  const aaumInsightSeries = aaumSeries.map((p) => ({
    label: p.fiscalLabel,
    value: p.avgAum,
  }));
  const aaumInsights = chartInsights(aaumInsightSeries, {
    metricName: `${detail.displayName} AAUM`,
    unitSuffix: "₹ Cr",
    yoyLag: 4,
  });
  // AAUM denominator: latest AMC AAUM as % of industry total — the
  // exact peer benchmark for "is this AMC pulling ahead?".
  const aaumDenomCaption = (() => {
    if (aaumSeries.length === 0) return undefined;
    const latest = aaumSeries[aaumSeries.length - 1];
    const ind = industryByQuarter.get(latest.quarter);
    if (typeof ind !== "number" || ind <= 0) return undefined;
    const pct = (latest.avgAum / ind) * 100;
    return `${pct.toFixed(2)}% of industry AAUM · latest ${latest.fiscalLabel}`;
  })();

  // Market Share insights: run on the AMC's share series.
  const shareInsightSeries = shareSeries.map((p) => ({
    label: p.fiscalLabel,
    value: p.marketSharePct,
  }));
  const shareInsights = chartInsights(shareInsightSeries, {
    metricName: `${detail.displayName} market share`,
    unitSuffix: "%",
    yoyLag: 4,
  });
  // Share denominator: pp shift YoY — slow-moving metric so the
  // delta is more useful than the absolute share %.
  const shareDenomCaption = (() => {
    if (shareSeries.length < 5) return undefined;
    const latest = shareSeries[shareSeries.length - 1];
    const prior = shareSeries[shareSeries.length - 5];
    const pp = latest.marketSharePct - prior.marketSharePct;
    return `${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(2)} pp YoY · latest ${latest.fiscalLabel}`;
  })();

  // Rank Trend denominator: rank change vs 4Q back — a single
  // up-or-down read on whether this AMC is climbing the league
  // table. Lower rank = larger AMC, so a NEGATIVE delta is an
  // improvement; we phrase it that way.
  const rankDenomCaption = (() => {
    if (rankSeries.length < 5) return undefined;
    const latest = rankSeries[rankSeries.length - 1];
    const prior = rankSeries[rankSeries.length - 5];
    const delta = latest.rank - prior.rank;
    if (delta === 0)
      return `Unchanged vs 4Q ago · latest rank ${latest.rank} · ${latest.fiscalLabel}`;
    return `${delta < 0 ? "↑" : "↓"} ${Math.abs(delta)} rank${Math.abs(delta) === 1 ? "" : "s"} vs 4Q ago · latest ${latest.rank} · ${latest.fiscalLabel}`;
  })();

  // KPI-card contexts: percentile-vs-own-history readings + 4Q / 5Y deltas.
  const aaumValues = aaumSeries.map((p) => p.avgAum);
  const aaumLatest = aaumValues[aaumValues.length - 1];
  const aaumPercentile =
    typeof aaumLatest === "number" && aaumValues.length > 0
      ? (aaumValues.filter((v) => v <= aaumLatest).length / aaumValues.length) * 100
      : null;
  const shareValues = shareSeries.map((p) => p.marketSharePct);
  const shareLatest = shareValues[shareValues.length - 1];
  const shareOwnPercentile =
    typeof shareLatest === "number" && shareValues.length > 0
      ? (shareValues.filter((v) => v <= shareLatest).length / shareValues.length) * 100
      : null;
  // YoY shift in market share in percentage points (vs same quarter
  // 4 quarters back).
  const marketShareYoyPpDelta =
    shareSeries.length >= 5
      ? shareSeries[shareSeries.length - 1].marketSharePct -
        shareSeries[shareSeries.length - 5].marketSharePct
      : null;
  // 5Y shift in market share in percentage points (≥ 20 quarters back).
  const shareDelta5Y =
    shareSeries.length >= 21
      ? shareSeries[shareSeries.length - 1].marketSharePct -
        shareSeries[shareSeries.length - 21].marketSharePct
      : shareSeries.length >= 2
        ? shareSeries[shareSeries.length - 1].marketSharePct - shareSeries[0].marketSharePct
        : null;
  // 4-quarter rank movement (positive number = moved DOWN in rank).
  const rankDelta4Q =
    rankSeries.length >= 5
      ? rankSeries[rankSeries.length - 1].rank -
        rankSeries[rankSeries.length - 5].rank
      : null;
  // Cohort median QoQ growth this quarter — for the "vs cohort median"
  // pill on the QoQ KPI.
  const anomalyReport = latestQoqAnomalies(2);
  const cohortMedianQoq = anomalyReport?.medianQoqPct ?? null;
  // Peer distribution arrays for the DistributionStrip — every AMC's
  // latest market share + QoQ growth, used to render the dot strip.
  const peerDistributionShares: number[] = peer
    ? peer.rows.map((r) => r.marketSharePct)
    : [];
  const peerDistributionGrowth: number[] = peer
    ? peer.rows
        .map((r) => r.qoqGrowthPct)
        .filter((v): v is number => typeof v === "number")
    : [];
  const thisAmcAnomaly =
    anomalyReport?.outliers.find((o) => o.amcSlug === slug) ?? null;
  const peerChart =
    peer?.rows.map((r) => ({
      label: r.displayName,
      value: r.avgAum,
      slug: r.amcSlug,
      isFocused: r.isFocused,
    })) ?? [];

  const trend = (n: number | null | undefined) =>
    n === null || n === undefined
      ? undefined
      : n > 0.5
        ? ("up" as const)
        : n < -0.5
          ? ("down" as const)
          : ("flat" as const);

  const latest = detail.latest;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href="/amc"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All AMCs
        </Link>
      </div>

      <PageHeader
        title={detail.displayName}
        subtitle={
          latest
            ? `${latest.fiscalLabel} · rank #${latest.rank} of ${latest.outOf} · ${formatPctSafe(latest.marketSharePct, 2)} market share · Source: AMFI Fundwise AAUM`
            : `${detail.amcNameAsReported} · Source: AMFI Fundwise AAUM`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {thisAmcAnomaly && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] tabular",
                  thisAmcAnomaly.direction === "up"
                    ? "border-positive/40 bg-positive/10 text-positive"
                    : "border-negative/40 bg-negative/10 text-negative"
                )}
                title={`QoQ ${thisAmcAnomaly.qoqGrowthPct.toFixed(2)}% — ${thisAmcAnomaly.zScore >= 0 ? "+" : ""}${thisAmcAnomaly.zScore.toFixed(2)}σ from cohort median ${anomalyReport?.medianQoqPct.toFixed(2) ?? "?"}%`}
              >
                ⚠ Outlier · {thisAmcAnomaly.zScore >= 0 ? "+" : ""}
                {thisAmcAnomaly.zScore.toFixed(1)}σ QoQ
              </span>
            )}
            {latest?.isTop7 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[10px] tabular text-positive">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
                Top 7 by AAUM
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] tabular text-muted-foreground">
                Outside top 7
              </span>
            )}
          </div>
        }
      />

      <MarketWrapCard wrap={marketWrapData} />

      <SectionDivider
        eyebrow="Section 1"
        label="Snapshot"
        context="Latest-quarter KPIs and where this AMC sits in the cohort."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Latest MF AAUM"
          value={formatCompactCrSafe(latest?.avgAum ?? null)}
          note={latest ? latest.fiscalLabel : ""}
          sparkline={aaumChart.map((p) => ({ label: p.month, value: p.value }))}
          sparklineColor="hsl(var(--chart-1))"
          yoyPct={growth?.yoyGrowthPct ?? undefined}
          percentile={aaumPercentile ?? undefined}
          ratio={
            latest
              ? `${formatPctSafe(latest.marketSharePct, 2)} of industry AAUM`
              : undefined
          }
        />
        <KpiCard
          label="Market Share"
          value={formatPctSafe(latest?.marketSharePct ?? null, 2)}
          note={
            latest ? `Within ${latest.outOf} AMCs · ${latest.fiscalLabel}` : ""
          }
          sparkline={shareChart}
          sparklineColor="hsl(var(--chart-3))"
          yoyPct={marketShareYoyPpDelta ?? undefined}
          percentile={shareOwnPercentile ?? undefined}
          ratio={
            shareDelta5Y !== null
              ? `${shareDelta5Y >= 0 ? "+" : ""}${shareDelta5Y.toFixed(2)} pp vs 5Y ago`
              : undefined
          }
        />
        <KpiCard
          label="Rank by AAUM"
          value={
            latest
              ? `#${latest.rank}`
              : "—"
          }
          note={latest ? `of ${latest.outOf} AMCs · ${latest.fiscalLabel}` : ""}
          ratio={
            rankDelta4Q !== null
              ? rankDelta4Q === 0
                ? "Unchanged vs 4Q ago"
                : rankDelta4Q < 0
                  ? `▲ ${Math.abs(rankDelta4Q)} vs 4Q ago`
                  : `▼ ${rankDelta4Q} vs 4Q ago`
              : undefined
          }
        />
        <KpiCard
          label="QoQ AAUM Growth"
          value={
            growth?.qoqGrowthPct !== null && growth?.qoqGrowthPct !== undefined
              ? formatDelta(growth.qoqGrowthPct)
              : "—"
          }
          trend={trend(growth?.qoqGrowthPct)}
          note={
            growth?.prevQuarter
              ? `vs ${detail.latest?.fiscalLabel} → prior quarter`
              : "Insufficient history"
          }
          ratio={
            cohortMedianQoq !== null && growth?.qoqGrowthPct !== undefined && growth?.qoqGrowthPct !== null
              ? `${(growth.qoqGrowthPct - cohortMedianQoq) >= 0 ? "+" : ""}${(growth.qoqGrowthPct - cohortMedianQoq).toFixed(2)}pp vs cohort median`
              : undefined
          }
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard
          label="YoY AAUM Growth"
          value={
            growth?.yoyGrowthPct !== null && growth?.yoyGrowthPct !== undefined
              ? formatDelta(growth.yoyGrowthPct)
              : "—"
          }
          trend={trend(growth?.yoyGrowthPct)}
          note={
            growth?.yoyQuarter
              ? `Same quarter last year`
              : "Insufficient history (need 4 quarters)"
          }
        />
        <KpiCard
          label="Quarters Tracked"
          value={String(aaumSeries.length)}
          note={
            aaumSeries.length > 0
              ? `${aaumSeries[0].fiscalLabel} → ${aaumSeries[aaumSeries.length - 1].fiscalLabel}`
              : ""
          }
        />
        <KpiCard
          label="Mapping"
          value={
            detail.mappingStatus === "mapped"
              ? "Curated"
              : detail.mappingStatus === "auto_slug"
                ? "Auto-mapped"
                : (detail.mappingStatus ?? "—")
          }
          note={detail.amcNameAsReported}
        />
      </section>

      {peerDistributionShares.length > 1 && latest && (
        <Card
          title="Peer Position"
          subtitle="Where this AMC sits on the cohort distribution for each metric"
        >
          <div className="space-y-3">
            <DistributionStrip
              label="Market share"
              values={peerDistributionShares}
              focused={latest.marketSharePct}
              format={(v) => `${v.toFixed(2)}%`}
            />
            {peerDistributionGrowth.length > 1 && growth?.qoqGrowthPct !== null && growth?.qoqGrowthPct !== undefined && (
              <DistributionStrip
                label="QoQ growth"
                values={peerDistributionGrowth}
                focused={growth.qoqGrowthPct}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
              />
            )}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Each dot = one AMC in the cohort. The filled dot is{" "}
            {detail.displayName}.
          </p>
        </Card>
      )}

      <SectionDivider
        eyebrow="Section 2"
        label="Trends"
        context="AAUM, market share and rank movement vs the cohort."
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartWithContext
          title="AAUM Trend"
          subtitle="This AMC&rsquo;s AAUM by quarter. Tracks how the asset base has grown."
          flowKind="stock"
          denominatorCaption={(() => {
            const base = aaumLens === "share"
              ? `${aaumSeries.length} quarter${aaumSeries.length === 1 ? "" : "s"} · MF AAUM · ₹ Cr · Source: AMFI Fundwise AAUM`
              : `Rebased to 100 at start · ${aaumSeries.length} quarter${aaumSeries.length === 1 ? "" : "s"} · this AMC vs industry total · Source: AMFI Fundwise AAUM`;
            return aaumDenomCaption
              ? `${base} · ${aaumDenomCaption}`
              : base;
          })()}
          denominatorTooltip="Latest AMC AAUM as a percentage of industry total — the cleanest peer benchmark for 'is this AMC pulling ahead of the industry?'."
          insights={aaumInsights}
          yoyBadge={(() => {
            const v = latestYoyPct(aaumInsightSeries, 4);
            return v === null ? undefined : { label: "YoY", pct: v };
          })()}
          action={
            <LensToggle
              basePath={`/amc/${slug}`}
              paramName="aaumLens"
              defaultValue="absolute"
              lenses={[
                { value: "absolute", label: "Indexed" },
                { value: "share", label: "₹ Cr" },
              ]}
              active={aaumLens}
              preserveParams={preservedQueryParams}
            />
          }
        >
          {aaumLens === "share" ? (
            aaumInsightSeries.length > 0 ? (
              <BarSeries
                data={aaumInsightSeries}
                name={detail.displayName}
                color="hsl(var(--chart-1))"
                valueFormat="cr"
                axisFormat="cr"
                labelFormat="none"
              />
            ) : (
              <EmptyChart>No AAUM history</EmptyChart>
            )
          ) : aaumRebased.length > 0 ? (
            <MultiLine
              data={aaumRebased}
              xKey="label"
              labelFormat="none"
              valueFormat="count"
              axisFormat="count"
              lines={[
                {
                  key: "amc",
                  name: detail.displayName,
                  color: "hsl(var(--chart-1))",
                },
                {
                  key: "industry",
                  name: "Industry total",
                  color: "hsl(var(--muted-foreground))",
                },
              ]}
            />
          ) : (
            <EmptyChart>No AAUM history</EmptyChart>
          )}
        </ChartWithContext>
        <ChartWithContext
          title="Market Share Trend"
          subtitle="This AMC&rsquo;s share of industry MF AAUM, against the cohort median."
          flowKind="stock"
          denominatorCaption={(() => {
            const base = "% of industry MF AAUM · cohort median overlay · Source: AMFI Fundwise AAUM";
            return shareDenomCaption
              ? `${base} · ${shareDenomCaption}`
              : base;
          })()}
          denominatorTooltip="Latest market share minus the share four quarters back, in percentage points — share moves slowly, so the YoY pp delta is the more informative read."
          insights={shareInsights}
          yoyBadge={(() => {
            const v = latestYoyPct(shareInsightSeries, 4);
            return v === null ? undefined : { label: "YoY", pct: v };
          })()}
        >
          {shareChart.length > 0 ? (
            <MultiLine
              data={shareWithMedian}
              xKey="label"
              labelFormat="none"
              valueFormat="pct"
              axisFormat="pct"
              dynamicYDomain
              lines={[
                {
                  key: "amc",
                  name: detail.displayName,
                  color: "hsl(var(--chart-3))",
                },
                {
                  key: "median",
                  name: "Cohort median",
                  color: "hsl(var(--muted-foreground))",
                },
              ]}
            />
          ) : (
            <EmptyChart>No market-share history</EmptyChart>
          )}
        </ChartWithContext>
        <ChartWithContext
          title="Rank Trend"
          subtitle="This AMC&rsquo;s rank in the industry by AAUM. Lower number = larger AMC."
          flowKind="stock"
          denominatorCaption={(() => {
            const base = "Position by AAUM (lower number = larger AMC) · tier bands shown · Source: AMFI Fundwise AAUM";
            return rankDenomCaption
              ? `${base} · ${rankDenomCaption}`
              : base;
          })()}
          denominatorTooltip="Change in league-table position vs four quarters ago — a single up-or-down read on whether this AMC is climbing or slipping."
        >
          {rankChart.length > 0 ? (
            <RankTrendChart data={rankChart} />
          ) : (
            <EmptyChart>No rank history</EmptyChart>
          )}
        </ChartWithContext>
      </section>

      {(() => {
        const narrative = amcNarrativeLatest(slug);
        if (narrative === null) return null;
        return (
          <>
            <SectionDivider
              eyebrow="Section 3"
              label="What management is saying"
              context="Disclosed metrics and posture from the latest concall. Cohort-wide context lives on the AMCs page Insights tab."
            />

            <ConcallDigest
              row={narrative}
              slug={slug}
              amcDisplayName={detail.displayName}
            />

            <PostureRadar slug={slug} amcDisplayName={detail.displayName} />
          </>
        );
      })()}

      <SectionDivider
        eyebrow="Section 4"
        label="Peer comparison"
        context="Side-by-side with the Top 7 cohort and the full peer table."
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Peer Comparison"
          subtitle={
            peer
              ? `Top 7 by AAUM · ${peer.fiscalLabel}${
                  latest && !latest.isTop7 ? ` + ${detail.displayName}` : ""
                } · Source: AMFI Fundwise AAUM`
              : "Latest quarter · Source: AMFI Fundwise AAUM"
          }
        >
          {peerChart.length > 0 ? (
            <FocusedPeerList rows={peerChart} />
          ) : (
            <EmptyChart>No peer data</EmptyChart>
          )}
        </Card>
      </section>

      {peer && peer.rows.length > 0 && (
        <Card
          title="Peer Comparison Table"
          subtitle={`Top 7 by AAUM${
            latest && !latest.isTop7 ? ` + ${detail.displayName}` : ""
          } · ${peer.fiscalLabel} · Source: AMFI Fundwise AAUM`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pl-1 pr-3 font-medium tabular">#</th>
                  <th className="py-2 pr-3 font-medium">AMC</th>
                  <th className="py-2 pr-3 text-right font-medium tabular">
                    AAUM
                  </th>
                  <th className="py-2 pr-3 text-right font-medium tabular">
                    Share
                  </th>
                  <th className="py-2 pr-3 text-right font-medium tabular">
                    QoQ
                  </th>
                  <th className="py-2 pr-3 text-right font-medium tabular">
                    YoY
                  </th>
                  <th className="py-2 pr-1 text-right font-medium">Tier</th>
                </tr>
              </thead>
              <tbody>
                {peer.rows.map((r) => (
                  <tr
                    key={r.amcSlug}
                    className={cn(
                      "border-b last:border-0",
                      r.isFocused && "bg-accent/40"
                    )}
                  >
                    <td className="py-2 pl-1 pr-3 tabular text-muted-foreground">
                      #{r.rank}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/amc/${r.amcSlug}`}
                        className={cn(
                          "hover:underline",
                          r.isFocused ? "font-semibold" : "font-medium"
                        )}
                      >
                        {r.displayName}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                      {formatCompactCrSafe(r.avgAum)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                      {formatPctSafe(r.marketSharePct, 2)}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right tabular",
                        growthClass(r.qoqGrowthPct)
                      )}
                    >
                      {r.qoqGrowthPct === null
                        ? "—"
                        : formatDelta(r.qoqGrowthPct)}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right tabular",
                        growthClass(r.yoyGrowthPct)
                      )}
                    >
                      {r.yoyGrowthPct === null
                        ? "—"
                        : formatDelta(r.yoyGrowthPct)}
                    </td>
                    <td className="py-2 pr-1 text-right">
                      {r.isInTop7 ? (
                        <span className="inline-flex items-center rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] tabular text-positive">
                          Top 7
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border bg-muted px-1.5 py-0.5 text-[10px] tabular text-muted-foreground">
                          Outside top 7
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] tabular text-muted-foreground">
            Sorted by AAUM rank for {peer.fiscalLabel}. Highlighted row =
            this AMC. Growth columns: QoQ vs prior quarter, YoY vs same
            quarter one year earlier; “—” when that comparison quarter
            isn’t in the snapshot.
          </p>
        </Card>
      )}
    </div>
  );
}

function growthClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value > 0.5) return "text-positive";
  if (value < -0.5) return "text-negative";
  return "text-muted-foreground";
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Ranked peer-comparison list — focused AMC highlighted, with
 *  a dot-plot magnitude indicator (no proportional bar fills). The
 *  detailed peer table sits directly below this card. */
function FocusedPeerList({
  rows,
}: {
  rows: { label: string; value: number; slug: string; isFocused: boolean }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return (
    <ol className="space-y-1.5">
      {sorted.map((r, i) => {
        const dotLeftPct = (r.value / max) * 100;
        return (
          <li
            key={r.slug}
            className={cn(
              "grid grid-cols-[24px_minmax(120px,_1.4fr)_2fr_minmax(80px,_auto)] items-center gap-3 rounded-md px-2 py-1.5 text-xs",
              r.isFocused && "bg-accent/40 ring-1 ring-positive/30"
            )}
          >
            <span className="tabular text-muted-foreground">
              #{i + 1}
            </span>
            <span
              className={cn(
                "truncate",
                r.isFocused ? "font-semibold text-foreground" : "text-foreground"
              )}
              title={r.label}
            >
              {r.label}
            </span>
            <span className="relative block h-2">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              <span
                className={cn(
                  "absolute top-1/2 inline-block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                  r.isFocused
                    ? "bg-positive"
                    : "bg-foreground/35"
                )}
                style={{ left: `${dotLeftPct}%` }}
                aria-hidden
              />
            </span>
            <span
              className={cn(
                "text-right tabular",
                r.isFocused ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {formatCompactCrSafe(r.value)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
