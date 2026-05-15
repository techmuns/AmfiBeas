import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";

interface CoachPillProps {
  message: string;
  className?: string;
}

/**
 * Compact "look at" coach pill — inline editorial nudge that
 * highlights the most important read on the page right now. Sits
 * unobtrusively above the fold, adds a "👀 Look at:" feel without a
 * persistent floating overlay.
 */
export function CoachPill({ message, className }: CoachPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-start gap-2 rounded-md border border-foreground/30 bg-muted/40 px-3 py-2 text-[11px] text-foreground/90",
        className
      )}
    >
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
      <span>
        <span className="font-semibold uppercase tracking-wide text-[10px] text-foreground/70">
          Look at:
        </span>{" "}
        {message}
      </span>
    </div>
  );
}
