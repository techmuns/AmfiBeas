"use client";

import { cn } from "@/lib/cn";

export interface SectorAllocationRow {
  label: string;
  fund: number | null;
  peerAvg: number | null;
}

interface Props {
  data: SectorAllocationRow[];
  fundName: string;
  peerLabel: string;
}

function fmtPct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`;
}
function fmtDelta(v: number | null): string {
  return v === null || !Number.isFinite(v)
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100)).toLocaleString("en-IN")} bps`;
}
function tone(v: number | null): string {
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 0.05)
    return "text-muted-foreground";
  return v > 0 ? "text-positive" : "text-negative";
}

/**
 * Sector allocation (% of AUM) for the selected fund vs the same-category peer
 * average — a table. This is a cross-sectional (sector-by-sector) read, not a
 * time series, so per the client's "tables over charts" rule it renders as a
 * table rather than paired bars. Δ = fund − peer average, tinted green where
 * the fund is overweight, red where underweight.
 */
export function SectorAllocationChart({ data, fundName, peerLabel }: Props) {
  if (data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className="bg-muted/60 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Sector</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {fundName}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {peerLabel}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Δ vs peers
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const delta =
                r.fund !== null && r.peerAvg !== null
                  ? r.fund - r.peerAvg
                  : null;
              return (
                <tr key={r.label} className="border-b last:border-0">
                  <th
                    scope="row"
                    className="px-3 py-2 text-left font-medium text-foreground"
                  >
                    {r.label}
                  </th>
                  <td className="px-3 py-2 text-right text-foreground">
                    {fmtPct(r.fund)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {fmtPct(r.peerAvg)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-medium",
                      tone(delta)
                    )}
                  >
                    {fmtDelta(delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
