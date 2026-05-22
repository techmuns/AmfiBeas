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
import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import {
  type AxisFormat,
  type LabelFormat,
  type ValueFormat,
  axisFormatter,
  labelFormatter,
  valueFormatter,
} from "./format";

export interface StackedSegmentSpec {
  /** Bar dataKey. Values may be signed; Recharts stacks positives above
   *  and negatives below the zero baseline when bars share a stackId. */
  key: string;
  /** Display name in the legend and tooltip. */
  name: string;
  /** Fill / stroke colour. */
  color: string;
  /** Optional companion dataKey holding this segment's YoY %. When
   *  present, the tooltip row appends "YoY +X%" alongside the value. */
  yoyKey?: string;
}

interface StackedBarsWithGrowthProps {
  data: Record<string, string | number | null>[];
  segments: StackedSegmentSpec[];
  /** dataKey for the growth-rate line on the right axis. */
  growthKey: string;
  /** Display name for the growth line (legend, tooltip, right axis). */
  growthLabel?: string;
  growthColor?: string;
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  labelFormat?: LabelFormat;
}

/**
 * Stacked bars + single growth-line composite. Bars share a stackId so
 * each period renders as one segmented column; the growth-rate line
 * rides the secondary (right) y-axis. Per-segment YoY values can be
 * carried on each row via `yoyKey` and surface in the tooltip.
 *
 * Handles signed values: positive segments stack above the zero
 * baseline, negative segments stack below (diverging stack).
 */
export function StackedBarsWithGrowth({
  data,
  segments,
  growthKey,
  growthLabel = "YoY %",
  growthColor = "hsl(var(--foreground))",
  height = 300,
  valueFormat = "cr",
  axisFormat = "cr",
  labelFormat = "month",
}: StackedBarsWithGrowthProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);
  const fmtLabel = labelFormatter(labelFormat);

  const fmtPct = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${(n as number).toFixed(1)}%`;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 32, left: 0, bottom: 0 }}
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
          tickFormatter={fmtAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(n) => `${n}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.4 }}
          content={(props) => (
            <StackedTooltip
              {...props}
              segments={segments}
              growthLabel={growthLabel}
              fmtValue={fmtValue}
              fmtLabel={fmtLabel}
              fmtPct={fmtPct}
            />
          )}
        />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11 }}
        />
        {segments.map((seg) => (
          <Bar
            key={seg.key}
            yAxisId="left"
            dataKey={seg.key}
            name={seg.name}
            stackId="flows"
            fill={seg.color}
            fillOpacity={0.7}
            stroke={seg.color}
            strokeOpacity={0.9}
            maxBarSize={28}
            isAnimationActive={false}
          />
        ))}
        <Line
          yAxisId="right"
          type="monotone"
          dataKey={growthKey}
          name={growthLabel}
          stroke={growthColor}
          strokeWidth={1.6}
          strokeDasharray="4 3"
          dot={{ r: 2.5, fill: growthColor, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          connectNulls={false}
        />
        <ReferenceLine
          yAxisId="right"
          y={0}
          stroke="hsl(var(--muted-foreground))"
          strokeOpacity={0.3}
          strokeDasharray="2 2"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

interface StackedTooltipExtraProps {
  segments: StackedSegmentSpec[];
  growthLabel: string;
  fmtValue: (n: number) => string;
  fmtLabel: (s: string) => string;
  fmtPct: (n: number | null | undefined) => string;
}

function StackedTooltip({
  active,
  payload,
  label,
  segments,
  growthLabel,
  fmtValue,
  fmtLabel,
  fmtPct,
}: TooltipProps<ValueType, NameType> & StackedTooltipExtraProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | Record<string, number | null | undefined>
    | undefined;
  if (!row) return null;

  const growthEntry = payload.find((p) => p.name === growthLabel);
  const growthVal =
    typeof growthEntry?.value === "number" ? growthEntry.value : null;

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      {label !== undefined && (
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {fmtLabel(String(label))}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {segments.map((seg) => {
          const v = row[seg.key];
          const yoyRaw = seg.yoyKey ? row[seg.yoyKey] : null;
          const yoy =
            typeof yoyRaw === "number" && Number.isFinite(yoyRaw) ? yoyRaw : null;
          return (
            <div
              key={seg.key}
              className="flex items-center justify-between gap-3 tabular"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="text-muted-foreground">{seg.name}</span>
              </span>
              <span className="font-medium">
                {typeof v === "number" ? fmtValue(v) : "—"}
                {seg.yoyKey && (
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    YoY {fmtPct(yoy)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {growthEntry && (
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/60 pt-1 tabular">
            <span className="text-muted-foreground">{growthLabel}</span>
            <span className="font-medium">{fmtPct(growthVal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
