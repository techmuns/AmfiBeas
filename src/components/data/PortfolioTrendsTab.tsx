"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  NavPerformanceChart,
  type NavPerformancePoint,
} from "@/components/data/NavPerformanceChart";
import {
  TrendsPeerTable,
  type PeerRankRow,
} from "@/components/data/TrendsPeerTable";
import { fmtBps } from "@/lib/units";
// Phase 3.10A: tiny bundled index of available daily index histories.
// The per-index series itself is fetched at runtime, mirroring how fund
// history is fetched (not bundled).
import indexHistoryManifest from "@/data/snapshots/index-history-manifest.json";

// Phase 3.10A: default benchmark for every scheme. Only NIFTY_500 is wired
// here; the manifest already accepts more indices, so a future second
// benchmark drops in without UI plumbing changes.
const DEFAULT_BENCHMARK_ID = "NIFTY_500";

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y";
// All selectable periods, smallest → largest. Order is also the render
// order of KPI cards and timeframe buttons.
const PERIODS: PeriodKey[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y"];
// 3Y went live in Phase 3.6C; 5Y went live in Phase 3.8C. No periods are
// gated as placeholder buttons any more — kept as an empty array so the
// renderer below stays parameterized for any future addition.
const DISABLED_PERIODS: ReadonlyArray<never> = [];
// Default-on-fresh-load order: never auto-selects 3Y or 5Y. User explicit
// selections persist across fund changes via the fallback logic below.
const DEFAULT_ORDER: ReadonlyArray<PeriodKey> = ["1Y", "6M", "3M", "1M"];
// Fallback order when an explicitly-selected 5Y becomes unavailable on a
// new fund: prefer 3Y first (it's the next-longest CAGR), then descend
// through the regular default order. Other periods (3Y / 1Y / 6M / 3M /
// 1M) just use DEFAULT_ORDER when their selected period becomes
// unavailable — matches the Phase 3.6C behavior.
const FALLBACK_FROM_5Y: ReadonlyArray<PeriodKey> = ["3Y", "1Y", "6M", "3M", "1M"];
// 10Y falls back to the next-longest CAGR first (5Y → 3Y → …).
const FALLBACK_FROM_10Y: ReadonlyArray<PeriodKey> = ["5Y", "3Y", "1Y", "6M", "3M", "1M"];

// ---------------------------------------------------------------------------
// Snapshot types (subsetting the committed JSONs)
// ---------------------------------------------------------------------------

interface LatestFund {
  schemecode: string;
  amfiSchemeCode: number;
  amfiSchemeName: string;
  amfiAmcName: string;
  isin: string | null;
  nav: number;
  navDate: string;
}
interface LatestSnapshot {
  feedDate: string;
  funds: LatestFund[];
}

// Phase 3.6C: 1M/3M/6M/1Y stay "simple"; 3Y is "cagr" with an extra
// `years` field (mirrors mf-returns.json's two shapes).
type ReturnCell =
  | { value: number; kind: "simple"; startDate: string; startNav: number; endDate: string; endNav: number }
  | { value: number; kind: "cagr"; startDate: string; startNav: number; endDate: string; endNav: number; years: number };
interface ReturnsFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  plan: "direct" | "regular" | "unknown";
  option: "growth" | "idcw" | "unknown";
  isEtf: boolean;
  isFof: boolean;
  asOfNav: number;
  asOfNavDate: string;
  firstDate: string;
  lastDate: string;
  points: number;
  returns: Partial<Record<PeriodKey, ReturnCell>>;
  dataAvailability: Record<PeriodKey, boolean>;
}
interface ReturnsSnapshot {
  asOfDate: string;
  funds: ReturnsFund[];
}

interface ManifestFund {
  schemecode: string;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  available: boolean;
}
interface ManifestSnapshot {
  stage: number;
  funds: ManifestFund[];
}

// Alias kept to make import sites read naturally; runtime shape is identical
// to PeerRankRow (declared in TrendsPeerTable.tsx).
type CategoryFundRank = PeerRankRow;
interface CategorySnapshot {
  fundRanks: CategoryFundRank[];
}

interface HistoryFile {
  meta: {
    firstDate: string | null;
    lastDate: string | null;
    points: number;
  };
  series: Array<[string, number]>;
}

// Phase 3.10A: shape of the daily index history file at
// public/index-history/{indexId}.json — same [date, close] tuple series
// as fund history, with index-flavoured meta.
interface IndexHistoryFile {
  meta: {
    indexId: string;
    name: string;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
  };
  series: Array<[string, number]>;
}

interface IndexHistoryManifestEntry {
  indexId: string;
  name: string;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  path: string;
}
interface IndexHistoryManifestShape {
  stage: string;
  generatedAt: string;
  indices: IndexHistoryManifestEntry[];
}

