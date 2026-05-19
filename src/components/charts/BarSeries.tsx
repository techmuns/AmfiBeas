"use client";

import {
  Bar,
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
import { ChartTooltip, type TooltipExtraRow } from "./Tooltip";
import {
  type AxisFormat,
  type LabelFormat,
  type ValueFormat,
  axisFormatter,
  labelFormatter,
  valueFormatter,
} from "./format";

interface BarSeriesProps {
  /**
   * Each row is plotted as a bar. The optional `extras` field travels
   * to `ChartTooltip` and renders as a thin "context" section below
   * the main rows — useful when the bar value is an index (e.g. % of
   * trailing-12M-avg) that needs the underlying ₹ Cr + reference
   * value to be readable.
   */
  data: { label: string; value: number; extras?: TooltipExtraRow[] }[];
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
  /** Optional trailing-window moving-average overlay (parallel to
   *  `data`, with `value` = average or null when not enough history).
   *  Drawn as a smooth line on top of the bars so the eye separates
   *  noise from direction. */
  trendline?: { label: string; value: number | null }[];
  /** Optional name for the trendline shown in the tooltip. Defaults
   *  to "12M avg". */
  trendlineName?: string;
  /** Gap between bar categories — % of the bar width. Default 28%
   *  gives a touch more breathing room than Recharts' default. */
  barCategoryGap?: string | number;
  /** Optional cycle-phase bands rendered as subtle background
   *  ReferenceAreas — one band per contiguous "Correction" /
   *  "Peak" stretch. Labels are matched against `data[].label`
   *  exactly. Pass [] or omit to hide. */
  cyclePhaseBands?: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[];
}

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
  barCategoryGap = "32%",
  cyclePhaseBands,
}: BarSeriesProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);
  const hasRef =
    typeof referenceValue === "number" && Number.isFinite(referenceValue);

  // Merge trendline values into the data so the ComposedChart can
  // render a `Line` over the bars. Trendline points are aligned by
  // array index — the caller must ensure parallel arrays. Tooltip
  // extras ride along under `_extras`; ChartTooltip reads them off
  // `payload[0].payload._extras` and renders them below the main rows.
  const merged = data.map((p, i) => ({
    label: p.label,
    value: p.value,
    trend: trendline?.[i]?.value ?? null,
    _extras: p.extras,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={merged}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        barCategoryGap={barCategoryGap}
      >
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        {cyclePhaseBands?.map((b, i) => {
          // Only render bands whose anchors are inside the visible
          // x-axis. ReferenceArea silently ignores out-of-range
          // anchors but a missing one renders the band edge-to-edge,
          // which looks worse than skipping it.
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
          cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
          content={
            <ChartTooltip formatValue={(n) => fmtValue(n)} labelFormatter={fmtLabel} />
          }
        />
        <Bar dataKey="value" name={name} fill={color} radius={[3, 3, 0, 0]} />
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
