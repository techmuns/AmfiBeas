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
  /** Accepted for call-site symmetry with the rest of the tab; the table shows
   *  every period at once and lists funds alphabetically, so it doesn't reorder
   *  when the period filter changes. */
  period?: PeriodKey;
  cohortLabel: string;
  /** "nav" ranks by point-to-point return; "rolling" by the average rolling
   *  return over the window (from mf-rolling-ranks). Only the labels differ. */
  variant?: "nav" | "rolling";
}

/** A cell's return, whether or not full rank stats came with it. */
function returnOf(row: PeerRankRow, period: PeriodKey): number | null {
  const e = row.periodRanks[period];
  return e && "return" in e && typeof e.return === "number" ? e.return : null;
}
/** Rank + peer count, only when the snapshot computed stats for this period. */
function rankOf(row: PeerRankRow, period: PeriodKey): { rank: number; peerCount: number } | null {
  const e = row.periodRanks[period];
  return e && e.statsAvailable ? { rank: e.rank, peerCount: e.peerCount } : null;
}

/**
 * Same-cohort peer table for the Trends tab, laid out as a matrix: one ROW per
 * fund, and per period a Returns + Ranking column pair. Because the fund rows
 * are fixed, a single row reads as one fund's whole track record across every
 * horizon — unlike a per-period leaderboard, where each column re-orders the
 * funds and nothing lines up. Reads a precomputed ranks snapshot
 * (mf-category-returns in NAV mode, mf-rolling-ranks in Rolling mode).
 */
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
            Funds in the same cohort, with returns and rank for every period.
          </p>
        </div>
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No peer cohort available for this fund.
        </div>
      </section>
    );
  }

  // Only show periods the cohort actually has numbers for, so an empty 10Y
  // column doesn't pad the table.
  const periods = PERIODS.filter((p) => rows.some((r) => returnOf(r, p) !== null));
  const periodLabel = (p: PeriodKey) =>
    p === "3Y" || p === "5Y" || p === "10Y" ? `${p} CAGR` : p;

  // Fund names in alphabetical order. With a Ranking column per period there is
  // no single "correct" ordering to impose, and a stable A–Z list means a given
  // fund sits in the same place whichever period you're reading — the rank
  // numbers already carry the ordering information.
  const sorted = rows
    .slice()
    .sort((a, b) =>
      cleanSchemeName(a.fundName).localeCompare(cleanSchemeName(b.fundName), "en", {
        sensitivity: "base",
      })
    );

  if (periods.length === 0) {
    return (
      <section className="space-y-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
          <p className="text-xs text-muted-foreground">
            Same-cohort comparison · {cohortLabel}
          </p>
        </div>
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No period returns available for this cohort yet.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Peer ranking</h2>
        <p className="text-xs text-muted-foreground">
          Same-cohort comparison · {cohortLabel} · {sorted.length} fund
          {sorted.length === 1 ? "" : "s"} · returns and rank across every period
          {rolling ? " (rolling-average returns)" : ""} · listed alphabetically
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-xs text-muted-foreground">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 border-r bg-muted/60 px-3 py-2 text-left align-bottom font-medium"
              >
                Fund
              </th>
              {periods.map((p) => (
                <th
                  key={p}
                  colSpan={2}
                  className="whitespace-nowrap border-b border-l px-3 py-2 text-center font-semibold text-foreground"
                >
                  {periodLabel(p)}
                </th>
              ))}
            </tr>
            <tr className="bg-muted/40 text-[11px] text-muted-foreground">
              {periods.map((p) => (
                <Fragment key={p}>
                  <th className="whitespace-nowrap border-l px-3 py-1.5 text-right font-medium">
                    Returns
                  </th>
                  <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">
                    Ranking
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isSelected = r.schemecode === selectedSchemecode;
              return (
                <tr
                  key={r.schemecode}
                  className={cn(
                    "border-b last:border-0",
                    isSelected ? "bg-accent/60" : "hover:bg-accent/30"
                  )}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-r px-3 py-2.5",
                      isSelected ? "bg-accent/60 font-semibold" : "bg-card"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span>{cleanSchemeName(r.fundName)}</span>
                      {isSelected && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Selected
                        </span>
                      )}
                    </div>
                  </td>
                  {periods.map((p) => {
                    const ret = returnOf(r, p);
                    const rk = rankOf(r, p);
                    return (
                      <Fragment key={p}>
                        <td className="whitespace-nowrap border-l px-3 py-2.5 text-right tabular">
                          {ret === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
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
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">
                          {rk ? (
                            <>
                              {rk.rank}
                              <span className="text-muted-foreground">
                                /{rk.peerCount}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
