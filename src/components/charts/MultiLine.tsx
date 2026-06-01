"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

export interface LineSpec {
  key: string;
  name: string;
  color: string;
}

interface MultiLineProps {
  data: Record<string, string | number | null>[];
  xKey: string;
  lines: LineSpec[];
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  showLegend?: boolean;
  /** When true, render small markers at each data point so individual
   *  quarters/months are visible on the line. Useful on financial
   *  margin charts where readers want to read specific period values. */
  showDots?: boolean;
  /** When true, derive a tight y-axis domain from the data with a
   *  small padding band so narrow-range percent series don't render
   *  as a near-flat line. Pure presentation — data is unchanged. */
  dynamicYDomain?: boolean;
  /** When true, the hover tooltip ranks the series by value at the
   *  hovered point — highest at the top, lowest at the bottom — instead
   *  of following the line declaration order. */
  sortTooltipDesc?: boolean;
}

export function MultiLine({
  data,
  xKey,
  lines,
  height = 280,
  valueFormat = "count",
  axisFormat = "count",
  labelFormat = "quarter",
  showLegend = true,
  showDots = false,
  dynamicYDomain = false,
  sortTooltipDesc = false,
}: MultiLineProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  // Compute a padded y-axis domain from the rendered series. The
  // padding band is 10% of the visible range with a minimum so a
  // single-quarter series still renders cleanly.
  let yDomain: [number | "auto", number | "auto"] | undefined;
  if (dynamicYDomain) {
    const values: number[] = [];
    for (const row of data) {
      for (const l of lines) {
        const v = row[l.key];
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
      }
    }
    if (values.length > 0) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min;
      const pad = Math.max(range * 0.1, range === 0 ? Math.abs(max) * 0.05 || 1 : 0);
      yDomain = [min - pad, max + pad];
    }
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickFormatter={fmtLabel}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tickFormatter={fmtAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
          domain={yDomain}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={
            <ChartTooltip
              formatValue={(n) => fmtValue(n)}
              labelFormatter={fmtLabel}
              sortByValueDesc={sortTooltipDesc}
            />
          }
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="circle"
            iconSize={8}
          />
        )}
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            strokeWidth={2}
            dot={showDots ? { r: 2.5, fill: l.color, strokeWidth: 0 } : false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
