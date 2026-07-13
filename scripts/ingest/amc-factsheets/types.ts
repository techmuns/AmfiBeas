/**
 * Normalized shapes for direct-from-AMC monthly portfolio disclosures.
 * Every AMC adapter (SBI, Nippon, …) parses its own file format down to these.
 */

export interface AmcHolding {
  /** ISIN when the row carries one (equity/debt securities do). */
  isin: string | null;
  /** Instrument / issuer name as printed. */
  name: string;
  /** Industry / rating text as printed (used for the 2A sector mapping). */
  industry: string | null;
  quantity: number | null;
  /** Market value normalized to ₹ Cr (source files quote ₹ Lakhs/Lacs). */
  marketValueCr: number | null;
  /** Weight as a percentage of the scheme's AUM/NAV (e.g. 5.5 = 5.5%). */
  pctToNav: number | null;
}

export interface AmcScheme {
  /** The AMC's own scheme code / short code (sheet identity). */
  schemeCode: string;
  schemeName: string;
  /** Portfolio-statement "as on" date, ISO (YYYY-MM-DD). */
  asOf: string | null;
  holdings: AmcHolding[];
}

export interface AmcPortfolioSnapshot {
  amc: string;
  amcSlug: string;
  sourceUrl: string;
  /** Human month label of the disclosure, e.g. "May-26". */
  asOfMonth: string;
  fetchedAt: string;
  schemes: AmcScheme[];
}

/** Per-AMC parsing options (the file layouts differ only in a few axes). */
export interface AmcParseOptions {
  /** Multiply the raw "% to NAV/AUM" by this to reach whole-percent units.
   *  SBI already prints percent (1); Nippon prints a fraction (100). */
  pctScale: number;
  /** Divisor to convert the raw market value into ₹ Cr. Files quote ₹ Lakhs,
   *  so 100 (1 Cr = 100 Lakh). */
  valueToCr: number;
  /** Sheet names to skip (index/cover/disclaimer sheets). */
  skipSheets?: (name: string) => boolean;
}
