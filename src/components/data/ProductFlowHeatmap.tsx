import { toneBg, toneText } from "@/lib/tone";
import { cn } from "@/lib/cn";
import { formatMonthLabel } from "@/lib/format";
import type { FeeMixMonth } from "@/data/fee-mix";

type FlowKey =
  | "activeEquityFlow"
  | "equityHybridFlow"
  | "solutionFlow"
  | "debtFlow"
  | "arbitrageFlow"
  | "passiveOtherFlow";

const FLOW_ROWS: { key: FlowKey; label: string; tier: "high" | "low" }[] = [
  { key: "activeEquityFlow", label: "Active equity", tier: "high" },
  { key: "equityHybridFlow", label: "Equity & balanced-adv. hybrid", tier: "high" },
  { key: "solutionFlow", label: "Solution-oriented", tier: "high" },
  { key: "debtFlow", label: "Debt & liquid", tier: "low" },
  { key: "arbitrageFlow", label: "Arbitrage", tier: "low" },
  { key: "passiveOtherFlow", label: "Passive & other (Group V)", tier: "low" },
];
const FIRST_LOW = FLOW_ROWS.findIndex((r) => r.tier === "low");

// Compact signed ₹ Cr for dense heatmap cells (header carries the unit).
function fmtFlowCell(v: number): string {
  const a = Math.abs(v);
  if (a < 0.5) return "0";
  const s = v >= 0 ? "+" : "−";
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}k`;
  return `${s}${Math.round(a)}`;
}

/**
 * Net flows by product category as a sign-tinted heatmap — rows are products
 * (the high-fee active book above the low-fee debt/passive book), columns are
 * the trailing months, cells are net inflow in ₹ Cr (green inflow / red
 * outflow, shaded by magnitude). Reuses the fee-mix monthly buckets, so the
 * full series is already in the Fee Mix export. Server component.
 */
export function ProductFlowHeatmap({ months }: { months: FeeMixMonth[] }) {
  const strip = months.slice(-12);
  if (strip.length === 0) return null;
  let maxAbs = 1;
  for (const m of strip) {
    for (const r of FLOW_ROWS) maxAbs = Math.max(maxAbs, Math.abs(m[r.key]));
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2 py-1.5 text-left font-semibold">
                Product (₹ Cr)
              </th>
              {strip.map((m) => (
                <th
                  key={m.month}
                  className="whitespace-nowrap border px-1.5 py-1.5 text-center font-medium"
                >
                  {formatMonthLabel(m.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLOW_ROWS.map((r, i) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 whitespace-nowrap border bg-card px-2 py-1 text-left font-medium",
                    i === FIRST_LOW && "border-t-2 border-t-foreground/30"
                  )}
                >
                  {r.label}
                </th>
                {strip.map((m) => {
                  const v = m[r.key];
                  return (
                    <td
                      key={m.month}
                      className={cn(
                        "border px-1.5 py-1 text-center",
                        i === FIRST_LOW && "border-t-2 border-t-foreground/30",
                        toneText(v)
                      )}
                      style={toneBg(v, maxAbs)}
                      title={`${r.label} · ${formatMonthLabel(m.month)}: ${fmtFlowCell(v)} Cr`}
                    >
                      {fmtFlowCell(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Industry net inflows (₹ Cr) by product —{" "}
        <span className="text-positive">green = inflow</span>,{" "}
        <span className="text-negative">red = outflow</span>, shaded by
        magnitude within the grid. The high-fee book (active equity, equity
        hybrid, solution) sits above the low-fee book (debt &amp; liquid,
        arbitrage, passive Group V). The full monthly series is in the Fee Mix
        export above. Source: AMFI Monthly Report category flows.
      </p>
    </div>
  );
}
