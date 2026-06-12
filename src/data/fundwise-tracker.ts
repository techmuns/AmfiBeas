import indexJson from "./portfolio-tracker/fundwise-index.json";
import type { FundPortfolio } from "./portfolio-tracker";

/**
 * Fund-WISE (AMC-level) portfolio directory — the sibling of the scheme-wise
 * fundDirectory. Each entry is one fund house (HDFC / SBI / ICICI …) whose
 * holdings are the aggregate of every scheme it runs, precomputed by
 * scripts/build-fundwise-portfolios.ts. The heavy per-AMC holdings live as
 * static assets under /public/fundwise and are fetched on demand; only this
 * lightweight directory is bundled.
 *
 * The fetched payload has the same shape as a scheme's FundPortfolio, so the
 * fund-wise view reuses the scheme-wise holdings rendering.
 */
export interface FundHouseEntry {
  /** URL-safe AMC id, e.g. "icici-pru". */
  slug: string;
  /** Display name, e.g. "ICICI Pru". */
  amc: string;
  /** Number of schemes rolled up into this fund house. */
  schemeCount: number;
  /** Distinct companies held across all the AMC's schemes. */
  holdingsCount: number;
  /** Latest-month aggregated equity-holdings value (₹ Cr). */
  equityValueCr: number;
  /** Latest month label, e.g. "Apr-26". */
  latestMonth: string;
  /** Prior month label, or null when only one month is available. */
  prevMonth: string | null;
  /** Top-10 holdings as a % of the equity book (latest month). */
  top10Pct: number;
  /** MoM change in top-10 concentration (pp); null when no prior month. */
  top10DeltaPp: number | null;
  /** Biggest single-stock weight add / trim across the book (pp MoM). */
  biggestAdd: { company: string; pp: number } | null;
  biggestTrim: { company: string; pp: number } | null;
  /** Public path to the aggregated holdings JSON. */
  path: string;
}

interface RawIndex {
  fundHouses: FundHouseEntry[];
}

/** Fund houses, largest equity book first. */
export const fundHouseDirectory: FundHouseEntry[] = (
  indexJson as RawIndex
).fundHouses;

/** The fetched per-AMC payload is shape-compatible with a scheme portfolio. */
export type FundHousePortfolio = FundPortfolio;
