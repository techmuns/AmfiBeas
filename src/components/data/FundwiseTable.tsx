import { cn } from "@/lib/cn";
import { toneBg, toneText } from "@/lib/tone";
import type { FundwiseMatrix, FundwiseCell } from "@/data/amc-peer-universe";

/**
 * Fundwise (per-AMC) AUM & market-share heatmap — the per-AMC counterpart
 * to the industry flow table. Rows are AMCs (largest first), columns are
 * quarters. The metric toggle switches the cells between market share %
 * (with the QoQ Δ in bps), AAUM (₹ Cr) and QoQ growth %. Cells are tinted
 * green / red by momentum (share gained-lost, or growth) so a fund manager
 * can read "ICICI vs HDFC share, +X bps" straight off the grid.
 *
 * Server component — colours derived at render.
 */
export type FundwiseMetric = "share" | "aaum" | "growth";

function fmtShare(v: number): string {
  return `${v.toFixed(2)}%`;
}
function fmtBps(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v))}`;
}
function fmtGrowth(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}
function fmtAaum(v: number): string {
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

/** The signed value a cell is tinted by (share Δ bps, or growth %). */
function tintValue(cell: FundwiseCell, metric: FundwiseMetric): number | null {
  return metric === "share" ? cell.shareDeltaBps : cell.growthPct;
}

const METRIC_LABEL: Record<FundwiseMetric, string> = {
  share: "Market share (%) · QoQ Δ bps",
  aaum: "AAUM (₹ Cr)",
  growth: "QoQ AUM growth (%)",
};

export function FundwiseTable({
  matrix,
  metric,
}: {
  matrix: FundwiseMatrix;
  metric: FundwiseMetric;
}) {
  if (matrix.rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No per-AMC AAUM data ingested yet.
      </div>
    );
  }

  // Per-table colour scale for the tinting metric.
  let maxAbs = 0.01;
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (!cell) continue;
      const v = tintValue(cell, metric);
      if (typeof v === "number" && Number.isFinite(v)) {
        maxAbs = Math.max(maxAbs, Math.abs(v));
      }
    }
  }

  const th = "border px-2 py-1.5 text-right font-semibold whitespace-nowrap";

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border bg-card px-2 py-1.5 text-left font-semibold whitespace-nowrap">
              {METRIC_LABEL[metric]}
            </th>
            {matrix.quarterLabels.map((q) => (
              <th key={q} className={th}>
                {q}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.amcSlug}>
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap border bg-card px-2 py-1 text-left font-medium"
                title={row.displayName}
              >
                {row.displayName}
              </th>
              {row.cells.map((cell, i) => {
                if (!cell) {
                  return (
                    <td
                      key={i}
                      className="border px-2 py-1 text-right text-muted-foreground"
                    >
                      —
                    </td>
                  );
                }
                const tv = tintValue(cell, metric);
                if (metric === "share") {
                  return (
                    <td
                      key={i}
                      className="border px-2 py-1 text-right"
                      style={toneBg(tv, maxAbs)}
                    >
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-foreground">
                          {fmtShare(cell.sharePct)}
                        </span>
                        {cell.shareDeltaBps !== null && (
                          <span className={cn("text-[9px]", toneText(cell.shareDeltaBps))}>
                            {fmtBps(cell.shareDeltaBps)}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                }
                if (metric === "growth") {
                  return (
                    <td
                      key={i}
                      className={cn("border px-2 py-1 text-right", toneText(cell.growthPct))}
                      style={toneBg(cell.growthPct, maxAbs)}
                    >
                      {cell.growthPct === null ? "—" : fmtGrowth(cell.growthPct)}
                    </td>
                  );
                }
                // aaum — value tinted by QoQ growth (momentum)
                return (
                  <td
                    key={i}
                    className="border px-2 py-1 text-right text-foreground"
                    style={toneBg(cell.growthPct, maxAbs)}
                  >
                    {fmtAaum(cell.aaum)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
