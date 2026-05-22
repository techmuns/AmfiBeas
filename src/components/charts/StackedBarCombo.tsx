"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Customized,
  LabelList,
  Legend,
  Line,
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
import { cagrArrowOverlay } from "./CagrArrowOverlay";

export interface StackedBarComboDatum {
  label: string;
  bottom: number;
  top: number;
}

export interface BarLineDatum {
  label: string;
  /** Stacked-bar bottom value, or the single-bar value for variant C. */
  bottom: number;
  /** Stacked-bar top value (variant B only). */
  top?: number;
  /** Line value plotted against the right axis. */
  line: number;
}

export interface IndexBarLineDatum {
  label: string;
  /** Burgundy bar value (e.g. monthly flow). */
  bar: number;
  /** Index value (e.g. NIFTY 500 close, normalized). */
  index: number;
}

export interface CagrSpec {
  startLabel: string;
  endLabel: string;
  cagrPct: number;
  startValue: number;
  endValue: number;
}

interface VariantAProps {
  variant: "A";
  data: StackedBarComboDatum[];
  bottomName: string;
  topName: string;
  height?: number;
  showSegmentLabels?: boolean;
  showTotalLabel?: boolean;
  /** Override the auto-detected left axis unit ("₹ Cr" / "₹ Lakh Cr").
   *  Pass "%" for share-of-something exhibits (e.g. Top-N concentration). */
  leftUnitLabel?: string;
  /** Switches tooltip / segment / total labels into percentage mode
   *  (e.g. "57.2%" instead of "₹ 57 Cr"). Use together with
   *  `leftUnitLabel="%"` for share-of-something exhibits. */
  percentMode?: boolean;
  cagr?: CagrSpec;
}

interface VariantBProps {
  variant: "B";
  data: BarLineDatum[];
  bottomName: string;
  topName: string;
  lineName: string;
  height?: number;
  showSegmentLabels?: boolean;
  showLineLabels?: boolean;
  /** Override the right axis unit label (default "%"). */
  rightUnitLabel?: string;
  cagr?: CagrSpec;
}

interface VariantCProps {
  variant: "C";
  data: BarLineDatum[];
  barName: string;
  lineName: string;
  height?: number;
  showBarLabels?: boolean;
  showLineLabels?: boolean;
  rightUnitLabel?: string;
  cagr?: CagrSpec;
}

interface VariantDProps {
  variant: "D";
  data: IndexBarLineDatum[];
  barName: string;
  lineName: string;
  height?: number;
  rightUnitLabel?: string;
}

export type StackedBarComboProps =
  | VariantAProps
  | VariantBProps
  | VariantCProps
  | VariantDProps;

const SEGMENT_LABEL_MIN_VALUE_RATIO = 0.06;
const LINE_PAD_PCT = 0.12;

export function StackedBarCombo(props: StackedBarComboProps) {
  if (props.variant === "A") return <ArchetypeA {...props} />;
  if (props.variant === "B") return <ArchetypeB {...props} />;
  if (props.variant === "C") return <ArchetypeC {...props} />;
  return <ArchetypeD {...props} />;
}

