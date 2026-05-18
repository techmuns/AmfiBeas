"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import { type LabelFormat, labelFormatter } from "./format";

export interface SeriesSpec {
  key: string;
  name: string;
  color: string;
}

interface StackedAreaProps {
  data: Record<string, string | number>[];
  xKey: string;
  series: SeriesSpec[];
  height?: number;
  showLegend?: boolean;
  /** Tick / tooltip label formatter. Defaults to "month" so existing
   *  /monthly demo cards keep their YYYY-MM → "Mar '26" rendering.
   *  Quarterly market-share cards pass "none" because their xKey is
   *  already a display label like "4QFY26". */
  labelFormat?: LabelFormat;
  /**
   * When true, render tooltip rows top-to-bottom in stack order (i.e.
   * reverse the default Recharts payload order). Use for the AUM
   * Market Share cards where the top visual layer (Others) should
   * appear first in the tooltip and the bottom layer (largest AMC)
   * last — matching how the eye reads the stack.
   */
  reverseTooltipOrder?: boolean;
}

export function StackedArea({
  data,
  xKey,
  series,
  height = 300,
  showLegend = true,
  labelFormat = "month",
  reverseTooltipOrder = false,
}: StackedAreaProps) {
  const fmtLabel = labelFormatter(labelFormat);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickFormatter={fmtLabel}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v) => `${v}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={
            <ChartTooltip
              formatValue={(n) => `${n.toFixed(2)}%`}
              labelFormatter={fmtLabel}
              reverseOrder={reverseTooltipOrder}
            />
          }
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="square"
            iconSize={8}
          />
        )}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stackId="share"
            stroke={s.color}
            strokeWidth={1}
            fill={s.color}
            fillOpacity={0.85}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
