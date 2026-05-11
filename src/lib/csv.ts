/**
 * Tiny CSV helpers for the dashboard's "Download CSV" buttons. We
 * keep this client-side and dependency-free — Recharts/Tailwind
 * already weigh enough.
 */

export interface CsvColumn<T> {
  key: keyof T | string;
  header: string;
  /** Optional formatter. Receives the raw row value and the row,
   *  returns a stringy cell value (numbers will be passed through
   *  toFixed/locale rendering by the caller as needed). */
  format?: (value: unknown, row: T) => string | number | null | undefined;
}

function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // RFC 4180: quote when the cell contains comma, quote, or newline.
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw =
          c.format !== undefined
            ? c.format((row as Record<string, unknown>)[c.key as string], row)
            : (row as Record<string, unknown>)[c.key as string];
        return escapeCell(raw as string | number | null | undefined);
      })
      .join(",")
  );
  return [header, ...body].join("\n") + "\n";
}

export function triggerCsvDownload(csv: string, filename: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
