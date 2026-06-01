"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
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

export interface VBarSpec {
  key: string;
  name: string;
  color: string;
}

interface VerticalBarsProps {
  data: Record<string, string | number | null>[];
  xKey: string;
  bars: VBarSpec[];
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
  /** Horizontal dashed reference line (e.g. trailing-12M average). */
  referenceValue?: number | null;
  referenceLabel?: string;
  /** Value labels above bars. Only applied to single-series charts. */
  labelMode?: "all" | "last" | "none";
  showLegend?: boolean;
  maxBarSize?: number;
}

/**
 * Vertical bar chart — single or grouped. Renders true Recharts <Bar>
 * columns, unlike BarSeries / GroupedBars which render trend lines.
 * Used to replicate the IIFL research figures (monthly net flows,
 * active-equity net inflows, NFO mobilisation) in their native bar form.
 */
export function VerticalBars({
  data,
  xKey,
  bars,
  height = 300,
  valueFormat = "cr",
  axisFormat = "cr",
  labelFormat = "month",
  referenceValue,
  referenceLabel,
  labelMode = "none",
  showLegend,
  maxBarSize = 30,
}: VerticalBarsProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  const values: number[] = [];
  for (const row of data) {
    for (const b of bars) {
      const v = row[b.key];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
  }
  const hasNegative = values.length > 0 && Math.min(...values) < 0;
  const hasRef =
    typeof referenceValue === "number" && Number.isFinite(referenceValue);
  const resolvedShowLegend = showLegend ?? bars.length > 1;
  const single = bars.length === 1;

  // Single-series value labels (all bars, or last bar only). We precompute
  // a `__lbl` column rather than use LabelList's index-less formatter so the
  // "last only" mode is expressible.
  const chartData =
    single && labelMode !== "none"
      ? data.map((row, i) => {
          const raw = row[bars[0].key];
          const show =
            labelMode === "all" || (labelMode === "last" && i === data.length - 1);
          return {
            ...row,
            __lbl: show && typeof raw === "number" ? raw : null,
          };
        })
      : data;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={chartData}
        margin={{ top: 24, right: hasRef ? 46 : 12, left: 0, bottom: 0 }}
        barCategoryGap={single ? "18%" : "12%"}
      >
        <CartesianGrid
          stroke="hsl(var(--border))"
          vertical={false}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey={xKey}
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
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.35 }}
          content={
            <ChartTooltip formatValue={(n) => fmtValue(n)} labelFormatter={fmtLabel} />
          }
        />
        {resolvedShowLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="square"
            iconSize={9}
          />
        )}
        {hasNegative && (
          <ReferenceLine
            y={0}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.6}
          />
        )}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.color}
            fillOpacity={0.92}
            maxBarSize={maxBarSize}
            isAnimationActive={false}
          >
            {single && labelMode !== "none" && (
              <LabelList
                dataKey="__lbl"
                position="top"
                formatter={(v: unknown) =>
                  typeof v === "number" && Number.isFinite(v) ? fmtAxis(v) : ""
                }
                style={{ fill: "hsl(var(--foreground))", fontSize: 9.5, fontWeight: 600 }}
              />
            )}
          </Bar>
        ))}
        {hasRef && (
          <ReferenceLine
            y={referenceValue as number}
            stroke="hsl(var(--chart-3))"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            label={
              referenceLabel
                ? {
                    value: referenceLabel,
                    position: "right",
                    fontSize: 10,
                    fill: "hsl(var(--chart-3))",
                  }
                : undefined
            }
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
