"use client";

/** Market-cap segment colours, shared so the bar and any legend stay in sync. */
export const CAP_COLORS = {
  large: "hsl(222 64% 44%)",
  mid: "hsl(200 72% 46%)",
  small: "hsl(28 80% 52%)",
} as const;

export interface CapMix {
  /** Large-cap share of the equity book, as a percentage (0–100). */
  large: number;
  mid: number;
  small: number;
}

const SEGMENTS = [
  { key: "large", label: "Large cap", color: CAP_COLORS.large },
  { key: "mid", label: "Mid cap", color: CAP_COLORS.mid },
  { key: "small", label: "Small cap", color: CAP_COLORS.small },
] as const;

/**
 * Compact market-cap mix (large / mid / small as % of the equity book) shown
 * as plain numbers — "Large cap 75% · Mid cap 17% · Small cap 8%" — each beside
 * its colour dot. (The earlier stacked horizontal bar was dropped in favour of
 * the numbers.) Shared by the AMC compare card and the scheme head-to-head
 * snapshot.
 */
export function MarketCapBar({ split }: { split: CapMix }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {SEGMENTS.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="font-medium tabular text-foreground">
            {split[s.key].toFixed(0)}%
          </span>
        </span>
      ))}
    </div>
  );
}
