import { cn } from "@/lib/cn";

interface KpiChipStripProps {
  /** One chip per x-period in the underlying chart. Order should
   *  match the chart's x-axis left-to-right. */
  chips: Array<{ label: string; value?: string }>;
  /** Tint applied to chip backgrounds. */
  tone?: "default" | "muted";
  className?: string;
}

/**
 * Horizontal pill row aligned over a chart's bar columns. Uses a
 * CSS grid with `repeat(N, 1fr)` so each chip sits roughly above its
 * matching bar. Exact pixel alignment with Recharts bar centers
 * needs a surface-ref pass; the 1fr grid is the closest CSS-only
 * approximation and is the right starting point per the plan.
 */
export function KpiChipStrip({
  chips,
  tone = "default",
  className,
}: KpiChipStripProps) {
  if (chips.length === 0) return null;
  return (
    <div
      className={cn(
        "grid w-full gap-1.5",
        // Slight indent on either side to roughly clear the y-axis
        // gutter and the right margin of a Recharts surface.
        "px-[28px]",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${chips.length}, 1fr)` }}
    >
      {chips.map((chip, i) => (
        <div
          key={`${chip.label}-${i}`}
          className={cn(
            "flex flex-col items-center justify-center rounded-full border px-2 py-1 text-center text-[10px] font-medium leading-tight",
            tone === "muted"
              ? "border-border bg-muted text-muted-foreground"
              : "border-brand-navy/30 bg-brand-navy/5 text-brand-navy"
          )}
        >
          {chip.value ? (
            <span className="text-[11px] font-semibold tabular leading-none">
              {chip.value}
            </span>
          ) : null}
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
            {chip.label}
          </span>
        </div>
      ))}
    </div>
  );
}
