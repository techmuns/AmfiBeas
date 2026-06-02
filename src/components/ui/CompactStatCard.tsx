import { cn } from "@/lib/cn";

/** Direction tone for a delta, with a small dead-zone around zero so
 *  tiny moves read as flat (grey) rather than green/red noise. */
function deltaTone(pct: number | null | undefined): "up" | "down" | "flat" {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "flat";
  if (pct > 0.05) return "up";
  if (pct < -0.05) return "down";
  return "flat";
}

/** Compact +/-x.x% pill with a trailing period label (YoY / QoQ),
 *  tone-coloured for direction. Renders "—" when the delta is unknown. */
function DeltaPill({
  label,
  pct,
}: {
  label: string;
  pct: number | null | undefined;
}) {
  const tone = deltaTone(pct);
  const text =
    typeof pct === "number" && Number.isFinite(pct)
      ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
      : "—";
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 rounded-full border px-1.5 py-0.5 text-[10px] tabular font-medium",
        tone === "up" && "border-positive/40 bg-positive/10 text-positive",
        tone === "down" && "border-negative/40 bg-negative/10 text-negative",
        tone === "flat" && "border-border bg-muted text-muted-foreground"
      )}
    >
      {text}
      <span className="font-normal opacity-60">{label}</span>
    </span>
  );
}

interface CompactStatCardProps {
  label: string;
  value: string;
  /** Year-over-year % change. Pass null when unavailable. */
  yoyPct: number | null;
  /** Quarter-over-quarter % change. Pass null when unavailable. */
  qoqPct: number | null;
}

/**
 * Small, single-metric card: label, headline value, and two compact
 * delta pills (YoY + QoQ). Deliberately lighter than {@link KpiCard} —
 * no sparkline, no source note — for dense rows where the deltas are
 * the story. Used by /financials.
 */
export function CompactStatCard({
  label,
  value,
  yoyPct,
  qoqPct,
}: CompactStatCardProps) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular tracking-tight">
        {value}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <DeltaPill label="YoY" pct={yoyPct} />
        <DeltaPill label="QoQ" pct={qoqPct} />
      </div>
    </div>
  );
}
