import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { StackedBarsWithLine } from "@/components/charts/StackedBarsWithLine";
import type { ActivePassiveTrend } from "@/data/amfi-monthly";

interface Props {
  /** Output of `monthlyActivePassiveTrend(…)` — full history, oldest
   *  → newest. Caller must pass a window deep enough to include every
   *  fiscal year-end the chart should render (e.g. 84 months for
   *  Mar-19 onwards). */
  trend: ActivePassiveTrend;
}

/**
 * Share of passive funds in equity AAUM — annual stacked-bar view in
 * the design language of AMFI's published "Share of passive funds in
 * QAAUM" chart. Stacks Active Equity AAUM (orange) + ETF & Index AAUM
 * (blue) at each fiscal year-end, with the passive share % drawn as
 * a line on the secondary axis.
 *
 * Reuses the dashboard's existing active/passive definition (from
 * `monthlyActivePassiveTrend()`):
 *   Active  = activeEquityAum (equity-oriented + hybrid ex-arbitrage
 *             + solution-oriented schemes)
 *   Passive = etfIndexAum    (Index Funds + Other ETFs, excludes Gold ETFs)
 *   Share % = etfIndexAum / (activeEquityAum + etfIndexAum) × 100
 *
 * The window auto-selects every March-end + the most-recent
 * September marker (H1 of the next fiscal year) from the history
 * the caller passed in.
 */
export function PassiveShareInEquity({ trend }: Props) {
  const points = selectFiscalYearEnds(trend.history);
  if (points.length < 2) {
    return (
      <Card
        title="Share of passive funds in equity AAUM"
        subtitle="Need at least 2 fiscal year-ends of active / passive AUM data to render."
        stackHeader
      />
    );
  }
  const chartData = points.map((p) => ({
    label: p.label,
    bottom: p.activeCr, // active funds (orange in source chart, blue here)
    top: p.passiveCr, // passive funds
    total: p.totalCr,
    share: p.sharePct,
  }));
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <Card
      title="Share of passive funds in equity AAUM"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            How fast the passive book is gaining ground on active
            equity. Stacked bars carry the absolute AAUM split; the
            green line (right axis) is the passive share of equity
            AAUM at each year-end.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {first.label} → {last.label} · ₹ Cr · Source: AMFI
            Monthly Report
          </p>
        </div>
      }
      stackHeader
    >
      <StackedBarsWithLine
        data={chartData}
        bottomName="Active Equity"
        topName="ETF & Index"
        lineName="Passive share of equity AAUM"
        bottomColor="hsl(28, 85%, 55%)"
        topColor="hsl(220, 60%, 35%)"
        lineColor="hsl(140, 55%, 35%)"
        lineDomain={[0, Math.max(20, Math.ceil(maxShare(points) + 4))]}
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(220, 60%, 35%)" }}
          />
          ETF &amp; Index
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(28, 85%, 55%)" }}
          />
          Active Equity
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block h-0.5 w-3"
            style={{ backgroundColor: "hsl(140, 55%, 35%)" }}
          />
          Share of passive funds to total equity AAUM
        </span>
      </div>
      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <span className="text-foreground">Active equity</span> =
            equity-oriented + hybrid ex-arbitrage + solution-oriented
            schemes.{" "}
            <span className="text-foreground">ETF &amp; Index</span> =
            Index Funds + Other ETFs (excludes Gold ETFs).
          </li>
          <li>
            Bar height = absolute AAUM in ₹ Cr at each March-end
            (and the most-recent Sep, labelled H1FY26).
          </li>
          <li>
            Green line is the passive share of equity AAUM. A rising
            line means passive is taking share even when active is
            still growing in absolute terms.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}

interface FiscalPoint {
  label: string;
  activeCr: number;
  passiveCr: number;
  totalCr: number;
  sharePct: number;
}

function selectFiscalYearEnds(
  history: ActivePassiveTrend["history"]
): FiscalPoint[] {
  if (history.length === 0) return [];
  // Index by month for direct lookup.
  const byMonth = new Map<string, (typeof history)[number]>();
  for (const h of history) byMonth.set(h.month, h);

  // Year range covered.
  const years = [
    ...new Set(history.map((h) => Number(h.month.slice(0, 4)))),
  ].sort((a, b) => a - b);

  const picks: { label: string; month: string }[] = [];
  for (const y of years) {
    const marchKey = `${y}-03`;
    if (byMonth.has(marchKey)) {
      picks.push({ label: `Mar-${String(y).slice(2)}`, month: marchKey });
    }
  }
  // H1 marker — most recent September that's AFTER the last March-end.
  const latestMarch = picks.length > 0 ? picks[picks.length - 1].month : null;
  const allSeptembers = years
    .map((y) => `${y}-09`)
    .filter((m) => byMonth.has(m));
  const latestSep = allSeptembers[allSeptembers.length - 1];
  if (latestSep && (!latestMarch || latestSep > latestMarch)) {
    const fy = Number(latestSep.slice(0, 4)) + 1;
    picks.push({ label: `H1FY${String(fy).slice(2)}`, month: latestSep });
  }

  return picks
    .map((p): FiscalPoint | null => {
      const h = byMonth.get(p.month);
      if (!h) return null;
      // Keep values in ₹ Cr — the dashboard's canonical unit — so the
      // chart's formatCompactCr / formatAxisCr render them as ₹ Lakh Cr.
      const activeCr = h.activeEquityAum;
      const passiveCr = h.etfIndexAum;
      return {
        label: p.label,
        activeCr,
        passiveCr,
        totalCr: activeCr + passiveCr,
        sharePct: h.passiveSharePct,
      };
    })
    .filter((x): x is FiscalPoint => x !== null);
}

function maxShare(points: FiscalPoint[]): number {
  return Math.max(...points.map((p) => p.sharePct));
}
