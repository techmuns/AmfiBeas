"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import {
  formatCompactCrSafe,
  formatDelta,
  formatPctSafe,
  UNAVAILABLE,
} from "@/lib/format";
import { cn } from "@/lib/cn";

export interface AmcSearchRow {
  amcSlug: string;
  displayName: string;
  amcNameAsReported: string;
  rank: number;
  avgAum: number;
  marketSharePct: number;
  qoqGrowthPct: number | null;
  yoyGrowthPct: number | null;
  isTop7: boolean;
}

interface Props {
  rows: readonly AmcSearchRow[];
}

function growthClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value > 0.5) return "text-positive";
  if (value < -0.5) return "text-negative";
  return "text-muted-foreground";
}

export function AmcSearchTable({ rows }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.displayName.toLowerCase().includes(q)) return true;
      if (r.amcSlug.toLowerCase().includes(q)) return true;
      if (r.amcNameAsReported.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search AMCs by name or slug…"
          aria-label="Search AMCs"
          className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          No AMC matches &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pl-3 pr-3 font-medium tabular">#</th>
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
                <th className="py-2 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.amcSlug}
                  className="border-b last:border-0 hover:bg-accent/50"
                >
                  <td className="py-3 pl-3 pr-3 text-muted-foreground tabular">
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
                  <td className="py-3 pr-3 text-right">
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
      )}
    </div>
  );
}
