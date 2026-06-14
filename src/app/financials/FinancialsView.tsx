"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import { CompactStatCard } from "@/components/ui/CompactStatCard";
import { Card } from "@/components/ui/Card";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import {
  AmcCompareSection,
  parseCompareKpis,
} from "@/components/amc/AmcCompareSection";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { chartInsights, latestYoyPct } from "@/lib/chart-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import type { AmcStatus } from "@/components/filters/FilterBar";
import { QuarterPicker } from "@/components/filters/QuarterPicker";
import { MultiLine } from "@/components/charts/MultiLine";
import { FinancialsPeerExport } from "@/components/data/FinancialsPeerExport";
import { HowToRead } from "@/components/ui/HowToRead";
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

export function FinancialsView() {
  // Read the AMC / period / view selection from the URL on the CLIENT, so this
  // whole (computation-heavy) view renders in the browser rather than on the
  // Cloudflare Worker — keeping the page static and off the per-request CPU
  // budget that otherwise trips Error 1102.
  const params = useSearchParams();
  const sp = useMemo<Record<string, string | string[] | undefined>>(() => {
    const out: Record<string, string | string[] | undefined> = {};
    if (!params) return out;
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      out[key] = all.length > 1 ? all : all[0];
    }
    return out;
  }, [params]);

  // Compare view: a top-of-page "Compare AMCs" button swaps the single-AMC
  // financials page for the listed-AMC comparison (two switchable
  // horizontal-bar charts). No tab strip — the button toggles `?view=compare`
  // and a back link returns to the single-AMC view.
  if (sp.view === "compare") {
    const { finKpi, aumKpi } = parseCompareKpis(sp);
    return (
      <div className="space-y-6">
        <PageHeader
          title="Financials"
          subtitle="Compare listed AMCs · financials & AUM"
          action={
            <Link
              href="/financials"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Financials
            </Link>
          }
        />
        <AmcCompareSection
          basePath="/financials"
          finKpi={finKpi}
          aumKpi={aumKpi}
          preserveParams={{ view: "compare" }}
        />
      </div>
    );
  }

  // "Compare AMCs" button reused across both single-AMC PageHeaders below.
  const compareButton = (
    <Link
      href="/financials?view=compare"
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ArrowLeftRight className="h-3 w-3" />
      Compare AMCs
    </Link>
  );

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

  // Scale toggle for the P&L trend card. Revenue ≫ Operating Profit ≫
  // PAT in absolute ₹ Cr, so on a shared y-axis the PAT line gets
  // squashed and its growth volatility is hard to read. "indexed"
  // rebases each series to 100 at the first visible quarter so all
  // three move on a comparable growth scale.

  // Series spec shared by the bars and trend views of the P&L card.

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

  // Yields chart subtitle — methodology only (formula). Source-attribution
  // captions retired in PR #98; the formula stays so the user knows what's
  // being charted.
  const yieldsSubtitle =
    "bps of MF QAAUM · annualised P&L (quarterly × 4) ÷ same-quarter MF QAAUM";

  // No data → render empty state. Reaches this branch only if the default
  // slug somehow has no rows (defensive — hdfc is always sourced today).
  if (!latest || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Financials"
          subtitle="Single-AMC view · sourced quarterly P&L"
          action={compareButton}
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
  // QoQ deltas (vs the immediately-prior available quarter) for the same
  // three P&L lines, also anchored to the selected period.
  const revenueQoq = qoqChange(seriesUpToSelected.map((q) => q.revenue));
  const opQoq = qoqChange(seriesUpToSelected.map((q) => q.operatingProfit));
  const patQoq = qoqChange(seriesUpToSelected.map((q) => q.pat));
  // Guard revenue > 0 like every other margin computation in this file (the
  // per-quarter margin series below and the signal card) so a zero-revenue
  // row renders "—" rather than "NaN%".
  const patMargin = latest.revenue > 0 ? (latest.pat / latest.revenue) * 100 : null;
  const opMargin =
    latest.revenue > 0 ? (latest.operatingProfit / latest.revenue) * 100 : null;
  // Management-comparable "bps of AAUM": quarterly P&L × 4 / AAUM × 10,000.
  // Mirrors the disclosure on listed AMC investor decks.
  const revenueYieldBps = latest.avgAum
    ? (latest.revenue * 4 * 10_000) / latest.avgAum
    : 0;

  // Margin YoY / QoQ — built from the margin series up to the selected
  // quarter so both deltas track the selected period (ICICI's post-
  // listing gaps mean the "prior quarter" may not be calendar-contiguous).
  const patMarginSeriesToSelected = seriesUpToSelected.map((q) =>
    q.revenue > 0 ? (q.pat / q.revenue) * 100 : 0
  );
  const opMarginSeriesToSelected = seriesUpToSelected.map((q) =>
    q.revenue > 0 ? (q.operatingProfit / q.revenue) * 100 : 0
  );
  const patMarginYoy = yoyChangeQuarterly(patMarginSeriesToSelected);
  const patMarginQoq = qoqChange(patMarginSeriesToSelected);
  const opMarginYoy = yoyChangeQuarterly(opMarginSeriesToSelected);
  const opMarginQoq = qoqChange(opMarginSeriesToSelected);

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
  const revenueSeries = pnlData
    .filter((p): p is typeof p & { revenue: number } => typeof p.revenue === "number")
    .map((p) => ({ label: p.quarter, value: p.revenue }));
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

  // ---- Peer-median time series for Margin & Yields charts ----
  // For each quarter in the window, compute the median margin / yield
  // across every sourced AMC. Drawn as muted reference lines on the
  // two charts so the reader sees outperformance vs the cohort at a
  // glance.
  const medianHelper = (values: (number | null)[]): number | null => {
    const xs = values.filter((v): v is number => typeof v === "number");
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const peerSeriesBySlug = new Map<string, Map<string, ReturnType<typeof quarterlyForAmc>[number]>>();
  for (const peerSlug of SOURCED_FINANCIALS_SLUGS) {
    const map = new Map<string, ReturnType<typeof quarterlyForAmc>[number]>();
    for (const r of quarterlyForAmc(peerSlug)) {
      map.set(r.quarter, r);
    }
    peerSeriesBySlug.set(peerSlug, map);
  }
  const peerMarginByQuarter = new Map<
    string,
    { patMargin: number | null; opMargin: number | null }
  >();
  const peerYieldByQuarter = new Map<
    string,
    {
      revenue: number | null;
      op: number | null;
      profit: number | null;
    }
  >();
  for (const quarter of fixedWindow) {
    const patMargins: (number | null)[] = [];
    const opMargins: (number | null)[] = [];
    const revenueYields: (number | null)[] = [];
    const opYields: (number | null)[] = [];
    const profitYields: (number | null)[] = [];
    for (const peerSlug of SOURCED_FINANCIALS_SLUGS) {
      const r = peerSeriesBySlug.get(peerSlug)?.get(quarter);
      if (!r) continue;
      if (r.revenue > 0) {
        patMargins.push((r.pat / r.revenue) * 100);
        opMargins.push((r.operatingProfit / r.revenue) * 100);
      }
      const peerAaumOk =
        aaumProvenance(peerSlug, quarter)?.status === "ok" && r.avgAum > 0;
      if (peerAaumOk) {
        revenueYields.push((r.revenue * 4 * 10_000) / r.avgAum);
        opYields.push((r.operatingProfit * 4 * 10_000) / r.avgAum);
        profitYields.push((r.pat * 4 * 10_000) / r.avgAum);
      }
    }
    peerMarginByQuarter.set(quarter, {
      patMargin: medianHelper(patMargins),
      opMargin: medianHelper(opMargins),
    });
    peerYieldByQuarter.set(quarter, {
      revenue: medianHelper(revenueYields),
      op: medianHelper(opYields),
      profit: medianHelper(profitYields),
    });
  }
  const yieldDataWithPeer = yieldData.map((p) => {
    const peer = peerYieldByQuarter.get(p.quarter);
    return {
      ...p,
      revenueMedian:
        peer?.revenue !== undefined && peer.revenue !== null
          ? Number(peer.revenue.toFixed(1))
          : null,
      opMedian:
        peer?.op !== undefined && peer.op !== null
          ? Number(peer.op.toFixed(1))
          : null,
      profitMedian:
        peer?.profit !== undefined && peer.profit !== null
          ? Number(peer.profit.toFixed(1))
          : null,
    };
  });

  // ---- ChartWithContext insight + badge inputs for the three trend
  //      cards. Each helper produces a typed SeriesPoint[] from the
  //      already-built display data so the engine can compute YoY,
  //      σ-spike, run, ATH/ATL rules across quarterly P&L history.


  const revenueYieldSeries = yieldData
    .filter((p): p is typeof p & { revenue: number } => typeof p.revenue === "number")
    .map((p) => ({ label: p.quarter, value: p.revenue }));
  const yieldInsights = chartInsights(revenueYieldSeries, {
    metricName: "revenue yield",
    unitSuffix: "bps",
    yoyLag: 4,
  });
  // Yield denominator: latest gap vs peer median revenue yield.
  const yieldDenomCaption = (() => {
    for (let i = yieldDataWithPeer.length - 1; i >= 0; i--) {
      const p = yieldDataWithPeer[i];
      if (
        typeof p.revenue === "number" &&
        typeof p.revenueMedian === "number"
      ) {
        const gap = p.revenue - p.revenueMedian;
        return `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)} bps vs peer median revenue yield · ${p.quarter}`;
      }
    }
    return undefined;
  })();

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

  // Peer-median context: drives the "vs peer median" Δ pills in the
  // peer-comparison table so the reader sees competitive position at a
  // glance. Computed off `peerRows` (the same data the table below
  // uses) so peer numbers can't drift between sources.
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
      <PageHeader title="Financials" subtitle={subtitle} action={compareButton} />
      <FilterBar
        showRange={false}
        amcMode="single"
        amcStatus={status}
        defaultSlug={DEFAULT_SLUG}
        amcs={LISTED_AMC_SLUGS}
      />

      <QuarterPicker
        availableQuarters={availableQuarters}
        selectedQuarter={selectedPeriod}
      />

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

      <Card
        title="Revenue Yield Methodology"
        subtitle="Important: how to read these numbers"
      >
        <ul className="list-disc space-y-1.5 pl-5 text-[12px] leading-snug text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">
              Operating revenue may include non-MF revenue.
            </span>{" "}
            Public filings do not cleanly split mutual-fund management fees
            from AIF / PMS / advisory / other operating revenue, so the
            yield reads as a slight ceiling on the true pure-MF
            management-fee yield. Cross-AMC differences in the non-MF mix
            can inflate or deflate the comparison.
          </li>
          <li>
            <span className="text-foreground">Formula:</span> revenue yield
            (bps) = annualised Operating Revenue ÷ same-quarter MF QAAUM
            × 10,000. Operating yield and profit yield use the same
            denominator with Operating Profit and PAT numerators.
          </li>
          <li>
            <span className="text-foreground">Peer comparison:</span> the
            &ldquo;vs peer median&rdquo; deltas use the median across all
            listed AMCs in the same quarter — a positive Δ means this AMC
            monetises AAUM more aggressively than the listed cohort.
            <InfoTooltip label="Placeholder fields exist in the data layer for mfManagementFees and otherOperatingRevenue. When AMC disclosure improves (e.g. segment-level filings consistently breaking out MF vs non-MF), these can be wired up without changing the chart shape." />
          </li>
        </ul>
      </Card>

      {/* Five compact P&L stat cards — each shows the headline value with
          both YoY and QoQ growth. Yield cards moved to the Yields chart +
          peer table below; per-card sparklines/source notes dropped to keep
          this row small and scannable. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <CompactStatCard
          label="Revenue"
          value={formatCompactCrSafe(latest.revenue)}
          yoyPct={revenueYoy}
          qoqPct={revenueQoq}
        />
        <CompactStatCard
          label="Operating Profit"
          value={formatCompactCrSafe(latest.operatingProfit)}
          yoyPct={opYoy}
          qoqPct={opQoq}
        />
        <CompactStatCard
          label="PAT"
          value={formatCompactCrSafe(latest.pat)}
          yoyPct={patYoy}
          qoqPct={patQoq}
        />
        <CompactStatCard
          label="Operating Margin"
          value={opMargin === null ? "—" : opMargin.toFixed(1) + "%"}
          yoyPct={opMarginYoy}
          qoqPct={opMarginQoq}
        />
        <CompactStatCard
          label="PAT Margin"
          value={patMargin === null ? "—" : patMargin.toFixed(1) + "%"}
          yoyPct={patMarginYoy}
          qoqPct={patMarginQoq}
        />
      </section>


      <ChartWithContext
        title="Yields (bps of MF QAAUM)"
        subtitle="How many basis points each rupee of AAUM earns — revenue, operating, and profit yields, against peer median."
        flowKind="stock"
        denominatorCaption={(() => {
          const base = `${yieldsSubtitle} · peer-median overlay`;
          return yieldDenomCaption
            ? `${base} · ${yieldDenomCaption}`
            : base;
        })()}
        denominatorTooltip="Latest revenue yield minus the listed-peer median revenue yield for the same quarter, in basis points. Positive = AMC monetises AAUM harder than the cohort."
        insights={yieldInsights}
        yoyBadge={(() => {
          const v = latestYoyPct(revenueYieldSeries, 4);
          return v === null ? undefined : { label: "Rev yield YoY", pct: v };
        })()}
      >
        <MultiLine
          data={yieldDataWithPeer}
          xKey="quarter"
          valueFormat="bps"
          axisFormat="bps"
          showDots
          dynamicYDomain
          lines={[
            { key: "revenue", name: "Revenue yield", color: "hsl(var(--chart-1))" },
            { key: "op", name: "Operating yield", color: "hsl(var(--chart-2))" },
            { key: "profit", name: "Profit yield", color: "hsl(var(--chart-3))" },
            {
              key: "revenueMedian",
              name: "Peer median revenue",
              color: "hsl(var(--muted-foreground))",
            },
            {
              key: "opMedian",
              name: "Peer median op",
              color: "hsl(var(--muted-foreground))",
            },
            {
              key: "profitMedian",
              name: "Peer median profit",
              color: "hsl(var(--muted-foreground))",
            },
          ]}
        />
      </ChartWithContext>

      <Card
        title="Listed-AMC Peer Comparison"
        subtitleNode={
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">
              This AMC against every other listed AMC for the same quarter — quick spot-check of where it sits in the cohort.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              {`${peerRows.length} listed AMCs · ${formatQuarterLabelLong(selectedPeriod)}${peerRows.some((p) => p.derivedFrom) ? " · derived rows flagged inline" : ""} · Source: Company filings · AMFI Fundwise AAUM`}
            </p>
          </div>
        }
        action={
          <FinancialsPeerExport
            rows={peerRows}
            filename={`financials-peer-${selectedPeriod}.csv`}
          />
        }
      >
        <HowToRead>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Each row is one listed AMC for the same quarter as the selected AMC above.</li>
            <li>Yields (Rev / Op / Profit) are expressed in <span className="text-foreground">bps of MF QAAUM</span>. Higher = AMC monetises AAUM more aggressively than peers.</li>
            <li>Empty cells mean the metric wasn&rsquo;t cleanly disclosed in that AMC&rsquo;s standalone filings for the quarter — not zero.</li>
          </ul>
        </HowToRead>
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
      : "Watch quarterly margin trend + revenue yield drift — small drifts compound into multi-year re-rating.";

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
