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
  /** dataKey for the trendline column (must exist in `data`). */
  key: string;
  /** Display label in legend / tooltip. */
  name: string;
  /** Stroke colour — defaults to foreground if omitted. */
  color?: string;
}

interface GroupedBarsProps {
  /** Cell values may be null — null cells render as a gap (preserves
   *  the "missing data" semantic the bar implementation had). */
  data: Record<string, string | number | null>[];
  xKey: string;
  /** Series specs. The prop name is kept as `bars` for back-compat
   *  with existing call sites; rendered as lines internally. */
  bars: BarSpec[];
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  showLegend?: boolean;
  /** When true, render small markers at each data point so individual
   *  periods are visible. Default true (quarterly windows are short). */
  showDots?: boolean;
  /** When true, derive a tight y-axis domain. Auto-disables when any
   *  series crosses zero, to preserve the zero crossing visually. */
  dynamicYDomain?: boolean;
  /** When true, render a y=0 reference line. Auto-enables when any
   *  series crosses zero. */
  zeroReference?: boolean;
  /** Optional dashed trendline overlays — typically a moving average
   *  per series. */
  trendlines?: TrendlineSpec[];
}

/**
 * Multi-line trend chart. Public API matches the legacy grouped-bars
 * implementation so call sites compile unchanged.
 *
 * - One line per `bars` entry.
 * - Legend and tooltip preserved.
 * - Auto zero reference + auto-disable dynamic domain when a series
 *   crosses zero (signed flows like Equity / Debt / Liquid).
 * - Optional dashed trendline overlays (e.g. 12M average lines).
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
  showDots = true,
  dynamicYDomain = true,
  zeroReference,
  trendlines,
}: GroupedBarsProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  // Collect all finite series values to decide zero-cross behaviour.
  const values: number[] = [];
  for (const row of data) {
    for (const b of bars) {
      const v = row[b.key];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
  }
  const crossesZero =
    values.length > 0 && Math.min(...values) < 0 && Math.max(...values) > 0;
  const hasNegative = values.length > 0 && Math.min(...values) < 0;
  const showZeroLine = zeroReference ?? hasNegative;

  let yDomain: [number | "auto", number | "auto"] | undefined;
  if (dynamicYDomain && !crossesZero && values.length > 0) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const pad = Math.max(range * 0.1, range === 0 ? Math.abs(max) * 0.05 || 1 : 0);
    yDomain = [min - pad, max + pad];
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
            <ChartTooltip formatValue={(n) => fmtValue(n)} labelFormatter={fmtLabel} />
          }
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="circle"
            iconSize={8}
          />
        )}
        {showZeroLine && (
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.6} />
        )}
        {bars.map((b) => (
          <Line
            key={b.key}
            type="monotone"
            dataKey={b.key}
            name={b.name}
            stroke={b.color}
            strokeWidth={2}
            dot={showDots ? { r: 2.5, fill: b.color, strokeWidth: 0 } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
        {trendlines?.map((t) => (
          <Line
            key={t.key}
            type="monotone"
            dataKey={t.key}
            name={t.name}
            stroke={t.color ?? "hsl(var(--foreground))"}
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
