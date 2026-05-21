import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarSeries } from "@/components/charts/BarSeries";
import { movingAverage } from "@/lib/chart-context";
import {
  dataMode,
  latestOtherSchemesCategoryBreakdown,
  otherSchemesByMonth,
} from "@/data/source";
import { formatINR, formatDelta, formatMonthLabel } from "@/lib/format";
import { momChange, yoyChange } from "@/data/aggregate";
import { liveOtherSchemesNote } from "@/lib/provenance";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { TabIntroCard } from "@/components/ui/TabIntroCard";
import { resolveTab } from "@/lib/tabs";

const OTHER_SCHEMES_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "flows", label: "Net Flows" },
  { id: "scheme-mix", label: "Scheme Mix" },
] as const satisfies readonly DashboardTabDef[];
type OtherSchemesTabId = (typeof OTHER_SCHEMES_TABS)[number]["id"];
const OTHER_SCHEMES_TAB_IDS = OTHER_SCHEMES_TABS.map(
  (t) => t.id,
) as readonly OtherSchemesTabId[];

export default async function OtherSchemesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeTab = resolveTab<OtherSchemesTabId>(
    sp.tab,
    OTHER_SCHEMES_TAB_IDS,
    "snapshot",
  );
  const isLive = dataMode().otherSchemes === "live";
  const series = otherSchemesByMonth();
  const breakdown = latestOtherSchemesCategoryBreakdown();
  const latest = series[series.length - 1];

  if (!isLive || !latest || !breakdown) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Passive & Other Schemes"
          subtitle="No data yet"
        />
        <Card>
          <p className="text-sm text-muted-foreground">
            Awaiting first ingest.
          </p>
        </Card>
      </div>
    );
  }

  const aumMom = momChange(series.map((s) => s.totalAum));
  const aumYoy = yoyChange(series.map((s) => s.totalAum));
  const flowMom = momChange(series.map((s) => s.netFlow));

  const aumSeries = series.map((s) => ({
    month: s.month,
    value: s.totalAum,
  }));
  const flowSeries = series.map((s) => ({
    label: s.month,
    value: s.netFlow,
  }));
  const mobilizedSeries = series.map((s) => ({
    label: s.month,
    value: s.fundsMobilized,
  }));

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  const totalAum = breakdown.rows.reduce((s, r) => s + r.aum, 0);
  const otherSchemesNote = liveOtherSchemesNote();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Passive & Other Schemes"
        subtitle={`Live AMFI data · SEBI Group V · ${formatMonthLabel(latest.month)} · ${series.length}M history`}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[10px] tabular text-positive">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
            Live
          </span>
        }
      />

      <DashboardTabs
        basePath="/other-schemes"
        tabs={OTHER_SCHEMES_TABS}
        activeId={activeTab}
        searchParams={sp}
      />

      {activeTab === "snapshot" && (
        <TabIntroCard
          headline="How big is the passive + other-schemes pool right now?"
          summary="SEBI Group V (ETFs, index funds, FoFs, gold ETFs and similar) headline KPIs plus the full AUM history. This is the structural-share lens for the industry."
          watchNext="Whether total AUM continues to compound faster than the broader industry — that's the passive-shift signal in one chart."
        />
      )}

      {activeTab === "snapshot" && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total AUM"
            value={formatINR(latest.totalAum, { compact: true })}
            delta={`${formatDelta(aumYoy)} YoY`}
            trend={trend(aumYoy)}
            note={otherSchemesNote}
          />
          <KpiCard
            label="Net Flow"
            value={formatINR(latest.netFlow, { compact: true })}
            delta={`${formatDelta(flowMom)} MoM`}
            trend={trend(flowMom)}
            note={otherSchemesNote}
          />
          <KpiCard
            label="Funds Mobilised"
            value={formatINR(latest.fundsMobilized, { compact: true })}
            note={otherSchemesNote}
          />
          <KpiCard
            label="Folios"
            value={(latest.totalFolios / 1e7).toFixed(2) + " Cr"}
            delta={`${formatDelta(aumMom)} MoM AUM`}
            trend={trend(aumMom)}
            note={otherSchemesNote}
          />
        </section>
      )}

      {activeTab === "snapshot" && (
        <Card title="AUM Trend" subtitle={`Group V total · ${series.length} months`}>
          <AreaTrend data={aumSeries} name="AUM" />
        </Card>
      )}

      {activeTab === "flows" && (
        <TabIntroCard
          headline="Is the passive pool absorbing or shedding money?"
          summary="Monthly net flow (inflow vs outflow) and gross funds mobilised before redemptions, with a 12-month moving-average overlay for the latter. Together they separate sentiment from steady contribution."
          watchNext="Whether net flow stays positive even as the broader market cycle turns — that's the durable structural-shift signal."
        />
      )}

      {activeTab === "flows" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Net Flow"
            subtitle="Inflow (+) / Outflow (−) per month · zero reference + signed area fill"
          >
            <BarSeries
              data={flowSeries}
              color="hsl(var(--chart-2))"
              name="Net flow"
              zeroReference
            />
          </Card>
          <Card
            title="Funds Mobilised"
            subtitle="Gross monthly inflow before redemptions · dashed line = 12M average"
          >
            <BarSeries
              data={mobilizedSeries}
              color="hsl(var(--chart-1))"
              name="Mobilised"
              trendline={movingAverage(mobilizedSeries, 12)}
              trendlineName="12M avg"
            />
          </Card>
        </section>
      )}

      {activeTab === "scheme-mix" && (
        <TabIntroCard
          headline="Where inside the passive pool is the money sitting?"
          summary="Sub-categories of SEBI Group V — ETFs (equity, debt, gold), index funds, FoFs — sorted by AUM, with the latest month's net flow per category."
          watchNext="Whether the share split between equity-ETFs and debt-ETFs widens or compresses across the next 2-3 months."
        />
      )}

      {activeTab === "scheme-mix" && (
        <Card
          title={`Category Breakdown · ${formatMonthLabel(breakdown.month)}`}
          subtitle="Sub-categories of SEBI Group V, sorted by AUM"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 text-right font-medium tabular">AUM</th>
                  <th className="py-2 pr-4 text-right font-medium tabular">
                    Share
                  </th>
                  <th className="py-2 pr-4 text-right font-medium tabular">
                    Net Flow
                  </th>
                  <th className="py-2 pr-4 text-right font-medium tabular">
                    Folios
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.rows.map((r) => (
                  <tr key={r.category} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{r.category}</td>
                    <td className="py-3 pr-4 text-right tabular">
                      {formatINR(r.aum, { compact: true })}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {((r.aum / totalAum) * 100).toFixed(1)}%
                    </td>
                    <td
                      className={cn(
                        "py-3 pr-4 text-right tabular",
                        r.netFlow > 0 && "text-positive",
                        r.netFlow < 0 && "text-negative",
                        r.netFlow === 0 && "text-muted-foreground"
                      )}
                    >
                      {r.netFlow > 0 ? "+" : ""}
                      {formatINR(r.netFlow, { compact: true })}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {(r.folios / 1e5).toFixed(1)} L
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
