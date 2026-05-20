"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
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
   * of the series. `referenceLabel` renders inline on the line.
   * Omit `referenceValue` to disable.
   */
  referenceValue?: number | null;
  referenceLabel?: string;
  /** Optional trailing-window moving-average overlay (parallel to
   *  `data`, with `value` = average or null when not enough history).
   *  Drawn as a dotted line on top of the area so the eye separates
   *  noise from direction. */
  trendline?: { label: string; value: number | null }[];
  /** Optional name for the trendline shown in the tooltip. Defaults
   *  to "12M avg". */
  trendlineName?: string;
  /** Kept for API compatibility with prior bar implementation. */
  barCategoryGap?: string | number;
  /** Optional cycle-phase bands rendered as subtle background
   *  ReferenceAreas — one band per contiguous "Correction" /
   *  "Peak" stretch. Labels are matched against `data[].label`
   *  exactly. Pass [] or omit to hide. */
  cyclePhaseBands?: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[];
  /** When true, render a horizontal y=0 reference line. Useful for
   *  signed flow series so the reader sees inflow vs outflow without
   *  scanning the y-axis. */
  zeroReference?: boolean;
}

/**
 * Single-series trend renderer. Draws a smooth filled area + optional
 * dotted moving-average line on top. Reads as a continuous trend, not
 * a column chart — no per-point segmentation, no bar fills.
 */
export function BarSeries({
  data,
  height = 300,
  color = "hsl(var(--chart-2))",
  valueFormat = "cr",
  axisFormat = "cr",
  labelFormat = "month",
  name = "Value",
  referenceValue,
  referenceLabel,
  trendline,
  trendlineName = "12M avg",
  cyclePhaseBands,
  zeroReference,
}: BarSeriesProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);
  const hasRef =
    typeof referenceValue === "number" && Number.isFinite(referenceValue);

  const merged = data.map((p, i) => ({
    label: p.label,
    value: p.value,
    trend: trendline?.[i]?.value ?? null,
  }));

  // Stable gradient id keyed off the colour so multiple cards on the
  // same page don't clash. Colour is already an `hsl(var(--…))` token
  // so hashing it is unnecessary — we just slugify.
  const gradientId = `area-${name.replace(/[^a-zA-Z0-9_-]/g, "")}-${color.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={merged}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        {cyclePhaseBands?.map((b, i) => {
          const labels = new Set(data.map((p) => p.label));
          if (!labels.has(b.fromLabel) || !labels.has(b.toLabel)) return null;
          const fill =
            b.phase === "Correction"
              ? "hsl(var(--negative))"
              : "hsl(var(--chart-3))";
          return (
            <ReferenceArea
              key={`${b.fromLabel}-${b.toLabel}-${i}`}
              x1={b.fromLabel}
              x2={b.toLabel}
              fill={fill}
              fillOpacity={0.07}
              ifOverflow="visible"
              strokeOpacity={0}
            />
          );
        })}
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
          cursor={{ stroke: "hsl(var(--border))" }}
          content={
            <ChartTooltip formatValue={(n) => fmtValue(n)} labelFormatter={fmtLabel} />
          }
        />
        {zeroReference && (
          <ReferenceLine
            y={0}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1}
            strokeOpacity={0.5}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          activeDot={{ r: 3 }}
        />
        {trendline && trendline.length > 0 && (
          <Line
            type="monotone"
            dataKey="trend"
            name={trendlineName}
            stroke="hsl(var(--foreground))"
            strokeWidth={1.6}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
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
      </ComposedChart>
    </ResponsiveContainer>
  );
}
