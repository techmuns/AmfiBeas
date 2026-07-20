import indexJson from "./portfolio-tracker/index.json";

/**
 * Mutual-fund equity-holdings portfolios in the RupeeVest Portfolio Tracker
 * shape: per company, a value per month ({ % of AUM, No. of Shares }) plus a
 * change arrow derived from the share-count delta vs the next-older month.
 *
 * The full per-fund snapshots (~734 funds, ~51 MB) are served as static assets
 * from /public/holdings/ and fetched on demand. Only the lightweight directory
 * (built from index.json) is bundled, so the fund picker is instant while
 * holdings load when a fund is selected.
 */

export type HoldingArrow = "up" | "down" | "flat/none" | "missing" | "unknown";

export interface TrackerMonthCell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
  arrow: HoldingArrow;
  arrow_raw: string | null;
}

export interface TrackerHolding {
  company_name: string;
  fincode: string;
  /** AMC-disclosed sector/industry for the holding (AMC-direct feed). When
   *  present, the sector views use it instead of the fincode→sector map. */
  sector?: string | null;
  months: Record<string, TrackerMonthCell>;
}

export interface TrackerMonth {
  label: string;
  aumCr: string | number | null;
}

export interface FundPortfolio {
  meta: {
    fund: string;
    schemecode: string;
    classification: string | null;
    aumTotalCr: number | null;
    aumAsOf: string | null;
    scrapedAt: string;
    source: string;
    section: string;
    months: TrackerMonth[];
  };
  rows: TrackerHolding[];
}

/** One scheme in the fund picker; holdings live in a separate static file. */
export interface FundDirectoryEntry {
  schemecode: string;
  fund: string;
  classification: string | null;
  aumTotalCr: number | null;
  rowCount: number;
  /** Public path to the full holdings JSON, e.g. "/holdings/1979-…json". */
  path: string;
  /** Authoritative fund-house label from the AMC filing (AMC-direct feed only);
   *  when present the picker uses it instead of guessing from the scheme name. */
  amc?: string;
}

interface RawIndexEntry {
  schemecode: string;
  fundName: string | null;
  name: string;
  classification: string | null;
  aumTotalCr: number | null;
  rowCount: number;
  file: string | null;
}

/** Slugify a month label ("Apr-26" -> "apr_26") to index into a row's months. */
export function monthSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Funds with equity holdings, sorted by AUM desc (largest first). */
export const fundDirectory: FundDirectoryEntry[] = (
  indexJson.funds as RawIndexEntry[]
)
  .filter((f): f is RawIndexEntry & { file: string } => Boolean(f.file))
  .map((f) => ({
    schemecode: f.schemecode,
    fund: f.fundName ?? f.name,
    classification: f.classification,
    aumTotalCr: f.aumTotalCr,
    rowCount: f.rowCount,
    path: `/${f.file}`,
  }));
