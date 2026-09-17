/**
 * Types + category→benchmark mapping for the benchmark-beat flag on the Active
 * Fund Performance tab. The data itself is a static asset
 * (public/nav-data/benchmark-tri.json) built by scripts/build-benchmark-tri.ts
 * and fetched at runtime, so this module carries only the shape and the map.
 */

export interface BenchmarkPeriod {
  /** Canonical return for the horizon, in percent. Simple for 1M/3M/6M/1Y,
   *  CAGR for 3Y/5Y/10Y — the same convention the fund feed uses. */
  returnPct?: number;
  priReturnPct?: number;
  kind?: "simple" | "cagr";
  /** Actual elapsed years (CAGR horizons only). */
  years?: number;
  /** Resolved index trading day the window starts on. */
  fromDate: string;
  /** Resolved index trading day the window ends on. */
  toDate?: string;
  /** Calendar target the start anchor was resolved from. */
  targetDate?: string;
  /** How the number was produced, e.g. "estimated-tri-from-pri-plus-dividend-yield". */
  returnMethod?: string;
  returnSource?: string;
  /** ALWAYS true today: the return is reconstructed, not the published TRI. */
  isEstimate?: boolean;
  divYieldAvgPct: number;
  /** Legacy aliases of returnPct / priReturnPct, kept for existing consumers.
   *  The "Cagr" in the name is historical — 1M/3M/6M/1Y are simple returns. */
  triEstCagrPct: number;
  priCagrPct: number;
}
export interface BenchmarkIndex {
  label: string;
  asOf: string;
  priClose: number;
  divYieldPct: number;
  /** How many officially-mapped schemes name this index (0 = legacy proxy only). */
  schemeCount?: number;
  periods: Record<string, BenchmarkPeriod>;
}
export interface BenchmarkTriSnapshot {
  generatedAt: string;
  source: string;
  method: string;
  returnMethod?: string;
  isEstimate?: boolean;
  periodConvention?: string;
  latestDate: string;
  /** As-of date of the NAV snapshot this build aligned its anchors to. */
  navAsOfDate?: string | null;
  indices: Record<string, BenchmarkIndex>;
}

/**
 * CATEGORY PROXY benchmarks — NOT official scheme benchmarks.
 *
 * This is a broad index picked per AMFI CATEGORY, useful for the "did active
 * management beat the market" view on the Active Fund Performance tab. It is
 * NOT what any particular AMC publishes for any particular scheme, and it must
 * never be serialized as `officialBenchmark`. The scheme-level, AMC-published
 * mapping lives in public/nav-data/mf-scheme-benchmarks.json (built by
 * scripts/ingest/scheme-benchmarks/build.ts) and is surfaced by
 * /api/returns-ranking as `officialBenchmark`; this map is surfaced there only
 * as the diagnostic `categoryProxyBenchmarkKey`.
 *
 * The fact-sheet benchmark index for each actively-managed EQUITY category.
 * Pure-equity categories map to their standard broad Nifty TRI index. Hybrid
 * categories are intentionally absent: their fact-sheet benchmarks are blended
 * debt+equity indices (e.g. CRISIL Hybrid 35+65) that can't be reconstructed
 * from an equity index, so the tab shows "n/a" for their benchmark-beat rather
 * than an apples-to-oranges comparison.
 *
 * A few mappings are the accepted broad proxy rather than the exact index —
 * Multi Cap's true benchmark is Nifty500 Multicap 50:25:25 TRI, and
 * Focused / Value / Thematic funds each pick their own — but the broad market
 * index is the fair yardstick for "did active management add value". Those
 * exact deviations are precisely why the scheme-level official registry exists.
 */
export const CATEGORY_BENCHMARK: Record<string, string> = {
  "Equity : Flexi Cap": "NIFTY_500",
  "Equity : Multi Cap": "NIFTY_500",
  "Equity : Large Cap": "NIFTY_100",
  "Equity : Large & Mid Cap": "NIFTY_LARGEMIDCAP_250",
  "Equity : Mid Cap": "NIFTY_MIDCAP_150",
  "Equity : Small Cap": "NIFTY_SMALLCAP_250",
  "Equity : Focused": "NIFTY_500",
  "Equity : Value / Contra": "NIFTY_500",
  "Equity : Tax Saving (ELSS)": "NIFTY_500",
  "Equity : Thematic": "NIFTY_500",
};
