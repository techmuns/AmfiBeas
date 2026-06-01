"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface NavPerformancePoint {
  date: string; // ISO YYYY-MM-DD
  nav: number;
  rebased: number; // start anchor = 100
  // Phase 3.10A: optional benchmark (Nifty 500) rebased value at the same
  // date. Present only when the benchmark series covers that date. Used
  // to render a muted dashed second line.
  benchmarkRebased?: number;
}

interface Props {
  data: NavPerformancePoint[];
  /** Anchor used for rebasing (the start NAV); shown in the tooltip header. */
  anchorDate: string;
  anchorNav: number;
  /** Optional benchmark overlay (Phase 3.10A). When present, the chart adds
   *  a dashed muted line for `benchmarkRebased` from the same `data` array
   *  and includes the benchmark in the tooltip. `label` shows up in the
   *  tooltip so the user knows which index they're seeing. */
  benchmark?: {
    label: string;
    anchorDate: string;
    anchorLevel: number;
  };
  height?: number;
}

/** Single-series rebased-to-100 NAV chart for the Trends tab. Renders the
 *  selected fund's series over the chosen timeframe with raw NAV + rebased
 *  value in the tooltip. Inherits the dashboard's existing chart style
 *  (CartesianGrid + muted axes + gradient fill — same look as AreaTrend).
 *  Phase 3.10A optionally overlays a Nifty 500 benchmark as a muted dashed
 *  line; the fund series stays the visual primary. */
export function NavPerformanceChart({
  data,
  anchorDate,
  anchorNav,
  benchmark,
  height = 280,
}: Props) {
  const last = data[data.length - 1];
  const change = last ? last.rebased - 100 : 0;
  const color =
    change >= 0 ? "hsl(var(--positive))" : "hsl(var(--negative))";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="navPerformanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="hsl(var(--border))"
          vertical={false}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="date"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={48}
          tickFormatter={(iso: string) => formatTickDate(iso)}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => v.toFixed(0)}
          domain={["auto", "auto"]}
        />
        <Tooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={(p) => (
            <PerfTooltip
              {...p}
              anchorDate={anchorDate}
              anchorNav={anchorNav}
              benchmark={benchmark}
            />
          )}
        />
        <Area
          type="monotone"
          dataKey="rebased"
          stroke={color}
          strokeWidth={1.75}
          fill="url(#navPerformanceFill)"
          dot={false}
          isAnimationActive={false}
        />
        {benchmark && (
          <Line
            type="monotone"
            dataKey="benchmarkRebased"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.25}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface RechartsTooltipPayload {
  payload?: NavPerformancePoint;
}

function PerfTooltip({
  active,
  payload,
  anchorDate,
  anchorNav,
  benchmark,
}: {
  active?: boolean;
  payload?: RechartsTooltipPayload[];
  anchorDate: string;
  anchorNav: number;
  benchmark?: { label: string; anchorDate: string; anchorLevel: number };
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  const diff = row.rebased - 100;
  const bench = typeof row.benchmarkRebased === "number" ? row.benchmarkRebased : null;
  const benchDiff = bench !== null ? bench - 100 : null;
  const excess = bench !== null ? row.rebased - bench : null; // pp on rebased=100 scale
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{formatTooltipDate(row.date)}</div>
      <div className="mt-1 text-muted-foreground">
        NAV ₹<span className="tabular text-foreground">{row.nav.toFixed(4)}</span>
      </div>
      <div className="text-muted-foreground">
        Rebased{" "}
        <span className="tabular text-foreground">{row.rebased.toFixed(2)}</span>{" "}
        <span
          className={
            diff >= 0
              ? "text-positive tabular"
              : "text-negative tabular"
          }
        >
          ({diff >= 0 ? "+" : ""}
          {diff.toFixed(2)})
        </span>
      </div>
      {benchmark && (
        <div className="text-muted-foreground">
          {benchmark.label}{" "}
          <span className="tabular text-foreground">
            {bench !== null ? bench.toFixed(2) : "—"}
          </span>{" "}
          {benchDiff !== null && (
            <span
              className={
                benchDiff >= 0
                  ? "text-positive tabular"
                  : "text-negative tabular"
              }
            >
              ({benchDiff >= 0 ? "+" : ""}
              {benchDiff.toFixed(2)})
            </span>
          )}
          {excess !== null && (
            <span className="ml-1 text-[10px] tabular text-muted-foreground/80">
              · vs {benchmark.label}: {excess >= 0 ? "+" : ""}
              {excess.toFixed(2)}pp
            </span>
          )}
        </div>
      )}
      <div className="mt-1 text-[10px] text-muted-foreground/80">
        Anchor {formatTooltipDate(anchorDate)} · ₹{anchorNav.toFixed(4)} = 100
      </div>
    </div>
  );
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatTickDate(iso: string): string {
  const [y, m] = iso.split("-");
  if (!y || !m) return iso;
  return `${MONTH_ABBR[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

function formatTooltipDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d} ${MONTH_ABBR[Number(m) - 1] ?? m} ${y}`;
}
