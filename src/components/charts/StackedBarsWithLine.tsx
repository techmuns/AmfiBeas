"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";

/**
 * Stacked bars + secondary-axis line overlay. Same visual language as
 * `StackedBarsWithLabels`, but with a "share %" line drawn over the
 * stack on a second Y-axis on the right. Used by the Share of Passive
 * Funds card on `/monthly?tab=active-passive`.
 */

export interface StackedBarsLineDatum {
  label: string;
  /** Bottom (primary) segment value. */
  bottom: number;
  /** Top (secondary) segment value. */
  top: number;
  /** Total of the two segments — for the label above each stack. */
  total: number;
  /** Value plotted on the secondary Y-axis as a line over the stacks. */
  share: number;
}

interface Props {
  data: StackedBarsLineDatum[];
  bottomName: string;
  topName: string;
  lineName: string;
  bottomColor?: string;
  topColor?: string;
  lineColor?: string;
  /** Suffix on bar-axis ticks + bar value labels (e.g. " T"). */
  barUnitSuffix?: string;
  /** Y-axis range for the line — defaults to [0, 100]. */
  lineDomain?: [number, number];
  height?: number;
}

export function StackedBarsWithLine({
  data,
  bottomName,
  topName,
  lineName,
  bottomColor = "hsl(220, 60%, 35%)",
  topColor = "hsl(28, 85%, 55%)",
  lineColor = "hsl(140, 55%, 35%)",
  barUnitSuffix = "",
  lineDomain = [0, 100],
  height = 340,
}: Props) {
  const fmtBar = (n: number) => n.toFixed(1);
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 28, right: 32, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          stroke="hsl(var(--border))"
          vertical={false}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="label"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="left"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(n: number) => `${n}${barUnitSuffix}`}
          width={48}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={lineDomain}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(n: number) => `${n}%`}
          width={40}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.35 }}
          content={
            <ChartTooltip
              formatValue={(n, name) => {
                if (n === null || n === undefined || !Number.isFinite(n)) {
                  return "—";
                }
                if (name === lineName) return fmtPct(n);
                return `${fmtBar(n)}${barUnitSuffix}`;
              }}
            />
          }
        />
        <Bar
          yAxisId="left"
          dataKey="bottom"
          name={bottomName}
          stackId="stack"
          fill={bottomColor}
          fillOpacity={0.92}
          isAnimationActive={false}
          maxBarSize={64}
        >
          <LabelList
            dataKey="bottom"
            position="center"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) && v > 0
                ? fmtBar(v)
                : ""
            }
            style={{ fill: "white", fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
        <Bar
          yAxisId="left"
          dataKey="top"
          name={topName}
          stackId="stack"
          fill={topColor}
          fillOpacity={0.92}
          isAnimationActive={false}
          maxBarSize={64}
        >
          <LabelList
            dataKey="top"
            position="center"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) && v > 0
                ? fmtBar(v)
                : ""
            }
            style={{ fill: "white", fontSize: 11, fontWeight: 600 }}
          />
          <LabelList
            dataKey="total"
            position="top"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v)
                ? `${fmtBar(v)}${barUnitSuffix}`
                : ""
            }
            style={{
              fill: "hsl(var(--foreground))",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="share"
          name={lineName}
          stroke={lineColor}
          strokeWidth={2.4}
          dot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
          activeDot={{ r: 5.5 }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="share"
            position="top"
            offset={10}
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) ? fmtPct(v) : ""
            }
            style={{
              fill: lineColor,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
