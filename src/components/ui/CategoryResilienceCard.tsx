import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { cn } from "@/lib/cn";
import { formatCompactCrSafe } from "@/lib/format";
import type { CategoryResilienceRow } from "@/data/category-resilience";

interface CategoryResilienceCardProps {
  rows: CategoryResilienceRow[];
}

/**
 * Category Resilience Through Drawdowns — ranked table of IIFL
 * active-equity categories by the % of Correction-phase months in
 * which they kept net inflow positive. No bar fills; the resilience
 * score is colour-coded inline (red → amber → green) and paired with
 * the average flow during Correction months.
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px] tabular">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5">Category</th>
              <th className="px-2 py-1.5 text-right">Positive months</th>
              <th className="px-2 py-1.5 text-right">Sample</th>
              <th className="px-2 py-1.5 text-right">Avg flow / month</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.slug}
                className="border-t border-border/60 hover:bg-accent/30"
              >
                <td className="px-2 py-2 text-foreground truncate" title={r.label}>
                  {r.label}
                </td>
                <td className="px-2 py-2 text-right">
                  <span
                    className={cn(
                      "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                      resilienceChipTone(r.positiveFlowRatePct)
                    )}
                  >
                    {r.positiveFlowRatePct.toFixed(0)}%
                  </span>
                </td>
                <td
                  className="px-2 py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap"
                  title={
                    r.latestCorrectionMonth
                      ? `Latest Correction month: ${r.latestCorrectionMonth}`
                      : undefined
                  }
                >
                  {r.correctionMonthCount} mo
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular whitespace-nowrap",
                    r.avgFlowDuringCorrection >= 0
                      ? "text-positive"
                      : "text-negative"
                  )}
                  title={`${r.correctionMonthCount} Correction-phase months${r.latestCorrectionMonth ? ` · latest ${r.latestCorrectionMonth}` : ""}`}
                >
                  {r.avgFlowDuringCorrection >= 0 ? "+" : "−"}
                  {formatCompactCrSafe(Math.abs(r.avgFlowDuringCorrection))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Sorted most-resilient first. The right-side ₹ Cr figure is the
        average monthly net inflow during Correction months — a
        positive number means the category was still net-buying in
        those months, on average.
        <InfoTooltip label="Correction months are defined by the dashboard's cycle-phase classifier (Nifty 500 in drawdown + active-equity flow z-score). Categories with fewer than 3 Correction-month data points are excluded. Resilience chip: ≥66% green, 33–66% amber, <33% red." />
      </p>
    </Card>
  );
}

function resilienceChipTone(pct: number): string {
  if (pct >= 66) return "border-positive/40 bg-positive/10 text-positive";
  if (pct >= 33) return "border-[hsl(var(--chart-3))]/40 bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]";
  return "border-negative/40 bg-negative/10 text-negative";
}
