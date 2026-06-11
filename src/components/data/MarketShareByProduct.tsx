import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import type { ProductShareRow } from "@/data/aggregate";
import { formatMonthLabel } from "@/lib/format";
import { toneText } from "@/lib/tone";
import { cn } from "@/lib/cn";

export type ProductShareDisplayRow = ProductShareRow & { displayName: string };

const COLS: { key: keyof ProductShareRow; label: string }[] = [
  { key: "activeEquitySharePct", label: "Active Equity" },
  { key: "debtSharePct", label: "Debt" },
  { key: "liquidSharePct", label: "Liquid" },
  { key: "hybridSharePct", label: "Hybrid" },
  { key: "passiveSharePct", label: "Passive" },
];

type XlsxRow = Record<string, string | number>;

/**
 * Market share WITHIN each product category, per AMC — a latest-month heatmap
 * table. Each cell is the AMC's share of the industry's AUM in that category
 * (shares sum to 100% down a column including the Remaining Others row); shade
 * scales with the share so the leaders in each product stand out, and the
 * small signed figure beneath each share is the MoM move in basis points
 * (green = share gained, red = share lost). Lets an analyst spot where a
 * house is over- or under-weight vs its overall share (e.g. equity-tilted =
 * the high-fee end). Server component — colours derived at render.
 */
export function MarketShareByProduct({
  month,
  rows,
  prevMonth,
  prevRows,
}: {
  month: string;
  rows: ProductShareDisplayRow[];
  /** Prior month id (for the Δ caption); null disables the MoM column. */
  prevMonth?: string | null;
  /** Full prior-month share rows — used to compute the MoM Δ bps per cell.
   *  AMCs absent from the prior month render no delta. */
  prevRows?: ProductShareRow[];
}) {
  if (rows.length === 0) return null;

  const prevBySlug = new Map((prevRows ?? []).map((r) => [r.amcSlug, r]));
  const hasDeltas = prevBySlug.size > 0;

  const deltaBps = (
    row: ProductShareDisplayRow,
    key: keyof ProductShareRow
  ): number | null => {
    const prev = prevBySlug.get(row.amcSlug);
    if (!prev) return null;
    const cur = row[key] as number;
    const before = prev[key] as number;
    if (!Number.isFinite(cur) || !Number.isFinite(before)) return null;
    return (cur - before) * 100;
  };

  // Remaining Others = the complement of the displayed AMC set. Shares sum
  // to 100% down a column across the FULL universe, so the residual is
  // exact. The MoM Δ uses the same displayed-AMC complement on the prior
  // month so the delta is internally consistent.
  const othersCur = new Map<string, number>();
  const othersDelta = new Map<string, number | null>();
  for (const c of COLS) {
    const sumCur = rows.reduce((s, r) => s + (r[c.key] as number), 0);
    const cur = Math.max(0, 100 - sumCur);
    othersCur.set(c.key as string, cur);
    if (hasDeltas && rows.every((r) => prevBySlug.has(r.amcSlug))) {
      const sumPrev = rows.reduce(
        (s, r) => s + ((prevBySlug.get(r.amcSlug)?.[c.key] as number) ?? 0),
        0
      );
      const othersPrev = Math.max(0, 100 - sumPrev);
      othersDelta.set(c.key as string, (cur - othersPrev) * 100);
    } else {
      othersDelta.set(c.key as string, null);
    }
  }

  const xlsxRows: XlsxRow[] = [
    ...rows.map((r) => {
      const obj: XlsxRow = { AMC: r.displayName };
      for (const c of COLS) {
        obj[`${c.label} share (%)`] = Number((r[c.key] as number).toFixed(2));
        const d = deltaBps(r, c.key);
        obj[`${c.label} MoM (bps)`] = d === null ? "" : Number(d.toFixed(0));
      }
      return obj;
    }),
    (() => {
      const obj: XlsxRow = { AMC: "Remaining Others" };
      for (const c of COLS) {
        obj[`${c.label} share (%)`] = Number(
          (othersCur.get(c.key as string) ?? 0).toFixed(2)
        );
        const d = othersDelta.get(c.key as string) ?? null;
        obj[`${c.label} MoM (bps)`] = d === null ? "" : Number(d.toFixed(0));
      }
      return obj;
    })(),
  ];
  const xlsxColumns: CsvColumn<XlsxRow>[] = [
    { key: "AMC", header: "AMC" },
    ...COLS.flatMap((c) => [
      { key: `${c.label} share (%)`, header: `${c.label} share (%)` },
      { key: `${c.label} MoM (bps)`, header: `${c.label} MoM (bps)` },
    ]),
  ];

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

  const fmtBps = (v: number): string =>
    `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v))}`;

  const shareCell = (
    keyStr: string,
    share: number,
    delta: number | null,
    tinted: boolean
  ) => (
    <td
      key={keyStr}
      className="border px-2 py-1 text-right text-foreground"
      style={tinted ? tint(share, maxByCol.get(keyStr) ?? 1) : undefined}
    >
      {share >= 0.005 ? (
        <div className="flex flex-col items-end leading-tight">
          <span>{share.toFixed(2)}%</span>
          {delta !== null && (
            <span className={cn("text-[9px]", toneText(delta))}>
              {fmtBps(delta)}
            </span>
          )}
        </div>
      ) : (
        "—"
      )}
    </td>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Each AMC&rsquo;s share of industry AUM within each product ·{" "}
          {formatMonthLabel(month)}
          {hasDeltas && prevMonth
            ? ` · small figure = MoM move in bps vs ${formatMonthLabel(prevMonth)}`
            : ""}{" "}
          · shares sum to 100% down each column including Remaining Others.
        </p>
        <DownloadXlsxButton
          rows={xlsxRows}
          columns={xlsxColumns}
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
                {COLS.map((c) =>
                  shareCell(
                    c.key as string,
                    r[c.key] as number,
                    deltaBps(r, c.key),
                    true
                  )
                )}
              </tr>
            ))}
            <tr className="border-t-2">
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap border bg-card px-2 py-1 text-left font-medium text-muted-foreground"
                title="Aggregate share of every AMC outside the rows above — keeps each column summing to 100% of the market."
              >
                Remaining Others
              </th>
              {COLS.map((c) =>
                shareCell(
                  c.key as string,
                  othersCur.get(c.key as string) ?? 0,
                  othersDelta.get(c.key as string) ?? null,
                  false
                )
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Read across a row to see where an AMC is over- or under-weight versus its
        overall share — a house with, say, 10% overall but 16% of active equity
        is equity-tilted (the high-fee end). Read down a column for the pecking
        order within a product. Share = AMC category AUM ÷ industry category AUM;
        the signed sub-figure is the MoM share move in basis points (green =
        gained, red = lost). Source: monthly AMC AUM snapshot.
      </p>
    </div>
  );
}
