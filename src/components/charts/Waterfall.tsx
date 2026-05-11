"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
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

export type WaterfallStepType = "total" | "up" | "down";

export interface WaterfallStep {
  label: string;
  value: number;       // signed magnitude of the step (or end value for "total")
  cumulative: number;  // running total after this step
  type: WaterfallStepType;
}

interface WaterfallProps {
  data: WaterfallStep[];
  height?: number;
  valueFormat?: ValueFormat;
  axisFormat?: AxisFormat;
  upColor?: string;
  downColor?: string;
  totalColor?: string;
}

/**
 * Composed waterfall chart built on top of Recharts' stacked
 * BarChart. Each visible bar is rendered as two stacked segments:
 *
 *   spacer  → invisible offset that lifts the visible bar to its
 *             starting height
 *   visible → coloured bar showing the step's magnitude
 *
 * "total" steps (e.g. opening / closing AUM) sit on the baseline
 * with `spacer = 0` and `visible = absolute value`.
 *
 * The tooltip surfaces the step's signed delta and the running
 * cumulative so the chart reads like a bridge: opening → +sip →
 * +lump sum → +market → closing.
 */
export function Waterfall({
  data,
  height = 280,
  valueFormat = "cr",
  axisFormat = "cr",
  upColor = "hsl(var(--chart-1))",
  downColor = "hsl(var(--chart-3))",
  totalColor = "hsl(var(--foreground))",
}: WaterfallProps) {
  const fmtValue = valueFormatter(valueFormat);
  const fmtAxis = axisFormatter(axisFormat);

  const rendered = data.map((s) => {
    if (s.type === "total") {
      return {
        label: s.label,
        spacer: 0,
        visible: Math.max(0, s.value),
        delta: s.value,
        cumulative: s.cumulative,
        type: s.type,
      };
    }
    const visible = Math.abs(s.value);
    const spacer = s.value >= 0 ? s.cumulative - visible : s.cumulative;
    return {
      label: s.label,
      spacer,
      visible,
      delta: s.value,
      cumulative: s.cumulative,
      type: s.type,
    };
  });

  const colorOf = (type: WaterfallStepType) => {
    if (type === "total") return totalColor;
    if (type === "up") return upColor;
    return downColor;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rendered} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval={0}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          tickFormatter={fmtAxis}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
          content={
            <ChartTooltip
              labelFormatter={(s) => s}
              formatValue={(n, name) => {
                if (name === "Spacer") return "";
                return fmtValue(n);
              }}
            />
          }
        />
        <Bar dataKey="spacer" stackId="wf" fill="transparent" name="Spacer" />
        <Bar dataKey="visible" stackId="wf" name="Step" radius={[3, 3, 0, 0]}>
          {rendered.map((r, i) => (
            <Cell key={i} fill={colorOf(r.type)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
