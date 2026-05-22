"use client";

import { useState, type ReactNode } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface HowToReadProps {
  /** Short plain-English explanation. Pass either a string or rich
   *  content (e.g. `<ul>` with 2-3 short bullets). Keep it tight —
   *  this card surfaces beginner orientation, not formula detail. */
  children: ReactNode;
  className?: string;
}

/**
 * "Explain with AI" toggle for complex chart / dashboard cards.
 * Sits at the bottom of the card body as a compact button; clicking
 * it expands the beginner-orientation note (1-3 short sentences or
 * bullets) inline beneath the trigger.
 */
export function HowToRead({ children, className }: HowToReadProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("mt-3", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-foreground/10 bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/80 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        )}
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        Explain with AI
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <div className="space-y-1">{children}</div>
        </div>
      )}
    </div>
  );
}
