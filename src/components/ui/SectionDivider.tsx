import { cn } from "@/lib/cn";

interface SectionDividerProps {
  /** Big editorial label (e.g. "Diagnostics", "AMC universe"). */
  label: string;
  /** Optional eyebrow text rendered above the label. */
  eyebrow?: string;
  /** Optional pull-quote / context line. */
  context?: string;
  /** Optional icon glyph rendered to the left of the label.
   *  Pass any React node — usually a `lucide-react` Icon. */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Editorial section divider for the dashboard. Renders as a thin
 * full-width band with a serif-grade label, an optional eyebrow,
 * and a thin gradient rule. Designed to sit between major content
 * sections so the page reads as a magazine layout, not an
 * undifferentiated stream of cards.
 */
export function SectionDivider({
  label,
  eyebrow,
  context,
  icon,
  className,
}: SectionDividerProps) {
  return (
    <div className={cn("pt-2 pb-1", className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span className="grid h-7 w-7 place-items-center rounded-md border bg-card text-foreground shadow-sm">
              {icon}
            </span>
          )}
          <div>
            {eyebrow && (
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </div>
            )}
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
              {label}
            </h2>
          </div>
        </div>
        {context && (
          <p className="hidden max-w-[44ch] text-[11px] italic text-muted-foreground sm:block">
            {context}
          </p>
        )}
      </div>
      <div className="mt-2.5 h-[2px] w-full rounded-full bg-gradient-to-r from-foreground/40 via-border/60 to-transparent" />
    </div>
  );
}
