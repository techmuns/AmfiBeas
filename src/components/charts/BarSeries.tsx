"use client";

import { useId } from "react";
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

export type SignedFill = "above-below" | "single" | "none";

interface BarSeriesProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  name?: string;
  referenceValue?: number | null;
  referenceLabel?: string;
  /** Optional trailing-window moving-average overlay (parallel to
   *  `data`). Rendered as a dashed line on top of the area / line. */
  trendline?: { label: string; value: number | null }[];
  trendlineName?: string;
  /** Preserved for API compatibility; no-op in the trend renderer. */
  barCategoryGap?: string | number;
  /** Optional cycle-phase bands rendered as subtle background
   *  ReferenceAreas. Labels are matched against `data[].label`
   *  exactly. Pass [] or omit to hide. */
  cyclePhaseBands?: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[];
  /** Controls how the signed series is filled:
   *  - "above-below": green area above 0, red area below 0 (auto for
   *     flow series crossing zero).
   *  - "single": one filled area, color = `color`.
   *  - "none": line only, no fill.
   *  Default: auto-pick based on whether the series crosses zero. */
  signedFill?: SignedFill;
  /** When true, render an explicit y=0 reference line. Auto-enables
   *  when any value < 0. */
  zeroReference?: boolean;
  /** When true, derive a tight y-axis domain so narrow-range percent
   *  series read clearly. Auto-disables when zero is interior to the
   *  range, to preserve the zero crossing visually. */
  dynamicYDomain?: boolean;
  /** When true, draw a circle + value label at the last data point. */
  endpointDot?: boolean;
}

/**
 * Trend visual (area or line, signed fill where appropriate) with
 * optional moving average, reference line, and cycle-phase bands.
 *
 * Picks the best non-bar render by data shape:
 *  - Mostly-positive series → filled area + optional dashed trendline.
 *  - Series crossing zero → line + zero reference + signed dual-area.
 *  - Count series → filled area + trendline (when caller passes one).
 *
 * Public API matches the legacy bar implementation so call sites
 * continue to compile unchanged.
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
  signedFill,
  zeroReference,
  dynamicYDomain,
  endpointDot,
}: BarSeriesProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);
  const reactId = useId();

  const finiteValues = data
    .map((d) => d.value)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const crossesZero =
    finiteValues.length > 0 &&
    Math.min(...finiteValues) < 0 &&
    Math.max(...finiteValues) > 0;
  const hasNegative =
    finiteValues.length > 0 && Math.min(...finiteValues) < 0;

  const resolvedSignedFill: SignedFill =
    signedFill ?? (crossesZero ? "above-below" : "single");
  const showZeroLine = zeroReference ?? hasNegative;
  const yDomain = computeYDomain(finiteValues, {
    enabled: !!dynamicYDomain,
    crossesZero,
  });

  // Merge trendline + signed-split derivations into the row data so
  // ComposedChart can render Areas / Line off the same dataset.
  const merged = data.map((p, i) => ({
    label: p.label,
    value: p.value,
    posOnly:
      resolvedSignedFill === "above-below" && p.value > 0 ? p.value : null,
    negOnly:
      resolvedSignedFill === "above-below" && p.value < 0 ? p.value : null,
    trend: trendline?.[i]?.value ?? null,
    endpoint: endpointDot && i === data.length - 1 ? p.value : null,
  }));

  const hasRef =
    typeof referenceValue === "number" && Number.isFinite(referenceValue);

  const gradientId = `bar-series-fill-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const positiveGradient = `${gradientId}-pos`;
  const negativeGradient = `${gradientId}-neg`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={merged}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={positiveGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--positive))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--positive))" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={negativeGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--negative))" stopOpacity={0.02} />
            <stop offset="100%" stopColor="hsl(var(--negative))" stopOpacity={0.35} />
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
              fillOpacity={0.12}
              ifOverflow="extendDomain"
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
          domain={yDomain}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={
            <ChartTooltip
              formatValue={(n, key) => {
                // Tooltip rows from `posOnly` / `negOnly` / `endpoint`
                // helpers should not surface — only the primary value
                // and the trendline.
                if (key === "posOnly" || key === "negOnly" || key === "endpoint") {
                  return "";
                }
                return fmtValue(n);
              }}
              labelFormatter={fmtLabel}
            />
          }
        />
        {resolvedSignedFill === "above-below" ? (
          <>
            <Area
              type="monotone"
              dataKey="posOnly"
              name=""
              stroke="none"
              fill={`url(#${positiveGradient})`}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="negOnly"
              name=""
              stroke="none"
              fill={`url(#${negativeGradient})`}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={name}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </>
        ) : resolvedSignedFill === "single" ? (
          <Area
            type="monotone"
            dataKey="value"
            name={name}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ) : (
          <Line
            type="monotone"
            dataKey="value"
            name={name}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        )}
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
        {showZeroLine && (
          <ReferenceLine
            y={0}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.6}
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
        {endpointDot && (
          <Line
            type="monotone"
            dataKey="endpoint"
            name=""
            stroke="transparent"
            dot={{ r: 4, fill: color, strokeWidth: 0 }}
            activeDot={false}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function computeYDomain(
  values: number[],
  opts: { enabled: boolean; crossesZero: boolean }
): [number | "auto", number | "auto"] | undefined {
  // Auto-disable dynamic domain when zero is interior so the zero
  // crossing remains visible.
  if (!opts.enabled || opts.crossesZero || values.length === 0) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = Math.max(range * 0.1, range === 0 ? Math.abs(max) * 0.05 || 1 : 0);
  return [min - pad, max + pad];
}
