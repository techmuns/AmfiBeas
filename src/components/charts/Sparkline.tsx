"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  YAxis,
} from "recharts";

interface SparklineProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}

/** Minimal sparkline — no axes, no tooltip, no legend. Used inside
 *  the Investor Signals tiles to give each metric 24 months of visual
 *  context without claiming chart real-estate. Y-axis domain is
 *  derived from the data with a small padding band so a near-flat
 *  series still shows movement. */
export function Sparkline({
  data,
  color = "hsl(var(--chart-1))",
  height = 36,
}: SparklineProps) {
  // useId must be called unconditionally before any early returns.
  const rawId = useId();
  if (data.length === 0) return null;
  const values = data.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = range > 0 ? range * 0.15 : Math.max(Math.abs(max) * 0.1, 1);
  const domain: [number, number] = [min - pad, max + pad];
  const id = `spark${rawId.replace(/:/g, "-")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={domain} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${id})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
