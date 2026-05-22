"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BRAND } from "@/lib/brand-palette";
import {
  axisFormatterCr,
  axisUnitLabel,
  formatCrTooltip,
} from "@/lib/format";

export interface StackedBarComboDatum {
  label: string;
  bottom: number;
  top: number;
}

interface VariantAProps {
  variant: "A";
  data: StackedBarComboDatum[];
  bottomName: string;
  topName: string;
  height?: number;
  /** Show the total above each bar. Default true. */
  showTotalLabel?: boolean;
  /** Show inline white segment labels inside each bar segment.
   *  Default true. Auto-hidden per-segment when the segment is too
   *  thin to render legibly. */
  showSegmentLabels?: boolean;
}

export type StackedBarComboProps = VariantAProps;

const SEGMENT_LABEL_MIN_VALUE_RATIO = 0.06;

export function StackedBarCombo(props: StackedBarComboProps) {
  if (props.variant === "A") return <ArchetypeA {...props} />;
  return null;
}

function ArchetypeA({
  data,
  bottomName,
  topName,
  height = 320,
  showTotalLabel = true,
  showSegmentLabels = true,
}: VariantAProps) {
  const totals = data.map((d) => d.bottom + d.top);
  const domainMax = totals.length > 0 ? Math.max(...totals) : 0;
  const axisMax = niceCeiling(domainMax * 1.12);
  const fmtAxis = axisFormatterCr(axisMax);
  const unitLabel = axisUnitLabel(axisMax);

  const merged = data.map((d) => ({
    label: d.label,
    bottom: d.bottom,
    top: d.top,
    total: d.bottom + d.top,
  }));

  return (
    <div className="w-full">
      <p className="pb-1 text-[10px] font-medium uppercase tracking-wide text-brand-axis">
        {unitLabel}
      </p>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={merged}
          margin={{ top: 20, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            stroke={BRAND.grid}
            vertical={false}
            strokeDasharray="0"
          />
          <XAxis
            dataKey="label"
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: BRAND.grid }}
            interval={0}
          />
          <YAxis
            tickFormatter={fmtAxis}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, axisMax]}
          />
          <Tooltip
            cursor={{ fill: BRAND.grid, fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as
                | { bottom: number; top: number; total: number }
                | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
                  <p className="pb-1 font-semibold tracking-tight">{label}</p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2"
                      style={{ background: BRAND.navy }}
                    />
                    {bottomName}: {formatCrTooltip(row.bottom)}
                  </p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2"
                      style={{ background: BRAND.orange }}
                    />
                    {topName}: {formatCrTooltip(row.top)}
                  </p>
                  <p className="border-t border-border pt-1 font-semibold">
                    Total: {formatCrTooltip(row.total)}
                  </p>
                </div>
              );
            }}
          />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          <Bar
            dataKey="bottom"
            name={bottomName}
            stackId="stack"
            fill={BRAND.navy}
            isAnimationActive={false}
          >
            {showSegmentLabels && (
              <LabelList
                dataKey="bottom"
                position="center"
                content={(p) =>
                  renderSegmentLabel(
                    p as RechartsLabelProps,
                    axisMax
                  )
                }
              />
            )}
          </Bar>
          <Bar
            dataKey="top"
            name={topName}
            stackId="stack"
            fill={BRAND.orange}
            isAnimationActive={false}
          >
            {showSegmentLabels && (
              <LabelList
                dataKey="top"
                position="center"
                content={(p) =>
                  renderSegmentLabel(
                    p as RechartsLabelProps,
                    axisMax
                  )
                }
              />
            )}
            {showTotalLabel && (
              <LabelList
                dataKey="total"
                position="top"
                content={(p) =>
                  renderTotalLabel(p as RechartsLabelProps)
                }
              />
            )}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface RechartsLabelProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
  index?: number;
}

function renderSegmentLabel(
  props: RechartsLabelProps,
  axisMax: number
): React.ReactElement | null {
  const { x = 0, y = 0, width = 0, height = 0, value } = props;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  if (height < 18) return null;
  if (value / axisMax < SEGMENT_LABEL_MIN_VALUE_RATIO) return null;
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
      fill={BRAND.labelOnFill}
    >
      {formatSegmentLabel(value, axisMax)}
    </text>
  );
}

function renderTotalLabel(
  props: RechartsLabelProps
): React.ReactElement | null {
  const { x = 0, y = 0, width = 0, value } = props;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 6}
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
      fill={BRAND.axis}
    >
      {formatTotalLabel(value)}
    </text>
  );
}

function formatSegmentLabel(value: number, axisMax: number): string {
  const useLakhCr = axisMax >= 1e5;
  if (useLakhCr) return (value / 1e5).toFixed(1);
  return Math.round(value).toLocaleString("en-IN");
}

function formatTotalLabel(value: number): string {
  if (Math.abs(value) >= 1e5) return `${(value / 1e5).toFixed(1)}`;
  return Math.round(value).toLocaleString("en-IN");
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const mantissa = value / base;
  let step: number;
  if (mantissa <= 1.2) step = 1.2;
  else if (mantissa <= 1.5) step = 1.5;
  else if (mantissa <= 2) step = 2;
  else if (mantissa <= 2.5) step = 2.5;
  else if (mantissa <= 3) step = 3;
  else if (mantissa <= 5) step = 5;
  else if (mantissa <= 7) step = 7;
  else step = 10;
  return step * base;
}
