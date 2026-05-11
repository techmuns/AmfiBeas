"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
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

interface BarSeriesProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  name?: string;
  /**
   * Optional horizontal reference line. Set when callers want to
   * overlay a trailing-N-month average, target, or threshold on top
   * of the bar series. `referenceLabel` renders inline on the line.
   * Omit `referenceValue` to disable.
   */
  referenceValue?: number | null;
  referenceLabel?: string;
}

export function BarSeries({
  data,
  height = 240,
  color = "hsl(var(--chart-2))",
  valueFormat = "cr",
  axisFormat = "cr",
  labelFormat = "month",
  name = "Value",
  referenceValue,
  referenceLabel,
}: BarSeriesProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);
  const hasRef =
    typeof referenceValue === "number" && Number.isFinite(referenceValue);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
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
        <Bar dataKey="value" name={name} fill={color} radius={[3, 3, 0, 0]} />
        {hasRef && (
          <ReferenceLine
            y={referenceValue as number}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            label={
              referenceLabel
                ? {
                    value: referenceLabel,
                    position: "right",
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }
                : undefined
            }
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
