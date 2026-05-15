"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface RankPoint {
  quarter: string;
  rank: number;
}

interface RankTrendChartProps {
  data: RankPoint[];
  height?: number;
}

/** AMC Rank Trend chart with **tier-band shading**:
 *
 *   - Top 7 (rank 1-7)   — green band ("Leaders")
 *   - Mid (8-15)          — neutral band
 *   - Long tail (16+)     — muted band
 *
 * Y-axis is inverted (lower rank number = larger AMC, plotted higher).
 * The rank line is drawn over the bands so the reader sees the AMC's
 * tier journey at a glance. */
export function RankTrendChart({ data, height = 240 }: RankTrendChartProps) {
  // Auto-pick a sensible y-domain — anchor at 1 and extend below the
  // worst rank in the series with a small padding band.
  const ranks = data.map((d) => d.rank);
  const worstRank = ranks.length > 0 ? Math.max(...ranks) : 30;
  const yMax = Math.max(worstRank + 2, 20);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        {/* Tier bands. ReferenceArea is drawn beneath everything. */}
        <ReferenceArea
          y1={1}
          y2={7}
          fill="hsl(var(--positive))"
          fillOpacity={0.1}
          stroke="none"
        />
        <ReferenceArea
          y1={7}
          y2={15}
          fill="hsl(var(--muted-foreground))"
          fillOpacity={0.08}
          stroke="none"
        />
        <ReferenceArea
          y1={15}
          y2={yMax}
          fill="hsl(var(--muted-foreground))"
          fillOpacity={0.03}
          stroke="none"
        />
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="quarter"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          reversed
          domain={[1, yMax]}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(v) => `#${v}`}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as RankPoint;
            const tier =
              p.rank <= 7 ? "Top 7" : p.rank <= 15 ? "Tier 2 (8-15)" : "Long tail (16+)";
            return (
              <div className="rounded-md border bg-background p-2 text-[11px] shadow-sm">
                <div className="font-medium">{p.quarter}</div>
                <div className="tabular text-muted-foreground">Rank #{p.rank}</div>
                <div className="text-[10px]">{tier}</div>
              </div>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="rank"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          dot={{ r: 2.5, fill: "hsl(var(--chart-1))", strokeWidth: 0 }}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
