import type { DashboardTabDef } from "@/components/layout/DashboardTabs";

/** URL-driven tab strip for /mfs-portfolio-tracker. Mirrors the
 *  pattern used by /monthly (DashboardTabs + resolveTab) so the
 *  active tab persists via `?tab=<id>` and all other query params
 *  pass through unchanged. Adding/removing tabs here is the only
 *  place the IA changes. */
export const TRACKER_TABS = [
  // Holdings is merged into Overview (the full AMC-direct portfolio renders
  // below the sector allocation), so there's no standalone Holdings tab.
  { id: "overview", label: "Overview" },
  // "Peers" and "AMC Mix" moved to the Fund-wise view (both are fund-house
  // level concepts; AMC Mix is now "Allocation mix" there).
  { id: "head-to-head", label: "Head-to-head" },
  { id: "trends", label: "Returns & Ranking" },
] as const satisfies readonly DashboardTabDef[];

export type TrackerTabId = (typeof TRACKER_TABS)[number]["id"];
export const TRACKER_TAB_IDS = TRACKER_TABS.map((t) => t.id) as readonly TrackerTabId[];
