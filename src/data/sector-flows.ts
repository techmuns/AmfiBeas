// Monthly sector net-flows (Rs bn), reproduced from a provided research
// snapshot (Apr-25 → Apr-26 + CY26 YTD). Static external data: transcribed
// and cross-checked against the source's Total row and CY26-YTD (= Jan–Apr
// 2026) sub-totals. Heatmap colouring is derived from these values at render
// time. The app's own holdings only span ~4 months, so the deeper history
// here comes from the source rather than live computation.

export interface SectorFlowRow {
  sector: string;
  /** Net flow (Rs bn) for each month in `sectorFlowMonths`, oldest → newest. */
  monthly: number[];
  /** CY26 year-to-date net flow (Rs bn). */
  ytd: number;
}

export interface SectorFlowMeta {
  months: string[];
  ytdLabel: string;
  source: string;
  note: string;
}

export const sectorFlowMonths: string[] = [
  "Apr-25", "May-25", "Jun-25", "Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25", "Dec-25", "Jan-26", "Feb-26", "Mar-26", "Apr-26",
];

export const sectorFlowRows: SectorFlowRow[] = [
  { sector: "BFSI", monthly: [66, 59, 122, 176, 124, 89, 145, 145, 157, 195, 94, 335, 224], ytd: 848 },
  { sector: "FMCG", monthly: [-14, 73, 54, 27, 33, 27, 23, 39, 51, 11, 46, 28, 45], ytd: 130 },
  { sector: "Healthcare", monthly: [-1, 18, 54, 42, 44, 67, 3, -1, 2, 36, -3, 77, 43], ytd: 153 },
  { sector: "New-age tech", monthly: [-7, 32, -6, 10, 68, 16, 3, 88, 20, 29, 54, 50, 28], ytd: 161 },
  { sector: "Capital Goods", monthly: [18, 4, 75, 32, 18, 6, -11, 14, -21, -16, 20, 116, 25], ytd: 145 },
  { sector: "Retail", monthly: [3, 3, 61, 12, 5, -9, 11, -20, 16, 7, 6, 11, 14], ytd: 38 },
  { sector: "Real Estate", monthly: [5, 17, -3, 10, 8, 4, 6, -1, -2, 8, 2, 8, 11], ytd: 29 },
  { sector: "Telecom", monthly: [-26, 44, -8, 5, 27, 12, -7, 38, -3, -3, 24, 137, 10], ytd: 168 },
  { sector: "Misc.", monthly: [6, 39, 27, -13, 25, 46, 22, 33, 48, 26, 23, 33, 7], ytd: 89 },
  { sector: "IT", monthly: [44, 23, -13, 101, 103, 25, 5, 80, -42, -1, 85, 66, 6], ytd: 156 },
  { sector: "Consumer Discr.", monthly: [9, 29, 63, 32, 18, 24, 18, 21, 79, 21, 16, 26, 5], ytd: 67 },
  { sector: "Cement & BM", monthly: [-11, -4, -1, -2, 13, 16, 3, -9, 4, 19, 7, 12, 3], ytd: 41 },
  { sector: "Metals & Mining", monthly: [10, 9, -11, -8, 3, 13, -8, -8, 9, 9, 2, 72, 3], ytd: 85 },
  { sector: "Media", monthly: [-3, 0, -7, 3, 11, 14, 2, 7, 0, -1, 4, -3, 2], ytd: 2 },
  { sector: "Oil & Gas", monthly: [70, 16, 3, -1, 19, -4, 9, -12, -15, -23, -9, 90, 1], ytd: 59 },
  { sector: "Chemicals", monthly: [2, -2, 5, -11, 24, 30, 0, 0, 5, 8, 9, 18, 0], ytd: 35 },
  { sector: "Consumer Durable", monthly: [-15, 7, 32, 28, 9, -6, 59, 11, -6, -4, 8, 5, -1], ytd: 8 },
  { sector: "Utilities", monthly: [-3, 19, 43, 7, 14, 10, 24, 9, 30, 23, -2, 136, -12], ytd: 145 },
  { sector: "Auto & Auto Anc", monthly: [26, 38, -19, 33, 10, 8, -15, 2, 12, 13, -12, 49, -12], ytd: 38 },
];

export const sectorFlowTotals: { monthly: number[]; ytd: number } = {
  monthly: [179, 424, 472, 483, 580, 387, 292, 443, 354, 359, 370, 1267, 402],
  ytd: 2399,
};

export const sectorFlowMeta: SectorFlowMeta = {
  months: sectorFlowMonths,
  ytdLabel: "CY26 YTD",
  source: "external research snapshot",
  note: "Static snapshot transcribed from the source heatmap (Apr-25 → Apr-26).",
};

export const sectorFlowYtdLabel: string = sectorFlowMeta.ytdLabel;
