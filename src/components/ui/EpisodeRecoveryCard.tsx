import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatCompactCrSafe } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { EpisodeRecoveryRow } from "@/data/episode-recovery";

interface EpisodeRecoveryCardProps {
  rows: EpisodeRecoveryRow[];
}

/**
 * Episode Recovery Tracker — for each historical drawdown episode,
 * show how long it took active-equity flow to recover to its
 * pre-episode baseline.
 *
 * Layout: one row per episode, with the trough depth (left) and a
 * "recovery months" badge (right). Episodes that haven't recovered
 * yet show an amber "ongoing" badge.
 */
export function EpisodeRecoveryCard({ rows }: EpisodeRecoveryCardProps) {
  if (rows.length === 0) return null;
  return (
    <Card
      title="Episode Recovery Tracker"
      subtitle="How long active-equity flow took to recover after each historical drawdown · Source: AMFI Monthly Report + Nifty 500 cycle classifier"
    >
      <ul className="divide-y divide-border/40">
        {rows.map((r) => (
          <li
            key={`${r.title}-${r.startMonth}`}
            className="grid grid-cols-[minmax(120px,_1fr)_2fr_minmax(120px,_auto)] items-center gap-4 py-3"
          >
            <div>
              <div className="text-[13px] font-medium text-foreground">
                {r.title}
              </div>
              <div className="text-[10px] tabular text-muted-foreground">
                {r.startMonth} → {r.endMonth}
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-2 text-[11.5px] tabular">
                <span className="text-muted-foreground">
                  Pre-baseline {formatCompactCrSafe(r.preBaselineFlow)}/mo
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-negative">
                  Trough {formatSignedCr(r.troughFlow)}
                </span>
                {r.troughVsBaselinePct !== null && (
                  <span className="text-[10px] tabular text-muted-foreground">
                    ({r.troughVsBaselinePct.toFixed(0)}%)
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] tabular text-muted-foreground">
                Trough month {r.troughMonth}
                {r.recoveryMonth ? ` · recovered ${r.recoveryMonth}` : ""}
              </div>
            </div>
            <RecoveryBadge months={r.recoveryMonths} />
          </li>
        ))}
      </ul>
      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Baseline = trailing-3M average flow BEFORE the episode started.
        Recovery = first month after the trough where flow ≥ baseline.
        <InfoTooltip label="Episode list is sourced from the dashboard's cycle-phase classifier (Nifty 500 in drawdown for ≥2 consecutive months). 'Ongoing' means the latest available month is still below the pre-episode baseline." />
      </p>
    </Card>
  );
}

function formatSignedCr(v: number): string {
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

function RecoveryBadge({ months }: { months: number | null }) {
  if (months === null) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold tabular text-amber-700 dark:text-amber-400">
        Ongoing
      </span>
    );
  }
  // Colour by speed: <= 3M = green, <= 6M = neutral, > 6M = amber.
  const tone =
    months <= 3
      ? "border-positive/40 bg-positive/10 text-positive"
      : months <= 6
        ? "border-foreground/30 bg-muted text-foreground"
        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold tabular",
        tone
      )}
    >
      Recovered in {months} {months === 1 ? "month" : "months"}
    </span>
  );
}
