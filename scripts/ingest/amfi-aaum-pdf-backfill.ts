/**
 * AMFI Fundwise AAUM PDF backfill ingest.
 *
 * Parses analyst-uploaded `average-aum*.pdf` files in
 * `manual-data/amfi-quarterly/pdfs/` (AMFI's published "Average AUM"
 * report — single-page table of every AMC's AAUM for one period) and
 * MERGES the extracted rows into `src/data/snapshots/amc-aaum-quarterly.json`.
 *
 * The existing scraper (`scripts/ingest/amfi-aaum.ts`) drives the
 * AMFI website via Playwright and only fetches recent quarters. This
 * script is the offline complement: drop the PDF in the manual-data
 * folder and re-run to backfill historical year-ends.
 *
 * Run with:
 *   npx tsx scripts/ingest/amfi-aaum-pdf-backfill.ts
 *
 * Values in the PDF are in **₹ lakhs**; the snapshot stores
 * `avgAum` in **₹ crores** (matching what the scraper produces) — so
 * each value is divided by 100 on extraction.
 */

import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { amfiNameToSlug, slugifyAmfiName } from "../../src/data/amcs";

const ROOT = process.cwd();
const PDF_DIR = path.resolve(ROOT, "manual-data/amfi-quarterly/pdfs");
const SNAPSHOT_PATH = path.resolve(
  ROOT,
  "src/data/snapshots/amc-aaum-quarterly.json"
);

function info(msg: string) {
  console.log(`[ingest:amfi-aaum-pdf-backfill] ${msg}`);
}

