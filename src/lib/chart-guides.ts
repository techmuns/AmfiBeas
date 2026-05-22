/**
 * Registry of "how to read this" guidance surfaced via the
 * AiExplainButton on every exhibit card. Adding a new chartId to a
 * DesignLanguageCard without a matching entry here fails typecheck —
 * see the conditional type at the bottom.
 *
 * Body strings are plain markdown. Renderer respects line breaks and
 * basic emphasis; keep it short — a reader should be able to scan
 * the popover in under 20 seconds.
 */
export interface ChartGuide {
  title: string;
  body: string;
}

export const CHART_GUIDES = {} as const satisfies Record<string, ChartGuide>;

export type ChartGuideId = keyof typeof CHART_GUIDES;

export function getChartGuide(id: string): ChartGuide | null {
  if (id in CHART_GUIDES) {
    return CHART_GUIDES[id as ChartGuideId];
  }
  return null;
}
