import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { MultiLine } from "@/components/charts/MultiLine";
import { amcCashAllocationTrend } from "@/data/amc-portfolio";
import { AMC_COLORS } from "@/lib/chart-meta";
import { AMCS } from "@/data/amcs";

/**
 * Cash Allocation % over time — peer-cohort line chart.
 *
 * Each line is one AMC; y-axis is the AUM-weighted cash % across that
 * AMC's active-equity schemes. Mirrors the framing IIFL's monthly AMC
 * report uses: which AMC sits on the most cash today, and how that has
 * trended versus the cohort over the latest window.
 *
 * Universe details live in `src/data/amc-portfolio.ts` — equity ex
 * ETFs, Index, International, and all hybrid / debt classifications.
 */
export function AmcCashAllocationTrend() {
  const trend = amcCashAllocationTrend();

  if (trend.points.length < 2 || trend.amcSlugs.length === 0) {
    return (
      <Card
        title="Cash Allocation % — peer cohort"
        subtitle="Need at least 2 months of portfolio-tracker data to render."
        stackHeader
      />
    );
  }

  const lines = trend.amcSlugs.map((slug) => ({
    key: slug,
    name: amcDisplayLabel(slug),
    color: AMC_COLORS[slug] ?? "hsl(var(--muted-foreground))",
  }));

  // Cohort leader / laggard read for the latest month — surfaces the
  // "who is hoarding cash, who is fully invested" headline that the
  // IIFL chart's title leads with.
  const latest = trend.points[trend.points.length - 1];
  const ranked = trend.amcSlugs
    .map((slug) => ({
      slug,
      label: amcDisplayLabel(slug),
      cashPct:
        typeof latest[slug] === "number" ? (latest[slug] as number) : null,
    }))
    .filter((r): r is { slug: string; label: string; cashPct: number } =>
      r.cashPct !== null
    )
    .sort((a, b) => b.cashPct - a.cashPct);
  const leaders = ranked.slice(0, 2);
  const laggards = ranked.slice(-2).reverse();

  return (
    <Card title="Cash Allocation % — peer cohort" stackHeader>
      <p className="mb-3 text-xs text-muted-foreground">
        AUM-weighted cash % across each AMC&apos;s active-equity schemes.
        Window: <span className="text-foreground">{trend.months[0]}</span> →{" "}
        <span className="text-foreground">
          {trend.months[trend.months.length - 1]}
        </span>{" "}
        · {trend.amcSlugs.length} AMCs · Source: RupeeVest Portfolio Tracker.
      </p>

      {(leaders.length > 0 || laggards.length > 0) && (
        <div className="mb-3 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
          As of <span className="text-foreground">{latest.month as string}</span>
          {leaders.length > 0 && (
            <>
              {", "}
              <span className="text-foreground">
                {leaders.map((l) => `${l.label} (${l.cashPct.toFixed(1)}%)`).join(" & ")}
              </span>{" "}
              hold the most cash among peers
            </>
          )}
          {laggards.length > 0 && (
            <>
              {", while "}
              <span className="text-foreground">
                {laggards
                  .map((l) => `${l.label} (${l.cashPct.toFixed(1)}%)`)
                  .join(" & ")}
              </span>{" "}
              are the most fully invested
            </>
          )}
          .
        </div>
      )}

      <MultiLine
        data={trend.points}
        xKey="month"
        lines={lines}
        valueFormat="pct"
        axisFormat="pct"
        labelFormat="none"
        showDots
        dynamicYDomain
      />

      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Each line is one AMC. Y-axis = AUM-weighted cash share of
            the AMC&apos;s active-equity schemes.
          </li>
          <li>
            Cash here = total scheme AUM minus the sum of disclosed
            equity holdings. For pure equity funds this is the
            cash-and-equivalents bucket the AMC parks while waiting
            for ideas; rising lines flag growing caution.
          </li>
          <li>
            Hybrid, ETF, Index, International and debt schemes are
            excluded so the line tracks active-equity behaviour, not
            asset-allocation drift.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}

function amcDisplayLabel(slug: string): string {
  const a = AMCS.find((x) => x.slug === slug);
  if (!a) return slug;
  if (slug === "absl") return "Birla MF";
  if (slug === "icici-pru") return "ICICI Pru MF";
  if (slug === "canara-robeco") return "Canara MF";
  if (slug === "nippon") return "Nippon MF";
  if (slug === "hdfc") return "HDFC MF";
  if (slug === "sbi") return "SBI MF";
  if (slug === "kotak") return "Kotak MF";
  if (slug === "axis") return "Axis MF";
  if (slug === "uti") return "UTI MF";
  if (slug === "dsp") return "DSP MF";
  if (slug === "mirae") return "Mirae MF";
  return a.ticker ?? a.name.split(" ")[0];
}
