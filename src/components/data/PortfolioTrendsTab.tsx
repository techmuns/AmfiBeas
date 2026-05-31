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
import mfLatestNav from "@/data/snapshots/mf-latest-nav.json";
import mfReturns from "@/data/snapshots/mf-returns.json";
import mfCategoryReturns from "@/data/snapshots/mf-category-returns.json";
import mfHistoryManifest from "@/data/snapshots/mf-history-manifest.json";

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y";
// All selectable periods, smallest → largest. Order is also the render
// order of KPI cards and timeframe buttons.
const PERIODS: PeriodKey[] = ["1M", "3M", "6M", "1Y", "3Y"];
// Periods that exist as placeholder buttons but aren't selectable yet.
// 3Y went live in Phase 3.6C; 5Y stays gated until the next backfill.
const DISABLED_PERIODS: ReadonlyArray<"5Y"> = ["5Y"];

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

// ---------------------------------------------------------------------------
// Resolved snapshot lookups (Maps built once at module scope — the JSONs are
// build-time imports, so these are computed during the first render and
// then frozen for the lifetime of the page.)
// ---------------------------------------------------------------------------

const latestByCode = new Map(
  (mfLatestNav as unknown as LatestSnapshot).funds.map((f) => [f.schemecode, f]),
);
const returnsByCode = new Map(
  (mfReturns as unknown as ReturnsSnapshot).funds.map((f) => [f.schemecode, f]),
);
const manifestByCode = new Map(
  (mfHistoryManifest as unknown as ManifestSnapshot).funds.map((f) => [f.schemecode, f]),
);
const HISTORY_STAGE = (mfHistoryManifest as unknown as ManifestSnapshot).stage;
const categoryByCode = new Map(
  (mfCategoryReturns as unknown as CategorySnapshot).fundRanks.map((f) => [f.schemecode, f]),
);
// Cohort key → all PeerRankRows in that cohort.
const categoryByCohort = (() => {
  const m = new Map<string, CategoryFundRank[]>();
  for (const f of (mfCategoryReturns as unknown as CategorySnapshot).fundRanks) {
    const k = cohortKey(f.classification, f.plan, f.option);
    let arr = m.get(k);
    if (!arr) { arr = []; m.set(k, arr); }
    arr.push(f);
  }
  return m;
})();

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

