"use client";

import { cn } from "@/lib/cn";
import { formatCompactCrSafe, formatPctSafe } from "@/lib/format";
import {
  type FundDirectoryEntry,
  type FundPortfolio,
  monthSlug,
} from "@/data/portfolio-tracker";

interface PeerSummary {
  topAdd: { name: string; d: number } | null;
  topTrim: { name: string; d: number } | null;
  top10Concentration: number | null;
}

const EMPTY: PeerSummary = {
  topAdd: null,
  topTrim: null,
  top10Concentration: null,
};

// Mirrors the inline flowSummary math in PortfolioTrackerView. Duplicated
// rather than shared so the existing main-view calculation stays untouched.
function computePeerSummary(
  portfolio: FundPortfolio | undefined
): PeerSummary {
  if (!portfolio || portfolio.meta.months.length < 2) return EMPTY;
  const cur = monthSlug(portfolio.meta.months[0].label);
  const prev = monthSlug(portfolio.meta.months[1].label);
  const clean = (s: string) =>
    s
      .replace(/^eq\s*-\s*/i, "")
      .replace(/^[\s^*#~]+/, "")
      .replace(/[£@*#~]+$/, "")
      .trim();
  let topAdd: { name: string; d: number } | null = null;
  let topTrim: { name: string; d: number } | null = null;
  const curPcts: number[] = [];
  for (const r of portfolio.rows) {
    const c = r.months[cur]?.aum_pct_num ?? 0;
    const p = r.months[prev]?.aum_pct_num ?? 0;
    const d = c - p;
    if (!topAdd || d > topAdd.d) topAdd = { name: clean(r.company_name), d };
    if (!topTrim || d < topTrim.d) topTrim = { name: clean(r.company_name), d };
    curPcts.push(c);
  }
  const top10Concentration = curPcts
    .slice()
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((s, x) => s + x, 0);
  return { topAdd, topTrim, top10Concentration };
}

interface Props {
  selectedCode: string;
  category: string;
  cohortSize: number;
  latestMonth: string | null;
  peers: FundDirectoryEntry[];
  loaded: Record<string, FundPortfolio>;
  errored: Record<string, true>;
}

export function SameCategoryFunds({
  selectedCode,
  category,
  cohortSize,
  latestMonth,
  peers,
  loaded,
  errored,
}: Props) {
  const metaLine = [
    category,
    `${cohortSize} fund${cohortSize === 1 ? "" : "s"} in this category`,
    latestMonth ? `As of ${latestMonth}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          Same-category funds
        </h2>
        <p className="text-xs text-muted-foreground">
          Compare the selected fund with similar funds in the same category.
          {metaLine && <span className="ml-1">{metaLine}</span>}
        </p>
      </div>
      {peers.length <= 1 ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No peers available in this category.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Fund</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Latest AUM
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Top-10 conc.
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Biggest add (pp MoM)
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Biggest trim (pp MoM)
                </th>
              </tr>
            </thead>
            <tbody>
              {peers.map((p) => {
                const isSelected = p.schemecode === selectedCode;
                const portfolio = loaded[p.schemecode];
                const isErrored = Boolean(errored[p.schemecode]);
                const summary = computePeerSummary(portfolio);
                return (
                  <tr
                    key={p.schemecode}
                    className={cn(
                      "border-b last:border-0",
                      isSelected ? "bg-accent/60" : "hover:bg-accent/30"
                    )}
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className={cn(isSelected && "font-semibold")}>
                          {p.fund}
                        </span>
                        {isSelected && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Selected
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular align-top">
                      {formatCompactCrSafe(p.aumTotalCr)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular align-top text-muted-foreground">
                      {isErrored
                        ? "—"
                        : formatPctSafe(summary.top10Concentration, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular align-top">
                      {isErrored || !summary.topAdd ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <div className="text-positive">
                            +{summary.topAdd.d.toFixed(1)}pp
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {summary.topAdd.name}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular align-top">
                      {isErrored || !summary.topTrim ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <div className="text-negative">
                            {summary.topTrim.d.toFixed(1)}pp
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {summary.topTrim.name}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
