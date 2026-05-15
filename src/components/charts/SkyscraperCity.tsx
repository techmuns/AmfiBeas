import Link from "next/link";
import { cn } from "@/lib/cn";

interface SkyscraperBuilding {
  /** AMC slug — used to build the link href. */
  slug: string;
  /** Display label shown beneath the building. */
  displayName: string;
  /** Building height — typically market share %. */
  marketSharePct: number;
  /** Drives the colour tint — typically QoQ growth %. Positive →
   *  green, negative → red, near-zero → muted. */
  qoqGrowthPct: number | null;
}

interface SkyscraperCityProps {
  buildings: SkyscraperBuilding[];
  /** Base path for the per-AMC link (e.g. "/amc"). */
  basePath?: string;
  height?: number;
  className?: string;
}

const MAX_BUILDING_WIDTH = 56;
const MIN_BUILDING_WIDTH = 28;

function tintFor(growth: number | null): {
  fill: string;
  windowFill: string;
} {
  if (growth === null) {
    return { fill: "hsl(var(--muted-foreground))", windowFill: "hsl(var(--muted))" };
  }
  if (growth > 5) {
    return { fill: "hsl(var(--positive))", windowFill: "hsl(var(--positive))" };
  }
  if (growth < -5) {
    return { fill: "hsl(var(--negative))", windowFill: "hsl(var(--negative))" };
  }
  return { fill: "hsl(var(--chart-1))", windowFill: "hsl(var(--chart-1))" };
}

/**
 * AMC market-share Skyscraper City — each AMC drawn as a building
 * whose **height** scales with its market share and **colour** tints
 * with QoQ growth (green = growing, red = contracting). Buildings
 * have stylised window patterns to read as buildings, not bars.
 *
 * Designed as a slide-deck-grade alternative to the standard "top-N
 * bar chart" view of AMC concentration. The visual metaphor (city
 * skyline) makes the concentration story memorable.
 */
export function SkyscraperCity({
  buildings,
  basePath = "/amc",
  height = 280,
  className,
}: SkyscraperCityProps) {
  if (buildings.length === 0) return null;
  const sorted = [...buildings].sort(
    (a, b) => b.marketSharePct - a.marketSharePct
  );
  const tallest = sorted[0]?.marketSharePct ?? 1;
  // Building width tapers down for smaller AMCs (max → min).
  const widthFor = (i: number) => {
    if (sorted.length <= 1) return MAX_BUILDING_WIDTH;
    const t = i / (sorted.length - 1);
    return Math.round(MAX_BUILDING_WIDTH - t * (MAX_BUILDING_WIDTH - MIN_BUILDING_WIDTH));
  };
  const buildingHeight = (share: number) =>
    Math.max(20, Math.round((share / tallest) * (height - 60)));

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <div
        className="relative flex items-end justify-center gap-2 border-b border-border/60 px-4 pt-6"
        style={{ minHeight: height }}
      >
        {sorted.map((b, i) => {
          const w = widthFor(i);
          const h = buildingHeight(b.marketSharePct);
          const tint = tintFor(b.qoqGrowthPct);
          // Render windows as a tiled pattern.
          const windowsPerRow = w >= 50 ? 4 : w >= 36 ? 3 : 2;
          const rows = Math.max(2, Math.floor(h / 14));
          return (
            <Link
              key={b.slug}
              href={`${basePath}/${b.slug}`}
              className="group flex flex-col items-center"
              title={`${b.displayName} · ${b.marketSharePct.toFixed(2)}% share${
                b.qoqGrowthPct !== null
                  ? ` · QoQ ${b.qoqGrowthPct >= 0 ? "+" : ""}${b.qoqGrowthPct.toFixed(1)}%`
                  : ""
              }`}
            >
              <div
                className="relative overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-90"
                style={{
                  width: w,
                  height: h,
                  backgroundColor: tint.fill,
                  boxShadow: "inset -2px -8px 12px rgba(0,0,0,0.18)",
                }}
              >
                {/* Window grid */}
                <div
                  className="grid h-full w-full p-1"
                  style={{
                    gridTemplateColumns: `repeat(${windowsPerRow}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    gap: 2,
                  }}
                >
                  {Array.from({ length: windowsPerRow * rows }).map((_, idx) => (
                    <div
                      key={idx}
                      className="rounded-[1px]"
                      style={{
                        backgroundColor:
                          (idx % 3 === 0)
                            ? "hsl(var(--background) / 0.45)"
                            : "hsl(var(--background) / 0.25)",
                      }}
                    />
                  ))}
                </div>
                {/* Roof "antenna" for the tallest few */}
                {i < 3 && (
                  <div
                    className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-2 bg-foreground"
                    style={{ width: 1.5, height: 10 }}
                  />
                )}
              </div>
              <div className="mt-1 max-w-[80px] truncate text-center text-[9px] tabular text-foreground/80 group-hover:text-foreground">
                {b.displayName}
              </div>
              <div className="text-[9px] tabular text-muted-foreground">
                {b.marketSharePct.toFixed(2)}%
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
