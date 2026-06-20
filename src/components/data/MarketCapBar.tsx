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
 * Horizontal market-cap mix bar (large / mid / small as % of the equity book)
 * with a colour-swatch legend below. The legend spells the segments out —
 * "Large cap / Mid cap / Small cap" beside their colour — so the bar reads on
 * its own without bare L/M/S letters. Shared by the AMC compare card and the
 * scheme head-to-head snapshot.
 */
export function MarketCapBar({ split }: { split: CapMix }) {
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded border text-[10px] font-medium text-white">
        {SEGMENTS.map((s) => {
          const pct = split[s.key];
          return (
            <div
              key={s.key}
              className="flex items-center justify-center"
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              title={`${s.label} ${pct.toFixed(1)}%`}
            >
              {pct >= 14 ? `${pct.toFixed(0)}` : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            {s.label} {split[s.key].toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}
