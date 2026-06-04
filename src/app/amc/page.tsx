import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { GrowthVsMarket } from "@/components/charts/GrowthVsMarket";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
import { StrategicMovesCohortLane } from "@/components/amc/StrategicMovesCohortLane";
import { CohortUniqueInvestorShare } from "@/components/amc/CohortUniqueInvestorShare";
import { IndustryConcentrationStack } from "@/components/amc/IndustryConcentrationStack";
import { AmcCashAllocationTrend } from "@/components/amc/AmcCashAllocationTrend";
import { AmcStockConcentration } from "@/components/amc/AmcStockConcentration";
import { amcIndexRows } from "@/data/amc-detail";
import {
  cohortGrowthVsMarket,
  cohortJourneyEndQuarters,
  latestQoqAnomalies,
} from "@/data/amc-peer-universe";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import { LensToggle } from "@/components/ui/LensToggle";
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
  const anomalies = latestQoqAnomalies(2);

  // Growth vs the Market — QoQ (3-month) growth + share change ending at
  // the selected quarter. The selector lists the recent quarter-ends that
  // have a clean preceding quarter; defaults to the latest.
  const shareQuarters = cohortJourneyEndQuarters();
  const latestShareQuarter =
    shareQuarters.length > 0
      ? shareQuarters[shareQuarters.length - 1].quarter
      : undefined;
  const selectedShareQuarter =
    typeof sp.sharePeriod === "string" &&
    shareQuarters.some((q) => q.quarter === sp.sharePeriod)
      ? sp.sharePeriod
      : latestShareQuarter;
  const growth = selectedShareQuarter
    ? cohortGrowthVsMarket(20, selectedShareQuarter)
    : null;

  // Headline read: biggest share gainer / loser this quarter, framed
  // against the industry's growth benchmark.
  const growthLeaders =
    growth && growth.points.length >= 4
      ? (() => {
          const byDelta = [...growth.points].sort(
            (a, b) => b.shareDeltaPp - a.shareDeltaPp
          );
          const top5 = [...growth.points]
            .sort((a, b) => b.sharePct - a.sharePct)
            .slice(0, 5)
            .reduce((s, p) => s + p.sharePct, 0);
          return {
            gainer: byDelta[0],
            loser: byDelta[byDelta.length - 1],
            top5,
            industryGrowthPct: growth.industryGrowthPct,
            start: growth.startQuarterLabel,
            end: growth.endQuarterLabel,
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

      {activeTab === "share-positioning" && growth && growth.points.length >= 4 && (
        <Card
          title="Growth vs the Market"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                How fast each AMC grew versus the industry — and what that did
                to its market share.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`One row per AMC · ${growth.startQuarterLabel} → ${growth.endQuarterLabel}`}
              </p>
            </div>
          }
          action={
            shareQuarters.length > 1 && selectedShareQuarter ? (
              <LensToggle
                basePath="/amc"
                paramName="sharePeriod"
                defaultValue={latestShareQuarter ?? ""}
                lenses={[...shareQuarters]
                  .reverse()
                  .map((q) => ({ value: q.quarter, label: q.label }))}
                active={selectedShareQuarter}
                preserveParams={{
                  tab: typeof sp.tab === "string" ? sp.tab : undefined,
                }}
                wrap
              />
            ) : undefined
          }
        >
          {growthLeaders && (
            <KeyTakeaway
              className="mb-3"
              headline={
                <>
                  Industry AAUM grew{" "}
                  <strong>
                    {growthLeaders.industryGrowthPct >= 0 ? "+" : "−"}
                    {Math.abs(growthLeaders.industryGrowthPct).toFixed(1)}%
                  </strong>{" "}
                  over {growthLeaders.start} → {growthLeaders.end}.{" "}
                  <strong>{growthLeaders.gainer.displayName}</strong> gained the
                  most share (
                  <span className="text-positive">
                    +{growthLeaders.gainer.shareDeltaPp.toFixed(2)}pp
                  </span>{" "}
                  to {growthLeaders.gainer.sharePct.toFixed(2)}%) on{" "}
                  {growthLeaders.gainer.aumGrowthPct >= 0 ? "+" : "−"}
                  {Math.abs(growthLeaders.gainer.aumGrowthPct).toFixed(1)}%
                  growth, while{" "}
                  <strong>{growthLeaders.loser.displayName}</strong> lost the most
                  (
                  <span className="text-negative">
                    {growthLeaders.loser.shareDeltaPp.toFixed(2)}pp
                  </span>{" "}
                  to {growthLeaders.loser.sharePct.toFixed(2)}%) on{" "}
                  {growthLeaders.loser.aumGrowthPct >= 0 ? "+" : "−"}
                  {Math.abs(growthLeaders.loser.aumGrowthPct).toFixed(1)}% growth.
                </>
              }
              detail={
                <>
                  Top-5 AMCs hold {growthLeaders.top5.toFixed(1)}% of cohort
                  AAUM. An AMC gains share only when it grows faster than the
                  industry.
                </>
              }
            />
          )}
          <GrowthVsMarket points={growth.points} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Bar = each AMC&rsquo;s AUM growth versus the industry&rsquo;s{" "}
            {growth.industryGrowthPct >= 0 ? "+" : "−"}
            {Math.abs(growth.industryGrowthPct).toFixed(1)}% pace (centre line):
            right = grew faster → gaining share, left = slower → losing.{" "}
            &ldquo;AUM gr.&rdquo; is the AMC&rsquo;s own growth; &ldquo;Share&rdquo;
            its end-quarter market share; &ldquo;Δ share&rdquo; the change (pp).
          </p>
        </Card>
      )}

      {activeTab === "share-positioning" && <AmcCashAllocationTrend />}

      {activeTab === "share-positioning" && <IndustryConcentrationStack />}

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

