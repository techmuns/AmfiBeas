import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  /** Optional small caption rendered below the value (e.g. source / date). */
  note?: string;
  /** Optional title-attribute text shown when hovering the note. Used by
   *  the AMFI Monthly Snapshot to surface the full PDF filename without
   *  cluttering the visible source line. Ignored when no note is set. */
  noteHover?: string;
  /**
   * Visual treatment indicating data status. Mirrors Card's `tone`:
   *   - undefined / "live"  : default styling (live sourced data)
   *   - "demo"              : grayscale + dashed border + Demo badge
   *   - "pending"           : same muted treatment but Pending badge
   * Used by /monthly to visually separate the live AMFI Snapshot
   * cards from the older generated/demo KPI cards.
   */
  tone?: "live" | "demo" | "pending";
}

export function KpiCard({
  label,
  value,
  delta,
  trend = "flat",
  note,
  noteHover,
  tone,
}: KpiCardProps) {
  const Icon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  const isDemo = tone === "demo" || tone === "pending";
  const toneBadge =
    tone === "demo" ? "Demo" : tone === "pending" ? "Pending" : null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-5 py-4 shadow-sm",
        isDemo && "border-dashed border-muted-foreground/40 opacity-80"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {toneBadge && (
          <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0 text-[9px] uppercase tracking-wide text-muted-foreground">
            {toneBadge}
          </span>
        )}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tabular tracking-tight",
          isDemo && "text-muted-foreground"
        )}
      >
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-xs tabular",
            trend === "up" && !isDemo && "text-positive",
            trend === "down" && !isDemo && "text-negative",
            (trend === "flat" || isDemo) && "text-muted-foreground"
          )}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {delta}
        </div>
      )}
      {note && (
        <div
          className="mt-1 text-[10px] tabular text-muted-foreground/80"
          title={noteHover}
        >
          {note}
        </div>
      )}
    </div>
  );
}
