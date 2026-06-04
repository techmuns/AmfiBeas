import { cn } from "@/lib/cn";

/**
 * Market-share movement as a diverging bar "leaderboard" — a simpler,
 * more legible replacement for the crossing-lines slopegraph. One row per
 * AMC, sorted from biggest share gainer to biggest loser. The bar grows
 * right (green) for gainers and left (red) for losers from a centre line,
 * scaled to the largest absolute move; the exact Δ (pp) and current share
 * sit in fixed columns on the right. Server component.
 */
export interface MarketShareMovementRow {
  displayName: string;
  startMarketSharePct: number;
  endMarketSharePct: number;
  shareDeltaPp: number;
}

export function MarketShareMovement({
  points,
}: {
  points: MarketShareMovementRow[];
}) {
  const sorted = [...points].sort((a, b) => b.shareDeltaPp - a.shareDeltaPp);
  const maxAbs = Math.max(
    0.01,
    ...sorted.map((p) => Math.abs(p.shareDeltaPp))
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <div className="w-36 shrink-0">AMC</div>
        <div className="flex-1 text-center">← lost share · gained share →</div>
        <div className="w-16 shrink-0 text-right">Δ pp</div>
        <div className="w-14 shrink-0 text-right">Share</div>
      </div>
      {sorted.map((p) => {
        const gain = p.shareDeltaPp >= 0;
        const w = (Math.abs(p.shareDeltaPp) / maxAbs) * 50; // % of half width
        return (
          <div key={p.displayName} className="flex items-center gap-2.5 text-xs">
            <div
              className="w-36 shrink-0 truncate font-medium"
              title={p.displayName}
            >
              {p.displayName}
            </div>
            <div className="relative h-4 flex-1">
              <div className="absolute bottom-0 left-1/2 top-0 w-px bg-border" />
              <div
                className={cn(
                  "absolute top-1/2 h-3 -translate-y-1/2 rounded-sm",
                  gain ? "bg-positive/70" : "bg-negative/70"
                )}
                style={
                  gain
                    ? { left: "50%", width: `${w}%` }
                    : { right: "50%", width: `${w}%` }
                }
              />
            </div>
            <div
              className={cn(
                "w-16 shrink-0 text-right tabular text-[11px] font-medium",
                gain ? "text-positive" : "text-negative"
              )}
            >
              {gain ? "+" : "−"}
              {Math.abs(p.shareDeltaPp).toFixed(2)}
            </div>
            <div className="w-14 shrink-0 text-right tabular text-[11px] text-muted-foreground">
              {p.endMarketSharePct.toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
