import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  /** Optional small caption rendered below the value (e.g. source / date). */
  note?: string;
}

export function KpiCard({
  label,
  value,
  delta,
  trend = "flat",
  note,
}: KpiCardProps) {
  const Icon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;

  return (
    <div className="rounded-lg border bg-card px-5 py-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular tracking-tight">
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-xs tabular",
            trend === "up" && "text-positive",
            trend === "down" && "text-negative",
            trend === "flat" && "text-muted-foreground"
          )}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {delta}
        </div>
      )}
      {note && (
        <div className="mt-1 text-[10px] tabular text-muted-foreground/80">
          {note}
        </div>
      )}
    </div>
  );
}
