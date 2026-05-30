import sectorData from "./portfolio-tracker/sector-map.json";

/**
 * Sector classification for mutual-fund equity holdings, used by the
 * "Sector Allocation v/s Category Average" chart. A curated fincode -> sector
 * map (Capitaline/Rupeevest-style taxonomy) covers the high-weight names;
 * anything unmapped falls back to name-based Overseas Equity / Mutual Fund
 * detection, else "Unclassified". See sector-map.json for provenance.
 */

export const UNCLASSIFIED = "Unclassified";
export const OVERSEAS_EQUITY = "Overseas Equity";
export const MUTUAL_FUND = "Mutual Fund";

const sectorByFincode = new Map<string, string>();
for (const [fincode, sector] of sectorData.stocks as [string, string, string][]) {
  sectorByFincode.set(fincode, sector);
}

const overseasPatterns: string[] = sectorData.overseasNamePatterns;
const mutualFundPatterns: string[] = sectorData.mutualFundNamePatterns;

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Classify a single holding to a sector. Prefers the curated fincode map;
 * falls back to name patterns for foreign listings and mutual-fund units;
 * otherwise "Unclassified". Never throws.
 */
export function classifySector(fincode: string, companyName: string): string {
  const mapped = sectorByFincode.get(fincode);
  if (mapped) return mapped;
  const lower = ` ${String(companyName).toLowerCase()} `;
  if (matchesAny(lower, mutualFundPatterns)) return MUTUAL_FUND;
  if (matchesAny(lower, overseasPatterns)) return OVERSEAS_EQUITY;
  return UNCLASSIFIED;
}

export const sectorMapMeta = sectorData.meta;
