import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  THEME_CATEGORY_PILL,
  type AmcNarrativeRow,
} from "@/data/amc-narratives";

interface ConcallDigestProps {
  row: AmcNarrativeRow | null;
  amcDisplayName: string;
}

/**
 * Concall Digest panel — categorized bullets from the latest earnings
 * concall, plus the latest CEO/CFO pull-quote. Hides nothing; renders an
 * empty-state when no narrative row exists for the AMC.
 *
 * Placement: `/amc/[slug]` and selectively on `/compare`.
 */
export function ConcallDigest({ row, amcDisplayName }: ConcallDigestProps) {
  if (!row) {
    return (
      <Card
        title="Concall Digest"
        subtitle={`Latest concall takeaways for ${amcDisplayName}. Awaiting first ingest.`}
        stackHeader
      >
        <p className="text-sm text-muted-foreground">
          No concall transcript has been processed for this AMC yet. Once
          the analyst transcribes the next earnings call into{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            manual-data/amc-narratives/extracted/
          </code>
          , this panel will surface the management&rsquo;s headline themes,
          disclosed metrics, and pull-quotes.
        </p>
      </Card>
    );
  }
  const subtitle =
    `Themes management called out on the ${row.fiscalPeriod} earnings call` +
    (row.callDate ? ` (${row.callDate})` : "") +
    ".";
  return (
    <Card
      title="Concall Digest"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <p className="text-[11px] text-muted-foreground/80">
            Source: company concall transcript · {row.sourcePdf}
          </p>
        </div>
      }
      stackHeader
    >
      <ul className="space-y-2">
        {row.themes.map((t, i) => {
          const pill = THEME_CATEGORY_PILL[t.category];
          return (
            <li key={`${t.category}-${i}`} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                  pill.cls
                )}
              >
                {pill.label}
              </span>
              <div className="space-y-0.5 text-[13px] leading-snug">
                <p className="text-foreground/90">{t.headline}</p>
                {t.detail && (
                  <p className="text-[12px] text-muted-foreground">
                    {t.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {row.quotes.length > 0 && (
        <div className="mt-4 border-l-2 border-foreground/40 pl-3">
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
      {row.metrics.filter((m) => m.value !== null).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {row.metrics
            .filter((m) => m.value !== null)
            .map((m, i) => (
              <span
                key={`${m.field}-${i}`}
                className="inline-flex items-baseline gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]"
              >
                <span className="text-muted-foreground">
                  {prettyFieldLabel(m.field)}
                </span>
                <span className="font-medium tabular text-foreground">
                  {formatMetric(m.value as number, m.unit)}
                </span>
              </span>
            ))}
        </div>
      )}
    </Card>
  );
}

function prettyFieldLabel(field: string): string {
  switch (field) {
    case "uniqueInvestorShare":
      return "Unique investor share";
    case "digitalTransactionPct":
      return "Digital txn %";
    case "p30InflowShare":
      return "P30 inflow %";
    case "headcount":
      return "Headcount";
    case "dividendPerShare":
      return "Dividend / share";
    case "payoutRatio":
      return "Payout %";
    case "berImpactBps":
      return "BER impact";
    case "sipBookMillions":
      return "SIP book";
    case "operatingMarginPct":
      return "Op. margin";
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
