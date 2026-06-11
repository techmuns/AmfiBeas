import { cn } from "@/lib/cn";
import type { CapFlowRow, CapFlows } from "@/data/cap-flows";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

function displayName(name: string): string {
  return name.replace(/\s+(Ltd\.?|Limited)$/i, "").trim();
}

// Net MF buying/selling as a % of the company's shares outstanding. "—" when
// the screener feed doesn't cover the company yet (pctOutstanding === null).
function fmtPctOut(pct: number | null, kind: "bought" | "sold"): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const sign = kind === "bought" ? "+" : "−";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function FlowCard({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: CapFlowRow[];
  kind: "bought" | "sold";
}) {
  const movers = kind === "bought" ? "Top MF Buyers" : "Top MF Sellers";
  const valHead =
    kind === "bought" ? "Bought (% shares out.)" : "Sold (% shares out.)";
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/60 px-4 py-3 text-base font-bold tracking-tight text-foreground">
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-sm font-semibold text-foreground">
            <th className="px-4 py-2 text-left font-semibold">Company</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">
              {valHead}
            </th>
            <th className="px-4 py-2 text-left font-semibold">{movers}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-4 py-6 text-center text-muted-foreground"
              >
                No qualifying names this month.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.company} className="border-t last:border-b-0">
                <td className="px-4 py-2.5 font-medium">
                  {displayName(r.company)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 text-right tabular font-medium",
                    r.pctOutstanding === null
                      ? "text-muted-foreground"
                      : kind === "bought"
                        ? "text-positive"
                        : "text-negative"
                  )}
                  title={`Net ${kind} ${(kind === "bought" ? "+" : "−")}₹${r.netCr.toLocaleString("en-IN")} Cr`}
                >
                  {fmtPctOut(r.pctOutstanding, kind)}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.amcs.length ? r.amcs.join(", ") : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CapFlowsView({ flows }: { flows: CapFlows }) {
  const { meta } = flows;
  const tiers: { key: "large" | "mid" | "small"; label: string }[] = [
    { key: "large", label: "Large-cap" },
    { key: "mid", label: "Mid-cap" },
    { key: "small", label: "Small-cap" },
  ];
  type XRow = {
    tier: string;
    side: string;
    company: string;
    pctOutstanding: number | null;
    netCr: number;
    amcs: string;
  };
  const exportRows: XRow[] = tiers.flatMap((t) => [
    ...flows[t.key].bought.map((r) => ({
      tier: t.label,
      side: "Bought",
      company: displayName(r.company),
      pctOutstanding: r.pctOutstanding,
      netCr: r.netCr,
      amcs: r.amcs.join(", "),
    })),
    ...flows[t.key].sold.map((r) => ({
      tier: t.label,
      side: "Sold",
      company: displayName(r.company),
      pctOutstanding: r.pctOutstanding === null ? null : -r.pctOutstanding,
      netCr: -r.netCr,
      amcs: r.amcs.join(", "),
    })),
  ]);
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "tier", header: "Cap tier" },
    { key: "side", header: "Side" },
    { key: "company", header: "Company" },
    { key: "pctOutstanding", header: "% shares outstanding (+ bought / − sold)" },
    { key: "netCr", header: "Net (₹ Cr, + bought / − sold)" },
    { key: "amcs", header: "AMCs" },
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          MF net buying / selling as % of shares outstanding · {meta.monthCur}.
          Ranked by net ₹ Cr; hover a % for the rupee value. &ldquo;—&rdquo; =
          shares-outstanding not yet sourced.
        </p>
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename="mf-cap-flows.xlsx"
          sheetName="Cap Flows"
        />
      </div>
      {tiers.map((t) => (
        <div key={t.key} className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight">{t.label}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <FlowCard
              title={`Top ${t.label} names bought by MFs (${meta.monthCur})`}
              rows={flows[t.key].bought}
              kind="bought"
            />
            <FlowCard
              title={`Top ${t.label} names sold by MFs (${meta.monthCur})`}
              rows={flows[t.key].sold}
              kind="sold"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
