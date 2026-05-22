import { cn } from "@/lib/cn";

export interface StackedShareBarSegment {
  key: string;
  label: string;
  /** Absolute value — segment widths scale proportionally. */
  value: number;
  /** Fill colour (any valid CSS colour, including `hsl(var(--...))`). */
  color: string;
}

interface StackedShareBarProps {
  data: StackedShareBarSegment[];
  /** Optional caller-supplied total. Defaults to the sum of segment
   *  values, which is what `share = value / total` should normally
   *  use. Pass it when the underlying total carries meaning that
   *  the segment sum doesn't capture. */
  total?: number;
  /** Bar height in pixels. Default 20. */
  height?: number;
  /** Optional caller-provided absolute-value formatter (used in the
   *  hover title). Falls back to a plain number-with-commas. */
  formatValue?: (v: number) => string;
  className?: string;
}

/**
 * Horizontal stacked share bar — the same data a Donut would render,
 * laid out as a single proportional bar with a dot-and-label legend
 * underneath. Fills the card width and removes the empty space a
 * small donut leaves around itself.
 */
export function StackedShareBar({
  data,
  total: totalProp,
  height = 20,
  formatValue,
  className,
}: StackedShareBarProps) {
  const total = totalProp ?? data.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || data.length === 0) return null;

  const fmt =
    formatValue ?? ((n: number) => n.toLocaleString("en-IN"));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className="flex w-full overflow-hidden rounded-md"
        style={{ height }}
        role="img"
        aria-label={data
          .map((d) => `${d.label} ${((d.value / total) * 100).toFixed(1)}%`)
          .join(", ")}
      >
        {data.map((d) => {
          const pct = (d.value / total) * 100;
          return (
            <div
              key={d.key}
              className="flex items-center justify-center overflow-hidden text-[10px] font-medium tabular text-white/95"
              style={{ width: `${pct}%`, backgroundColor: d.color }}
              title={`${d.label}: ${fmt(d.value)} (${pct.toFixed(1)}%)`}
            >
              {pct >= 8 ? `${pct.toFixed(1)}%` : ""}
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-foreground/80">
        {data.map((d) => {
          const pct = (d.value / total) * 100;
          return (
            <li
              key={d.key}
              className="inline-flex items-center gap-1.5"
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: d.color }}
              />
              <span className="text-foreground/80">{d.label}</span>
              <span className="tabular font-medium text-foreground">
                {pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
