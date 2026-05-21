import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { StackedBarsWithLabels } from "@/components/charts/StackedBarsWithLabels";
import {
  concentrationCagrPct,
  industryConcentrationSeries,
  type ConcentrationPoint,
} from "@/data/industry-concentration";

/**
 * Industry Concentration — Top 10 AMCs vs the long tail. Stacked-bar
 * chart over every fiscal year-end available in the snapshot, plus
 * the latest H1 marker (Sep) if present. Pill row above each bar
 * shows the Top-10 AMCs' share % of total industry QAAUM; data
 * labels inside each segment show the absolute AAUM in ₹ trillion.
 *
 * Mirrors the framing AMC analysts use to read industry consolidation
 * vs fragmentation — the long tail (orange) is growing at a higher
 * CAGR than the Top 10 (blue), so the Top-10 share drifts down over
 * the period even as both segments grow in absolute terms.
 */
export function IndustryConcentrationStack() {
  const points = industryConcentrationSeries();
  if (points.length < 2) {
    return (
      <Card
        title="Industry Concentration — Top 10 vs Rest"
        subtitle="Need at least 2 fiscal year-ends of Fundwise AAUM data to render."
        stackHeader
      />
    );
  }
  const top10Cagr = concentrationCagrPct(points, "top10AumCr");
  const restCagr = concentrationCagrPct(points, "restAumCr");
  const first = points[0];
  const last = points[points.length - 1];
  // Convert ₹ Cr → ₹ trillion for display (matches the source chart's units).
  const chartData = points.map((p) => ({
    label: p.label,
    bottom: p.top10AumCr / 1e5,
    top: p.restAumCr / 1e5,
    total: p.totalAumCr / 1e5,
  }));
  return (
    <Card
      title="Industry Concentration — Top 10 vs Rest"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            How fast the long tail is growing versus the Top 10 — and
            whether the industry is consolidating or fragmenting.
            Stacked-bar shows the absolute QAAUM split; the pill above
            each bar is the Top-10 AMCs&rsquo; share of industry total.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {first.label} → {last.label} · ₹ trillion · Source: AMFI
            Fundwise Average AUM
          </p>
        </div>
      }
      stackHeader
    >
      <ShareRow points={points} />
      <StackedBarsWithLabels
        data={chartData}
        bottomName="Top 10 AMCs"
        topName="Other AMCs excluding top 10"
        bottomColor="hsl(220, 60%, 35%)"
        topColor="hsl(28, 85%, 55%)"
        unitSuffix=""
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(220, 60%, 35%)" }}
          />
          Top 10 AMCs
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(28, 85%, 55%)" }}
          />
          Other AMCs excluding top 10
        </span>
      </div>
      {(top10Cagr !== null || restCagr !== null) && (
        <p className="mt-3 text-[12px] italic text-muted-foreground">
          {first.label} → {last.label} CAGR ·{" "}
          {top10Cagr !== null && (
            <>
              <span className="text-foreground">Top 10</span>{" "}
              {top10Cagr >= 0 ? "+" : ""}
              {top10Cagr.toFixed(1)}%
            </>
          )}
          {top10Cagr !== null && restCagr !== null && " · "}
          {restCagr !== null && (
            <>
              <span className="text-foreground">Long tail</span>{" "}
              {restCagr >= 0 ? "+" : ""}
              {restCagr.toFixed(1)}%
            </>
          )}
          .{" "}
          {restCagr !== null &&
            top10Cagr !== null &&
            restCagr > top10Cagr &&
            "The long tail is growing faster than the leaders — the industry is fragmenting at the share-of-industry level."}
        </p>
      )}
      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Each bar splits industry QAAUM at a year-end into{" "}
            <span className="text-foreground">Top 10 AMCs</span> (blue)
            vs <span className="text-foreground">everyone else</span>{" "}
            (orange).
          </li>
          <li>
            Pill above each bar = Top-10 AMCs&rsquo; share of total
            industry QAAUM that quarter. Falling pill = the long tail
            is taking share even though both segments grow.
          </li>
          <li>
            CAGR row tells you the underlying growth rate of each
            segment — when long-tail CAGR exceeds Top-10 CAGR, market
            concentration is structurally declining.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}

/** Row of share-% pills rendered above the stacked bars, mirroring the
 *  reference chart's framing. */
function ShareRow({ points }: { points: ConcentrationPoint[] }) {
  return (
    <div className="mb-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      {points.map((p) => (
        <div
          key={p.quarter}
          className="rounded-md border border-foreground/10 bg-muted/40 px-2 py-1 text-center"
          title={`Top 10 AMCs hold ${p.top10SharePct.toFixed(1)}% of industry QAAUM in ${p.label}`}
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Top 10 share
          </p>
          <p className="text-[12.5px] font-semibold tabular text-foreground">
            {p.top10SharePct.toFixed(1)}%
          </p>
        </div>
      ))}
    </div>
  );
}
