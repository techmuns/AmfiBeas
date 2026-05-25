import { PageHeader } from "@/components/layout/PageHeader";
import { PortfolioTrackerView } from "@/components/data/PortfolioTrackerView";
import { fundDirectory } from "@/data/portfolio-tracker";

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
        Use the search bar below to check the month-over-month equity holdings of
        a mutual fund scheme. Data is updated each month once the most recent
        month&apos;s portfolio is available.
      </p>
      <PortfolioTrackerView funds={fundDirectory} />
    </div>
  );
}
