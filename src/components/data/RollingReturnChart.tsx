"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtBps } from "@/lib/units";

export interface RollingChartPoint {
  date: string; // window END date, ISO
  fund: number; // rolling return %
  benchmark?: number; // benchmark rolling return % (same window), when available
}

interface Props {
  data: RollingChartPoint[];
  /** e.g. "3Y" — used in the tooltip + axis context. */
  windowLabel: string;
  benchmarkLabel?: string | null;
  height?: number;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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

/**
 * Rolling-return chart for the Returns & Ranking tab: the fund's rolling
 * `windowLabel` return at every day in the history (solid), optionally over a
 * benchmark rolling line (dashed), with a zero baseline. Signed % on the Y
 * axis (returns dip below zero), so unlike the rebased NAV chart this uses
 * plain lines rather than an area fill.
 */
export function RollingReturnChart({
  data,
  windowLabel,
  benchmarkLabel,
  height = 280,
}: Props) {
  const fundStroke = "hsl(var(--positive))";
  const benchmarkStroke = "hsl(220, 70%, 55%)";
  const hasBenchmark = data.some((d) => typeof d.benchmark === "number");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-4 px-1 text-[10px] tabular text-muted-foreground/80">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-[2px] w-5 rounded-sm"
            style={{ backgroundColor: fundStroke }}
          />
          Fund · rolling {windowLabel}
        </span>
        {hasBenchmark && benchmarkLabel && (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0 w-5 border-t-2 border-dashed"
              style={{ borderColor: benchmarkStroke }}
            />
            {benchmarkLabel}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
            tickFormatter={formatTickDate}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            domain={["auto", "auto"]}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.4} />
          <Tooltip
            cursor={{ stroke: "hsl(var(--border))" }}
            content={(p) => (
              <RollingTooltip
                {...p}
                windowLabel={windowLabel}
                benchmarkLabel={benchmarkLabel ?? null}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="fund"
            stroke={fundStroke}
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, fill: fundStroke, stroke: fundStroke }}
            isAnimationActive={false}
          />
          {hasBenchmark && (
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke={benchmarkStroke}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 3, fill: benchmarkStroke, stroke: benchmarkStroke }}
              isAnimationActive={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface RechartsPayload {
  payload?: RollingChartPoint;
}
function RollingTooltip({
  active,
  payload,
  windowLabel,
  benchmarkLabel,
}: {
  active?: boolean;
  payload?: RechartsPayload[];
  windowLabel: string;
  benchmarkLabel: string | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  const bench = typeof row.benchmark === "number" ? row.benchmark : null;
  const excess = bench !== null ? row.fund - bench : null;
  const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{formatTooltipDate(row.date)}</div>
      <div className="mt-1 text-muted-foreground">
        Rolling {windowLabel}{" "}
        <span className={row.fund >= 0 ? "text-positive tabular" : "text-negative tabular"}>
          {sign(row.fund)}
        </span>
      </div>
      {benchmarkLabel && bench !== null && (
        <div className="text-muted-foreground">
          {benchmarkLabel}{" "}
          <span className={bench >= 0 ? "text-positive tabular" : "text-negative tabular"}>
            {sign(bench)}
          </span>
          {excess !== null && (
            <span className="ml-1 text-[10px] tabular text-muted-foreground/80">
              · vs {benchmarkLabel}: {fmtBps(excess)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
