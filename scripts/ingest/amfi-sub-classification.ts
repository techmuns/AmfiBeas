import * as XLSX from "xlsx";
import {
  fetchBuffer,
  info,
  nowIso,
  parseNumberLoose,
  warn,
  writeSnapshot,
} from "./utils";
import type {
  OtherSchemesAmcRow,
  OtherSchemesMonthlySnapshot,
} from "../../src/data/snapshots/types";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface MonthSpec {
  mon: string;
  yy: string;
  key: string;
}

function recentMonths(n: number): MonthSpec[] {
  const out: MonthSpec[] = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mon = MONTH_ABBR[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ mon, yy, key });
  }
  return out;
}

function urlsForMonth(mon: string, yy: string): string[] {
  return [
    `https://portal.amfiindia.com/spages/Sub-classification-${mon}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/Sub-classification-${mon.toLowerCase()}${yy}.xlsx`,
  ];
}

interface ParsedRow {
  amcName: string;
  totalAum: number;
  schemes: number;
}

interface ParseResult {
  rows: ParsedRow[];
  structure: string[];
}

function parseSubClassification(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const structure: string[] = [`sheets: ${wb.SheetNames.join(" | ")}`];
  const out: ParsedRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    structure.push(`[${sheetName}] ${rows.length} rows`);

    if (sheetName === wb.SheetNames[0]) {
      for (let i = 0; i < Math.min(8, rows.length); i++) {
        const preview = rows[i]
          .slice(0, 8)
          .map((c) => String(c ?? "").slice(0, 28))
          .join(" | ");
        structure.push(`  row ${i}: ${preview}`);
      }
    }

    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i].map((c) => String(c ?? "").toLowerCase());
      const hasAmcCol = r.some((c) =>
        /amc|fund\s*house|mutual\s*fund/.test(c)
      );
      const hasAumCol = r.some((c) => /aum|asset/.test(c));
      const hasSchemeCol = r.some((c) => /scheme/.test(c));
      if (hasAmcCol && (hasAumCol || hasSchemeCol)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const headers = rows[headerIdx].map((c) => String(c ?? "").toLowerCase());
    const amcIdx = headers.findIndex((c) =>
      /amc|fund\s*house|mutual\s*fund/.test(c)
    );
    let aumIdx = headers.findIndex((c) =>
      /(total.*aum|aum.*total|grand\s*total|total\s*\(?(rs|inr|₹))/.test(c)
    );
    if (aumIdx === -1) aumIdx = headers.findIndex((c) => /aum|asset/.test(c));
    const schemeIdx = headers.findIndex((c) =>
      /(no.*scheme|scheme.*count|total.*scheme)/.test(c)
    );

    structure.push(
      `  → header at row ${headerIdx}: AMC col ${amcIdx}, AUM col ${aumIdx}, Schemes col ${schemeIdx}`
    );
    if (amcIdx === -1 || aumIdx === -1) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const amcName = String(rows[i][amcIdx] ?? "").trim();
      if (!amcName) continue;
      if (/^(total|grand\s*total|sub\s*total)\b/i.test(amcName)) continue;
      const aum = parseNumberLoose(rows[i][aumIdx]);
      if (aum === null || aum <= 0) continue;
      const schemes =
        schemeIdx !== -1 ? parseNumberLoose(rows[i][schemeIdx]) ?? 0 : 0;
      out.push({ amcName, totalAum: aum, schemes });
    }
    if (out.length) break;
  }

  return { rows: out, structure };
}

export async function ingestAmfiSubClassification(): Promise<void> {
  const months = recentMonths(12);
  const snapshotRows: OtherSchemesAmcRow[] = [];
  let firstStructureLogged = false;

  for (const m of months) {
    const urls = urlsForMonth(m.mon, m.yy);
    let success = false;
    for (const url of urls) {
      try {
        info(`sub-classification: ${url}`);
        const buf = await fetchBuffer(url);
        const { rows, structure } = parseSubClassification(buf);
        info(`  → parsed ${rows.length} AMC rows for ${m.key}`);
        if (!firstStructureLogged) {
          info(`  file structure (first month):\n${structure.map((s) => `    ${s}`).join("\n")}`);
          firstStructureLogged = true;
        }
        for (const r of rows) {
          snapshotRows.push({
            amcName: r.amcName,
            month: m.key,
            totalAum: r.totalAum,
            schemes: r.schemes,
          });
        }
        success = true;
        break;
      } catch (err) {
        warn(`  ${url} → ${(err as Error).message}`);
      }
    }
    if (!success) {
      info(`sub-classification: no file for ${m.key}`);
    }
  }

  if (snapshotRows.length === 0) {
    warn("sub-classification: no rows parsed — keeping previous snapshot");
    return;
  }

  const monthsCovered = Array.from(
    new Set(snapshotRows.map((r) => r.month))
  ).sort();
  const amcsCovered = new Set(snapshotRows.map((r) => r.amcName)).size;
  info(
    `sub-classification: ${snapshotRows.length} rows · ${monthsCovered.length} months · ${amcsCovered} AMCs · range ${monthsCovered[0]}…${monthsCovered[monthsCovered.length - 1]}`
  );

  const snapshot: OtherSchemesMonthlySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source:
        "https://portal.amfiindia.com/spages/Sub-classification-{Mon}{YY}.xlsx",
      notes:
        "Per-AMC AUM for the SEBI 'Other Schemes' category (Index Funds, ETFs, FoFs, Solution-oriented). Subset of total industry AUM.",
    },
    rows: snapshotRows,
  };
  await writeSnapshot("other-schemes-monthly.json", snapshot);
  info("wrote other-schemes-monthly.json");
}
