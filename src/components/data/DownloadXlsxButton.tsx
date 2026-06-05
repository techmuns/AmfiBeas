"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { CsvColumn } from "@/lib/csv";
import { downloadXlsx } from "@/lib/xlsx";
import { cn } from "@/lib/cn";

interface Props<T> {
  rows: readonly T[];
  columns: readonly CsvColumn<T>[];
  /** Download filename — should end in `.xlsx`. */
  filename: string;
  /** Worksheet tab name (truncated/sanitised to Excel's limits). */
  sheetName?: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Real .xlsx export button — the spreadsheet counterpart to DownloadCsvButton,
 * with the same props shape so a table can offer either from one set of column
 * definitions. SheetJS is dynamically imported on click (see lib/xlsx), so it
 * never lands in the initial bundle. Labelled "Excel" because it produces a
 * genuine workbook, not a CSV.
 */
export function DownloadXlsxButton<T>({
  rows,
  columns,
  filename,
  sheetName,
  label = "Excel",
  className,
  size = "sm",
}: Props<T>) {
  const [busy, setBusy] = useState(false);
  const disabled = rows.length === 0 || busy;
  const handleClick = async () => {
    setBusy(true);
    try {
      await downloadXlsx(rows, columns, filename, sheetName);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        className
      )}
      title={
        rows.length === 0
          ? "No rows to export"
          : busy
            ? "Preparing…"
            : `Download ${rows.length} row${rows.length === 1 ? "" : "s"} as Excel`
      }
    >
      <Download className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {label}
    </button>
  );
}
