"use client";

import { cn } from "@/lib/cn";

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y";

export interface PeerRankRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: "direct" | "regular" | "unknown";
  option: "growth" | "idcw" | "unknown";
  periodRanks: Partial<
    Record<
      PeriodKey,
      | {
          return: number;
          rank: number;
          peerCount: number;
          percentile: number;
          quartile: "Q1" | "Q2" | "Q3" | "Q4";
          categoryAverage: number;
          categoryMedian: number;
          excessVsAverage: number;
          excessVsMedian: number;
          cohortKey: string;
          statsAvailable: true;
        }
      | {
          return?: number;
          cohortKey: string;
          peerCount: number;
          statsAvailable: false;
          reason: string;
        }
    >
  >;
}

interface Props {
  /** All rows in the selected fund's cohort, including the selected fund. */
  rows: PeerRankRow[];
  selectedSchemecode: string;
  period: PeriodKey;
  cohortLabel: string;
}

/** Same-cohort peer table for the Trends tab. Reads from the precomputed
 *  mf-category-returns.fundRanks (no recomputation here). Selected row is
 *  highlighted; sorted by rank ascending when stats are available, else by
 *  return descending where return exists, else by fund name. */
export function TrendsPeerTable({
  rows,
  selectedSchemecode,
  period,
  cohortLabel,
}: Props) {
  const periodLabel = period === "3Y" ? "3Y CAGR" : `${period} return`;
  if (rows.length === 0) {
    return (
      <section className="space-y-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
          <p className="text-xs text-muted-foreground">
            Funds in the same cohort, sorted by {periodLabel}.
          </p>
        </div>
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No peer cohort available for this fund.
        </div>
      </section>
    );
  }

  const sorted = rows.slice().sort((a, b) => {
    const ea = a.periodRanks[period];
    const eb = b.periodRanks[period];
    const ar =
      ea && ea.statsAvailable ? ea.rank : Number.POSITIVE_INFINITY;
    const br =
      eb && eb.statsAvailable ? eb.rank : Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    const arv = ea && "return" in ea && typeof ea.return === "number" ? ea.return : -Infinity;
    const brv = eb && "return" in eb && typeof eb.return === "number" ? eb.return : -Infinity;
    if (arv !== brv) return brv - arv;
    return a.fundName.localeCompare(b.fundName);
  });

  const cohortHasAnyStats = sorted.some(
    (r) => r.periodRanks[period]?.statsAvailable === true,
  );

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
        <p className="text-xs text-muted-foreground">
          Same-cohort comparison · {cohortLabel} · sorted by {period} rank ·{" "}
          {sorted.length} fund{sorted.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Fund</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {periodLabel}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Rank
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Percentile
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-medium">
                Quartile
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                vs median
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isSelected = r.schemecode === selectedSchemecode;
              const entry = r.periodRanks[period];
              const hasRet =
                entry && "return" in entry && typeof entry.return === "number";
              const ret = hasRet ? (entry as { return: number }).return : null;
              const stats = entry?.statsAvailable
                ? (entry as Extract<NonNullable<typeof entry>, { statsAvailable: true }>)
                : null;
              return (
                <tr
                  key={r.schemecode}
                  className={cn(
                    "border-b last:border-0",
                    isSelected ? "bg-accent/60" : "hover:bg-accent/30",
                  )}
                >
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className={cn(isSelected && "font-semibold")}>
                        {r.fundName}
                      </span>
                      {isSelected && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Selected
                        </span>
                      )}
                    </div>
                    {!cohortHasAnyStats && entry && !entry.statsAvailable && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                        {(entry as { reason: string }).reason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {ret !== null ? (
                      <span
                        className={
                          ret > 0
                            ? "text-positive"
                            : ret < 0
                              ? "text-negative"
                              : ""
                        }
                      >
                        {ret > 0 ? "+" : ""}
                        {ret.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {stats ? (
                      <>
                        {stats.rank}
                        <span className="text-muted-foreground">
                          /{stats.peerCount}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {stats ? (
                      `${stats.percentile.toFixed(0)}`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular align-top">
                    {stats ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium",
                          stats.quartile === "Q1" &&
                            "border-positive/40 bg-positive/10 text-positive",
                          stats.quartile === "Q2" &&
                            "border-border bg-muted text-foreground",
                          stats.quartile === "Q3" &&
                            "border-border bg-muted text-muted-foreground",
                          stats.quartile === "Q4" &&
                            "border-negative/40 bg-negative/10 text-negative",
                        )}
                      >
                        {stats.quartile}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {stats ? (
                      <span
                        className={
                          stats.excessVsMedian > 0
                            ? "text-positive"
                            : stats.excessVsMedian < 0
                              ? "text-negative"
                              : "text-muted-foreground"
                        }
                      >
                        {stats.excessVsMedian > 0 ? "+" : ""}
                        {stats.excessVsMedian.toFixed(1)}pp
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
