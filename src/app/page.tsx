import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { marketWrap } from "@/data/market-wrap";
import { PageHeader } from "@/components/layout/PageHeader";
import { Sparkline } from "@/components/charts/Sparkline";
import { IndustryNarrative } from "@/components/data/IndustryNarrative";
import {
  industryQuarterly,
  latestMonth,
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
import {
  formatPercentile,
  formatQuarterLabelLong,
  ordinalSuffix,
} from "@/lib/format";
import { cn } from "@/lib/cn";

export default function HomePage() {
  const quarterly = industryQuarterly();
  const latestQ = quarterly[quarterly.length - 1];
  const patYoy = yoyChangeQuarterly(quarterly.map((q) => q.pat));

  const patMargin =
    latestQ.revenue > 0 ? (latestQ.pat / latestQ.revenue) * 100 : null;

  const narrative = industryNarrative(6);
  const marketWrapData = marketWrap();

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
        subtitle={`Industry snapshot · ${latestMonth()} (operating) · ${formatQuarterLabelLong(latestQuarter())} (financial)`}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Sector Read · Buy-side AMC view
          </h2>
          <p className="text-xs text-muted-foreground">
            What changed · why it matters · what to watch — derived from
            the latest live snapshot.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <SignalTile
            label="Industry Regime"
            pill={latestCycle?.phase ?? "—"}
            pillTone={cyclePhaseTone(latestCycle?.phase)}
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

      <MarketWrapCard wrap={marketWrapData} />

      {narrative.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              What changed this month
            </h2>
            <p className="text-xs text-muted-foreground">
              Rule-based facts derived from the latest snapshot · sorted by
              significance · top {narrative.length}
            </p>
          </div>
          <IndustryNarrative facts={narrative} />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Explore the dashboard
          </h2>
          <p className="text-xs text-muted-foreground">
            Deep dives on each metric and AMC — the Sector Read tiles
            above are the headline; these routes are the evidence.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ExploreTile
            title="Monthly Signals"
            href="/monthly"
            summary="What changed this month — flows, SIP retail, active vs passive, NFOs, and the market-cycle backdrop."
          />
          <ExploreTile
            title="Quarterly KPIs"
            href="/quarterly"
            summary="Industry AAUM, flows, concentration, and the per-category mix at quarter-end."
          />
          <ExploreTile
            title="AMC Winners & Losers"
            href="/amc?tab=share-positioning"
            summary="Which AMCs gained share, which lost it — quarter by quarter, with a positioning quadrant."
          />
          <ExploreTile
            title="Listed AMC Earnings"
            href="/financials"
            summary="P&L, margins, yields, and the listed-peer cohort table for every disclosed AMC."
          />
          <ExploreTile
            title="Compare AMCs"
            href="/compare"
            summary="Side-by-side AAUM, market share, rank, and growth for any two AMCs."
          />
        </div>
      </section>

      <Card
        title="Premium Data"
        subtitle="Licensed Morningstar datasets that unlock scheme-level KPIs"
        action={
          <Link
            href="/premium"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View licensed data options
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        <div className="flex items-start gap-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="text-muted-foreground">
            Scheme ratings, fund factsheets, holdings, risk metrics, and peer
            quartiles become available with a Morningstar license. The
            dashboard does not synthesise these values when no license is
            connected.{" "}
            <Link
              href="/premium"
              className="text-foreground underline-offset-2 hover:underline"
            >
              See the full list →
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Sector Read tile — title chip, value line, sparkline, 3-beat read.
 *  Buy-side analyst note style: each tile answers "what changed, why
 *  it matters, what to watch" inside the `read` paragraph. */
function SignalTile({
  label,
  pill,
  pillTone,
  valueLine,
  sparkline,
  sparkColor,
  read,
  footer,
}: {
  label: string;
  pill: string;
  pillTone: "positive" | "negative" | "neutral";
  valueLine: string | null;
  sparkline?: { label: string; value: number }[];
  sparkColor?: string;
  read: string;
  footer?: React.ReactNode;
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
      {sparkline && sparkline.length > 1 && (
        <div className="-mx-1">
          <Sparkline data={sparkline} color={sparkColor} height={24} />
        </div>
      )}
      <p className="text-[12px] leading-snug text-muted-foreground">{read}</p>
      {footer && <div className="mt-auto pt-1">{footer}</div>}
    </div>
  );
}

/** Gateway tile linking to a deep-dive route. The Overview itself is
 *  intentionally short; these tiles point the reader at where to look
 *  next without duplicating the headline KPIs. */
function ExploreTile({
  title,
  href,
  summary,
}: {
  title: string;
  href: string;
  summary: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1.5 rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium tracking-tight">{title}</span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">
        {summary}
      </p>
    </Link>
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
    const rounded = Math.round(sip.percentileRank as number);
    return `${base} (${rounded}${ordinalSuffix(rounded)} percentile).`;
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
    const rounded = Math.round(p.percentileRank as number);
    return `${base} (${rounded}${ordinalSuffix(rounded)} percentile of history).`;
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
