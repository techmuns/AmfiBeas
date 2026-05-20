import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCompactCr, isUnavailable } from "@/lib/format";
import { Sparkline } from "@/components/charts/Sparkline";

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
  /** Optional 8-quarter (or longer) AAUM series rendered as an inline
   *  sparkline so the table row carries trend context. */
  sparkline?: { label: string; value: number }[];
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

function growthChip(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    return "border-border bg-muted text-muted-foreground";
  }
  if (pct > 1) return "border-positive/40 bg-positive/10 text-positive";
  if (pct < -1) return "border-negative/40 bg-negative/10 text-negative";
  return "border-border bg-muted text-muted-foreground";
}

/**
 * AMC Ranked Market Share — flat ranked table with inline AAUM
 * sparkline. Columns: rank · name · share % · AAUM · QoQ bps chip ·
 * YoY bps chip · sparkline. Subtle background tint on the top 3 rows.
 * No bar fills.
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

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[720px] text-[11px] tabular">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-1.5 w-10">#</th>
            <th className="px-2 py-1.5">AMC</th>
            <th className="px-2 py-1.5 text-right">Share</th>
            <th className="px-2 py-1.5 text-right">AAUM</th>
            <th className="px-2 py-1.5 text-right">QoQ</th>
            <th className="px-2 py-1.5 text-right">YoY</th>
            <th className="px-2 py-1.5 w-[120px]">8Q AAUM</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((b, i) => {
            const rank = b.rank ?? i + 1;
            const isTop3 = i < 3;
            return (
              <tr
                key={b.slug}
                className={cn(
                  "border-t border-border/60 hover:bg-accent/30",
                  isTop3 && "bg-foreground/[0.025]"
                )}
              >
                <td className="px-2 py-2 text-muted-foreground">{rank}</td>
                <td className="px-2 py-2 font-medium text-foreground">
                  <Link
                    href={`${basePath}/${b.slug}`}
                    className="hover:underline"
                    title={b.displayName}
                  >
                    {b.displayName}
                  </Link>
                </td>
                <td className="px-2 py-2 text-right font-semibold text-foreground">
                  {b.marketSharePct.toFixed(2)}%
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">
                  {!isUnavailable(b.aum) ? formatCompactCr(b.aum as number) : "—"}
                </td>
                <td className="px-2 py-2 text-right">
                  <span
                    className={cn(
                      "inline-block whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px]",
                      growthChip(b.qoqGrowthPct)
                    )}
                  >
                    {formatBpsDelta(b.qoqGrowthPct)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span
                    className={cn(
                      "inline-block whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px]",
                      growthChip(b.yoyGrowthPct)
                    )}
                  >
                    {formatBpsDelta(b.yoyGrowthPct)}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {b.sparkline && b.sparkline.length >= 2 ? (
                    <Sparkline
                      data={b.sparkline}
                      color="hsl(var(--chart-1))"
                      height={24}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
