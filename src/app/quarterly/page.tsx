import Link from "next/link";
import type { DonutSlice } from "@/components/charts/Donut";
import { QuarterEndMixTable } from "@/components/data/QuarterEndMixTable";
import { AaumBridgeTable } from "@/components/data/AaumBridgeTable";
import { MultiLine } from "@/components/charts/MultiLine";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { quarterlyMarketWrap } from "@/data/market-wrap-quarterly";
import type { ReactNode } from "react";
import { ClientPeriodSwitcher } from "@/components/layout/ClientPeriodSwitcher";
import { PageHeader } from "@/components/layout/PageHeader";
import { cyclePhaseHistory } from "@/data/market-indices";
import { CycleRibbon } from "@/components/ui/CycleRibbon";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  availableQuartersDesc,
  formatQuarterlyProvenanceLine,
  formatQuarterlyProvenanceTooltip,
  getQuarterlyKpiProvenance,
  getQuarterlyKpiValue,
  liquidAumForQuarter,
  quarterlyCategoryAumProvenance,
  quarterlyEquityLastMonthAaumBreakdown,
  quarterlyFlowsData,
  quarterlyFolioAdditionsTrend,
  quarterlyKpiContext,
  quarterlySnapshotSectionRead,
  quarterlyTrend,
  categoryHhiPercentileRead,
  categoryHhiSeries,
  resolveSelectedQuarter,
  quarterlyAaumBridge,
  type AmfiQuarterlyKpiField,
} from "@/data/amfi-quarterly";
import {
  formatCompactCrSafe,
  formatLakhSafe,
  formatPercentilePill,
} from "@/lib/format";
import {
  amcLevelHhiPercentileRead,
  amcLevelHhiSeries,
} from "@/data/amc-peer-universe";
import { cn } from "@/lib/cn";
import { ClientTabs, type ClientTabDef } from "@/components/layout/ClientTabs";
import { TabIntroCard } from "@/components/ui/TabIntroCard";

const QUARTERLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "aaum-flows", label: "AUM & Flows" },
  { id: "concentration", label: "Market Competition" },
] as const satisfies readonly ClientTabDef[];

/** Sign-aware compact ₹ Cr formatter — mirrors the equivalent helper
 *  on /monthly so a negative net inflow KPI renders as "−₹32.4K Cr"
 *  rather than the unsigned "₹32.4K Cr". */
