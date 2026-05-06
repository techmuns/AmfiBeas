/**
 * Morningstar KPI registry.
 *
 * Two groups:
 *   - FREE_PUBLIC_KPIS — derived from publicly accessible Morningstar / AMFI
 *     pages. These can become "available" once the optional Morningstar
 *     ingestion (MORNINGSTAR_FETCH_ENABLED=1) lands rows. Default status is
 *     "not_connected".
 *   - PAID_LOCKED_KPIS — proprietary Morningstar datasets that require a
 *     commercial licence. We never fetch these. Status is permanently
 *     "locked"; the UI surfaces them as compact placeholders so users can
 *     see what would be added under a licence.
 */

export type KpiAvailability = "free_public" | "paid_locked";
export type KpiStatus = "available" | "not_connected" | "locked";

export interface MorningstarKpi {
  id: string;
  label: string;
  category: string;
  availability: KpiAvailability;
  source: "Morningstar";
  status: KpiStatus;
  description: string;
  dashboardUse: string;
}

export const FREE_PUBLIC_KPIS: readonly MorningstarKpi[] = [
  {
    id: "amc-aaum",
    label: "AMC-wise Average AUM",
    category: "AUM",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Quarterly AAUM by fund house (public).",
    dashboardUse: "/quarterly fallback to AMFI",
  },
  {
    id: "fund-aaum",
    label: "Fund-wise Average AUM",
    category: "AUM",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Per-scheme AAUM where published.",
    dashboardUse: "AMC drilldown (planned)",
  },
  {
    id: "factsheet",
    label: "Fund factsheet metadata",
    category: "Reference",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Scheme code, ISIN, manager, inception.",
    dashboardUse: "AMC list metadata",
  },
  {
    id: "category-mapping",
    label: "Fund category mapping",
    category: "Reference",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "SEBI / Morningstar category per scheme.",
    dashboardUse: "AUM Mix tagging",
  },
  {
    id: "fund-performance",
    label: "Fund performance",
    category: "Performance",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Trailing returns from public NAV history.",
    dashboardUse: "Scheme drilldown",
  },
  {
    id: "category-performance",
    label: "Category performance",
    category: "Performance",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Category-aggregated trailing returns.",
    dashboardUse: "Performance heatmap context",
  },
  {
    id: "latest-nav",
    label: "Latest NAV / NAV date",
    category: "Reference",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Most recent published NAV per scheme.",
    dashboardUse: "Already covered via AMFI NAVAll",
  },
  {
    id: "nfo",
    label: "NFO data",
    category: "Reference",
    availability: "free_public",
    source: "Morningstar",
    status: "not_connected",
    description: "Public new-fund-offer announcements.",
    dashboardUse: "Monthly NFO Launches card",
  },
];

export const PAID_LOCKED_KPIS: readonly MorningstarKpi[] = [
  {
    id: "asset-flows",
    label: "Asset flows",
    category: "Flows",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Net flows by share class / category.",
    dashboardUse: "Industry flows view",
  },
  {
    id: "full-holdings",
    label: "Full holdings",
    category: "Holdings",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Stock-level holdings per scheme.",
    dashboardUse: "Portfolio overlap analysis",
  },
  {
    id: "lookthrough",
    label: "Look-through holdings",
    category: "Holdings",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Underlying exposure across FoFs.",
    dashboardUse: "True equity exposure",
  },
  {
    id: "peer-breakpoints",
    label: "Peer group breakpoints",
    category: "Risk / peers",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Quartile thresholds vs peer group.",
    dashboardUse: "Quartile rank summary",
  },
  {
    id: "proprietary-quartiles",
    label: "Proprietary quartile breakpoints",
    category: "Risk / peers",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Morningstar-defined quartile cutoffs.",
    dashboardUse: "Top quartile %",
  },
  {
    id: "excess-returns",
    label: "Excess returns dataset",
    category: "Performance",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Risk-adjusted excess returns.",
    dashboardUse: "Outperformance heatmap",
  },
  {
    id: "analyst-research",
    label: "Morningstar analyst research",
    category: "Research",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Written analyst notes per fund.",
    dashboardUse: "AMC drilldown",
  },
  {
    id: "medalist",
    label: "Morningstar Medalist / qualitative",
    category: "Research",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Gold / Silver / Bronze ratings.",
    dashboardUse: "Quality score",
  },
  {
    id: "ratings-history",
    label: "Proprietary ratings history",
    category: "Risk / peers",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Star rating timeline.",
    dashboardUse: "Stability over time",
  },
  {
    id: "data-lake",
    label: "Data lake / Direct API datasets",
    category: "API",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Bulk datasets via Direct / Data Lake.",
    dashboardUse: "Bulk ingestion",
  },
  {
    id: "risk-analytics",
    label: "Portfolio risk analytics",
    category: "Risk / peers",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Risk metrics, factor exposures.",
    dashboardUse: "Risk drilldown",
  },
  {
    id: "custom-reports",
    label: "Custom Morningstar reports",
    category: "Research",
    availability: "paid_locked",
    source: "Morningstar",
    status: "locked",
    description: "Bespoke client reports.",
    dashboardUse: "On request",
  },
];
