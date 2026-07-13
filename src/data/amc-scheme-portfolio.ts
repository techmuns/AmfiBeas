import crosswalk from "./portfolio-tracker/amc-portfolio-crosswalk.json";

/**
 * 2A bridge — direct-from-AMC monthly portfolio disclosures surfaced on the MFs
 * Portfolio Tracker's Holdings tab.
 *
 * `holdings-tracker.ts` gives the tab RupeeVest's month-over-month EQUITY view
 * (keyed by fincode). This module adds the AMC's own SEBI monthly disclosure for
 * the same scheme: the complete, ISIN-level, ALL-asset-class latest-month
 * portfolio. The two are complementary — RupeeVest for the equity trend, the
 * AMC filing for the authoritative full snapshot.
 *
 * The bundled crosswalk (built by scripts/build-amc-portfolio-crosswalk.ts) maps
 * a tracker `schemecode` to its disclosure; the full per-scheme payload is a
 * static file under /amc-portfolio/<schemecode>.json fetched on demand.
 */

export type AmcAssetClass = "Equity" | "Debt" | "Cash & equiv" | "Gold" | "Silver" | "Other";
export type AmcMatchConfidence = "override" | "exact" | "high";

/** Lightweight, bundled: enough to show availability + a header before fetching. */
export interface AmcDisclosureRef {
  amcSlug: string;
  amcSchemeName: string;
  asOfMonth: string;
  holdings: number;
  confidence: AmcMatchConfidence;
}

export interface AmcDisclosureAllocation {
  class: AmcAssetClass;
  pct: number;
}

export interface AmcDisclosureHolding {
  name: string;
  isin: string | null;
  industry: string | null;
  assetClass: AmcAssetClass;
  pctToNav: number | null;
  marketValueCr: number | null;
}

/** Shape of a per-scheme /amc-portfolio/<schemecode>.json payload. */
export interface AmcSchemePortfolio {
  schemecode: string;
  amc: string;
  amcSlug: string;
  amcSchemeName: string;
  amcSchemeCode: string;
  sourceUrl: string;
  asOfMonth: string;
  asOf: string | null;
  fetchedAt: string;
  coveragePct: number;
  allocation: AmcDisclosureAllocation[];
  holdings: AmcDisclosureHolding[];
}

interface Crosswalk {
  meta: { generatedAt: string; source: string; trackerSchemes: number; matched: number };
  entries: Record<string, AmcDisclosureRef>;
}

const CROSSWALK = crosswalk as unknown as Crosswalk;

/** The AMC disclosure reference for a tracker schemecode, or null if none is
 *  mapped (unmatched scheme, or an AMC not yet fetched). */
export function amcDisclosureRef(schemecode: string): AmcDisclosureRef | null {
  return CROSSWALK.entries[schemecode] ?? null;
}

/** Public path to a scheme's full disclosure payload. */
export function amcDisclosurePath(schemecode: string): string {
  return `/amc-portfolio/${schemecode}.json`;
}

export const amcDisclosureMeta = CROSSWALK.meta;
