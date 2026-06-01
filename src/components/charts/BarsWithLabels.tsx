"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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

interface BarsWithLabelsProps {
  data: { label: string; value: number }[];
  height?: number;
  barColor?: string;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  name?: string;
  /** Format used for the in-chart value labels above each bar. Defaults
   *  to a 1-decimal-place renderer that matches Figure 7's "94.4" style.
   *  Set to a different `ValueFormat` (e.g. "cr") to align with the
   *  series' unit. */
  labelValueFormat?: ValueFormat;
}

/**
 * Simple bar series with a value label printed above each bar — the IIFL
 * Figure 7 style. No second axis, no overlay; just bars with their
 * numbers shown. Useful for relatively short series (≤ 20 points) where
 * each bar's value carries the read.
 */
export function BarsWithLabels({
  data,
  height = 300,
  barColor = "hsl(var(--chart-1))",
  valueFormat = "count",
  axisFormat = "count",
  labelFormat = "month",
  name = "Value",
  labelValueFormat,
}: BarsWithLabelsProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);
  const fmtBarLabel = labelValueFormat
    ? valueFormatter(labelValueFormat)
    : valueFormatter(valueFormat);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 24, right: 16, left: 0, bottom: 0 }}
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
          minTickGap={20}
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
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.4 }}
          content={
            <ChartTooltip
              formatValue={(n) => {
                if (n === null || n === undefined || !Number.isFinite(n)) {
                  return "—";
                }
                return fmtValue(n);
              }}
              labelFormatter={fmtLabel}
            />
          }
        />
        <Bar
          dataKey="value"
          name={name}
          fill={barColor}
          fillOpacity={0.85}
          maxBarSize={48}
          isAnimationActive={false}
          radius={[2, 2, 0, 0]}
        >
          <LabelList
            dataKey="value"
            position="top"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) ? fmtBarLabel(v) : ""
            }
            style={{
              fill: "hsl(var(--foreground))",
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
