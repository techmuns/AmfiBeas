import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  amcNarrativesAll,
  type AmcNarrativeRow,
  type NarrativeMetric,
} from "@/data/amc-narratives";

interface ConcallDigestProps {
  /** Latest narrative row for this AMC. */
  row: AmcNarrativeRow | null;
  /** Full history of narrative rows — used to compute QoQ deltas on
   *  each metric. */
  slug: string;
  amcDisplayName: string;
}

/**
 * Concall Digest — a compact grid of "snapshot" cards summarising the
 * metrics management actually quantified on the latest earnings call.
 * No long bullet text, no theme paragraphs — every card surfaces ONE
 * number and what it means.
 *
 * Optional pull-quote rendered at the bottom when one exists.
 */
export function ConcallDigest({
  row,
  slug,
  amcDisplayName,
}: ConcallDigestProps) {
  if (!row) {
    return (
      <Card
        title="Concall Digest"
        subtitle={`Latest concall takeaways for ${amcDisplayName}. Awaiting first ingest.`}
        stackHeader
      >
        <p className="text-sm text-muted-foreground">
          Once the next earnings concall is transcribed, key metrics
          management disclosed (unique investor share, digital
          transactions %, dividend, payout ratio, etc.) will surface as
          small reference cards here.
        </p>
      </Card>
    );
  }
  // Prior period for QoQ deltas — anchor on the same metric field, not positional.
  const history = amcNarrativesAll(slug);
  const priorRow =
    history.length >= 2 && history[history.length - 1].fiscalPeriod === row.fiscalPeriod
      ? history[history.length - 2]
      : null;
  const cards = row.metrics
    .filter((m) => m.value !== null && Number.isFinite(m.value as number))
    .map((m) => buildMetricCard(m, priorRow));
  const subtitleNode = (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">
        Key numbers management quantified on the {row.fiscalPeriod}{" "}
        earnings call{row.callDate ? ` (${row.callDate})` : ""}.
      </p>
      <p className="text-[11px] text-muted-foreground/80">
        Source: company concall transcript · {row.sourcePdf}
      </p>
    </div>
  );
  if (cards.length === 0 && row.quotes.length === 0) {
    return (
      <Card title="Concall Digest" subtitleNode={subtitleNode} stackHeader>
        <p className="text-sm text-muted-foreground">
          This call didn&rsquo;t quantify any of the tracked metrics. The
          posture radar and the strategic-moves cohort lane on the AMCs
          page still surface qualitative themes.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Concall Digest" subtitleNode={subtitleNode} stackHeader>
      {cards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => (
            <SnapshotCard key={`${c.field}-${i}`} {...c} />
          ))}
        </div>
      )}
      {row.quotes.length > 0 && (
        <div
          className={cn(
            cards.length > 0 && "mt-4",
            "border-l-2 border-foreground/40 pl-3"
          )}
        >
          {row.quotes.slice(0, 1).map((q, i) => (
            <p
              key={i}
              className="text-[13px] italic leading-snug text-foreground/85"
            >
              &ldquo;{q.text}&rdquo;
              {q.speaker && (
                <span className="ml-2 not-italic text-[11px] text-muted-foreground">
                  — {q.speaker}
                </span>
              )}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

interface SnapshotCardProps {
  field: string;
  label: string;
  value: string;
  delta: string | null;
  deltaDir: "up" | "down" | "flat" | null;
}

function SnapshotCard({
  label,
  value,
  delta,
  deltaDir,
}: SnapshotCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular tracking-tight text-foreground">
        {value}
      </p>
      {delta && (
        <p
          className={cn(
            "mt-0.5 text-[11px] tabular",
            deltaDir === "up" && "text-positive",
            deltaDir === "down" && "text-negative",
            deltaDir === "flat" && "text-muted-foreground"
          )}
        >
          {delta}
        </p>
      )}
    </div>
  );
}

function buildMetricCard(
  m: NarrativeMetric,
  priorRow: AmcNarrativeRow | null
): SnapshotCardProps {
  const value = m.value as number;
  const prior = priorRow
    ? (priorRow.metrics.find((x) => x.field === m.field)?.value ?? null)
    : null;
  let delta: string | null = null;
  let deltaDir: "up" | "down" | "flat" | null = null;
  if (typeof prior === "number" && Number.isFinite(prior)) {
    const diff = value - prior;
    deltaDir = diff > 0.01 ? "up" : diff < -0.01 ? "down" : "flat";
    const arrow = deltaDir === "up" ? "▲" : deltaDir === "down" ? "▼" : "—";
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
    const abs = Math.abs(diff);
    let body: string;
    switch (m.unit) {
      case "pct":
        body = `${sign}${abs.toFixed(1)} pp`;
        break;
      case "bps":
        body = `${sign}${abs.toFixed(1)} bps`;
        break;
      case "inr":
        body = `${sign}₹${abs.toLocaleString("en-IN")}`;
        break;
      default:
        body = `${sign}${abs.toLocaleString("en-IN")}`;
    }
    delta = `${arrow} ${body} from ${priorRow?.fiscalPeriod ?? "prior"}`;
  }
  return {
    field: m.field,
    label: prettyFieldLabel(m.field),
    value: formatMetric(value, m.unit),
    delta,
    deltaDir,
  };
}

function prettyFieldLabel(field: string): string {
  switch (field) {
    case "uniqueInvestorShare":
      return "Unique investor share";
    case "digitalTransactionPct":
      return "Digital transactions";
    case "p30InflowShare":
      return "P30 inflow share";
    case "headcount":
      return "Headcount";
    case "dividendPerShare":
      return "Dividend / share";
    case "payoutRatio":
      return "Payout ratio";
    case "berImpactBps":
      return "BER P&L impact";
    case "sipBookMillions":
      return "SIP book";
    case "operatingMarginPct":
      return "Operating margin";
    default:
      return field;
  }
}

function formatMetric(value: number, unit: string): string {
  switch (unit) {
    case "pct":
      return `${value.toFixed(1)}%`;
    case "bps":
      return `${value.toFixed(1)} bps`;
    case "inr":
      return `₹${value.toLocaleString("en-IN")}`;
    case "millions":
      return `${value.toLocaleString("en-IN")} M`;
    case "bn":
      return `₹${value.toFixed(1)} bn`;
    case "count":
      return value.toLocaleString("en-IN");
    default:
      return String(value);
  }
}
