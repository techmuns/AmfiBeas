import { cn } from "@/lib/cn";

interface StickyContextFooterProps {
  cyclePhase: string | null;
  flowZScore: number | null;
  drawdownPct: number | null;
  latestMonth: string | null;
  className?: string;
}

function flowToneClass(z: number | null): string {
  if (z === null) return "text-muted-foreground";
  if (z >= 1) return "text-positive";
  if (z <= -1) return "text-negative";
  return "text-foreground";
}

function drawdownToneClass(dd: number | null): string {
  if (dd === null) return "text-muted-foreground";
  if (dd <= -10) return "text-negative";
  if (dd >= -3) return "text-positive";
  return "text-foreground";
}

function phaseToneClass(phase: string | null): string {
  if (!phase) return "text-muted-foreground";
  if (phase === "Recovery" || phase === "Expansion") return "text-positive";
  if (phase === "Correction") return "text-negative";
  return "text-foreground";
}

/**
 * Persistent sticky bottom-of-page "ticker" — always visible context
 * regardless of how far the reader has scrolled. Mirrors a market
 * data terminal's status bar.
 */
export function StickyContextFooter({
  cyclePhase,
  flowZScore,
  drawdownPct,
  latestMonth,
  className,
}: StickyContextFooterProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 mt-6 -mx-4 border-t bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:-mx-0 sm:rounded-t-md sm:border sm:px-3 print:hidden",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] tabular">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide text-[10px] text-foreground">
              Live ·
            </span>{" "}
            {latestMonth ?? "—"}
          </span>
          <span className="text-muted-foreground">
            Phase{" "}
            <span className={cn("font-medium", phaseToneClass(cyclePhase))}>
              {cyclePhase ?? "—"}
            </span>
          </span>
          <span className="text-muted-foreground">
            Active flow{" "}
            <span className={cn("font-medium", flowToneClass(flowZScore))}>
              {flowZScore === null
                ? "—"
                : `${flowZScore >= 0 ? "+" : ""}${flowZScore.toFixed(2)}σ`}
            </span>
          </span>
          <span className="text-muted-foreground">
            Nifty 500{" "}
            <span className={cn("font-medium", drawdownToneClass(drawdownPct))}>
              {drawdownPct === null ? "—" : `${drawdownPct.toFixed(1)}%`}
            </span>{" "}
            <span className="text-[10px]">off peak</span>
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/80">
          AmfiBeas · always-on context tape
        </span>
      </div>
    </div>
  );
}
