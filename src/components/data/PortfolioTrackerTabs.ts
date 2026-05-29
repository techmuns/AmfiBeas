import type { DashboardTabDef } from "@/components/layout/DashboardTabs";

/** URL-driven tab strip for /mfs-portfolio-tracker. Mirrors the
 *  pattern used by /monthly (DashboardTabs + resolveTab) so the
 *  active tab persists via `?tab=<id>` and all other query params
 *  pass through unchanged. Adding/removing tabs here is the only
 *  place the IA changes. */
export const TRACKER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "holdings", label: "Holdings" },
  { id: "peers", label: "Peers" },
  { id: "head-to-head", label: "Head-to-head" },
  { id: "trends", label: "Trends" },
] as const satisfies readonly DashboardTabDef[];

export type TrackerTabId = (typeof TRACKER_TABS)[number]["id"];
export const TRACKER_TAB_IDS = TRACKER_TABS.map((t) => t.id) as readonly TrackerTabId[];
