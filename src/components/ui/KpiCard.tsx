import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/cn";
import { ordinalSuffix } from "@/lib/format";

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
  /** Optional trailing-24M sparkline data (chronological, oldest →
   *  newest). When provided, a compact area chart renders at the
   *  bottom of the card. */
  sparkline?: { label: string; value: number }[];
  /** Optional colour token for the sparkline curve. Defaults to chart-1. */
  sparklineColor?: string;
  /** Optional "vs same period last year" delta in percent. Renders as a
   *  small pill below the headline with directional tone (green = up,
   *  red = down, grey near zero). When `delta` is also set, the pill is
   *  rendered AFTER the delta line so cards can show both deltas. */
  yoyPct?: number | null;
  /** Optional 0-100 percentile rank of the latest value vs the
   *  historical series. Renders as a compact pill ("87th pct"). */
  percentile?: number | null;
  /** Optional ratio / context line ("20.6% of total AUM"). Rendered
   *  with subtle styling between the headline and the sparkline. */
  ratio?: string;
}

const YOY_FLAT_THRESHOLD = 0.5;

function yoyTone(pct: number): "up" | "down" | "flat" {
  if (pct > YOY_FLAT_THRESHOLD) return "up";
  if (pct < -YOY_FLAT_THRESHOLD) return "down";
  return "flat";
}

export function KpiCard({
  label,
  value,
  delta,
  trend = "flat",
  note,
  noteHover,
  tone,
  sparkline,
  sparklineColor,
  yoyPct,
  percentile,
  ratio,
}: KpiCardProps) {
  const Icon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  const isDemo = tone === "demo" || tone === "pending";
  const toneBadge =
    tone === "demo" ? "Demo" : tone === "pending" ? "Pending" : null;
  const yoyDir =
    typeof yoyPct === "number" ? yoyTone(yoyPct) : null;

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
      {ratio && (
        <div className="mt-0.5 text-[11px] tabular text-foreground/70">
          {ratio}
        </div>
      )}
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
      {(yoyDir !== null || typeof percentile === "number") && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {yoyDir !== null && (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] tabular font-medium",
                yoyDir === "up" &&
                  !isDemo &&
                  "border-positive/40 bg-positive/10 text-positive",
                yoyDir === "down" &&
                  !isDemo &&
                  "border-negative/40 bg-negative/10 text-negative",
                (yoyDir === "flat" || isDemo) &&
                  "border-border bg-muted text-muted-foreground"
              )}
            >
              {yoyPct !== null && yoyPct !== undefined && yoyPct >= 0 ? "+" : ""}
              {yoyPct !== null && yoyPct !== undefined
                ? yoyPct.toFixed(1)
                : "—"}
              % YoY
            </span>
          )}
          {typeof percentile === "number" && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0 text-[10px] tabular font-medium text-muted-foreground">
              {Math.round(percentile)}
              {ordinalSuffix(Math.round(percentile))} pct
            </span>
          )}
        </div>
      )}
      {sparkline && sparkline.length > 1 && !isDemo && (
        <div className="mt-2 -mx-1">
          <Sparkline data={sparkline} color={sparklineColor} height={28} />
        </div>
      )}
      {note && (
        <div
          className="mt-1.5 text-[10px] tabular text-muted-foreground/80"
          title={noteHover}
        >
          {note}
        </div>
      )}
    </div>
  );
}
