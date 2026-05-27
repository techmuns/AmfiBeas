import { cn } from "@/lib/cn";

/**
 * One-line "Ambit-style" takeaway rendered above a chart/table: a bold
 * headline sentence (value + delta + ranked breakdown) with an optional
 * muted detail line. Standardises the descriptive-headline pattern across
 * the dashboard. Deltas are passed as coloured spans by the caller.
 */
export function KeyTakeaway({
  headline,
  detail,
  className,
}: {
  headline: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1 leading-snug", className)}>
      <p className="text-sm font-medium text-foreground">{headline}</p>
      {detail && <p className="text-[13px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** Signed ₹ Cr delta as a coloured span (green up / red down). */
export function DeltaCr({ cr }: { cr: number }) {
  const sign = cr >= 0 ? "+" : "−";
  return (
    <span className={cr >= 0 ? "text-positive" : "text-negative"}>
      {sign}₹{Math.abs(Math.round(cr)).toLocaleString("en-IN")} Cr
    </span>
  );
}
