import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { amcAaumQuarterlySnapshot } from "@/data/source";
import { amcIndexRows } from "@/data/amc-detail";
import {
  formatCompactCrSafe,
  formatDelta,
  formatPctSafe,
  UNAVAILABLE,
} from "@/lib/format";
import { cn } from "@/lib/cn";

export default function AmcListPage() {
  const data = amcIndexRows();
  const fetchedAt = amcAaumQuarterlySnapshot.meta.generatedAt;
  const fetchedDate = new Date(fetchedAt).toISOString().slice(0, 10);

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="AMCs"
          subtitle="No AMFI Fundwise AAUM data available."
        />
      </div>
    );
  }

  const subtitle = `${data.rows.length} AMCs · AMFI MF Average AUM, ${data.fiscalLabel} · fetched ${fetchedDate}`;

  return (
    <div className="space-y-6">
      <PageHeader title="AMCs" subtitle={subtitle} />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pl-1 pr-3 font-medium tabular">#</th>
                <th className="py-2 pr-4 font-medium">AMC</th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  AAUM
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  Share
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  QoQ
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  YoY
                </th>
                <th className="py-2 pr-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.amcSlug}
                  className="border-b last:border-0 hover:bg-accent/50"
                >
                  <td className="py-3 pl-1 pr-3 text-muted-foreground tabular">
                    {r.rank}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/amc/${r.amcSlug}`}
                        className="font-medium hover:underline"
                      >
                        {r.displayName}
                      </Link>
                      {r.isTop7 && (
                        <span className="inline-flex items-center rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] tabular text-positive">
                          Top 7
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(r.avgAum)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                    {formatPctSafe(r.marketSharePct, 2)}
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular",
                      growthClass(r.qoqGrowthPct)
                    )}
                  >
                    {r.qoqGrowthPct === null
                      ? UNAVAILABLE
                      : formatDelta(r.qoqGrowthPct)}
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular",
                      growthClass(r.yoyGrowthPct)
                    )}
                  >
                    {r.yoyGrowthPct === null
                      ? UNAVAILABLE
                      : formatDelta(r.yoyGrowthPct)}
                  </td>
                  <td className="py-3 pr-1 text-right">
                    <Link
                      href={`/amc/${r.amcSlug}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      aria-label={`Open ${r.displayName}`}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            <strong className="text-foreground">Source:</strong> AMFI Fundwise
            AAUM disclosure (regulator-mandated, MF-only by construction).
          </div>
          <div>
            <strong className="text-foreground">Universe:</strong> all AMCs
            with at least one quarter of <code>status=&quot;ok&quot;</code> AAUM
            data in the snapshot. AMFI does not publish PMS / AIF / offshore /
            advisory / alternates here.
          </div>
          <div>
            <strong className="text-foreground">Snapshot quarter:</strong>{" "}
            {data.fiscalLabel} ({data.quarter}) · last fetched {fetchedDate}.
          </div>
        </div>
      </Card>
    </div>
  );
}

function growthClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value > 0.5) return "text-positive";
  if (value < -0.5) return "text-negative";
  return "text-muted-foreground";
}
