import { cn } from "@/lib/cn";

interface MarketTapeCell {
  /** YYYY-MM. */
  month: string;
  /** Phase tag — drives the cell colour. */
  phase:
    | "Expansion"
    | "Peak"
    | "Correction"
    | "Recovery"
    | "Base"
    | "Insufficient data";
  /** Active-equity flow z-score that month. Drives the BAR HEIGHT
   *  inside the cell — the magnitude of the inflow / outflow vs
   *  long-run norm. Null → no bar. */
  flowZScore: number | null;
  /** Optional Nifty drawdown for the tooltip. */
  drawdownPct?: number | null;
}

interface MarketTapeProps {
  cells: MarketTapeCell[];
  /** Cap on how many trailing months to display. */
  lastN?: number;
  /** Total height of the tape in pixels. Bar heights scale within. */
  height?: number;
  className?: string;
}

const PHASE_BG: Record<MarketTapeCell["phase"], string> = {
  Expansion: "bg-positive/15",
  Recovery: "bg-positive/10",
  Correction: "bg-negative/15",
  Peak: "bg-foreground/15",
  Base: "bg-foreground/10",
  "Insufficient data": "bg-muted",
};

const BAR_TONE: Record<"up" | "down" | "neutral", string> = {
  up: "bg-positive",
  down: "bg-negative",
  neutral: "bg-foreground/40",
};

function shortMonth(m: string): string {
  const [y, mm] = m.split("-");
  return `${mm}/${y.slice(2)}`;
}

/**
 * Bloomberg-Terminal-style "market tape" — a horizontal strip of
 * monthly tiles. Each tile's BACKGROUND colour represents the
 * cycle phase (Expansion / Peak / etc.) and the inner BAR height +
 * direction visualises the active-equity flow z-score. The result
 * is a single, dense image that captures BOTH regime context AND
 * flow magnitude across the trailing window.
 *
 * Designed to live near the top of pages — replaces the simple
 * Cycle Ribbon with a richer regime + magnitude read.
 */
export function MarketTape({
  cells,
  lastN,
  height = 56,
  className,
}: MarketTapeProps) {
  if (cells.length === 0) return null;
  const shown = typeof lastN === "number" ? cells.slice(-lastN) : cells;
  if (shown.length === 0) return null;

  // Normalise bar heights against the max absolute z-score so the
  // tallest bar uses the full inner height.
  const maxAbs = shown.reduce(
    (m, c) => (typeof c.flowZScore === "number" ? Math.max(m, Math.abs(c.flowZScore)) : m),
    0
  );
  const innerH = height - 14; // reserve 14px for axis labels / padding
  const halfH = innerH / 2;

  return (
    <div className={cn("space-y-1", className)}>
      <div
        className="flex w-full overflow-hidden rounded-md border border-border/60"
        style={{ height }}
      >
        {shown.map((c) => {
          const z = c.flowZScore;
          const barHeight =
            z !== null && maxAbs > 0 ? (Math.abs(z) / maxAbs) * halfH : 0;
          const dir: "up" | "down" | "neutral" =
            z === null ? "neutral" : z >= 0 ? "up" : "down";
          const tip = `${shortMonth(c.month)} · ${c.phase}${
            z !== null ? ` · flow ${z >= 0 ? "+" : ""}${z.toFixed(2)}σ` : ""
          }${
            typeof c.drawdownPct === "number"
              ? ` · drawdown ${c.drawdownPct.toFixed(1)}%`
              : ""
          }`;
          return (
            <div
              key={c.month}
              className={cn(
                "relative flex flex-1 flex-col items-stretch border-r border-background/40 last:border-r-0",
                PHASE_BG[c.phase]
              )}
              title={tip}
            >
              {/* Centre line */}
              <div
                className="absolute left-0 right-0 border-t border-foreground/20"
                style={{ top: halfH + 6 }}
              />
              {/* Bar (above centre for positive z, below for negative) */}
              {z !== null && (
                <div
                  className={cn("absolute left-1/2 -translate-x-1/2", BAR_TONE[dir])}
                  style={{
                    width: "70%",
                    height: barHeight,
                    [dir === "down" ? "top" : "bottom"]:
                      dir === "down" ? halfH + 6 : height - halfH - 6,
                    borderRadius: 1,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] tabular text-muted-foreground">
        <span>{shortMonth(shown[0].month)}</span>
        <span className="hidden flex-wrap items-center gap-x-2.5 gap-y-0.5 sm:inline-flex">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-positive/40" />
            Expansion / Recovery
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-negative/40" />
            Correction
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-foreground/30" />
            Peak / Base
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-foreground/40" />
            Bar height = |flow z-score|
          </span>
        </span>
        <span>{shortMonth(shown[shown.length - 1].month)}</span>
      </div>
    </div>
  );
}
