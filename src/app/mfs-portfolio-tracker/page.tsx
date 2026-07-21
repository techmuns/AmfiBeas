import { PageHeader } from "@/components/layout/PageHeader";
import { PortfolioTrackerSwitch } from "@/components/data/PortfolioTrackerSwitch";
import {
  TRACKER_TABS,
  TRACKER_TAB_IDS,
  type TrackerTabId,
} from "@/components/data/PortfolioTrackerTabs";
import { amcDirectFundDirectory } from "@/data/amc-direct-tracker";
import { fundHouseDirectory } from "@/data/fundwise-tracker";
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
      <PageHeader title="MFs Portfolio Tracker" />
      <PortfolioTrackerSwitch
        funds={amcDirectFundDirectory}
        tabs={TRACKER_TABS}
        initialTab={activeTab}
        searchParams={sp}
        fundHouses={fundHouseDirectory}
      />
    </div>
  );
}
