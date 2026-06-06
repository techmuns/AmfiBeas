"use client";

import { cn } from "@/lib/cn";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

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
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}pp`;
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

  type XRow = {
    sector: string;
    fund: number | null;
    peerAvg: number | null;
    delta: number | null;
  };
  const exportRows: XRow[] = data.map((r) => ({
    sector: r.label,
    fund: r.fund,
    peerAvg: r.peerAvg,
    delta: r.fund !== null && r.peerAvg !== null ? r.fund - r.peerAvg : null,
  }));
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "sector", header: "Sector" },
    { key: "fund", header: `${fundName} (%)` },
    { key: "peerAvg", header: `${peerLabel} (%)` },
    { key: "delta", header: "Δ vs peers (pp)" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename="sector-allocation.xlsx"
          sheetName="Sector Allocation"
        />
      </div>
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
