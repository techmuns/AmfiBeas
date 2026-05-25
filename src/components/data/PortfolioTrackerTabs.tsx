"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { PortfolioTrackerView } from "./PortfolioTrackerView";
import { CapFlowsView } from "./CapFlowsView";
import type { FundDirectoryEntry } from "@/data/portfolio-tracker";
import type { CapFlows } from "@/data/cap-flows";

type Tab = "holdings" | "snapshots";

export function PortfolioTrackerTabs({
  funds,
  flows,
}: {
  funds: FundDirectoryEntry[];
  flows: CapFlows;
}) {
  const [tab, setTab] = useState<Tab>("holdings");
  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b">
        {(
          [
            ["holdings", "Holdings tracker"],
            ["snapshots", "Buy / sell snapshots"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "holdings" ? (
        <PortfolioTrackerView funds={funds} />
      ) : (
        <CapFlowsView flows={flows} />
      )}
    </div>
  );
}
