import { cn } from "@/lib/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  /** Optional rich subtitle node — takes precedence over `subtitle`.
   *  Use when the subtitle needs inline children (e.g. an info
   *  tooltip or a `<strong>` accent) that a plain string can't
   *  express. ChartWithContext uses this to fold its denominator
   *  caption + info-tooltip into the subtitle line. */
  subtitleNode?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * Visual treatment indicating data status.
   *   - undefined / "live"  : default colorful styling (live sourced data)
   *   - "demo"              : grayscale + reduced opacity + dashed
   *                           border + auto "Demo" badge in header
   *   - "pending"           : same dashed/muted treatment as "demo"
   *                           but with a "Pending" badge instead.
   * Used by /monthly to visually separate the live AMFI sections
   * from the older generated/demo widgets.
   */
  tone?: "live" | "demo" | "pending";
}

export function Card({
  title,
  subtitle,
  subtitleNode,
  action,
  className,
  children,
  tone,
  ...rest
}: CardProps) {
  const isDemo = tone === "demo" || tone === "pending";
  const toneBadge =
    tone === "demo"
      ? "Demo"
      : tone === "pending"
        ? "Pending"
        : null;
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        // Demo / pending widgets get a dashed border + reduced
        // opacity + a `grayscale` filter cascading to the chart
        // body, so they read as visually muted before the user
        // even sees the source caption.
        isDemo &&
          "border-dashed border-muted-foreground/40 opacity-80 [&_.recharts-surface]:grayscale [&_.recharts-surface]:opacity-90",
        // Print: keep the title and body together; never split a card
        // mid-flow across pages.
        "print:break-inside-avoid",
        className
      )}
      {...rest}
    >
      {(title || action || toneBadge) && (
        <div className="flex flex-col gap-3 px-6 pt-5 sm:flex-row sm:items-start sm:justify-between">
          {/* min-w-0 + flex-1 is the critical pair: without min-w-0 a
              flex item refuses to shrink below its content width, which
              is what forces long titles like "SIP Contribution Trend"
              into one-word-per-line wraps inside narrow columns. */}
          <div className="min-w-0 flex-1 space-y-1">
            {title && (
              <h3 className="text-sm font-medium tracking-tight">{title}</h3>
            )}
            {subtitleNode ? (
              <p className="text-xs text-muted-foreground">{subtitleNode}</p>
            ) : subtitle ? (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {(action || toneBadge) && (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {action}
              {toneBadge && (
                <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {toneBadge}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <div className="px-6 pb-6 pt-4">{children}</div>
    </div>
  );
}
