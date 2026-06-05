import type { ReactNode } from "react";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { toneBg, toneText } from "@/lib/tone";
import { cn } from "@/lib/cn";
import { formatCompactCr, formatMonthLabel } from "@/lib/format";
import { FEE_TIER_NOTE, type FeeMixMonth } from "@/data/fee-mix";

const FEE_MIX_XLSX_COLUMNS: CsvColumn<FeeMixMonth>[] = [
  { key: "month", header: "Month" },
  { key: "highFeeFlow", header: "High-fee net inflow (₹ Cr)" },
  { key: "lowFeeFlow", header: "Low-fee net inflow (₹ Cr)" },
  { key: "totalFlow", header: "Total net inflow (₹ Cr)" },
  { key: "highFeeSharePct", header: "High-fee share (% of net inflows)" },
  { key: "activeEquityFlow", header: "Active equity (₹ Cr)" },
  { key: "equityHybridFlow", header: "Equity & balanced-advantage hybrid (₹ Cr)" },
  { key: "solutionFlow", header: "Solution-oriented (₹ Cr)" },
  { key: "debtFlow", header: "Debt & liquid (₹ Cr)" },
  { key: "arbitrageFlow", header: "Arbitrage (₹ Cr)" },
  { key: "passiveOtherFlow", header: "Passive & other / Group V (₹ Cr)" },
];

// Signed compact ₹: "+₹2.47L Cr" for inflow, "−₹2.95L Cr" for outflow.
function signedCr(v: number): string {
  return v >= 0 ? `+${formatCompactCr(v)}` : formatCompactCr(v);
}

type BreakdownRow = {
  label: string;
  flow: number;
  kind: "head" | "sub" | "total";
};

/**
 * Fee-mix of net inflows — splits the latest month's industry net inflows into
 * the high-fee active-equity book vs the low-fee debt / liquid / passive book,
 * with a headline takeaway, a sign-tinted breakdown, a trailing high-fee-share
 * strip, and an Excel export. Server component. See @/data/fee-mix for the
 * classification (a flow-weighted fee-tier proxy, not TER-weighted revenue).
 */
