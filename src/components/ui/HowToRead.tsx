import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface HowToReadProps {
  /** Short plain-English explanation. Pass either a string or rich
   *  content (e.g. `<ul>` with 2-3 short bullets). Keep it tight —
   *  this card surfaces beginner orientation, not formula detail. */
  children: ReactNode;
  className?: string;
}

/**
 * Compact "How to read this" note for complex chart / dashboard cards.
 * Designed for the beginner-investor audience: 1-3 short sentences or
 * bullets, plain English. Sits directly inside the card body (under
 * the chart or under the subtitle). Never used to hide content —
 * always visible.
 */
export function HowToRead({ children, className }: HowToReadProps) {
  return (
    <div
      className={cn(
        "mt-3 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-[12px] leading-snug text-muted-foreground",
        className
      )}
    >
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-foreground/80">
        How to read this
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
