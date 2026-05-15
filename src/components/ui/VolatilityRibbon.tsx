import { cn } from "@/lib/cn";

interface VolatilityRibbonProps {
  /** Chronological series of values. */
  series: { label: string; value: number }[];
  /** ±sigma above the rolling mean to flag as a volatile period.
   *  Defaults to 2 (i.e. ≥ 2σ MoM moves get shaded). */
  threshold?: number;
  className?: string;
}

/**
 * Thin secondary strip rendered beneath time-series charts. Each
 * cell is one period; cells whose absolute MoM change exceeds
 * `threshold` × historical stdDev of the same change are shaded
 * (red for sharp drops, green for sharp jumps, muted otherwise).
 *
 * Helps the reader see "this stretch was choppy" / "this stretch
 * was calm" without claiming a separate chart.
 */
export function VolatilityRibbon({
  series,
  threshold = 2,
  className,
}: VolatilityRibbonProps) {
  if (series.length < 2) return null;

  // MoM changes
  const changes: (number | null)[] = series.map((p, i) => {
    if (i === 0) return null;
    const prior = series[i - 1].value;
    if (prior === 0) return null;
    return p.value - prior;
  });

  const numericChanges = changes.filter(
    (c): c is number => typeof c === "number" && Number.isFinite(c)
  );
  if (numericChanges.length === 0) return null;
  const mean = numericChanges.reduce((s, v) => s + v, 0) / numericChanges.length;
  const variance =
    numericChanges.reduce((s, v) => s + (v - mean) ** 2, 0) /
    numericChanges.length;
  const stdDev = variance > 0 ? Math.sqrt(variance) : null;

  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-sm", className)}>
      {series.map((p, i) => {
        const c = changes[i];
        if (c === null || stdDev === null) {
          return <div key={p.label} className="flex-1 bg-muted/40" />;
        }
        const z = (c - mean) / stdDev;
        const tone =
          z >= threshold
            ? "bg-positive/70"
            : z <= -threshold
              ? "bg-negative/70"
              : "bg-muted/30";
        return (
          <div
            key={p.label}
            className={cn("flex-1", tone)}
            title={`${p.label}: Δ ${c >= 0 ? "+" : ""}${c.toFixed(1)} (${z >= 0 ? "+" : ""}${z.toFixed(1)}σ vs MoM history)`}
          />
        );
      })}
    </div>
  );
}