export function FeeMixInflows({ months }: { months: FeeMixMonth[] }) {
  if (months.length === 0) return null;
  const latest = months[months.length - 1];
  const tot = latest.totalFlow;
  const monthLbl = formatMonthLabel(latest.month);
  const pctOf = (v: number): string =>
    tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : "—";

  const breakdown: BreakdownRow[] = [
    { label: "High-fee book", flow: latest.highFeeFlow, kind: "head" },
    { label: "Active equity", flow: latest.activeEquityFlow, kind: "sub" },
    {
      label: "Equity & balanced-advantage hybrid",
      flow: latest.equityHybridFlow,
      kind: "sub",
    },
    { label: "Solution-oriented", flow: latest.solutionFlow, kind: "sub" },
    { label: "Low-fee book", flow: latest.lowFeeFlow, kind: "head" },
    { label: "Debt & liquid", flow: latest.debtFlow, kind: "sub" },
    { label: "Arbitrage", flow: latest.arbitrageFlow, kind: "sub" },
    {
      label: "Passive & other (Group V)",
      flow: latest.passiveOtherFlow,
      kind: "sub",
    },
    { label: "Total net inflow", flow: tot, kind: "total" },
  ];
  const componentMax = Math.max(
    1,
    Math.abs(latest.activeEquityFlow),
    Math.abs(latest.equityHybridFlow),
    Math.abs(latest.solutionFlow),
    Math.abs(latest.debtFlow),
    Math.abs(latest.arbitrageFlow),
    Math.abs(latest.passiveOtherFlow)
  );

  let headline: ReactNode;
  if (latest.highFeeSharePct !== null) {
    const sh = latest.highFeeSharePct;
    headline = (
      <>
        In {monthLbl}, <strong>{sh.toFixed(0)}%</strong> of the industry&rsquo;s{" "}
        {signedCr(tot)} of net inflows went into the{" "}
        <strong>high-fee</strong> active-equity book ({signedCr(latest.highFeeFlow)});
        the other {(100 - sh).toFixed(0)}% went to the low-fee debt, liquid &amp;
        passive book.
      </>
    );
  } else if (latest.highFeeFlow > 0) {
    headline = (
      <>
        In {monthLbl}, industry net flows were negative overall ({signedCr(tot)})
        — the low-fee book saw {signedCr(latest.lowFeeFlow)} of net outflows —
        yet the <strong>high-fee</strong> active-equity book still drew{" "}
        {signedCr(latest.highFeeFlow)}.
      </>
    );
  } else {
    headline = (
      <>
        In {monthLbl}, both books saw net outflows:{" "}
        {signedCr(latest.highFeeFlow)} from the high-fee active-equity book and{" "}
        {signedCr(latest.lowFeeFlow)} from the low-fee debt / liquid / passive
        book.
      </>
    );
  }

  const strip = months.slice(-12);
  const stripMax = Math.max(
    1,
    ...strip.map((m) => (m.highFeeSharePct === null ? 0 : m.highFeeSharePct))
  );

  return (
    <div className="space-y-4">
      <KeyTakeaway headline={headline} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium tracking-tight">
            {monthLbl} · net inflows by fee tier
          </h3>
          <DownloadXlsxButton
            rows={months}
            columns={FEE_MIX_XLSX_COLUMNS}
            filename="fee-mix-of-inflows.xlsx"
            sheetName="Fee Mix"
          />
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                <th className="border px-2.5 py-2 text-left font-semibold">
                  Segment
                </th>
                <th className="border px-2.5 py-2 text-right font-semibold">
                  Net Inflow
                </th>
                <th className="border px-2.5 py-2 text-right font-semibold">
                  % of net inflows
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((r) => (
                <tr
                  key={r.label}
                  className={cn(
                    r.kind === "total" && "font-bold",
                    r.kind === "head" && "font-semibold"
                  )}
                >
                  <th
                    scope="row"
                    className={cn(
                      "whitespace-nowrap border bg-card px-2.5 py-1.5 text-left",
                      r.kind === "sub" &&
                        "pl-5 font-normal text-muted-foreground",
                      r.kind === "head" && "font-semibold",
                      r.kind === "total" && "font-bold"
                    )}
                  >
                    {r.label}
                  </th>
                  <td
                    className={cn(
                      "border px-2.5 py-1.5 text-right",
                      toneText(r.flow)
                    )}
                    style={toneBg(r.flow, componentMax)}
                  >
                    {signedCr(r.flow)}
                  </td>
                  <td className="border px-2.5 py-1.5 text-right text-foreground">
                    {r.kind === "total" && tot > 0 ? "100.0%" : pctOf(r.flow)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium tracking-tight">
          High-fee share of net inflows · trailing {strip.length} months
        </h3>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full border-collapse text-center text-[11px] tabular-nums">
            <thead>
              <tr>
                {strip.map((m) => (
                  <th
                    key={m.month}
                    className="whitespace-nowrap border px-1.5 py-1.5 font-medium"
                  >
                    {formatMonthLabel(m.month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {strip.map((m) => (
                  <td
                    key={m.month}
                    className="border px-1.5 py-1.5 text-foreground"
                    style={toneBg(m.highFeeSharePct, stripMax)}
                    title={
                      m.highFeeSharePct === null
                        ? "Net flows were negative overall — share not meaningful"
                        : `${formatMonthLabel(m.month)}: ${m.highFeeSharePct.toFixed(1)}% to high-fee`
                    }
                  >
                    {m.highFeeSharePct === null
                      ? "—"
                      : `${m.highFeeSharePct.toFixed(0)}%`}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">High-fee:</span>{" "}
        {FEE_TIER_NOTE.high}{" "}
        <span className="font-medium text-foreground">Low-fee:</span>{" "}
        {FEE_TIER_NOTE.low} This is a flow-weighted fee-tier proxy — it tracks
        where net inflows land, not TER-weighted fee revenue (no per-category
        expense ratio is applied). &ldquo;% of net inflows&rdquo; is shown only
        when the month&rsquo;s total net flow is positive. Source: AMFI Monthly
        Report category flows.
      </p>
    </div>
  );
}
