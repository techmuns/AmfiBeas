import { cn } from "@/lib/cn";
import { toneBg, toneText } from "@/lib/tone";
import type { CsvColumn } from "@/lib/csv";

/**
 * Monthly Flows & AUM heatmap table — a tabular re-creation of the
 * /monthly Flows tab. Each row is a month (newest first; the latest
 * month is starred), columns are grouped into Net Flows (Total, Equity,
 * Hybrid and Active Eq, all as signed ₹ Cr), Month-end AUM Mix (% share +
 * MoM pp move), and Industry AAUM (level + MoM / YoY). Signed cells are
 * tinted green (inflow / up) or red (outflow / down) with intensity scaled
 * to each column's own range, so the table reads as a heatmap the way a
 * returns grid does.
 *
 * Server component — no interactivity, colours are derived at render.
 */
export interface MonthlyFlowsTableRow {
  month: string; // YYYY-MM
  // Industry net flow (₹ Cr, signed; null when the row didn't carry it).
  totalFlow: number | null;
  // Per-category net flows (₹ Cr, signed; null when the AMFI row didn't
  // carry the field). Debt is the AMFI debt subtotal and still CONTAINS
  // Liquid (no clean ex-Liquid split is published), so the two columns
  // overlap by construction — the header marks Debt as "incl. Liquid".
  equityFlow: number | null;
  debtFlow: number | null;
  liquidFlow: number | null;
  hybridFlow: number | null;
  activeEquityFlow: number | null;
  // Month-end AUM mix shares (% of month-end breakdown) + MoM pp move.
  equityShare: number | null;
  debtShare: number | null;
  liquidShare: number | null;
  otherShare: number | null;
  equitySharePpMoM: number | null;
  debtSharePpMoM: number | null;
  liquidSharePpMoM: number | null;
  otherSharePpMoM: number | null;
  // Industry AAUM (₹ Cr) + MoM / YoY %.
  aaum: number | null;
  aaumMoMPct: number | null;
  aaumYoYPct: number | null;
}

/**
 * Column definitions for the Excel export — raw numbers with units in the
 * headers, so the workbook stays sortable/computable rather than pre-formatted
 * text. Mirrors the on-screen grid; consumed by the page's DownloadXlsxButton.
 */
export const MONTHLY_FLOWS_XLSX_COLUMNS: CsvColumn<MonthlyFlowsTableRow>[] = [
  { key: "month", header: "Month" },
  { key: "totalFlow", header: "Net Flow · Total (₹ Cr)" },
  { key: "equityFlow", header: "Net Flow · Equity (₹ Cr)" },
  { key: "debtFlow", header: "Net Flow · Debt incl. Liquid (₹ Cr)" },
  { key: "liquidFlow", header: "Net Flow · Liquid (₹ Cr)" },
  { key: "hybridFlow", header: "Net Flow · Hybrid (₹ Cr)" },
  { key: "activeEquityFlow", header: "Net Flow · Active Equity (₹ Cr)" },
  { key: "equityShare", header: "AUM Mix · Equity (%)" },
  { key: "debtShare", header: "AUM Mix · Debt (%)" },
  { key: "liquidShare", header: "AUM Mix · Liquid (%)" },
  { key: "otherShare", header: "AUM Mix · Other (%)" },
  { key: "equitySharePpMoM", header: "AUM Mix · Equity MoM (pp)" },
  { key: "debtSharePpMoM", header: "AUM Mix · Debt MoM (pp)" },
  { key: "liquidSharePpMoM", header: "AUM Mix · Liquid MoM (pp)" },
  { key: "otherSharePpMoM", header: "AUM Mix · Other MoM (pp)" },
  { key: "aaum", header: "Industry AAUM (₹ Cr)" },
  { key: "aaumMoMPct", header: "Industry AAUM · MoM (%)" },
  { key: "aaumYoYPct", header: "Industry AAUM · YoY (%)" },
];

type FlowKey =
  | "totalFlow"
  | "equityFlow"
  | "debtFlow"
  | "liquidFlow"
  | "hybridFlow"
  | "activeEquityFlow";

// Every flow column renders a signed ₹ Cr figure (compact via fmtFlow).
// Equity / Debt / Liquid is the headline split; Hybrid and Active Eq
// add the granularity an analyst needs without a second table.
const FLOW_COLS: { key: FlowKey; label: string }[] = [
  { key: "totalFlow", label: "Total (₹ Cr)" },
  { key: "equityFlow", label: "Equity" },
  { key: "debtFlow", label: "Debt*" },
  { key: "liquidFlow", label: "Liquid" },
  { key: "hybridFlow", label: "Hybrid" },
  { key: "activeEquityFlow", label: "Active Eq" },
];

