import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/cn";
import { formatCompactCrSafe } from "@/lib/format";
import type { CategoryResilienceRow } from "@/data/category-resilience";

interface CategoryResilienceCardProps {
  rows: CategoryResilienceRow[];
}

/**
 * Category Resilience Through Drawdowns — ranks each IIFL active-
 * equity category by how often it kept its inflow positive during
 * historical Correction-phase months.
 *
 * Each row shows:
 *   - a small colour dot (red → green) indicating the resilience score
 *   - a sparkline of monthly net inflow across the Correction months
 *   - the numeric % score
 *   - average monthly net inflow (₹ Cr) during Correction
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
            className="grid grid-cols-[minmax(150px,_1.6fr)_2fr_minmax(60px,_auto)_minmax(80px,_auto)] items-center gap-3 text-[12px] tabular"
          >
            <div className="flex items-center gap-2 truncate text-foreground" title={r.label}>
              <ResilienceDot pct={r.positiveFlowRatePct} />
              <span className="truncate">{r.label}</span>
            </div>
            <div className="h-7">
              {r.correctionFlowHistory.length > 1 ? (
                <Sparkline
                  data={r.correctionFlowHistory}
                  color={resilienceHue(r.positiveFlowRatePct)}
                  height={28}
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Insufficient series
                </span>
              )}
            </div>
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
        average monthly net inflow during Correction months — positive
        means the category was still net-buying, on average.
        <InfoTooltip label="Correction months are defined by the dashboard's cycle-phase classifier (Nifty 500 in drawdown + active-equity flow z-score). Categories with fewer than 3 Correction-month data points are excluded." />
      </p>
    </Card>
  );
}

/** Small coloured dot — hue maps red (low resilience) → green (high
 *  resilience). Replaces the legacy proportional width-fill bar. */
function ResilienceDot({ pct }: { pct: number }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: resilienceHue(pct) }}
      aria-hidden
    />
  );
}

function resilienceHue(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const hue = (clamped / 100) * 140;
  return `hsl(${hue}, 70%, 45%)`;
}
