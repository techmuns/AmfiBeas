import { cn } from "@/lib/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  /** Accepted for backwards compatibility but no longer rendered.
   *  The dashboard-wide rule is title-only headers; methodology /
   *  source captions that used to live here now route through the
   *  `action` slot (info-tooltip) or the in-body source footer. */
  subtitle?: string;
  /** Accepted for backwards compatibility but no longer rendered.
   *  See `subtitle`. */
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
  /**
   * When true, header stacks title and action area vertically at
   * every viewport width — no responsive switch to a horizontal
   * row layout. Use for chart cards whose action area packs multiple
   * control groups (Basis chip + YoY pill + lens toggle + chart-type
   * toggle); the responsive `sm:flex-row` layout would otherwise
   * compete with the title for horizontal space and crush long titles
   * into one-word-per-line wraps inside narrow grid columns.
   *
   * `ChartWithContext` passes this unconditionally so the rule
   * applies to every chart card on the dashboard. Plain Card callers
   * (KpiCard, methodology cards) keep the default responsive layout.
   */
  stackHeader?: boolean;
}

export function Card({
  title,
  // `subtitle` and `subtitleNode` are accepted but intentionally
  // not destructured into render output — the rule is title-only.
  subtitle: _subtitle,
  subtitleNode: _subtitleNode,
  action,
  className,
  children,
  tone,
  stackHeader,
  ...rest
}: CardProps) {
  void _subtitle;
  void _subtitleNode;
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
        stackHeader ? (
          // Vertical-at-every-width layout: title → action row. Used
          // by ChartWithContext for every chart card so the header
          // never crushes the title to share space with a crowded
          // action area.
          <div className="flex flex-col gap-3 px-6 pt-5">
            <div className="min-w-0">
              {title && (
                <h3 className="text-sm font-medium tracking-tight">{title}</h3>
              )}
            </div>
            {(action || toneBadge) && (
              <div className="flex flex-wrap items-center gap-2">
                {action}
                {toneBadge && (
                  <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {toneBadge}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-6 pt-5 sm:flex-row sm:items-start sm:justify-between">
            {/* min-w-0 + flex-1 is the critical pair: without min-w-0 a
                flex item refuses to shrink below its content width. */}
            <div className="min-w-0 flex-1">
              {title && (
                <h3 className="text-sm font-medium tracking-tight">{title}</h3>
              )}
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
        )
      )}
      <div className="px-6 pb-6 pt-4">{children}</div>
    </div>
  );
}
