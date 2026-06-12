import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { toneBg, toneText } from "@/lib/tone";
import { cn } from "@/lib/cn";
import { formatCompactCr } from "@/lib/format";
import type { AaumBridgeRow } from "@/data/amfi-quarterly";

const AAUM_BRIDGE_XLSX_COLUMNS: CsvColumn<AaumBridgeRow>[] = [
  { key: "quarterLabel", header: "Quarter" },
  { key: "aaum", header: "AAUM last-month (₹ Cr)" },
  { key: "deltaAaum", header: "Delta AAUM QoQ (₹ Cr)" },
  { key: "netInflow", header: "Net inflow / new money (₹ Cr)" },
  { key: "residual", header: "Market & other / residual (₹ Cr)" },
  { key: "residualPctOfDelta", header: "Market & other (% of AUM change)" },
];

// Signed ₹: "+₹1,20,000 Cr" for a rise; falls come back already bracketed
// from formatCompactCr ("(₹45,000 Cr)") per the client formatting rules.
function signedCr(v: number): string {
  return v >= 0 ? `+${formatCompactCr(v)}` : formatCompactCr(v);
}

/**
 * AAUM bridge residual table — how much of each quarter's QoQ change in
 * industry AAUM is NOT explained by reported net inflows (residual = ΔAAUM −
 * net inflow). Sign-tinted; newest quarter first; with an Excel export. See
 * @/data/amfi-quarterly#quarterlyAaumBridge — the residual is a flow-adjusted
 * AAUM change, not a clean mark-to-market figure (the caveat is rendered).
 */
export function AaumBridgeTable({ rows }: { rows: AaumBridgeRow[] }) {
  if (rows.length === 0) return null;
  const ordered = [...rows].reverse(); // newest first
  const maxAbs = Math.max(
    1,
    ...rows.flatMap((r) => [
      Math.abs(r.deltaAaum),
      Math.abs(r.netInflow),
      Math.abs(r.residual),
    ])
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <DownloadXlsxButton
          rows={rows}
          columns={AAUM_BRIDGE_XLSX_COLUMNS}
          filename="aaum-bridge-residual.xlsx"
          sheetName="AAUM Bridge"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th className="border px-2.5 py-2 text-left font-semibold">
                Quarter
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                AAUM
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                AUM Change
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                New Money
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Market &amp; Other
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Market &amp; Other %
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => (
              <tr key={r.quarter}>
                <th
                  scope="row"
                  className="whitespace-nowrap border bg-card px-2.5 py-1.5 text-left font-medium"
                >
                  {r.quarterLabel}
                </th>
                <td className="border px-2.5 py-1.5 text-right text-foreground">
                  {formatCompactCr(r.aaum)}
                </td>
                <td
                  className={cn(
                    "border px-2.5 py-1.5 text-right",
                    toneText(r.deltaAaum)
                  )}
                  style={toneBg(r.deltaAaum, maxAbs)}
                >
                  {signedCr(r.deltaAaum)}
                </td>
                <td
                  className={cn(
                    "border px-2.5 py-1.5 text-right",
                    toneText(r.netInflow)
                  )}
                  style={toneBg(r.netInflow, maxAbs)}
                >
                  {signedCr(r.netInflow)}
                </td>
                <td
                  className={cn(
                    "border px-2.5 py-1.5 text-right font-medium",
                    toneText(r.residual)
                  )}
                  style={toneBg(r.residual, maxAbs)}
                >
                  {signedCr(r.residual)}
                </td>
                <td
                  className={cn(
                    "border px-2.5 py-1.5 text-right",
                    toneText(r.residualPctOfDelta)
                  )}
                >
                  {r.residualPctOfDelta === null
                    ? "—"
                    : `${r.residualPctOfDelta.toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Each quarter&rsquo;s AUM change splits into{" "}
        <span className="font-medium text-foreground">New Money</span> (net
        inflow) and{" "}
        <span className="font-medium text-foreground">Market &amp; Other</span>{" "}
        (the residual = Δ AAUM − net inflow). The residual is{" "}
        <span className="font-medium">not</span> a clean mark-to-market figure:
        it blends market movement, within-quarter timing, an averaging mismatch
        (AMFI&rsquo;s quarterly AAUM is the last-month average, not a true
        quarterly average, while net inflow is the quarter&rsquo;s flow sum), and
        any classification / reporting differences. Source: AMFI Quarterly
        Report.
      </p>
    </div>
  );
}
