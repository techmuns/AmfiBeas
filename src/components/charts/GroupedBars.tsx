"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

export interface BarSpec {
  key: string;
  name: string;
  color: string;
}

export interface TrendlineSpec {
  /** Data key under which the trendline values will be merged into
   *  the chart data. Must not collide with any `bars[].key`. */
  key: string;
  name: string;
  color: string;
  /** Trendline values aligned to the `xKey`-keyed labels of `data`.
   *  Rows without a matching label are silently skipped. */
  data: { label: string; value: number | null }[];
}

interface GroupedBarsProps {
  /** Cell values may be null — Recharts skips null bars so chart x-axes
   *  can render a fixed-window x-axis with gaps for missing data. */
  data: Record<string, string | number | null>[];
  xKey: string;
  bars: BarSpec[];
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  showLegend?: boolean;
  /** Optional dashed-line overlays. Backward-compatible: when undefined
   *  the chart renders identically to before. */
  trendlines?: TrendlineSpec[];
}

export function GroupedBars({
  data,
  xKey,
  bars,
  height = 300,
  valueFormat = "cr",
  axisFormat = "cr",
  labelFormat = "quarter",
  showLegend = true,
  trendlines,
}: GroupedBarsProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  // Merge trendline values into the chart data by xKey-label match.
  const merged =
    trendlines && trendlines.length > 0
      ? data.map((row) => {
          const out: Record<string, string | number | null> = { ...row };
          const xLabel = row[xKey];
          for (const tl of trendlines) {
            const match = tl.data.find((p) => p.label === xLabel);
            out[tl.key] = match ? match.value : null;
          }
          return out;
        })
      : data;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={merged} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickFormatter={fmtLabel}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={fmtAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
          content={
            <ChartTooltip formatValue={(n) => fmtValue(n)} labelFormatter={fmtLabel} />
          }
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="square"
            iconSize={8}
          />
        )}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.color}
            radius={[3, 3, 0, 0]}
          />
        ))}
        {trendlines?.map((tl) => (
          <Line
            key={tl.key}
            type="monotone"
            dataKey={tl.key}
            name={tl.name}
            stroke={tl.color}
            strokeWidth={1.6}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
