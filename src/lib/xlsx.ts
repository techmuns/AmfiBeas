/**
 * Excel (.xlsx) export helpers — the spreadsheet counterpart to lib/csv.ts.
 *
 * Reuses CsvColumn<T> so a table can feed the SAME column definitions to either
 * the CSV or the Excel button. SheetJS (`xlsx`) is heavy, so it is loaded with a
 * dynamic import() inside downloadXlsx (invoked from a click handler) and
 * code-split out of the initial page bundle.
 *
 * Cell values are resolved exactly like rowsToCsv — column.format, else raw key
 * access — but numbers are kept as numbers so Excel cells stay numeric and
 * sortable rather than text.
 */
import type { CsvColumn } from "@/lib/csv";

type Cell = string | number | boolean | null;

function cellValue<T>(row: T, col: CsvColumn<T>): Cell {
  const raw =
    col.format !== undefined
      ? col.format((row as Record<string, unknown>)[col.key as string], row)
      : (row as Record<string, unknown>)[col.key as string];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw;
  return String(raw);
}

/** Header row + one array per data row, ready for XLSX.utils.aoa_to_sheet. */
export function rowsToAoa<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[]
): Cell[][] {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => cellValue(row, c)));
  return [header, ...body];
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build a single-sheet workbook from rows + columns and download it as .xlsx.
 * No-op during SSR (guarded on `window`); `xlsx` is imported on demand.
 */
export async function downloadXlsx<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  filename: string,
  sheetName = "Sheet1"
): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet(rowsToAoa(rows, columns));
  const workbook = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and forbids a handful of characters.
  const safeName =
    sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1";
  XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  const data = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  triggerDownload(
    new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
  );
}
