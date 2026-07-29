"use client";

import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { cleanSchemeName } from "@/lib/format";

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y";

const PERIODS: PeriodKey[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y"];

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
  /** Kept for API compatibility; the table shows ALL periods at once and does
   *  not change when the period filter changes. */
  period?: PeriodKey;
  cohortLabel: string;
  /** "nav" ranks by point-to-point return; "rolling" by the average rolling
   *  return over the window (from mf-rolling-ranks). Only the labels differ. */
  variant?: "nav" | "rolling";
}

/** One ranked entry within a single period column. */
interface RankedEntry {
  schemecode: string;
  fundName: string;
  ret: number;
}

function periodHeader(period: PeriodKey, rolling: boolean): string {
  if (rolling) return `${period} rolling`;
  if (period === "3Y" || period === "5Y" || period === "10Y")
    return `${period} CAGR`;
  return period;
}

function returnOf(row: PeerRankRow, period: PeriodKey): number | null {
  const entry = row.periodRanks[period];
  if (entry && "return" in entry && typeof entry.return === "number")
    return entry.return;
  return null;
}

/** Same-cohort peer leaderboard for the Trends tab. Shows every period side by
 *  side (horizontal scroll): each period column is independently ranked best →
 *  worst by return, so the fund in a given row differs from column to column.
 *  The table is fixed — it does not respond to the period filter. */
export function TrendsPeerTable({
  rows,
  selectedSchemecode,
  cohortLabel,
  variant = "nav",
}: Props) {
  const rolling = variant === "rolling";

  if (rows.length === 0) {
    return (
      <section className="space-y-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
          <p className="text-xs text-muted-foreground">
            Funds in the same cohort, ranked best to worst for each period.
          </p>
        </div>
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No peer cohort available for this fund.
        </div>
      </section>
    );
  }

  // For each period build an independent best → worst leaderboard of the funds
  // that have a numeric return for that period.
  const columns: { period: PeriodKey; entries: RankedEntry[] }[] = PERIODS.map(
    (period) => {
      const entries: RankedEntry[] = rows
        .map((r) => {
          const ret = returnOf(r, period);
          return ret === null
            ? null
            : { schemecode: r.schemecode, fundName: r.fundName, ret };
        })
        .filter((e): e is RankedEntry => e !== null)
        .sort((a, b) => b.ret - a.ret || a.fundName.localeCompare(b.fundName));
      return { period, entries };
    },
  );

  const activeColumns = columns.filter((c) => c.entries.length > 0);
  const maxRows = activeColumns.reduce(
    (m, c) => Math.max(m, c.entries.length),
    0,
  );

  if (maxRows === 0) {
    return (
      <section className="space-y-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
          <p className="text-xs text-muted-foreground">
            Funds in the same cohort, ranked best to worst for each period.
          </p>
        </div>
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No period returns available for this cohort yet.
        </div>
      </section>
    );
  }

  const cohortSize = rows.length;

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
        <p className="text-xs text-muted-foreground">
          Same-cohort comparison · {cohortLabel} · {cohortSize} fund
          {cohortSize === 1 ? "" : "s"} · each period ranked best to worst
          {rolling ? " (rolling-avg return)" : ""}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-xs text-muted-foreground">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 border-r bg-muted/60 px-2 py-2 text-right font-medium"
              >
                #
              </th>
              {activeColumns.map((c) => (
                <th
                  key={c.period}
                  colSpan={2}
                  className="whitespace-nowrap border-l px-3 py-2 text-center font-semibold text-foreground"
                >
                  {periodHeader(c.period, rolling)}
                </th>
              ))}
            </tr>
            <tr className="bg-muted/40 text-[11px] text-muted-foreground">
              {activeColumns.map((c) => (
                <Fragment key={c.period}>
                  <th className="whitespace-nowrap border-l px-3 py-1.5 text-left font-medium">
                    Fund
                  </th>
                  <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">
                    Return
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }).map((_, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="sticky left-0 z-10 border-r bg-card px-2 py-2 text-right text-xs tabular text-muted-foreground">
                  {i + 1}
                </td>
                {activeColumns.map((c) => {
                  const e = c.entries[i];
                  if (!e) {
                    return (
                      <td
                        key={c.period}
                        colSpan={2}
                        className="border-l px-3 py-2 text-center text-muted-foreground/50"
                      >
                        —
                      </td>
                    );
                  }
                  const isSelected = e.schemecode === selectedSchemecode;
                  return (
                    <Fragment key={c.period}>
                      <td
                        className={cn(
                          "max-w-[220px] truncate border-l px-3 py-2 align-top",
                          isSelected && "bg-accent/60 font-semibold",
                        )}
                        title={cleanSchemeName(e.fundName)}
                      >
                        {cleanSchemeName(e.fundName)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2 text-right tabular align-top",
                          isSelected && "bg-accent/60 font-semibold",
                        )}
                      >
                        <span
                          className={
                            e.ret > 0
                              ? "text-positive"
                              : e.ret < 0
                                ? "text-negative"
                                : ""
                          }
                        >
                          {e.ret > 0 ? "+" : ""}
                          {e.ret.toFixed(1)}%
                        </span>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
