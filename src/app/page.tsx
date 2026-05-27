import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SignalTile } from "@/components/ui/SignalTile";
import { PageHeader } from "@/components/layout/PageHeader";
import { IndustryNarrative } from "@/components/data/IndustryNarrative";
import {
  industryQuarterly,
  latestQuarter,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import {
  activeEquityNetInflowSignal,
  activeEquityNetInflowSparkline,
  passiveShareSparkline,
  passiveShiftSignal,
  sipStickinessSignal,
} from "@/data/amfi-monthly";
import {
  cyclePhaseHistory,
  latestNifty500Row,
} from "@/data/market-indices";
import { amcTrajectoryQuadrant } from "@/data/amc-peer-universe";
import { industryNarrative } from "@/data/narrative";
import { CapFlowsView } from "@/components/data/CapFlowsView";
import { capFlows } from "@/data/cap-flows";
import {
  formatPercentile,
  formatQuarterLabelLong,
} from "@/lib/format";

export default function HomePage() {
  const quarterly = industryQuarterly();
  const latestQ = quarterly[quarterly.length - 1];
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

  const patMargin =
    latestQ.revenue > 0 ? (latestQ.pat / latestQ.revenue) * 100 : null;

  const narrative = industryNarrative(6);

  // Buy-side Sector Read — five signal tiles synthesized from the
  // existing signal infrastructure. Each tile answers: what changed,
  // why it matters, what to watch.
  const aeSignal = activeEquityNetInflowSignal();
  const aeSparkline = activeEquityNetInflowSparkline(24);
  const passiveSig = passiveShiftSignal();
  const passiveSpark = passiveShareSparkline(24);
  const sipSig = sipStickinessSignal();
  const cyclePoints = cyclePhaseHistory();
  const latestCycle = cyclePoints[cyclePoints.length - 1];
  const latestNifty = latestNifty500Row();
  const quadrant = amcTrajectoryQuadrant(30);
  const topGainers = quadrant
    ? [...quadrant.points]
        .filter((p) => p.qoqGrowthPct > 0)
        .sort((a, b) => b.qoqGrowthPct - a.qoqGrowthPct)
        .slice(0, 3)
    : [];
  const topLosers = quadrant
    ? [...quadrant.points]
        .filter((p) => p.qoqGrowthPct < 0)
        .sort((a, b) => a.qoqGrowthPct - b.qoqGrowthPct)
        .slice(0, 3)
    : [];
  const patMarginQ = patMargin;
  const revQoYoY = yoyChangeQuarterly(quarterly.map((q) => q.revenue));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Industry snapshot"
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Sector Read · Buy-side AMC view
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <SignalTile
            label="Industry Regime"
            pill={latestCycle?.phase ?? "—"}
            pillTone={cyclePhaseTone(latestCycle?.phase)}
            headline={regimeHeadline(latestCycle?.phase)}
            valueLine={
              latestNifty && typeof latestNifty.drawdownPct === "number"
                ? `Nifty 500 drawdown ${latestNifty.drawdownPct >= 0 ? "+" : ""}${latestNifty.drawdownPct.toFixed(1)}%`
                : null
            }
            read={industryRegimeRead(latestCycle?.phase, latestNifty?.drawdownPct ?? null)}
          />
          <SignalTile
            label="Flow Quality"
            pill={
              aeSignal?.zScore === null || aeSignal === null
                ? "—"
                : `${aeSignal.zScore! >= 0 ? "+" : ""}${aeSignal.zScore!.toFixed(2)}σ`
            }
            pillTone={
              aeSignal?.zScore == null
                ? "neutral"
                : aeSignal.zScore >= 0
                ? "positive"
                : "negative"
            }
            headline={flowQualityHeadline(aeSignal?.zScore ?? null)}
            valueLine={
              sipSig
                ? formatPercentile(sipSig.percentileRank) === "—"
                  ? `SIP stickiness ${sipSig.latestSharePct.toFixed(1)}% of total AUM`
                  : `SIP stickiness ${sipSig.latestSharePct.toFixed(1)}% of total AUM · ${formatPercentile(sipSig.percentileRank)}`
                : null
            }
            sparkline={aeSparkline}
            sparkColor="hsl(var(--chart-1))"
            read={flowQualityRead(aeSignal, sipSig)}
          />
          <SignalTile
            label="Passive Pressure"
            pill={
              passiveSig
                ? `${passiveSig.latestSharePct.toFixed(1)}%`
                : "—"
            }
            pillTone={
              passiveSig === null
                ? "neutral"
                : (passiveSig.percentileRank ?? 50) >= 70
                ? "negative"
                : "neutral"
            }
            headline={passiveHeadline(passiveSig?.percentileRank ?? null)}
            valueLine={
              passiveSig && formatPercentile(passiveSig.percentileRank) !== "—"
                ? `${formatPercentile(passiveSig.percentileRank)} of history`
                : null
            }
            sparkline={passiveSpark}
            sparkColor="hsl(var(--chart-5))"
            read={passivePressureRead(passiveSig)}
          />
          <SignalTile
            label="AMC Winners / Losers"
            pill={`${topGainers.length}↑ / ${topLosers.length}↓`}
            pillTone="neutral"
            headline={winnersLosersHeadline(topGainers, topLosers)}
            valueLine={
              quadrant
                ? `${quadrant.latestQuarterLabel} · QoQ AAUM growth`
                : null
            }
            read={amcWinnersLosersRead(topGainers, topLosers)}
            footer={
              <Link
                href="/amc?tab=share-positioning"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                See share movers <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          />
          <SignalTile
            label="Listed AMC Earnings"
            pill={
              patMarginQ === null
                ? "—"
                : `${patMarginQ.toFixed(1)}% PAT margin`
            }
            pillTone={
              patMarginQ === null
                ? "neutral"
                : patMarginQ >= 25
                ? "positive"
                : "neutral"
            }
            headline={listedAmcHeadline(patYoy)}
            valueLine={
              revQoYoY !== null
                ? `Revenue ${revQoYoY >= 0 ? "+" : ""}${revQoYoY.toFixed(1)}% YoY · ${formatQuarterLabelLong(latestQuarter())}`
                : null
            }
            read={listedAmcRead(revQoYoY, patMarginQ, patYoy)}
            footer={
              <Link
                href="/financials"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                See margins + yields <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          />
        </div>
      </section>

      {narrative.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              What changed this month
            </h2>
          </div>
          <IndustryNarrative facts={narrative} />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            What mutual funds are buying &amp; selling
          </h2>
        </div>
        <CapFlowsView flows={capFlows} />
      </section>
    </div>
  );
}

function cyclePhaseTone(
  phase: string | undefined
): "positive" | "negative" | "neutral" {
  if (!phase) return "neutral";
  if (phase === "Recovery" || phase === "Expansion") return "positive";
  if (phase === "Correction") return "negative";
  return "neutral";
}

// ---- Sector Read tile headlines ----
// Short 2-4 word phrases shown on the FRONT face of each flippable
// SignalTile. Each mirrors the lead phrase the long-form `*Read`
// function below would produce, so the front and back tell the
// same story at different zoom levels.

function regimeHeadline(phase: string | undefined): string {
  if (!phase) return "Cycle unknown";
  if (phase === "Recovery") return "Off the lows";
  if (phase === "Expansion") return "Risk-on intact";
  if (phase === "Correction") return "Under stress";
  if (phase === "Peak") return "Late cycle";
  return phase;
}

function flowQualityHeadline(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return "Flow unknown";
  if (z >= 2) return "Flow extremely strong";
  if (z >= 1) return "Strong flow";
  if (z <= -2) return "Flow extremely weak";
  if (z <= -1) return "Flow stressed";
  return "Flow near norm";
}

function passiveHeadline(percentile: number | null): string {
  if (percentile === null || !Number.isFinite(percentile))
    return "Passive share unknown";
  if (percentile >= 80) return "Passive accelerating";
  if (percentile <= 20) return "Active-heavy era";
  return "Steady transition";
}

function winnersLosersHeadline(
  gainers: { displayName: string; qoqGrowthPct: number }[],
  losers: { displayName: string; qoqGrowthPct: number }[]
): string {
  if (gainers.length === 0 && losers.length === 0) return "No comparison";
  if (gainers[0]) return `${gainers[0].displayName} leads`;
  if (losers[0]) return `${losers[0].displayName} drags`;
  return "Mixed quarter";
}

function listedAmcHeadline(patYoY: number | null): string {
  if (patYoY === null || !Number.isFinite(patYoY)) return "Earnings unknown";
  if (patYoY > 15) return "Operating leverage on";
  if (patYoY < 0) return "Cycle softening";
  return "Earnings steady";
}

function industryRegimeRead(
  phase: string | undefined,
  drawdownPct: number | null
): string {
  if (!phase) return "Cycle phase unavailable for the latest month.";
  const ddPart =
    drawdownPct !== null && Number.isFinite(drawdownPct)
      ? ` Nifty 500 ${drawdownPct < 0 ? `is ${Math.abs(drawdownPct).toFixed(1)}% off peak` : "near peak"}.`
      : "";
  if (phase === "Recovery")
    return `Off the lows.${ddPart} Watch active-equity inflow magnitude — early cycle is when sticky retail money tends to lean back in.`;
  if (phase === "Expansion")
    return `Risk-on intact.${ddPart} Watch passive share and NFO heat for froth signals; AMC earnings should be in the sweet spot.`;
  if (phase === "Correction")
    return `Market under stress.${ddPart} Watch which categories keep positive flow during the drawdown — those names defend AAUM.`;
  if (phase === "Peak")
    return `Late cycle.${ddPart} Watch NFO mobilisation share and lump-sum dependence — high readings have historically preceded redemption stress.`;
  return `${phase}.${ddPart}`;
}

function flowQualityRead(
  ae: ReturnType<typeof activeEquityNetInflowSignal>,
  sip: ReturnType<typeof sipStickinessSignal>
): string {
  if (!ae && !sip) return "Flow signal data unavailable.";
  const aePart = ae
    ? `Active-equity net inflow is ${describeZ(ae.zScore)}.`
    : "Active-equity flow data unavailable.";
  const sipPart = (() => {
    if (!sip) return "";
    const base = ` SIP AUM at ${sip.latestSharePct.toFixed(1)}% of total AUM`;
    if (formatPercentile(sip.percentileRank) === "—") return `${base}.`;
    return `${base} (${formatPercentile(sip.percentileRank).toLowerCase()}).`;
  })();
  const action =
    ae && (ae.zScore ?? 0) <= -1
      ? " Stressed flow — watch for redemption pressure on listed AMC earnings."
      : ae && (ae.zScore ?? 0) >= 1
      ? " Strong flow — supportive for revenue yield."
      : " Watch for any divergence between SIP and lump-sum components.";
  return `${aePart}${sipPart}${action}`;
}

function describeZ(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return "indeterminate";
  if (z >= 2) return `extremely strong (${z >= 0 ? "+" : ""}${z.toFixed(2)}σ)`;
  if (z >= 1) return `strong (${z >= 0 ? "+" : ""}${z.toFixed(2)}σ)`;
  if (z <= -2) return `extremely weak (${z.toFixed(2)}σ)`;
  if (z <= -1) return `weak (${z.toFixed(2)}σ)`;
  return `near-norm (${z >= 0 ? "+" : ""}${z.toFixed(2)}σ)`;
}

function passivePressureRead(
  p: ReturnType<typeof passiveShiftSignal>
): string {
  if (!p) return "Passive share data unavailable.";
  const positionPart = (() => {
    const base = `Passive share at ${p.latestSharePct.toFixed(1)}% of equity AUM`;
    if (formatPercentile(p.percentileRank) === "—") return `${base}.`;
    return `${base} (${formatPercentile(p.percentileRank).toLowerCase()}).`;
  })();
  const action =
    (p.percentileRank ?? 50) >= 80
      ? " Passive accelerating — structural revenue-yield headwind for active-heavy AMCs."
      : (p.percentileRank ?? 50) <= 20
      ? " Active-heavy era — favourable for traditional MF revenue yield."
      : " Steady transition — monitor active-equity net flow vs ETF flow each month.";
  return `${positionPart}${action}`;
}

function amcWinnersLosersRead(
  gainers: { displayName: string; qoqGrowthPct: number }[],
  losers: { displayName: string; qoqGrowthPct: number }[]
): string {
  if (gainers.length === 0 && losers.length === 0)
    return "AMC quarterly comparison data unavailable.";
  const g = gainers
    .slice(0, 3)
    .map((p) => `${p.displayName} (${p.qoqGrowthPct >= 0 ? "+" : ""}${p.qoqGrowthPct.toFixed(1)}%)`)
    .join(", ");
  const l = losers
    .slice(0, 3)
    .map((p) => `${p.displayName} (${p.qoqGrowthPct.toFixed(1)}%)`)
    .join(", ");
  return `Sharpest QoQ AAUM gainers: ${g || "—"}. Sharpest contractions: ${l || "—"}. Watch consistency of growers across the next 2-3 quarters — a single-quarter spike is not durability.`;
}

function listedAmcRead(
  revYoY: number | null,
  patMarginPct: number | null,
  patYoY: number | null
): string {
  if (revYoY === null && patMarginPct === null)
    return "Listed AMC earnings data unavailable for the latest quarter.";
  const revPart =
    revYoY === null
      ? ""
      : `Revenue ${revYoY >= 0 ? "+" : ""}${revYoY.toFixed(1)}% YoY.`;
  const marginPart =
    patMarginPct === null
      ? ""
      : ` PAT margin ${patMarginPct.toFixed(1)}%.`;
  const patPart =
    patYoY === null
      ? ""
      : ` PAT ${patYoY >= 0 ? "+" : ""}${patYoY.toFixed(1)}% YoY.`;
  const action =
    patYoY !== null && patYoY > 15
      ? " Strong earnings cycle — operating leverage working."
      : patYoY !== null && patYoY < 0
      ? " Earnings cycle softening — watch revenue yield + cost ratio."
      : " Watch the gap between revenue yield trend and equity-AAUM growth.";
  return `${revPart}${patPart}${marginPart}${action}`;
}
