import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/cn";
import { fmtBps } from "@/lib/units";
import {
  amcMetricTrend,
  fiscalPeriodSortKey,
} from "@/data/amc-narratives";

const LISTED_AMC_SLUGS = [
  "hdfc",
  "icici-pru",
  "nippon",
  "absl",
  "uti",
  "canara-robeco",
] as const;

const DISPLAY_NAME: Record<string, string> = {
  hdfc: "HDFC",
  "icici-pru": "ICICI Pru",
  nippon: "Nippon",
  absl: "ABSL",
  uti: "UTI",
  "canara-robeco": "Canara Robeco",
};

const ROW_COLOR: Record<string, string> = {
  hdfc: "hsl(var(--chart-1))",
  "icici-pru": "hsl(var(--chart-2))",
  nippon: "hsl(var(--chart-3))",
  absl: "hsl(var(--chart-4))",
  uti: "hsl(var(--chart-5))",
  "canara-robeco": "hsl(280, 60%, 55%)",
};

interface RowVm {
  slug: string;
  series: { label: string; value: number }[];
  latest: number | null;
  prev: number | null;
  delta: number | null;
}

/**
 * Cohort-level Unique Investor Share — one row per listed AMC showing
 * the latest disclosed share, QoQ delta, and a trailing sparkline.
 * Rows are sorted by latest share desc; AMCs that don't disclose this
 * metric appear last with an explicit "Not disclosed" cell.
 */
export function CohortUniqueInvestorShare() {
  const rows: RowVm[] = LISTED_AMC_SLUGS.map((slug) => {
    const series = amcMetricTrend(slug, "uniqueInvestorShare");
    // Ensure series is sorted by fiscal period (oldest → newest)
    const ordered = [...series].sort(
      (a, b) => fiscalPeriodSortKey(a.label) - fiscalPeriodSortKey(b.label)
    );
    const latest = ordered.length > 0 ? ordered[ordered.length - 1].value : null;
    const prev = ordered.length > 1 ? ordered[ordered.length - 2].value : null;
    const delta =
      latest !== null && prev !== null ? latest - prev : null;
    return { slug, series: ordered, latest, prev, delta };
  }).sort((a, b) => {
    // Disclosed rows first, sorted desc by latest; undisclosed at the bottom.
    if (a.latest === null && b.latest === null)
      return a.slug.localeCompare(b.slug);
    if (a.latest === null) return 1;
    if (b.latest === null) return -1;
    return b.latest - a.latest;
  });
  const disclosed = rows.filter((r) => r.latest !== null);
  if (disclosed.length === 0) {
    return (
      <Card
        title="Unique Investor Share — Cohort"
        subtitle="No AMC has disclosed this metric in the available concalls yet."
        stackHeader
      />
    );
  }
  // Pick a common period label for the subtitle: most recent disclosed.
  const mostRecentPeriod = disclosed
    .flatMap((r) => r.series.map((p) => p.label))
    .sort((a, b) => fiscalPeriodSortKey(b) - fiscalPeriodSortKey(a))[0];
  return (
    <Card
      title="Unique Investor Share — Cohort"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Each AMC&rsquo;s share of the industry&rsquo;s unique investor
            base — a clean read on retail breadth being captured. Sorted
            by latest disclosed share. Rising arrow = AMC is gaining
            share QoQ; falling = losing.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            Source: company concall disclosures · latest period{" "}
            {mostRecentPeriod}
          </p>
        </div>
      }
      stackHeader
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">AMC</th>
              <th className="py-2 pr-3 text-right font-medium tabular">
                Latest share
              </th>
              <th className="py-2 pr-3 text-right font-medium tabular">
                QoQ Δ
              </th>
              <th className="py-2 pr-3 text-right font-medium">As of</th>
              <th className="py-2 pr-1 text-right font-medium">
                Trajectory
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.slug}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                <td className="py-2.5 pr-3">
                  <Link
                    href={`/amc/${r.slug}`}
                    className="flex items-center gap-2 text-foreground/90 hover:opacity-80"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: ROW_COLOR[r.slug] }}
                    />
                    <span className="font-medium">
                      {DISPLAY_NAME[r.slug]}
                    </span>
                  </Link>
                </td>
                <td className="py-2.5 pr-3 text-right tabular">
                  {r.latest !== null ? (
                    <span className="font-medium">
                      {r.latest.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/60">
                      Not disclosed
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    "py-2.5 pr-3 text-right tabular text-[11.5px]",
                    r.delta === null && "text-muted-foreground/50",
                    r.delta !== null && r.delta > 0 && "text-positive",
                    r.delta !== null && r.delta < 0 && "text-negative",
                    r.delta === 0 && "text-muted-foreground"
                  )}
                >
                  {r.delta === null
                    ? "—"
                    : `${r.delta > 0 ? "▲ " : r.delta < 0 ? "▼ " : ""}${fmtBps(r.delta)}`}
                </td>
                <td className="py-2.5 pr-3 text-right text-[10.5px] text-muted-foreground">
                  {r.series.length > 0
                    ? r.series[r.series.length - 1].label
                    : "—"}
                </td>
                <td className="py-2.5 pr-1 text-right">
                  {r.series.length >= 2 ? (
                    <div className="ml-auto inline-block w-[90px]">
                      <Sparkline
                        data={r.series}
                        color={ROW_COLOR[r.slug]}
                        height={28}
                      />
                    </div>
                  ) : r.series.length === 1 ? (
                    <span className="text-[10px] text-muted-foreground/60">
                      Single data point
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/60">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
