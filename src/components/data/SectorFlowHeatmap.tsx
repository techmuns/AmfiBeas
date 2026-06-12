"use client";

import { useState } from "react";
import {
  sectorFlowMonths,
  sectorFlowRows,
  sectorFlowTotals,
} from "@/data/sector-flows";
import sectorGross from "@/data/portfolio-tracker/sector-gross-flows.json";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";

/**
 * Monthly sector flows in a red→yellow→green heatmap with a Net / Gross
 * toggle (client request: gross shows activity, net shows whether money is
 * actually entering or leaving a sector).
 *
 *  - NET: the 13-month research-snapshot history (Apr-25 → Apr-26).
 *  - GROSS BUYING / GROSS SELLING: computed from the tracked scheme holdings
 *    (sum of positive / negative stock-level share changes × implied price),
 *    available for the months the holdings window covers.
 *
 * Cell colour is an Excel-style 3-colour scale computed at render time from
 * the active view's own values (clamped at the 5th/95th percentile).
 */

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

type Lens = "net" | "grossBuy" | "grossSell";

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

interface GrossData {
  meta: { months: string[]; funds: number };
  rows: { sector: string; grossBuy: number[]; grossSell: number[]; net: number[] }[];
  totals: { grossBuy: number[]; grossSell: number[]; net: number[] };
}
const gross = sectorGross as GrossData;

function buildView(lens: Lens): View {
  if (lens === "net") {
    return {
      months: sectorFlowMonths,
      rows: sectorFlowRows.map((r) => ({
        sector: r.sector,
        monthly: r.monthly.map((v) => v * 100), // Rs bn → ₹ Cr
        total: r.ytd * 100,
      })),
      totals: sectorFlowTotals.monthly.map((v) => v * 100),
      totalsTotal: sectorFlowTotals.ytd * 100,
      totalLabel: "CY26 YTD",
      caption:
        "Net flows — whether money is actually entering or leaving each sector. 13-month research-snapshot history.",
    };
  }
  const key = lens === "grossBuy" ? "grossBuy" : "grossSell";
  const monthsAsc = [...gross.meta.months].reverse(); // stored newest-first
  const reorder = (xs: number[]) => [...xs].reverse();
  const sign = lens === "grossSell" ? -1 : 1;
  return {
    months: monthsAsc,
    rows: gross.rows
      .map((r) => {
        const monthly = reorder(r[key]).map((v) => sign * v);
        return {
          sector: r.sector,
          monthly,
          total: monthly.reduce((s, v) => s + v, 0),
        };
      })
      .sort(
        (a, b) =>
          Math.abs(b.monthly[b.monthly.length - 1]) -
          Math.abs(a.monthly[a.monthly.length - 1])
      ),
    totals: reorder(gross.totals[key]).map((v) => sign * v),
    totalsTotal: gross.totals[key].reduce((s, v) => s + sign * v, 0),
    totalLabel: "Window total",
    caption:
      lens === "grossBuy"
        ? `Gross buying — total money entering each sector before netting sells. Computed from ${gross.meta.funds} tracked active-equity schemes.`
        : `Gross selling — total money leaving each sector before netting buys (shown as negatives). Computed from ${gross.meta.funds} tracked active-equity schemes.`,
  };
}

const LENSES: { id: Lens; label: string }[] = [
  { id: "net", label: "Net" },
  { id: "grossBuy", label: "Gross buying" },
  { id: "grossSell", label: "Gross selling" },
];

export function SectorFlowHeatmap() {
  const [lens, setLens] = useState<Lens>("net");
  const view = buildView(lens);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border bg-card p-0.5">
          {LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLens(l.id)}
              aria-pressed={lens === l.id}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                lens === l.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename={`sector-flows-${lens}.xlsx`}
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