// ---------------------------------------------------------------------------
// Resolved snapshot lookups (Maps built once at module scope — the JSONs are
// build-time imports, so these are computed during the first render and
// then frozen for the lifetime of the page.)
// ---------------------------------------------------------------------------

// Phase 3.10A: pluck the default benchmark from the bundled index manifest
// (tiny, stays bundled). Null when the manifest doesn't list it — the UI
// degrades silently to the pre-benchmark single-line behavior in that case.
const INDEX_MANIFEST = indexHistoryManifest as unknown as IndexHistoryManifestShape;
const DEFAULT_BENCHMARK_ENTRY: IndexHistoryManifestEntry | null =
  INDEX_MANIFEST?.indices?.find((i) => i.indexId === DEFAULT_BENCHMARK_ID) ?? null;

// The four NAV snapshots are large (~9 MB) and would blow the Cloudflare
// Worker's 3 MiB size limit if imported/bundled, so they're served from
// public/nav-data and fetched at runtime, then resolved into the lookup maps
// below.
interface TrendsData {
  latestByCode: Map<string, LatestFund>;
  returnsByCode: Map<string, ReturnsFund>;
  manifestByCode: Map<string, ManifestFund>;
  categoryByCode: Map<string, CategoryFundRank>;
  categoryByCohort: Map<string, CategoryFundRank[]>;
  historyStage: number;
  feedDate: string;
}
function buildTrendsData(
  latest: LatestSnapshot,
  returns: ReturnsSnapshot,
  category: CategorySnapshot,
  manifest: ManifestSnapshot,
): TrendsData {
  const categoryByCohort = new Map<string, CategoryFundRank[]>();
  for (const f of category.fundRanks) {
    const k = cohortKey(f.classification, f.plan, f.option);
    let arr = categoryByCohort.get(k);
    if (!arr) { arr = []; categoryByCohort.set(k, arr); }
    arr.push(f);
  }
  return {
    latestByCode: new Map(latest.funds.map((f) => [f.schemecode, f])),
    returnsByCode: new Map(returns.funds.map((f) => [f.schemecode, f])),
    manifestByCode: new Map(manifest.funds.map((f) => [f.schemecode, f])),
    categoryByCode: new Map(category.fundRanks.map((f) => [f.schemecode, f])),
    categoryByCohort,
    historyStage: manifest.stage,
    feedDate: latest.feedDate,
  };
}

