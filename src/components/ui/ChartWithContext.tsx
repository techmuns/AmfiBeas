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
  /** Analytical denominator the chart is expressed against. Examples:
   *    "67% of industry net inflow · latest 2026-04"
   *    "120 bps of total folio base"
   *    "98% of trailing 12M avg"
   *  Folded inline into the subtitle so the chart header stays a
   *  single, scannable line instead of an extra labelled pill. */
  denominatorCaption?: string;
  /** Optional info-button tooltip explaining the denominator more
   *  fully (formula + source). Renders an (i) icon next to the
   *  subtitle when provided. */
  denominatorTooltip?: string;
  /** Insight lines from `chartInsights(...)`. ONLY the first line is
   *  rendered — as a single italic headline above the chart — so the
   *  card reads "title → headline → chart" instead of stacking a
   *  three-bullet strip below the chart. The downstream array is
   *  still accepted for forward compatibility with detail views. */
  insights?: string[];
  /** Optional YoY / QoQ growth badge rendered in the header.
   *  Green if positive, red if negative. */
  yoyBadge?: { pct: number; label?: string };
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
 * Re-designed (Phase 0 of the cleanup): the wrapper now reads as
 * one quick scan — title, one-sentence headline insight, then the
 * chart. Denominator text rides inside the subtitle line; there's
 * no extra "In proportion to …" pill or three-bullet strip.
 *
 * Render order:
 *   1. Card header: title + subtitle (subtitle absorbs the
 *      denominator caption + optional info-tooltip).
 *   2. Headline: a single italic prose line above the chart — the
 *      highest-priority insight from `chartInsights()`. Drops the
 *      previous three-bullet block.
 *   3. Chart itself.
 *
 * Callers don't need to change — the previous API is preserved.
 */
export function ChartWithContext({
  title,
  subtitle,
  flowKind,
  denominatorCaption,
  denominatorTooltip,
  insights,
  yoyBadge,
  action,
  children,
  className,
}: ChartWithContextProps) {
  const pillKind = flowKind && flowKind !== "stock" ? flowKind : null;
  const yoyOk =
    yoyBadge && Number.isFinite(yoyBadge.pct) ? yoyBadge : null;
  const yoyPositive = yoyOk ? yoyOk.pct >= 0 : false;
  const headerAction = (
    <div className="flex items-center gap-2">
      {yoyOk && (
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular",
            yoyPositive
              ? "border-positive/40 bg-positive/10 text-positive"
              : "border-negative/40 bg-negative/10 text-negative"
          )}
          title={`${yoyOk.label ?? "YoY"} ${yoyOk.pct >= 0 ? "+" : ""}${yoyOk.pct.toFixed(1)}%`}
        >
          {yoyOk.label ?? "YoY"} {yoyOk.pct >= 0 ? "+" : ""}
          {yoyOk.pct.toFixed(1)}%
        </span>
      )}
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
  // Subtitle absorbs the denominator caption. Both pieces are read
  // as one line so the eye doesn't bounce between header → pill →
  // chart.
  const subtitleNode =
    subtitle || denominatorCaption || denominatorTooltip ? (
      <>
        {subtitle}
        {subtitle && denominatorCaption ? " · " : ""}
        {denominatorCaption}
        {denominatorTooltip ? (
          <span className="ml-1 align-middle">
            <InfoTooltip label={denominatorTooltip} />
          </span>
        ) : null}
      </>
    ) : undefined;
  // Single headline line — the engine's highest-priority insight.
  const headline = insights && insights.length > 0 ? insights[0] : null;
  return (
    <Card
      title={title}
      subtitleNode={subtitleNode}
      action={pillKind || yoyOk || action ? headerAction : undefined}
      className={className}
    >
      {headline && (
        <p className="mb-3 border-l-2 border-foreground/40 pl-3 text-[13px] italic leading-snug text-foreground/85">
          {headline}
        </p>
      )}
      {children}
    </Card>
  );
}
