/**
 * AMFI SIP-contribution historical backfill.
 *
 * The press-release "Monthly Note" PDFs we hold only go back to
 * 2024-06, so `sipContribution` is absent before that. AMFI publishes a
 * cumulative month-wise SIP contribution table (April 2016 onward) on
 * its website; this script holds that table (transcribed) and merges it
 * into `src/data/snapshots/amfi-monthly-pdf.json`:
 *
 *   - A month-row missing `sipContribution` gets the value + provenance.
 *   - A month with no row yet (2016-04 → 2019-03) gets a new sparse row.
 *   - A month that ALREADY carries `sipContribution` (extracted from a
 *     Note) is left untouched — the Note's provenance wins.
 *
 * This is durable: the main extractor (`amfi-monthly-pdf.ts`) merges by
 * month and preserves prior field values a PDF doesn't carry, so a
 * later `npm run ingest:amfi-pdf` keeps these backfilled values.
 *
 * Each fiscal-year column is checksum-validated against the table's
 * printed "Total during FY" before anything is written.
 *
 * Run with:
 *   npx tsx scripts/ingest/amfi-sip-contribution-backfill.ts
 */

import fs from "node:fs";
import path from "node:path";
import type {
  AmfiMonthlyPdfFieldProvenance,
  AmfiMonthlyPdfRow,
  AmfiMonthlyPdfSnapshot,
} from "../../src/data/snapshots/types";

const ROOT = process.cwd();
const SNAPSHOT_PATH = path.resolve(
  ROOT,
  "src/data/snapshots/amfi-monthly-pdf.json"
);

function info(msg: string) {
  console.log(`[ingest:amfi-sip-backfill] ${msg}`);
}

/**
 * Month-wise SIP contribution (₹ crore), one entry per fiscal year in
 * April→March order, with the table's printed "Total during FY" used as
 * a checksum. Partial years carry only the months published so far.
 * Source: AMFI month-wise SIP contribution table.
 */
const FY_SIP: { startYear: number; total: number; monthly: number[] }[] = [
  { startYear: 2016, total: 43921, monthly: [3122, 3189, 3310, 3334, 3497, 3698, 3434, 3884, 3973, 4095, 4050, 4335] },
  { startYear: 2017, total: 67190, monthly: [4269, 4584, 4744, 4947, 5206, 5516, 5621, 5893, 6222, 6644, 6425, 7119] },
  { startYear: 2018, total: 92693, monthly: [6690, 7304, 7554, 7554, 7658, 7727, 7985, 7985, 8022, 8064, 8095, 8055] },
  { startYear: 2019, total: 100084, monthly: [8238, 8183, 8122, 8324, 8231, 8263, 8246, 8273, 8518, 8532, 8513, 8641] },
  { startYear: 2020, total: 96080, monthly: [8376, 8123, 7917, 7831, 7792, 7788, 7800, 7302, 8418, 8023, 7528, 9182] },
  { startYear: 2021, total: 124566, monthly: [8596, 8819, 9156, 9609, 9923, 10351, 10519, 11005, 11305, 11517, 11438, 12328] },
  { startYear: 2022, total: 155972, monthly: [11863, 12286, 12276, 12140, 12693, 12976, 13041, 13306, 13573, 13856, 13686, 14276] },
  { startYear: 2023, total: 199219, monthly: [13728, 14749, 14734, 15245, 15814, 16042, 16928, 17073, 17610, 18838, 19187, 19271] },
  { startYear: 2024, total: 289352, monthly: [20371, 20904, 21262, 23332, 23547, 24509, 25323, 25320, 26459, 26400, 25999, 25926] },
  { startYear: 2025, total: 349589, monthly: [26632, 26688, 27269, 28464, 28265, 29361, 29529, 29445, 31002, 31002, 29845, 32087] },
  { startYear: 2026, total: 31115, monthly: [31115] },
];

/**
 * Expand the fiscal-year rows into a chronological `YYYY-MM → value`
 * map. April..December map to the FY's start year; January..March to
 * the next. Throws if a year's monthly values don't sum to its printed
 * total.
 */
function buildMonthMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const fy of FY_SIP) {
    const sum = fy.monthly.reduce((s, v) => s + v, 0);
    if (sum !== fy.total) {
      throw new Error(
        `FY${fy.startYear}-${(fy.startYear + 1) % 100}: monthly sum ${sum} != printed total ${fy.total}`
      );
    }
    fy.monthly.forEach((value, i) => {
      // i 0..8 → Apr..Dec of startYear; i 9..11 → Jan..Mar of next year.
      const calMonth = i <= 8 ? i + 4 : i - 8;
      const calYear = i <= 8 ? fy.startYear : fy.startYear + 1;
      map.set(`${calYear}-${String(calMonth).padStart(2, "0")}`, value);
    });
  }
  return map;
}

function main(): void {
  const months = buildMonthMap();
  info(`${months.size} months transcribed; all fiscal-year checksums pass`);

  const raw = JSON.parse(
    fs.readFileSync(SNAPSHOT_PATH, "utf8")
  ) as AmfiMonthlyPdfSnapshot;
  const byMonth = new Map<string, AmfiMonthlyPdfRow>();
  for (const r of raw.rows) byMonth.set(r.month, r);

  const prov: AmfiMonthlyPdfFieldProvenance = {
    sourcePdf: "AMFI website — month-wise SIP contribution table",
    sourceFormat: "press-release",
    sourcePages: [],
    extractedAt: new Date().toISOString(),
    sourceLabel: "AMFI cumulative SIP contribution table (manual transcription)",
  };

  let filled = 0;
  let created = 0;
  let skipped = 0;
  for (const [month, value] of months) {
    const existing = byMonth.get(month);
    if (existing) {
      if (typeof existing.sipContribution === "number") {
        skipped += 1; // Note-extracted value wins — leave untouched.
        continue;
      }
      existing.sipContribution = value;
      existing.fieldSources = {
        ...existing.fieldSources,
        sipContribution: prov,
      };
      filled += 1;
    } else {
      byMonth.set(month, {
        month,
        sipContribution: value,
        fieldSources: { sipContribution: prov },
        sourceFormat: prov.sourceFormat,
        sourcePdf: prov.sourcePdf,
        sourcePages: prov.sourcePages,
        extractedAt: prov.extractedAt,
      });
      created += 1;
    }
  }

  const rows = Array.from(byMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  const snapshot: AmfiMonthlyPdfSnapshot = {
    meta: {
      ...raw.meta,
      generatedAt: new Date().toISOString(),
      notes:
        "Industry-level monthly KPIs from manually-uploaded AMFI PDFs, plus historical SIP contribution backfilled from the AMFI month-wise SIP table (Apr-2016 onward). Optional fields OMITTED when not detected — never zeroed. Rows merged by month.",
    },
    rows,
  };
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  info(
    `filled ${filled}, created ${created}, skipped ${skipped} (already had a value) — ${rows.length} total rows`
  );
}

main();
