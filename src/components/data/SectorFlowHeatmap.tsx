import {
  sectorFlowMeta,
  sectorFlowMonths,
  sectorFlowRows,
  sectorFlowTotals,
} from "@/data/sector-flows";

/**
 * Monthly sector net-flows in a red→yellow→green heatmap, reproduced from a
 * research snapshot (Apr-25 → Apr-26 + CY26 YTD). The cell colour is an Excel-
 * style 3-colour scale computed at render time from the values themselves
 * (clamped to the 5th/95th percentile so a single large outlier doesn't wash
 * the scale out), so the colours stay correct if the underlying numbers change.
 */

// 3-colour scale endpoints (the classic Excel red / yellow / green).
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

const fmt = (v: number): string => v.toLocaleString("en-IN");

export function SectorFlowHeatmap() {
  const all = sectorFlowRows.flatMap((r) => r.monthly).sort((a, b) => a - b);
  const lo = percentile(all, 0.05);
  const mid = percentile(all, 0.5);
  const hi = percentile(all, 0.95);

  const heat = (v: number): string => {
    const c = Math.max(lo, Math.min(hi, v));
    if (c <= mid) return mix(RED, YELLOW, mid === lo ? 1 : (c - lo) / (mid - lo));
    return mix(YELLOW, GREEN, hi === mid ? 0 : (c - mid) / (hi - mid));
  };

  return (
    <div>
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
                colSpan={sectorFlowMonths.length}
                className="border px-2 py-1.5 text-center font-semibold"
              >
                Monthly flows (Rs bn)
              </th>
              <th
                rowSpan={2}
                className="border px-2 py-1.5 text-right align-bottom font-semibold leading-tight"
              >
                CY26 YTD
                <br />
                flows
                <br />
                (Rs bn)
              </th>
            </tr>
            <tr>
              {sectorFlowMonths.map((m) => (
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
            {sectorFlowRows.map((row) => (
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
                    {fmt(v)}
                  </td>
                ))}
                <td className="border bg-card px-2 py-1 text-right font-semibold tabular-nums">
                  {fmt(row.ytd)}
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <th scope="row" className="border bg-card px-2 py-1.5 text-left">
                Total
              </th>
              {sectorFlowTotals.monthly.map((v, i) => (
                <td
                  key={i}
                  className="border bg-card px-2 py-1.5 text-right tabular-nums"
                >
                  {fmt(v)}
                </td>
              ))}
              <td className="border bg-card px-2 py-1.5 text-right tabular-nums">
                {fmt(sectorFlowTotals.ytd)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Net flows by sector (₹ bn) · {sectorFlowMonths[0]} →{" "}
        {sectorFlowMonths[sectorFlowMonths.length - 1]} · {sectorFlowMeta.source}{" "}
        (static).
      </p>
    </div>
  );
}
