import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { cn } from "@/lib/cn";
import { formatCompactCrSafe } from "@/lib/format";
import type { CategoryResilienceRow } from "@/data/category-resilience";

interface CategoryResilienceCardProps {
  rows: CategoryResilienceRow[];
}

/**
 * "Category Resilience Through Drawdowns" — a custom horizontal
 * bar list ranking each IIFL active-equity category by how often
 * it kept its inflow positive during historical Correction-phase
 * months. The visual is intentionally NOT a regular Recharts chart
 * because:
 *   - the data is one bar per row, sorted, with long labels — a
 *     vanilla CSS layout reads better
 *   - we want the resilience score, the sample count, and the
 *     average flow magnitude all visible in one row
 *
 * Bar color saturates from red (low resilience) → green (high
 * resilience) over the 0–100 range. Average flow is shown as a
 * compact ₹ Cr value to the right of the bar, sign-aware.
 */
export function CategoryResilienceCard({
  rows,
}: CategoryResilienceCardProps) {
  if (rows.length === 0) {
    return null;
  }
  const subtitle = `${rows.length} active-equity categories · % of Correction-phase months with positive net inflow · Source: AMFI Monthly Report + cycle-phase classifier`;
  return (
    <Card
      title="Category Resilience Through Drawdowns"
      subtitle={subtitle}
    >
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.slug}
            className="grid grid-cols-[minmax(150px,_1.6fr)_2fr_minmax(80px,_auto)_minmax(80px,_auto)] items-center gap-3 text-[12px] tabular"
          >
            <div className="truncate text-foreground" title={r.label}>
              {r.label}
            </div>
            <ResilienceBar pct={r.positiveFlowRatePct} />
            <div className="text-right font-semibold tabular text-foreground">
              {r.positiveFlowRatePct.toFixed(0)}%
            </div>
            <div
              className={cn(
                "text-right text-[11px] tabular",
                r.avgFlowDuringCorrection >= 0
                  ? "text-positive"
                  : "text-negative"
              )}
              title={`${r.correctionMonthCount} Correction-phase months${r.latestCorrectionMonth ? ` · latest ${r.latestCorrectionMonth}` : ""}`}
            >
              {r.avgFlowDuringCorrection >= 0 ? "+" : "−"}
              {formatCompactCrSafe(Math.abs(r.avgFlowDuringCorrection))}/mo
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Sorted most-resilient first. The right-side ₹ Cr figure is the
        average monthly net inflow during Correction months — a
        positive number means the category was still net-buying in
        those months, on average.
        <InfoTooltip label="Correction months are defined by the dashboard's cycle-phase classifier (Nifty 500 in drawdown + active-equity flow z-score). Categories with fewer than 3 Correction-month data points are excluded." />
      </p>
    </Card>
  );
}

/** Coloured horizontal bar — red gradient at 0, green at 100. The
 *  bar fill width matches the value; the rest of the track is muted
 *  background so the eye sees the score even without reading the
 *  number. */
function ResilienceBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  // Interpolate hue: 0 = red (~ 0deg), 100 = green (~ 140deg).
  const hue = (clamped / 100) * 140;
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${clamped}%`,
          backgroundColor: `hsl(${hue}, 70%, 45%)`,
        }}
      />
    </div>
  );
}
