"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Layers, Building2 } from "lucide-react";
import {
  PortfolioTrackerView,
} from "@/components/data/PortfolioTrackerView";
import { FundwisePortfolioView } from "@/components/data/FundwisePortfolioView";
import type { DashboardTabDef } from "@/components/layout/DashboardTabs";
import type { TrackerTabId } from "@/components/data/PortfolioTrackerTabs";
import type { FundDirectoryEntry } from "@/data/portfolio-tracker";
import type { FundHouseEntry } from "@/data/fundwise-tracker";

type Mode = "scheme" | "fund";

/**
 * Top-level Scheme-wise ↔ Fund-wise toggle for the MFs Portfolio Tracker.
 *
 * Scheme-wise (default) is the existing per-scheme tracker. Fund-wise rolls
 * every scheme up to its fund house (HDFC / SBI / ICICI …) and shows the
 * combined equity book. Switching is pure client state, so the page stays
 * statically rendered.
 */
export function PortfolioTrackerSwitch({
  funds,
  tabs,
  initialTab,
  searchParams,
  fundHouses,
}: {
  funds: FundDirectoryEntry[];
  tabs: readonly DashboardTabDef[];
  initialTab: TrackerTabId;
  searchParams: Record<string, string | string[] | undefined>;
  fundHouses: FundHouseEntry[];
}) {
  // A `?view=fund` deep link opens straight into the fund-wise view.
  const initialMode: Mode =
    searchParams.view === "fund" ? "fund" : "scheme";
  const [mode, setMode] = useState<Mode>(initialMode);

  const options: { id: Mode; label: string; icon: typeof Layers }[] = [
    { id: "scheme", label: "Scheme-wise", icon: Layers },
    { id: "fund", label: "Fund-wise", icon: Building2 },
  ];

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border bg-card p-1">
        {options.map((o) => {
          const Icon = o.icon;
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {o.label}
            </button>
          );
        })}
      </div>

      {mode === "scheme" ? (
        <PortfolioTrackerView
          funds={funds}
          tabs={tabs}
          initialTab={initialTab}
          searchParams={searchParams}
        />
      ) : (
        <FundwisePortfolioView fundHouses={fundHouses} />
      )}
    </div>
  );
}
