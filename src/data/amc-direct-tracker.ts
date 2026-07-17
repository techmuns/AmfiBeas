import directIndex from "./portfolio-tracker/amc-direct-index.json";
import type { FundDirectoryEntry } from "./portfolio-tracker";

/**
 * The scheme-wise MFs Portfolio Tracker's fund directory, sourced entirely from
 * AMC-direct SEBI monthly disclosures (built by scripts/build-amc-direct-tracker.ts)
 * — the RupeeVest feed is retired from this view. Every scheme here has a
 * direct-from-AMC holdings file and appears in the picker.
 */
interface DirectFund {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  rowCount: number;
  file: string;
  amcSlug: string;
}

export const amcDirectFundDirectory: FundDirectoryEntry[] = (
  directIndex.funds as DirectFund[]
).map((f) => ({
  schemecode: f.schemecode,
  fund: f.fundName ?? f.name,
  classification: f.classification,
  aumTotalCr: f.aumTotalCr,
  rowCount: f.rowCount,
  path: `/${f.file}`,
}));
