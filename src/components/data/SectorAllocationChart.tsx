"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts/Tooltip";

export interface SectorAllocationRow {
  label: string;
  fund: number | null;
  peerAvg: number | null;
}

interface Props {
  data: SectorAllocationRow[];
  fundName: string;
  peerLabel: string;
  height?: number;
}

/** Paired-bar comparison: selected fund's sector allocation (% of AUM)
 *  against the same-category peer average. Drives the "Sector Allocation
 *  v/s Category Average" card on the Overview tab. */
export function SectorAllocationChart({
  data,
  fundName,
  peerLabel,
  height = 360,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 70 }}>
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
          angle={-35}
          textAnchor="end"
          height={90}
        />
        <YAxis
          tickFormatter={(v) => `${v}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={42}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--accent))", opacity: 0.35 }}
          content={<ChartTooltip formatValue={(n) => `${n.toFixed(1)}%`} />}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Bar
          dataKey="fund"
          name={fundName}
          fill="hsl(var(--chart-1))"
          isAnimationActive={false}
        />
        <Bar
          dataKey="peerAvg"
          name={peerLabel}
          fill="hsl(var(--muted-foreground))"
          fillOpacity={0.55}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