function formatSignedCompactCrSafe(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

export const dynamic = "force-static";

export default async function QuarterlyPage() {
  // The page defaults to the latest available quarter; the in-card period
  // switcher (client-side) steps back through recent quarters without a Worker
  // round-trip. `selectedRow` here is the latest, used for the page header.
  const selectedRow = resolveSelectedQuarter(undefined);
  const availableQuarters = availableQuartersDesc();
  const latestQuarterId = availableQuarters[0]?.id;
  const aaumBridge = quarterlyAaumBridge(10);

  // Per-quarter snapshot view-model (KPI cards + AUM-mix), built for each
  // offered quarter at deploy time so ClientPeriodSwitcher can toggle them in
  // the browser with zero Worker CPU.
  const buildQuarterView = (
    sel: ReturnType<typeof resolveSelectedQuarter>
  ) => {
  // ---- AMFI Quarterly Snapshot — KPI cards (selected quarter) -------
  // Mirrors /monthly's AMFI Monthly Snapshot card list:
  //   Total AAUM / Equity AUM / Debt AUM / Liquid AUM / Net Inflow.
  // Liquid AUM is read from the Liquid Fund category row (the
  // industry-row schema doesn't expose it as its own bucket — Liquid
  // is a sub-row of Sub Total - I). Funds Mobilized / Repurchase /
  // Folios / Hybrid / Other Schemes are intentionally NOT here:
  //   - Funds Mobilized + Repurchase belong in Quarterly Flows.
  //   - Folios belongs in Quarterly Folios & Scheme Count.
  //   - Hybrid + Other Schemes don't appear on /monthly's Snapshot
  //     and would clutter the headline grid; the AUM Mix donut
  //     handles those buckets.
  const liquidAum = sel ? liquidAumForQuarter(sel.quarter) : null;
  const liquidProvenance = sel
    ? quarterlyCategoryAumProvenance("liquid", sel.quarter)
    : null;

  type SnapshotCardSpec = {
    key: string;
    label: string;
    value: number | null;
    formatted: string;
    note: string;
    noteHover?: string;
    sparkline?: { label: string; value: number }[];
    sparklineColor?: string;
    yoyPct?: number | null;
    percentile?: number | null;
    ratio?: string;
  };
  const SNAPSHOT_KPI_CARDS: SnapshotCardSpec[] = [];
  const pushSnapshotCard = (
    field: AmfiQuarterlyKpiField,
    label: string,
    format: (v: number | null) => string,
    sparklineColor?: string,
    ratio?: string
  ) => {
    const value = getQuarterlyKpiValue(sel, field);
    if (value === null) return;
    const provenance = getQuarterlyKpiProvenance(sel, field);
    // Anchor YoY / percentile / sparkline to the user-selected quarter,
    // not the latest. Without this the picker only changes the headline
    // value while the pills stay pinned to the most recent quarter.
    const ctx = quarterlyKpiContext(field, 16, sel?.quarter);
    SNAPSHOT_KPI_CARDS.push({
      key: field,
      label,
      value,
      formatted: format(value),
      note: formatQuarterlyProvenanceLine(provenance) ?? "",
      noteHover: formatQuarterlyProvenanceTooltip(provenance) ?? undefined,
      sparkline: ctx.sparkline,
      sparklineColor,
      yoyPct: ctx.yoyPct,
      percentile: ctx.percentile,
      ratio,
    });
  };
  // Per-AUM ratios anchored on the selected row's grandTotalAum.
  const ratioOfTotalAum = (numerator: number | null | undefined): string | undefined => {
    if (
      typeof numerator !== "number" ||
      typeof sel?.grandTotalAum !== "number" ||
      sel.grandTotalAum <= 0
    )
      return undefined;
    return `${((numerator / sel.grandTotalAum) * 100).toFixed(1)}% of total AUM`;
  };
  pushSnapshotCard(
    "grandTotalLastMonthAaum",
    "Last-month AAUM",
    formatCompactCrSafe,
    "hsl(var(--chart-1))"
  );
  pushSnapshotCard(
    "equityAum",
    "Equity AUM",
    formatCompactCrSafe,
    "hsl(var(--chart-1))",
    ratioOfTotalAum(sel?.equityAum)
  );
  pushSnapshotCard(
    "debtAum",
    "Debt AUM",
    formatCompactCrSafe,
    "hsl(var(--chart-2))",
    ratioOfTotalAum(sel?.debtAum)
  );
  if (liquidAum !== null) {
    SNAPSHOT_KPI_CARDS.push({
      key: "liquidAum",
      label: "Liquid AUM",
      value: liquidAum,
      formatted: formatCompactCrSafe(liquidAum),
      note: formatQuarterlyProvenanceLine(liquidProvenance) ?? "",
      noteHover:
        formatQuarterlyProvenanceTooltip(liquidProvenance) ?? undefined,
      sparklineColor: "hsl(var(--chart-4))",
      ratio: ratioOfTotalAum(liquidAum),
    });
  }
  pushSnapshotCard(
    "grandTotalNetInflow",
    "Net Inflow",
    formatSignedCompactCrSafe,
    "hsl(var(--chart-3))",
    typeof sel?.grandTotalNetInflow === "number" &&
      typeof sel?.grandTotalAum === "number" &&
      sel.grandTotalAum > 0
      ? `${((sel.grandTotalNetInflow / sel.grandTotalAum) * 100).toFixed(2)}% of opening AUM`
      : undefined
  );
  // Total AUM rounds out the row to a clean grid; comes last so the
  // AAUM-driven cards lead.
  pushSnapshotCard(
    "grandTotalAum",
    "Total AUM",
    formatCompactCrSafe,
    "hsl(var(--chart-1))"
  );

  const snapshotSubtitle = sel
    ? `Industry-wide · ${sel.quarterLabel} · Source: AMFI Quarterly Report`
    : "Upload AMFI Quarterly PDFs to manual-data/amfi-quarterly/pdfs/, then run npm run ingest:amfi-quarterly-pdf";


  // ---- AMFI Quarterly AUM Mix & Trend -------------------------------
  // Mirrors /monthly's AMFI AUM Mix & Trend exactly:
  //   Donut slices: Equity / Debt / Liquid / Other (residual).
  //   Same colors as /monthly:
  //     Equity = chart-1 (blue)
  //     Debt   = chart-2 (green)
  //     Liquid = chart-4 (purple)
  //     Other  = muted-foreground (grey)
  //   Other = grandTotalAum − (equity + debt + liquid). Only shown
  //   when ALL three sub-categories AND grandTotalAum are present and
  //   the residual is > 0 (otherwise rendering it would mis-state
  //   share). Hybrid / Other Schemes / Solution / close-ended schemes
  //   all sit inside the residual.
  const mixEquity = sel?.equityAum ?? null;
  const mixDebt = sel?.debtAum ?? null;
  const mixLiquid = liquidAum;
  const mixGrand = sel?.grandTotalAum ?? null;
  const mixSlices: DonutSlice[] = [];
  if (typeof mixEquity === "number") {
    mixSlices.push({
      key: "equity",
      label: "Equity",
      value: mixEquity,
      color: "hsl(var(--chart-1))",
    });
  }
  if (typeof mixDebt === "number") {
    mixSlices.push({
      key: "debt",
      label: "Debt",
      value: mixDebt,
      color: "hsl(var(--chart-2))",
    });
  }
  if (typeof mixLiquid === "number") {
    mixSlices.push({
      key: "liquid",
      label: "Liquid",
      value: mixLiquid,
      color: "hsl(var(--chart-4))",
    });
  }
  let mixOther: number | null = null;
  if (
    typeof mixEquity === "number" &&
    typeof mixDebt === "number" &&
    typeof mixLiquid === "number" &&
    typeof mixGrand === "number"
  ) {
    const residual = mixGrand - mixEquity - mixDebt - mixLiquid;
    if (residual > 0) {
      mixOther = residual;
      mixSlices.push({
        key: "other",
        label: "Other",
        value: residual,
        color: "hsl(var(--muted-foreground))",
      });
    }
  }
  const mixHasData = mixSlices.length > 0;
  const mixSubtitle =
    mixHasData && mixOther !== null
      ? `Quarter-end AUM · share of Total AUM (residual = Other) · ${sel?.quarterLabel ?? ""}`
      : mixHasData
        ? `Quarter-end AUM · partial breakdown · Other not computed · ${sel?.quarterLabel ?? ""}`
        : "Quarter-end AUM not available for the selected quarter";
    return { SNAPSHOT_KPI_CARDS, snapshotSubtitle, mixSlices, mixHasData, mixSubtitle };
  };

  // Last-month AAUM trend across the full AMFI quarterly history.




  const folioAdditionsTrend = quarterlyFolioAdditionsTrend(16);

  // Cycle regime + section reads.
  const cyclePhasePoints = cyclePhaseHistory();
  // Three-sentence "today's read" surfaced at the top of the page.
  const marketWrapData = quarterlyMarketWrap();
  const quarterlySnapshotRead = quarterlySnapshotSectionRead();

  // The AMFI Quarterly Snapshot KPI card + AUM-mix card, rendered for one
  // selected quarter. Built per offered quarter at deploy time; the period
  // pills are provided by ClientPeriodSwitcher (no Worker round-trip).
  const renderQuarterNode = (
    sel: ReturnType<typeof resolveSelectedQuarter>
  ): ReactNode => {
    const view = buildQuarterView(sel);
    return (
      <>
        <Card
          title="AMFI Quarterly Snapshot"
          subtitle={
            quarterlySnapshotRead && sel
              ? `${view.snapshotSubtitle} · ${quarterlySnapshotRead}`
              : view.snapshotSubtitle
          }
          action={
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                sel
                  ? "border-positive/40 bg-positive/10 text-positive"
                  : "border-border text-muted-foreground"
              )}
            >
              {sel ? "Live" : "Not connected"}
            </span>
          }
        >
          {view.SNAPSHOT_KPI_CARDS.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {view.SNAPSHOT_KPI_CARDS.map((c) => (
                <KpiCard
                  key={c.key}
                  label={c.label}
                  value={c.formatted}
                  note={c.note}
                  noteHover={c.noteHover}
                  sparkline={c.sparkline}
                  sparklineColor={c.sparklineColor}
                  yoyPct={c.yoyPct ?? undefined}
                  percentile={c.percentile ?? undefined}
                  ratio={c.ratio}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No AMFI quarterly PDF data ingested yet.
            </div>
          )}
        </Card>

        {sel && (
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                AMFI Quarterly AUM Mix
              </h2>
              <p className="text-xs text-muted-foreground">
                Source: AMFI Quarterly Report
              </p>
            </div>
            <Card title="Quarter-end AUM Mix" subtitle={view.mixSubtitle}>
              {view.mixHasData ? (
                <QuarterEndMixTable
                  slices={view.mixSlices}
                  quarterLabel={sel.quarterLabel}
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  AUM mix not published for the selected quarter — pick a more recent quarter or upload the AMFI Quarterly PDF.
                </div>
              )}
            </Card>
          </div>
        )}
      </>
    );
  };

  // Quarters offered in the in-card period switcher (most-recent first, capped
  // to 8 like the old FiscalQuarterPicker), each pre-rendered.
  const quarterDisplay = availableQuarters.slice(0, 8);
  const quarterPanels: Record<string, ReactNode> = Object.fromEntries(
    quarterDisplay.map((q) => [
      q.id,
      renderQuarterNode(resolveSelectedQuarter(q.id)),
    ])
  );

  // Concentration tracker — HHI of AMC-level + category-level AUM.
  const amcHhi = amcLevelHhiSeries(8);
  const catHhi = categoryHhiSeries(16);
  // HHI percentile reads vs the trailing 5 years of history, with
  // change vs the anchor quarter exactly 20 quarters back (= 5Y).
  const amcHhiPercentile = amcLevelHhiPercentileRead(20, 20);
  const catHhiPercentile = categoryHhiPercentileRead(20, 20);
  const hhiHasData = amcHhi.length > 0 || catHhi.length > 0;
  const concentrationLabels = Array.from(
    new Set([
      ...amcHhi.map((p) => p.quarterLabel),
      ...catHhi.map((p) => p.quarterLabel),
    ])
  );
  const amcHhiByLabel = new Map(amcHhi.map((p) => [p.quarterLabel, p.hhi]));
  const catHhiByLabel = new Map(catHhi.map((p) => [p.quarterLabel, p.hhi]));
  const hhiData = concentrationLabels.map((label) => ({
    label,
    amcHhi: amcHhiByLabel.get(label) ?? null,
    categoryHhi: catHhiByLabel.get(label) ?? null,
  }));
  const latestAmcHhi = amcHhi[amcHhi.length - 1] ?? null;
  const latestCatHhi = catHhi[catHhi.length - 1] ?? null;

  // Shared inputs for the snapshot signal tiles below (these series also
  // fed the now-removed AUM / flows / equity-mix trend charts).
  const aaumTrendData = quarterlyTrend("grandTotalLastMonthAaum", 16);
  const flowsData = quarterlyFlowsData(16);
  const aeBreakdown = quarterlyEquityLastMonthAaumBreakdown(16);

  // ---- Quarterly Signal Summary --------------------------------------
  // Five buy-side tiles synthesised from data already loaded above.
  // Each tile answers what changed · why it matters · what to watch.
  const aaumLatest =
    aaumTrendData.length > 0 ? aaumTrendData[aaumTrendData.length - 1] : null;
  const aaumTrailing4Avg = (() => {
    if (aaumTrendData.length < 4) return null;
    const tail = aaumTrendData.slice(-4);
    return tail.reduce((s, p) => s + p.value, 0) / tail.length;
  })();
  const aaumDeltaVs4Q =
    aaumLatest && aaumTrailing4Avg && aaumTrailing4Avg > 0
      ? ((aaumLatest.value - aaumTrailing4Avg) / aaumTrailing4Avg) * 100
      : null;

  const latestFlowsRow =
    flowsData.length > 0 ? flowsData[flowsData.length - 1] : null;
  const flowQualityPct = (() => {
    if (!latestFlowsRow) return null;
    const eq =
      typeof latestFlowsRow.equity === "number" ? latestFlowsRow.equity : null;
    const debt =
      typeof latestFlowsRow.debt === "number" ? latestFlowsRow.debt : 0;
    const liquid =
      typeof latestFlowsRow.liquid === "number" ? latestFlowsRow.liquid : 0;
    if (eq === null) return null;
    const totalMagnitude = Math.abs(eq) + Math.abs(debt) + Math.abs(liquid);
    if (totalMagnitude === 0) return null;
    return (eq / totalMagnitude) * 100;
  })();

  const passiveShareLatest = (() => {
    if (aeBreakdown.length === 0) return null;
    const latest = aeBreakdown[aeBreakdown.length - 1];
    const active =
      typeof latest.activeEquity === "number" ? latest.activeEquity : null;
    const etf =
      typeof latest.etfIndex === "number" ? latest.etfIndex : null;
    const arb =
      typeof latest.arbitrage === "number" ? latest.arbitrage : 0;
    if (active === null || etf === null) return null;
    const total = active + etf + arb;
    if (total <= 0) return null;
    return (etf / total) * 100;
  })();

  const folioAddLatest = folioAdditionsTrend[folioAdditionsTrend.length - 1] ?? null;
  const folioAddPriorQ =
    folioAdditionsTrend.length >= 2
      ? folioAdditionsTrend[folioAdditionsTrend.length - 2]
      : null;
  const folioAddQoqPct =
    folioAddLatest && folioAddPriorQ && folioAddPriorQ.value !== 0
      ? ((folioAddLatest.value - folioAddPriorQ.value) /
          Math.abs(folioAddPriorQ.value)) *
        100
      : null;

  const snapshotPanel = (
    <>
      <TabIntroCard
        headline="What's the state of the industry this quarter?"
        summary="Five quarterly signals — AAUM trend, flow quality, active vs passive, retail health, and concentration — synthesised from the latest live quarter."
        watchNext="Whether the signals reinforce each other (broad recovery / broad drawdown) or pull in opposite directions (rotation underway)."
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Quarterly Signal Summary
          </h2>
          <p className="text-xs text-muted-foreground">
            What changed · why it matters · what to watch — synthesised
            from the latest live quarter.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <QSignalTile
            label="Quarterly AAUM trend"
            pill={
              aaumDeltaVs4Q === null
                ? "—"
                : `${aaumDeltaVs4Q >= 0 ? "+" : ""}${aaumDeltaVs4Q.toFixed(1)}%`
            }
            pillTone={
              aaumDeltaVs4Q === null
                ? "neutral"
                : aaumDeltaVs4Q > 0
                ? "positive"
                : "negative"
            }
            valueLine={
              aaumLatest
                ? `Latest ${aaumLatest.label} · ${formatCompactCrSafe(aaumLatest.value)}`
                : null
            }
            read={(() => {
              if (aaumDeltaVs4Q === null)
                return "AAUM trend unavailable — need at least 4 quarters.";
              if (aaumDeltaVs4Q >= 5)
                return "Quarterly AAUM is running well ahead of its trailing-4Q average — sector earnings should be expanding. Watch whether the gap holds or fades next quarter.";
              if (aaumDeltaVs4Q >= 0)
                return "AAUM is at or just above trailing-4Q average — sector tone steady. Watch flow quality + market drawdown for early signs of inflection.";
              return "AAUM is below trailing-4Q average — sector under pressure. Watch which AMCs defend AAUM (active flow + market beta) vs which contract.";
            })()}
          />
          <QSignalTile
            label="Flow Quality"
            pill={
              flowQualityPct === null
                ? "—"
                : `${flowQualityPct >= 0 ? "+" : ""}${flowQualityPct.toFixed(0)}% equity`
            }
            pillTone={
              flowQualityPct === null
                ? "neutral"
                : flowQualityPct >= 40
                ? "positive"
                : flowQualityPct <= 0
                ? "negative"
                : "neutral"
            }
            valueLine={
              latestFlowsRow
                ? `Equity share of ${latestFlowsRow.quarterLabel ?? latestFlowsRow.quarter} flow magnitude`
                : null
            }
            read={(() => {
              if (flowQualityPct === null)
                return "Quarterly flow split unavailable for the latest period.";
              if (flowQualityPct >= 50)
                return "Equity dominates the quarter's flow magnitude — risk-on mix supports AMC revenue yield. Watch for SIP vs lumpsum split persistence.";
              if (flowQualityPct >= 0)
                return "Mixed flow quality — equity contributes but debt/liquid still meaningful. Watch the equity share trend across the next 2-3 quarters.";
              return "Equity flow is net-negative this quarter — defensive rotation underway. Watch whether redemptions are concentrated in a few categories or industry-wide.";
            })()}
          />
          <QSignalTile
            label="Active vs Passive"
            pill={
              passiveShareLatest === null
                ? "—"
                : `${passiveShareLatest.toFixed(1)}% passive`
            }
            pillTone={
              passiveShareLatest === null
                ? "neutral"
                : passiveShareLatest >= 25
                ? "negative"
                : "neutral"
            }
            valueLine={
              aeBreakdown.length > 0
                ? `Latest ${aeBreakdown[aeBreakdown.length - 1].quarterLabel ?? aeBreakdown[aeBreakdown.length - 1].quarter} · ETF & Index share of equity AAUM`
                : null
            }
            read={(() => {
              if (passiveShareLatest === null)
                return "Active / Passive split unavailable for the latest quarter.";
              if (passiveShareLatest >= 30)
                return "Passive share is structurally elevated — revenue-yield headwind for active-heavy franchises. Watch which active AMCs are still defending margin via flow share.";
              if (passiveShareLatest >= 15)
                return "Passive share is growing but active still dominates equity AUM. Watch the QoQ delta — accelerating passive is the slow-moving risk to traditional MF yields.";
              return "Active-heavy era persists — favourable for traditional MF revenue yield. Watch whether ETF share starts compounding faster than active AAUM growth.";
            })()}
          />
          <QSignalTile
            label="Retail Health"
            pill={
              folioAddQoqPct === null
                ? folioAddLatest
                  ? `${folioAddLatest.value >= 0 ? "+" : ""}${formatLakhSafe(folioAddLatest.value)}`
                  : "—"
                : `${folioAddQoqPct >= 0 ? "+" : ""}${folioAddQoqPct.toFixed(0)}% QoQ`
            }
            pillTone={
              folioAddQoqPct === null
                ? "neutral"
                : folioAddQoqPct >= 0
                ? "positive"
                : "negative"
            }
            valueLine={
              folioAddLatest
                ? `Quarterly folio adds · ${folioAddLatest.label} · ${formatLakhSafe(folioAddLatest.value)}`
                : null
            }
            read={(() => {
              if (folioAddLatest === null)
                return "Quarterly folio additions unavailable.";
              if (folioAddQoqPct !== null && folioAddQoqPct >= 5)
                return "Retail participation accelerating — folio adds running ahead of prior quarter. Watch whether the cohort is sticky (SIP) or transient (lumpsum).";
              if (folioAddQoqPct !== null && folioAddQoqPct >= -5)
                return "Retail participation steady. Watch SIP stickiness percentile + scheme count — both signal whether engagement is structural or cyclical.";
              return "Folio adds slowing QoQ — early sign of retail fatigue or rotation. Watch whether SIP cancellations rise alongside.";
            })()}
          />
          <QSignalTile
            label="Market Concentration"
            pill={
              amcHhiPercentile
                ? formatPercentilePill(amcHhiPercentile.percentile)
                : "—"
            }
            pillTone={
              amcHhiPercentile === null
                ? "neutral"
                : amcHhiPercentile.percentile >= 80
                ? "negative"
                : amcHhiPercentile.percentile <= 20
                ? "positive"
                : "neutral"
            }
            valueLine={
              amcHhiPercentile
                ? `AMC-level HHI ${amcHhiPercentile.latestHhi.toFixed(0)} · ${amcHhiPercentile.changeVsAnchor !== null ? `${amcHhiPercentile.changeVsAnchor >= 0 ? "+" : ""}${amcHhiPercentile.changeVsAnchor.toFixed(0)} vs ${amcHhiPercentile.anchorQuarterLabel}` : "—"}`
                : null
            }
            read={(() => {
              if (!amcHhiPercentile)
                return "HHI percentile unavailable — need at least a 20-quarter window.";
              if (amcHhiPercentile.percentile >= 80)
                return "Industry concentration sits in the top 20% of recent history — top AMCs are pulling away. Watch challenger AMCs for share-gain inflection.";
              if (amcHhiPercentile.percentile <= 20)
                return "Industry is unusually fragmented vs recent history — challengers competing harder. Watch which AMCs are gaining and whether the trend reverses.";
              return "Concentration is in line with the trailing-5Y norm. Watch HHI direction (rising = oligopolisation, falling = challenger window).";
            })()}
          />
        </div>
      </section>

      {cyclePhasePoints.length > 0 && (
        <Card
          title="Cycle Regime"
          subtitle={`Per-month cycle phase since ${cyclePhasePoints[0].month} · derived from active-equity flow z-score + Nifty 500 drawdown`}
        >
          <CycleRibbon points={cyclePhasePoints} lastN={84} />
        </Card>
      )}
    </>
  );

  const aaumFlowsPanel = (
    <>
      <TabIntroCard
        headline="Where did the quarter's AUM change come from?"
        summary="The quarter-end AUM mix by category, plus the AUM-change bridge — how much of each quarter's move was net flows versus residual (market movement, within-quarter timing and an averaging mismatch)."
        watchNext="Whether the residual keeps outweighing net flows — the sign that market moves, not investor flows, are driving the AUM line."
      />

      {quarterDisplay.length > 0 ? (
        <ClientPeriodSwitcher
          periods={quarterDisplay.map((q) => ({ id: q.id, label: q.label }))}
          defaultId={latestQuarterId ?? ""}
          panels={quarterPanels}
        />
      ) : (
        renderQuarterNode(selectedRow)
      )}

      {aaumBridge.length > 0 && (
        <Card title="AUM Change: New Money vs Market & Other">
          <AaumBridgeTable rows={aaumBridge} />
        </Card>
      )}
    </>
  );

  const concentrationPanel = (
    <>
      <TabIntroCard
        headline="How concentrated is the industry?"
        summary="AMC and category Herfindahl–Hirschman Indexes, plus the Top-7 AMC share of industry AUM. Together they show whether incumbents are pulling away or whether challengers have a window."
        watchNext="Whether the AMC HHI percentile holds in the top decile — the structural signal for incumbent moat strength."
      />

      {hhiHasData && (
        <Card
          title="Industry Concentration Index"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                How concentrated the industry is each quarter — lower numbers mean more competition; higher means one or a few players dominate.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Herfindahl–Hirschman Index · 0–10,000 · Source: AMFI Fundwise AAUM + AMFI Quarterly Report${
                  latestAmcHhi || latestCatHhi ? " · latest " : ""
                }${latestAmcHhi ? `AMC ${Math.round(latestAmcHhi.hhi)}` : ""}${
                  latestAmcHhi && latestCatHhi ? " · " : ""
                }${latestCatHhi ? `Category ${Math.round(latestCatHhi.hhi)}` : ""}`}
              </p>
            </div>
          }
        >
          <MultiLine
            data={hhiData}
            xKey="label"
            valueFormat="count"
            axisFormat="count"
            labelFormat="none"
            lines={[
              {
                key: "amcHhi",
                name: "AMC Concentration",
                color: "hsl(var(--chart-1))",
              },
              {
                key: "categoryHhi",
                name: "Category Concentration",
                color: "hsl(var(--chart-3))",
              },
            ]}
          />
          {(amcHhiPercentile || catHhiPercentile) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {amcHhiPercentile && (
                <HhiPercentileBlock
                  label="AMC concentration"
                  read={amcHhiPercentile}
                />
              )}
              {catHhiPercentile && (
                <HhiPercentileBlock
                  label="Category concentration"
                  read={catHhiPercentile}
                />
              )}
            </div>
          )}
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            HHI = Σ(share²) × 10,000 across participants in each quarter.
            {latestAmcHhi
              ? ` Latest top-AMC share: ${latestAmcHhi.topShareLeaderPct.toFixed(2)}%.`
              : ""}
            <InfoTooltip
              label={`AMC HHI uses ${latestAmcHhi?.participantCount ?? "—"} AMCs from the AMFI Fundwise AAUM disclosure. Category HHI uses ${latestCatHhi?.participantCount ?? "—"} scheme categories from the AMFI Quarterly Report. U.S. DOJ thresholds: <1,500 unconcentrated, 1,500–2,500 moderately concentrated, >2,500 highly concentrated.`}
            />
          </p>
        </Card>
      )}

      <Card
        title="AUM Market Share"
        subtitle="Fund-house market share lives on the AMCs page — one canonical table, no duplicated views."
      >
        <p className="text-sm text-muted-foreground">
          The quarter-by-quarter market-share table (every AMC&rsquo;s share of
          total industry AAUM with the QoQ move in basis points, plus Remaining
          Others and Total Market rows) is on{" "}
          <Link
            href="/amc"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            AMCs → Market Share &amp; Concentration
          </Link>
          .
        </p>
      </Card>
    </>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Quarterly Operating KPIs"
        subtitle={
          selectedRow
            ? `Industry-wide · ${selectedRow.quarterLabel}`
            : "Industry-wide"
        }
      />

      <MarketWrapCard wrap={marketWrapData} />

      <ClientTabs
        tabs={QUARTERLY_TABS}
        defaultId="snapshot"
        panels={{
          snapshot: snapshotPanel,
          "aaum-flows": aaumFlowsPanel,
          concentration: concentrationPanel,
        }}
      />
    </div>
  );
}

/** Compact percentile-vs-history read for an HHI series. Renders the
 *  trailing-window percentile of the latest reading plus the absolute
 *  HHI change vs an anchor quarter (default 5 years back). Visual
 *  shorthand for "is the industry more or less concentrated than its
 *  recent norm?" */
function HhiPercentileBlock({
  label,
  read,
}: {
  label: string;
  read: { latestHhi: number; latestQuarterLabel: string; windowQuarters: number; percentile: number; changeVsAnchor: number | null; anchorQuarterLabel: string | null };
}) {
  const pct = read.percentile;
  const change = read.changeVsAnchor;
  const arrow = change === null ? "" : change > 50 ? "↑" : change < -50 ? "↓" : "→";
  const direction =
    change === null
      ? null
      : change > 50
        ? "industry more concentrated"
        : change < -50
          ? "industry less concentrated"
          : "broadly unchanged";
  const interpret =
    pct >= 80
      ? "near the high end of recent history"
      : pct <= 20
        ? "near the low end of recent history"
        : "in line with recent history";
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label} · {read.latestQuarterLabel}
      </div>
      <div className="mt-1 text-lg font-semibold tabular tracking-tight">
        HHI {Math.round(read.latestHhi)}
        <span className="ml-2 text-[11px] font-medium text-muted-foreground">
          {formatPercentilePill(pct)} · {interpret}
        </span>
      </div>
      {change !== null && read.anchorQuarterLabel && (
        <div className="mt-1 text-[11px] tabular text-muted-foreground">
          {arrow} {Math.abs(Math.round(change))} pts vs {read.anchorQuarterLabel}
          {direction ? ` · ${direction}` : ""}
        </div>
      )}
    </div>
  );
}

/** Quarterly Signal Summary tile — title chip, value line, 3-beat
 *  read. Mirrors the Sector Read tiles on `/` so the visual identity
 *  is consistent across pages. */
function QSignalTile({
  label,
  pill,
  pillTone,
  valueLine,
  read,
}: {
  label: string;
  pill: string;
  pillTone: "positive" | "negative" | "neutral";
  valueLine: string | null;
  read: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tabular tracking-tight",
            pillTone === "positive" &&
              "border-positive/40 bg-positive/10 text-positive",
            pillTone === "negative" &&
              "border-negative/40 bg-negative/10 text-negative",
            pillTone === "neutral" &&
              "border-border bg-muted text-muted-foreground"
          )}
        >
          {pill}
        </span>
      </div>
      {valueLine && (
        <div className="text-[11px] tabular text-foreground/80">{valueLine}</div>
      )}
      <p className="text-[12px] leading-snug text-muted-foreground">{read}</p>
    </div>
  );
}
