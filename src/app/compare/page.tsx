import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { DesignLanguageCard } from "@/components/ui/DesignLanguageCard";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { MultiLine } from "@/components/charts/MultiLine";
import { AmcCompareSelector } from "@/components/compare/AmcCompareSelector";
import { BRAND } from "@/lib/brand-palette";
import {
  allAaumAmcs,
  amcAaumSeries,
  amcDetail,
  amcGrowthMetrics,
  amcMarketShareSeries,
  amcRankSeries,
  resolveAmcSlug,
} from "@/data/amc-detail";
import {
  formatCompactCrSafe,
  formatDelta,
  formatPctSafe,
} from "@/lib/format";
import { cn } from "@/lib/cn";

const DEFAULT_A = "hdfc";
const DEFAULT_B = "nippon";

function resolveWithFallback(
  raw: string | string[] | undefined,
  fallback: string
): string {
  const slug = typeof raw === "string" ? resolveAmcSlug(raw) : null;
  return slug ?? fallback;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const universe = allAaumAmcs();
  const slugA = resolveWithFallback(sp.a, DEFAULT_A);
  const rawB = resolveWithFallback(sp.b, DEFAULT_B);
  // If both URL params resolve to the same AMC, fall back to a sensible
  // alternative so the user always sees two distinct columns.
  const slugB = rawB === slugA ? (slugA === DEFAULT_A ? DEFAULT_B : DEFAULT_A) : rawB;

  const detailA = amcDetail(slugA);
  const detailB = amcDetail(slugB);

  const aaumA = amcAaumSeries(slugA);
  const aaumB = amcAaumSeries(slugB);
  const shareA = amcMarketShareSeries(slugA);
  const shareB = amcMarketShareSeries(slugB);
  const rankA = amcRankSeries(slugA);
  const rankB = amcRankSeries(slugB);
  const growthA = amcGrowthMetrics(slugA);
  const growthB = amcGrowthMetrics(slugB);

  const trend = (n: number | null | undefined) =>
    n === null || n === undefined
      ? undefined
      : n > 0.5
        ? ("up" as const)
        : n < -0.5
          ? ("down" as const)
          : ("flat" as const);

  // Overlay chart — align both series on a shared chronological set
  // of fiscal-quarter labels. AMC series carry fiscalLabel already.
  const overlayLabels = Array.from(
    new Set([...aaumA.map((p) => p.fiscalLabel), ...aaumB.map((p) => p.fiscalLabel)])
  ).sort();
  const aaumByLabelA = new Map(aaumA.map((p) => [p.fiscalLabel, p.avgAum]));
  const aaumByLabelB = new Map(aaumB.map((p) => [p.fiscalLabel, p.avgAum]));
  const overlayData = overlayLabels.map((label) => ({
    label,
    [slugA]: aaumByLabelA.get(label) ?? null,
    [slugB]: aaumByLabelB.get(label) ?? null,
  }));

  const shareByLabelA = new Map(shareA.map((p) => [p.fiscalLabel, p.marketSharePct]));
  const shareByLabelB = new Map(shareB.map((p) => [p.fiscalLabel, p.marketSharePct]));
  const shareOverlayLabels = Array.from(
    new Set([...shareA.map((p) => p.fiscalLabel), ...shareB.map((p) => p.fiscalLabel)])
  ).sort();
  const shareOverlay = shareOverlayLabels.map((label) => ({
    label,
    [slugA]: shareByLabelA.get(label) ?? null,
    [slugB]: shareByLabelB.get(label) ?? null,
  }));

  const rankByLabelA = new Map(rankA.map((p) => [p.fiscalLabel, p.rank]));
  const rankByLabelB = new Map(rankB.map((p) => [p.fiscalLabel, p.rank]));
  const rankOverlayLabels = Array.from(
    new Set([...rankA.map((p) => p.fiscalLabel), ...rankB.map((p) => p.fiscalLabel)])
  ).sort();
  const rankOverlay = rankOverlayLabels.map((label) => ({
    label,
    [slugA]: rankByLabelA.get(label) ?? null,
    [slugB]: rankByLabelB.get(label) ?? null,
  }));

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
        title="Compare AMCs"
        subtitle={`Side-by-side AAUM, market share, rank, and growth · Source: AMFI Fundwise AAUM`}
      />

      <AmcCompareSelector amcs={universe} selectedA={slugA} selectedB={slugB} />

      {/* Comparison Read panel — buy-side one-line read derived from the
          latest quarter's AAUM, share, growth, and rank. Renders before
          the detail columns so the scan order is "headline → evidence". */}
      {detailA && detailB && (
        <Card
          title="Comparison Read"
          subtitle="Buy-side one-line interpretation"
        >
          <ComparisonRead
            a={{
              displayName: detailA.displayName,
              latest: detailA.latest ?? null,
              growth: growthA ?? null,
            }}
            b={{
              displayName: detailB.displayName,
              latest: detailB.latest ?? null,
              growth: growthB ?? null,
            }}
          />
        </Card>
      )}

      {/* Two side-by-side summary columns */}
      <section className="grid gap-4 lg:grid-cols-2">
        {[
          { detail: detailA, growth: growthA, color: BRAND.navy },
          { detail: detailB, growth: growthB, color: BRAND.orange },
        ].map((side, idx) => {
          if (!side.detail) {
            return (
              <Card key={idx} title="AMC unavailable" subtitle="No AAUM data for this slug.">
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  —
                </div>
              </Card>
            );
          }
          const latest = side.detail.latest;
          return (
            <Card
              key={side.detail.amcSlug}
              title={side.detail.displayName}
              subtitle={
                latest
                  ? `${latest.fiscalLabel} · rank #${latest.rank} of ${latest.outOf}`
                  : "No latest quarter"
              }
              action={
                <Link
                  href={`/amc/${side.detail.amcSlug}`}
                  className="inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Full page →
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <KpiCard
                  label="MF Average AUM"
                  value={formatCompactCrSafe(latest?.avgAum ?? null)}
                  note={latest ? latest.fiscalLabel : ""}
                />
                <KpiCard
                  label="Market Share"
                  value={formatPctSafe(latest?.marketSharePct ?? null, 2)}
                  note={latest ? `Within ${latest.outOf} AMCs` : ""}
                />
                <KpiCard
                  label="QoQ AAUM"
                  value={
                    side.growth?.qoqGrowthPct === null ||
                    side.growth?.qoqGrowthPct === undefined
                      ? "—"
                      : formatDelta(side.growth.qoqGrowthPct)
                  }
                  trend={trend(side.growth?.qoqGrowthPct)}
                  note={side.growth?.prevQuarter ? "vs prior quarter" : "—"}
                />
                <KpiCard
                  label="YoY AAUM"
                  value={
                    side.growth?.yoyGrowthPct === null ||
                    side.growth?.yoyGrowthPct === undefined
                      ? "—"
                      : formatDelta(side.growth.yoyGrowthPct)
                  }
                  trend={trend(side.growth?.yoyGrowthPct)}
                  note={
                    side.growth?.yoyQuarter
                      ? "Same quarter last year"
                      : "Insufficient history"
                  }
                />
              </div>

              <div className="mt-4">
                {(side.detail.amcSlug === slugA ? aaumA : aaumB).length > 0 ? (
                  <AreaTrend
                    data={(side.detail.amcSlug === slugA ? aaumA : aaumB).map((p) => ({
                      month: p.fiscalLabel,
                      value: p.avgAum,
                    }))}
                    name="AAUM"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    No AAUM history
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </section>

      {/* Overlay charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        {overlayData.length > 0 ? (
          <DesignLanguageCard
            title="AAUM overlay"
            chartId="cmp-aaum-overlay"
            source="Source: AMFI Fundwise AAUM · both AMCs on one ₹ Cr axis"
          >
            <MultiLine
              data={overlayData}
              xKey="label"
              valueFormat="cr"
              axisFormat="cr"
              labelFormat="none"
              showDots
              lines={[
                {
                  key: slugA,
                  name: detailA?.displayName ?? slugA,
                  color: BRAND.navy,
                },
                {
                  key: slugB,
                  name: detailB?.displayName ?? slugB,
                  color: BRAND.orange,
                },
              ]}
            />
          </DesignLanguageCard>
        ) : (
          <Card title="AAUM overlay">
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              No overlapping AAUM data
            </div>
          </Card>
        )}

        {shareOverlay.length > 0 ? (
          <DesignLanguageCard
            title="Market share overlay"
            chartId="cmp-share-overlay"
            source="Source: AMFI Fundwise AAUM · share of total industry MF AAUM each quarter"
          >
            <MultiLine
              data={shareOverlay}
              xKey="label"
              valueFormat="pct"
              axisFormat="pct"
              labelFormat="none"
              showDots
              lines={[
                {
                  key: slugA,
                  name: detailA?.displayName ?? slugA,
                  color: BRAND.navy,
                },
                {
                  key: slugB,
                  name: detailB?.displayName ?? slugB,
                  color: BRAND.orange,
                },
              ]}
            />
          </DesignLanguageCard>
        ) : (
          <Card title="Market share overlay">
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              No share history
            </div>
          </Card>
        )}

        <Card
          title="Rank overlay"
          subtitle="Position by AAUM (lower = larger AMC) · Source: AMFI Fundwise AAUM"
        >
          {rankOverlay.length > 0 ? (
            <MultiLine
              data={rankOverlay}
              xKey="label"
              valueFormat="count"
              axisFormat="count"
              labelFormat="none"
              lines={[
                {
                  key: slugA,
                  name: detailA?.displayName ?? slugA,
                  color: BRAND.navy,
                },
                {
                  key: slugB,
                  name: detailB?.displayName ?? slugB,
                  color: BRAND.orange,
                },
              ]}
            />
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              No rank history
            </div>
          )}
        </Card>

        <Card
          title="QoQ Growth Overlay"
          subtitle="% change vs prior quarter · Source: AMFI Fundwise AAUM"
        >
          {(() => {
            const qoqA: { label: string; value: number }[] = [];
            for (let i = 1; i < aaumA.length; i++) {
              const cur = aaumA[i].avgAum;
              const prev = aaumA[i - 1].avgAum;
              if (prev > 0) {
                qoqA.push({
                  label: aaumA[i].fiscalLabel,
                  value: ((cur - prev) / prev) * 100,
                });
              }
            }
            const qoqB: { label: string; value: number }[] = [];
            for (let i = 1; i < aaumB.length; i++) {
              const cur = aaumB[i].avgAum;
              const prev = aaumB[i - 1].avgAum;
              if (prev > 0) {
                qoqB.push({
                  label: aaumB[i].fiscalLabel,
                  value: ((cur - prev) / prev) * 100,
                });
              }
            }
            const labels = Array.from(
              new Set([...qoqA.map((q) => q.label), ...qoqB.map((q) => q.label)])
            ).sort();
            const aMap = new Map(qoqA.map((q) => [q.label, q.value]));
            const bMap = new Map(qoqB.map((q) => [q.label, q.value]));
            const data = labels.map((label) => ({
              label,
              [slugA]: aMap.get(label) ?? null,
              [slugB]: bMap.get(label) ?? null,
            }));
            if (data.length === 0) {
              return (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Insufficient history
                </div>
              );
            }
            return (
              <MultiLine
                data={data}
                xKey="label"
                valueFormat="pct"
                axisFormat="pct"
                labelFormat="none"
                lines={[
                  {
                    key: slugA,
                    name: detailA?.displayName ?? slugA,
                    color: BRAND.navy,
                  },
                  {
                    key: slugB,
                    name: detailB?.displayName ?? slugB,
                    color: BRAND.orange,
                  },
                ]}
              />
            );
          })()}
        </Card>
      </section>

      {/* Quick comparison table */}
      {detailA && detailB && (
        <Card
          title="Latest Quarter — Side-by-Side"
          subtitle={`${detailA.latest?.fiscalLabel ?? "—"} · Source: AMFI Fundwise AAUM`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Metric</th>
                  <th className="py-2 pr-4 text-right font-medium tabular">
                    {detailA.displayName}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium tabular">
                    {detailB.displayName}
                  </th>
                  <th className="py-2 pr-1 text-right font-medium tabular">Δ</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "MF Average AUM",
                    a: detailA.latest?.avgAum ?? null,
                    b: detailB.latest?.avgAum ?? null,
                    fmt: (n: number | null) => formatCompactCrSafe(n),
                    deltaFmt: "cr" as const,
                  },
                  {
                    label: "Market Share",
                    a: detailA.latest?.marketSharePct ?? null,
                    b: detailB.latest?.marketSharePct ?? null,
                    fmt: (n: number | null) => formatPctSafe(n, 2),
                    deltaFmt: "pp" as const,
                  },
                  {
                    label: "Rank by AAUM",
                    a: detailA.latest?.rank ?? null,
                    b: detailB.latest?.rank ?? null,
                    fmt: (n: number | null) => (n === null ? "—" : `#${n}`),
                    deltaFmt: "rank" as const,
                  },
                  {
                    label: "QoQ Growth",
                    a: growthA?.qoqGrowthPct ?? null,
                    b: growthB?.qoqGrowthPct ?? null,
                    fmt: (n: number | null) =>
                      n === null ? "—" : formatDelta(n),
                    deltaFmt: "pp" as const,
                  },
                  {
                    label: "YoY Growth",
                    a: growthA?.yoyGrowthPct ?? null,
                    b: growthB?.yoyGrowthPct ?? null,
                    fmt: (n: number | null) =>
                      n === null ? "—" : formatDelta(n),
                    deltaFmt: "pp" as const,
                  },
                ].map((row) => {
                  const both =
                    typeof row.a === "number" && typeof row.b === "number";
                  let deltaStr = "—";
                  let deltaClass = "text-muted-foreground";
                  if (both) {
                    const d = (row.a as number) - (row.b as number);
                    if (row.deltaFmt === "cr") {
                      deltaStr = formatCompactCrSafe(Math.abs(d));
                      if (d > 0) deltaStr = "+" + deltaStr;
                      else if (d < 0) deltaStr = "−" + deltaStr;
                    } else if (row.deltaFmt === "pp") {
                      deltaStr = (d > 0 ? "+" : "") + d.toFixed(2) + " pp";
                    } else if (row.deltaFmt === "rank") {
                      // Lower rank is better. Show signed integer difference.
                      deltaStr = (d > 0 ? "+" : "") + d;
                    }
                    if (d > 0) deltaClass = "text-positive";
                    else if (d < 0) deltaClass = "text-negative";
                  }
                  return (
                    <tr key={row.label} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">
                        {row.label}
                      </td>
                      <td className="py-2 pr-4 text-right tabular font-medium">
                        {row.fmt(row.a)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular font-medium">
                        {row.fmt(row.b)}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-1 text-right tabular",
                          deltaClass
                        )}
                      >
                        {deltaStr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Δ = {detailA.displayName} − {detailB.displayName}. For Rank,
            a negative Δ means {detailA.displayName} is the larger AMC.
          </p>
        </Card>
      )}
    </div>
  );
}

interface ComparisonSide {
  displayName: string;
  latest:
    | {
        avgAum: number;
        marketSharePct: number;
        rank: number;
      }
    | null;
  growth:
    | {
        qoqGrowthPct: number | null;
        yoyGrowthPct: number | null;
      }
    | null;
}

function ComparisonRead({ a, b }: { a: ComparisonSide; b: ComparisonSide }) {
  if (!a.latest || !b.latest) {
    return (
      <p className="text-sm text-muted-foreground">
        Latest-quarter data unavailable for one or both AMCs.
      </p>
    );
  }
  const largerByAum = a.latest.avgAum >= b.latest.avgAum ? a : b;
  const smallerByAum = largerByAum === a ? b : a;
  const aumGapCr = Math.abs(a.latest.avgAum - b.latest.avgAum);
  const shareGap = a.latest.marketSharePct - b.latest.marketSharePct;

  const aQoQ = a.growth?.qoqGrowthPct ?? null;
  const bQoQ = b.growth?.qoqGrowthPct ?? null;
  const aYoY = a.growth?.yoyGrowthPct ?? null;
  const bYoY = b.growth?.yoyGrowthPct ?? null;

  const fasterQoQ =
    aQoQ === null || bQoQ === null
      ? null
      : aQoQ > bQoQ
      ? a
      : aQoQ < bQoQ
      ? b
      : null;

  const fasterYoY =
    aYoY === null || bYoY === null
      ? null
      : aYoY > bYoY
      ? a
      : aYoY < bYoY
      ? b
      : null;

  const sharePart =
    shareGap === 0
      ? `Share split is even at ${a.latest.marketSharePct.toFixed(2)}% each.`
      : `${largerByAum.displayName} holds ${largerByAum.latest!.marketSharePct.toFixed(2)}% vs ${smallerByAum.displayName}'s ${smallerByAum.latest!.marketSharePct.toFixed(2)}% (${Math.abs(shareGap).toFixed(2)} pp gap).`;

  const sizePart = `${largerByAum.displayName} is the larger franchise by ${formatCompactCrSafe(aumGapCr)} of AAUM.`;

  const growthPart = (() => {
    if (!fasterQoQ && !fasterYoY) return "QoQ and YoY growth data unavailable.";
    if (fasterQoQ && fasterYoY && fasterQoQ === fasterYoY) {
      return `${fasterQoQ.displayName} is the faster grower on both QoQ (${(fasterQoQ === a ? aQoQ! : bQoQ!).toFixed(2)}%) and YoY (${(fasterQoQ === a ? aYoY! : bYoY!).toFixed(2)}%).`;
    }
    if (fasterQoQ) {
      return `${fasterQoQ.displayName} is growing faster QoQ (${(fasterQoQ === a ? aQoQ! : bQoQ!).toFixed(2)}% vs ${(fasterQoQ === a ? bQoQ! : aQoQ!).toFixed(2)}%).`;
    }
    return `${fasterYoY!.displayName} is growing faster YoY (${(fasterYoY === a ? aYoY! : bYoY!).toFixed(2)}% vs ${(fasterYoY === a ? bYoY! : aYoY!).toFixed(2)}%).`;
  })();

  const rankPart = (() => {
    if (a.latest.rank === b.latest.rank)
      return `Rank #${a.latest.rank} (tie).`;
    if (a.latest.rank < b.latest.rank)
      return `${a.displayName} ranks #${a.latest.rank} vs ${b.displayName} #${b.latest.rank}.`;
    return `${b.displayName} ranks #${b.latest.rank} vs ${a.displayName} #${a.latest.rank}.`;
  })();

  // Headline interpretation — combines size + growth + share signal.
  const headline = (() => {
    if (fasterQoQ && fasterQoQ !== largerByAum) {
      return `${largerByAum.displayName} is larger, but ${fasterQoQ.displayName} is growing faster and ${
        (fasterQoQ === a ? (aQoQ ?? 0) : (bQoQ ?? 0)) > 0
          ? "gaining share"
          : "shrinking its gap"
      }.`;
    }
    if (fasterQoQ && fasterQoQ === largerByAum) {
      return `${largerByAum.displayName} is both larger and growing faster — extending its lead.`;
    }
    return `${largerByAum.displayName} is the larger franchise; growth pace is close to ${smallerByAum.displayName}.`;
  })();

  return (
    <div className="space-y-1.5 text-[13px] leading-snug">
      <p className="font-medium text-foreground">{headline}</p>
      <p className="text-muted-foreground">
        {sizePart} {sharePart} {growthPart} {rankPart}
      </p>
    </div>
  );
}
