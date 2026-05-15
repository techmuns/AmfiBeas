import { cn } from "@/lib/cn";

interface HeadlineCardProps {
  /** Big headline number — caller pre-formats (e.g. "₹47.0K Cr"). */
  headline: string;
  /** Short eyebrow text rendered above the headline (small caps). */
  eyebrow: string;
  /** Plain-English context line (e.g. "Top 4% of months · Cycle: Recovery"). */
  context: string;
  /** Optional pull-quote style takeaway — italic, narrative tone. */
  takeaway?: string;
  /** Right-side accent — usually the cycle-phase pill or the mood
   *  badge. Renders inline on the right at large screens. */
  accent?: React.ReactNode;
  className?: string;
}

/**
 * Editorial-style hero card. Big serif-ish number + a single context
 * line + an optional pull-quote. Designed to read like a Bloomberg /
 * WSJ lede — replaces the row-of-small-KPIs pattern at the top of
 * a page with a single dramatic statement.
 */
export function HeadlineCard({
  headline,
  eyebrow,
  context,
  takeaway,
  accent,
  className,
}: HeadlineCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-6 shadow-sm",
        "lg:flex lg:items-center lg:justify-between lg:gap-8",
        className
      )}
    >
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </div>
        <div className="text-4xl font-semibold tabular tracking-tight sm:text-5xl lg:text-6xl">
          {headline}
        </div>
        <div className="text-sm text-foreground/85">{context}</div>
        {takeaway && (
          <p className="mt-2 max-w-2xl text-sm italic text-muted-foreground">
            “{takeaway}”
          </p>
        )}
      </div>
      {accent && (
        <div className="mt-4 shrink-0 lg:mt-0">{accent}</div>
      )}
    </div>
  );
}
