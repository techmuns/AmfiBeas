"use client";

import { DownloadCsvButton } from "@/components/data/DownloadCsvButton";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

interface PeerRow {
  amcSlug: string;
  name: string;
  ticker: string | null;
  isFocused: boolean;
  avgAum: number | null;
  revenue: number | null;
  operatingProfit: number | null;
  pat: number | null;
  patMargin: number | null;
  opMargin: number | null;
  revenueYieldBps: number | null;
  opYieldBps: number | null;
  profitYieldBps: number | null;
  derivedFrom: string | null;
}

const COLUMNS: CsvColumn<PeerRow>[] = [
  { key: "name", header: "AMC" },
  { key: "ticker", header: "Ticker" },
  {
    key: "avgAum",
    header: "AAUM (Cr)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(2)) : ""),
  },
  {
    key: "revenue",
    header: "Operating revenue (Cr)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(2)) : ""),
  },
  {
    key: "operatingProfit",
    header: "Operating profit (Cr)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(2)) : ""),
  },
  {
    key: "pat",
    header: "PAT (Cr)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(2)) : ""),
  },
  {
    key: "patMargin",
    header: "PAT margin (%)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(2)) : ""),
  },
  {
    key: "opMargin",
    header: "Op margin (%)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(2)) : ""),
  },
  {
    key: "revenueYieldBps",
    header: "Revenue yield (bps)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(1)) : ""),
  },
  {
    key: "opYieldBps",
    header: "Op yield (bps)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(1)) : ""),
  },
  {
    key: "profitYieldBps",
    header: "Profit yield (bps)",
    format: (v) => (typeof v === "number" ? Number(v.toFixed(1)) : ""),
  },
  { key: "derivedFrom", header: "Derived from" },
];

interface Props {
  rows: readonly PeerRow[];
  /** Base filename; the extension is swapped per export format. */
  filename: string;
}

/**
 * Client wrapper holding the financials peer-table column definitions. Offers
 * both a CSV and a true .xlsx export of the listed-AMC fee-yield peer table
 * (revenue / operating / profit yield in bps of MF QAAUM, plus margins).
 * Server-rendered /financials passes only the serialisable rows across the
 * boundary, keeping the `format` callbacks on the client.
 */
export function FinancialsPeerExport({ rows, filename }: Props) {
  const base = filename.replace(/\.(csv|xlsx)$/i, "");
  return (
    <div className="flex items-center gap-1.5">
      <DownloadCsvButton
        rows={rows}
        columns={COLUMNS}
        filename={`${base}.csv`}
      />
      <DownloadXlsxButton
        rows={rows}
        columns={COLUMNS}
        filename={`${base}.xlsx`}
        sheetName="Peer Yields"
      />
    </div>
  );
}
