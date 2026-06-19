import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtBps } from "@/lib/units";

export interface StackedShareBarSegment {
  key: string;
  label: string;
  /** Absolute value — segment widths scale proportionally. */
  value: number;
  /** Fill colour (any valid CSS colour, including `hsl(var(--...))`). */
  color: string;
  /** Optional month-over-month change in this segment's SHARE, in
   *  percentage points. When present, a small "+X.Xpp MoM" indicator
   *  renders beside the share — green when share rose, red when it
   *  fell. `null` / `undefined` hides it (no prior month to compare). */
  deltaPp?: number | null;
}

interface StackedShareBarProps {
  data: StackedShareBarSegment[];
  /** Optional caller-supplied total. Defaults to the sum of segment
   *  values, which is what `share = value / total` should normally
   *  use. Pass it when the underlying total carries meaning that
   *  the segment sum doesn't capture. */
  total?: number;
  /** Optional caller-provided absolute-value formatter (used in the
   *  hover title). Falls back to a plain number-with-commas. */
  formatValue?: (v: number) => string;
  className?: string;
}

/**
 * Per-category horizontal share bars — one row per segment, sorted
 * largest-first, each row carrying a label / share / proportional
 * fill bar. Designed to take the same `mixSlices` data a donut would
 * use and present it as a layout that actually fills the card height
 * (a single stacked bar leaves too much vertical space empty next
 * to a taller sibling chart).
 */
export function StackedShareBar({
  data,
  total: totalProp,
  formatValue,
  className,
}: StackedShareBarProps) {
  const total = totalProp ?? data.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || data.length === 0) return null;

  const fmt =
    formatValue ?? ((n: number) => n.toLocaleString("en-IN"));

  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div
      className={cn("flex h-full flex-col justify-evenly gap-5", className)}
      role="img"
      aria-label={sorted
        .map((d) => `${d.label} ${((d.value / total) * 100).toFixed(1)}%`)
        .join(", ")}
    >
      {sorted.map((d) => {
        const pct = (d.value / total) * 100;
        const delta =
          typeof d.deltaPp === "number" && Number.isFinite(d.deltaPp)
            ? d.deltaPp
            : null;
        // < 0.05pp rounds to "0.0pp" — treat as flat (no direction colour).
        const deltaDir =
          delta === null ? null : delta >= 0.05 ? "up" : delta <= -0.05 ? "down" : "flat";
        const DeltaIcon =
          deltaDir === "up"
            ? ArrowUpRight
            : deltaDir === "down"
              ? ArrowDownRight
              : null;
        return (
          <div key={d.key} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: d.color }}
                />
                {d.label}
              </span>
              <span className="inline-flex items-baseline gap-2">
                {deltaDir !== null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[11px] tabular font-medium",
                      deltaDir === "up" && "text-positive",
                      deltaDir === "down" && "text-negative",
                      deltaDir === "flat" && "text-muted-foreground"
                    )}
                    title={`Share ${deltaDir === "up" ? "rose" : deltaDir === "down" ? "fell" : "was flat"} vs previous month`}
                  >
                    {DeltaIcon && <DeltaIcon className="h-3 w-3" aria-hidden />}
                    {fmtBps(delta as number)} MoM
                  </span>
                )}
                <span className="tabular text-base font-semibold text-foreground">
                  {pct.toFixed(1)}%
                </span>
              </span>
            </div>
            <div
              className="h-3 w-full overflow-hidden rounded-sm bg-muted/40"
              title={`${d.label}: ${fmt(d.value)} (${pct.toFixed(1)}%)`}
            >
              <div
                className="h-full rounded-sm"
                style={{ width: `${pct}%`, backgroundColor: d.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
