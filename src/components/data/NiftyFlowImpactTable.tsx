import { formatMonthLabel } from "@/lib/format";
import type { NiftyFlowImpactRow } from "@/data/market-indices";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

interface Props {
  rows: NiftyFlowImpactRow[];
}

/**
 * IIFL Figure 5-style table — pairs each Nifty 500 underperformance
 * window with the active-equity net inflow that followed and the
 * matching prior-period average, surfacing the % slowdown in flows
 * subsequent to each correction.
 */
export function NiftyFlowImpactTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No qualifying Nifty 500 underperformance periods in available history.
      </div>
    );
  }
  type XRow = {
    underperfPeriod: string;
    underperfMonths: number;
    declinePct: number;
    postPeriod: string;
    postMonths: number;
    avgMonthlyFlow: number | null;
    priorAvgFlow: number | null;
    flowChangePct: number | null;
  };
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "underperfPeriod", header: "Underperformance period" },
    { key: "underperfMonths", header: "Underperf. months" },
    { key: "declinePct", header: "Index decline (%)" },
    { key: "postPeriod", header: "Post period" },
    { key: "postMonths", header: "Post months" },
    { key: "avgMonthlyFlow", header: "Avg monthly flow (₹ Cr)" },
    { key: "priorAvgFlow", header: "Prior period avg flow (₹ Cr)" },
    { key: "flowChangePct", header: "Flow change (%)" },
  ];
  const exportRows: XRow[] = rows.map((r) => ({
    underperfPeriod: `${formatMonthLabel(r.underperformance.startMonth)} to ${formatMonthLabel(r.underperformance.endMonth)}`,
    underperfMonths: r.underperformance.monthsCount,
    declinePct: Number(r.underperformance.declinePct.toFixed(0)),
    postPeriod: `${formatMonthLabel(r.postPeriod.startMonth)} to ${formatMonthLabel(r.postPeriod.endMonth)}`,
    postMonths: r.postPeriod.monthsCount,
    avgMonthlyFlow:
      r.postPeriod.avgMonthlyFlow === null
        ? null
        : Math.round(r.postPeriod.avgMonthlyFlow),
    priorAvgFlow:
      r.priorPeriod.avgMonthlyFlow === null
        ? null
        : Math.round(r.priorPeriod.avgMonthlyFlow),
    flowChangePct:
      r.declineInFlowPct === null ? null : Number(r.declineInFlowPct.toFixed(0)),
  }));

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename="nifty-flow-impact.xlsx"
          sheetName="Flow Impact"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border">
            <th
              colSpan={3}
              className="border-r border-border bg-muted/40 px-3 py-2 text-left font-medium text-foreground"
            >
              Nifty 500 Underperformance
            </th>
            <th
              colSpan={5}
              className="bg-muted/40 px-3 py-2 text-left font-medium text-foreground"
            >
              Net Flows Impact (Active Equity)
            </th>
          </tr>
          <tr className="border-b border-border text-muted-foreground">
            <th className="px-3 py-1.5 text-left font-normal">Period</th>
            <th className="px-3 py-1.5 text-right font-normal">Months</th>
            <th className="border-r border-border px-3 py-1.5 text-right font-normal">
              % Decline
            </th>
            <th className="px-3 py-1.5 text-left font-normal">Period</th>
            <th className="px-3 py-1.5 text-right font-normal">Months</th>
            <th className="px-3 py-1.5 text-right font-normal">
              Avg monthly flow
            </th>
            <th className="px-3 py-1.5 text-right font-normal">
              Prior period avg flow
            </th>
            <th className="px-3 py-1.5 text-right font-normal">% Decline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.underperformance.startMonth}
              className={i % 2 === 0 ? "bg-card" : "bg-muted/15"}
            >
              <td className="px-3 py-2 text-foreground/90">
                {formatMonthLabel(r.underperformance.startMonth)} to{" "}
                {formatMonthLabel(r.underperformance.endMonth)}
              </td>
              <td className="px-3 py-2 text-right text-foreground/90">
                {r.underperformance.monthsCount}
              </td>
              <td className="border-r border-border px-3 py-2 text-right font-medium text-negative">
                {r.underperformance.declinePct.toFixed(0)}%
              </td>
              <td className="px-3 py-2 text-foreground/90">
                {formatMonthLabel(r.postPeriod.startMonth)} to{" "}
                {formatMonthLabel(r.postPeriod.endMonth)}
              </td>
              <td className="px-3 py-2 text-right text-foreground/90">
                {r.postPeriod.monthsCount}
              </td>
              <td className="px-3 py-2 text-right font-medium text-foreground/90">
                {formatFlow(r.postPeriod.avgMonthlyFlow)}
              </td>
              <td className="px-3 py-2 text-right text-foreground/90">
                {formatFlow(r.priorPeriod.avgMonthlyFlow)}
              </td>
              <td
                className={`px-3 py-2 text-right font-medium ${
                  r.declineInFlowPct === null
                    ? "text-muted-foreground"
                    : r.declineInFlowPct < 0
                      ? "text-negative"
                      : "text-positive"
                }`}
              >
                {r.declineInFlowPct === null
                  ? "—"
                  : `${r.declineInFlowPct >= 0 ? "+" : ""}${r.declineInFlowPct.toFixed(0)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Format an active-equity monthly net inflow in ₹ Cr, matching the
 *  IIFL table's compact style (whole-number rupee crore, signed). */
function formatFlow(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const rounded = Math.round(v);
  if (rounded < 0) return `(${Math.abs(rounded).toLocaleString("en-IN")})`;
  return rounded.toLocaleString("en-IN");
}
