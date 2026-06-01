import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { AmcGroupedBars } from "@/components/charts/AmcGroupedBars";
import { amcStockConcentration } from "@/data/amc-portfolio";

/**
 * AUM Concentration % — Top 10 vs Top 25 stocks per AMC.
 *
 * Latest-month grouped-bar chart. For each AMC's active-equity schemes
 * the snapshot aggregates stock $-AUM across funds and reports the
 * share held in the Top 10 / Top 25 names. An "Industry" composite
 * trails the cohort as a peer-average benchmark — mirrors the framing
 * of the IIFL Figure 17 reference chart.
 */
export function AmcStockConcentration() {
  const conc = amcStockConcentration();
  if (conc.bars.length < 2) {
    return (
      <Card
        title="AUM Concentration — Top 10 vs Top 25 stocks"
        subtitle="Not enough AMCs reported holdings this month to render the cohort view."
        stackHeader
      />
    );
  }

  const chartData = conc.bars.map((b) => ({
    label: b.label,
    primary: b.top10PctOfTotal,
    secondary: b.top25PctOfTotal,
  }));

  // Cohort range read — most / least concentrated peer (industry row
  // excluded so the headline compares AMCs, not the benchmark).
  const peers = conc.bars.filter((b) => b.amcSlug !== "industry");
  const byTop25 = peers.slice().sort(
    (a, b) => b.top25PctOfTotal - a.top25PctOfTotal
  );
  const most = byTop25[0];
  const least = byTop25[byTop25.length - 1];
  const industry = conc.bars.find((b) => b.amcSlug === "industry");

  return (
    <Card title="AUM Concentration — Top 10 vs Top 25 stocks" stackHeader>
      <p className="mb-3 text-xs text-muted-foreground">
        Share of each AMC&apos;s active-equity AUM held in the Top 10
        and Top 25 stocks across all its schemes. Snapshot month:{" "}
        <span className="text-foreground">{conc.month}</span> ·{" "}
        {peers.length} AMCs + Industry composite · Source: RupeeVest
        Portfolio Tracker.
      </p>

      {most && least && (
        <div className="mb-3 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
          Most concentrated:{" "}
          <span className="text-foreground">{most.label}</span> — Top 25 ={" "}
          <span className="text-foreground">
            {most.top25PctOfTotal.toFixed(0)}%
          </span>{" "}
          (Top 10 ={" "}
          <span className="text-foreground">
            {most.top10PctOfTotal.toFixed(0)}%
          </span>
          ). Most diversified: <span className="text-foreground">{least.label}</span>{" "}
          — Top 25 ={" "}
          <span className="text-foreground">
            {least.top25PctOfTotal.toFixed(0)}%
          </span>
          {industry && (
            <>
              {" "}
              · Industry composite ={" "}
              <span className="text-foreground">
                {industry.top10PctOfTotal.toFixed(0)}%
              </span>{" "}
              /{" "}
              <span className="text-foreground">
                {industry.top25PctOfTotal.toFixed(0)}%
              </span>
            </>
          )}
          .
        </div>
      )}

      <AmcGroupedBars
        data={chartData}
        primaryName="Top 10 Stocks"
        secondaryName="Top 25 Stocks"
        primaryColor="hsl(220, 60%, 30%)"
        secondaryColor="hsl(210, 55%, 75%)"
        unitSuffix="%"
      />

      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Bars show each AMC&apos;s Top-10 and Top-25 stock
            concentration as a share of its <em>total</em> active-equity
            AUM (not just equity portion).
          </li>
          <li>
            A higher bar = more conviction in fewer names. A lower bar =
            broader diversification, often paired with more small / mid
            cap tilt.
          </li>
          <li>
            The Industry composite aggregates positions across every AMC
            in the cohort, then ranks the same way — read it as the
            cohort benchmark.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}
