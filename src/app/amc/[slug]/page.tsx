import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  allAaumAmcs,
  amcAaumSeries,
  amcDetail,
  amcGrowthMetrics,
  amcMarketShareSeries,
  amcRankSeries,
  peerComparisonForAmc,
  resolveAmcSlug,
} from "@/data/amc-detail";
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
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = resolveAmcSlug(rawSlug);
  if (!slug) notFound();

  const detail = amcDetail(slug);
  if (!detail) notFound();

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

  const fetchedDate = new Date(detail.fetchedAt).toISOString().slice(0, 10);
  const latest = detail.latest;
  const sourceCaption = `Source: ${detail.source} · fetched ${fetchedDate}`;

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
            ? `${latest.fiscalLabel} · rank #${latest.rank} of ${latest.outOf} · ${formatPctSafe(latest.marketSharePct, 2)} market share`
            : `${detail.amcNameAsReported}`
        }
        action={
          latest?.isTop7 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[10px] tabular text-positive">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
              Top 7 by AAUM
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] tabular text-muted-foreground">
              Outside top 7
            </span>
          )
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Latest MF Average AUM"
          value={formatCompactCrSafe(latest?.avgAum ?? null)}
          note={sourceCaption}
        />
        <KpiCard
          label="Market Share"
          value={formatPctSafe(latest?.marketSharePct ?? null, 2)}
          note={
            latest
              ? `Within ${latest.outOf} AMCs · ${latest.fiscalLabel}`
              : sourceCaption
          }
        />
        <KpiCard
          label="Rank by AAUM"
          value={
            latest
              ? `#${latest.rank}`
              : "—"
          }
          note={
            latest
              ? `of ${latest.outOf} AMCs · ${latest.fiscalLabel}`
              : sourceCaption
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
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              : sourceCaption
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
        <KpiCard
          label="Source"
          value="AMFI Fundwise"
          note={`MF QAAUM · fetched ${fetchedDate}`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          title="AAUM Trend"
          subtitle={`MF QAAUM · ₹ Cr · ${aaumSeries.length} quarter${aaumSeries.length === 1 ? "" : "s"}`}
        >
          {aaumChart.length > 0 ? (
            <AreaTrend data={aaumChart} name="AAUM" />
          ) : (
            <EmptyChart>No AAUM history</EmptyChart>
          )}
        </Card>
        <Card
          title="Market Share Trend"
          subtitle="% of industry MF AAUM"
        >
          {shareChart.length > 0 ? (
            <BarSeries data={shareChart} name="Market share" valueFormat="pct" />
          ) : (
            <EmptyChart>No market-share history</EmptyChart>
          )}
        </Card>
        <Card
          title="Rank Trend"
          subtitle="Position by AAUM (lower number = larger AMC)"
        >
          {rankChart.length > 0 ? (
            <MultiLine
              data={rankChart}
              xKey="quarter"
              valueFormat="count"
              axisFormat="count"
              lines={[
                {
                  key: "rank",
                  name: "Rank",
                  color: "hsl(var(--chart-1))",
                },
              ]}
            />
          ) : (
            <EmptyChart>No rank history</EmptyChart>
          )}
        </Card>
        <Card
          title="Peer Comparison"
          subtitle={
            peer
              ? `Top 7 by AAUM · ${peer.fiscalLabel}${
                  latest && !latest.isTop7 ? ` + ${detail.displayName}` : ""
                }`
              : "Latest quarter"
          }
        >
          {peerChart.length > 0 ? (
            <FocusedBarChart rows={peerChart} />
          ) : (
            <EmptyChart>No peer data</EmptyChart>
          )}
        </Card>
      </section>
    </div>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Compact peer-comparison bar chart that highlights the focused AMC.
 *  We render this inline (rather than reuse BarSeries) so the focused
 *  AMC stands out without forking the shared chart components. */
function FocusedBarChart({
  rows,
}: {
  rows: { label: string; value: number; slug: string; isFocused: boolean }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const widthPct = (r.value / max) * 100;
        return (
          <div key={r.slug} className="flex items-center gap-3 text-xs">
            <div
              className={cn(
                "w-40 truncate",
                r.isFocused ? "font-semibold" : "text-muted-foreground"
              )}
              title={r.label}
            >
              {r.label}
            </div>
            <div className="flex-1">
              <div className="h-5 rounded bg-muted">
                <div
                  className={cn(
                    "h-5 rounded",
                    r.isFocused
                      ? "bg-positive/70"
                      : "bg-foreground/20"
                  )}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
            <div
              className={cn(
                "w-24 text-right tabular",
                r.isFocused ? "font-semibold" : "text-muted-foreground"
              )}
            >
              {formatCompactCrSafe(r.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
