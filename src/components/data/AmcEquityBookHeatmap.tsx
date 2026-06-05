import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { toneBg } from "@/lib/tone";
import { formatCompactCr } from "@/lib/format";
import type {
  AmcEquityBookRow,
  EquityBookDiagnostics,
} from "@/data/amc-equity-book";

const EQUITY_BOOK_XLSX_COLUMNS: CsvColumn<AmcEquityBookRow>[] = [
  { key: "amc", header: "AMC" },
  { key: "activeEquityCr", header: "Active equity AUM (₹ Cr)" },
  { key: "passiveEquityCr", header: "Passive equity AUM (₹ Cr)" },
  { key: "totalEquityCr", header: "Total equity AUM (₹ Cr)" },
  { key: "activePct", header: "Active (%)" },
  { key: "passivePct", header: "Passive (%)" },
  { key: "equitySharePct", header: "Equity market share (%)" },
  { key: "schemes", header: "Schemes" },
];

const ACTIVE_COLOR = "hsl(var(--chart-1))";
const PASSIVE_COLOR = "hsl(var(--chart-4))";

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-[2px] align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Per-AMC equity active/passive heatmap — the UI for the derived equity book
 * (@/data/amc-equity-book). Rows are AMCs (largest equity book first), with
 * active / passive / total equity AUM, the active-passive split (% + a split
 * bar), and equity market share; the Passive % column is green-tinted by
 * magnitude so passive-heavy houses (UTI, SBI) jump out. Excel export covers
 * every AMC. A prominent caveat block makes the derived-proxy nature explicit.
 * Server component.
 */
export function AmcEquityBookHeatmap({
  rows,
  diagnostics,
  topN = 25,
}: {
  rows: AmcEquityBookRow[];
  diagnostics: EquityBookDiagnostics;
  topN?: number;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, topN);
  const maxShare = Math.max(1, ...shown.map((r) => r.equitySharePct));

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">
          Derived proxy — not official AMFI per-AMC disclosure.
        </span>{" "}
        Equity only (no debt / liquid / hybrid). Built from the RupeeVest scheme
        index ({diagnostics.snapshotMonth} snapshot ·{" "}
        {diagnostics.equitySchemesConsidered} equity schemes &gt; ~₹500 Cr ·{" "}
        {formatCompactCr(diagnostics.industryEquityCr)} across{" "}
        {diagnostics.amcCount} AMCs). Passive = ETFs + Index Funds; active = all
        other equity classes. Schemes are mapped to fund houses by name, so a few
        AMFI-mandated ETFs (e.g. CPSE / Bharat 22) can be mis-attributed.
        Name-normalised dedup applied ({diagnostics.schemesDropped} dropped).
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Swatch color={ACTIVE_COLOR} /> Active
          </span>
          <span className="inline-flex items-center gap-1">
            <Swatch color={PASSIVE_COLOR} /> Passive
          </span>
          <span>Top {Math.min(topN, rows.length)} of {rows.length} by equity AUM</span>
        </div>
        <DownloadXlsxButton
          rows={rows}
          columns={EQUITY_BOOK_XLSX_COLUMNS}
          filename={`amc-equity-active-passive-${diagnostics.snapshotAsOf?.slice(0, 7) ?? "latest"}.xlsx`}
          sheetName="Equity Book"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2.5 py-2 text-left font-semibold">
                AMC
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Active Eq
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Passive
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Total
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Active %
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Passive %
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Eq Share
              </th>
              <th className="w-[16%] border px-2.5 py-2 text-left font-semibold">
                Active / Passive
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.amc}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap border bg-card px-2.5 py-1.5 text-left font-medium"
                >
                  {r.amc}
                </th>
                <td className="border px-2.5 py-1.5 text-right text-foreground">
                  {formatCompactCr(r.activeEquityCr)}
                </td>
                <td className="border px-2.5 py-1.5 text-right text-foreground">
                  {formatCompactCr(r.passiveEquityCr)}
                </td>
                <td className="border px-2.5 py-1.5 text-right font-medium text-foreground">
                  {formatCompactCr(r.totalEquityCr)}
                </td>
                <td className="border px-2.5 py-1.5 text-right text-muted-foreground">
                  {r.activePct.toFixed(0)}%
                </td>
                <td
                  className="border px-2.5 py-1.5 text-right text-foreground"
                  style={toneBg(r.passivePct, 100)}
                >
                  {r.passivePct.toFixed(0)}%
                </td>
                <td
                  className="border px-2.5 py-1.5 text-right text-foreground"
                  style={toneBg(r.equitySharePct, maxShare)}
                >
                  {r.equitySharePct.toFixed(1)}%
                </td>
                <td className="border px-2.5 py-1.5">
                  <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted">
                    <div
                      className="h-full"
                      style={{
                        width: `${r.activePct}%`,
                        backgroundColor: ACTIVE_COLOR,
                      }}
                    />
                    <div
                      className="h-full"
                      style={{
                        width: `${r.passivePct}%`,
                        backgroundColor: PASSIVE_COLOR,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
