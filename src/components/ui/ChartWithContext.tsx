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
   *    "+0.93% of folio base · latest 2026-04"
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
    <div className="flex flex-wrap items-center gap-2">
      {/* Basis chip first — metadata describing the data the card uses,
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
  );
  // Two-line subtitle: the plain-English description on the first
  // line, dense metadata (denominator caption + optional info-tooltip)
  // on its own smaller secondary line below. Decoupling these stops
  // the readable subtitle from being crushed when the metadata is
  // long, and prevents either line from wrapping into vertical
  // one-word-per-line text inside narrow grid columns.
  const subtitleNode =
    subtitle || denominatorCaption || denominatorTooltip ? (
      <div className="space-y-0.5">
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
        {(denominatorCaption || denominatorTooltip) && (
          <p className="flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground/80">
            {denominatorCaption}
            {denominatorTooltip ? (
              <span className="align-middle">
                <InfoTooltip label={denominatorTooltip} />
              </span>
            ) : null}
          </p>
        )}
      </div>
    ) : undefined;
  // Single headline line — the engine's highest-priority insight.
  const headline = insights && insights.length > 0 ? insights[0] : null;
  return (
    <Card
      title={title}
      subtitleNode={subtitleNode}
      action={pillKind || yoyOk || action ? headerAction : undefined}
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
