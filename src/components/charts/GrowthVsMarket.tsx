import { cn } from "@/lib/cn";

/**
 * "Growth vs the Market" leaderboard — one card that unifies AUM growth
 * and market-share movement. Each AMC's bar shows how its QoQ AUM growth
 * compares to the industry's growth (the centre line = industry pace):
 * right / green = grew faster than the market → gaining share; left / red
 * = slower → losing share. The columns keep the full decomposition — the
 * AMC's own growth, its current share, and its share change — so the
 * cause (growth vs benchmark) and effect (share move) sit in one row.
 * Server component.
 */
export interface GrowthVsMarketRow {
  displayName: string;
  aumGrowthPct: number;
  excessGrowthPct: number;
  sharePct: number;
  shareDeltaPp: number;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

export function GrowthVsMarket({ points }: { points: GrowthVsMarketRow[] }) {
  const sorted = [...points].sort(
    (a, b) => b.excessGrowthPct - a.excessGrowthPct
  );
  const maxAbs = Math.max(0.01, ...sorted.map((p) => Math.abs(p.excessGrowthPct)));

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <div className="w-36 shrink-0">AMC</div>
        <div className="flex-1 text-center">
          ← slower · faster than the market →
        </div>
        <div className="w-16 shrink-0 text-right">AUM gr.</div>
        <div className="w-14 shrink-0 text-right">Share</div>
        <div className="w-16 shrink-0 text-right">Δ share</div>
      </div>
      {sorted.map((p) => {
        const beat = p.excessGrowthPct >= 0;
        const w = (Math.abs(p.excessGrowthPct) / maxAbs) * 50; // % of half width
        const gainedShare = p.shareDeltaPp >= 0;
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
                  beat ? "bg-positive/70" : "bg-negative/70"
                )}
                style={
                  beat
                    ? { left: "50%", width: `${w}%` }
                    : { right: "50%", width: `${w}%` }
                }
              />
            </div>
            <div className="w-16 shrink-0 text-right tabular-nums text-[11px] text-foreground">
              {fmtPct(p.aumGrowthPct)}
            </div>
            <div className="w-14 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground">
              {p.sharePct.toFixed(2)}%
            </div>
            <div
              className={cn(
                "w-16 shrink-0 text-right tabular-nums text-[11px] font-medium",
                gainedShare ? "text-positive" : "text-negative"
              )}
            >
              {gainedShare ? "+" : "−"}
              {Math.abs(p.shareDeltaPp).toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
