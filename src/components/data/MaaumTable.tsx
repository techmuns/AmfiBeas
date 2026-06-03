import { cn } from "@/lib/cn";

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
function fmtSharePct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}
function fmtPp(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05) return "0.0";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
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
function shareOf(col: MaaumColumn, key: RowKey): number | null {
  const v = col[key];
  return typeof v === "number" && col.total ? (v / col.total) * 100 : null;
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

const MIX_ROWS: { label: string; key: RowKey; indent?: boolean }[] = [
  { label: "Equity Share", key: "equity" },
  { label: "– Active", key: "active", indent: true },
  { label: "Debt (incl. Liquid)", key: "debt" },
  { label: "Others", key: "others" },
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
  const cols = [yearAgo, prevMonth, latest];
  const cellTh =
    "border px-2 py-1.5 text-right font-semibold whitespace-nowrap";
  const rowTh = "whitespace-nowrap border bg-card px-2 py-1 text-left";

  return (
    <div className="space-y-4">
      {/* MAAUM levels */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2 py-1.5 text-left font-semibold">
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
                      className="border px-2 py-1 text-right text-foreground"
                    >
                      {fmtLCr(c[row.key])}
                    </td>
                  ))}
                  <td className={cn("border px-2 py-1 text-right", toneText(yoy))}>
                    {fmtPct(yoy)}
                  </td>
                  <td className={cn("border px-2 py-1 text-right", toneText(mom))}>
                    {fmtPct(mom)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MAAUM mix */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2 py-1.5 text-left font-semibold">
                MAAUM Mix
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
            {MIX_ROWS.map((row) => {
              const cur = shareOf(latest, row.key);
              const yoyPp = (() => {
                const a = shareOf(yearAgo, row.key);
                return cur !== null && a !== null ? cur - a : null;
              })();
              const momPp = (() => {
                const p = shareOf(prevMonth, row.key);
                return cur !== null && p !== null ? cur - p : null;
              })();
              return (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className={cn(
                      rowTh,
                      row.indent
                        ? "pl-4 font-normal text-muted-foreground"
                        : "font-medium"
                    )}
                  >
                    {row.label}
                  </th>
                  {cols.map((c) => (
                    <td
                      key={c.monthLabel}
                      className="border px-2 py-1 text-right text-foreground"
                    >
                      {fmtSharePct(shareOf(c, row.key))}
                    </td>
                  ))}
                  <td className={cn("border px-2 py-1 text-right", toneText(yoyPp))}>
                    {fmtPp(yoyPp)}
                  </td>
                  <td className={cn("border px-2 py-1 text-right", toneText(momPp))}>
                    {fmtPp(momPp)}
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
