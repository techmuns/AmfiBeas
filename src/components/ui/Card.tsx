import { cn } from "@/lib/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
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
        className
      )}
      {...rest}
    >
      {(title || action || toneBadge) && (
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            {title && (
              <h3 className="text-sm font-medium tracking-tight">{title}</h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {action}
            {toneBadge && (
              <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {toneBadge}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="px-6 pb-6 pt-4">{children}</div>
    </div>
  );
}
