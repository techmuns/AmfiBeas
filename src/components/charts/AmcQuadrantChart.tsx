"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface QuadrantPoint {
  slug: string;
  displayName: string;
  marketSharePct: number;
  qoqGrowthPct: number;
  avgAum: number;
  quadrant: "Leaders" | "Gainers" | "Defenders" | "Laggards";
}

interface AmcQuadrantChartProps {
  data: QuadrantPoint[];
  medianSharePct: number;
  medianGrowthPct: number;
  height?: number;
}

const COLOR: Record<QuadrantPoint["quadrant"], string> = {
  Leaders: "hsl(var(--positive))",
  Gainers: "hsl(var(--chart-1))",
  Defenders: "hsl(var(--chart-3))",
  Laggards: "hsl(var(--negative))",
};

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: QuadrantPoint;
}

function QuadrantDot({ cx, cy, payload }: DotProps) {
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
  const r = Math.max(3, Math.min(10, Math.sqrt(payload.marketSharePct) * 2.4));
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={COLOR[payload.quadrant]}
        fillOpacity={0.55}
        stroke={COLOR[payload.quadrant]}
        strokeWidth={1.2}
      />
    </g>
  );
}

/** 2×2 quadrant chart: x = QoQ AAUM growth %, y = market share %.
 *  Reference lines are the cohort medians, splitting the canvas into
 *  Leaders / Gainers / Defenders / Laggards. Dot size scales with
 *  market share for an extra visual layer. */
export function AmcQuadrantChart({
  data,
  medianSharePct,
  medianGrowthPct,
  height = 360,
}: AmcQuadrantChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="qoqGrowthPct"
          name="QoQ growth"
          tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="number"
          dataKey="marketSharePct"
          name="Market share"
          tickFormatter={(v) => `${v.toFixed(1)}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ReferenceLine
          x={medianGrowthPct}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="4 3"
          label={{
            value: "median growth",
            fontSize: 10,
            fill: "hsl(var(--muted-foreground))",
            position: "top",
          }}
        />
        <ReferenceLine
          y={medianSharePct}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="4 3"
          label={{
            value: "median share",
            fontSize: 10,
            fill: "hsl(var(--muted-foreground))",
            position: "right",
          }}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as QuadrantPoint;
            return (
              <div className="rounded-md border bg-background p-2 text-[11px] shadow-sm">
                <div className="font-semibold">{p.displayName}</div>
                <div className="tabular text-muted-foreground">
                  Share {p.marketSharePct.toFixed(2)}%
                </div>
                <div className="tabular text-muted-foreground">
                  QoQ {p.qoqGrowthPct >= 0 ? "+" : ""}
                  {p.qoqGrowthPct.toFixed(2)}%
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide">
                  {p.quadrant}
                </div>
              </div>
            );
          }}
        />
        <Scatter data={data} shape={QuadrantDot as never} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
