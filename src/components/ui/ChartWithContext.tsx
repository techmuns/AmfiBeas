import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { cn } from "@/lib/cn";

interface ChartWithContextProps {
  title: string;
  /** Accepted for backwards compatibility but no longer rendered.
   *  See Card.tsx — the rule is title-only headers. */
  subtitle?: string;
  /** Net / Gross / Stock pill rendered in the header beside the title.
   *  "stock" means an AUM / level / count — no flow direction
   *  applies (no pill rendered in that case). */
  flowKind?: "net" | "gross" | "stock";
  /** Accepted for backwards compatibility but no longer rendered.
   *  The metadata text that used to ride here is now considered
   *  redundant alongside the chart itself. */
  denominatorCaption?: string;
  /** Optional info-button tooltip explaining the denominator more
   *  fully (formula + source). Renders an (i) icon in the header
   *  action area so the methodology stays one click away. */
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

/** Static "Basis" chip styling for the Net/Gross flow-kind metadata.
 *  Visually distinct from `LensToggle` segmented pills (which are
 *  user-clickable controls) so beginners can tell at a glance that
 *  the basis chip describes WHAT the data is, not HOW it's viewed. */
const FLOW_PILL_CLASS: Record<"net" | "gross", string> = {
  net: "border-foreground/40 bg-foreground/10 text-foreground",
  gross: "border-foreground/40 bg-foreground/5 text-foreground",
};
const FLOW_PILL_TITLE: Record<"net" | "gross", string> = {
  net: "This card shows net flows (inflows minus outflows / redemptions).",
  gross: "This card shows gross flows (inflows only, no redemptions netted).",
};

/**
 * Title-only chart card. The pre-existing `subtitle` and
 * `denominatorCaption` props are still accepted at the call site
 * for backwards compatibility but are not rendered — the
 * dashboard-wide rule is "no short explanation text under the
 * heading". Methodology copy that lived in the subtitle's info
 * icon (`denominatorTooltip`) now rides in the header action slot
 * as a standalone info-button so it stays one click away.
 *
 * Render order:
 *   1. Card header: title + action row (info-tooltip, Basis chip,
 *      optional YoY badge, caller-passed action).
 *   2. Headline: a single italic prose line above the chart — the
 *      highest-priority insight from `chartInsights()`. Drops the
 *      previous three-bullet block.
 *   3. Chart itself.
 *
 * Callers don't need to change — the previous API is preserved.
 */
export function ChartWithContext({
  title,
  subtitle: _subtitle,
  flowKind,
  denominatorCaption: _denominatorCaption,
  denominatorTooltip,
  insights,
  yoyBadge,
  action,
  children,
  className,
}: ChartWithContextProps) {
  void _subtitle;
  void _denominatorCaption;
  const pillKind = flowKind && flowKind !== "stock" ? flowKind : null;
  const yoyOk =
    yoyBadge && Number.isFinite(yoyBadge.pct) ? yoyBadge : null;
  const yoyPositive = yoyOk ? yoyOk.pct >= 0 : false;
  const hasAnyAction =
    !!denominatorTooltip || !!pillKind || !!yoyOk || !!action;
  const headerAction = hasAnyAction ? (
    <div className="flex flex-wrap items-center gap-2">
      {/* Info-button first — the methodology copy migrated here from
          the retired subtitle line. Keeps the deeper explanation one
          click away on every chart card that used to carry it. */}
      {denominatorTooltip && (
        <span className="inline-flex shrink-0">
          <InfoTooltip label={denominatorTooltip} size="sm" />
        </span>
      )}
      {/* Basis chip — metadata describing the data the card uses,
          visually distinct from segmented control pills below. */}
      {pillKind && (
        <span
          className={cn(
            "shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            FLOW_PILL_CLASS[pillKind]
          )}
          title={FLOW_PILL_TITLE[pillKind]}
          aria-label={`Data basis: ${pillKind} flows`}
        >
          <span className="mr-1 font-normal opacity-60">Basis ·</span>
          {pillKind === "net" ? "NET" : "GROSS"}
        </span>
      )}
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
      {action}
    </div>
  ) : undefined;
  // Single headline line — the engine's highest-priority insight.
  const headline = insights && insights.length > 0 ? insights[0] : null;
  return (
    <Card
      title={title}
      action={headerAction}
      className={className}
      stackHeader
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
