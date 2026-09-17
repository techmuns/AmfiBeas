/**
 * Types + category→benchmark mapping for the benchmark-beat flag on the Active
 * Fund Performance tab. The data itself is a static asset
 * (public/nav-data/benchmark-tri.json) built by scripts/build-benchmark-tri.ts
 * and fetched at runtime, so this module carries only the shape and the map.
 */

export interface BenchmarkPeriod {
  /** TRI (total-return) CAGR estimate for the horizon, in percent. */
  triEstCagrPct: number;
  priCagrPct: number;
  divYieldAvgPct: number;
  fromDate: string;
}
export interface BenchmarkIndex {
  label: string;
  asOf: string;
  priClose: number;
  divYieldPct: number;
  periods: Record<string, BenchmarkPeriod>;
}
export interface BenchmarkTriSnapshot {
  generatedAt: string;
  source: string;
  method: string;
  latestDate: string;
  indices: Record<string, BenchmarkIndex>;
}

/**
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
 * index is the fair yardstick for "did active management add value".
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
