import { cn } from "@/lib/cn";

/**
 * Monthly Flows & AUM heatmap table — a tabular re-creation of the
 * /monthly Flows tab. Each row is a month (newest first; the latest
 * month is starred), columns are grouped into Net Flows (Total in ₹ Cr;
 * Equity / Hybrid / Active Eq as a signed % of the month's gross flow
 * magnitude), Month-end AUM Mix (% share + MoM pp move), and Industry
 * AAUM (level + MoM / YoY). Signed cells are tinted green (inflow / up)
 * or red (outflow / down) with intensity scaled to each column's own
 * range, so the table reads as a heatmap the way a returns grid does.
 *
 * Server component — no interactivity, colours are derived at render.
 */
export interface MonthlyFlowsTableRow {
  month: string; // YYYY-MM
  // Industry net flow (₹ Cr, signed; null when the row didn't carry it).
  totalFlow: number | null;
  // Net flows as a signed % of the month's gross flow magnitude
  // (null when the AMFI row didn't carry the field).
  equityFlowPct: number | null;
  hybridFlowPct: number | null;
  activeEquityFlowPct: number | null;
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

type FlowKey =
  | "totalFlow"
  | "equityFlowPct"
  | "hybridFlowPct"
  | "activeEquityFlowPct";

// `abs` columns render absolute ₹ Cr; the rest render a signed %.
const FLOW_COLS: { key: FlowKey; label: string; abs?: boolean }[] = [
  { key: "totalFlow", label: "Total (₹ Cr)", abs: true },
  { key: "equityFlowPct", label: "Equity" },
  { key: "hybridFlowPct", label: "Hybrid" },
  { key: "activeEquityFlowPct", label: "Active Eq" },
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

/** Faint tone background, intensity ∝ |value| / column max. */
function toneBg(value: number | null, maxAbs: number): React.CSSProperties {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return {};
  }
  const t = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const alpha = (0.08 + 0.42 * t).toFixed(3);
  const tone = value > 0 ? "--positive" : "--negative";
  return { backgroundColor: `hsl(var(${tone}) / ${alpha})` };
}

function toneText(value: number | null): string {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return "text-muted-foreground";
  }
  return value > 0 ? "text-positive" : "text-negative";
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

  const th = "border px-2 py-1.5 text-right align-bottom font-semibold whitespace-nowrap";
  const groupTh = "border px-2 py-1.5 text-center font-semibold";

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-[11px] tabular-nums">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-10 border bg-card px-2 py-1.5 text-left align-bottom font-semibold"
            >
              Period
            </th>
            <th colSpan={FLOW_COLS.length} className={groupTh}>
              Net Flows (% of monthly flow)
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
                    "sticky left-0 z-10 whitespace-nowrap border px-2 py-1 text-left font-medium",
                    isLatest ? "bg-accent text-foreground" : "bg-card"
                  )}
                >
                  {isLatest && <span className="mr-1 text-amber-500">★</span>}
                  {monthLabel(r.month)}
                </th>

                {/* Net Flows — Total in ₹ Cr, rest as signed % of gross */}
                {FLOW_COLS.map((c) => {
                  const v = r[c.key] as number | null;
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "border px-2 py-1 text-right",
                        toneText(v)
                      )}
                      style={toneBg(v, flowMax.get(c.key) ?? 0)}
                    >
                      {c.abs ? fmtFlow(v) : fmtPct(v)}
                    </td>
                  );
                })}

                {/* AUM Mix — share value + small MoM pp move */}
                {MIX_COLS.map((c) => {
                  const share = r[c.share] as number | null;
                  const pp = r[c.pp] as number | null;
                  return (
                    <td key={c.label} className="border px-2 py-1 text-right">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-foreground">{fmtShare(share)}</span>
                        {share !== null && (
                          <span className={cn("text-[9px]", toneText(pp))}>
                            {fmtPp(pp)}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}

                {/* Industry AAUM — level + MoM / YoY heatmap */}
                <td className="border px-2 py-1 text-right text-foreground">
                  {fmtLevel(r.aaum)}
                </td>
                <td
                  className={cn("border px-2 py-1 text-right", toneText(r.aaumMoMPct))}
                  style={toneBg(r.aaumMoMPct, momMax)}
                >
                  {fmtPct(r.aaumMoMPct)}
                </td>
                <td
                  className={cn("border px-2 py-1 text-right", toneText(r.aaumYoYPct))}
                  style={toneBg(r.aaumYoYPct, yoyMax)}
                >
                  {fmtPct(r.aaumYoYPct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
