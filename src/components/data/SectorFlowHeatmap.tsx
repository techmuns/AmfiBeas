"use client";

import sectorGrossFlows from "@/data/portfolio-tracker/sector-gross-flows.json";
import { UNCLASSIFIED } from "@/data/sector-classification";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

/**
 * Monthly NET sector flows in a red→yellow→green heatmap — whether money is
 * actually entering or leaving each sector. Computed live from the MFs Portfolio
 * Tracker equity holdings (scripts/build-sector-gross-flows.ts): for every
 * month-over-month pair, net = Σ(share change × implied price) across all
 * active-equity schemes, bucketed by the tracker's classifySector. Refreshes
 * with the holdings, so the newest month tracks the latest available portfolios.
 *
 * Cell colour is an Excel-style 3-colour scale computed at render time from the
 * values (clamped at the 5th/95th percentile).
 */

interface SectorGrossFlows {
  meta: { generatedAt: string; months: string[]; funds: number; note: string };
  rows: { sector: string; grossBuy: number[]; grossSell: number[]; net: number[] }[];
  totals: { grossBuy: number[]; grossSell: number[]; net: number[] };
}

const RED = [248, 105, 107];
const YELLOW = [255, 235, 132];
const GREEN = [99, 190, 123];

function mix(a: number[], b: number[], t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgb(${r}, ${g}, ${bl})`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Client formatting rules: full Indian-grouped ₹ Cr numbers (no "K"/"L"
// compaction); negatives in brackets.
const fmtCr = (cr: number): string => {
  const abs = Math.round(Math.abs(cr)).toLocaleString("en-IN");
  return cr < 0 ? `(${abs})` : abs;
};

interface ViewRow {
  sector: string;
  monthly: number[]; // ₹ Cr, oldest → newest
  total: number; // trailing total for the right-hand column
}
interface View {
  months: string[]; // oldest → newest
  rows: ViewRow[];
  totals: number[]; // per month
  totalsTotal: number;
  totalLabel: string;
  caption: string;
}

function buildView(): View {
  const data = sectorGrossFlows as SectorGrossFlows;
  // The JSON stores months newest → oldest; the heatmap reads oldest → newest.
  const months = [...data.meta.months].reverse();
  const rows: ViewRow[] = data.rows
    .map((r) => ({
      sector: r.sector,
      monthly: [...r.net].reverse(),
      total: r.net.reduce((s, v) => s + v, 0),
    }))
    // Biggest net inflows on top; Unclassified sinks to the bottom.
    .sort(
      (a, b) =>
        (a.sector === UNCLASSIFIED ? 1 : 0) - (b.sector === UNCLASSIFIED ? 1 : 0) ||
        b.total - a.total,
    );
  const latestMonth = months[months.length - 1] ?? "";
  return {
    months,
    rows,
    totals: [...data.totals.net].reverse(),
    totalsTotal: data.totals.net.reduce((s, v) => s + v, 0),
    totalLabel: "Net total",
    caption: `Net flows — whether money is actually entering or leaving each sector, computed from MFs Portfolio Tracker holdings across ${data.meta.funds.toLocaleString(
      "en-IN",
    )} active-equity schemes (latest ${latestMonth}). Sectors use the tracker's classification; net = month-over-month share change × price (buys − sells), ₹ Cr.`,
  };
}

export function SectorFlowHeatmap() {
  const view = buildView();

  const all = view.rows.flatMap((r) => r.monthly).sort((a, b) => a - b);
  const lo = percentile(all, 0.05);
  const mid = percentile(all, 0.5);
  const hi = percentile(all, 0.95);

  const heat = (v: number): string => {
    const c = Math.max(lo, Math.min(hi, v));
    if (c <= mid) return mix(RED, YELLOW, mid === lo ? 1 : (c - lo) / (mid - lo));
    return mix(YELLOW, GREEN, hi === mid ? 0 : (c - mid) / (hi - mid));
  };

  type ExportRow = Record<string, string | number>;
  const exportColumns: CsvColumn<ExportRow>[] = [
    { key: "sector", header: "Sector" },
    ...view.months.map((m) => ({ key: m, header: `${m} (₹ Cr)` })),
    { key: "total", header: `${view.totalLabel} (₹ Cr)` },
  ];
  const exportRows: ExportRow[] = [
    ...view.rows.map((r) => {
      const row: ExportRow = { sector: r.sector };
      view.months.forEach((m, i) => (row[m] = Math.round(r.monthly[i])));
      row.total = Math.round(r.total);
      return row;
    }),
    (() => {
      const row: ExportRow = { sector: "Total" };
      view.months.forEach((m, i) => (row[m] = Math.round(view.totals[i])));
      row.total = Math.round(view.totalsTotal);
      return row;
    })(),
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename="sector-flows-net.xlsx"
          sheetName="Sector Flows"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{view.caption}</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="border px-2 py-1.5 text-left align-bottom font-semibold"
              >
                Sector
              </th>
              <th
                colSpan={view.months.length}
                className="border px-2 py-1.5 text-center font-semibold"
              >
                Monthly flows (₹ Cr)
              </th>
              <th
                rowSpan={2}
                className="border px-2 py-1.5 text-right align-bottom font-semibold leading-tight"
              >
                {view.totalLabel}
                <br />
                (₹ Cr)
              </th>
            </tr>
            <tr>
              {view.months.map((m) => (
                <th
                  key={m}
                  className="whitespace-nowrap border px-2 py-1 text-right font-semibold"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.sector}>
                <th
                  scope="row"
                  className="whitespace-nowrap border bg-card px-2 py-1 text-left font-medium"
                >
                  {row.sector}
                </th>
                {row.monthly.map((v, i) => (
                  <td
                    key={i}
                    className="border px-2 py-1 text-right tabular-nums"
                    style={{ backgroundColor: heat(v), color: "#111827" }}
                  >
                    {fmtCr(v)}
                  </td>
                ))}
                <td className="border bg-card px-2 py-1 text-right font-semibold tabular-nums">
                  {fmtCr(row.total)}
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <th scope="row" className="border bg-card px-2 py-1.5 text-left">
                Total
              </th>
              {view.totals.map((v, i) => (
                <td
                  key={i}
                  className="border bg-card px-2 py-1.5 text-right tabular-nums"
                >
                  {fmtCr(v)}
                </td>
              ))}
              <td className="border bg-card px-2 py-1.5 text-right tabular-nums">
                {fmtCr(view.totalsTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
