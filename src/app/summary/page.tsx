import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Sparkline } from "@/components/charts/Sparkline";
import { FlowStressHistoryChart } from "@/components/charts/FlowStressHistoryChart";
import { cn } from "@/lib/cn";
import { fmtBps } from "@/lib/units";
import {
  activeEquityNetInflowSignal,
  activeEquityNetInflowSparkline,
  investorRead,
  nfoDragTrend,
  nfoHeatSignal,
  nfoMobilisationSparkline,
  passiveShareSparkline,
  passiveShiftSignal,
  sipStickinessSignal,
  sipStickinessSparkline,
} from "@/data/amfi-monthly";
import {
  categoryRotation,
  passiveFlowShareTrend,
} from "@/data/amfi-monthly-category";
import {
  flowStressHistory,
  latestNifty500Row,
  marketStressFlowSignal,
} from "@/data/market-indices";
import {
  formatCompactCrSafe,
  formatPercentile,
  formatPercentilePill,
} from "@/lib/format";

export const metadata = {
  title: "Investor Summary — AmfiBeas",
};

function formatSignedCompactCr(v: number): string {
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

export default function InvestorSummaryPage() {
  const ae = activeEquityNetInflowSignal();
  const nfo = nfoHeatSignal();
  const passive = passiveShiftSignal();
  const sip = sipStickinessSignal();
  const stress = marketStressFlowSignal();
  const nifty = latestNifty500Row();
  const nfoDrag = nfoDragTrend(24);
  const passiveFlow = passiveFlowShareTrend(24);
  const rotation = categoryRotation(3, 3);
  const flowStress = flowStressHistory();
  const read = investorRead({
    activeEquityZ: ae?.zScore ?? null,
    activeEquityPercentile: ae?.percentileRank ?? null,
    nfoZ: nfo?.zScore ?? null,
    passivePercentile: passive?.percentileRank ?? null,
    passiveLatestSharePct: passive?.latestSharePct ?? null,
    sipPercentile: sip?.percentileRank ?? null,
    drawdownPct: nifty?.drawdownPct ?? null,
    marketMonth: nifty?.month ?? null,
  });

  const asOf =
    ae?.latestMonth ??
    nfo?.latestMonth ??
    passive?.latestMonth ??
    sip?.latestMonth ??
    nifty?.month ??
    "—";

  return (
    <div className="print:bg-background mx-auto max-w-4xl space-y-5 px-4 py-6 print:px-0 print:py-0">
      {/* Print-only @page styles — kept inline so the route is fully
          self-contained and never depends on a global print sheet. */}
      <style>
        {`
        @media print {
          @page { size: A4; margin: 12mm; }
          .print\\:hidden { display: none !important; }
          /* Keep card title + body together; suppress mid-card page splits */
          .print\\:break-inside-avoid {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          /* Suppress trailing blank page after the last block */
          .print\\:break-after-avoid:last-child {
            break-after: avoid;
            page-break-after: avoid;
          }
          /* Hide the sticky context footer reliably in print */
          [data-print-hidden="true"] { display: none !important; }
        }
        `}
      </style>

      <div className="flex items-start justify-between gap-3 print:hidden">
        <Link
          href="/monthly"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Monthly KPIs
        </Link>
        <PrintButton />
      </div>

      <header className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          AmfiBeas · Investor Summary
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          One-page investor read
        </h1>
        <p className="text-xs text-muted-foreground">
          As of {asOf} · Historical context from AMFI monthly + Nifty 500 since
          Apr 2019. Historical context only — not a prediction.
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Investor Read
            <InfoTooltip label={read.methodologyTooltip} />
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight whitespace-nowrap",
              phaseClass(read.phase)
            )}
          >
            Cycle phase · {read.phase}
          </span>
        </div>
        <p className="mt-3 text-sm text-foreground/90">{read.narrative}</p>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ae && (
          <SummaryTile
            name="Active Equity Flow"
            primary={formatSignedCompactCr(ae.latestValue)}
            note={`Net inflow · ${ae.latestMonth}`}
            badge={ae.label}
            badgeClass={positiveLabelClass(ae.label)}
            footnote={
              ae.zScore !== null && ae.percentileRank !== null
                ? `Z ${ae.zScore.toFixed(2)}σ · ${formatPercentilePill(ae.percentileRank)}`
                : "—"
            }
            sparkline={activeEquityNetInflowSparkline(24)}
            sparklineColor="hsl(var(--chart-1))"
          />
        )}
        {nfo && (
          <SummaryTile
            name="NFO Heat"
            primary={formatSignedCompactCr(nfo.latestValue)}
            note={`Funds mobilised · ${nfo.latestMonth}`}
            badge={nfo.label}
            badgeClass="border-foreground/30 bg-muted text-foreground"
            footnote={
              nfo.zScore !== null && nfo.percentileRank !== null
                ? `Z ${nfo.zScore.toFixed(2)}σ · ${formatPercentilePill(nfo.percentileRank)}`
                : "—"
            }
            sparkline={nfoMobilisationSparkline(24)}
            sparklineColor="hsl(var(--chart-2))"
          />
        )}
        {passive && (
          <SummaryTile
            name="Passive Shift"
            primary={`${passive.latestSharePct.toFixed(2)}%`}
            note={`Passive AUM share · ${passive.latestMonth}`}
            badge={passive.label}
            badgeClass="border-foreground/30 bg-muted text-foreground"
            footnote={
              passive.percentileRank !== null
                ? `Hist avg ${passive.mean.toFixed(1)}% · ${formatPercentilePill(passive.percentileRank)}`
                : "—"
            }
            sparkline={passiveShareSparkline(24)}
            sparklineColor="hsl(var(--chart-5))"
          />
        )}
        {sip && (
          <SummaryTile
            name="SIP Stickiness"
            primary={`${sip.latestSharePct.toFixed(2)}%`}
            note={`SIP AUM share · ${sip.latestMonth}`}
            badge={sip.label}
            badgeClass={positiveLabelClass(sip.label)}
            footnote={
              sip.percentileRank !== null
                ? `Hist avg ${sip.mean.toFixed(1)}% · ${formatPercentilePill(sip.percentileRank)}`
                : "—"
            }
            sparkline={sipStickinessSparkline(24)}
            sparklineColor="hsl(var(--chart-3))"
          />
        )}
        {stress && (
          <SummaryTile
            name="Market Stress Flow"
            primary={`${stress.drawdownPct.toFixed(2)}%`}
            note={`Nifty 500 drawdown · ${stress.alignedMonth}`}
            badge={stress.label}
            badgeClass={stressLabelClass(stress.label)}
            footnote={
              formatPercentile(stress.flowPercentileRank) !== "—"
                ? `Flow ${formatPercentile(stress.flowPercentileRank)}`
                : "—"
            }
          />
        )}
        {nfoDrag && (
          <SummaryTile
            name="NFO Drag"
            primary={`${nfoDrag.latestRatioPct.toFixed(1)}%`}
            note={`NFO ÷ industry net inflow · ${nfoDrag.latestMonth}`}
            badge={nfoDrag.isHeavy ? "NFO heavy" : "Normal"}
            badgeClass={
              nfoDrag.isHeavy
                ? "border-foreground/30 bg-muted text-foreground"
                : "border-border bg-muted text-muted-foreground"
            }
            footnote={
              nfoDrag.percentile !== null
                ? `Hist avg ${nfoDrag.mean.toFixed(1)}% · ${formatPercentilePill(nfoDrag.percentile)}`
                : "—"
            }
          />
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {rotation && (
          <Card title="Rotation in active equity" subtitle={`${rotation.windowMonths}M avg vs prior ${rotation.windowMonths}M`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <RotationStack
                title="Gaining flow share"
                items={rotation.gainers}
                tone="positive"
              />
              <RotationStack
                title="Losing flow share"
                items={rotation.losers}
                tone="negative"
              />
            </div>
          </Card>
        )}
        {passiveFlow && (
          <Card
            title="Where new equity money is going"
            subtitle={`Passive share of new equity flow · ${passiveFlow.history.length}M`}
          >
            <div className="space-y-2">
              <div className="text-2xl font-semibold tabular tracking-tight">
                {passiveFlow.latestSharePct.toFixed(1)}%
              </div>
              <div className="text-[11px] tabular text-muted-foreground">
                Latest {passiveFlow.latestMonth}
                {formatPercentile(passiveFlow.percentile) !== "—"
                  ? ` · ${formatPercentile(passiveFlow.percentile)}`
                  : ""}{" "}
                · hist avg {passiveFlow.mean.toFixed(1)}%
              </div>
            </div>
          </Card>
        )}
      </section>

      {flowStress.length > 0 && (
        <Card
          title="Flow Stress History"
          subtitle="Nifty 500 drawdown with Buy-the-dip / Flow stress events overlaid"
        >
          <FlowStressHistoryChart data={flowStress} height={180} />
          <div className="mt-2 flex items-center justify-end gap-3 text-[10px] tabular text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-positive" />
              Buy-the-dip
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-negative" />
              Flow stress
            </span>
          </div>
        </Card>
      )}

      <footer className="text-[10px] text-muted-foreground">
        Source: AMFI Monthly Reports + Monthly Notes, AMFI Fundwise AAUM, NSE
        Nifty 500 daily history. All readings are rule-based historical context,
        not investment advice or a market call.
      </footer>
    </div>
  );
}

function phaseClass(phase: string): string {
  if (phase === "Recovery" || phase === "Expansion")
    return "border-positive/40 bg-positive/10 text-positive";
  if (phase === "Correction") return "border-negative/40 bg-negative/10 text-negative";
  if (phase === "Peak" || phase === "Base")
    return "border-foreground/40 bg-muted text-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function positiveLabelClass(label: string): string {
  if (label === "Very strong" || label === "Strong")
    return "border-positive/40 bg-positive/10 text-positive";
  if (label === "Weak" || label === "Very weak")
    return "border-negative/40 bg-negative/10 text-negative";
  return "border-border bg-muted text-muted-foreground";
}

function stressLabelClass(label: string): string {
  if (label === "Buy-the-dip flow")
    return "border-positive/40 bg-positive/10 text-positive";
  if (label === "Flow stress")
    return "border-negative/40 bg-negative/10 text-negative";
  return "border-border bg-muted text-muted-foreground";
}

interface SummaryTileProps {
  name: string;
  primary: string;
  note: string;
  badge: string;
  badgeClass: string;
  footnote: string;
  sparkline?: { label: string; value: number }[];
  sparklineColor?: string;
}

function SummaryTile({
  name,
  primary,
  note,
  badge,
  badgeClass,
  footnote,
  sparkline,
  sparklineColor,
}: SummaryTileProps) {
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground">
          {name}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-tight whitespace-nowrap",
            badgeClass
          )}
        >
          {badge}
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular tracking-tight">
        {primary}
      </div>
      <div className="text-[10px] tabular text-muted-foreground/80">{note}</div>
      <div className="mt-1 text-[10px] tabular text-muted-foreground">
        {footnote}
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-1 -mx-1">
          <Sparkline data={sparkline} color={sparklineColor} height={28} />
        </div>
      )}
    </div>
  );
}

interface RotationStackProps {
  title: string;
  items: { slug: string; label: string; deltaSharePct: number }[];
  tone: "positive" | "negative";
}

function RotationStack({ title, items, tone }: RotationStackProps) {
  if (items.length === 0) {
    return (
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">—</div>
      </div>
    );
  }
  const cls = tone === "positive" ? "text-positive" : "text-negative";
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="mt-1 space-y-1">
        {items.map((e) => (
          <li key={e.slug} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate" title={e.label}>
              {e.label}
            </span>
            <span className={cn("shrink-0 tabular font-semibold", cls)}>
              {fmtBps(e.deltaSharePct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrintButton() {
  return (
    <a
      href="javascript:window.print()"
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Printer className="h-3 w-3" />
      Print / Save PDF
    </a>
  );
}
