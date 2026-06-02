"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import {
  type AxisFormat,
  type ValueFormat,
  axisFormatter,
  valueFormatter,
} from "./format";

export interface HBarRow {
  /** Category label drawn on the y-axis (e.g. an AMC short name). */
  label: string;
  /** The metric value for this row. Null rows are dropped by the caller. */
  value: number | null;
  /** Per-bar fill (one colour per AMC). */
  color: string;
}

interface HorizontalBarsProps {
  /** Pre-sorted rows (caller decides the order, usually value-descending). */
  data: HBarRow[];
  /** Series name shown in the tooltip row (the active KPI). */
  seriesName?: string;
  /** Value format for the tooltip + the value label drawn at each bar end. */
  valueFormat?: ValueFormat;
  /** Axis format for the x-axis ticks. */
  axisFormat?: AxisFormat;
  height?: number;
  barSize?: number;
}

/**
 * Single-metric horizontal bar chart — one bar per category (AMC), each
 * tinted with its own colour. Used by the /amc Compare tab to rank the
 * listed AMCs on whichever KPI is selected. Recharts `layout="vertical"`
 * puts the category on the y-axis and the value on the x-axis.
 */
export function HorizontalBars({
  data,
  seriesName = "Value",
  valueFormat = "cr",
  axisFormat = "cr",
  height,
  barSize = 22,
}: HorizontalBarsProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  // Height scales with the number of bars so spacing stays even whether the
  // chart shows 4 listed AMCs or all of them.
  const resolvedHeight = height ?? Math.max(170, data.length * 40 + 36);
  const hasNegative = data.some(
    (d) => typeof d.value === "number" && d.value < 0
  );

  return (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 64, left: 8, bottom: 4 }}
        barCategoryGap="24%"
      >
        <CartesianGrid
          stroke="hsl(var(--border))"
          horizontal={false}
          strokeDasharray="3 3"
        />
        <XAxis
          type="number"
          tickFormatter={fmtAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={68}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.35 }}
          content={<ChartTooltip formatValue={(n) => fmtValue(n)} />}
        />
        {hasNegative && (
          <ReferenceLine
            x={0}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.6}
          />
        )}
        <Bar
          dataKey="value"
          name={seriesName}
          maxBarSize={barSize}
          isAnimationActive={false}
          radius={[0, 2, 2, 0]}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} fillOpacity={0.9} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) ? fmtValue(v) : ""
            }
            style={{
              fill: "hsl(var(--foreground))",
              fontSize: 10.5,
              fontWeight: 600,
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
