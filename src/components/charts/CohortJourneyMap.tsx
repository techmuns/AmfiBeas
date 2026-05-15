"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";

interface JourneyPoint {
  amcSlug: string;
  displayName: string;
  startMarketSharePct: number;
  endMarketSharePct: number;
  startQuarter: string;
  endQuarter: string;
  startQuarterLabel: string;
  endQuarterLabel: string;
  latestAum: number;
  shareDeltaPp: number;
}

interface CohortJourneyMapProps {
  points: JourneyPoint[];
  height?: number;
  className?: string;
}

/**
 * Cohort Journey Map. Each AMC drawn as an arrow on a 2D canvas:
 *   - x-axis: the journey through time (left → right)
 *   - y-axis: market share %
 *   - arrow tail: AMC's share at the EARLIEST quarter on record
 *   - arrow head: AMC's share at the LATEST quarter
 *   - colour: green for share gainers, red for share losers
 *
 * Visualises the structural shifts in the industry as a single
 * image of converging / diverging arrows.
 */
export function CohortJourneyMap({
  points,
  height = 340,
  className,
}: CohortJourneyMapProps) {
  const layout = useMemo(() => {
    if (points.length === 0) return null;
    const padding = { top: 24, bottom: 32, left: 60, right: 100 };
    const vw = 880;
    const innerW = vw - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allShares = points.flatMap((p) => [
      p.startMarketSharePct,
      p.endMarketSharePct,
    ]);
    const yMax = Math.max(...allShares) * 1.05;
    const yMin = 0;
    const yScale = (v: number) =>
      padding.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const startX = padding.left + 12;
    const endX = padding.left + innerW - 12;

    return {
      vw,
      padding,
      innerW,
      innerH,
      yMax,
      yMin,
      yScale,
      startX,
      endX,
    };
  }, [points, height]);

  if (!layout || points.length === 0) return null;
  const { vw, padding, innerH, yMax, yScale, startX, endX } = layout;

  // Y-axis tick values
  const ticks: number[] = [];
  const tickStep = yMax > 5 ? Math.ceil(yMax / 5) : 1;
  for (let v = 0; v <= yMax; v += tickStep) ticks.push(v);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg viewBox={`0 0 ${vw} ${height}`} className="block w-full" style={{ minWidth: 600 }}>
        {/* Y-axis grid + ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padding.left}
              x2={vw - padding.right}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="hsl(var(--border))"
              strokeDasharray="2 3"
              strokeWidth={0.5}
            />
            <text
              x={padding.left - 6}
              y={yScale(t)}
              dominantBaseline="middle"
              textAnchor="end"
              fontSize="10"
              fill="hsl(var(--muted-foreground))"
              className="tabular"
            >
              {t.toFixed(0)}%
            </text>
          </g>
        ))}
        {/* X-axis labels */}
        <text
          x={startX}
          y={padding.top + innerH + 18}
          textAnchor="middle"
          fontSize="10"
          fill="hsl(var(--muted-foreground))"
          className="tabular"
        >
          {points[0].startQuarterLabel}
        </text>
        <text
          x={endX}
          y={padding.top + innerH + 18}
          textAnchor="middle"
          fontSize="10"
          fill="hsl(var(--muted-foreground))"
          className="tabular"
        >
          {points[0].endQuarterLabel}
        </text>

        {/* Arrow definitions for gainers / losers */}
        <defs>
          <marker
            id="arrow-up"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--positive))" />
          </marker>
          <marker
            id="arrow-down"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--negative))" />
          </marker>
          <marker
            id="arrow-flat"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
          </marker>
        </defs>

        {/* Per-AMC journey arrows */}
        {points.map((p) => {
          const sy = yScale(p.startMarketSharePct);
          const ey = yScale(p.endMarketSharePct);
          const tone =
            p.shareDeltaPp > 0.1
              ? "hsl(var(--positive))"
              : p.shareDeltaPp < -0.1
                ? "hsl(var(--negative))"
                : "hsl(var(--muted-foreground))";
          const marker =
            p.shareDeltaPp > 0.1
              ? "url(#arrow-up)"
              : p.shareDeltaPp < -0.1
                ? "url(#arrow-down)"
                : "url(#arrow-flat)";
          return (
            <g key={p.amcSlug}>
              <line
                x1={startX}
                y1={sy}
                x2={endX}
                y2={ey}
                stroke={tone}
                strokeOpacity={0.55}
                strokeWidth={1.6}
                markerEnd={marker}
              >
                <title>
                  {`${p.displayName}: ${p.startMarketSharePct.toFixed(2)}% → ${p.endMarketSharePct.toFixed(2)}% (${p.shareDeltaPp >= 0 ? "+" : ""}${p.shareDeltaPp.toFixed(2)}pp)`}
                </title>
              </line>
              {/* End-cap label for the larger AMCs only — top 7 by latest AUM */}
              {p.endMarketSharePct >= 2 && (
                <text
                  x={endX + 4}
                  y={ey}
                  dominantBaseline="middle"
                  fontSize="9"
                  fill="hsl(var(--foreground))"
                  className="tabular"
                >
                  {p.displayName}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
