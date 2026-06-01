"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./Tooltip";

/**
 * Two-series grouped (side-by-side) bar chart with value labels above
 * each bar. Used by the AMC-level AUM concentration card so the
 * Top-10 vs Top-25 share per AMC is read at a glance — mirrors the
 * IIFL "AUM Concentration in top 25 stocks" reference chart.
 */
export interface AmcGroupedBarsDatum {
  /** X-axis label (AMC short label, e.g. "HDFC MF" or "Industry"). */
  label: string;
  primary: number;
  secondary: number;
}

interface Props {
  data: AmcGroupedBarsDatum[];
  primaryName: string;
  secondaryName: string;
  primaryColor?: string;
  secondaryColor?: string;
  /** Format suffix appended to tick / tooltip / label values. */
  unitSuffix?: string;
  height?: number;
}

export function AmcGroupedBars({
  data,
  primaryName,
  secondaryName,
  primaryColor = "hsl(220, 60%, 30%)",
  secondaryColor = "hsl(210, 55%, 75%)",
  unitSuffix = "%",
  height = 340,
}: Props) {
  const fmt = (n: number) => `${Math.round(n)}${unitSuffix}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 28, right: 16, left: 0, bottom: 8 }}
        barCategoryGap={"18%"}
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
          interval={0}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(n: number) => `${n}${unitSuffix}`}
          width={40}
          domain={[0, 60]}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.35 }}
          content={
            <ChartTooltip
              formatValue={(n) => {
                if (n === null || n === undefined || !Number.isFinite(n)) {
                  return "—";
                }
                return `${(n as number).toFixed(1)}${unitSuffix}`;
              }}
            />
          }
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
        />
        <Bar
          dataKey="primary"
          name={primaryName}
          fill={primaryColor}
          fillOpacity={0.95}
          isAnimationActive={false}
          maxBarSize={36}
          radius={[2, 2, 0, 0]}
        >
          <LabelList
            dataKey="primary"
            position="top"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) ? fmt(v) : ""
            }
            style={{
              fill: "hsl(var(--foreground))",
              fontSize: 10.5,
              fontWeight: 600,
            }}
          />
        </Bar>
        <Bar
          dataKey="secondary"
          name={secondaryName}
          fill={secondaryColor}
          fillOpacity={0.95}
          isAnimationActive={false}
          maxBarSize={36}
          radius={[2, 2, 0, 0]}
        >
          <LabelList
            dataKey="secondary"
            position="top"
            formatter={(v: unknown) =>
              typeof v === "number" && Number.isFinite(v) ? fmt(v) : ""
            }
            style={{
              fill: "hsl(var(--foreground))",
              fontSize: 10.5,
              fontWeight: 600,
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
