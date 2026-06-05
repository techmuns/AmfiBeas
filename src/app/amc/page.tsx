import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import {
  FundwiseTable,
  type FundwiseMetric,
} from "@/components/data/FundwiseTable";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import { AmcEquityBookHeatmap } from "@/components/data/AmcEquityBookHeatmap";
import { AmcHeadToHead } from "@/components/data/AmcHeadToHead";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
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
} from "@/data/amc-compare";
import {
  fundwiseAumMatrix,
  latestQoqAnomalies,
} from "@/data/amc-peer-universe";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import { LensToggle } from "@/components/ui/LensToggle";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { resolveTabWithAliases } from "@/lib/tabs";

const AMC_TABS = [
  { id: "overview", label: "AMC Overview" },
  { id: "share", label: "Market Share & Concentration" },
  { id: "compare", label: "Compare" },
] as const satisfies readonly DashboardTabDef[];
type AmcTabId = (typeof AMC_TABS)[number]["id"];
const AMC_TAB_IDS = AMC_TABS.map((t) => t.id) as readonly AmcTabId[];

export default async function AmcListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeTab = resolveTabWithAliases<AmcTabId>(
    sp.tab,
    AMC_TAB_IDS,
    { insights: "share", "share-positioning": "share" },
    "overview",
  );
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

  // Fundwise (per-AMC) AUM & market-share heatmap. Metric toggle picks
  // what the cells show; default is market share + QoQ Δ bps.
  const fundwiseMetric: FundwiseMetric =
    sp.fundwiseMetric === "aaum"
      ? "aaum"
      : sp.fundwiseMetric === "growth"
        ? "growth"
        : "share";
  const fundwise = fundwiseAumMatrix(25, 8);
  const fundwiseLatestIdx = fundwise.quarterLabels.length - 1;

  // Headline read: biggest share gainer / loser in the latest quarter (bps).
  const fundwiseLeaders =
    fundwise.rows.length >= 4 && fundwiseLatestIdx >= 1
      ? (() => {
          const withDelta = fundwise.rows
            .map((r) => ({ row: r, cell: r.cells[fundwiseLatestIdx] }))
            .filter(
              (x): x is { row: (typeof fundwise.rows)[number]; cell: NonNullable<typeof x.cell> } =>
                x.cell !== null && x.cell.shareDeltaBps !== null
            )
            .sort((a, b) => (b.cell.shareDeltaBps ?? 0) - (a.cell.shareDeltaBps ?? 0));
          if (withDelta.length === 0) return null;
          const top5 = [...fundwise.rows]
            .map((r) => r.cells[fundwiseLatestIdx]?.sharePct ?? 0)
            .sort((a, b) => b - a)
            .slice(0, 5)
            .reduce((s, v) => s + v, 0);
          return {
            gainer: withDelta[0],
            loser: withDelta[withDelta.length - 1],
            top5,
            prevLabel: fundwise.quarterLabels[fundwiseLatestIdx - 1],
            latestLabel: fundwise.quarterLabels[fundwiseLatestIdx],
          };
        })()
      : null;

  // Flatten the current metric's grid for the Excel (CSV) export.
  type FundwiseCsvRow = Record<string, string | number>;
  const fundwiseCsvRows: FundwiseCsvRow[] = fundwise.rows.map((r) => {
    const obj: FundwiseCsvRow = { AMC: r.displayName };
    fundwise.quarterLabels.forEach((label, i) => {
      const c = r.cells[i];
      obj[label] =
        c === null
          ? ""
          : fundwiseMetric === "aaum"
            ? Math.round(c.aaum)
            : fundwiseMetric === "growth"
              ? c.growthPct === null
                ? ""
                : Number(c.growthPct.toFixed(2))
              : Number(c.sharePct.toFixed(2));
    });
    return obj;
  });
  const fundwiseCsvColumns: CsvColumn<FundwiseCsvRow>[] = [
    { key: "AMC", header: "AMC" },
    ...fundwise.quarterLabels.map((label) => ({ key: label, header: label })),
  ];

  const equityBook = amcEquityBook();
  const equityBookDiag = amcEquityBookDiagnostics();

  const compareUniverse = amcCompareUniverse();
  const compareSlugs = new Set(compareUniverse.map((u) => u.slug));
  const aSlug =
    typeof sp.a === "string" && compareSlugs.has(sp.a)
      ? sp.a
      : compareUniverse[0]?.slug ?? "";
  const bSlug =
    typeof sp.b === "string" && compareSlugs.has(sp.b)
      ? sp.b
      : compareUniverse[1]?.slug ?? "";
  const aCompare = amcComparison(aSlug);
  const bCompare = amcComparison(bSlug);
  const industryCompare = industryComparison();

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

      {activeTab === "share" && <AmcStockConcentration />}

      {activeTab === "share" && <CohortUniqueInvestorShare />}

      {activeTab === "share" && (
        <StrategicMovesCohortLane
          selectedAmc={typeof sp.moveAmc === "string" ? sp.moveAmc : undefined}
          selectedPeriod={
            typeof sp.movePeriod === "string" ? sp.movePeriod : undefined
          }
        />
      )}

      {activeTab === "share" && fundwise.rows.length > 0 && (
        <Card
          title="Fund-by-Fund Market Share"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Each AMC&rsquo;s share of cohort AAUM by quarter, with the QoQ
                move in basis points — read down a column for the pecking order,
                across a row for momentum.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Top ${fundwise.rows.length} AMCs by AAUM · ${fundwise.quarterLabels[0]} → ${fundwise.quarterLabels[fundwiseLatestIdx]}`}
              </p>
            </div>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <LensToggle
                basePath="/amc"
                paramName="fundwiseMetric"
                defaultValue="share"
                lenses={[
                  { value: "share", label: "Market share" },
                  { value: "aaum", label: "AAUM" },
                  { value: "growth", label: "QoQ growth" },
                ]}
                active={fundwiseMetric}
                preserveParams={{
                  tab: typeof sp.tab === "string" ? sp.tab : undefined,
                }}
                wrap
              />
              <DownloadXlsxButton
                rows={fundwiseCsvRows}
                columns={fundwiseCsvColumns}
                filename={`fundwise-${fundwiseMetric}.xlsx`}
                sheetName={`Fundwise ${fundwiseMetric}`}
                label="Excel"
              />
            </div>
          }
        >
          {fundwiseLeaders && (
            <KeyTakeaway
              className="mb-3"
              headline={
                <>
                  Over {fundwiseLeaders.prevLabel} →{" "}
                  {fundwiseLeaders.latestLabel},{" "}
                  <strong>{fundwiseLeaders.gainer.row.displayName}</strong>{" "}
                  gained the most share (
                  <span className="text-positive">
                    {(fundwiseLeaders.gainer.cell.shareDeltaBps ?? 0) >= 0
                      ? "+"
                      : "−"}
                    {Math.abs(
                      Math.round(fundwiseLeaders.gainer.cell.shareDeltaBps ?? 0)
                    )}{" "}
                    bps
                  </span>{" "}
                  to {fundwiseLeaders.gainer.cell.sharePct.toFixed(2)}%), while{" "}
                  <strong>{fundwiseLeaders.loser.row.displayName}</strong> gave
                  up the most (
                  <span className="text-negative">
                    {(fundwiseLeaders.loser.cell.shareDeltaBps ?? 0) >= 0
                      ? "+"
                      : "−"}
                    {Math.abs(
                      Math.round(fundwiseLeaders.loser.cell.shareDeltaBps ?? 0)
                    )}{" "}
                    bps
                  </span>{" "}
                  to {fundwiseLeaders.loser.cell.sharePct.toFixed(2)}%).
                </>
              }
              detail={
                <>
                  Top-5 AMCs hold {fundwiseLeaders.top5.toFixed(1)}% of cohort
                  AAUM.{" "}
                  {fundwiseMetric === "share"
                    ? "Cells are tinted green where share was gained over the prior quarter, red where it was given up."
                    : "Cells are tinted green where AAUM grew over the prior quarter, red where it shrank."}
                </>
              }
            />
          )}
          <FundwiseTable matrix={fundwise} metric={fundwiseMetric} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Share % = each AMC&rsquo;s AAUM as a fraction of the cohort total
            that quarter; the small figure beneath is the QoQ change in basis
            points (100 bps = 1pp). Toggle to <strong>AAUM</strong> for the rupee
            base (₹ Cr) or <strong>QoQ growth</strong> for the period-on-period
            change; both are tinted by momentum. Export sends the active view to
            Excel.
          </p>
        </Card>
      )}

      {activeTab === "share" && equityBook.length > 0 && (
        <Card title="Per-AMC Equity Holdings Mix — Active vs Passive (derived)">
          <AmcEquityBookHeatmap rows={equityBook} diagnostics={equityBookDiag} />
        </Card>
      )}

      {activeTab === "share" && <AmcCashAllocationTrend />}

      {activeTab === "compare" && aCompare && bCompare && (
        <Card title="AMC Head-to-Head">
          <AmcHeadToHead
            a={aCompare}
            b={bCompare}
            industry={industryCompare}
            universe={compareUniverse}
            quarterLabel={data.fiscalLabel}
          />
        </Card>
      )}

      {activeTab === "overview" && (
        <Card
          title="All AMCs — Rank, Assets & Market Share"
          subtitle="Searchable directory of every AMC — click any row to drill into its schemes."
        >
          <AmcSearchTable rows={data.rows} />
        </Card>
      )}

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