function ArchetypeA({
  data,
  bottomName,
  topName,
  height = 320,
  showTotalLabel = true,
  showSegmentLabels = true,
  leftUnitLabel,
  percentMode = false,
  cagr,
}: VariantAProps) {
  const totals = data.map((d) => d.bottom + d.top);
  const domainMax = totals.length > 0 ? Math.max(...totals) : 0;
  const axisMax = niceCeiling(domainMax * 1.12);
  const fmtAxis = percentMode
    ? (n: number) => `${Math.round(n)}`
    : axisFormatterCr(axisMax);
  const unitLabel = leftUnitLabel ?? axisUnitLabel(axisMax);
  const tooltipFormatter = percentMode
    ? (v: number) => `${v.toFixed(1)}%`
    : formatCrTooltip;

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
          margin={{ top: 28, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={BRAND.grid} vertical={false} />
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
                  <SwatchRow color={BRAND.navy} name={bottomName} value={tooltipFormatter(row.bottom)} />
                  <SwatchRow color={BRAND.orange} name={topName} value={tooltipFormatter(row.top)} />
                  <p className="border-t border-border pt-1 font-semibold">
                    Total: {tooltipFormatter(row.total)}
                  </p>
                </div>
              );
            }}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={legendStyle} />
          <Bar dataKey="bottom" name={bottomName} stackId="stack" fill={BRAND.navy} isAnimationActive={false}>
            {showSegmentLabels && (
              <LabelList
                dataKey="bottom"
                position="center"
                content={(p) =>
                  renderSegmentLabel(p as RechartsLabelProps, axisMax, percentMode)
                }
              />
            )}
          </Bar>
          <Bar dataKey="top" name={topName} stackId="stack" fill={BRAND.orange} isAnimationActive={false}>
            {showSegmentLabels && (
              <LabelList
                dataKey="top"
                position="center"
                content={(p) =>
                  renderSegmentLabel(p as RechartsLabelProps, axisMax, percentMode)
                }
              />
            )}
            {showTotalLabel && (
              <LabelList
                dataKey="total"
                position="top"
                content={(p) =>
                  renderTotalLabel(p as RechartsLabelProps, axisMax, percentMode)
                }
              />
            )}
          </Bar>
          {cagr && <Customized component={cagrArrowOverlay(cagr)} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ArchetypeB({
  data,
  bottomName,
  topName,
  lineName,
  height = 320,
  showSegmentLabels = true,
  showLineLabels = true,
  rightUnitLabel = "%",
  cagr,
}: VariantBProps) {
  const totals = data.map((d) => d.bottom + (d.top ?? 0));
  const domainMax = totals.length > 0 ? Math.max(...totals) : 0;
  const axisMax = niceCeiling(domainMax * 1.12);
  const fmtAxis = axisFormatterCr(axisMax);
  const unitLabel = axisUnitLabel(axisMax);

  const lineValues = data
    .map((d) => d.line)
    .filter((v): v is number => Number.isFinite(v));
  const [rightMin, rightMax] = padDomain(lineValues, LINE_PAD_PCT);

  const merged = data.map((d) => ({
    label: d.label,
    bottom: d.bottom,
    top: d.top ?? 0,
    total: d.bottom + (d.top ?? 0),
    line: d.line,
  }));
  const lineLabelKeep = selectLineLabelIndices(lineValues);

  return (
    <div className="w-full">
      <UnitHeader leftUnit={unitLabel} rightUnit={rightUnitLabel} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={merged}
          margin={{ top: 28, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={BRAND.grid} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: BRAND.grid }}
            interval={0}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={fmtAxis}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, axisMax]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(n) => `${n.toFixed(1)}`}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={36}
            domain={[rightMin, rightMax]}
          />
          <Tooltip
            cursor={{ fill: BRAND.grid, fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as
                | { bottom: number; top: number; total: number; line: number }
                | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
                  <p className="pb-1 font-semibold tracking-tight">{label}</p>
                  <SwatchRow color={BRAND.navy} name={bottomName} value={formatCrTooltip(row.bottom)} />
                  <SwatchRow color={BRAND.orange} name={topName} value={formatCrTooltip(row.top)} />
                  <p className="border-t border-border pt-1 text-muted-foreground">
                    Total: {formatCrTooltip(row.total)}
                  </p>
                  <SwatchRow color={BRAND.green} name={lineName} value={`${row.line.toFixed(1)}${rightUnitLabel}`} />
                </div>
              );
            }}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={legendStyle} />
          <Bar yAxisId="left" dataKey="bottom" name={bottomName} stackId="stack" fill={BRAND.navy} isAnimationActive={false}>
            {showSegmentLabels && (
              <LabelList
                dataKey="bottom"
                position="center"
                content={(p) => renderSegmentLabel(p as RechartsLabelProps, axisMax)}
              />
            )}
          </Bar>
          <Bar yAxisId="left" dataKey="top" name={topName} stackId="stack" fill={BRAND.orange} isAnimationActive={false}>
            {showSegmentLabels && (
              <LabelList
                dataKey="top"
                position="center"
                content={(p) => renderSegmentLabel(p as RechartsLabelProps, axisMax)}
              />
            )}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="line"
            name={lineName}
            stroke={BRAND.green}
            strokeWidth={2}
            dot={{ r: 3, fill: BRAND.green, stroke: BRAND.green }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          >
            {showLineLabels && (
              <LabelList
                dataKey="line"
                content={(p) =>
                  renderLineLabel(p as RechartsLabelProps, rightUnitLabel, lineLabelKeep)
                }
              />
            )}
          </Line>
          {cagr && <Customized component={cagrArrowOverlay(cagr)} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ArchetypeC({
  data,
  barName,
  lineName,
  height = 320,
  showBarLabels = true,
  showLineLabels = true,
  rightUnitLabel = "%",
  cagr,
}: VariantCProps) {
  const bars = data.map((d) => d.bottom);
  const domainMax = bars.length > 0 ? Math.max(...bars) : 0;
  const axisMax = niceCeiling(domainMax * 1.12);
  const fmtAxis = axisFormatterCr(axisMax);
  const unitLabel = axisUnitLabel(axisMax);

  const lineValues = data
    .map((d) => d.line)
    .filter((v): v is number => Number.isFinite(v));
  const [rightMin, rightMax] = padDomain(lineValues, LINE_PAD_PCT);

  const merged = data.map((d) => ({
    label: d.label,
    bar: d.bottom,
    line: d.line,
  }));
  const lineLabelKeep = selectLineLabelIndices(lineValues);

  return (
    <div className="w-full">
      <UnitHeader leftUnit={unitLabel} rightUnit={rightUnitLabel} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={merged}
          margin={{ top: 28, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={BRAND.grid} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: BRAND.grid }}
            interval={0}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={fmtAxis}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, axisMax]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(n) => `${n.toFixed(1)}`}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={36}
            domain={[rightMin, rightMax]}
          />
          <Tooltip
            cursor={{ fill: BRAND.grid, fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as
                | { bar: number; line: number }
                | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
                  <p className="pb-1 font-semibold tracking-tight">{label}</p>
                  <SwatchRow color={BRAND.navy} name={barName} value={formatCrTooltip(row.bar)} />
                  <SwatchRow color={BRAND.orange} name={lineName} value={`${row.line.toFixed(1)}${rightUnitLabel}`} />
                </div>
              );
            }}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={legendStyle} />
          <Bar yAxisId="left" dataKey="bar" name={barName} fill={BRAND.navy} isAnimationActive={false}>
            {showBarLabels && (
              <LabelList
                dataKey="bar"
                position="top"
                content={(p) => renderTotalLabel(p as RechartsLabelProps, axisMax)}
              />
            )}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="line"
            name={lineName}
            stroke={BRAND.orange}
            strokeWidth={2}
            dot={{ r: 3, fill: BRAND.orange, stroke: BRAND.orange }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          >
            {showLineLabels && (
              <LabelList
                dataKey="line"
                content={(p) =>
                  renderLineLabel(p as RechartsLabelProps, rightUnitLabel, lineLabelKeep)
                }
              />
            )}
          </Line>
          {cagr && <Customized component={cagrArrowOverlay(cagr)} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ArchetypeD({
  data,
  barName,
  lineName,
  height = 320,
  rightUnitLabel = "Index (base 100)",
}: VariantDProps) {
  const bars = data.map((d) => d.bar);
  const domainMax = bars.length > 0 ? Math.max(...bars) : 0;
  const axisMax = niceCeiling(domainMax * 1.12);
  const fmtAxis = axisFormatterCr(axisMax);
  const unitLabel = axisUnitLabel(axisMax);

  const indices = data
    .map((d) => d.index)
    .filter((v): v is number => Number.isFinite(v));
  const [rightMin, rightMax] = padDomain(indices, LINE_PAD_PCT);

  return (
    <div className="w-full">
      <UnitHeader leftUnit={unitLabel} rightUnit={rightUnitLabel} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 16, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={BRAND.grid} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={BRAND.axis}
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: BRAND.grid }}
            interval="preserveStartEnd"
            minTickGap={36}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={fmtAxis}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, axisMax]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(n) => n.toFixed(0)}
            stroke={BRAND.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={36}
            domain={[rightMin, rightMax]}
          />
          <Tooltip
            cursor={{ fill: BRAND.grid, fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as
                | { bar: number; index: number }
                | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-card px-3 py-2 text-[12px] shadow-sm">
                  <p className="pb-1 font-semibold tracking-tight">{label}</p>
                  <SwatchRow color={BRAND.burgundy} name={barName} value={formatCrTooltip(row.bar)} />
                  <SwatchRow color={BRAND.axis} name={lineName} value={row.index.toFixed(0)} />
                </div>
              );
            }}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={legendStyle} />
          <Bar yAxisId="left" dataKey="bar" name={barName} fill={BRAND.burgundy} isAnimationActive={false} />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="index"
            name={lineName}
            stroke={BRAND.axis}
            strokeWidth={1.4}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
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

const legendStyle = { fontSize: 11, paddingTop: 8 };

function SwatchRow({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2"
        style={{ background: color }}
      />
      {name}: {value}
    </p>
  );
}

function UnitHeader({ leftUnit, rightUnit }: { leftUnit: string; rightUnit: string }) {
  return (
    <div className="flex items-end justify-between pb-1 text-[10px] font-medium uppercase tracking-wide text-brand-axis">
      <span>{leftUnit}</span>
      <span>{rightUnit}</span>
    </div>
  );
}

function renderSegmentLabel(
  props: RechartsLabelProps,
  axisMax: number,
  percentMode = false
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
      {formatSegmentLabel(value, axisMax, percentMode)}
    </text>
  );
}

