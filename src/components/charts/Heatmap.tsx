"use client";

export interface HeatmapRow {
  label: string;
  values: (number | null)[];
}

interface HeatmapProps {
  rows: HeatmapRow[];
  /**
   * Column display strings. The caller is expected to pass the
   * already-formatted labels (e.g. "Sep '25", "4QFY26") so the
   * component stays serialisable across the server/client
   * boundary — no formatter functions need to be passed in.
   */
  columns: string[];
  min?: number;
  max?: number;
  height?: number;
  cellMinWidth?: number;
  /** When true, every column header renders its label (no
   *  every-third sampling). Use for short axes like 8 quarters. */
  showAllColumnLabels?: boolean;
  /** Suffix appended to cell values + title (defaults to "%"). */
  valueSuffix?: string;
}

function cellColor(v: number, min: number, max: number) {
  const span = Math.max(Math.abs(min), Math.abs(max), 0.1);
  const ratio = Math.max(-1, Math.min(1, v / span));
  const intensity = Math.abs(ratio);
  const lightness = Math.round(96 - intensity * 50);
  if (ratio >= 0) return `hsl(152 60% ${lightness}%)`;
  return `hsl(0 70% ${lightness}%)`;
}

function textColor(v: number, min: number, max: number) {
  const span = Math.max(Math.abs(min), Math.abs(max), 0.1);
  const intensity = Math.abs(v) / span;
  return intensity > 0.55
    ? "hsl(var(--background))"
    : "hsl(var(--foreground))";
}

export function Heatmap({
  rows,
  columns,
  min = -3,
  max = 3,
  cellMinWidth = 28,
  showAllColumnLabels = false,
  valueSuffix = "%",
}: HeatmapProps) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px] tabular">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card pr-2 text-left font-medium text-muted-foreground" />
            {columns.map((col, i) => {
              const showLabel =
                showAllColumnLabels ||
                i === 0 ||
                i === columns.length - 1 ||
                i % 3 === 0;
              return (
                <th
                  key={`${col}-${i}`}
                  className="px-1 pb-1 text-center font-normal text-muted-foreground"
                  style={{ minWidth: cellMinWidth }}
                >
                  {showLabel ? col : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th className="sticky left-0 bg-card pr-3 text-left text-xs font-medium">
                {row.label}
              </th>
              {row.values.map((v, i) => (
                <td
                  key={i}
                  className="border border-background"
                  style={{
                    backgroundColor:
                      v === null ? "hsl(var(--muted))" : cellColor(v, min, max),
                    color:
                      v === null
                        ? "hsl(var(--muted-foreground))"
                        : textColor(v, min, max),
                    height: 22,
                    minWidth: cellMinWidth,
                  }}
                  title={
                    v === null
                      ? "—"
                      : `${row.label} · ${columns[i]}: ${v.toFixed(2)}${valueSuffix}`
                  }
                >
                  <span className="block text-center">
                    {v === null ? "" : v.toFixed(1)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
