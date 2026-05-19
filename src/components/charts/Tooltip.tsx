"use client";

import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

/**
 * Per-row extra context shown below the main tooltip rows. Pre-formatted
 * — the tooltip doesn't apply any number formatting. Used when a chart's
 * indexed bar value (e.g. "106.9%" vs trailing-12M-avg) needs to be
 * unpacked into the underlying actual + reference values.
 */
export interface TooltipExtraRow {
  label: string;
  value: string;
}

interface ChartTooltipProps extends TooltipProps<ValueType, NameType> {
  formatValue?: (n: number, name?: string) => string;
  labelFormatter?: (label: string) => string;
  /**
   * When true, render the tooltip rows in reverse of Recharts' default
   * payload order. Useful for stacked areas where the visual top layer
   * is the last series declared — reversing the tooltip then matches
   * the top-to-bottom visual stack reading order.
   */
  reverseOrder?: boolean;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  labelFormatter,
  reverseOrder = false,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const rows = reverseOrder ? [...payload].reverse() : payload;
  // Recharts attaches the full data row to each payload entry under
  // `.payload`. If the caller threaded extras through the chart data
  // (via BarSeries' `data[i].extras`), surface them under the main
  // rows so the bar's indexed value can be unpacked into actual /
  // reference values without inventing a parallel tooltip component.
  const extras =
    (payload[0] as { payload?: { _extras?: TooltipExtraRow[] } } | undefined)
      ?.payload?._extras;

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      {label !== undefined && (
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {rows.map((entry, i) => {
          const v = typeof entry.value === "number" ? entry.value : Number(entry.value);
          const name = String(entry.name ?? "");
          return (
            <div
              key={`${name}-${i}`}
              className="flex items-center justify-between gap-3 tabular"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: entry.color as string }}
                />
                <span className="text-muted-foreground">{name}</span>
              </span>
              <span className="font-medium">
                {formatValue ? formatValue(v, name) : v.toLocaleString("en-IN")}
              </span>
            </div>
          );
        })}
      </div>
      {extras && extras.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-border/60 pt-1.5">
          {extras.map((e, i) => (
            <div
              key={`${e.label}-${i}`}
              className="flex items-center justify-between gap-3 tabular"
            >
              <span className="text-muted-foreground">{e.label}</span>
              <span className="font-medium">{e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
