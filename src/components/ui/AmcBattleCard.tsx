import Link from "next/link";
import { cn } from "@/lib/cn";
import { Sparkline } from "@/components/charts/Sparkline";

interface AmcBattleCardProps {
  slug: string;
  displayName: string;
  /** Position by AAUM (1 = largest). */
  rank: number;
  outOf: number;
  marketSharePct: number;
  qoqGrowthPct: number | null;
  yoyGrowthPct: number | null;
  isTop7: boolean;
  /** Trailing-N-quarter AAUM sparkline. */
  sparkline?: { label: string; value: number }[];
  className?: string;
}

function tierBadge(rank: number, isTop7: boolean): {
  label: string;
  cls: string;
} {
  if (isTop7) return { label: "T1", cls: "border-positive/40 bg-positive/10 text-positive" };
  if (rank <= 15) return { label: "T2", cls: "border-foreground/30 bg-muted text-foreground" };
  return { label: "T3", cls: "border-border bg-muted text-muted-foreground" };
}

function growthTone(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct > 0.5) return "text-positive";
  if (pct < -0.5) return "text-negative";
  return "text-muted-foreground";
}

function fmtGrowth(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/**
 * Stylised "trading-card" view for an AMC. Replaces the dry table
 * row with a compact card that has clear hierarchy:
 *   - rank chip (top-left)
 *   - tier badge (top-right)
 *   - large AMC name
 *   - market-share headline
 *   - QoQ + YoY growth pills
 *   - trailing-N-quarter sparkline
 *
 * Designed to be rendered as a grid or a horizontally scrollable
 * rolodex.
 */
export function AmcBattleCard({
  slug,
  displayName,
  rank,
  outOf,
  marketSharePct,
  qoqGrowthPct,
  yoyGrowthPct,
  isTop7,
  sparkline,
  className,
}: AmcBattleCardProps) {
  const tier = tierBadge(rank, isTop7);
  return (
    <Link
      href={`/amc/${slug}`}
      className={cn(
        "group block rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular tracking-tight text-foreground">
            #{rank}
          </span>
          <span className="text-[10px] tabular text-muted-foreground">
            of {outOf}
          </span>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular tracking-tight",
            tier.cls
          )}
        >
          {tier.label}
        </span>
      </div>
      <div className="mt-2.5 truncate text-sm font-semibold tracking-tight group-hover:underline" title={displayName}>
        {displayName}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular tracking-tight">
        {marketSharePct.toFixed(2)}%
      </div>
      <div className="text-[10px] tabular text-muted-foreground">
        of industry AAUM
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] tabular">
        <span className={cn("font-medium", growthTone(qoqGrowthPct))}>
          QoQ {fmtGrowth(qoqGrowthPct)}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className={cn("font-medium", growthTone(yoyGrowthPct))}>
          YoY {fmtGrowth(yoyGrowthPct)}
        </span>
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2 -mx-1">
          <Sparkline data={sparkline} color="hsl(var(--chart-1))" height={28} />
        </div>
      )}
    </Link>
  );
}
