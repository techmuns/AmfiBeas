import { cn } from "@/lib/cn";

interface CalloutCardProps {
  /** Big stand-alone statement (e.g. "Total AAUM at 100% of all-time high"). */
  statement: string;
  /** Optional supporting context line. */
  context?: string;
  tone?: "positive" | "negative" | "neutral";
  /** Optional accent number rendered alongside, larger style. */
  accentNumber?: string;
  /** Optional short caption that sits next to the accent number to
   *  clarify what it represents (e.g. "percentile", "share of equity
   *  AUM"). Without this, a bare "97th" or "9th" reads as a meaningless
   *  ordinal — readers shouldn't have to scan the statement to learn
   *  what the big number is. */
  accentLabel?: string;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<CalloutCardProps["tone"]>, string> = {
  positive:
    "border-positive/40 bg-gradient-to-br from-positive/15 to-positive/5",
  negative:
    "border-negative/40 bg-gradient-to-br from-negative/15 to-negative/5",
  neutral: "border-foreground/30 bg-gradient-to-br from-muted to-card",
};

/**
 * Newspaper-headline-style callout card. Designed to grab attention
 * with a single bold statement; reads as editorial commentary, not a
 * KPI tile.
 */
export function CalloutCard({
  statement,
  context,
  tone = "neutral",
  accentNumber,
  accentLabel,
  className,
}: CalloutCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5 shadow-sm",
        TONE_CLASS[tone],
        className
      )}
    >
      {accentNumber && (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular tracking-tight text-foreground">
            {accentNumber}
          </span>
          {accentLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {accentLabel}
            </span>
          )}
        </div>
      )}
      <div className="text-base font-medium leading-snug tracking-tight text-foreground">
        {statement}
      </div>
      {context && (
        <div className="mt-1 text-xs text-muted-foreground">{context}</div>
      )}
    </div>
  );
}
