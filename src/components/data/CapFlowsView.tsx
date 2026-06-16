"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { CapFlowRow, CapFlows } from "@/data/cap-flows";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

type TopN = 5 | 10 | 20;

/** Sort by % of shares outstanding, largest first; "—" (null) rows last. */
function byPctOutDesc(a: CapFlowRow, b: CapFlowRow): number {
  const pa = a.pctOutstanding;
  const pb = b.pctOutstanding;
  if (pa === null && pb === null) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return Math.abs(pb) - Math.abs(pa);
}

function displayName(name: string): string {
  return name.replace(/\s+(Ltd\.?|Limited)$/i, "").trim();
}

// Net MF buying/selling as a % of the company's shares outstanding. "—" when
// the screener feed doesn't cover the company yet (pctOutstanding === null).
function fmtPctOut(pct: number | null, kind: "bought" | "sold"): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const abs = Math.abs(pct).toFixed(1);
  return kind === "bought" ? `+${abs}%` : `(${abs}%)`;
}

// Fixed data-row height so every row is the same size and the two adjacent
// cards (bought / sold) line up row-for-row regardless of how a company name
// wraps or how many rows a side has.
const ROW_H = "h-[3.25rem]";

function FlowCard({
  title,
  rows,
  kind,
  rowSlots,
}: {
  title: string;
  rows: CapFlowRow[];
  kind: "bought" | "sold";
  /** Total data-row slots to render; short sides are padded with blank rows
   *  so both cards in a tier are exactly the same height. */
  rowSlots: number;
}) {
  const movers = kind === "bought" ? "Top MF Buyers" : "Top MF Sellers";
  const valHead = kind === "bought" ? "Bought (% of o/s)" : "Sold (% of o/s)";
  const blanks = Math.max(0, rowSlots - rows.length);
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/60 px-4 py-3 text-base font-bold tracking-tight text-foreground">
        {title}
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[28%]" />
          <col className="w-[32%]" />
        </colgroup>
        <thead>
          <tr className="text-sm font-semibold text-foreground">
            <th className="px-3 py-2 text-left font-semibold">Company</th>
            <th className="px-3 py-2 text-right font-semibold leading-tight">
              {valHead}
            </th>
            <th className="px-4 py-2 text-left font-semibold">{movers}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && blanks === rowSlots ? (
            <tr style={{ height: `${rowSlots * 3.25}rem` }}>
              <td
                colSpan={3}
                className="px-4 text-center align-middle text-muted-foreground"
              >
                No qualifying names this month.
              </td>
            </tr>
          ) : (
            <>
              {rows.map((r) => (
                <tr key={r.company} className={cn("border-t", ROW_H)}>
                  <td className="px-4 py-2 align-middle font-medium leading-tight">
                    {displayName(r.company)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right align-middle tabular font-medium",
                      r.pctOutstanding === null
                        ? "text-muted-foreground"
                        : kind === "bought"
                          ? "text-positive"
                          : "text-negative"
                    )}
                    title={`Net ${kind} ${kind === "bought" ? `+₹${r.netCr.toLocaleString("en-IN")} Cr` : `(₹${r.netCr.toLocaleString("en-IN")} Cr)`}`}
                  >
                    {fmtPctOut(r.pctOutstanding, kind)}
                  </td>
                  <td className="px-4 py-2 align-middle text-muted-foreground leading-tight">
                    {r.amcs.length ? r.amcs.join(", ") : "—"}
                  </td>
                </tr>
              ))}
              {Array.from({ length: blanks }).map((_, i) => (
                <tr key={`blank-${i}`} className={cn("border-t", ROW_H)} aria-hidden>
                  <td className="px-4" />
                  <td className="px-3" />
                  <td className="px-4" />
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CapFlowsView({ flows }: { flows: CapFlows }) {
  const { meta } = flows;
  const [topN, setTopN] = useState<TopN>(5);
  const tiers: { key: "large" | "mid" | "small"; label: string }[] = [
    { key: "large", label: "Large-cap" },
    { key: "mid", label: "Mid-cap" },
    { key: "small", label: "Small-cap" },
  ];
  type XRow = {
    tier: string;
    side: string;
    company: string;
    pctOutstanding: number | null;
    netCr: number;
    amcs: string;
  };
  const exportRows: XRow[] = tiers.flatMap((t) => [
    ...flows[t.key].bought.map((r) => ({
      tier: t.label,
      side: "Bought",
      company: displayName(r.company),
      pctOutstanding: r.pctOutstanding,
      netCr: r.netCr,
      amcs: r.amcs.join(", "),
    })),
    ...flows[t.key].sold.map((r) => ({
      tier: t.label,
      side: "Sold",
      company: displayName(r.company),
      pctOutstanding: r.pctOutstanding === null ? null : -r.pctOutstanding,
      netCr: -r.netCr,
      amcs: r.amcs.join(", "),
    })),
  ]);
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "tier", header: "Cap tier" },
    { key: "side", header: "Side" },
    { key: "company", header: "Company" },
    { key: "pctOutstanding", header: "% shares outstanding (+ bought / − sold)" },
    { key: "netCr", header: "Net (₹ Cr, + bought / − sold)" },
    { key: "amcs", header: "AMCs" },
  ];
  const topOptions: TopN[] = [5, 10, 20];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div
          className="inline-flex rounded-lg border bg-card p-0.5 text-sm"
          role="group"
          aria-label="How many names to show"
        >
          {topOptions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTopN(n)}
              aria-pressed={topN === n}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors",
                topN === n
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Top {n}
            </button>
          ))}
        </div>
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename="mf-cap-flows.xlsx"
          sheetName="Cap Flows"
        />
      </div>
      {tiers.map((t) => {
        // Take the N biggest net-₹ moves (the stored order), then display them
        // sorted by % of shares outstanding, descending.
        const bought = flows[t.key].bought.slice(0, topN).sort(byPctOutDesc);
        const sold = flows[t.key].sold.slice(0, topN).sort(byPctOutDesc);
        // Equal row slots across the bought / sold pair so the two adjacent
        // cards are exactly the same height.
        const rowSlots = Math.max(bought.length, sold.length, 1);
        return (
          <div key={t.key} className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">{t.label}</h2>
            <div className="grid items-stretch gap-4 lg:grid-cols-2">
              <FlowCard
                title={`Top ${topN} ${t.label} names bought by MFs (${meta.monthCur})`}
                rows={bought}
                kind="bought"
                rowSlots={rowSlots}
              />
              <FlowCard
                title={`Top ${topN} ${t.label} names sold by MFs (${meta.monthCur})`}
                rows={sold}
                kind="sold"
                rowSlots={rowSlots}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
