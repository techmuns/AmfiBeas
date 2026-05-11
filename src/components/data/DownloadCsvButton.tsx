"use client";

import { Download } from "lucide-react";
import {
  type CsvColumn,
  rowsToCsv,
  triggerCsvDownload,
} from "@/lib/csv";
import { cn } from "@/lib/cn";

interface Props<T> {
  rows: readonly T[];
  columns: readonly CsvColumn<T>[];
  filename: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

export function DownloadCsvButton<T>({
  rows,
  columns,
  filename,
  label = "CSV",
  className,
  size = "sm",
}: Props<T>) {
  const handleClick = () => {
    const csv = rowsToCsv(rows, columns);
    triggerCsvDownload(csv, filename);
  };
  const disabled = rows.length === 0;
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
        disabled
          ? "No rows to export"
          : `Download ${rows.length} row${rows.length === 1 ? "" : "s"} as CSV`
      }
    >
      <Download className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {label}
    </button>
  );
}
