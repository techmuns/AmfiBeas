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

function formatHeatmapMonth(month: string): string {
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

interface IiflHeatmapProps {
  months: string[];
  rows: IiflHeatmapRow[];
}

/**
 * Pick a cell background colour mirroring the IIFL report's flow
 * heatmap: deep red for strongly negative, pale yellow around zero,
 * deep green for strongly positive. Saturates around ±25% which
 * covers the typical range of category net-flow share within the
 * active-equity envelope.
 */
function cellBackground(v: number): string {
  // Clamp to a ±25% range — values beyond saturate at the most
  // intense colour. Anchored to that span because category flow
  // shares cluster between -10% and 25% on the AMFI series.
  const SAT = 25;
  const r = Math.max(-1, Math.min(1, v / SAT));
  const intensity = Math.abs(r);
  // L (lightness) goes from 96 (very pale) at intensity 0 to 38
  // (saturated) at intensity 1. S held at 65–70 for institutional
  // saturation without pastel softness.
  const lightness = Math.round(94 - intensity * 56);
  if (r >= 0) {
    // green-yellow band; hue tilts from yellow (60) at low intensity
    // to deep green (138) at high intensity for an IIFL-like ramp.
    const hue = 60 + Math.round(intensity * 78);
    return `hsl(${hue} 65% ${lightness}%)`;
  }
  // negative: orange (32) at low intensity → red (8) at high intensity.
  const hue = 32 - Math.round(intensity * 24);
  return `hsl(${hue} 75% ${lightness}%)`;
}

/** Black for pale cells, white for saturated dark cells. */
function cellTextColor(v: number): string {
  const SAT = 25;
  const r = Math.max(-1, Math.min(1, v / SAT));
  return Math.abs(r) > 0.6 ? "#ffffff" : "#0f172a";
}

/** Format the cell content as a rounded whole percent (e.g. "21%",
 *  "-2%"). The hover title surfaces the precise 1-dp value. */
function formatCell(v: number): string {
  const rounded = Math.round(v);
  return `${rounded}%`;
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
export function IiflHeatmap({ months, rows }: IiflHeatmapProps) {
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
                      backgroundColor: cellBackground(v),
                      color: cellTextColor(v),
                    }}
                    title={`${row.label} · ${formatHeatmapMonth(months[i])}: ${v.toFixed(1)}%`}
                  >
                    {formatCell(v)}
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
