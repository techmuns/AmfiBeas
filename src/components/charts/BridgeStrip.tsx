import { ArrowRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Sparkline } from "./Sparkline";
import { formatCompactCrSafe, formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface BridgeStripData {
  startLabel: string;
  endLabel: string;
  openingValue: number;
  netFlowContribution: number;
  marketResidualContribution: number;
  closingValue: number;
  /** Optional monthly Δ-AUM series for the temporal sparkline below. */
  sparkline?: { label: string; value: number }[];
  /** What the strip measures (e.g. "Active Equity AAUM"). Used in tile
   *  labels and the bridge sentence. */
  subject?: string;
}

interface BridgeStripProps {
  data: BridgeStripData;
}

/**
 * Bridge strip — replaces the legacy waterfall / stacked-bar bridge.
 * Renders four KPI tiles separated by arrows:
 *
 *   Opening  →  +Net Flow  →  +Market / Residual  →  Closing
 *
 * Each contribution tile shows the absolute ₹ Cr value, its share of
 * opening AAUM, and a positive/negative tone chip. A one-line bridge
 * sentence sits below. Optional sparkline adds temporal context.
 *
 * No bars, no stacked bars, no proportional fills.
 */
export function BridgeStrip({ data }: BridgeStripProps) {
  const opening = data.openingValue;
  const closing = data.closingValue;
  const totalDelta = closing - opening;
  const subject = data.subject ?? "AAUM";

  const flowPct = opening > 0 ? (data.netFlowContribution / opening) * 100 : null;
  const marketPct =
    opening > 0 ? (data.marketResidualContribution / opening) * 100 : null;

  const startLabel = tryFormatMonth(data.startLabel);
  const endLabel = tryFormatMonth(data.endLabel);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <BridgeTile
          label={`Opening ${subject}`}
          value={formatCompactCrSafe(opening)}
          subline={startLabel}
        />
        <ArrowSpacer />
        <BridgeTile
          label="Net Flow Contribution"
          value={formatSignedCr(data.netFlowContribution)}
          subline={
            flowPct === null
              ? "—"
              : `${flowPct >= 0 ? "+" : ""}${flowPct.toFixed(1)}% of opening`
          }
          tone={toneOf(data.netFlowContribution)}
          showSignIcon
        />
        <ArrowSpacer />
        <BridgeTile
          label="Market / Residual"
          value={formatSignedCr(data.marketResidualContribution)}
          subline={
            marketPct === null
              ? "—"
              : `${marketPct >= 0 ? "+" : ""}${marketPct.toFixed(1)}% of opening`
          }
          tone={toneOf(data.marketResidualContribution)}
          showSignIcon
        />
        <ArrowSpacer />
        <BridgeTile
          label={`Closing ${subject}`}
          value={formatCompactCrSafe(closing)}
          subline={endLabel}
        />
      </div>

      <p className="text-[12px] leading-snug text-muted-foreground">
        {subject}{" "}
        <span
          className={cn(
            "font-medium",
            totalDelta >= 0 ? "text-positive" : "text-negative"
          )}
        >
          {totalDelta >= 0 ? "rose" : "fell"} by{" "}
          {formatCompactCrSafe(Math.abs(totalDelta))}
        </span>
        {" "}between {startLabel} and {endLabel}. Net flows contributed{" "}
        <span className={toneClass(data.netFlowContribution)}>
          {formatSignedCr(data.netFlowContribution)}
        </span>
        {" "}and market / residual movement contributed{" "}
        <span className={toneClass(data.marketResidualContribution)}>
          {formatSignedCr(data.marketResidualContribution)}
        </span>
        .
      </p>

      {data.sparkline && data.sparkline.length > 1 && (
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Monthly Δ {subject}</span>
            <span>
              {tryFormatMonth(data.sparkline[0].label)} →{" "}
              {tryFormatMonth(data.sparkline[data.sparkline.length - 1].label)}
            </span>
          </div>
          <Sparkline data={data.sparkline} height={32} />
        </div>
      )}
    </div>
  );
}

function BridgeTile({
  label,
  value,
  subline,
  tone,
  showSignIcon,
}: {
  label: string;
  value: string;
  subline: string;
  tone?: "positive" | "negative" | "neutral";
  showSignIcon?: boolean;
}) {
  const SignIcon =
    tone === "positive" ? ArrowUpRight : tone === "negative" ? ArrowDownRight : null;
  const toneTextClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
      ? "text-negative"
      : "text-foreground";

  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2 shadow-sm",
        tone === "positive" && "border-positive/40 bg-positive/5",
        tone === "negative" && "border-negative/40 bg-negative/5"
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 flex items-baseline gap-1 text-sm font-semibold tabular", toneTextClass)}>
        {showSignIcon && SignIcon && <SignIcon className="h-3.5 w-3.5" />}
        <span>{value}</span>
      </div>
      <div className="text-[11px] tabular text-muted-foreground">{subline}</div>
    </div>
  );
}

function ArrowSpacer() {
  return (
    <div className="hidden items-center justify-center text-muted-foreground lg:flex">
      <ArrowRight className="h-4 w-4" />
    </div>
  );
}

function toneOf(n: number): "positive" | "negative" | "neutral" {
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "neutral";
}

function toneClass(n: number): string {
  if (n > 0) return "text-positive font-medium";
  if (n < 0) return "text-negative font-medium";
  return "";
}

function formatSignedCr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatCompactCrSafe(Math.abs(n))}`;
}

function tryFormatMonth(s: string): string {
  if (/^\d{4}-\d{2}$/.test(s)) return formatMonthLabel(s);
  return s;
}
