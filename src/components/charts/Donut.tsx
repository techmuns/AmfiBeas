"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import { formatCompactCr } from "@/lib/format";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  data: DonutSlice[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}

interface EnrichedSlice extends DonutSlice {
  pct: number;
}

function DonutTooltip({
  active,
  payload,
}: TooltipProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload as EnrichedSlice;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: slice.color }}
        />
        <span className="font-medium">{slice.label}</span>
      </div>
      <div className="mt-1 tabular text-muted-foreground">
        {formatCompactCr(slice.value)} · {slice.pct.toFixed(1)}%
      </div>
    </div>
  );
}

export function Donut({
  data,
  height = 240,
  innerRadius = 64,
  outerRadius = 96,
}: DonutProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const enriched: EnrichedSlice[] = data.map((d) => ({
    ...d,
    pct: total > 0 ? (d.value / total) * 100 : 0,
  }));

  return (
    <div className="grid items-center gap-6 md:grid-cols-2">
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={enriched}
              dataKey="value"
              nameKey="label"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            >
              {enriched.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-xs">
        {enriched.map((d) => (
          <li
            key={d.key}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: d.color }}
              />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 tabular text-muted-foreground">
              {d.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
