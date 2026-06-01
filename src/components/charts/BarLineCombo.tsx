"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";
import { formatAxisCr, formatCompactCr, formatMonthLabel } from "@/lib/format";

export interface BarLineDatum {
  /** YYYY-MM */
  label: string;
  /** Left-axis bar value (₹ Cr). */
  bar: number | null;
  /** Right-axis line value (percent, 0–100). */
  line: number | null;
}

interface Props {
  data: BarLineDatum[];
  barName: string;
  lineName: string;
  barColor?: string;
  lineColor?: string;
  /** Right-axis (line) domain. Defaults to a tightened range around the data. */
  lineDomain?: [number, number];
  height?: number;
}

/**
 * Combo chart: ₹ Cr bars on the left axis + a percent line on the right
 * axis. Replicates IIFL Figure 21 (Active Equity AUM level + % active-
 * equity share of total AUM).
 */
export function BarLineCombo({
  data,
  barName,
  lineName,
  barColor = "hsl(220, 55%, 32%)",
  lineColor = "hsl(205, 70%, 60%)",
  lineDomain,
  height = 320,
}: Props) {
  const fmtBarFull = (n: number) => formatCompactCr(n);
  const fmtBarAxis = (n: number) => formatAxisCr(n);
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  const lineVals = data
    .map((d) => d.line)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let resolvedLineDomain: [number, number] | undefined = lineDomain;
  if (!resolvedLineDomain && lineVals.length > 0) {
    const lo = Math.min(...lineVals);
    const hi = Math.max(...lineVals);
    const pad = Math.max((hi - lo) * 0.6, 1);
    resolvedLineDomain = [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickFormatter={formatMonthLabel}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={20}
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
          domain={resolvedLineDomain ?? ["auto", "auto"]}
          tickFormatter={(n: number) => `${n}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.35 }}
          content={
            <ChartTooltip
              formatValue={(n, name) => (name === lineName ? fmtPct(n) : fmtBarFull(n))}
              labelFormatter={formatMonthLabel}
            />
          }
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="square" iconSize={9} />
        <Bar
          yAxisId="left"
          dataKey="bar"
          name={barName}
          fill={barColor}
          fillOpacity={0.92}
          maxBarSize={26}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="line"
          name={lineName}
          stroke={lineColor}
          strokeWidth={2.4}
          dot={false}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
