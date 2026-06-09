import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { ClientTabs, type ClientTabDef } from "@/components/layout/ClientTabs";
import { FundwiseCard } from "@/components/data/FundwiseCard";
import { AmcEquityBookHeatmap } from "@/components/data/AmcEquityBookHeatmap";
import { AmcHeadToHead } from "@/components/data/AmcHeadToHead";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
import { MarketShareByProduct } from "@/components/data/MarketShareByProduct";
import { marketShareByProduct } from "@/data/aggregate";
import { StrategicMovesCohortLane } from "@/components/amc/StrategicMovesCohortLane";
import { CohortUniqueInvestorShare } from "@/components/amc/CohortUniqueInvestorShare";
import { AmcCashAllocationTrend } from "@/components/amc/AmcCashAllocationTrend";
import { AmcStockConcentration } from "@/components/amc/AmcStockConcentration";
import { amcIndexRows } from "@/data/amc-detail";
import {
  amcEquityBook,
  amcEquityBookDiagnostics,
} from "@/data/amc-equity-book";
import {
  amcCompareUniverse,
  amcComparison,
  industryComparison,
  industryAverageComparison,
  type AmcCompareMetrics,
} from "@/data/amc-compare";
import {
  fundwiseAumMatrix,
  latestQoqAnomalies,
} from "@/data/amc-peer-universe";
import { cn } from "@/lib/cn";

// Statically rendered: all three tabs are built at deploy time and switched in
// the browser (see ClientTabs), so a tab switch never spends Worker CPU — which
// is what keeps the page under the Cloudflare Free-plan CPU budget (Error 1102).
// The interactive bits (fundwise lens, compare A/B picker) are client-side too.
export const dynamic = "force-static";

const AMC_TABS = [
  { id: "overview", label: "AMC Overview" },
  { id: "share", label: "Market Share & Concentration" },
  { id: "compare", label: "Compare" },
] as const satisfies readonly ClientTabDef[];

export default async function AmcListPage() {
  const data = amcIndexRows();

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="AMCs" subtitle="No AAUM data available." />
      </div>
    );
  }

  const subtitle = `${data.rows.length} AMCs · ${data.fiscalLabel}`;

  // Everything below is computed at BUILD time (this page is force-static), so
  // none of it counts against the per-request Worker CPU budget at runtime.
  const anomalies = latestQoqAnomalies(2);
  const fundwise = fundwiseAumMatrix(25, 8);
  const equityBook = amcEquityBook();
  const equityBookDiag = amcEquityBookDiagnostics();

  const productShare = marketShareByProduct();
  const amcNameBySlug = new Map(
    data.rows.map((r) => [r.amcSlug, r.displayName])
  );
  const productShareRows = (productShare?.rows ?? [])
    .filter((r) => amcNameBySlug.has(r.amcSlug))
    .slice(0, 20)
    .map((r) => ({ ...r, displayName: amcNameBySlug.get(r.amcSlug) as string }));

  const compareUniverse = amcCompareUniverse();
  const compareMetrics = compareUniverse
    .map((u) => amcComparison(u.slug))
    .filter((m): m is AmcCompareMetrics => m !== null);
  const industryCompare = industryComparison();
  const industryAvgCompare = industryAverageComparison();

  const overviewPanel = (
    <>
      {anomalies && anomalies.outliers.length > 0 && (
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

      <Card
        title="All AMCs — Rank, Assets & Market Share"
        subtitle="Searchable directory of every AMC — click any row to drill into its schemes."
      >
        <AmcSearchTable rows={data.rows} />
      </Card>
    </>
  );

  const sharePanel = (
    <>
      <AmcStockConcentration />
      <CohortUniqueInvestorShare />
      <StrategicMovesCohortLane />
      <FundwiseCard matrix={fundwise} />
      {productShare && productShareRows.length > 0 && (
        <Card
          title="Market Share by Product"
          subtitle="Where each AMC is strong by category — its share within Equity, Debt, Liquid and more."
        >
          <MarketShareByProduct
            month={productShare.month}
            rows={productShareRows}
          />
        </Card>
      )}
      {equityBook.length > 0 && equityBookDiag && (
        <Card title="Per-AMC Equity Holdings Mix — Active vs Passive (derived)">
          <AmcEquityBookHeatmap rows={equityBook} diagnostics={equityBookDiag} />
        </Card>
      )}
      <AmcCashAllocationTrend />
    </>
  );

  const comparePanel =
    compareMetrics.length >= 2 ? (
      <Card title="AMC Head-to-Head">
        <AmcHeadToHead
          metrics={compareMetrics}
          industry={industryCompare}
          industryAvg={industryAvgCompare}
          universe={compareUniverse}
          quarterLabel={data.fiscalLabel}
        />
      </Card>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="AMCs" subtitle={subtitle} />

      <ClientTabs
        tabs={AMC_TABS}
        defaultId="overview"
        panels={{
          overview: overviewPanel,
          share: sharePanel,
          compare: comparePanel,
        }}
      />

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
