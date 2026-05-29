import { PageHeader } from "@/components/layout/PageHeader";
import { PortfolioTrackerView } from "@/components/data/PortfolioTrackerView";
import {
  TRACKER_TABS,
  TRACKER_TAB_IDS,
  type TrackerTabId,
} from "@/components/data/PortfolioTrackerTabs";
import { fundDirectory } from "@/data/portfolio-tracker";
import { resolveTab } from "@/lib/tabs";

export const metadata = {
  title: "MFs Portfolio Tracker — AmfiBeas",
};

export default async function MfsPortfolioTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeTab = resolveTab<TrackerTabId>(
    sp.tab,
    TRACKER_TAB_IDS,
    "overview"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="MFs Portfolio Tracker"
        subtitle="Portfolio changes over the last 4 months for mutual fund schemes."
      />
      <p className="max-w-3xl text-sm text-muted-foreground">
        Use the search bar below to check the month-over-month equity holdings of
        a mutual fund scheme. Data is updated each month once the most recent
        month&apos;s portfolio is available.
      </p>
      <PortfolioTrackerView
        funds={fundDirectory}
        tabs={TRACKER_TABS}
        activeTab={activeTab}
        searchParams={sp}
      />
    </div>
  );
}