function warn(msg: string) {
  console.warn(`[ingest:amfi-aaum-pdf-backfill] ${msg}`);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Map a "Month Year" header back to the calendar-quarter ID the
 *  existing snapshot uses (e.g. "March 2023" → "2023-Q1"). Returns
 *  null when the period header isn't recognised. */
function detectQuarterId(allText: string): string | null {
  // Prefer "for the quarter / month of <Month> <Year>" when present,
  // else fall back to the first "Month YYYY" date token anywhere in
  // the PDF. AMFI's Fundwise AAUM PDF typically embeds the period
  // header somewhere on page 1 or 2.
  const monthRx = new RegExp(
    String.raw`(?:quarter|month).{0,80}?(` +
      MONTH_NAMES.join("|") +
      String.raw`)[,\s]+(20\d{2})`,
    "i"
  );
  const m =
    monthRx.exec(allText) ??
    new RegExp(`(${MONTH_NAMES.join("|")})\\s+(20\\d{2})`, "i").exec(
      allText
    );
  if (!m) return null;
  const month = m[1];
  const year = Number(m[2]);
  // Calendar quarter: Jan/Feb/Mar → Q1, Apr/May/Jun → Q2, etc.
  const idx = MONTH_NAMES.findIndex(
    (n) => n.toLowerCase() === month.toLowerCase()
  );
  if (idx < 0) return null;
  const q = Math.floor(idx / 3) + 1;
  return `${year}-Q${q}`;
}

interface ExtractedRow {
  amcSlug: string;
  amcNameAsReported: string;
  mappingStatus: "curated" | "auto_slug";
  displayName: string;
  quarter: string;
  avgAum: number;
  source: string;
  fetchedAt: string;
  status: "ok";
  sourcePdf: string;
}

/** Parse rows from the AMFI Fundwise AAUM table. The PDF format puts
 *  each row on its own line: `<sr-no> <name…> <num1> <num2>` where
 *  num1 is "Excluding FoF-Domestic, including FoF-Overseas" (₹ lakhs)
 *  and num2 is "Fund of Funds - Domestic" (₹ lakhs). We use num1
 *  (matches what the scraper writes to avgAum). */
function parseRows(
  text: string,
  quarter: string,
  filename: string
): ExtractedRow[] {
  const fetchedAt = new Date().toISOString();
  // Normalise whitespace. AMFI's PDFs sometimes wrap rows across
  // line-breaks within the AMC name; rejoin to a single buffer first.
  const flat = text.replace(/\s+/g, " ").trim();
  // Row pattern: digit(s) "Sr No" + AMC name + two comma-separated
  // numbers. We anchor on the trailing two numbers because AMC names
  // are unpredictable.
  const rowRx =
    /(\d{1,3})\s+([A-Za-z][A-Za-z0-9 ()&.,'\-/]*?Mutual\s+Fund)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
  const rows: ExtractedRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRx.exec(flat)) !== null) {
    const name = m[2].trim();
    const aumLakhs = Number(m[3].replace(/,/g, ""));
    if (!Number.isFinite(aumLakhs)) continue;
    const aumCr = Math.round(aumLakhs) / 100; // lakhs → crore
    const curated = amfiNameToSlug(name);
    const slug = curated ?? slugifyAmfiName(name);
    rows.push({
      amcSlug: slug,
      amcNameAsReported: name,
      mappingStatus: curated ? "curated" : "auto_slug",
      displayName: name.replace(/\s+Mutual\s+Fund\s*$/i, "").trim(),
      quarter,
      avgAum: aumCr,
      source: "AMFI Fundwise AAUM PDF",
      fetchedAt,
      status: "ok",
      sourcePdf: filename,
    });
  }
  return rows;
}

async function extractFromPdf(pdfPath: string): Promise<ExtractedRow[]> {
  const filename = path.basename(pdfPath);
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  let allText = "";
  try {
    const r = await parser.getText();
    allText = r.pages.map((p) => p.text ?? "").join("\n");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  const quarter = detectQuarterId(allText);
  if (!quarter) {
    warn(`${filename}: could not detect quarter — skipped`);
    return [];
  }
  const rows = parseRows(allText, quarter, filename);
  info(`${filename}: quarter=${quarter}, parsed=${rows.length} AMCs`);
  return rows;
}

interface SnapshotRow {
  amcSlug: string;
  quarter: string;
  [k: string]: unknown;
}

async function main(): Promise<void> {
  if (!fs.existsSync(PDF_DIR)) {
    warn(`No PDF directory ${PDF_DIR}`);
    return;
  }
  const files = fs
    .readdirSync(PDF_DIR)
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".pdf") &&
        f.toLowerCase().startsWith("average-aum")
    );
  if (files.length === 0) {
    info("No average-aum*.pdf files found in manual-data/amfi-quarterly/pdfs/");
    return;
  }
  info(`Found ${files.length} backfill PDF(s)`);
  const newRows: ExtractedRow[] = [];
  for (const f of files) {
    const r = await extractFromPdf(path.join(PDF_DIR, f));
    newRows.push(...r);
  }
  if (newRows.length === 0) {
    warn("No rows extracted — snapshot unchanged");
    return;
  }
  // Load existing snapshot and merge by (slug, quarter).
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as {
    rows: SnapshotRow[];
  } & Record<string, unknown>;
  const existing = Array.isArray(raw) ? raw : raw.rows;
  const merged = new Map<string, SnapshotRow>();
  for (const r of existing as SnapshotRow[]) {
    merged.set(`${r.amcSlug}:${r.quarter}`, r);
  }
  let added = 0;
  let replaced = 0;
  for (const r of newRows) {
    const key = `${r.amcSlug}:${r.quarter}`;
    if (merged.has(key)) replaced++;
    else added++;
    merged.set(key, r as unknown as SnapshotRow);
  }
  const out = Array.from(merged.values()).sort((a, b) => {
    if (a.quarter !== b.quarter) return String(a.quarter).localeCompare(String(b.quarter));
    return String(a.amcSlug).localeCompare(String(b.amcSlug));
  });
  const payload = Array.isArray(raw)
    ? out
    : { ...raw, rows: out };
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(payload, null, 2) + "\n");
  info(
    `Wrote ${out.length} rows to ${path.relative(ROOT, SNAPSHOT_PATH)} · ${added} added · ${replaced} replaced`
  );
  // Summarise per-quarter count for sanity.
  const byQuarter = new Map<string, number>();
  for (const r of out)
    byQuarter.set(String(r.quarter), (byQuarter.get(String(r.quarter)) ?? 0) + 1);
  for (const [q, n] of [...byQuarter].sort()) {
    info(`  ${q}: ${n} AMC(s)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
