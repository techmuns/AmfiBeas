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

export interface AllocationSegment {
  /** Numeric key on each row holding this segment's percent (0-100). */
  key: string;
  /** Legend / tooltip label. */
  label: string;
  /** Bar fill — any CSS color or `hsl(var(--…))`. */
  color: string;
}

interface Props {
  /** One object per column: `{ amc, [segmentKey]: percent }`. The bar named
   *  "Industry" is rendered with an emphasised x-axis tick. */
  data: Array<Record<string, number | string>>;
  segments: AllocationSegment[];
  height?: number;
  /** Hide the in-bar % label below this value (the slice is too thin to
   *  read); the value still shows in the tooltip. Default 4. */
  minLabelPct?: number;
}

/** Bold the "Industry" tick so the blended benchmark column stands apart
 *  from the individual fund houses. */
function AmcTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const { x = 0, y = 0, payload } = props;
  const value = payload?.value ?? "";
  const isIndustry = value === "Industry";
  return (
    <text
      x={x}
      y={y + 10}
      textAnchor="end"
      transform={`rotate(-35, ${x}, ${y + 10})`}
      fontSize={11}
      fontWeight={isIndustry ? 700 : 400}
      fill={
        isIndustry ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"
      }
    >
      {value}
    </text>
  );
}

/** Centered white % label for a stacked segment, suppressed when the slice
 *  is too thin to read. Recharts hands a stacked bar's label the CUMULATIVE
 *  stack value, not the segment's own, so we read the raw segment percent
 *  back from the row by `index`. */
function makeSegmentLabel(
  data: Array<Record<string, number | string>>,
  segKey: string,
  minPct: number
) {
  return function SegmentLabel(props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    index?: number;
  }) {
    const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props;
    const v = Number(data[index]?.[segKey] ?? 0);
    if (!Number.isFinite(v) || v < minPct || height < 13) return null;
    return (
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
        fill="#fff"
      >
        {Math.round(v)}%
      </text>
    );
  };
}

/**
 * 100%-stacked column chart — one column per AMC (plus an Industry column),
 * each split into the supplied segments with in-bar % labels. Used for the
 * per-AMC Cap and Sector allocation cards on the MFs Portfolio Tracker.
 */
export function AmcAllocationStack({
  data,
  segments,
  height = 380,
  minLabelPct = 4,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 64 }}>
        <CartesianGrid
          stroke="hsl(var(--border))"
          vertical={false}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="amc"
          interval={0}
          tickLine={false}
          axisLine={false}
          height={84}
          tick={<AmcTick />}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 20, 40, 60, 80, 100]}
          tickFormatter={(v) => `${v}%`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={42}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--accent))", opacity: 0.35 }}
          content={
            <ChartTooltip formatValue={(n) => `${n.toFixed(1)}%`} reverseOrder />
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        {segments.map((seg) => {
          const SegmentLabel = makeSegmentLabel(data, seg.key, minLabelPct);
          return (
            <Bar
              key={seg.key}
              dataKey={seg.key}
              name={seg.label}
              stackId="alloc"
              fill={seg.color}
              isAnimationActive={false}
              label={<SegmentLabel />}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
