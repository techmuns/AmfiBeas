"use client";

import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

interface ChartTooltipProps extends TooltipProps<ValueType, NameType> {
  formatValue?: (n: number, name?: string) => string;
  labelFormatter?: (label: string) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      {label !== undefined && (
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => {
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
