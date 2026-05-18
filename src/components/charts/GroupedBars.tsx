"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
}: GroupedBarsProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
      </BarChart>
    </ResponsiveContainer>
  );
}
