import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import { cn } from "@/lib/cn";
import type { CsvColumn } from "@/lib/csv";
import { amcStockConcentration } from "@/data/amc-portfolio";

/**
 * AUM Concentration — Top 10 vs Top 25 stocks per AMC, as a heatmap table.
 * This is a cross-sectional (AMC-by-AMC) read, not a time series, so per the
 * client's "tables over charts" rule it renders as a shaded table rather than
 * grouped bars. For each AMC's active-equity schemes the snapshot aggregates
 * stock $-AUM across funds and reports the share held in the Top 10 / Top 25
 * names; cell shade scales with concentration. The Industry composite is pinned
 * to the bottom as the cohort benchmark.
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

  // Cohort range read — most / least concentrated peer (industry row excluded
  // so the headline compares AMCs, not the benchmark).
  const peers = conc.bars.filter((b) => b.amcSlug !== "industry");
  const byTop25 = peers
    .slice()
    .sort((a, b) => b.top25PctOfTotal - a.top25PctOfTotal);
  const most = byTop25[0];
  const least = byTop25[byTop25.length - 1];
  const industry = conc.bars.find((b) => b.amcSlug === "industry");
  // Most concentrated first; Industry composite pinned to the bottom.
  const tableRows = industry ? [...byTop25, industry] : byTop25;
  const max10 = Math.max(1, ...conc.bars.map((b) => b.top10PctOfTotal));
  const max25 = Math.max(1, ...conc.bars.map((b) => b.top25PctOfTotal));
  const tint = (v: number, max: number) => ({
    backgroundColor: `hsl(217 70% 45% / ${Math.min(0.42, (v / max) * 0.42).toFixed(3)})`,
  });
  const xlsxColumns: CsvColumn<(typeof conc.bars)[number]>[] = [
    { key: "label", header: "AMC" },
    { key: "top10PctOfTotal", header: "Top 10 stocks (% of AUM)" },
    { key: "top25PctOfTotal", header: "Top 25 stocks (% of AUM)" },
  ];

  return (
    <Card
      title="AUM Concentration — Top 10 vs Top 25 stocks"
      stackHeader
      action={
        <DownloadXlsxButton
          rows={tableRows}
          columns={xlsxColumns}
          filename="amc-stock-concentration.xlsx"
          sheetName="Concentration"
        />
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Share of each AMC&apos;s active-equity AUM held in the Top 10 and Top 25
        stocks across all its schemes. Snapshot month:{" "}
        <span className="text-foreground">{conc.month}</span> · {peers.length}{" "}
        AMCs + Industry composite · Source: RupeeVest Portfolio Tracker.
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
          ). Most diversified:{" "}
          <span className="text-foreground">{least.label}</span> — Top 25 ={" "}
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

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2.5 py-2 text-left font-semibold">
                AMC
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Top 10 stocks
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Top 25 stocks
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((b) => {
              const isInd = b.amcSlug === "industry";
              return (
                <tr key={b.amcSlug} className={cn(isInd && "font-semibold")}>
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 whitespace-nowrap border px-2.5 py-1.5 text-left font-medium",
                      isInd ? "bg-accent" : "bg-card"
                    )}
                  >
                    {b.label}
                    {isInd && " (composite)"}
                  </th>
                  <td
                    className="border px-2.5 py-1.5 text-right text-foreground"
                    style={tint(b.top10PctOfTotal, max10)}
                  >
                    {b.top10PctOfTotal.toFixed(0)}%
                  </td>
                  <td
                    className="border px-2.5 py-1.5 text-right text-foreground"
                    style={tint(b.top25PctOfTotal, max25)}
                  >
                    {b.top25PctOfTotal.toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Each row is an AMC; the figures are its Top-10 and Top-25 stock
            concentration as a share of its <em>total</em> active-equity AUM
            (not just the equity portion). Darker = more concentrated.
          </li>
          <li>
            Higher = more conviction in fewer names. Lower = broader
            diversification, often paired with more small / mid-cap tilt.
          </li>
          <li>
            The Industry composite (bottom row) aggregates positions across
            every AMC in the cohort — read it as the cohort benchmark.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}