function cohortKey(
  classification: string | null,
  plan: ReturnsFund["plan"],
  option: ReturnsFund["option"],
): string {
  return `${classification ?? "(unclassified)"} | ${plan} | ${option}`;
}

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface PortfolioTrendsTabProps {
  schemecode: string;
  fundName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Public entry: fetches the (large, un-bundled) NAV snapshots from
 *  public/nav-data at runtime, then renders the tab once they're resolved. */
export function PortfolioTrendsTab(props: PortfolioTrendsTabProps) {
  const [data, setData] = useState<TrendsData | null>(null);
  const [errored, setErrored] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const getJson = (url: string) =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    Promise.all([
      getJson("/nav-data/mf-latest-nav.json"),
      getJson("/nav-data/mf-returns.json"),
      getJson("/nav-data/mf-category-returns.json"),
      getJson("/nav-data/mf-history-manifest.json"),
    ])
      .then(([latest, returns, category, manifest]) => {
        if (cancelled) return;
        setData(
          buildTrendsData(
            latest as LatestSnapshot,
            returns as ReturnsSnapshot,
            category as CategorySnapshot,
            manifest as ManifestSnapshot,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (errored) {
    return (
      <section className="space-y-3">
        <Header fundName={props.fundName} subtitleLine={null} freshness={null} />
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
          <span className="text-negative">Couldn&apos;t load performance data.</span>
          <button
            type="button"
            onClick={() => {
              setErrored(false);
              setNonce((n) => n + 1);
            }}
            className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="space-y-3">
        <Header fundName={props.fundName} subtitleLine={null} freshness={null} />
        <div className="flex h-40 items-center justify-center gap-2 rounded-md border bg-card text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading performance data…
        </div>
      </section>
    );
  }
  return <TrendsTabInner {...props} data={data} />;
}

function TrendsTabInner({
  schemecode,
  fundName,
  data,
}: PortfolioTrendsTabProps & { data: TrendsData }) {
  const {
    latestByCode,
    returnsByCode,
    manifestByCode,
    categoryByCode,
    categoryByCohort,
    historyStage,
  } = data;
  // Regular vs Direct plan. Each plan is its own snapshot entry, keyed
  // "{schemecode}" (Regular / primary) and "{schemecode}-D" (Direct). NAV,
  // returns, ranking and the chart all swap with the toggle; the other tabs
  // (holdings) are unaffected — they stay on the RupeeVest schemecode.
  const planKeys = useMemo<Partial<Record<"regular" | "direct", string>>>(() => {
    const keys: Partial<Record<"regular" | "direct", string>> = {};
    const primary = returnsByCode.get(schemecode);
    if (primary) keys[primary.plan === "direct" ? "direct" : "regular"] = schemecode;
    const directKey = `${schemecode}-D`;
    if (returnsByCode.has(directKey)) keys.direct = directKey;
    return keys;
  }, [schemecode, returnsByCode]);
  const availablePlans = useMemo(
    () => (["regular", "direct"] as const).filter((p) => planKeys[p]),
    [planKeys],
  );
  const [plan, setPlan] = useState<"regular" | "direct">(
    () => (planKeys.regular ? "regular" : "direct"),
  );
  // On fund change: keep the chosen plan if the new fund offers it, else fall
  // back to Regular (or whichever single plan the new fund has).
  const [prevSchemecodeForPlan, setPrevSchemecodeForPlan] = useState(schemecode);
  if (prevSchemecodeForPlan !== schemecode) {
    setPrevSchemecodeForPlan(schemecode);
    if (!planKeys[plan]) setPlan(planKeys.regular ? "regular" : "direct");
  }
  const dataKey = planKeys[plan] ?? schemecode;

  const returnRow = returnsByCode.get(dataKey);
  const latestRow = latestByCode.get(dataKey);
  const manifestRow = manifestByCode.get(dataKey);
  const categoryRow = categoryByCode.get(dataKey);

  // Timeframe state. Default to 1Y, falling back to 6M → 3M → 1M based on
  // what's available in the returns snapshot; auto-fallback on fund change.
  const defaultPeriod = useMemo<PeriodKey | null>(
    () => firstAvailablePeriod(returnRow),
    [returnRow],
  );
  const [period, setPeriod] = useState<PeriodKey | null>(defaultPeriod);

  // On fund change: keep the user's current period if the new fund still
  // supports it (so a 5Y or 3Y selection persists when switching between
  // two funds that both have the same period). Otherwise fall back to:
  //   - if previously on 5Y: FALLBACK_FROM_5Y (3Y → 1Y → 6M → 3M → 1M)
  //   - otherwise: DEFAULT_ORDER (1Y → 6M → 3M → 1M)
  // Either way, fresh-load default never auto-selects 3Y or 5Y.
  const [prevDataKey, setPrevDataKey] = useState(dataKey);
  if (prevDataKey !== dataKey) {
    setPrevDataKey(dataKey);
    const stillAvailable = period && returnRow?.dataAvailability[period];
    if (stillAvailable) {
      // Keep the current period across the fund/plan change.
    } else {
      const order =
        period === "10Y"
          ? FALLBACK_FROM_10Y
          : period === "5Y"
            ? FALLBACK_FROM_5Y
            : DEFAULT_ORDER;
      setPeriod(firstAvailableFromOrder(returnRow, order));
    }
  }

  // On-demand history fetch, cached at component scope. Cache by schemecode.
  const [history, setHistory] = useState<Record<string, HistoryFile>>({});
  const [historyErr, setHistoryErr] = useState<Record<string, true>>({});
  const [reloadNonce, setReloadNonce] = useState(0);
  // Phase 3.10A: same on-demand pattern for the benchmark — fetched once
  // (or per fund change is wasted; we key purely on the bundled manifest's
  // presence). null until loaded, "errored" sentinel when the fetch failed
  // so we don't retry every render. The chart degrades silently if the
  // benchmark is missing — fund line still renders.
  const [benchmark, setBenchmark] = useState<IndexHistoryFile | null | "errored">(null);

  const historyAvailable = Boolean(manifestRow?.available);
  const historyLoaded = history[dataKey];
  const historyErrored = historyErr[dataKey];
  const historyLoading =
    historyAvailable && !historyLoaded && !historyErrored;

  useEffect(() => {
    if (!historyAvailable) return;
    if (history[dataKey] || historyErr[dataKey]) return;
    const ctrl = new AbortController();
    fetch(`/nav-history/${dataKey}.json`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HistoryFile>;
      })
      .then((data) => setHistory((prev) => ({ ...prev, [dataKey]: data })))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setHistoryErr((prev) => ({ ...prev, [dataKey]: true }));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, historyAvailable, reloadNonce]);

  // Benchmark fetcher — runs once on mount when the manifest lists a path.
  // Idempotent (state guard prevents refetch).
  useEffect(() => {
    if (!DEFAULT_BENCHMARK_ENTRY) return;
    if (benchmark !== null) return;
    const ctrl = new AbortController();
    fetch(DEFAULT_BENCHMARK_ENTRY.path, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<IndexHistoryFile>;
      })
      .then((data) => setBenchmark(data))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setBenchmark("errored");
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const benchmarkLoaded: IndexHistoryFile | null =
    benchmark && benchmark !== "errored" ? benchmark : null;

  function retryHistory() {
    setHistoryErr((prev) => {
      const next = { ...prev };
      delete next[dataKey];
      return next;
    });
    setReloadNonce((n) => n + 1);
  }

  // Cohort + peer rows (always from the precomputed snapshot).
  const cohortLabel = useMemo(() => {
    if (!returnRow) return "—";
    return buildCohortLabel(
      returnRow.classification,
      returnRow.plan,
      returnRow.option,
      returnRow.isEtf,
      returnRow.isFof,
    );
  }, [returnRow]);
  const peers: PeerRankRow[] = useMemo(() => {
    if (!returnRow) return [];
    return categoryByCohort.get(
      cohortKey(returnRow.classification, returnRow.plan, returnRow.option),
    ) ?? [];
  }, [returnRow, categoryByCohort]);

  // Chart points for the selected timeframe — fund series rebased to 100,
  // optionally merged with the benchmark rebased to 100 at the same start
  // anchor (nearest-prior on the benchmark series; never extrapolated).
  const chartPoints = useMemo<NavPerformancePoint[]>(() => {
    if (!historyLoaded || !period) return [];
    const r = returnRow?.returns[period];
    if (!r) return [];
    const fundPoints = rebaseSeries(historyLoaded.series, r.startDate);
    if (!benchmarkLoaded || fundPoints.length === 0) return fundPoints;
    const benchPoints = rebaseSeriesNearestPrior(benchmarkLoaded.series, r.startDate);
    if (benchPoints.length === 0) return fundPoints;
    // Merge by date: each fund point picks up its same-date benchmark value
    // when one exists. Benchmark may end before the fund (CSV data lag);
    // those tail dates get no `benchmarkRebased` and the dashed line ends.
    const benchByDate = new Map<string, number>();
    for (const b of benchPoints) benchByDate.set(b.date, b.rebased);
    return fundPoints.map((p) =>
      benchByDate.has(p.date) ? { ...p, benchmarkRebased: benchByDate.get(p.date) } : p,
    );
  }, [historyLoaded, period, returnRow, benchmarkLoaded]);

  // Benchmark anchor (for the chart's tooltip header) — nearest-prior on
  // the index series at the fund's start anchor. Null when unavailable.
  const benchmarkAnchor = useMemo<{ date: string; level: number } | null>(() => {
    if (!benchmarkLoaded || !period || !returnRow) return null;
    const r = returnRow.returns[period];
    if (!r) return null;
    const a = nearestPriorIndex(benchmarkLoaded.series, r.startDate);
    return a;
  }, [benchmarkLoaded, period, returnRow]);

  // Per-period benchmark returns for the KPI delta sub-line. Uses the same
  // formula as the fund return: simple for 1M/3M/6M/1Y, CAGR for 3Y/5Y
  // (same `years` value as the fund row, so deltas are like-with-like).
  // Returns null per period when:
  //   • benchmark not loaded, OR
  //   • benchmark doesn't have a point on/before the fund's startDate, OR
  //   • benchmark doesn't have a point on/before the fund's endDate (its
  //     series ends before the fund's end — we never extrapolate).
  const benchmarkReturnsByPeriod = useMemo<Partial<Record<PeriodKey, number>>>(() => {
    const out: Partial<Record<PeriodKey, number>> = {};
    if (!benchmarkLoaded || !returnRow) return out;
    for (const p of PERIODS) {
      const r = returnRow.returns[p];
      if (!r) continue;
      const start = nearestPriorIndex(benchmarkLoaded.series, r.startDate);
      const end = nearestPriorIndex(benchmarkLoaded.series, r.endDate);
      if (!start || !end) continue;
      if (start.level <= 0 || end.level <= 0) continue;
      if (r.kind === "cagr") {
        const years = (r as { years: number }).years;
        if (!Number.isFinite(years) || years <= 0) continue;
        const ratio = end.level / start.level;
        if (!(ratio > 0)) continue;
        out[p] = (Math.pow(ratio, 1 / years) - 1) * 100;
      } else {
        out[p] = (end.level / start.level - 1) * 100;
      }
    }
    return out;
  }, [benchmarkLoaded, returnRow]);

  // ---- Render --------------------------------------------------------------

  if (!returnRow) {
    // Fund is in the picker but absent from the returns snapshot (rare —
    // a fund that was excluded from the crosswalk universe).
    return (
      <section className="space-y-3">
        <Header
          fundName={fundName}
          subtitleLine={null}
          freshness={null}
        />
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Performance data is not yet available for this fund.
        </div>
      </section>
    );
  }

  const subtitleLine = cohortLabel;
  const freshnessLine = buildFreshnessLine(
    data.feedDate,
    historyStage,
    manifestRow,
    historyAvailable,
    benchmarkLoaded,
  );

  return (
    <section className="space-y-4">
      <Header
        fundName={fundName}
        subtitleLine={subtitleLine}
        freshness={freshnessLine}
      />

      <PlanToggle
        plan={returnRow.plan}
        planKeys={planKeys}
        selected={plan}
        onPick={setPlan}
        showToggle={availablePlans.length > 1}
      />

      <KpiRow
        returnRow={returnRow}
        categoryRow={categoryRow}
        latestRow={latestRow}
        benchmarkReturnsByPeriod={benchmarkReturnsByPeriod}
        benchmarkLabel={DEFAULT_BENCHMARK_ENTRY?.name ?? null}
      />

      <TimeframeSelector
        period={period}
        availability={returnRow.dataAvailability}
        onPick={setPeriod}
      />

      {period ? (
        <ChartSlot
          period={period}
          returnRow={returnRow}
          historyAvailable={historyAvailable}
          historyLoading={historyLoading}
          historyErrored={!!historyErrored}
          points={chartPoints}
          onRetry={retryHistory}
          benchmark={
            benchmarkLoaded && benchmarkAnchor
              ? {
                  label: benchmarkLoaded.meta.name,
                  anchorDate: benchmarkAnchor.date,
                  anchorLevel: benchmarkAnchor.level,
                }
              : null
          }
        />
      ) : (
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No timeframe is available for this fund yet — Stage-1 history covers
          ~15 months; longer periods come after future backfill.
        </div>
      )}

      {period && (
        <CategoryStrip
          period={period}
          fundEntry={categoryRow?.periodRanks[period] ?? null}
        />
      )}

      <TrendsPeerTable
        rows={peers}
        selectedSchemecode={dataKey}
        period={period ?? "1Y"}
        cohortLabel={cohortLabel}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header + freshness banner
// ---------------------------------------------------------------------------

function Header({
  fundName,
  subtitleLine,
  freshness,
}: {
  fundName: string;
  subtitleLine: string | null;
  freshness: string | null;
}) {
  return (
    <div className="space-y-1">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          Returns &amp; Ranking — <span className="text-foreground">{fundName}</span>
        </h2>
        {subtitleLine && (
          <p className="text-xs text-muted-foreground">{subtitleLine}</p>
        )}
      </div>
      {freshness && (
        <div className="rounded-md border bg-card px-3 py-2 text-[11px] text-muted-foreground">
          {freshness}
        </div>
      )}
    </div>
  );
}

function buildCohortLabel(
  classification: string | null,
  plan: ReturnsFund["plan"],
  option: ReturnsFund["option"],
  isEtf: boolean,
  isFof: boolean,
): string {
  const parts: string[] = [];
  if (classification) parts.push(classification);
  if (isEtf) parts.push("ETF");
  else if (isFof) parts.push("Fund of Funds");
  else {
    if (plan === "direct") parts.push("Direct");
    else if (plan === "regular") parts.push("Regular");
    if (option === "growth") parts.push("Growth");
    else if (option === "idcw") parts.push("IDCW");
  }
  return parts.join(" · ");
}

function buildFreshnessLine(
  feedDate: string,
  historyStage: number,
  manifestRow: ManifestFund | undefined,
  historyAvailable: boolean,
  benchmarkLoaded: IndexHistoryFile | null,
): string {
  const parts: string[] = [`NAV as of ${formatDMY(feedDate)}`];
  if (historyAvailable && manifestRow?.firstDate && manifestRow.lastDate) {
    parts.push(
      `History ${formatIsoDate(manifestRow.firstDate)} → ${formatIsoDate(manifestRow.lastDate)} (Stage-${historyStage}, ${manifestRow.points} pts)`,
    );
  } else {
    parts.push(`History: pending Stage-${historyStage} backfill for this fund`);
  }
  // Phase 3.10A: benchmark coverage. Only added when the benchmark loaded
  // and reports a lastDate — silently dropped otherwise so the banner
  // doesn't get noisy.
  if (benchmarkLoaded?.meta.lastDate) {
    parts.push(`${benchmarkLoaded.meta.name} through ${formatIsoDate(benchmarkLoaded.meta.lastDate)}`);
  }
  parts.push(
    benchmarkLoaded
      ? "Source: AMFI historical + AMFI latest NAV + NSE historical CSV"
      : "Source: AMFI historical + AMFI latest NAV",
  );
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// KPI row (Latest NAV + 4 returns)
// ---------------------------------------------------------------------------

function KpiRow({
  returnRow,
  categoryRow,
  latestRow,
  benchmarkReturnsByPeriod,
  benchmarkLabel,
}: {
  returnRow: ReturnsFund;
  categoryRow: CategoryFundRank | undefined;
  latestRow: LatestFund | undefined;
  benchmarkReturnsByPeriod: Partial<Record<PeriodKey, number>>;
  benchmarkLabel: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
      <NavKpiCard returnRow={returnRow} latestRow={latestRow} />
      {PERIODS.map((p) => (
        <ReturnKpiCard
          key={p}
          period={p}
          returnRow={returnRow}
          fundRank={categoryRow}
          benchmarkReturn={benchmarkReturnsByPeriod[p]}
          benchmarkLabel={benchmarkLabel}
        />
      ))}
    </div>
  );
}

function NavKpiCard({
  returnRow,
  latestRow,
}: {
  returnRow: ReturnsFund;
  latestRow: LatestFund | undefined;
}) {
  const nav = latestRow?.nav ?? returnRow.asOfNav;
  const navDate = latestRow?.navDate ?? returnRow.asOfNavDate;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Latest NAV
      </div>
      <div className="mt-1 text-xl font-semibold tabular tracking-tight">
        ₹{nav.toFixed(2)}
      </div>
      <div className="mt-0.5 text-[10px] tabular text-muted-foreground/80">
        as of {formatDMY(navDate)}
      </div>
    </div>
  );
}

function ReturnKpiCard({
  period,
  returnRow,
  fundRank,
  benchmarkReturn,
  benchmarkLabel,
}: {
  period: PeriodKey;
  returnRow: ReturnsFund;
  fundRank: CategoryFundRank | undefined;
  benchmarkReturn: number | undefined;
  benchmarkLabel: string | null;
}) {
  const r = returnRow.returns[period];
  const e = fundRank?.periodRanks[period];
  const stats = e?.statsAvailable
    ? (e as Extract<NonNullable<typeof e>, { statsAvailable: true }>)
    : null;
  const value = r ? r.value : null;
  const tone =
    value === null
      ? "text-muted-foreground"
      : value > 0
        ? "text-positive"
        : value < 0
          ? "text-negative"
          : "";
  const isCagr = period === "3Y" || period === "5Y" || period === "10Y";
  // Phase 3.10A: excess in percentage points = fund return − benchmark return.
  // Computed on the same start/end anchors (with CAGR sharing the fund row's
  // `years`), so subtraction is apples-to-apples. Null when the fund has no
  // return OR the benchmark series didn't cover the period (we never
  // extrapolate); the sub-line shows "—" in that case.
  const excessPp =
    value !== null && typeof benchmarkReturn === "number" && Number.isFinite(benchmarkReturn)
      ? value - benchmarkReturn
      : null;
  const benchSubLine = benchmarkLabel ? (
    <div className="mt-0.5 text-[10px] tabular text-muted-foreground/80">
      vs {benchmarkLabel}:{" "}
      {excessPp === null ? (
        "—"
      ) : (
        <span
          className={
            excessPp > 0
              ? "text-positive"
              : excessPp < 0
                ? "text-negative"
                : ""
          }
        >
          {fmtBps(excessPp)}
        </span>
      )}
    </div>
  ) : null;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {period} return{isCagr ? " (CAGR)" : ""}
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular tracking-tight",
          tone,
        )}
      >
        {value === null
          ? "—"
          : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}
      </div>
      {stats ? (
        <div className="mt-0.5 text-[10px] tabular text-muted-foreground/80">
          Rank {stats.rank}/{stats.peerCount} · {stats.quartile}
        </div>
      ) : e && !e.statsAvailable ? (
        <div className="mt-0.5 text-[10px] tabular text-muted-foreground/80">
          {value === null
            ? isCagr
              ? `no ${period} history`
              : "no return"
            : (e as { peerCount: number }).peerCount < 5
              ? `n=${(e as { peerCount: number }).peerCount} < 5`
              : "no peer stats"}
        </div>
      ) : (
        <div className="mt-0.5 text-[10px] tabular text-muted-foreground/80">
          —
        </div>
      )}
      {benchSubLine}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan toggle (Regular / Direct)
// ---------------------------------------------------------------------------

function PlanToggle({
  plan,
  planKeys,
  selected,
  onPick,
  showToggle,
}: {
  plan: "direct" | "regular" | "unknown";
  planKeys: Partial<Record<"regular" | "direct", string>>;
  selected: "regular" | "direct";
  onPick: (p: "regular" | "direct") => void;
  showToggle: boolean;
}) {
  if (!showToggle) {
    // Single-plan fund — just label which plan the NAV / returns reflect.
    const label =
      plan === "direct" ? "Direct plan" : plan === "regular" ? "Regular plan" : null;
    if (!label) return null;
    return (
      <div className="text-xs text-muted-foreground">
        NAV &amp; returns:{" "}
        <span className="font-medium text-foreground">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Plan</span>
      <div
        className="inline-flex rounded-md border bg-card p-0.5 text-xs"
        role="group"
        aria-label="NAV plan"
      >
        {(["regular", "direct"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            disabled={!planKeys[p]}
            aria-pressed={selected === p}
            className={cn(
              "rounded px-3 py-1 font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              selected === p
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeframe selector
// ---------------------------------------------------------------------------

function TimeframeSelector({
  period,
  availability,
  onPick,
}: {
  period: PeriodKey | null;
  availability: Record<PeriodKey, boolean>;
  onPick: (p: PeriodKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Timeframe:</span>
      {PERIODS.map((p) => {
        const avail = availability[p];
        const active = period === p;
        const isCagr = p === "3Y" || p === "5Y" || p === "10Y";
        const unavailableTitle = `Not enough ${p} history for this fund.`;
        return (
          <button
            key={p}
            type="button"
            disabled={!avail}
            onClick={() => avail && onPick(p)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs tabular",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-accent",
              !avail && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
            aria-pressed={active}
            aria-disabled={!avail}
            title={avail ? (isCagr ? `${p} (CAGR)` : undefined) : unavailableTitle}
          >
            {p}
          </button>
        );
      })}
      {DISABLED_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-dashed border-border px-2.5 py-1 text-xs tabular text-muted-foreground/80"
          aria-disabled
          title="Coming after future backfill"
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart slot (loading / error / empty / OK)
// ---------------------------------------------------------------------------

function ChartSlot({
  period,
  returnRow,
  historyAvailable,
  historyLoading,
  historyErrored,
  points,
  onRetry,
  benchmark,
}: {
  period: PeriodKey;
  returnRow: ReturnsFund;
  historyAvailable: boolean;
  historyLoading: boolean;
  historyErrored: boolean;
  points: NavPerformancePoint[];
  onRetry: () => void;
  benchmark: { label: string; anchorDate: string; anchorLevel: number } | null;
}) {
  const r = returnRow.returns[period];
  if (!historyAvailable) {
    return (
      <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Stage-1 history is not yet available for this fund.
      </div>
    );
  }
  if (historyLoading) {
    return (
      <div className="flex h-72 items-center justify-center gap-2 rounded-md border bg-card text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading NAV history…
      </div>
    );
  }
  if (historyErrored) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
        <span className="text-negative">
          Couldn&apos;t load NAV history for this fund.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!r || points.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No {period} history available for this fund.
      </div>
    );
  }
  const isCagr = r.kind === "cagr";
  return (
    <div className="rounded-lg border bg-card px-3 py-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <p className="text-xs text-muted-foreground">
          NAV rebased to 100 from {formatIsoDate(r.startDate)} · ₹
          {r.startNav.toFixed(4)} → ₹{r.endNav.toFixed(4)}
        </p>
        <p
          className={cn(
            "text-xs tabular",
            r.value > 0
              ? "text-positive"
              : r.value < 0
                ? "text-negative"
                : "text-muted-foreground",
          )}
        >
          {r.value > 0 ? "+" : ""}
          {r.value.toFixed(1)}% over {period}
          {isCagr ? " (CAGR)" : ""}
        </p>
      </div>
      <NavPerformanceChart
        data={points}
        anchorDate={r.startDate}
        anchorNav={r.startNav}
        benchmark={benchmark ?? undefined}
      />
      {benchmark && (
        <div className="mt-1 px-1 text-[10px] tabular text-muted-foreground/80">
          {benchmark.label} anchor {formatIsoDate(benchmark.anchorDate)} · {benchmark.anchorLevel.toFixed(2)} = 100
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category comparison strip
// ---------------------------------------------------------------------------

function CategoryStrip({
  period,
  fundEntry,
}: {
  period: PeriodKey;
  fundEntry: CategoryFundRank["periodRanks"][PeriodKey] | null;
}) {
  if (!fundEntry) {
    return (
      <div className="rounded-md border border-dashed bg-card px-4 py-3 text-xs text-muted-foreground">
        Category comparison unavailable for {period}.
      </div>
    );
  }
  if (!fundEntry.statsAvailable) {
    const peerCount = (fundEntry as { peerCount: number }).peerCount;
    const reason = (fundEntry as { reason: string }).reason;
    return (
      <div className="rounded-md border bg-card px-4 py-3 text-xs text-muted-foreground">
        Category comparison ({period}): {reason} ({peerCount} peers · need 5).
      </div>
    );
  }
  const stats = fundEntry as Extract<
    NonNullable<typeof fundEntry>,
    { statsAvailable: true }
  >;
  const periodLabel = period === "3Y" || period === "5Y" || period === "10Y" ? `${period} CAGR` : period;
  return (
    <div className="rounded-lg border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular">
        <Stat label={`${periodLabel} fund`} value={`${signed(stats.return)}%`} tone={toneOf(stats.return)} />
        <Stat label="Avg" value={`${signed(stats.categoryAverage)}%`} />
        <Stat label="Median" value={`${signed(stats.categoryMedian)}%`} />
        <Stat
          label="vs avg"
          value={fmtBps(stats.excessVsAverage)}
          tone={toneOf(stats.excessVsAverage)}
        />
        <Stat
          label="vs median"
          value={fmtBps(stats.excessVsMedian)}
          tone={toneOf(stats.excessVsMedian)}
        />
        <Stat
          label="Rank"
          value={`${stats.rank} of ${stats.peerCount}`}
        />
        <Stat label="Quartile" value={stats.quartile} />
        <Stat label="Percentile" value={stats.percentile.toFixed(0)} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "muted";
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-medium",
          tone === "pos" && "text-positive",
          tone === "neg" && "text-negative",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}
function toneOf(n: number): "pos" | "neg" | "muted" {
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "muted";
}

// ---------------------------------------------------------------------------
// Series helpers
// ---------------------------------------------------------------------------

function firstAvailablePeriod(
  returnRow: ReturnsFund | undefined,
): PeriodKey | null {
  // Default-on-fresh-load: walks DEFAULT_ORDER (1Y → 6M → 3M → 1M). Never
  // auto-selects 3Y or 5Y on a fresh page load.
  return firstAvailableFromOrder(returnRow, DEFAULT_ORDER);
}

function firstAvailableFromOrder(
  returnRow: ReturnsFund | undefined,
  order: ReadonlyArray<PeriodKey>,
): PeriodKey | null {
  if (!returnRow) return null;
  for (const k of order) if (returnRow.dataAvailability[k]) return k;
  return null;
}

/** Take the part of the series with date >= startDate and rebase to 100 at
 *  the first point. Series is ascending ISO. */
function rebaseSeries(
  series: Array<[string, number]>,
  startDate: string,
): NavPerformancePoint[] {
  // Find the first index at or after startDate; if startDate predates the
  // series (shouldn't happen since startDate came from the same history),
  // use index 0.
  let from = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i][0] >= startDate) { from = i; break; }
    if (i === series.length - 1) from = series.length - 1;
  }
  const anchor = series[from];
  if (!anchor || anchor[1] <= 0) return [];
  const out: NavPerformancePoint[] = [];
  for (let i = from; i < series.length; i++) {
    const [date, nav] = series[i];
    if (typeof nav !== "number" || !Number.isFinite(nav) || nav <= 0) continue;
    out.push({ date, nav, rebased: (nav / anchor[1]) * 100 });
  }
  return out;
}

/** Phase 3.10A: nearest-prior lookup on an ascending [date, value] series.
 *  Returns the LAST point with date <= target, or null when target predates
 *  the whole series. Used to align the benchmark to the fund's start anchor
 *  even when NSE didn't trade on the exact same calendar day as AMFI. */
function nearestPriorIndex(
  series: Array<[string, number]>,
  target: string,
): { date: string; level: number } | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= target) return { date: series[i][0], level: series[i][1] };
  }
  return null;
}

/** Rebase the benchmark to 100 at nearest-prior(target). Mirrors
 *  rebaseSeries but uses the value at the nearest-prior anchor (not the
 *  first on-or-after) so the benchmark line starts at exactly 100 next to
 *  the fund line on the same chart. Points before the anchor are dropped.
 *  Returns an empty array when no point on/before target exists. */
function rebaseSeriesNearestPrior(
  series: Array<[string, number]>,
  startDate: string,
): NavPerformancePoint[] {
  const anchor = nearestPriorIndex(series, startDate);
  if (!anchor || anchor.level <= 0) return [];
  const out: NavPerformancePoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const [date, level] = series[i];
    if (date < anchor.date) continue;
    if (typeof level !== "number" || !Number.isFinite(level) || level <= 0) continue;
    out.push({ date, nav: level, rebased: (level / anchor.level) * 100 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Date formatters
// ---------------------------------------------------------------------------

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "29-May-2026" (AMFI's DD-MMM-YYYY) → "29 May 2026". Falls back to the
 *  input if it doesn't parse. */
function formatDMY(s: string): string {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return s;
  return `${m[1]} ${m[2]} ${m[3]}`;
}
function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d} ${MONTH_ABBR[Number(m) - 1] ?? m} ${y}`;
}
