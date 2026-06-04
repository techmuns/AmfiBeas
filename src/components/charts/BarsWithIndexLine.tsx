"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
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

interface BarsWithIndexLineProps {
  /** One entry per visible period. `line` is the secondary-axis value
   *  (index level, share %, etc.) — may be null for periods where it is
   *  unavailable (recharts renders a gap). */
  data: {
    label: string;
    value: number | null;
    line: number | null;
    /** Optional second right-axis series (e.g. a YoY-growth line drawn
     *  alongside the primary line). Null leaves a gap. */
    line2?: number | null;
  }[];
  height?: number;
  /** Fill for the bars. Defaults to chart-1. */
  barColor?: string;
  /** Stroke for the line overlay. Defaults to foreground. */
  lineColor?: string;
  /** Format for the bar values + left axis. */
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  /** Format for the line values (tooltip + right axis). */
  lineValueFormat?: ValueFormat;
  lineAxisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  /** Display names (tooltip + legend). */
  barName?: string;
  lineName?: string;
  /** Display name + stroke for the optional second line. */
  line2Name?: string;
  line2Color?: string;
  /** When set, fixes the right-axis domain (useful for share lines that
   *  should always render 0-100% scale even when values are tight). */
  lineDomain?: [number, number];
  /** Explicit tick positions for the right axis. Pair with a padded
   *  `lineDomain` so a capped line (e.g. a share that tops out at 100%)
   *  clears the top edge instead of riding it, while the tick labels stay
   *  clean (0 / 25 / 50 / 75 / 100). */
  lineTicks?: number[];
  showLegend?: boolean;
}

/**
 * Bar + overlay-line chart on dual y-axes. Used to render the IIFL
 * Figure 4 (active-equity flow bars + NIFTY 500 level line) and
 * Figure 6 (SIP flow bars + share-of-gross line) cards.
 *
 * The line is drawn ABOVE the bars so the index/share series remains
 * readable on top of any negative bar values. Null values on either
 * series leave a gap rather than spawning a fake 0.
 */
export function BarsWithIndexLine({
  data,
  height = 320,
  barColor = "hsl(var(--chart-1))",
  lineColor = "hsl(var(--foreground))",
  valueFormat = "cr",
  axisFormat = "cr",
  lineValueFormat = "count",
  lineAxisFormat = "count",
  labelFormat = "month",
  barName = "Value",
  lineName = "Line",
  line2Name = "Line 2",
  line2Color = "hsl(var(--foreground))",
  lineDomain,
  lineTicks,
  showLegend = true,
}: BarsWithIndexLineProps) {
  const fmtBarValue = valueFormatter(valueFormat);
  const fmtBarAxis = axisFormatter(axisFormat);
  const fmtLineValue = valueFormatter(lineValueFormat);
  const fmtLineAxis = axisFormatter(lineAxisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  const hasNegativeBar = data.some(
    (r) => typeof r.value === "number" && r.value < 0
  );
  const hasLine2 = data.some((r) => typeof r.line2 === "number");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
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
          tickFormatter={fmtBarAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={lineDomain}
          ticks={lineTicks}
          tickFormatter={fmtLineAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.4 }}
          content={
            <ChartTooltip
              formatValue={(n, seriesName) => {
                if (n === null || n === undefined || !Number.isFinite(n)) {
                  return "—";
                }
                if (seriesName === lineName || seriesName === line2Name)
                  return fmtLineValue(n);
                return fmtBarValue(n);
              }}
              labelFormatter={fmtLabel}
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
          name={barName}
          fill={barColor}
          fillOpacity={0.6}
          stroke={barColor}
          strokeOpacity={0.85}
          maxBarSize={28}
          isAnimationActive={false}
          radius={[2, 2, 0, 0]}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="line"
          name={lineName}
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          connectNulls={false}
        />
        {hasLine2 && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="line2"
            name={line2Name}
            stroke={line2Color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
