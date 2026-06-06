import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import type { ProductShareRow } from "@/data/aggregate";
import { formatMonthLabel } from "@/lib/format";

export type ProductShareDisplayRow = ProductShareRow & { displayName: string };

const COLS: { key: keyof ProductShareRow; label: string }[] = [
  { key: "activeEquitySharePct", label: "Active Equity" },
  { key: "debtSharePct", label: "Debt" },
  { key: "liquidSharePct", label: "Liquid" },
  { key: "hybridSharePct", label: "Hybrid" },
  { key: "passiveSharePct", label: "Passive" },
];

const XLSX_COLUMNS: CsvColumn<ProductShareDisplayRow>[] = [
  { key: "displayName", header: "AMC" },
  { key: "activeEquitySharePct", header: "Active equity share (%)" },
  { key: "debtSharePct", header: "Debt share (%)" },
  { key: "liquidSharePct", header: "Liquid share (%)" },
  { key: "hybridSharePct", header: "Hybrid share (%)" },
  { key: "passiveSharePct", header: "Passive share (%)" },
];

/**
 * Market share WITHIN each product category, per AMC — a latest-month heatmap
 * table. Each cell is the AMC's share of the industry's AUM in that category
 * (shares sum to ~100% down a column); shade scales with the share so the
 * leaders in each product stand out. Lets an analyst spot where a house is
 * over- or under-weight vs its overall share (e.g. equity-tilted = the
 * high-fee end). Server component — colours derived at render.
 */
export function MarketShareByProduct({
  month,
  rows,
}: {
  month: string;
  rows: ProductShareDisplayRow[];
}) {
  if (rows.length === 0) return null;

  // Per-column max so each product column reads on its own intensity scale.
  const maxByCol = new Map<string, number>();
  for (const c of COLS) {
    let mx = 0.01;
    for (const r of rows) {
      const v = r[c.key] as number;
      if (Number.isFinite(v)) mx = Math.max(mx, v);
    }
    maxByCol.set(c.key as string, mx);
  }
  const tint = (v: number, max: number) => ({
    backgroundColor: `hsl(152 60% 42% / ${Math.min(0.42, (v / max) * 0.42).toFixed(3)})`,
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Each AMC&rsquo;s share of industry AUM within each product ·{" "}
          {formatMonthLabel(month)} · shares sum to ~100% down each column.
        </p>
        <DownloadXlsxButton
          rows={rows}
          columns={XLSX_COLUMNS}
          filename="market-share-by-product.xlsx"
          sheetName="Share by Product"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2 py-1.5 text-left font-semibold">
                AMC
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key as string}
                  className="border px-2 py-1.5 text-right font-semibold whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.amcSlug}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap border bg-card px-2 py-1 text-left font-medium"
                  title={r.displayName}
                >
                  {r.displayName}
                </th>
                {COLS.map((c) => {
                  const v = r[c.key] as number;
                  return (
                    <td
                      key={c.key as string}
                      className="border px-2 py-1 text-right text-foreground"
                      style={tint(v, maxByCol.get(c.key as string) ?? 1)}
                    >
                      {v >= 0.005 ? `${v.toFixed(2)}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Read across a row to see where an AMC is over- or under-weight versus its
        overall share — a house with, say, 10% overall but 16% of active equity
        is equity-tilted (the high-fee end). Read down a column for the pecking
        order within a product. Share = AMC category AUM ÷ industry category AUM.
        Source: monthly AMC AUM snapshot.
      </p>
    </div>
  );
}
