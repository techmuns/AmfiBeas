import { cn } from "@/lib/cn";

interface DistributionStripProps {
  /** All cohort values for this metric (one per peer). */
  values: number[];
  /** The focused entity's value — highlighted on the strip. */
  focused: number;
  /** Optional label rendered to the left of the strip. */
  label?: string;
  /** Optional caller-supplied formatter for tooltip / endpoints. */
  format?: (v: number) => string;
  /** Domain bounds. Defaults to the cohort's min/max with small padding. */
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Horizontal "you-are-here" strip — every cohort member rendered as
 * a translucent dot along a number line, with the focused value
 * marked by a larger filled dot. Replaces the textual "+1.4pp vs
 * cohort median" pill with a visceral peer-relative read.
 */
export function DistributionStrip({
  values,
  focused,
  label,
  format,
  min,
  max,
  className,
}: DistributionStripProps) {
  if (values.length === 0) return null;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo > 0 ? hi - lo : Math.max(Math.abs(hi), 1);
  const fmt = format ?? ((v: number) => v.toFixed(1));
  const positionPct = (v: number) => ((v - lo) / span) * 100;
  // Sort by absolute distance from the focused so the focused dot
  // renders LAST (on top).
  const sortedValues = [...values].sort(
    (a, b) => Math.abs(focused - b) - Math.abs(focused - a)
  );

  return (
    <div
      className={cn(
        "inline-flex w-full items-center gap-2 text-[10px] tabular text-muted-foreground",
        className
      )}
    >
      {label && (
        <span className="shrink-0 whitespace-nowrap text-foreground/70">
          {label}
        </span>
      )}
      <span className="shrink-0">{fmt(lo)}</span>
      <div className="relative h-3 flex-1 overflow-visible rounded-full bg-muted">
        {sortedValues.map((v, i) => (
          <span
            key={i}
            className={cn(
              "absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
              v === focused
                ? "z-10 h-3 w-3 border border-background bg-foreground shadow"
                : "bg-foreground/30"
            )}
            style={{ left: `${Math.max(0, Math.min(100, positionPct(v)))}%` }}
            title={fmt(v)}
          />
        ))}
      </div>
      <span className="shrink-0">{fmt(hi)}</span>
    </div>
  );
}
