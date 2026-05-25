import { PageHeader } from "@/components/layout/PageHeader";
import { PortfolioTrackerTabs } from "@/components/data/PortfolioTrackerTabs";
import { fundDirectory } from "@/data/portfolio-tracker";
import { capFlows } from "@/data/cap-flows";

export const metadata = {
  title: "MFs Portfolio Tracker — AmfiBeas",
};

export default function MfsPortfolioTrackerPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="MFs Portfolio Tracker"
        subtitle="Portfolio changes over the last 4 months for mutual fund schemes."
      />
      <p className="max-w-3xl text-sm text-muted-foreground">
        Search a scheme&apos;s month-over-month equity holdings, or switch to the
        snapshots tab for what mutual funds are buying and selling by market-cap.
        Data is updated each month once the most recent month&apos;s portfolio is
        available.
      </p>
      <PortfolioTrackerTabs funds={fundDirectory} flows={capFlows} />
    </div>
  );
}
