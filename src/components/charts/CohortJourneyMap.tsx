"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";

interface DriftPoint {
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
  /** Optional rank change over the same window (positive = climbed). */
  rankChange?: number | null;
  /** Optional AAUM change over the same window (₹ Cr, signed). */
  aumChange?: number | null;
}

interface CohortJourneyMapProps {
  points: DriftPoint[];
  height?: number;
  className?: string;
}

/**
 * AMC Market-Share Drift. Each AMC is drawn as a line from its
 * earliest-quarter market share to its latest, on a vertical
 * percentage axis. Colour: green = share gain, red = share loss,
 * grey = roughly flat (|Δ| ≤ 2 bps).
 */
export function CohortJourneyMap({
  points,
  height = 340,
  className,
}: CohortJourneyMapProps) {
  const layout = useMemo(() => {
    if (points.length === 0) return null;
    const padding = { top: 24, bottom: 32, left: 60, right: 140 };
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

  const ticks: number[] = [];
  const tickStep = yMax > 5 ? Math.ceil(yMax / 5) : 1;
  for (let v = 0; v <= yMax; v += tickStep) ticks.push(v);

  // Flat band: |Δ| ≤ 2 bps = 0.02 pp.
  const FLAT_PP = 0.02;
  const tone = (deltaPp: number) =>
    deltaPp > FLAT_PP
      ? "hsl(var(--positive))"
      : deltaPp < -FLAT_PP
        ? "hsl(var(--negative))"
        : "hsl(var(--muted-foreground))";
  const marker = (deltaPp: number) =>
    deltaPp > FLAT_PP
      ? "url(#drift-up)"
      : deltaPp < -FLAT_PP
        ? "url(#drift-down)"
        : "url(#drift-flat)";

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${vw} ${height}`}
        className="block w-full"
        style={{ minWidth: 600 }}
        aria-label="AMC market-share drift between two quarters"
      >
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

        <defs>
          <marker
            id="drift-up"
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
            id="drift-down"
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
            id="drift-flat"
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

        {points.map((p) => {
          const sy = yScale(p.startMarketSharePct);
          const ey = yScale(p.endMarketSharePct);
          const stroke = tone(p.shareDeltaPp);
          const bpsDelta = p.shareDeltaPp * 100;
          const tooltipParts = [
            p.displayName,
            `${p.startMarketSharePct.toFixed(2)}% → ${p.endMarketSharePct.toFixed(2)}%`,
            `Δ ${bpsDelta >= 0 ? "+" : ""}${bpsDelta.toFixed(0)} bps`,
          ];
          if (typeof p.rankChange === "number" && p.rankChange !== 0) {
            tooltipParts.push(
              `Rank ${p.rankChange > 0 ? "▲" : "▼"}${Math.abs(p.rankChange)}`
            );
          }
          if (typeof p.aumChange === "number" && Number.isFinite(p.aumChange)) {
            tooltipParts.push(
              `AAUM ${p.aumChange >= 0 ? "+" : "−"}₹${Math.abs(p.aumChange / 1000).toFixed(1)}K Cr`
            );
          }
          return (
            <g key={p.amcSlug}>
              <line
                x1={startX}
                y1={sy}
                x2={endX}
                y2={ey}
                stroke={stroke}
                strokeOpacity={0.6}
                strokeWidth={1.7}
                markerEnd={marker(p.shareDeltaPp)}
              >
                <title>{tooltipParts.join(" · ")}</title>
              </line>
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
