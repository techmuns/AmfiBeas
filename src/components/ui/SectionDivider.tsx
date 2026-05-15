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
    <div className={cn("py-1", className)}>
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
            <h2 className="text-base font-semibold tracking-tight">{label}</h2>
          </div>
        </div>
        {context && (
          <p className="hidden max-w-[40ch] text-[11px] italic text-muted-foreground sm:block">
            {context}
          </p>
        )}
      </div>
      <div className="mt-2 h-px w-full bg-gradient-to-r from-foreground/30 via-border to-transparent" />
    </div>
  );
}
