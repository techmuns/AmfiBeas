"use client";

import {
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
  /** Cell values may be null — Recharts skips null points so the
   *  x-axis can render a fixed window with gaps for missing data. */
  data: Record<string, string | number | null>[];
  xKey: string;
  bars: BarSpec[];
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  showLegend?: boolean;
  /** Optional dotted-line overlays (e.g. trailing-N moving averages). */
  trendlines?: TrendlineSpec[];
  /** When true, render a horizontal y=0 reference line so signed
   *  series read inflow-vs-outflow without scanning the y-axis. */
  zeroReference?: boolean;
}

/**
 * Multi-series trend renderer. Draws one continuous line per `bars[]`
 * entry plus optional dotted trendline overlays. Reads as a clean
 * multi-line trend chart, not a grouped column chart — no bar fills.
 */
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
  zeroReference,
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
          cursor={{ stroke: "hsl(var(--border))" }}
          content={
            <ChartTooltip formatValue={(n) => fmtValue(n)} labelFormatter={fmtLabel} />
          }
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="plainline"
            iconSize={14}
          />
        )}
        {zeroReference && (
          <ReferenceLine
            y={0}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1}
            strokeOpacity={0.5}
          />
        )}
        {bars.map((b) => (
          <Line
            key={b.key}
            type="monotone"
            dataKey={b.key}
            name={b.name}
            stroke={b.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
            connectNulls={false}
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
