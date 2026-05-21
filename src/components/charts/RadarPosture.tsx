"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ChartTooltip } from "./Tooltip";

/**
 * 5-axis posture radar. Each series is one AMC. Each axis is one
 * strategic dimension (digital maturity, geographic depth, channel
 * diversity, pipeline breadth, cohort breadth), already mapped to a
 * 0–100 score by `amcPostureScores()` in `src/data/amc-narratives.ts`.
 *
 * Renders all 5 axes regardless of data presence; missing values are
 * passed as `null` and recharts plots them as a gap (radial chart still
 * shows the grid). The radar handles 1-2 overlaid series.
 */

export interface RadarSeries {
  /** Display name shown in tooltip. */
  name: string;
  /** Score 0-100 per axis. `null` = not disclosed. */
  values: Record<string, number | null>;
  /** Visual stroke + 25%-opacity fill. */
  color: string;
}

interface RadarPostureProps {
  axes: ReadonlyArray<{ key: string; label: string }>;
  series: RadarSeries[];
  /** Set the visible range. Default [0, 100]. */
  domain?: [number, number];
  height?: number;
}

export function RadarPosture({
  axes,
  series,
  domain = [0, 100],
  height = 320,
}: RadarPostureProps) {
  // Recharts wants data shaped as one row per axis with one numeric
  // field per series. Each row holds the axis label + per-series score.
  const data = axes.map((a) => {
    const row: Record<string, string | number | null> = { axis: a.label };
    for (const s of series) {
      row[s.name] = s.values[a.key] ?? null;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="78%">
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
        />
        <PolarRadiusAxis
          domain={domain}
          stroke="hsl(var(--muted-foreground))"
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickCount={5}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
          content={
            <ChartTooltip
              formatValue={(n) => {
                if (n === null || n === undefined || !Number.isFinite(n)) {
                  return "—";
                }
                return `${Math.round(n)} / 100`;
              }}
            />
          }
        />
        {series.map((s) => (
          <Radar
            key={s.name}
            name={s.name}
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            fill={s.color}
            fillOpacity={0.25}
            isAnimationActive={false}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
