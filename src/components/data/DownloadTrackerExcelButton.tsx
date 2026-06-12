"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  type TrackerExportInput,
  downloadPortfolioTrackerWorkbook,
} from "@/lib/portfolio-tracker-export";

/**
 * One button → one styled workbook covering the whole scheme-wise tracker
 * (Overview + Holdings + Head-to-head + Trends) for the selected fund. Lives in
 * the sticky tab strip so it is reachable from every sub-tab. Disabled until
 * the holdings payload has loaded, since three of the four sheets need it.
 */
export function DownloadTrackerExcelButton({
  input,
  className,
}: {
  input: TrackerExportInput;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || !input.portfolio;

  const handleClick = async () => {
    if (disabled) return;
    setBusy(true);
    try {
      await downloadPortfolioTrackerWorkbook(input);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={
        !input.portfolio
          ? "Loading holdings…"
          : busy
            ? "Preparing workbook…"
            : "Download the whole tab (Overview, Holdings, Head-to-head, Trends) as a styled Excel workbook"
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-foreground/15 bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileSpreadsheet className="h-4 w-4 text-positive" />
      )}
      <span className="hidden sm:inline">Download Excel</span>
      <span className="sm:hidden">Excel</span>
    </button>
  );
}
