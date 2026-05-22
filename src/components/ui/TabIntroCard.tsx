import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

interface TabIntroCardProps {
  headline: string;
  /** Plain string or rich node (e.g. with `<span>`s coloured via the
   *  `text-positive` / `text-negative` design tokens). */
  summary: ReactNode;
  /** Optional "what to watch next" hint, rendered as a single line
   *  below the summary. Use one short sentence — anything longer
   *  belongs in a chart caption, not the intro. */
  watchNext?: ReactNode;
  /** Optional signal chip (e.g. a coloured badge for the current
   *  market regime). Renders to the right of the headline. */
  signalChip?: ReactNode;
}

/**
 * Compact intro card that sits at the top of every tab. Gives a buy-
 * side reader the question the tab answers, the headline finding, and
 * what to watch next — all in plain English, no jargon.
 */
export function TabIntroCard({
  headline,
  summary,
  watchNext,
  signalChip,
}: TabIntroCardProps) {
  return (
    <Card>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold tracking-tight">{headline}</h3>
          {signalChip ? <div className="shrink-0">{signalChip}</div> : null}
        </div>
        <p className="text-sm text-muted-foreground">{summary}</p>
        {watchNext ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Watch next:</span>{" "}
            {watchNext}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
