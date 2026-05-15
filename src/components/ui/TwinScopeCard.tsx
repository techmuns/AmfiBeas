import { cn } from "@/lib/cn";
import { Sparkline } from "@/components/charts/Sparkline";

interface TwinScopeCardProps {
  /** Headline label (e.g. "Active Equity Flow"). */
  label: string;
  /** Trailing 12M series (latest 12 chronological points). */
  current: { label: string; value: number }[];
  /** Prior 12M series (the 12 months immediately before `current`). */
  prior: { label: string; value: number }[];
  /** Caller-supplied formatter for headline numbers. */
  formatValue?: (v: number) => string;
  className?: string;
}

function sum(series: { value: number }[]): number {
  return series.reduce((s, p) => s + p.value, 0);
}

/**
 * Twin-scope comparison card — renders TWO sparklines side by side:
 * the latest 12M alongside the prior 12M, with totals and Δ.
 *
 * Cheap version of the page-wide "twin-scope mode" idea: instead of
 * splitting every chart, we surface a single dramatic side-by-side
 * card that captures the most important "this year vs last year"
 * comparison. Reader sees continuity / reversal at a glance.
 */
export function TwinScopeCard({
  label,
  current,
  prior,
  formatValue,
  className,
}: TwinScopeCardProps) {
  const fmt =
    formatValue ?? ((v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 }));
  if (current.length === 0 && prior.length === 0) return null;

  const currentTotal = sum(current);
  const priorTotal = sum(prior);
  const deltaPct =
    priorTotal !== 0
      ? ((currentTotal - priorTotal) / Math.abs(priorTotal)) * 100
      : null;
  const deltaTone =
    deltaPct === null
      ? "text-muted-foreground"
      : deltaPct >= 0
        ? "text-positive"
        : "text-negative";

  return (
    <div className={cn("rounded-xl border bg-card p-5 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Twin scope · 12M vs prior 12M
          </div>
          <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        </div>
        {deltaPct !== null && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular tracking-tight",
              deltaTone === "text-positive"
                ? "border-positive/40 bg-positive/10 text-positive"
                : deltaTone === "text-negative"
                  ? "border-negative/40 bg-negative/10 text-negative"
                  : "border-border bg-muted text-muted-foreground"
            )}
          >
            {deltaPct >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}% YoY total
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TwinPanel
          title={prior[0] ? `${prior[0].label} → ${prior[prior.length - 1].label}` : "Prior 12M"}
          subtitle="Prior 12M"
          total={priorTotal}
          series={prior}
          color="hsl(var(--muted-foreground))"
          fmt={fmt}
        />
        <TwinPanel
          title={current[0] ? `${current[0].label} → ${current[current.length - 1].label}` : "Latest 12M"}
          subtitle="Latest 12M"
          total={currentTotal}
          series={current}
          color="hsl(var(--chart-1))"
          fmt={fmt}
        />
      </div>
    </div>
  );
}

function TwinPanel({
  title,
  subtitle,
  total,
  series,
  color,
  fmt,
}: {
  title: string;
  subtitle: string;
  total: number;
  series: { label: string; value: number }[];
  color: string;
  fmt: (v: number) => string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {subtitle}
      </div>
      <div className="text-lg font-semibold tabular tracking-tight">
        {fmt(total)}
      </div>
      <div className="text-[10px] tabular text-muted-foreground/80">
        {title}
      </div>
      {series.length > 1 && (
        <div className="mt-1 -mx-1">
          <Sparkline data={series} color={color} height={32} />
        </div>
      )}
    </div>
  );
}
