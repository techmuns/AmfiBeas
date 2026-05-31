"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface NavPerformancePoint {
  date: string; // ISO YYYY-MM-DD
  nav: number;
  rebased: number; // start anchor = 100
}

interface Props {
  data: NavPerformancePoint[];
  /** Anchor used for rebasing (the start NAV); shown in the tooltip header. */
  anchorDate: string;
  anchorNav: number;
  height?: number;
}

/** Single-series rebased-to-100 NAV chart for the Trends tab. Renders the
 *  selected fund's series over the chosen timeframe with raw NAV + rebased
 *  value in the tooltip. Inherits the dashboard's existing chart style
 *  (CartesianGrid + muted axes + gradient fill — same look as AreaTrend). */
export function NavPerformanceChart({
  data,
  anchorDate,
  anchorNav,
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
          content={(p) => <PerfTooltip {...p} anchorDate={anchorDate} anchorNav={anchorNav} />}
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
}: {
  active?: boolean;
  payload?: RechartsTooltipPayload[];
  anchorDate: string;
  anchorNav: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  const diff = row.rebased - 100;
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
