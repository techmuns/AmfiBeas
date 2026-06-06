import { cn } from "@/lib/cn";
import type { CsvColumn } from "@/lib/csv";

/**
 * Industry MAAUM breakdown table — recreation of IIFL Research's
 * "Figure 19" (Active equity MAAUM …). Two stacked tables: absolute
 * MAAUM levels (₹ Lakh Cr) and the MAAUM mix (% of total), each across
 * three periods — a year ago, last month and the latest month — with
 * YoY and MoM deltas.
 *
 * Equity is the broad bucket = Active + ETF & Index + Arbitrage. Debt is
 * AMFI Sub Total I, which still contains Liquid (we don't carry a
 * period-average Liquid split), so it is labelled "Debt (incl. Liquid)".
 * Others = Sub Total V minus the ETF & Index slice. Server component.
 */
export interface MaaumColumn {
  monthLabel: string;
  equity: number | null; // broad equity = active + etf + arbitrage (₹ Cr)
  active: number | null;
  etf: number | null;
  arb: number | null;
  debt: number | null; // AMFI Sub Total I (incl. Liquid)
  others: number | null; // Sub Total V ex. ETF & Index
  total: number | null;
}

/**
 * Column definitions for the Excel export of the MAAUM breakdown — one row per
 * month (latest → previous → year-ago), raw ₹ Cr with units in the headers.
 */
export const MAAUM_XLSX_COLUMNS: CsvColumn<MaaumColumn>[] = [
  { key: "monthLabel", header: "Month" },
  { key: "equity", header: "Equity MAAUM (₹ Cr)" },
  { key: "active", header: "Active Equity (₹ Cr)" },
  { key: "etf", header: "ETF & Index (₹ Cr)" },
  { key: "arb", header: "Arbitrage (₹ Cr)" },
  { key: "debt", header: "Debt incl. Liquid (₹ Cr)" },
  { key: "others", header: "Others (₹ Cr)" },
  { key: "total", header: "Total MAAUM (₹ Cr)" },
];

type RowKey = keyof Omit<MaaumColumn, "monthLabel">;

// ₹ Cr → "61.2" lakh crore (header carries the unit).
function fmtLCr(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return (v / 1e5).toFixed(1);
}
function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}
function toneText(v: number | null): string {
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 1e-9) {
    return "text-muted-foreground";
  }
  return v > 0 ? "text-positive" : "text-negative";
}
function pctChange(cur: number | null, base: number | null): number | null {
  return cur !== null && base !== null && base !== 0
    ? ((cur - base) / Math.abs(base)) * 100
    : null;
}
const LEVEL_ROWS: { label: string; key: RowKey; indent?: boolean; bold?: boolean }[] = [
  { label: "Equity", key: "equity" },
  { label: "– Active", key: "active", indent: true },
  { label: "– ETF & Index", key: "etf", indent: true },
  { label: "– Arbitrage", key: "arb", indent: true },
  { label: "Debt (incl. Liquid)", key: "debt" },
  { label: "Others", key: "others" },
  { label: "Total", key: "total", bold: true },
];

export function MaaumTable({
  yearAgo,
  prevMonth,
  latest,
}: {
  yearAgo: MaaumColumn;
  prevMonth: MaaumColumn;
  latest: MaaumColumn;
}) {
  // Newest month first (latest → previous → year-ago), so the most
  // recent column reads left-most. YoY / MoM still compare latest vs
  // year-ago / previous regardless of display order.
  const cols = [latest, prevMonth, yearAgo];
  const cellTh =
    "border px-2.5 py-2 text-right font-semibold whitespace-nowrap";
  const rowTh = "whitespace-nowrap border bg-card px-2.5 py-1.5 text-left";

  return (
    <div className="space-y-4">
      {/* MAAUM levels */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2.5 py-2 text-left font-semibold">
                MAAUM (₹ Lakh Cr)
              </th>
              {cols.map((c) => (
                <th key={c.monthLabel} className={cellTh}>
                  {c.monthLabel}
                </th>
              ))}
              <th className={cellTh}>YoY</th>
              <th className={cellTh}>MoM</th>
            </tr>
          </thead>
          <tbody>
            {LEVEL_ROWS.map((row) => {
              const yoy = pctChange(latest[row.key], yearAgo[row.key]);
              const mom = pctChange(latest[row.key], prevMonth[row.key]);
              return (
                <tr key={row.key} className={cn(row.bold && "font-bold")}>
                  <th
                    scope="row"
                    className={cn(
                      rowTh,
                      row.indent ? "pl-4 font-normal text-muted-foreground" : "font-medium",
                      row.bold && "font-bold text-foreground"
                    )}
                  >
                    {row.label}
                  </th>
                  {cols.map((c) => (
                    <td
                      key={c.monthLabel}
                      className="border px-2.5 py-1.5 text-right text-foreground"
                    >
                      {fmtLCr(c[row.key])}
                    </td>
                  ))}
                  <td className={cn("border px-2.5 py-1.5 text-right", toneText(yoy))}>
                    {fmtPct(yoy)}
                  </td>
                  <td className={cn("border px-2.5 py-1.5 text-right", toneText(mom))}>
                    {fmtPct(mom)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
