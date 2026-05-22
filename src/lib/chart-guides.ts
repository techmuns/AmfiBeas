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
} as const satisfies Record<string, ChartGuide>;

export type ChartGuideId = keyof typeof CHART_GUIDES;

export function getChartGuide(id: string): ChartGuide | null {
  if (id in CHART_GUIDES) {
    return CHART_GUIDES[id as ChartGuideId];
  }
  return null;
}
