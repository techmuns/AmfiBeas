import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import type { AmcStatus } from "@/components/filters/FilterBar";
import { QuarterPicker } from "@/components/filters/QuarterPicker";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import {
  SOURCED_FINANCIALS_SLUGS,
  fixedQuarterWindow,
  latestQuarter,
  qoqChange,
  quarterlyForAmc,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { aaumProvenance, amcAaumQuarterlySnapshot, amcQuarterlySnapshot } from "@/data/source";
import { AMCS, getAMC } from "@/data/amcs";
import {
  formatCompactCrSafe,
  formatDelta,
  formatQuarterLabelLong,
} from "@/lib/format";
import { liveScreenerNote, liveYieldNote } from "@/lib/provenance";
import { parseFilters } from "@/lib/filter";

const DEFAULT_SLUG = "hdfc";

function buildAmcStatus(): Record<string, AmcStatus> {
  const out: Record<string, AmcStatus> = {};
  for (const a of AMCS) {
    if (SOURCED_FINANCIALS_SLUGS.has(a.slug)) out[a.slug] = "live";
    else if (a.listed) out[a.slug] = "pending";
    else out[a.slug] = "unavailable";
  }
  return out;
}

export default async function QuarterlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const status = buildAmcStatus();

  // Single-select: pick the first sourced AMC from the URL, else fall back to
  // hdfc. Unlisted / pending slugs in the URL are ignored.
  const requested = filters.amcs.find((s) => status[s] === "live");
  const slug = requested ?? DEFAULT_SLUG;
  const profile = getAMC(slug);

  const fullSeries = quarterlyForAmc(slug);

  // Period picker. KPI cards use this quarter; defaults to the most
  // recent available quarter for the selected AMC. Unrecognised values in
  // the URL are silently ignored. ICICI Pru's pre-listing gaps are simply
  // absent from `availableQuarters` — selector shows real-only quarters.
  const availableQuarters = fullSeries.map((q) => q.quarter);
  const requestedPeriod =
    typeof sp.period === "string" ? sp.period : undefined;
  const selectedPeriod =
    requestedPeriod && availableQuarters.includes(requestedPeriod)
      ? requestedPeriod
      : availableQuarters[availableQuarters.length - 1];
  const latest =
    fullSeries.find((q) => q.quarter === selectedPeriod) ??
    fullSeries[fullSeries.length - 1];

  // Fixed-window chart axis. All three chart groups (Revenue/Op/PAT bars,
  // Margin Trend, Yields) share the same x-axis: the latest 8 calendar
  // quarters in the overall snapshot, regardless of which AMC is selected.
  //
  // Rollover behaviour: `fixedQuarterWindow(latestQuarter(), 8)` derives
  // the window from snapshot data. When ingest lands 2026-Q2, latestQuarter
  // returns it and the window slides to 2024-Q3…2026-Q2 automatically.
  //
  // Per-AMC data is mapped onto the fixed window below — AMCs with gaps
  // (e.g. ICICI Pru) render nulls at missing positions so the gaps are
  // visible rather than silently shrinking the axis. Old snapshot rows
  // outside the visible window remain preserved by mergeBySlugQuarter.
  const CHART_HISTORY_WINDOW_QUARTERS = 8;

  const aaumMeta = amcAaumQuarterlySnapshot.meta;
  const yieldsSubtitle =
    amcAaumQuarterlySnapshot.rows.length > 0
      ? `bps of MF QAAUM · quarterly P&L ×4 / same-quarter AMFI MF QAAUM · ${new Date(aaumMeta.generatedAt).toISOString().slice(0, 10)}`
      : "bps of MF QAAUM · quarterly P&L ×4 / same-quarter AMFI MF QAAUM";

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  // No data → render empty state. Reaches this branch only if the default
  // slug somehow has no rows (defensive — hdfc is always sourced today).
  if (!latest || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Quarterly Financials"
          subtitle="Single-AMC view · sourced quarterly P&L"
        />
        <FilterBar
          showRange={false}
          amcMode="single"
          amcStatus={status}
          defaultSlug={DEFAULT_SLUG}
        />
        <Card
          title="Financials unavailable"
          subtitle="No sourced quarterly P&L for the selected AMC."
        >
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        </Card>
      </div>
    );
  }

  // YoY / QoQ deltas computed against the selected period (not always the
  // latest), so picking an older quarter shows the right historic delta.
  const selectedIdx = fullSeries.findIndex((q) => q.quarter === selectedPeriod);
  const seriesUpToSelected = fullSeries.slice(0, selectedIdx + 1);
  const revenueYoy = yoyChangeQuarterly(seriesUpToSelected.map((q) => q.revenue));
  const opYoy = yoyChangeQuarterly(seriesUpToSelected.map((q) => q.operatingProfit));
  const patYoy = yoyChangeQuarterly(seriesUpToSelected.map((q) => q.pat));
  const patMargin = (latest.pat / latest.revenue) * 100;
  const opMargin = (latest.operatingProfit / latest.revenue) * 100;
  // Management-comparable "bps of AAUM": quarterly P&L × 4 / AAUM × 10,000.
  // Mirrors the disclosure on listed AMC investor decks.
  const revenueYieldBps = latest.avgAum
    ? (latest.revenue * 4 * 10_000) / latest.avgAum
    : 0;
  const opYieldBps = latest.avgAum
    ? (latest.operatingProfit * 4 * 10_000) / latest.avgAum
    : 0;
  const profitYieldBps = latest.avgAum
    ? (latest.pat * 4 * 10_000) / latest.avgAum
    : 0;

  // PAT-margin QoQ also tracks the selected period (compares to the
  // immediately-prior available quarter, which may not be calendar-
  // contiguous for ICICI given its post-listing gaps).
  const prevQuarterRow =
    selectedIdx > 0 ? fullSeries[selectedIdx - 1] : null;
  const prevPatMargin =
    prevQuarterRow && prevQuarterRow.revenue > 0
      ? (prevQuarterRow.pat / prevQuarterRow.revenue) * 100
      : patMargin;
  const patMarginQoq = qoqChange([prevPatMargin, patMargin]);

  // FIXED 2-year x-axis: every chart on /quarterly uses the same 8 most
  // recent calendar quarters in the overall snapshot, regardless of the
  // selected AMC's data coverage. AMCs with gaps (e.g. ICICI Pru's
  // pre-listing 2024-Q2…Q3 + post-listing missing 2025-Q2) render nulls
  // at those positions so the missing quarters are visible as gaps
  // rather than silently absent. When `latestQuarter()` rolls forward
  // (e.g. 2026-Q2 lands), `fixedWindow` slides automatically.
  const fixedWindow = fixedQuarterWindow(
    latestQuarter(),
    CHART_HISTORY_WINDOW_QUARTERS
  );
  const seriesByQuarter = new Map(fullSeries.map((q) => [q.quarter, q]));

  const pnlData = fixedWindow.map((quarter) => {
    const r = seriesByQuarter.get(quarter);
    return {
      quarter,
      revenue: r ? r.revenue : null,
      op: r ? r.operatingProfit : null,
      pat: r ? r.pat : null,
    };
  });
  const marginData = fixedWindow.map((quarter) => {
    const r = seriesByQuarter.get(quarter);
    if (!r || r.revenue === 0) {
      return { quarter, patMargin: null, opMargin: null };
    }
    return {
      quarter,
      patMargin: Number(((r.pat / r.revenue) * 100).toFixed(2)),
      opMargin: Number(((r.operatingProfit / r.revenue) * 100).toFixed(2)),
    };
  });
  // null (not 0) for quarters where the AMC has no row OR where AAUM is
  // missing — Recharts renders a gap rather than a misleading line drop.
  const yieldData = fixedWindow.map((quarter) => {
    const r = seriesByQuarter.get(quarter);
    const hasAaum =
      r !== undefined &&
      aaumProvenance(slug, quarter)?.status === "ok" &&
      r.avgAum > 0;
    return {
      quarter,
      revenue: hasAaum
        ? Number(((r.revenue * 4 * 10_000) / r.avgAum).toFixed(1))
        : null,
      op: hasAaum
        ? Number(((r.operatingProfit * 4 * 10_000) / r.avgAum).toFixed(1))
        : null,
      profit: hasAaum
        ? Number(((r.pat * 4 * 10_000) / r.avgAum).toFixed(1))
        : null,
    };
  });

  const subtitle = `${profile.name}${profile.ticker ? ` (${profile.ticker})` : ""} · ${formatQuarterLabelLong(latest.quarter)}`;

  // Compact source / provenance line. Hostname only — keeps the line tight
  // while making the source unambiguous (screener.in for P&L, AMFI for AAUM).
  const pnlSourceHost = (() => {
    try {
      return new URL(amcQuarterlySnapshot.meta.source).hostname.replace(
        /^www\./,
        ""
      );
    } catch {
      return amcQuarterlySnapshot.meta.source;
    }
  })();
  const pnlSourceDate = new Date(amcQuarterlySnapshot.meta.generatedAt)
    .toISOString()
    .slice(0, 10);
  const aaumSourceDate = new Date(amcAaumQuarterlySnapshot.meta.generatedAt)
    .toISOString()
    .slice(0, 10);
  const provenanceLine = `P&L: ${pnlSourceHost} · ${pnlSourceDate} · MF QAAUM: AMFI · ${aaumSourceDate}`;
  const pnlNote = liveScreenerNote();
  const yieldNote = liveYieldNote();

  return (
    <div className="space-y-6">
      <PageHeader title="Quarterly Financials" subtitle={subtitle} />
      <FilterBar
        showRange={false}
        amcMode="single"
        amcStatus={status}
        defaultSlug={DEFAULT_SLUG}
      />
      <p className="-mt-2 text-[11px] tabular text-muted-foreground">
        {provenanceLine}
      </p>

      <QuarterPicker
        availableQuarters={availableQuarters}
        selectedQuarter={selectedPeriod}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue from Operations"
          value={formatCompactCrSafe(latest.revenue)}
          delta={`${formatDelta(revenueYoy)} YoY`}
          trend={trend(revenueYoy)}
          note={pnlNote}
        />
        <KpiCard
          label="Operating Profit"
          value={formatCompactCrSafe(latest.operatingProfit)}
          delta={`${formatDelta(opYoy)} YoY`}
          trend={trend(opYoy)}
          note={pnlNote}
        />
        <KpiCard
          label="PAT"
          value={formatCompactCrSafe(latest.pat)}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
          note={pnlNote}
        />
        <KpiCard
          label="PAT Margin"
          value={patMargin.toFixed(1) + "%"}
          delta={`${formatDelta(patMarginQoq)} QoQ`}
          trend={trend(patMarginQoq)}
          note={pnlNote}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Operating Margin (% of revenue)"
          value={opMargin.toFixed(1) + "%"}
          note={pnlNote}
        />
        <KpiCard
          label="Revenue Realization (bps of MF QAAUM)"
          value={
            latest.avgAum > 0 ? revenueYieldBps.toFixed(1) + " bps" : "—"
          }
          note={yieldNote}
        />
        <KpiCard
          label="Operating Margin (bps of MF QAAUM)"
          value={latest.avgAum > 0 ? opYieldBps.toFixed(1) + " bps" : "—"}
          note={yieldNote}
        />
        <KpiCard
          label="Profit Yield (bps of MF QAAUM)"
          value={
            latest.avgAum > 0 ? profitYieldBps.toFixed(1) + " bps" : "—"
          }
          note={yieldNote}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Revenue / Op Profit / PAT"
          subtitle="Quarterly · ₹ Cr · Revenue = Revenue from Operations (excludes Other Income)"
        >
          <GroupedBars
            data={pnlData}
            xKey="quarter"
            bars={[
              { key: "revenue", name: "Revenue from Ops", color: "hsl(var(--chart-1))" },
              { key: "op", name: "Op Profit", color: "hsl(var(--chart-2))" },
              { key: "pat", name: "PAT", color: "hsl(var(--chart-3))" },
            ]}
          />
        </Card>
        <Card title="Margin Trend" subtitle="PAT & Operating margin · %">
          <MultiLine
            data={marginData}
            xKey="quarter"
            valueFormat="pct"
            axisFormat="pct"
            lines={[
              { key: "patMargin", name: "PAT margin", color: "hsl(var(--chart-3))" },
              { key: "opMargin", name: "Operating margin", color: "hsl(var(--chart-2))" },
            ]}
          />
        </Card>
        <Card
          title="Yields (bps of MF QAAUM)"
          subtitle={yieldsSubtitle}
          className="lg:col-span-2"
        >
          <MultiLine
            data={yieldData}
            xKey="quarter"
            valueFormat="bps"
            axisFormat="bps"
            lines={[
              { key: "revenue", name: "Revenue realization", color: "hsl(var(--chart-1))" },
              { key: "op", name: "Operating yield", color: "hsl(var(--chart-2))" },
              { key: "profit", name: "Profit yield", color: "hsl(var(--chart-3))" },
            ]}
          />
        </Card>
      </section>
    </div>
  );
}
