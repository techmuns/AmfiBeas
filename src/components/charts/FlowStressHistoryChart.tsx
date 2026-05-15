"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface FlowStressPoint {
  month: string;
  drawdownPct: number;
  flowValue: number;
  flowPercentile: number;
  label: "Normal" | "Buy-the-dip flow" | "Flow stress" | "Insufficient history";
}

interface FlowStressHistoryChartProps {
  data: FlowStressPoint[];
  height?: number;
}

const POSITIVE_COLOR = "hsl(var(--positive))";
const NEGATIVE_COLOR = "hsl(var(--negative))";

function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  const idx = Number(mm) - 1;
  const abbrev = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][idx] ?? mm;
  return `${abbrev} '${y.slice(2)}`;
}

interface MarkerProps {
  cx?: number;
  cy?: number;
  payload?: FlowStressPoint;
  fill?: string;
}

function EventDot({ cx, cy, payload, fill }: MarkerProps) {
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill={fill}
      stroke="hsl(var(--background))"
      strokeWidth={1.5}
    />
  );
}

/** Historical Flow Stress timeline.
 *
 *  - A line series traces Nifty 500 drawdown % vs the rolling all-time
 *    high over the full available history.
 *  - Two scatter overlays mark every month where the Market Stress
 *    Flow rule fired: green dots for "Buy-the-dip flow", red dots for
 *    "Flow stress".
 *
 *  No predictive overlay. The rule + thresholds live in the parent
 *  card's InfoTooltip — this chart is the historical track record. */
export function FlowStressHistoryChart({
  data,
  height = 220,
}: FlowStressHistoryChartProps) {
  const buyDip = data
    .filter((d) => d.label === "Buy-the-dip flow")
    .map((d) => ({ ...d }));
  const stress = data
    .filter((d) => d.label === "Flow stress")
    .map((d) => ({ ...d }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid
          stroke="hsl(var(--border))"
          vertical={false}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="month"
          tickFormatter={monthLabel}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={36}
        />
        <YAxis
          tickFormatter={(v) => `${v.toFixed(0)}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={42}
          domain={["dataMin", 0]}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as FlowStressPoint;
            return (
              <div className="rounded-md border bg-background p-2 text-[11px] shadow-sm">
                <div className="font-medium">{monthLabel(p.month)}</div>
                <div className="tabular text-muted-foreground">
                  Drawdown {p.drawdownPct.toFixed(2)}%
                </div>
                <div className="tabular text-muted-foreground">
                  Flow percentile {p.flowPercentile.toFixed(0)}th
                </div>
                <div className="mt-1 text-[10px]">{p.label}</div>
              </div>
            );
          }}
        />
        <ReferenceLine y={-10} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
        <Line
          type="monotone"
          dataKey="drawdownPct"
          stroke="hsl(var(--chart-1))"
          strokeWidth={1.6}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Scatter
          data={buyDip}
          dataKey="drawdownPct"
          fill={POSITIVE_COLOR}
          shape={(props: unknown) => (
            <EventDot {...(props as MarkerProps)} fill={POSITIVE_COLOR} />
          )}
        />
        <Scatter
          data={stress}
          dataKey="drawdownPct"
          fill={NEGATIVE_COLOR}
          shape={(props: unknown) => (
            <EventDot {...(props as MarkerProps)} fill={NEGATIVE_COLOR} />
          )}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