function renderTotalLabel(
  props: RechartsLabelProps,
  axisMax: number,
  percentMode = false
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
      {formatSegmentLabel(value, axisMax, percentMode)}
    </text>
  );
}

function renderLineLabel(
  props: RechartsLabelProps,
  unit: string,
  keep: Set<number>
): React.ReactElement | null {
  const { x = 0, y = 0, value, index } = props;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (typeof index === "number" && !keep.has(index)) return null;
  const text = `${value.toFixed(1)}${unit}`;
  const halfW = Math.max(text.length * 3.4, 16);
  return (
    <g>
      <rect
        x={x - halfW}
        y={y - 18}
        width={halfW * 2}
        height={14}
        rx={2}
        ry={2}
        fill={BRAND.labelOnFill}
        fillOpacity={0.88}
      />
      <text
        x={x}
        y={y - 8}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill={BRAND.green}
      >
        {text}
      </text>
    </g>
  );
}

function formatSegmentLabel(
  value: number,
  axisMax: number,
  percentMode = false
): string {
  if (percentMode) return Math.round(value).toString();
  const useLakhCr = axisMax >= 1e5;
  if (useLakhCr) return (value / 1e5).toFixed(1);
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

function padDomain(values: number[], pad: number): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.abs(max) || 1;
  return [Math.max(0, min - range * pad), max + range * pad];
}

/**
 * For Archetype B/C line labels: when the series has many points,
 * showing every value floods the chart. Per the plan: label only
 * first / last / peak / trough. For ≤ 4 points, label all of them.
 */
function selectLineLabelIndices(values: number[]): Set<number> {
  const keep = new Set<number>();
  if (values.length === 0) return keep;
  if (values.length <= 4) {
    values.forEach((_, i) => keep.add(i));
    return keep;
  }
  keep.add(0);
  keep.add(values.length - 1);
  let maxIdx = 0;
  let minIdx = 0;
  values.forEach((v, i) => {
    if (v > values[maxIdx]) maxIdx = i;
    if (v < values[minIdx]) minIdx = i;
  });
  keep.add(maxIdx);
  keep.add(minIdx);
  return keep;
}
