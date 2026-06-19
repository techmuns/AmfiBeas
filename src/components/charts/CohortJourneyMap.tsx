"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { fmtBps } from "@/lib/units";

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

const toneOf = (dpp: number) =>
  dpp > 0.1
    ? "hsl(var(--positive))"
    : dpp < -0.1
      ? "hsl(var(--negative))"
      : "hsl(var(--muted-foreground))";

const markerOf = (dpp: number) =>
  dpp > 0.1
    ? "url(#arrow-up)"
    : dpp < -0.1
      ? "url(#arrow-down)"
      : "url(#arrow-flat)";

/**
 * Market-share movement as a rank "bump" chart. Each AMC is a line
 * between its league-table rank (by market share) at the earliest
 * quarter and at the latest quarter:
 *   - y-axis: rank, 1 = largest share at the top
 *   - line tail: rank at the EARLIEST quarter on record
 *   - line head (arrow): rank at the LATEST quarter
 *   - colour: green = share gainer, red = share loser, grey = flat
 *
 * Ranking the y-axis gives every AMC its own evenly-spaced row, so the
 * long tail of small AMCs no longer collapses into one unreadable band
 * the way it did on an absolute-share axis. End labels are de-collided
 * (nudged to a minimum gap, with a leader line back to the true rank)
 * so they never stack.
 */
export function CohortJourneyMap({
  points,
  height = 340,
  className,
}: CohortJourneyMapProps) {
  const model = useMemo(() => {
    if (points.length === 0) return null;
    const padding = { top: 28, bottom: 32, left: 44, right: 150 };
    const vw = 880;
    const innerW = vw - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const n = points.length;

    // League-table ranks by share at each end (1 = largest share).
    const startRank = new Map(
      [...points]
        .sort((a, b) => b.startMarketSharePct - a.startMarketSharePct)
        .map((p, i) => [p.amcSlug, i + 1])
    );
    const endRank = new Map(
      [...points]
        .sort((a, b) => b.endMarketSharePct - a.endMarketSharePct)
        .map((p, i) => [p.amcSlug, i + 1])
    );

    const yScale = (rank: number) =>
      padding.top + ((rank - 1) / Math.max(1, n - 1)) * innerH;
    const startX = padding.left + 12;
    const endX = padding.left + innerW - 12;

    // De-collide end labels: order by their true rank-y, push each down
    // to a minimum gap, then clamp the cluster back inside the plot if it
    // overflows the bottom. A leader line is drawn whenever a label is
    // nudged off its true position.
    const minGap = 12;
    const maxY = padding.top + innerH;
    const labels = points
      .map((p) => ({ p, trueY: yScale(endRank.get(p.amcSlug) as number), y: 0 }))
      .sort((a, b) => a.trueY - b.trueY);
    let lastY = -Infinity;
    for (const it of labels) {
      it.y = Math.max(it.trueY, lastY + minGap);
      lastY = it.y;
    }
    if (labels.length && labels[labels.length - 1].y > maxY) {
      let limit = maxY;
      for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].y > limit) labels[i].y = limit;
        limit = labels[i].y - minGap;
      }
    }

    // Rank ticks for the left axis (always show #1 and the last rank).
    const rankTicks = Array.from(
      new Set([1, ...[5, 10, 15, 20].filter((r) => r < n), n])
    ).sort((a, b) => a - b);

    return {
      vw,
      padding,
      innerH,
      startRank,
      endRank,
      yScale,
      startX,
      endX,
      labels,
      rankTicks,
    };
  }, [points, height]);

  if (!model || points.length === 0) return null;
  const {
    vw,
    padding,
    innerH,
    startRank,
    endRank,
    yScale,
    startX,
    endX,
    labels,
    rankTicks,
  } = model;

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg viewBox={`0 0 ${vw} ${height}`} className="block w-full" style={{ minWidth: 600 }}>
        {/* Y-axis: rank rows (1 = largest share, at the top) */}
        <text
          x={padding.left - 6}
          y={padding.top - 13}
          textAnchor="end"
          fontSize="9.5"
          fill="hsl(var(--muted-foreground))"
        >
          Rank
        </text>
        {rankTicks.map((r) => (
          <g key={r}>
            <line
              x1={padding.left}
              x2={vw - padding.right}
              y1={yScale(r)}
              y2={yScale(r)}
              stroke="hsl(var(--border))"
              strokeDasharray="2 3"
              strokeWidth={0.5}
            />
            <text
              x={padding.left - 6}
              y={yScale(r)}
              dominantBaseline="middle"
              textAnchor="end"
              fontSize="10"
              fill="hsl(var(--muted-foreground))"
              className="tabular"
            >
              {`#${r}`}
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

        {/* Arrow definitions for gainers / losers / flat */}
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

        {/* Per-AMC rank journeys */}
        {points.map((p) => {
          const sr = startRank.get(p.amcSlug) as number;
          const er = endRank.get(p.amcSlug) as number;
          const sy = yScale(sr);
          const ey = yScale(er);
          return (
            <line
              key={p.amcSlug}
              x1={startX}
              y1={sy}
              x2={endX}
              y2={ey}
              stroke={toneOf(p.shareDeltaPp)}
              strokeOpacity={0.55}
              strokeWidth={1.6}
              markerEnd={markerOf(p.shareDeltaPp)}
            >
              <title>
                {`${p.displayName}: rank #${sr} → #${er} · ${p.startMarketSharePct.toFixed(2)}% → ${p.endMarketSharePct.toFixed(2)}% (${fmtBps(p.shareDeltaPp)})`}
              </title>
            </line>
          );
        })}

        {/* De-collided end labels, one per AMC, with a leader line back to
            the true rank position when nudged. */}
        {labels.map(({ p, trueY, y }) => {
          const labelX = endX + 14;
          const nudged = Math.abs(y - trueY) > 0.5;
          return (
            <g key={`lbl-${p.amcSlug}`}>
              {nudged && (
                <polyline
                  points={`${endX + 7},${trueY} ${labelX - 3},${y}`}
                  fill="none"
                  stroke={toneOf(p.shareDeltaPp)}
                  strokeOpacity={0.4}
                  strokeWidth={0.5}
                />
              )}
              <text
                x={labelX}
                y={y}
                dominantBaseline="middle"
                fontSize="9"
                fill="hsl(var(--foreground))"
                className="tabular"
              >
                {p.displayName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
