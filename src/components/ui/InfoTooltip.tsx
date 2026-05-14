import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

interface InfoTooltipProps {
  label: string;
  className?: string;
  size?: "xs" | "sm";
}

/** A compact info-icon trigger that surfaces a longer methodology
 *  note via the native title-attribute tooltip. Lets callers move
 *  long subtitle text behind an icon so the visible header stays
 *  tight on small screens. Uses Lucide's `Info` glyph for a
 *  consistent look across the dashboard. */
export function InfoTooltip({ label, className, size = "xs" }: InfoTooltipProps) {
  const iconSize = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      tabIndex={0}
      className={cn(
        "inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
    >
      <Info className={iconSize} />
    </span>
  );
}
