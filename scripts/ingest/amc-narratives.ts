/**
 * AMC Narrative ingest.
 *
 * Reads every `<slug>-<period>.json` from
 * `manual-data/amc-narratives/extracted/`, validates each against the
 * schema described in `manual-data/amc-narratives/README.md`, dedupes by
 * (slug, period), and writes the consolidated snapshot to
 * `src/data/snapshots/amc-narratives.json`.
 *
 * Run with:
 *   npm run ingest:amc-narratives
 *
 * Stays intentionally simple — pure file-system walk + JSON parse + write.
 * No PDF parsing here; analyst transcribes each PDF into the matching
 * JSON file under `extracted/` manually.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXTRACTED_DIR = path.resolve(ROOT, "manual-data/amc-narratives/extracted");
const PDF_DIR = path.resolve(ROOT, "manual-data/amc-narratives/pdfs");
const SNAPSHOT_PATH = path.resolve(
  ROOT,
  "src/data/snapshots/amc-narratives.json"
);

const KNOWN_SLUGS = new Set([
  "hdfc",
  "icici-pru",
  "nippon",
  "absl",
  "uti",
  "canara-robeco",
]);

const PERIOD_RX = /^FY(\d{2})-Q([1-4])$/;

const KNOWN_THEME_CATEGORIES = new Set([
  "growth",
  "margins",
  "regulatory",
  "strategy",
  "risk",
  "cost",
]);

const KNOWN_EVENT_TYPES = new Set([
  "mandate_win",
  "fund_launch",
  "board_change",
  "international",
  "regulatory",
  "technology",
  "partnership",
]);

function warn(msg: string) {
  console.warn(`[ingest:amc-narratives] ${msg}`);
}

function info(msg: string) {
  console.log(`[ingest:amc-narratives] ${msg}`);
}

interface RowShape {
  amcSlug: string;
  fiscalPeriod: string;
  callDate?: string | null;
  sourcePdf: string;
  themes: Array<{
    category: string;
    headline: string;
    detail?: string;
    metricRef?: string;
  }>;
  metrics: Array<{
    field: string;
    value: number | null;
    unit: string;
  }>;
  channelMix?: {
    directPct?: number | null;
    bankPct?: number | null;
    nationalDistPct?: number | null;
    mfdPct?: number | null;
    fintechPct?: number | null;
    note?: string;
  };
  events: Array<{ type: string; label: string; impactBps?: number }>;
  quotes: Array<{ text: string; speaker?: string }>;
  initiatives: string[];
}

function validate(raw: unknown, filename: string): RowShape | null {
  if (!raw || typeof raw !== "object") {
    warn(`${filename}: not an object — skipped`);
    return null;
  }
  const r = raw as Partial<RowShape>;
  if (!r.amcSlug || !KNOWN_SLUGS.has(r.amcSlug)) {
    warn(`${filename}: unknown amcSlug '${r.amcSlug ?? "<missing>"}' — skipped`);
    return null;
  }
  if (!r.fiscalPeriod || !PERIOD_RX.test(r.fiscalPeriod)) {
    warn(
      `${filename}: bad fiscalPeriod '${r.fiscalPeriod ?? "<missing>"}' — skipped`
    );
    return null;
  }
  if (!Array.isArray(r.themes)) {
    warn(`${filename}: themes[] missing — skipped`);
    return null;
  }
  if (!Array.isArray(r.metrics)) {
    warn(`${filename}: metrics[] missing — skipped`);
    return null;
  }
  if (!Array.isArray(r.events)) {
    warn(`${filename}: events[] missing — skipped`);
    return null;
  }
  if (!Array.isArray(r.quotes)) {
    warn(`${filename}: quotes[] missing — skipped`);
    return null;
  }
  if (!Array.isArray(r.initiatives)) {
    warn(`${filename}: initiatives[] missing — skipped`);
    return null;
  }
  for (const t of r.themes) {
    if (!t.category || !KNOWN_THEME_CATEGORIES.has(t.category)) {
      warn(
        `${filename}: theme has unknown category '${t.category}' — skipped`
      );
      return null;
    }
  }
  for (const e of r.events) {
    if (!e.type || !KNOWN_EVENT_TYPES.has(e.type)) {
      warn(`${filename}: event has unknown type '${e.type}' — skipped`);
      return null;
    }
  }
  return r as RowShape;
}

function main(): void {
  if (!fs.existsSync(EXTRACTED_DIR)) {
    info(`No ${EXTRACTED_DIR} directory yet — writing empty snapshot`);
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(
      SNAPSHOT_PATH,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), rows: [] },
        null,
        2
      ) + "\n"
    );
    return;
  }
  const files = fs
    .readdirSync(EXTRACTED_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  info(`scanning ${files.length} JSON file(s) in ${EXTRACTED_DIR}`);

  const rows: RowShape[] = [];
  const seen = new Set<string>();
  let pdfMissing = 0;
  for (const file of files) {
    const fp = path.join(EXTRACTED_DIR, file);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`${file}: invalid JSON — ${msg}`);
      continue;
    }
    const r = validate(raw, file);
    if (!r) continue;
    const key = `${r.amcSlug}:${r.fiscalPeriod}`;
    if (seen.has(key)) {
      warn(`${file}: duplicate (slug, period) — skipped`);
      continue;
    }
    // Cross-check that the referenced PDF actually exists in pdfs/.
    if (r.sourcePdf && !fs.existsSync(path.join(PDF_DIR, r.sourcePdf))) {
      warn(`${file}: sourcePdf '${r.sourcePdf}' not found in pdfs/`);
      pdfMissing++;
    }
    rows.push(r);
    seen.add(key);
  }

  rows.sort((a, b) => {
    if (a.amcSlug !== b.amcSlug) return a.amcSlug.localeCompare(b.amcSlug);
    const ap = PERIOD_RX.exec(a.fiscalPeriod)!;
    const bp = PERIOD_RX.exec(b.fiscalPeriod)!;
    const ak = Number(ap[1]) * 10 + Number(ap[2]);
    const bk = Number(bp[1]) * 10 + Number(bp[2]);
    return ak - bk;
  });

  const snapshot = {
    generatedAt: new Date().toISOString(),
    rows,
  };
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  info(
    `wrote ${rows.length} row(s) to ${path.relative(ROOT, SNAPSHOT_PATH)}` +
      (pdfMissing ? ` · ${pdfMissing} sourcePdf reference(s) missing` : "")
  );
}

main();
