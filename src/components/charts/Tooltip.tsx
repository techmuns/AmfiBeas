"use client";

import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

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
  /**
   * When true, order the tooltip rows by their numeric value descending —
   * largest at the top, smallest at the bottom (non-numeric values sink to
   * the end). Use on multi-series line charts where readers want to rank the
   * series at the hovered point. Takes precedence over `reverseOrder`.
   */
  sortByValueDesc?: boolean;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  labelFormatter,
  reverseOrder = false,
  sortByValueDesc = false,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  let rows = payload;
  if (sortByValueDesc) {
    rows = [...payload].sort((a, b) => {
      const av = Number(a.value);
      const bv = Number(b.value);
      const aOk = Number.isFinite(av);
      const bOk = Number.isFinite(bv);
      if (!aOk && !bOk) return 0;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return bv - av;
    });
  } else if (reverseOrder) {
    rows = [...payload].reverse();
  }

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
    </div>
  );
}
