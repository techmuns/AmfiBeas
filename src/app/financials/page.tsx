import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import { CycleRibbon } from "@/components/ui/CycleRibbon";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MarketWrapCard } from "@/components/ui/MarketWrapCard";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { chartInsights, latestYoyPct } from "@/lib/chart-context";
import { financialsMarketWrap } from "@/data/market-wrap-financials";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import type { AmcStatus } from "@/components/filters/FilterBar";
import { QuarterPicker } from "@/components/filters/QuarterPicker";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import { LensToggle } from "@/components/ui/LensToggle";
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

  // Chart-type toggle for the Operating Revenue / Operating Profit / PAT
  // card. Bars (default) is never echoed into the URL; only "trend"
  // rides along so the default page stays URL-clean.
  const pnlView: "bars" | "trend" =
    sp.pnlView === "trend" ? "trend" : "bars";

  // Pass-through params for every LensToggle on this page. Keeps the
  // selected AMC, date-range, and quarter intact when the user clicks
  // Bars / Trend — otherwise the page would reset to the default AMC.
  const preservedQueryParams: Record<string, string | undefined> = {
    amcs: typeof sp.amcs === "string" ? sp.amcs : undefined,
    range: typeof sp.range === "string" ? sp.range : undefined,
    period: typeof sp.period === "string" ? sp.period : undefined,
    ...(sp.pnlView === "trend" ? { pnlView: "trend" } : {}),
  };

  // Series spec shared by the bars and trend views of the P&L card.
  // `BarSpec` and `LineSpec` are both `{ key, name, color }`, so the
  // same array works as `bars=` on GroupedBars and `lines=` on MultiLine.
  const pnlSeries = [
    { key: "revenue", name: "Operating Revenue", color: "hsl(var(--chart-1))" },
    { key: "op", name: "Operating Profit", color: "hsl(var(--chart-2))" },
    { key: "pat", name: "PAT", color: "hsl(var(--chart-3))" },
  ];

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

  // Yields chart subtitle — methodology only (formula). Source-attribution
  // captions retired in PR #98; the formula stays so the user knows what's
  // being charted.
  const yieldsSubtitle =
    "bps of MF QAAUM · annualised P&L (quarterly × 4) ÷ same-quarter MF QAAUM";

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
  const marginDataWithPeer = marginData.map((p) => {
    const peer = peerMarginByQuarter.get(p.quarter);
    return {
      ...p,
      patMedian:
        peer?.patMargin !== undefined && peer.patMargin !== null
          ? Number(peer.patMargin.toFixed(2))
          : null,
      opMedian:
        peer?.opMargin !== undefined && peer.opMargin !== null
          ? Number(peer.opMargin.toFixed(2))
          : null,
    };
  });
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
  const revenueSeries = pnlData
    .filter((p): p is typeof p & { revenue: number } => typeof p.revenue === "number")
    .map((p) => ({ label: p.quarter, value: p.revenue }));
  const pnlInsights = chartInsights(revenueSeries, {
    metricName: "operating revenue",
    unitSuffix: "₹ Cr",
    yoyLag: 4,
  });
  // P&L denominator: latest PAT margin (PAT ÷ Revenue) — the single
  // headline operating-quality number.
  const pnlDenomCaption = (() => {
    for (let i = pnlData.length - 1; i >= 0; i--) {
      const p = pnlData[i];
      if (
        typeof p.revenue === "number" &&
        typeof p.pat === "number" &&
        p.revenue > 0
      ) {
        const m = (p.pat / p.revenue) * 100;
        return `PAT margin ${m.toFixed(1)}% · ${p.quarter}`;
      }
    }
    return undefined;
  })();

  const patMarginSeries = marginData
    .filter((p): p is typeof p & { patMargin: number } => typeof p.patMargin === "number")
    .map((p) => ({ label: p.quarter, value: p.patMargin }));
  const marginInsights = chartInsights(patMarginSeries, {
    metricName: "PAT margin",
    unitSuffix: "%",
    yoyLag: 4,
  });
  // Margin denominator: latest gap vs peer median PAT margin — answers
  // "is this AMC running above or below the listed-peer cohort?".
  const marginDenomCaption = (() => {
    for (let i = marginDataWithPeer.length - 1; i >= 0; i--) {
      const p = marginDataWithPeer[i];
      if (typeof p.patMargin === "number" && typeof p.patMedian === "number") {
        const gap = p.patMargin - p.patMedian;
        return `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)} pp vs peer median PAT margin · ${p.quarter}`;
      }
    }
    return undefined;
  })();

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

      <SectionDivider
        eyebrow="Section 2"
        label="Trends"
        context="P&L, margins, and yields over the available quarterly history with peer-median overlays."
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartWithContext
          title="Operating Revenue / Operating Profit / PAT"
          subtitle="Quarterly · ₹ Cr · Operating Revenue from standalone P&L (all operating segments, excludes Other Income)"
          flowKind="gross"
          denominatorCaption={pnlDenomCaption}
          denominatorTooltip="Latest quarter's PAT margin (PAT ÷ Operating Revenue) — the single headline operating-quality number for the AMC."
          insights={pnlInsights}
          yoyBadge={(() => {
            const v = latestYoyPct(revenueSeries, 4);
            return v === null ? undefined : { label: "Revenue YoY", pct: v };
          })()}
          action={
            <LensToggle
              basePath="/financials"
              paramName="pnlView"
              defaultValue="bars"
              lenses={[
                { value: "bars", label: "Bars" },
                { value: "trend", label: "Trend" },
              ]}
              active={pnlView}
              preserveParams={preservedQueryParams}
            />
          }
        >
          {pnlView === "trend" ? (
            <MultiLine
              data={pnlData}
              xKey="quarter"
              valueFormat="cr"
              axisFormat="cr"
              lines={pnlSeries}
            />
          ) : (
            <GroupedBars
              data={pnlData}
              xKey="quarter"
              bars={pnlSeries}
            />
          )}
        </ChartWithContext>
        <ChartWithContext
          title="Margin Trend"
          subtitle="PAT & Operating margin · % of Operating Revenue · peer-median overlay"
          flowKind="stock"
          denominatorCaption={marginDenomCaption}
          denominatorTooltip="Latest PAT margin minus the listed-peer median PAT margin for the same quarter, in percentage points. Positive = AMC running above the cohort."
          insights={marginInsights}
          yoyBadge={(() => {
            const v = latestYoyPct(patMarginSeries, 4);
            return v === null ? undefined : { label: "PAT margin YoY", pct: v };
          })()}
        >
          <MultiLine
            data={marginDataWithPeer}
            xKey="quarter"
            valueFormat="pct"
            axisFormat="pct"
            showDots
            dynamicYDomain
            lines={[
              { key: "patMargin", name: "PAT margin", color: "hsl(var(--chart-3))" },
              { key: "opMargin", name: "Operating margin", color: "hsl(var(--chart-2))" },
              {
                key: "patMedian",
                name: "Peer median PAT",
                color: "hsl(var(--muted-foreground))",
              },
              {
                key: "opMedian",
                name: "Peer median Op",
                color: "hsl(var(--muted-foreground))",
              },
            ]}
          />
        </ChartWithContext>
        <ChartWithContext
          title="Yields (bps of MF QAAUM)"
          subtitle={`${yieldsSubtitle} · peer-median overlay`}
          flowKind="stock"
          denominatorCaption={yieldDenomCaption}
          denominatorTooltip="Latest revenue yield minus the listed-peer median revenue yield for the same quarter, in basis points. Positive = AMC monetises AAUM harder than the cohort."
          insights={yieldInsights}
          yoyBadge={(() => {
            const v = latestYoyPct(revenueYieldSeries, 4);
            return v === null ? undefined : { label: "Rev yield YoY", pct: v };
          })()}
          className="lg:col-span-2"
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
