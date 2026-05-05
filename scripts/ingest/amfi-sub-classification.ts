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
  OtherSchemesMonthlyRow,
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
  category: string;
  schemes: number;
  folios: number;
  fundsMobilized: number;
  redemption: number;
  netFlow: number;
  aum: number;
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
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i].map((c) => String(c ?? "").toLowerCase());
      const hasName = r.some((c) => /scheme\s*name/.test(c));
      const hasAum = r.some((c) => /asset|aum/.test(c));
      if (hasName && hasAum) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const headers = rows[headerIdx].map((c) => String(c ?? "").toLowerCase());
    const nameIdx = headers.findIndex((c) => /scheme\s*name/.test(c));
    const schemesIdx = headers.findIndex((c) =>
      /no\.?\s*of\s*scheme|number\s*of\s*scheme/.test(c)
    );
    const foliosIdx = headers.findIndex((c) =>
      /no\.?\s*of\s*folio|number\s*of\s*folio/.test(c)
    );
    const mobilizedIdx = headers.findIndex((c) => /funds?\s*mobil/.test(c));
    const redemptionIdx = headers.findIndex((c) =>
      /repurchase|redemption/.test(c)
    );
    const netIdx = headers.findIndex((c) =>
      /net\s*inflow|net\s*outflow/.test(c)
    );
    const aumIdx = headers.findIndex((c) => /assets?\s*under|aum/.test(c));

    structure.push(
      `  → header at row ${headerIdx}: name=${nameIdx} schemes=${schemesIdx} folios=${foliosIdx} mobilized=${mobilizedIdx} redemption=${redemptionIdx} net=${netIdx} aum=${aumIdx}`
    );
    if (nameIdx === -1 || aumIdx === -1) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const name = String(rows[i][nameIdx] ?? "").trim();
      if (!name) continue;
      if (/^(other\s*scheme|total|grand\s*total|sub\s*total)\b/i.test(name))
        continue;
      const aum = parseNumberLoose(rows[i][aumIdx]);
      if (aum === null || aum <= 0) continue;
      out.push({
        category: name,
        schemes: parseNumberLoose(rows[i][schemesIdx]) ?? 0,
        folios: parseNumberLoose(rows[i][foliosIdx]) ?? 0,
        fundsMobilized: parseNumberLoose(rows[i][mobilizedIdx]) ?? 0,
        redemption: parseNumberLoose(rows[i][redemptionIdx]) ?? 0,
        netFlow: parseNumberLoose(rows[i][netIdx]) ?? 0,
        aum,
      });
    }
    if (out.length) break;
  }

  return { rows: out, structure };
}

export async function ingestAmfiSubClassification(): Promise<void> {
  const months = recentMonths(12);
  const snapshotRows: OtherSchemesMonthlyRow[] = [];
  let firstStructureLogged = false;

  for (const m of months) {
    const urls = urlsForMonth(m.mon, m.yy);
    let success = false;
    for (const url of urls) {
      try {
        info(`sub-classification: ${url}`);
        const buf = await fetchBuffer(url);
        const { rows, structure } = parseSubClassification(buf);
        info(`  → parsed ${rows.length} category rows for ${m.key}`);
        if (!firstStructureLogged) {
          info(
            `  file structure (first month):\n${structure
              .map((s) => `    ${s}`)
              .join("\n")}`
          );
          firstStructureLogged = true;
        }
        for (const r of rows) {
          snapshotRows.push({
            month: m.key,
            category: r.category,
            schemes: r.schemes,
            folios: r.folios,
            fundsMobilized: r.fundsMobilized,
            redemption: r.redemption,
            netFlow: r.netFlow,
            aum: r.aum,
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
  const categoriesCovered = new Set(snapshotRows.map((r) => r.category)).size;
  info(
    `sub-classification: ${snapshotRows.length} rows · ${monthsCovered.length} months · ${categoriesCovered} categories · range ${monthsCovered[0]}…${monthsCovered[monthsCovered.length - 1]}`
  );

  const snapshot: OtherSchemesMonthlySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source:
        "https://portal.amfiindia.com/spages/Sub-classification-{Mon}{YY}.xlsx",
      notes:
        "Per-category data for the SEBI 'Other Schemes' group V (Index Funds, ETFs, FoFs). AUM, funds mobilised, redemption, net flow in ₹ Cr.",
    },
    rows: snapshotRows,
  };
  await writeSnapshot("other-schemes-monthly.json", snapshot);
  info("wrote other-schemes-monthly.json");
}
