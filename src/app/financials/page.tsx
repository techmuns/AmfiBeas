import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { CycleRibbon } from "@/components/ui/CycleRibbon";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { latestYoyPct } from "@/lib/chart-context";
import { financialsMarketWrap } from "@/data/market-wrap-financials";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import type { AmcStatus } from "@/components/filters/FilterBar";
import { QuarterPicker } from "@/components/filters/QuarterPicker";
import { StackedBarCombo } from "@/components/charts/StackedBarCombo";
import { DesignLanguageCard } from "@/components/ui/DesignLanguageCard";
import { FinancialsPeerCsvButton } from "@/components/data/FinancialsPeerCsvButton";
import { cyclePhaseHistory } from "@/data/market-indices";
import { cn } from "@/lib/cn";
import {
  SOURCED_FINANCIALS_SLUGS,
  fixedQuarterWindow,
  latestQuarter,
  qoqChange,
  quarterlyForAmc,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { aaumProvenance } from "@/data/source";
import { AMCS, getAMC } from "@/data/amcs";

// /financials renders only AMCs flagged listed=true in the AMC registry.
// Unlisted AMCs (SBI, Kotak, Axis, DSP, Mirae, …) don't publish standalone
// quarterly financials, so showing them as pending/disabled chips just adds
// noise on the client-facing view.
const LISTED_AMC_SLUGS = AMCS.filter((a) => a.listed).map((a) => a.slug);
import {
  formatCompactCrSafe,
  formatDelta,
  formatQuarterLabelLong,
} from "@/lib/format";
import { parseFilters } from "@/lib/filter";

const DEFAULT_SLUG = "hdfc";

function buildAmcStatus(): Record<string, AmcStatus> {
  const out: Record<string, AmcStatus> = {};
  for (const a of AMCS) {
    if (!a.listed) continue;
    out[a.slug] = SOURCED_FINANCIALS_SLUGS.has(a.slug) ? "live" : "pending";
  }
  return out;
}

export default async function FinancialsPage({
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

  // Chart-style toggles (Bars vs Trend) were removed across the
  // dashboard — the P&L card now renders the trend visual directly.
  // Stale `?pnlView=bars|trend` URLs are ignored silently.


  // Three-sentence "today's read" surfaced above the KPI grid.
  const marketWrapData = financialsMarketWrap(slug, selectedPeriod);

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

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  // No data → render empty state. Reaches this branch only if the default
  // slug somehow has no rows (defensive — hdfc is always sourced today).
  if (!latest || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Financials"
          subtitle="Single-AMC view · sourced quarterly P&L"
        />
        <FilterBar
          showRange={false}
          amcMode="single"
          amcStatus={status}
          defaultSlug={DEFAULT_SLUG}
          amcs={LISTED_AMC_SLUGS}
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

  // FIXED 2-year x-axis: every chart on /financials uses the same 8 most
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

  // Per-quarter YoY % for the three P&L exhibits. We look up the
  // quarter 4 periods back in fullSeries (not fixedWindow) so the
  // earliest visible quarter still has a comparable. Returns null
  // when either side is missing or the prior-year value is non-
  // positive (so the percent doesn't render as ±∞ in such cases).
  const yoyForField = (
    field: "revenue" | "operatingProfit" | "pat"
  ): Array<{ label: string; bottom: number | null; line: number | null }> => {
    return fixedWindow.map((quarter) => {
      const idx = fullSeries.findIndex((q) => q.quarter === quarter);
      const current = idx >= 0 ? fullSeries[idx][field] : null;
      const prior = idx >= 4 ? fullSeries[idx - 4][field] : null;
      const bottom =
        typeof current === "number" && Number.isFinite(current) ? current : null;
      const line =
        typeof current === "number" &&
        typeof prior === "number" &&
        Number.isFinite(current) &&
        Number.isFinite(prior) &&
        prior > 0
          ? Number((((current - prior) / prior) * 100).toFixed(1))
          : null;
      return { label: quarter, bottom, line };
    });
  };

  // Drop rows where the bar is null — Archetype C doesn't render gaps
  // for missing bars; the source-line note carries the explanation.
  const compactExhibit = (
    rows: Array<{ label: string; bottom: number | null; line: number | null }>
  ): Array<{ label: string; bottom: number; line: number }> =>
    rows
      .filter(
        (
          r
        ): r is { label: string; bottom: number; line: number } =>
          typeof r.bottom === "number" && typeof r.line === "number"
      );

  const revenueExhibit = compactExhibit(yoyForField("revenue"));
  const opProfitExhibit = compactExhibit(yoyForField("operatingProfit"));
  const patExhibit = compactExhibit(yoyForField("pat"));

  const marginExhibit = fixedWindow
    .map((quarter) => {
      const r = seriesByQuarter.get(quarter);
      if (!r || r.revenue <= 0) return null;
      const patMarginPct = Number(((r.pat / r.revenue) * 100).toFixed(1));
      return { label: quarter, bottom: r.pat, line: patMarginPct };
    })
    .filter((r): r is { label: string; bottom: number; line: number } => r !== null);

  const yieldExhibit = fixedWindow
    .map((quarter) => {
      const r = seriesByQuarter.get(quarter);
      if (
        !r ||
        aaumProvenance(slug, quarter)?.status !== "ok" ||
        r.avgAum <= 0
      )
        return null;
      const revenueYieldBpsPerQ = Number(
        ((r.revenue * 4 * 10_000) / r.avgAum).toFixed(1)
      );
      const opYieldBpsPerQ = Number(
        ((r.operatingProfit * 4 * 10_000) / r.avgAum).toFixed(1)
      );
      return { label: quarter, bottom: revenueYieldBpsPerQ, line: opYieldBpsPerQ };
    })
    .filter((r): r is { label: string; bottom: number; line: number } => r !== null);


  // ---- ChartWithContext insight + badge inputs for the three trend
  //      cards. Each helper produces a typed SeriesPoint[] from the
  //      already-built display data so the engine can compute YoY,
  //      σ-spike, run, ATH/ATL rules across quarterly P&L history.
  const revenueSeries = pnlData
    .filter((p): p is typeof p & { revenue: number } => typeof p.revenue === "number")
    .map((p) => ({ label: p.quarter, value: p.revenue }));

  // ---- Peer comparison rows (PR #96): same quarter, all 5 sourced AMCs ----
  // Same metrics the KPI cards show for the focused AMC, but laid out as a
  // compact table so the reader sees how the focused AMC stacks up against
  // the listed peers in one glance. Drives off the SAME data the KPI cards
  // and charts use (`liveQuarterlyBySlug` via `quarterlyForAmc`) so peer
  // numbers cannot drift from the per-AMC numbers above. Missing rows
  // (e.g. ICICI Pru pre-listing quarters) render "—" rather than fake data.
  interface PeerRow {
    amcSlug: string;
    name: string;
    ticker: string | null;
    isFocused: boolean;
    avgAum: number | null;
    revenue: number | null;
    operatingProfit: number | null;
    pat: number | null;
    patMargin: number | null;
    opMargin: number | null;
    revenueYieldBps: number | null;
    opYieldBps: number | null;
    profitYieldBps: number | null;
    derivedFrom: string | null;
  }
  const peerRows: PeerRow[] = Array.from(SOURCED_FINANCIALS_SLUGS).map(
    (peerSlug) => {
      const peerProfile = getAMC(peerSlug);
      const series = quarterlyForAmc(peerSlug);
      const row = series.find((q) => q.quarter === selectedPeriod);
      const aaumOk =
        row &&
        aaumProvenance(peerSlug, selectedPeriod)?.status === "ok" &&
        row.avgAum > 0;
      const yieldFor = (numerator: number) =>
        aaumOk && row ? Number(((numerator * 4 * 10_000) / row.avgAum).toFixed(1)) : null;
      return {
        amcSlug: peerSlug,
        name: peerProfile?.name ?? peerSlug,
        ticker: peerProfile?.ticker ?? null,
        isFocused: peerSlug === slug,
        avgAum: row && aaumOk ? row.avgAum : null,
        revenue: row ? row.revenue : null,
        operatingProfit: row ? row.operatingProfit : null,
        pat: row ? row.pat : null,
        patMargin:
          row && row.revenue > 0
            ? Number(((row.pat / row.revenue) * 100).toFixed(1))
            : null,
        opMargin:
          row && row.revenue > 0
            ? Number(((row.operatingProfit / row.revenue) * 100).toFixed(1))
            : null,
        revenueYieldBps: row ? yieldFor(row.revenue) : null,
        opYieldBps: row ? yieldFor(row.operatingProfit) : null,
        profitYieldBps: row ? yieldFor(row.pat) : null,
        derivedFrom: row?.derivedFrom ?? null,
      };
    }
  );
  // Order peers by AAUM descending for the selected quarter; rows with no
  // AAUM go to the bottom. Stable on AMC name within ties.
  peerRows.sort((a, b) => {
    const aHas = a.avgAum !== null;
    const bHas = b.avgAum !== null;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas && a.avgAum !== b.avgAum)
      return (b.avgAum ?? 0) - (a.avgAum ?? 0);
    return a.name.localeCompare(b.name);
  });

  const subtitle = `${profile.name}${profile.ticker ? ` (${profile.ticker})` : ""} · ${formatQuarterLabelLong(latest.quarter)}`;

  // KPI cards on /financials carry a short source caption + an optional
  // "Derived · ..." prefix for rows reconstructed from multi-quarter
  // disclosures (e.g. ICICI Pru 2025-Q2 from 9M FY26 minus reported quarters).
  const derivedHeadline = latest.derivedFrom
    ? latest.derivedFrom.split(".")[0].trim() + "."
    : null;
  const pnlSource = "Source: Company filings";
  const yieldSource = "Source: Company filings · AMFI Fundwise AAUM";
  const pnlNote = derivedHeadline
    ? `Derived · ${derivedHeadline} · ${pnlSource}`
    : pnlSource;
  const yieldNote = derivedHeadline
    ? `Derived · ${derivedHeadline} · ${yieldSource}`
    : yieldSource;
  const cyclePhasePoints = cyclePhaseHistory();

  // ---- KPI-card sparklines + peer-median deltas ----
  // 8Q sparkline values for the focused AMC. Each strips nulls so the
  // sparkline stays bounded; if there are < 2 points we don't render.
  const revenueSparkline = pnlData
    .filter((p): p is typeof p & { revenue: number } => typeof p.revenue === "number")
    .map((p) => ({ label: p.quarter, value: p.revenue }));
  const opSparkline = pnlData
    .filter((p): p is typeof p & { op: number } => typeof p.op === "number")
    .map((p) => ({ label: p.quarter, value: p.op }));
  const patSparkline = pnlData
    .filter((p): p is typeof p & { pat: number } => typeof p.pat === "number")
    .map((p) => ({ label: p.quarter, value: p.pat }));
  const patMarginSparkline = marginData
    .filter((p): p is typeof p & { patMargin: number } => typeof p.patMargin === "number")
    .map((p) => ({ label: p.quarter, value: p.patMargin }));
  const opMarginSparkline = marginData
    .filter((p): p is typeof p & { opMargin: number } => typeof p.opMargin === "number")
    .map((p) => ({ label: p.quarter, value: p.opMargin }));
  const revenueYieldSparkline = yieldData
    .filter((p): p is typeof p & { revenue: number } => typeof p.revenue === "number")
    .map((p) => ({ label: p.quarter, value: p.revenue }));
  const opYieldSparkline = yieldData
    .filter((p): p is typeof p & { op: number } => typeof p.op === "number")
    .map((p) => ({ label: p.quarter, value: p.op }));
  const profitYieldSparkline = yieldData
    .filter((p): p is typeof p & { profit: number } => typeof p.profit === "number")
    .map((p) => ({ label: p.quarter, value: p.profit }));

  // Peer-median context: drives the "vs peer median" ratio pills on
  // margin / yield KPIs so the reader sees competitive position at a
  // glance. Computed off `peerRows` (the same data the table below
  // uses) so peer numbers can't drift between cards and table.
  const peerMedianHelper = (values: (number | null)[]): number | null => {
    const xs = values.filter((v): v is number => typeof v === "number");
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const peerMedianPatMargin = peerMedianHelper(peerRows.map((p) => p.patMargin));
  const peerMedianOpMargin = peerMedianHelper(peerRows.map((p) => p.opMargin));
  const peerMedianRevenueYield = peerMedianHelper(
    peerRows.map((p) => p.revenueYieldBps)
  );
  const peerMedianOpYield = peerMedianHelper(peerRows.map((p) => p.opYieldBps));
  const peerMedianProfitYield = peerMedianHelper(
    peerRows.map((p) => p.profitYieldBps)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Financials" subtitle={subtitle} />
      <FilterBar
        showRange={false}
        amcMode="single"
        amcStatus={status}
        defaultSlug={DEFAULT_SLUG}
        amcs={LISTED_AMC_SLUGS}
      />

      {cyclePhasePoints.length > 0 && (
        <Card
          title="Cycle Regime"
          subtitle="Per-month cycle phase · helps contextualise the quarters below"
        >
          <CycleRibbon points={cyclePhasePoints} lastN={84} />
        </Card>
      )}

      <MarketWrapCard wrap={marketWrapData} />

      <QuarterPicker
        availableQuarters={availableQuarters}
        selectedQuarter={selectedPeriod}
      />

      <SectionDivider
        eyebrow="Section 1"
        label="Headline financials"
        context="Revenue, profit, margins and yields for the selected quarter."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Operating Revenue"
          value={formatCompactCrSafe(latest.revenue)}
          delta={`${formatDelta(revenueYoy)} YoY`}
          trend={trend(revenueYoy)}
          note={pnlNote}
          sparkline={revenueSparkline}
          sparklineColor="hsl(var(--chart-1))"
          yoyPct={revenueYoy}
        />
        <KpiCard
          label="Operating Profit"
          value={formatCompactCrSafe(latest.operatingProfit)}
          delta={`${formatDelta(opYoy)} YoY`}
          trend={trend(opYoy)}
          note={pnlNote}
          sparkline={opSparkline}
          sparklineColor="hsl(var(--chart-2))"
          yoyPct={opYoy}
        />
        <KpiCard
          label="PAT"
          value={formatCompactCrSafe(latest.pat)}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
          note={pnlNote}
          sparkline={patSparkline}
          sparklineColor="hsl(var(--chart-3))"
          yoyPct={patYoy}
        />
        <KpiCard
          label="PAT Margin"
          value={patMargin.toFixed(1) + "%"}
          delta={`${formatDelta(patMarginQoq)} QoQ`}
          trend={trend(patMarginQoq)}
          note={pnlNote}
          sparkline={patMarginSparkline}
          sparklineColor="hsl(var(--chart-3))"
          ratio={
            peerMedianPatMargin !== null
              ? `${(patMargin - peerMedianPatMargin) >= 0 ? "+" : ""}${(patMargin - peerMedianPatMargin).toFixed(1)}pp vs peer median`
              : undefined
          }
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Operating Margin (% of revenue)"
          value={opMargin.toFixed(1) + "%"}
          note={pnlNote}
          sparkline={opMarginSparkline}
          sparklineColor="hsl(var(--chart-2))"
          ratio={
            peerMedianOpMargin !== null
              ? `${(opMargin - peerMedianOpMargin) >= 0 ? "+" : ""}${(opMargin - peerMedianOpMargin).toFixed(1)}pp vs peer median`
              : undefined
          }
        />
        <KpiCard
          label="Revenue Yield (bps of MF QAAUM)"
          value={
            latest.avgAum > 0 ? revenueYieldBps.toFixed(1) + " bps" : "—"
          }
          note={yieldNote}
          sparkline={revenueYieldSparkline}
          sparklineColor="hsl(var(--chart-1))"
          ratio={
            peerMedianRevenueYield !== null && latest.avgAum > 0
              ? `${(revenueYieldBps - peerMedianRevenueYield) >= 0 ? "+" : ""}${(revenueYieldBps - peerMedianRevenueYield).toFixed(1)} bps vs peer median`
              : undefined
          }
        />
        <KpiCard
          label="Operating Yield (bps of MF QAAUM)"
          value={latest.avgAum > 0 ? opYieldBps.toFixed(1) + " bps" : "—"}
          note={yieldNote}
          sparkline={opYieldSparkline}
          sparklineColor="hsl(var(--chart-2))"
          ratio={
            peerMedianOpYield !== null && latest.avgAum > 0
              ? `${(opYieldBps - peerMedianOpYield) >= 0 ? "+" : ""}${(opYieldBps - peerMedianOpYield).toFixed(1)} bps vs peer median`
              : undefined
          }
        />
        <KpiCard
          label="Profit Yield (bps of MF QAAUM)"
          value={
            latest.avgAum > 0 ? profitYieldBps.toFixed(1) + " bps" : "—"
          }
          note={yieldNote}
          sparkline={profitYieldSparkline}
          sparklineColor="hsl(var(--chart-3))"
          ratio={
            peerMedianProfitYield !== null && latest.avgAum > 0
              ? `${(profitYieldBps - peerMedianProfitYield) >= 0 ? "+" : ""}${(profitYieldBps - peerMedianProfitYield).toFixed(1)} bps vs peer median`
              : undefined
          }
        />
      </section>

      <FinancialSignalReadCard
        amcName={profile?.name ?? slug.toUpperCase()}
        latest={latest}
        revenueYoy={latestYoyPct(revenueSeries, 4)}
        patYoy={latestYoyPct(
          pnlData.map((d) => ({ label: d.quarter, value: d.pat ?? 0 })),
          4
        )}
        patMarginPct={latest.revenue > 0 ? (latest.pat / latest.revenue) * 100 : null}
        opMarginPct={
          latest.revenue > 0 ? (latest.operatingProfit / latest.revenue) * 100 : null
        }
        peerMedianPatMarginPct={peerMedianPatMargin}
        revenueYieldBps={revenueYieldBps}
        peerMedianRevenueYieldBps={peerMedianRevenueYield}
      />

      <SectionDivider
        eyebrow="Section 2"
        label="Trends"
        context="P&L, margins, and yields over the available quarterly history."
      />

      <section className="grid gap-4 lg:grid-cols-3">
        {revenueExhibit.length >= 2 && (
          <DesignLanguageCard
            title="Operating revenue and YoY"
            chartId="fin-revenue-yoy"
            source={`Source: Standalone quarterly P&L · ${revenueExhibit.length} quarter${revenueExhibit.length === 1 ? "" : "s"} · Operating Revenue may include non-MF lines`}
          >
            <StackedBarCombo
              variant="C"
              data={revenueExhibit}
              barName="Operating revenue"
              lineName="YoY"
              rightUnitLabel="%"
              height={260}
            />
          </DesignLanguageCard>
        )}
        {opProfitExhibit.length >= 2 && (
          <DesignLanguageCard
            title="Operating profit and YoY"
            chartId="fin-opprofit-yoy"
            source={`Source: Standalone quarterly P&L · ${opProfitExhibit.length} quarter${opProfitExhibit.length === 1 ? "" : "s"} · excludes Other Income`}
          >
            <StackedBarCombo
              variant="C"
              data={opProfitExhibit}
              barName="Operating profit"
              lineName="YoY"
              rightUnitLabel="%"
              height={260}
            />
          </DesignLanguageCard>
        )}
        {patExhibit.length >= 2 && (
          <DesignLanguageCard
            title="PAT and YoY"
            chartId="fin-pat-yoy"
            source={`Source: Standalone quarterly P&L · ${patExhibit.length} quarter${patExhibit.length === 1 ? "" : "s"}`}
          >
            <StackedBarCombo
              variant="C"
              data={patExhibit}
              barName="PAT"
              lineName="YoY"
              rightUnitLabel="%"
              height={260}
            />
          </DesignLanguageCard>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {marginExhibit.length >= 2 && (
          <DesignLanguageCard
            title="PAT and PAT margin"
            chartId="fin-pat-margin"
            source={`Source: Standalone quarterly P&L · ${marginExhibit.length} quarter${marginExhibit.length === 1 ? "" : "s"} · PAT margin = PAT ÷ Operating Revenue`}
          >
            <StackedBarCombo
              variant="C"
              data={marginExhibit}
              barName="PAT"
              lineName="PAT margin"
              rightUnitLabel="%"
            />
          </DesignLanguageCard>
        )}
        {yieldExhibit.length >= 2 && (
          <DesignLanguageCard
            title="Revenue yield and operating yield"
            chartId="fin-yields"
            source={`Source: Standalone quarterly P&L ÷ AMFI MF QAAUM · ${yieldExhibit.length} quarter${yieldExhibit.length === 1 ? "" : "s"} · Operating Revenue may include non-MF lines (AIF/PMS/advisory/international) — yields read as a ceiling on the pure-MF management-fee yield`}
          >
            <StackedBarCombo
              variant="C"
              data={yieldExhibit}
              barName="Revenue yield"
              lineName="Operating yield"
              leftMode="raw"
              leftUnitLabel="bps"
              rightUnitLabel="bps"
            />
          </DesignLanguageCard>
        )}
      </section>

      <SectionDivider
        eyebrow="Section 3"
        label="Peer comparison"
        context="Side-by-side with the 5 listed peers for the selected quarter."
      />

      <Card
        title="Listed-AMC Peer Comparison"
        subtitle={`${peerRows.length} listed AMCs · ${formatQuarterLabelLong(selectedPeriod)}${peerRows.some((p) => p.derivedFrom) ? " · derived rows flagged inline" : ""} · Source: Company filings · AMFI Fundwise AAUM`}
        action={
          <FinancialsPeerCsvButton
            rows={peerRows}
            filename={`financials-peer-${selectedPeriod}.csv`}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">AMC</th>
                <th className="py-2 pr-3 text-right font-medium tabular">AAUM</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op Revenue</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op Profit</th>
                <th className="py-2 pr-3 text-right font-medium tabular">PAT</th>
                <th className="py-2 pr-3 text-right font-medium tabular">PAT %</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op %</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Rev Yield</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op Yield</th>
                <th className="py-2 pr-1 text-right font-medium tabular">Profit Yield</th>
              </tr>
            </thead>
            <tbody>
              {peerRows.map((p) => (
                <tr
                  key={p.amcSlug}
                  className={cn(
                    "border-b last:border-0",
                    p.isFocused && "bg-accent/40"
                  )}
                >
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          p.isFocused ? "font-semibold" : "font-medium"
                        )}
                      >
                        {p.name}
                      </span>
                      {p.ticker && (
                        <span className="text-xs text-muted-foreground">
                          {p.ticker}
                        </span>
                      )}
                      {p.derivedFrom && (
                        <span
                          className="inline-flex items-center rounded-full border bg-muted px-1.5 py-0.5 text-[10px] tabular text-muted-foreground"
                          title={p.derivedFrom}
                        >
                          derived
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.avgAum)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.revenue)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.operatingProfit)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.pat)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    <PeerMetricCell
                      value={p.patMargin}
                      median={peerMedianPatMargin}
                      suffix="%"
                      digits={1}
                      deltaSuffix="pp"
                    />
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    <PeerMetricCell
                      value={p.opMargin}
                      median={peerMedianOpMargin}
                      suffix="%"
                      digits={1}
                      deltaSuffix="pp"
                    />
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    <PeerMetricCell
                      value={p.revenueYieldBps}
                      median={peerMedianRevenueYield}
                      suffix=" bps"
                      digits={1}
                      deltaSuffix="bps"
                    />
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    <PeerMetricCell
                      value={p.opYieldBps}
                      median={peerMedianOpYield}
                      suffix=" bps"
                      digits={1}
                      deltaSuffix="bps"
                    />
                  </td>
                  <td className="py-2 pr-1 text-right tabular text-muted-foreground">
                    <PeerMetricCell
                      value={p.profitYieldBps}
                      median={peerMedianProfitYield}
                      suffix=" bps"
                      digits={1}
                      deltaSuffix="bps"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] tabular text-muted-foreground">
          Sorted by AAUM descending. Highlighted row matches the AMC
          selected above.
          <InfoTooltip label="Yields = annualised P&L (quarterly × 4) ÷ same-quarter MF AAUM, expressed in bps (× 10,000). AAUM column in ₹ Cr; &quot;—&quot; marks quarters with missing AAUM or P&L data." />
        </p>
      </Card>
    </div>
  );
}

/** Compact peer-comparison table cell: shows the value + a small
 *  "vs median" Δ pill underneath, tone-coloured for direction. */
function PeerMetricCell({
  value,
  median,
  suffix,
  digits = 1,
  deltaSuffix,
}: {
  value: number | null;
  median: number | null;
  suffix: string;
  digits?: number;
  deltaSuffix: string;
}) {
  if (value === null) {
    return <span>—</span>;
  }
  const display = `${value.toFixed(digits)}${suffix}`;
  if (median === null) return <span>{display}</span>;
  const delta = value - median;
  // Small dead zone so cells near the median don't all glow.
  const tone =
    Math.abs(delta) < 0.1
      ? "text-muted-foreground"
      : delta > 0
        ? "text-positive"
        : "text-negative";
  return (
    <div className="inline-flex flex-col items-end leading-tight">
      <span>{display}</span>
      <span className={cn("text-[10px] tabular", tone)}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(digits)} {deltaSuffix}
      </span>
    </div>
  );
}

/** Listed-AMC Financial Signal Read — concise buy-side interpretation
 *  of the selected AMC's latest quarter: revenue / PAT / margins /
 *  peer position. Pure template, no LLM. */
function FinancialSignalReadCard({
  amcName,
  latest,
  revenueYoy,
  patYoy,
  patMarginPct,
  opMarginPct,
  peerMedianPatMarginPct,
  revenueYieldBps,
  peerMedianRevenueYieldBps,
}: {
  amcName: string;
  latest: { quarter: string; revenue: number; operatingProfit: number; pat: number };
  revenueYoy: number | null;
  patYoy: number | null;
  patMarginPct: number | null;
  opMarginPct: number | null;
  peerMedianPatMarginPct: number | null;
  revenueYieldBps: number;
  peerMedianRevenueYieldBps: number | null;
}) {
  const periodLabel = formatQuarterLabelLong(latest.quarter);

  const headline = (() => {
    if (revenueYoy === null && patYoy === null) {
      return `${amcName} · ${periodLabel}: earnings read pending — YoY comparison unavailable.`;
    }
    const rev = revenueYoy ?? 0;
    const pat = patYoy ?? 0;
    if (rev >= 10 && pat >= 15) {
      return `${amcName} delivered a strong ${periodLabel}: revenue and earnings both expanding above the AAUM line.`;
    }
    if (rev >= 5 && pat >= 5 && pat >= rev) {
      return `${amcName} showed operating leverage in ${periodLabel}: earnings grew faster than revenue.`;
    }
    if (rev > 0 && pat < 0) {
      return `${amcName} grew revenue but earnings fell in ${periodLabel} — cost or yield headwinds are eating leverage.`;
    }
    if (rev < 0) {
      return `${amcName} had a soft ${periodLabel}: revenue contracted YoY.`;
    }
    return `${amcName} posted a steady ${periodLabel} — no headline upside surprise.`;
  })();

  const marginVsPeer =
    patMarginPct !== null && peerMedianPatMarginPct !== null
      ? patMarginPct - peerMedianPatMarginPct
      : null;
  const yieldVsPeer =
    peerMedianRevenueYieldBps !== null
      ? revenueYieldBps - peerMedianRevenueYieldBps
      : null;

  const beats: string[] = [];
  if (revenueYoy !== null)
    beats.push(`Revenue ${revenueYoy >= 0 ? "+" : ""}${revenueYoy.toFixed(1)}% YoY`);
  if (patYoy !== null)
    beats.push(`PAT ${patYoy >= 0 ? "+" : ""}${patYoy.toFixed(1)}% YoY`);
  if (patMarginPct !== null)
    beats.push(
      `PAT margin ${patMarginPct.toFixed(1)}%${
        marginVsPeer !== null
          ? ` (${marginVsPeer >= 0 ? "+" : ""}${marginVsPeer.toFixed(1)} pp vs peer median)`
          : ""
      }`
    );
  if (opMarginPct !== null)
    beats.push(`Operating margin ${opMarginPct.toFixed(1)}%`);
  if (yieldVsPeer !== null)
    beats.push(
      `Revenue yield ${revenueYieldBps.toFixed(1)} bps (${yieldVsPeer >= 0 ? "+" : ""}${yieldVsPeer.toFixed(1)} bps vs peer median)`
    );

  const watch =
    marginVsPeer !== null && marginVsPeer < -2
      ? "Watch PAT-margin gap vs peers — closing requires either yield expansion or cost discipline."
      : marginVsPeer !== null && marginVsPeer > 2
      ? "Margin premium vs peers is the durable edge — watch whether passive accelerating compresses it."
      : "Watch quarterly margin momentum + revenue yield drift — small drifts compound into multi-year re-rating.";

  return (
    <Card
      title="Listed AMC Financial Signal Read"
      subtitle={`${amcName} · ${periodLabel} · buy-side interpretation`}
    >
      <div className="space-y-2 text-[13px] leading-snug">
        <p className="font-medium text-foreground">{headline}</p>
        {beats.length > 0 && (
          <p className="text-muted-foreground">{beats.join(" · ")}.</p>
        )}
        <p className="text-muted-foreground">{watch}</p>
      </div>
    </Card>
  );
}
