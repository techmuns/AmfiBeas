/**
 * Registry of "how to read this" guidance surfaced via the
 * AiExplainButton on every exhibit card. Adding a new chartId to a
 * DesignLanguageCard without a matching entry here is allowed —
 * the card simply renders the inline `guide` prop instead. Registry
 * entries are the canonical home for stable, reusable explainer
 * copy.
 *
 * Body strings are plain prose. Keep it short — a reader should be
 * able to scan the popover in under 20 seconds.
 */
export interface ChartGuide {
  title: string;
  body: string;
}

export const CHART_GUIDES = {
  "hero-passive-share": {
    title: "Active vs passive trajectory",
    body: "Navy bars: active equity envelope AAUM (Sub-II Growth/Equity plus active hybrid less Arbitrage, plus Sub-IV Solution). Orange bars: passive AAUM (Index Funds + Other ETFs, excludes Gold and FoF-Overseas). Green line on the right axis: passive share of the active+passive envelope. Each bar is a fiscal year-end snapshot; gaps in the source are skipped, never interpolated.",
  },
  "hero-sip-flows-vs-nifty": {
    title: "Monthly SIP contribution and NIFTY 500",
    body: "Burgundy bars: monthly SIP contribution (₹ Cr) reported in the AMFI press release. Dark line on the right axis: NIFTY 500 month-end close, rebased to 100 at the first month in the visible window. The window is the most recent continuous slice — the upstream snapshot has gap months that are excluded rather than bridged with an interpolated line.",
  },
  "hero-sip-aum-stickiness": {
    title: "SIP AUM and stickiness",
    body: "Navy bars: SIP AUM in ₹ Cr (book of recurring SIP contributions, AMFI press release). Orange line on the right axis: SIP AUM as a share of total equity AUM — a stickiness proxy. Each bar is a fiscal year-end snapshot; FYs missing either field are dropped, never zero-filled.",
  },
  "hero-topn-amc-concentration": {
    title: "Top AMC concentration basis QAAUM",
    body: "Stacked bars: navy is the share of the top 5 AMCs by quarter-end AAUM; orange is AMCs ranked 6 through N. The card title states the actual N (Top 10 when the latest disclosure includes at least 10 AMCs, otherwise Top 7). Source: AMFI Fundwise AAUM disclosure (MF-only).",
  },
  "hero-nfo-mobilisation": {
    title: "NFO mobilisation vs industry net flows",
    body: "Navy bars: fiscal-year sum of NFO funds mobilised (₹ Cr), from the AMFI Monthly Report's 'New Schemes' page. Orange line on the right axis: NFO mobilisation as a share of total industry net inflow for the same fiscal year. FYs where total net inflow is non-positive (rare) are excluded since the share % would lose meaning.",
  },
  "hero-active-equity-flow-vs-nifty": {
    title: "Active equity net flow vs NIFTY 500",
    body: "Burgundy bars: monthly active-equity-envelope net flow (Sub-II + active Sub-III ex-Arbitrage + Sub-IV). Negative bars indicate net outflow months. Dark line on the right axis: NIFTY 500 indexed to 100 at the start of the visible window. Window is the most recent continuous slice — gap months are excluded.",
  },
  "fin-revenue-yoy": {
    title: "Operating revenue and YoY",
    body: "Navy bars: quarterly Operating Revenue (₹ Cr) from the AMC's standalone P&L. Orange line on the right axis: YoY growth % (this quarter vs the same quarter last year). Operating Revenue is the AMC's total operating segment revenue — it may include non-MF lines (AIF, PMS, advisory, international); a clean MF-only split is not disclosed.",
  },
  "fin-opprofit-yoy": {
    title: "Operating profit and YoY",
    body: "Navy bars: quarterly Operating Profit (₹ Cr). Orange line on the right axis: YoY growth % (this quarter vs the same quarter last year). Operating Profit excludes Other Income / treasury contribution.",
  },
  "fin-pat-yoy": {
    title: "PAT and YoY",
    body: "Navy bars: quarterly Profit After Tax (₹ Cr). Orange line on the right axis: YoY growth % (this quarter vs the same quarter last year).",
  },
  "fin-pat-margin": {
    title: "PAT and PAT margin",
    body: "Navy bars: quarterly Profit After Tax in ₹ Cr. Green line on the right axis: PAT margin % (PAT ÷ Operating Revenue). The peer-median comparison that used to overlay this chart now lives only in the Listed-AMC Peer Comparison table below.",
  },
  "fin-yields": {
    title: "Revenue yield and operating yield (bps)",
    body: "Navy bars: revenue yield in bps of MF QAAUM (annualised Operating Revenue ÷ same-quarter MF QAAUM × 10,000). Orange line: operating yield (annualised Operating Profit ÷ same MF QAAUM). Caveat: Operating Revenue may include non-MF operating revenue (AIF, PMS, advisory, international); the resulting yield reads as a slight ceiling on the true pure-MF management-fee yield. Cross-AMC differences in the non-MF mix can therefore inflate or deflate the comparison.",
  },
  "home-industry-aum": {
    title: "Industry AUM and annual growth",
    body: "Navy bars: industry total AUM as of each fiscal year-end (₹ Cr; rebased to ₹ Lakh Cr on the axis once values cross the 1,00,000 Cr threshold). Orange line: YoY growth % vs the prior fiscal year-end. The diagonal arrow carries the period-end CAGR. Fiscal years where the prior March's AUM is missing in the snapshot are skipped — the source caption names the covered window.",
  },
  "cmp-aaum-overlay": {
    title: "AAUM overlay",
    body: "Two AMCs' MF AAUM plotted on a shared ₹ Cr axis (navy = AMC A, orange = AMC B). Both AMCs are MF-only by construction — the AMFI Fundwise AAUM disclosure does not publish PMS / AIF / offshore / advisory / alternates. A widening gap implies AMC A is pulling away; a converging gap implies AMC B is catching up.",
  },
  "cmp-share-overlay": {
    title: "Market share overlay",
    body: "Each AMC's share of total industry MF AAUM each quarter (navy = AMC A, orange = AMC B). Use this view when absolute AUM growth is rising for both AMCs and you want to see which one is gaining or ceding cohort share. Source: AMFI Fundwise AAUM disclosure.",
  },
  "os-flow-combo": {
    title: "Funds mobilised and net flow",
    body: "Navy bars: gross funds mobilised each month for SEBI Group V (Index Funds, ETFs, FoF, Gold ETFs) — the inflow side of the equation, always positive. Orange line on the right axis: net flow on the same ₹ Cr scale (mobilised minus redemption). The line dips below zero in months where redemption exceeds gross mobilised, meaning Group V was a net outflow that month. Tooltip carries the precise number for each month — labels are intentionally omitted to keep the line readable across the full window.",
  },
} as const satisfies Record<string, ChartGuide>;

export type ChartGuideId = keyof typeof CHART_GUIDES;

export function getChartGuide(id: string): ChartGuide | null {
  if (id in CHART_GUIDES) {
    return CHART_GUIDES[id as ChartGuideId];
  }
  return null;
}
