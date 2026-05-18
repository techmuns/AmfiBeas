import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { cn } from "@/lib/cn";

interface ChartWithContextProps {
  title: string;
  subtitle?: string;
  /** Net / Gross / Stock pill rendered in the header beside the title.
   *  "stock" means an AUM / level / count — no flow direction
   *  applies (no pill rendered in that case). */
  flowKind?: "net" | "gross" | "stock";
  /** One-liner that names the analytical denominator the chart is
   *  expressed against. Examples:
   *    "X% of total net inflow"
   *    "X bps of envelope AUM"
   *    "X% of trailing 5Y avg"
   *  Rendered as a subtle caption between the header and the chart. */
  denominatorCaption?: string;
  /** Optional info-button tooltip explaining the denominator more
   *  fully (formula + source). */
  denominatorTooltip?: string;
  /** Insight lines rendered as an italic strip beneath the chart.
   *  Caller-supplied — usually from `chartInsights(series, ...)`. */
  insights?: string[];
  /** Action slot — same as Card. */
  action?: React.ReactNode;
  /** The chart itself. */
  children: React.ReactNode;
  className?: string;
}

const FLOW_PILL_CLASS: Record<"net" | "gross", string> = {
  net: "border-foreground/30 bg-muted text-foreground",
  gross: "border-foreground/30 bg-foreground/5 text-foreground",
};

/**
 * Standardised chart container that bundles the four-part template
 * the dashboard uses for every analytical chart:
 *
 *   1. Title + Net/Gross pill in the header
 *   2. Subtitle (axis units, time span)
 *   3. Denominator caption above the chart — names the analytical
 *      base the values are expressed against
 *   4. Chart itself (callers pass their `BarSeries` / `MultiLine` etc.)
 *   5. Insight strip below — auto-generated narrative pattern lines
 *
 * Every "trends + proportions + insights" chart on the dashboard
 * goes through this wrapper so the visual grammar is consistent.
 */
export function ChartWithContext({
  title,
  subtitle,
  flowKind,
  denominatorCaption,
  denominatorTooltip,
  insights,
  action,
  children,
  className,
}: ChartWithContextProps) {
  const pillKind = flowKind && flowKind !== "stock" ? flowKind : null;
  const headerAction = (
    <div className="flex items-center gap-2">
      {pillKind && (
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            FLOW_PILL_CLASS[pillKind]
          )}
        >
          {pillKind === "net" ? "Net" : "Gross"}
        </span>
      )}
      {action}
    </div>
  );
  return (
    <Card
      title={title}
      subtitle={subtitle}
      action={pillKind || action ? headerAction : undefined}
      className={className}
    >
      {denominatorCaption && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11.5px] tabular text-foreground/80">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            In proportion to
          </span>
          {denominatorCaption}
          {denominatorTooltip && <InfoTooltip label={denominatorTooltip} />}
        </div>
      )}
      {children}
      {insights && insights.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border/40 pt-3">
          {insights.map((line, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-[12px] italic text-muted-foreground"
            >
              <span aria-hidden className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
