import { cn } from "@/lib/cn";

interface CalendarHeatGridCell {
  /** YYYY-MM. */
  month: string;
  /** Numeric value to color by (e.g. z-score). Null → muted tile. */
  value: number | null;
  /** Optional pre-formatted text shown in the tooltip alongside
   *  the month label. */
  hoverDetail?: string;
}

interface CalendarHeatGridProps {
  cells: CalendarHeatGridCell[];
  /** Saturation bound for the colour ramp. Values beyond ±sat
   *  saturate at the deepest tone. Default ±2 (matches z-score). */
  saturationBound?: number;
  /** Caption rendered under the grid. */
  caption?: string;
  className?: string;
}

const MONTH_LABELS = [
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

function cellColor(v: number, sat: number): string {
  const r = Math.max(-1, Math.min(1, v / sat));
  const intensity = Math.abs(r);
  const lightness = Math.round(94 - intensity * 56);
  if (r >= 0) {
    const hue = 152;
    return `hsl(${hue} 60% ${lightness}%)`;
  }
  const hue = 4;
  return `hsl(${hue} 75% ${lightness}%)`;
}

/**
 * GitHub-contributions-style heat grid for time-series data — one
 * cell per month, arranged with months on the x-axis and years on
 * the y-axis. Designed to surface "the entire history at a glance"
 * in a single dense visual.
 */
export function CalendarHeatGrid({
  cells,
  saturationBound = 2,
  caption,
  className,
}: CalendarHeatGridProps) {
  if (cells.length === 0) return null;

  // Bucket cells by year → month-index (0-11).
  const byYear = new Map<number, Map<number, CalendarHeatGridCell>>();
  for (const c of cells) {
    const [yStr, mStr] = c.month.split("-");
    const y = Number(yStr);
    const m = Number(mStr) - 1;
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(m, c);
  }
  const years = Array.from(byYear.keys()).sort();

  return (
    <div className={cn("space-y-2", className)}>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[10px] tabular">
          <thead>
            <tr>
              <th className="pr-2" />
              {MONTH_LABELS.map((m) => (
                <th
                  key={m}
                  className="px-1 pb-1 text-center font-normal text-muted-foreground"
                  style={{ minWidth: 24 }}
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const monthMap = byYear.get(y)!;
              return (
                <tr key={y}>
                  <th className="pr-2 text-right font-normal text-muted-foreground">
                    {y}
                  </th>
                  {MONTH_LABELS.map((label, mi) => {
                    const cell = monthMap.get(mi);
                    if (!cell) {
                      return (
                        <td
                          key={mi}
                          className="border border-background bg-muted"
                          style={{ width: 24, height: 18 }}
                          title={`${label} ${y}: no data`}
                        />
                      );
                    }
                    if (cell.value === null) {
                      return (
                        <td
                          key={mi}
                          className="border border-background bg-muted"
                          style={{ width: 24, height: 18 }}
                          title={`${label} ${y}: ${cell.hoverDetail ?? "no value"}`}
                        />
                      );
                    }
                    return (
                      <td
                        key={mi}
                        className="border border-background"
                        style={{
                          width: 24,
                          height: 18,
                          backgroundColor: cellColor(cell.value, saturationBound),
                        }}
                        title={`${label} ${y}: ${cell.hoverDetail ?? cell.value.toFixed(2)}`}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{caption ?? ""}</span>
        <span className="inline-flex items-center gap-1.5">
          <span>Cool</span>
          <span
            className="inline-block h-2 w-3 border border-background"
            style={{ backgroundColor: cellColor(-saturationBound * 0.9, saturationBound) }}
          />
          <span
            className="inline-block h-2 w-3 border border-background"
            style={{ backgroundColor: cellColor(-saturationBound * 0.4, saturationBound) }}
          />
          <span
            className="inline-block h-2 w-3 border border-background"
            style={{ backgroundColor: cellColor(0, saturationBound) }}
          />
          <span
            className="inline-block h-2 w-3 border border-background"
            style={{ backgroundColor: cellColor(saturationBound * 0.4, saturationBound) }}
          />
          <span
            className="inline-block h-2 w-3 border border-background"
            style={{ backgroundColor: cellColor(saturationBound * 0.9, saturationBound) }}
          />
          <span>Hot</span>
        </span>
      </div>
    </div>
  );
}
