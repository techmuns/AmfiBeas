import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCompactCr, formatPctSafe, isUnavailable } from "@/lib/format";

export interface SkyscraperBuilding {
  slug: string;
  displayName: string;
  marketSharePct: number;
  qoqGrowthPct: number | null;
  /** Latest AAUM (₹ Cr). */
  aum?: number | null;
  /** Universe-rank by AAUM. */
  rank?: number | null;
  /** YoY AAUM growth %. */
  yoyGrowthPct?: number | null;
  /** Rank change since the earliest point on record (positive = climbed). */
  rankChange?: number | null;
}

interface SkyscraperCityProps {
  buildings: SkyscraperBuilding[];
  basePath?: string;
  className?: string;
}

function formatBpsDelta(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "—";
  const bps = pct * 100;
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  return `${sign}${Math.abs(bps).toFixed(0)} bps`;
}

function growthTone(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "text-muted-foreground";
  if (pct > 1) return "text-positive";
  if (pct < -1) return "text-negative";
  return "text-muted-foreground";
}

/**
 * AMC Ranked Market Share — top-N AMCs rendered as a horizontal
 * ranked-bar list. Each row carries the AMC's market share, AAUM,
 * QoQ-bps and YoY-bps inline. Sorted by share descending. Top-3 get
 * a darker accent; everyone else uses a muted neutral fill. The
 * bar width scales relative to the leader so the read is purely
 * about relative size.
 */
export function SkyscraperCity({
  buildings,
  basePath = "/amc",
  className,
}: SkyscraperCityProps) {
  if (buildings.length === 0) return null;
  const sorted = [...buildings].sort(
    (a, b) => b.marketSharePct - a.marketSharePct
  );
  const top = sorted[0]?.marketSharePct ?? 1;

  return (
    <div className={cn("w-full", className)}>
      <ul className="space-y-1.5">
        {sorted.map((b, i) => {
          const rank = b.rank ?? i + 1;
          const width = top > 0 ? Math.max(2, (b.marketSharePct / top) * 100) : 0;
          const accent = i < 3;
          const rankArrow =
            typeof b.rankChange === "number" && b.rankChange !== 0
              ? b.rankChange > 0
                ? "▲"
                : "▼"
              : "";
          const rankTone =
            typeof b.rankChange === "number" && b.rankChange !== 0
              ? b.rankChange > 0
                ? "text-positive"
                : "text-negative"
              : "text-muted-foreground";
          const title = [
            b.displayName,
            `Rank ${rank}`,
            !isUnavailable(b.aum) ? formatCompactCr(b.aum as number) : null,
            `Share ${b.marketSharePct.toFixed(2)}%`,
            typeof b.qoqGrowthPct === "number"
              ? `QoQ ${b.qoqGrowthPct >= 0 ? "+" : ""}${b.qoqGrowthPct.toFixed(1)}%`
              : null,
            typeof b.yoyGrowthPct === "number"
              ? `YoY ${b.yoyGrowthPct >= 0 ? "+" : ""}${b.yoyGrowthPct.toFixed(1)}%`
              : null,
            rankArrow
              ? `Rank ${rankArrow}${Math.abs(b.rankChange as number)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={b.slug}>
              <Link
                href={`${basePath}/${b.slug}`}
                title={title}
                className="group grid grid-cols-[28px_minmax(120px,1.4fr)_minmax(120px,2fr)_auto] items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/40"
              >
                <span className="text-[11px] tabular text-muted-foreground">
                  {rank}
                </span>
                <span className="truncate text-[12px] font-medium text-foreground">
                  {b.displayName}
                </span>
                <span className="relative h-3 w-full overflow-hidden rounded-sm bg-muted/40">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-sm",
                      accent ? "bg-foreground/70" : "bg-foreground/35"
                    )}
                    style={{ width: `${width}%` }}
                  />
                </span>
                <span className="shrink-0 inline-flex items-center gap-2 text-[11px] tabular text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {b.marketSharePct.toFixed(2)}%
                  </span>
                  {!isUnavailable(b.aum) && (
                    <span className="whitespace-nowrap">{formatCompactCr(b.aum as number)}</span>
                  )}
                  <span className={cn("whitespace-nowrap", growthTone(b.qoqGrowthPct))}>
                    QoQ {formatBpsDelta(b.qoqGrowthPct)}
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap",
                      growthTone(b.yoyGrowthPct)
                    )}
                  >
                    YoY{" "}
                    {typeof b.yoyGrowthPct === "number"
                      ? formatBpsDelta(b.yoyGrowthPct)
                      : "—"}
                  </span>
                  {rankArrow && (
                    <span className={cn("whitespace-nowrap", rankTone)}>
                      {rankArrow}
                      {Math.abs(b.rankChange as number)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] text-muted-foreground">
        Bar width scales relative to the top AMC&rsquo;s market share.
        QoQ / YoY shown in basis points (bps). Click an AMC for full
        detail. {formatPctSafe(sorted[0]?.marketSharePct, 2)} is the top
        share.
      </p>
    </div>
  );
}
