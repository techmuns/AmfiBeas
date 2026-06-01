import data from "./portfolio-tracker/sector-flows.json";

/**
 * Monthly sector net-flows (Rs bn), computed from active-equity MF holdings by
 * scripts/build-sector-flows.ts using the same implied-price / corporate-action
 * methodology as the cap-tier flow tables. Rupeevest holdings carry only ~4
 * months, so flows are computable for the latest 3 month-on-month transitions.
 * Heatmap colouring is derived from these values at render time.
 */

export interface SectorFlowRow {
  sector: string;
  /** Net flow (Rs bn) for each month in `sectorFlowMonths`, oldest → newest. */
  monthly: number[];
  /** Sum across the available CY26 months (Rs bn). */
  ytd: number;
}

export interface SectorFlowMeta {
  generatedAt: string;
  months: string[];
  ytdLabel: string;
  ytdCoverage: string;
  universe: string;
  activeEquityFunds: number;
  metric: string;
  note: string;
}

export const sectorFlowMonths: string[] = data.months as string[];
export const sectorFlowRows: SectorFlowRow[] = data.rows as SectorFlowRow[];
export const sectorFlowTotals = data.totals as { monthly: number[]; ytd: number };
export const sectorFlowMeta = data.meta as SectorFlowMeta;
export const sectorFlowYtdLabel: string = sectorFlowMeta.ytdLabel;
