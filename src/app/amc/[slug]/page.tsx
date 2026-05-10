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
          note={latest ? latest.fiscalLabel : ""}
        />
        <KpiCard
          label="Market Share"
          value={formatPctSafe(latest?.marketSharePct ?? null, 2)}
          note={
            latest ? `Within ${latest.outOf} AMCs · ${latest.fiscalLabel}` : ""
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

      {peer && peer.rows.length > 0 && (
        <Card
          title="Peer Comparison Table"
          subtitle={`Top 7 by AAUM${
            latest && !latest.isTop7 ? ` + ${detail.displayName}` : ""
          } · ${peer.fiscalLabel}`}
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
