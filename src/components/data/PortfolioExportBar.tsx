"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The single master export toolbar for the MFs Portfolio Tracker — one big
 * "Download Excel" + "Download PDF" pair that replaces the per-table buttons.
 * The parent supplies the async handlers (which gather the current selection's
 * data and build a styled workbook / report); this component owns the busy
 * state and the (intentionally generous) presentation.
 */
export function PortfolioExportBar({
  title,
  hint,
  onExcel,
  onPdf,
  disabled = false,
}: {
  title: string;
  hint: string;
  onExcel: () => Promise<void>;
  onPdf: () => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<null | "excel" | "pdf">(null);
  const run = (kind: "excel" | "pdf", fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      console.error("Portfolio export failed", e);
    } finally {
      setBusy(null);
    }
  };

  const btn =
    "inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-tight">{title}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={run("excel", onExcel)}
          disabled={disabled || busy !== null}
          className={cn(
            btn,
            "border-positive/30 bg-positive/10 text-positive hover:bg-positive/15"
          )}
          title="Download the full selection as a styled Excel workbook"
        >
          {busy === "excel" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          Download Excel
        </button>
        <button
          type="button"
          onClick={run("pdf", onPdf)}
          disabled={disabled || busy !== null}
          className={cn(
            btn,
            "border-negative/30 bg-negative/10 text-negative hover:bg-negative/15"
          )}
          title="Download the full selection as a styled PDF report"
        >
          {busy === "pdf" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          Download PDF
        </button>
      </div>
    </div>
  );
}
