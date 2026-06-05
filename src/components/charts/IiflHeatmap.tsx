import { cn } from "@/lib/cn";

const MONTH_ABBREV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatHeatmapMonth(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return month;
  return `${MONTH_ABBREV[idx]}-${y.slice(2)}`;
}

export interface IiflHeatmapRow {
  slug: string;
  label: string;
  values: (number | null)[];
}

/** Lens controls cell formatting and the saturation band of the
 *  diverging colour ramp.
 *
 *   - "share"  : cells are % share values (clamped at ±25% for the
 *                ramp). Same look the chart shipped with originally.
 *   - "zscore" : cells are standard-deviation deviations from each
 *                category's own historical mean. Saturated at ±2σ
 *                (i.e. anything beyond ±2 reads as deep red / green).
 */
export type IiflHeatmapLens = "share" | "zscore";

interface IiflHeatmapProps {
  months: string[];
  rows: IiflHeatmapRow[];
  lens?: IiflHeatmapLens;
}

function saturationBound(lens: IiflHeatmapLens): number {
  return lens === "zscore" ? 2 : 25;
}

function cellBackground(v: number, lens: IiflHeatmapLens): string {
  const SAT = saturationBound(lens);
  const r = Math.max(-1, Math.min(1, v / SAT));
  const intensity = Math.abs(r);
  const lightness = Math.round(94 - intensity * 56);
  if (r >= 0) {
    const hue = 60 + Math.round(intensity * 78);
    return `hsl(${hue} 65% ${lightness}%)`;
  }
  const hue = 32 - Math.round(intensity * 24);
  return `hsl(${hue} 75% ${lightness}%)`;
}

function cellTextColor(v: number, lens: IiflHeatmapLens): string {
  const SAT = saturationBound(lens);
  const r = Math.max(-1, Math.min(1, v / SAT));
  return Math.abs(r) > 0.6 ? "#ffffff" : "#0f172a";
}

function formatCell(v: number, lens: IiflHeatmapLens): string {
  if (lens === "zscore") {
    const sign = v >= 0 ? "+" : "";
    return `${sign}${v.toFixed(1)}σ`;
  }
  return `${Math.round(v)}%`;
}

function formatCellHover(v: number, lens: IiflHeatmapLens): string {
  if (lens === "zscore") {
    const sign = v >= 0 ? "+" : "";
    return `${sign}${v.toFixed(2)}σ vs own history`;
  }
  return `${v.toFixed(1)}%`;
}

/**
 * IIFL-style flow heatmap: dark blue header, dense rows, red→pale→green
 * cells with whole-percent values. Designed to match the institutional
 * look of the source report's category flow tables.
 *
 * Sizing: uses `table-fixed` with a percentage-based <colgroup> so the
 * 12 month columns + category column fit within the parent card width
 * on standard desktops without horizontal scrolling. The wrapper still
 * allows horizontal scroll on very small screens where the labels
 * cannot be made any narrower without becoming unreadable.
 */
export function IiflHeatmap({ months, rows, lens = "share" }: IiflHeatmapProps) {
  const monthColPct = months.length > 0 ? 76 / months.length : 0;
  return (
    <div className="overflow-x-auto rounded-md border border-border md:overflow-x-visible">
      <table className="w-full table-fixed border-collapse text-[10px] tabular">
        <colgroup>
          <col style={{ width: "24%" }} />
          {months.map((m) => (
            <col key={m} style={{ width: `${monthColPct}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-[#1e3a5f] text-white">
            <th className="bg-[#1e3a5f] px-2 py-1.5 text-left text-[11px] font-medium tracking-tight">
              Category
            </th>
            {months.map((m) => (
              <th
                key={m}
                className="whitespace-nowrap px-1 py-1.5 text-center font-medium"
              >
                {formatHeatmapMonth(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr
              key={row.slug}
              className={cn(
                "border-t border-border/60",
                rowIdx % 2 === 0 ? "bg-card" : "bg-muted/20"
              )}
            >
              <th
                scope="row"
                className={cn(
                  "px-2 py-1 text-left text-[11px] font-medium leading-tight",
                  rowIdx % 2 === 0 ? "bg-card" : "bg-muted/20"
                )}
              >
                {row.label}
              </th>
              {row.values.map((v, i) => {
                if (v === null) {
                  return (
                    <td
                      key={i}
                      className="border-l border-background bg-muted px-0.5 py-1 text-center text-muted-foreground"
                      title={`${row.label} · ${formatHeatmapMonth(months[i])}: data unavailable`}
                    >
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={i}
                    className="border-l border-background px-0.5 py-1 text-center font-medium"
                    style={{
                      backgroundColor: cellBackground(v, lens),
                      color: cellTextColor(v, lens),
                    }}
                    title={`${row.label} · ${formatHeatmapMonth(months[i])}: ${formatCellHover(v, lens)}`}
                  >
                    {formatCell(v, lens)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