const MIX_COLS: {
  share: keyof MonthlyFlowsTableRow;
  pp: keyof MonthlyFlowsTableRow;
  label: string;
}[] = [
  { share: "equityShare", pp: "equitySharePpMoM", label: "Equity" },
  { share: "debtShare", pp: "debtSharePpMoM", label: "Debt" },
  { share: "liquidShare", pp: "liquidSharePpMoM", label: "Liquid" },
  { share: "otherShare", pp: "otherSharePpMoM", label: "Other" },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  if (!(idx >= 0 && idx < 12) || !y) return ym;
  return `${MONTHS[idx]} '${y.slice(2)}`;
}

// Signed compact ₹ Cr for the Total net-flow column. "+1.24L" = +1.24
// lakh crore; "−45.0k" = −45 thousand crore (header carries the unit).
function fmtFlow(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs < 0.5) return "0";
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

// Unsigned compact ₹ Cr for the AAUM level column.
function fmtLevel(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e5) return `${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(1)}k`;
  return `${Math.round(abs)}`;
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

function fmtShare(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtPp(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05) return "±0.0";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
}

function maxAbsOf(rows: MonthlyFlowsTableRow[], key: keyof MonthlyFlowsTableRow): number {
  let m = 0;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  }
  return m;
}

export function MonthlyFlowsTable({ rows }: { rows: MonthlyFlowsTableRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No monthly flow data ingested yet.
      </div>
    );
  }

  // Per-column scaling so each heatmap column reads on its own range.
  const flowMax = new Map<FlowKey, number>(
    FLOW_COLS.map((c) => [c.key, maxAbsOf(rows, c.key)])
  );
  const momMax = maxAbsOf(rows, "aaumMoMPct");
  const yoyMax = maxAbsOf(rows, "aaumYoYPct");

  const th = "border px-2 py-2 text-right align-bottom font-semibold whitespace-nowrap";
  const groupTh = "border px-2 py-2 text-center text-[12px] font-semibold";

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-10 border bg-card px-2 py-2 text-left align-bottom font-semibold"
            >
              Period
            </th>
            <th colSpan={FLOW_COLS.length} className={groupTh}>
              Net Flows (₹ Cr)
            </th>
            <th colSpan={MIX_COLS.length} className={groupTh}>
              Month-end AUM Mix (%)
            </th>
            <th colSpan={3} className={groupTh}>
              Industry AAUM
            </th>
          </tr>
          <tr>
            {FLOW_COLS.map((c) => (
              <th key={c.key} className={th}>
                {c.label}
              </th>
            ))}
            {MIX_COLS.map((c) => (
              <th key={c.label} className={th}>
                {c.label}
              </th>
            ))}
            <th className={th}>₹ Cr</th>
            <th className={th}>MoM</th>
            <th className={th}>YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const isLatest = ri === 0;
            return (
              <tr
                key={r.month}
                className={cn(isLatest && "bg-accent/40 font-medium")}
              >
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 whitespace-nowrap border px-2 py-2 text-left font-medium",
                    isLatest ? "bg-accent text-foreground" : "bg-card"
                  )}
                >
                  {isLatest && <span className="mr-1 text-amber-500">★</span>}
                  {monthLabel(r.month)}
                </th>

                {/* Net Flows — absolute signed ₹ Cr figure (heatmap-tinted). */}
                {FLOW_COLS.map((c) => {
                  const v = r[c.key] as number | null;
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "border px-2 py-2 text-right",
                        toneText(v)
                      )}
                      style={toneBg(v, flowMax.get(c.key) ?? 0)}
                    >
                      {fmtFlow(v)}
                    </td>
                  );
                })}

                {/* AUM Mix — share value + small MoM pp move */}
                {MIX_COLS.map((c) => {
                  const share = r[c.share] as number | null;
                  const pp = r[c.pp] as number | null;
                  return (
                    <td key={c.label} className="border px-2 py-2 text-right">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-foreground">{fmtShare(share)}</span>
                        {share !== null && (
                          <span className={cn("text-[10px]", toneText(pp))}>
                            {fmtPp(pp)}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}

                {/* Industry AAUM — level + MoM / YoY heatmap */}
                <td className="border px-2 py-2 text-right text-foreground">
                  {fmtLevel(r.aaum)}
                </td>
                <td
                  className={cn("border px-2 py-2 text-right", toneText(r.aaumMoMPct))}
                  style={toneBg(r.aaumMoMPct, momMax)}
                >
                  {fmtPct(r.aaumMoMPct)}
                </td>
                <td
                  className={cn("border px-2 py-2 text-right", toneText(r.aaumYoYPct))}
                  style={toneBg(r.aaumYoYPct, yoyMax)}
                >
                  {fmtPct(r.aaumYoYPct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t px-2 py-2 text-[11px] text-muted-foreground">
        *Debt is the AMFI debt subtotal and still includes Liquid (AMFI
        publishes no clean ex-Liquid monthly flow), so the Debt and Liquid
        columns overlap by construction.
      </p>
    </div>
  );
}
