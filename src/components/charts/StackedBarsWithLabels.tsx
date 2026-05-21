"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";

/**
 * Two-segment stacked bar chart with per-segment data labels rendered
 * inside the bars + a total label above each bar. Used by the
 * Industry Concentration card on `/amcs?tab=share-positioning`.
 *
 * Values are passed in the unit the caller wants displayed (e.g. ₹
 * trillions). The chart writes labels with one decimal place.
 */

export interface StackedBarsDatum {
  label: string;
  /** Bottom (primary) segment value. */
  bottom: number;
  /** Top (secondary) segment value. */
  top: number;
  /** Total of the two segments — duplicated so recharts can render it
   *  as a label above the stack. */
  total: number;
}

interface Props {
  data: StackedBarsDatum[];
  /** Display name for the bottom segment (e.g. "Top 10 AMCs"). */
  bottomName: string;
  /** Display name for the top segment (e.g. "Other AMCs"). */
  topName: string;
  bottomColor?: string;
  topColor?: string;
  /** Suffix appended to numeric tick labels and tooltip values
   *  (e.g. " T" for trillions). */
  unitSuffix?: string;
  height?: number;
}

export function StackedBarsWithLabels({
  data,
  bottomName,
  topName,
  bottomColor = "hsl(var(--chart-1))",
  topColor = "hsl(var(--chart-2))",
  unitSuffix = "",
  height = 320,
}: Props) {
  const fmt = (n: number) => n.toFixed(1);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 28, right: 16, left: 0, bottom: 0 }}
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
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(n: number) => `${n}${unitSuffix}`}
          width={48}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.35 }}
          content={
            <ChartTooltip
              formatValue={(n, name) => {
                if (n === null || n === undefined || !Number.isFinite(n)) {
                  return "—";
                }
                if (name === "Total") return `${fmt(n)}${unitSuffix}`;
                return `${fmt(n)}${unitSuffix}`;
              }}
            />
          }
        />
        <Bar
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
                ? fmt(v)
                : ""
            }
            style={{ fill: "white", fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
        <Bar
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
                ? fmt(v)
                : ""
            }
            style={{ fill: "white", fontSize: 11, fontWeight: 600 }}
          />
          <LabelList
            dataKey="total"
            position="top"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v)
                ? `${fmt(v)}${unitSuffix}`
                : ""
            }
            style={{
              fill: "hsl(var(--foreground))",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
