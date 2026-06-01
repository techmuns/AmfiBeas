import { cn } from "@/lib/cn";

export interface MaaumTableRow {
  label: string;
  /** Indent + mute (sub-rows like "– Active", "– ETF & Index"). */
  indent?: boolean;
  /** Bold (group headers / totals like "Equity", "Total", "Equity Share"). */
  emphasize?: boolean;
  /** One value per `columns` entry. Null renders as "—". */
  values: (number | null)[];
  /** Year-over-year change (already in the unit `formatDelta` expects). */
  yoy: number | null;
  /** Month-over-month change. */
  mom: number | null;
}

interface MaaumTableProps {
  /** Header for the first (label) column, e.g. "MAAUM (₹ Cr)" or "MAAUM Mix". */
  firstColHeader?: string;
  /** The three period headers, already formatted (e.g. "Apr-25"). */
  columns: string[];
  rows: MaaumTableRow[];
  /** Formats the three period-value cells. */
  formatValue: (n: number | null) => string;
  /** Formats the YoY / MoM cells (e.g. "+25.4%" or "+1.2pp"). */
  formatDelta: (n: number | null) => string;
}

/**
 * IIFL Figure 19-style MAAUM table: category rows × three period columns
 * plus YoY / MoM deltas. Pure presentational (server component) — the
 * caller computes the row model from the AMFI monthly snapshot.
 */
export function MaaumTable({
  firstColHeader = "",
  columns,
  rows,
  formatValue,
  formatDelta,
}: MaaumTableProps) {
  const deltaClass = (n: number | null) =>
    n == null
      ? "text-muted-foreground"
      : n > 0
        ? "text-positive"
        : n < 0
          ? "text-negative"
          : "text-muted-foreground";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {firstColHeader}
            </th>
            {columns.map((c) => (
              <th
                key={c}
                className="py-2 px-3 text-right text-xs font-medium tabular-nums text-muted-foreground"
              >
                {c}
              </th>
            ))}
            <th className="py-2 px-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
              YoY
            </th>
            <th className="py-2 pl-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
              MoM
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.label}-${i}`}
              className={cn("border-b border-border/40", r.emphasize && "font-semibold")}
            >
              <td className={cn("py-1.5 pr-3 text-left", r.indent && "pl-5 text-muted-foreground")}>
                {r.label}
              </td>
              {r.values.map((v, j) => (
                <td key={j} className="py-1.5 px-3 text-right tabular-nums">
                  {formatValue(v)}
                </td>
              ))}
              <td className={cn("py-1.5 px-3 text-right tabular-nums", deltaClass(r.yoy))}>
                {formatDelta(r.yoy)}
              </td>
              <td className={cn("py-1.5 pl-3 text-right tabular-nums", deltaClass(r.mom))}>
                {formatDelta(r.mom)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
