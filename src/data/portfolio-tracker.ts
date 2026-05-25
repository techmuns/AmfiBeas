import kotak from "./portfolio-tracker/kotak-arbitrage-fund-g-equity-holdings.json";

/**
 * Mutual-fund equity-holdings portfolios in the RupeeVest Portfolio Tracker
 * shape: per company, a value per month ({ % of AUM, No. of Shares }) plus a
 * change arrow derived from the share-count delta vs the next-older month.
 *
 * Source files are scraped JSON snapshots; add more funds by dropping their
 * JSON under ./portfolio-tracker/ and appending to `fundPortfolios`.
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

/** Slugify a month label ("Apr-26" -> "apr_26") to index into a row's months. */
export function monthSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const fundPortfolios: FundPortfolio[] = [kotak as unknown as FundPortfolio];