export function PortfolioTrendsTab({ schemecode, fundName }: PortfolioTrendsTabProps) {
  const returnRow = returnsByCode.get(schemecode);
  const latestRow = latestByCode.get(schemecode);
  const manifestRow = manifestByCode.get(schemecode);
  const categoryRow = categoryByCode.get(schemecode);

  // Timeframe state. Default to 1Y, falling back to 6M → 3M → 1M based on
  // what's available in the returns snapshot; auto-fallback on fund change.
  const defaultPeriod = useMemo<PeriodKey | null>(
    () => firstAvailablePeriod(returnRow),
    [returnRow],
  );
  const [period, setPeriod] = useState<PeriodKey | null>(defaultPeriod);

  // On fund change: keep the user's current period if the new fund still
  // supports it (so a 3Y selection persists when switching between two funds
  // that both have 3Y); otherwise fall back to defaultPeriod (best of
  // 1Y → 6M → 3M → 1M; never auto-selects 3Y).
  const [prevSchemecode, setPrevSchemecode] = useState(schemecode);
  if (prevSchemecode !== schemecode) {
    setPrevSchemecode(schemecode);
    const stillAvailable = period && returnRow?.dataAvailability[period];
    setPeriod(stillAvailable ? period : defaultPeriod);
  }

  // On-demand history fetch, cached at component scope. Cache by schemecode.
  const [history, setHistory] = useState<Record<string, HistoryFile>>({});
  const [historyErr, setHistoryErr] = useState<Record<string, true>>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  const historyAvailable = Boolean(manifestRow?.available);
  const historyLoaded = history[schemecode];
  const historyErrored = historyErr[schemecode];
  const historyLoading =
    historyAvailable && !historyLoaded && !historyErrored;

  useEffect(() => {
    if (!historyAvailable) return;
    if (history[schemecode] || historyErr[schemecode]) return;
    const ctrl = new AbortController();
    fetch(`/nav-history/${schemecode}.json`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HistoryFile>;
      })
      .then((data) => setHistory((prev) => ({ ...prev, [schemecode]: data })))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setHistoryErr((prev) => ({ ...prev, [schemecode]: true }));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemecode, historyAvailable, reloadNonce]);

  function retryHistory() {
    setHistoryErr((prev) => {
      const next = { ...prev };
      delete next[schemecode];
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
  }, [returnRow]);

  // Chart points for the selected timeframe.
  const chartPoints = useMemo<NavPerformancePoint[]>(() => {
    if (!historyLoaded || !period) return [];
    const r = returnRow?.returns[period];
    if (!r) return [];
    return rebaseSeries(historyLoaded.series, r.startDate);
  }, [historyLoaded, period, returnRow]);

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
    (mfLatestNav as unknown as LatestSnapshot).feedDate,
    manifestRow,
    historyAvailable,
  );

  return (
    <section className="space-y-4">
      <Header
        fundName={fundName}
        subtitleLine={subtitleLine}
        freshness={freshnessLine}
      />

      <KpiRow returnRow={returnRow} categoryRow={categoryRow} latestRow={latestRow} />

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
        selectedSchemecode={schemecode}
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
          Trends — <span className="text-foreground">{fundName}</span>
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
  manifestRow: ManifestFund | undefined,
  historyAvailable: boolean,
): string {
  const parts: string[] = [`NAV as of ${formatDMY(feedDate)}`];
  if (historyAvailable && manifestRow?.firstDate && manifestRow.lastDate) {
    parts.push(
      `History ${formatIsoDate(manifestRow.firstDate)} → ${formatIsoDate(manifestRow.lastDate)} (Stage-${HISTORY_STAGE}, ${manifestRow.points} pts)`,
    );
  } else {
    parts.push(`History: pending Stage-${HISTORY_STAGE} backfill for this fund`);
  }
  parts.push("Source: AMFI historical + AMFI latest NAV");
  parts.push("5Y pending future backfill");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// KPI row (Latest NAV + 4 returns)
// ---------------------------------------------------------------------------

function KpiRow({
  returnRow,
  categoryRow,
  latestRow,
}: {
  returnRow: ReturnsFund;
  categoryRow: CategoryFundRank | undefined;
  latestRow: LatestFund | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <NavKpiCard returnRow={returnRow} latestRow={latestRow} />
      {PERIODS.map((p) => (
        <ReturnKpiCard
          key={p}
          period={p}
          returnRow={returnRow}
          fundRank={categoryRow}
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
}: {
  period: PeriodKey;
  returnRow: ReturnsFund;
  fundRank: CategoryFundRank | undefined;
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
  const isCagr = period === "3Y";
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
              ? "no 3Y history"
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
        const unavailableTitle =
          p === "3Y"
            ? "Not enough 3Y history for this fund."
            : `Not enough ${p} history for this fund.`;
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
            title={avail ? (p === "3Y" ? "3Y (CAGR)" : undefined) : unavailableTitle}
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
}: {
  period: PeriodKey;
  returnRow: ReturnsFund;
  historyAvailable: boolean;
  historyLoading: boolean;
  historyErrored: boolean;
  points: NavPerformancePoint[];
  onRetry: () => void;
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
      />
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
  const periodLabel = period === "3Y" ? "3Y CAGR" : period;
  return (
    <div className="rounded-lg border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular">
        <Stat label={`${periodLabel} fund`} value={`${signed(stats.return)}%`} tone={toneOf(stats.return)} />
        <Stat label="Avg" value={`${signed(stats.categoryAverage)}%`} />
        <Stat label="Median" value={`${signed(stats.categoryMedian)}%`} />
        <Stat
          label="vs avg"
          value={`${signed(stats.excessVsAverage)}pp`}
          tone={toneOf(stats.excessVsAverage)}
        />
        <Stat
          label="vs median"
          value={`${signed(stats.excessVsMedian)}pp`}
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
  if (!returnRow) return null;
  const order: PeriodKey[] = ["1Y", "6M", "3M", "1M"];
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
