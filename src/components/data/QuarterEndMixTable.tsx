import type { DonutSlice } from "@/components/charts/Donut";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { formatCompactCr } from "@/lib/format";

/**
 * Quarter-end AUM mix as a colored table — the analyst-terminal replacement for
 * the donut. One row per category (Equity / Debt / Liquid / Other) with its AUM,
 * share of total, and a proportional bar in the category's own colour, plus a
 * Total row. A cross-sectional snapshot (no time axis), so a table reads the
 * exact figures a pie chart only hints at. Server component.
 */
interface MixXlsxRow {
  category: string;
  aum: number;
  sharePct: number;
}

const MIX_XLSX_COLUMNS: CsvColumn<MixXlsxRow>[] = [
  { key: "category", header: "Category" },
  { key: "aum", header: "AUM (₹ Cr)" },
  { key: "sharePct", header: "Share (%)" },
];

export function QuarterEndMixTable({
  slices,
  quarterLabel,
}: {
  slices: DonutSlice[];
  quarterLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const xlsxRows: MixXlsxRow[] = slices.map((s) => ({
    category: s.label,
    aum: s.value,
    sharePct: total > 0 ? (s.value / total) * 100 : 0,
  }));
  const fileSuffix = quarterLabel ? `-${quarterLabel.replace(/\s+/g, "-")}` : "";

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <DownloadXlsxButton
          rows={xlsxRows}
          columns={MIX_XLSX_COLUMNS}
          filename={`quarter-end-aum-mix${fileSuffix}.xlsx`}
          sheetName="AUM Mix"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th className="border px-2.5 py-2 text-left font-semibold">
                Category
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">AUM</th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                Share
              </th>
              <th className="w-[34%] border px-2.5 py-2 text-left font-semibold">
                Mix
              </th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => {
              const share = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <tr key={s.key}>
                  <th
                    scope="row"
                    className="whitespace-nowrap border bg-card px-2.5 py-1.5 text-left font-medium"
                  >
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-[2px] align-middle"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </th>
                  <td className="border px-2.5 py-1.5 text-right text-foreground">
                    {formatCompactCr(s.value)}
                  </td>
                  <td className="border px-2.5 py-1.5 text-right text-foreground">
                    {share.toFixed(1)}%
                  </td>
                  <td className="border px-2.5 py-1.5">
                    <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${share}%`, backgroundColor: s.color }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="font-bold">
              <th
                scope="row"
                className="border bg-card px-2.5 py-1.5 text-left"
              >
                Total
              </th>
              <td className="border px-2.5 py-1.5 text-right">
                {formatCompactCr(total)}
              </td>
              <td className="border px-2.5 py-1.5 text-right">100.0%</td>
              <td className="border px-2.5 py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
