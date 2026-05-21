"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import {
  type AxisFormat,
  type LabelFormat,
  type ValueFormat,
  axisFormatter,
  labelFormatter,
  valueFormatter,
} from "./format";

interface BarsWithGrowthProps {
  /** One entry per visible period. `growthPct` is the YoY / QoQ growth
   *  for that period — null when the lookback is shorter than the lag
   *  (e.g. first 12 months for monthly YoY). Recharts handles null
   *  natively by drawing a gap in the line. */
  data: { label: string; value: number; growthPct: number | null }[];
  height?: number;
  /** Soft, single fill for the bars. Defaults to chart-2. */
  barColor?: string;
  /** Muted line stroke for the growth overlay. Defaults to foreground. */
  growthColor?: string;
  /** Format for the primary bar values + left axis. */
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  /** Bar series display name (tooltip). */
  name?: string;
  /** Growth-line display name (tooltip + right-axis title). Pass
   *  "YoY %" for monthly cards, "QoQ %" or "YoY %" for quarterly. */
  growthLabel?: string;
}

/**
 * Optional bar + growth-line renderer used by the "Bars + Growth" chart
 * mode on the three approved net-flow cards (monthly + quarterly Equity
 * net flows, monthly Active Equity net inflow).
 *
 * Renders:
 *  - Soft bars for the actual value on the primary (left) y-axis.
 *  - A thin secondary line for YoY / QoQ growth on the right y-axis,
 *    with gaps where growth is null (no fake early-period values).
 *  - No moving-average overlay — the bar mode explicitly drops the
 *    12M average dotted line.
 *
 * This is the only place recharts `<Bar>` is used in the codebase.
 */
export function BarsWithGrowth({
  data,
  height = 300,
  barColor = "hsl(var(--chart-2))",
  growthColor = "hsl(var(--foreground))",
  valueFormat = "cr",
  axisFormat = "cr",
  labelFormat = "month",
  name = "Value",
  growthLabel = "YoY %",
}: BarsWithGrowthProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  // Render to a shape ComposedChart consumes; keep both fields top
  // level so Tooltip rows can be formatted independently.
  const rows = data.map((p) => ({
    label: p.label,
    value: p.value,
    growthPct: p.growthPct,
  }));

  const hasNegativeBar = rows.some((r) => r.value < 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={rows}
        margin={{ top: 8, right: 28, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          stroke="hsl(var(--border))"
          vertical={false}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="label"
          tickFormatter={fmtLabel}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(n) => `${n}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.4 }}
          content={
            <ChartTooltip
              formatValue={(n, key) => {
                if (key === "growthPct") {
                  if (n === null || n === undefined || !Number.isFinite(n)) {
                    return "—";
                  }
                  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
                }
                return fmtValue(n);
              }}
              labelFormatter={fmtLabel}
            />
          }
        />
        {hasNegativeBar && (
          <ReferenceLine
            yAxisId="left"
            y={0}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.6}
          />
        )}
        <Bar
          yAxisId="left"
          dataKey="value"
          name={name}
          fill={barColor}
          fillOpacity={0.55}
          stroke={barColor}
          strokeOpacity={0.8}
          maxBarSize={28}
          isAnimationActive={false}
          radius={[2, 2, 0, 0]}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="growthPct"
          name={growthLabel}
          stroke={growthColor}
          strokeWidth={1.6}
          strokeDasharray="4 3"
          dot={{ r: 2.5, fill: growthColor, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          connectNulls={false}
        />
        <ReferenceLine
          yAxisId="right"
          y={0}
          stroke="hsl(var(--muted-foreground))"
          strokeOpacity={0.3}
          strokeDasharray="2 2"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
