import { cn } from "@/lib/cn";

interface ReplayEpisode {
  title: string;
  startMonth: string;
  endMonth: string;
  monthCount: number;
  maxDrawdownPct: number;
  totalActiveEquityFlow: number;
  avgFlowZScore: number | null;
  read: string;
}

interface EpisodeReplayStripProps {
  episodes: ReplayEpisode[];
  /** Caller-provided ₹ Cr formatter. */
  formatValue?: (v: number) => string;
  className?: string;
}

function flowToneClass(z: number | null): string {
  if (z === null) return "border-border bg-muted text-muted-foreground";
  if (z >= 0.5) return "border-positive/40 bg-positive/10 text-positive";
  if (z <= -0.5) return "border-negative/40 bg-negative/10 text-negative";
  return "border-foreground/30 bg-muted text-foreground";
}

/**
 * Horizontally scrollable strip of historical drawdown episodes.
 * Each card summarises the episode's depth, length, and how
 * investors behaved (flow z-score) — a visual pattern-recognition
 * device that lets the reader compare cycles at a glance.
 */
export function EpisodeReplayStrip({
  episodes,
  formatValue,
  className,
}: EpisodeReplayStripProps) {
  if (episodes.length === 0) return null;
  const fmt = formatValue ?? ((v: number) => `₹${v.toFixed(0)} Cr`);
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <div className="flex gap-3" style={{ minWidth: "max-content" }}>
        {episodes.map((e, i) => (
          <article
            key={i}
            className="flex w-[260px] shrink-0 flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm"
          >
            <header className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Episode
                </div>
                <h4 className="text-sm font-semibold tracking-tight">{e.title}</h4>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tabular tracking-tight whitespace-nowrap",
                  flowToneClass(e.avgFlowZScore)
                )}
                title={
                  e.avgFlowZScore !== null
                    ? `Average active-equity flow z-score during the episode: ${e.avgFlowZScore.toFixed(2)}σ`
                    : "Flow z-score unavailable"
                }
              >
                {e.avgFlowZScore !== null
                  ? `${e.avgFlowZScore >= 0 ? "+" : ""}${e.avgFlowZScore.toFixed(2)}σ flow`
                  : "no flow data"}
              </span>
            </header>
            <div className="grid grid-cols-2 gap-2 text-[11px] tabular">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Window
                </div>
                <div className="font-medium">
                  {e.startMonth} → {e.endMonth}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Length
                </div>
                <div className="font-medium">
                  {e.monthCount}M
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Max drawdown
                </div>
                <div className="font-medium text-negative">
                  {e.maxDrawdownPct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total flow
                </div>
                <div className="font-medium">
                  {fmt(e.totalActiveEquityFlow)}
                </div>
              </div>
            </div>
            <p className="mt-1 text-[11px] italic text-muted-foreground">
              “{e.read}”
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
