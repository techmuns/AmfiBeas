/**
 * Read accessor for the per-AMC equity allocation snapshot
 * (`src/data/portfolio-tracker/amc-allocations.json`), built by
 * `scripts/build-amc-allocations.ts` from the per-fund holdings.
 *
 * Powers the two IIFL-style fund-house cards on the MFs Portfolio Tracker:
 *   - Cap Allocation     (Large / Mid / Small split of each AMC's equity)
 *   - Sector Allocation  (sector split of each AMC's equity)
 *
 * Each row is one AMC (top N by equity value) plus a final "Industry" row;
 * the per-tier / per-sector values are percentages of that row's classified
 * equity and sum to ~100. Read-only — never mutate the imported arrays.
 */
import raw from "./portfolio-tracker/amc-allocations.json";

export interface AmcCapRow {
  amc: string;
  equityCr: number;
  large: number;
  mid: number;
  small: number;
}

/** One AMC's sector split. Sector keys are the labels in `sectorOrder`. */
export interface AmcSectorRow {
  amc: string;
  equityCr: number;
  [sector: string]: number | string;
}

export interface AmcAllocationsMeta {
  /** Month the holdings snapshot reflects, e.g. "Apr-26". */
  month: string;
  generatedAt: string;
  universe: string;
  /** Count of schemes in the universe that fed the blend. */
  funds: number;
  /** Number of named AMC columns (excludes the Industry column). */
  amcsShown: number;
  capTiers: string[];
  sectorOrder: string[];
  sectorTaxonomyNote: string;
  /** Share of equity value that mapped to a named sector (rest → Others). */
  sectorCoveragePct: number;
}

interface AmcAllocationsSnapshot {
  meta: AmcAllocationsMeta;
  cap: AmcCapRow[];
  sector: AmcSectorRow[];
}

const data = raw as AmcAllocationsSnapshot;

export const amcAllocationsMeta: AmcAllocationsMeta = data.meta;
export const amcCapAllocations: AmcCapRow[] = data.cap;
export const amcSectorAllocations: AmcSectorRow[] = data.sector;
