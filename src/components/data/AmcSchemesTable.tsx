import Link from "next/link";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { formatCompactCr } from "@/lib/format";
import type { AmcScheme } from "@/data/amc-schemes";

interface SchemeXlsxRow {
  name: string;
  classification: string;
  style: string;
  aumCr: number | null;
  schemecode: string;
  holdings: string;
}

const SCHEMES_XLSX_COLUMNS: CsvColumn<SchemeXlsxRow>[] = [
  { key: "name", header: "Scheme" },
  { key: "classification", header: "Classification" },
  { key: "style", header: "Style" },
  { key: "aumCr", header: "AUM (₹ Cr)" },
  { key: "schemecode", header: "Scheme code" },
  { key: "holdings", header: "Holdings tracked" },
];

function snapshotLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/**
 * AMC → scheme drill-down table. Lists every scheme the tracker carries for the
 * AMC (largest AUM first) with its classification, Active/Passive style and
 * AUM; equity schemes with tracked holdings deep-link into the MFs Portfolio
 * Tracker. Pre-formatted rows + format-less columns keep the Excel export
 * serialisable across the server/client boundary. Server component.
 */
export function AmcSchemesTable({
  displayName,
  schemes,
}: {
  displayName: string;
  schemes: AmcScheme[];
}) {
  if (schemes.length === 0) return null;
  const equity = schemes.filter((s) => s.isEquity).length;
  const passive = schemes.filter((s) => s.isPassive).length;
  const trackedAum = schemes.reduce((t, s) => t + (s.aumTotalCr ?? 0), 0);
  const snapshot = snapshotLabel(schemes.find((s) => s.aumAsOf)?.aumAsOf ?? null);

  const xlsxRows: SchemeXlsxRow[] = schemes.map((s) => ({
    name: s.name,
    classification: s.classification ?? "",
    style: s.isPassive ? "Passive" : "Active",
    aumCr: s.aumTotalCr,
    schemecode: s.schemecode,
    holdings: s.holdingsCode ? "Yes" : "No",
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {schemes.length} tracked schemes · {equity} equity · {passive} passive
          · {formatCompactCr(trackedAum)} tracked AUM · {snapshot} snapshot
        </p>
        <DownloadXlsxButton
          rows={xlsxRows}
          columns={SCHEMES_XLSX_COLUMNS}
          filename={`amc-schemes-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.xlsx`}
          sheetName="Schemes"
        />
      </div>

      <div className="max-h-[34rem] overflow-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="border-b px-2.5 py-2 text-left font-semibold">
                Scheme
              </th>
              <th className="border-b px-2.5 py-2 text-left font-semibold">
                Classification
              </th>
              <th className="border-b px-2.5 py-2 text-center font-semibold">
                Style
              </th>
              <th className="border-b px-2.5 py-2 text-right font-semibold">
                AUM
              </th>
              <th className="border-b px-2.5 py-2 text-right font-semibold">
                Holdings
              </th>
            </tr>
          </thead>
          <tbody>
            {schemes.map((s) => (
              <tr key={s.schemecode} className="border-b last:border-0">
                <td className="px-2.5 py-1.5 text-left font-medium text-foreground">
                  {s.name}
                </td>
                <td className="px-2.5 py-1.5 text-left text-muted-foreground">
                  {s.classification ?? "—"}
                </td>
                <td className="px-2.5 py-1.5 text-center">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px]",
                      s.isPassive
                        ? "border-[hsl(var(--chart-4))]/40 bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))]"
                        : "border-border bg-muted text-muted-foreground"
                    )}
                  >
                    {s.isPassive ? "Passive" : "Active"}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 text-right text-foreground">
                  {s.aumTotalCr == null ? "—" : formatCompactCr(s.aumTotalCr)}
                </td>
                <td className="px-2.5 py-1.5 text-right">
                  {s.holdingsCode ? (
                    <Link
                      href={`/mfs-portfolio-tracker?fund=${s.holdingsCode}`}
                      className="text-primary hover:underline"
                    >
                      View ↗
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Derived — </span>not an
        official AMC scheme master. From the RupeeVest scheme index ({snapshot}{" "}
        snapshot), mapped to {displayName} by name (amcOf), so coverage is the
        tracked &gt; ~₹500 Cr universe and a few AMFI-mandated ETFs can be
        mis-attributed. Style is Passive for ETF / Index Fund classes, Active
        otherwise. &ldquo;View&rdquo; opens the scheme&rsquo;s tracked equity
        holdings in the MFs Portfolio Tracker (equity sleeves only).
      </p>
    </div>
  );
}
