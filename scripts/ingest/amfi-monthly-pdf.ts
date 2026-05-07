/**
 * Extract industry monthly KPIs from AMFI PDFs that the user uploads
 * under `manual-data/amfi-monthly/pdfs/`. Writes the result to
 * `src/data/snapshots/amfi-monthly-pdf.json`.
 *
 * Design notes:
 *   - Pure read-extract-merge. Never overwrites a previously-known value
 *     with a guess: a field that the current PDF does not match is
 *     OMITTED from the new row, and the merge step (`mergeRow`) keeps
 *     the prior value rather than blanking it.
 *   - Per-page text scanning. For each numeric field we try a list of
 *     label patterns; the first that matches on a page wins, and the
 *     page number is recorded in `sourcePages`.
 *   - `month` resolution order: text on the PDF first page that matches
 *     a month-name + year, then the filename, then the next-best month
 *     hit anywhere in the doc.
 *   - Idempotent. Running twice with the same PDFs produces the same
 *     output (modulo `extractedAt` and `meta.generatedAt` ISO stamps).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type { AmfiMonthlyPdfRow, AmfiMonthlyPdfSnapshot } from "../../src/data/snapshots/types";
import { info, nowIso, parseMonth, readSnapshot, warn, writeSnapshot } from "./utils";

const PDF_DIR = path.resolve(process.cwd(), "manual-data/amfi-monthly/pdfs");
const SNAPSHOT_FILE = "amfi-monthly-pdf.json";

/**
 * One numeric KPI we try to extract. `patterns` is an ordered list — the
 * first that matches a page wins. Each pattern must include a single
 * capture group for the number itself (₹ Cr or count, see `kind`).
 *
 * Patterns are intentionally tolerant: AMFI rewords labels across months,
 * and PDF text extraction can drop or duplicate whitespace. We anchor on
 * keywords plus a number that follows on the same or next "line" (the
 * pdf-parse output uses \n between visual lines).
 */
interface LabelSpec {
  field: keyof Pick<
    AmfiMonthlyPdfRow,
    | "totalAum"
    | "equityAum"
    | "activeEquityAum"
    | "debtAum"
    | "liquidAum"
    | "sipContribution"
    | "sipAum"
    | "sipAccounts"
    | "netInflow"
  >;
  patterns: RegExp[];
  /** "cr" → ₹ Cr (numeric, possibly with comma group separators).
   *  "count" → integer count (SIP accounts).
   *  "lakh" → input is in lakh; converted to count by ×100,000. */
  kind: "cr" | "count" | "lakh";
}

const NUM = String.raw`([0-9][0-9,]*\.?[0-9]*)`;
const NEAR_NUM = String.raw`(?:[^\n]{0,160}?)` + NUM;

const LABEL_PATTERNS: LabelSpec[] = [
  {
    field: "totalAum",
    patterns: [
      new RegExp(String.raw`Average\s+Assets\s+Under\s+Management[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`\bAAUM\b[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Industry\s+(?:Total\s+)?AUM[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Total\s+AUM[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "equityAum",
    patterns: [
      new RegExp(String.raw`Equity[\s\-]+Oriented(?:\s+Schemes)?[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Equity\s+Schemes[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "activeEquityAum",
    patterns: [
      new RegExp(String.raw`Active\s+Equity[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "debtAum",
    patterns: [
      new RegExp(String.raw`Debt[\s\-]+Oriented(?:\s+Schemes)?[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Debt\s+Schemes[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "liquidAum",
    patterns: [
      new RegExp(String.raw`Liquid\s*/\s*Money\s*Market[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`\bLiquid(?:\s+Schemes)?\b[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "sipContribution",
    patterns: [
      new RegExp(String.raw`SIP\s+Contribution[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Monthly\s+SIP(?:\s+Contribution)?[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "sipAum",
    patterns: [
      new RegExp(String.raw`SIP\s+AUM[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "sipAccounts",
    patterns: [
      // "No. of SIP Accounts (in lakh) — 12,345.67"
      new RegExp(
        String.raw`(?:No\.?\s+of\s+)?SIP\s+Accounts(?:[^\n]{0,40}\bin\s+lakh\b)` + NEAR_NUM,
        "i"
      ),
      // Count form: "No. of SIP Accounts: 12,34,56,789"
      new RegExp(
        String.raw`(?:No\.?\s+of\s+)?SIP\s+Accounts[^\n]{0,80}?` + NUM,
        "i"
      ),
    ],
    kind: "count",
  },
  {
    field: "netInflow",
    patterns: [
      new RegExp(String.raw`Net\s+Inflow\s*\/\s*Outflow[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Total\s+Net\s+Inflow[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
];

function parseLooseNumber(raw: string, kind: LabelSpec["kind"]): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (kind === "lakh") return Math.round(n * 100_000);
  if (kind === "count") return Math.round(n);
  return n;
}

interface PageHit {
  field: LabelSpec["field"];
  value: number;
  page: number;
}

function scanPage(pageText: string, pageNum: number): PageHit[] {
  const hits: PageHit[] = [];
  for (const spec of LABEL_PATTERNS) {
    let matched: number | null = null;
    let kind = spec.kind;
    for (const re of spec.patterns) {
      const m = re.exec(pageText);
      if (m) {
        // The "(in lakh)" pattern for sipAccounts is the only one that
        // changes scaling — detect that by looking for "lakh" in the
        // matched substring and switch kind locally.
        const localKind: LabelSpec["kind"] =
          spec.field === "sipAccounts" && /\blakh\b/i.test(m[0])
            ? "lakh"
            : spec.kind;
        const num = parseLooseNumber(m[1], localKind);
        if (num !== null && num > 0) {
          matched = num;
          kind = localKind;
          break;
        }
      }
    }
    if (matched !== null) {
      hits.push({ field: spec.field, value: matched, page: pageNum });
      void kind; // (kept for grep — final value already scaled)
    }
  }
  return hits;
}

/**
 * Detect the calendar month the PDF reports on. We try (in order):
 *   1. Month-name + year on the first page (typical AMFI press release
 *      header: "Note for Press 9 May 2025").
 *   2. Filename: tokens like "april-2025", "2025-04", "apr_2025".
 *   3. Any month-name + year occurrence anywhere in the doc as fallback.
 */
function detectMonth(filename: string, pages: { num: number; text: string }[]): string | null {
  const monthRe =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s\-,]+(?:'?(\d{2})|(\d{4}))\b/i;

  const tryText = (text: string): string | null => {
    const m = monthRe.exec(text);
    if (!m) return null;
    const yearRaw = m[3] ?? m[2];
    return parseMonth(`${m[1]} ${yearRaw}`);
  };

  if (pages.length > 0) {
    const fromFirstPage = tryText(pages[0].text);
    if (fromFirstPage) return fromFirstPage;
  }

  // Filename: "amfi-april-2025.pdf", "Note-Press-Apr-2025.pdf",
  // "amfi-2025-04.pdf", "AMFI_2025_04.pdf"
  const stem = filename.replace(/\.[^.]+$/, "");
  const isoMatch = /(\d{4})[-_](\d{2})/.exec(stem);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  const fromName = tryText(stem.replace(/[-_]/g, " "));
  if (fromName) return fromName;

  for (const p of pages.slice(1)) {
    const m = tryText(p.text);
    if (m) return m;
  }
  return null;
}

interface ExtractedRow {
  row: AmfiMonthlyPdfRow;
  source: string;
}

async function extractFromPdf(pdfPath: string): Promise<ExtractedRow | null> {
  const filename = path.basename(pdfPath);
  const buffer = await fs.readFile(pdfPath);
  let pages: { num: number; text: string }[];
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    pages = result.pages.map((p) => ({ num: p.num, text: p.text ?? "" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`amfi-monthly-pdf: ${filename}: pdf-parse failed — ${msg}`);
    return null;
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const month = detectMonth(filename, pages);
  if (!month) {
    warn(
      `amfi-monthly-pdf: ${filename}: could not infer month from text or filename — skipped`
    );
    return null;
  }

  // First-hit-per-field across pages. Earlier pages win, so the
  // headline summary table (typically page 1 or 2) takes priority over
  // detailed annexures that may have similarly-labelled but different
  // numbers later in the doc.
  const fieldHits: Partial<Record<LabelSpec["field"], PageHit>> = {};
  for (const page of pages) {
    const hits = scanPage(page.text, page.num);
    for (const h of hits) {
      if (!fieldHits[h.field]) fieldHits[h.field] = h;
    }
  }

  const sourcePages = Array.from(
    new Set(Object.values(fieldHits).map((h) => h!.page))
  ).sort((a, b) => a - b);

  const row: AmfiMonthlyPdfRow = {
    month,
    sourcePdf: filename,
    sourcePages,
    extractedAt: nowIso(),
  };
  for (const [field, hit] of Object.entries(fieldHits) as [
    LabelSpec["field"],
    PageHit,
  ][]) {
    (row as unknown as Record<string, number>)[field] = hit.value;
  }

  if (sourcePages.length === 0) {
    warn(
      `amfi-monthly-pdf: ${filename}: month=${month} but no labelled values matched — row written with provenance only`
    );
  } else {
    info(
      `amfi-monthly-pdf: ${filename}: month=${month}, fields=${
        Object.keys(fieldHits).length
      }, pages=${sourcePages.join(",")}`
    );
  }

  return { row, source: filename };
}

const NUMERIC_FIELDS: (keyof AmfiMonthlyPdfRow)[] = [
  "totalAum",
  "equityAum",
  "activeEquityAum",
  "debtAum",
  "liquidAum",
  "sipContribution",
  "sipAum",
  "sipAccounts",
  "netInflow",
];

/**
 * Merge the freshly-extracted row into a prior row for the same month.
 * Only fields that are PRESENT on `next` overwrite — fields that are
 * absent on `next` keep whatever `prev` had. This preserves history when
 * a later PDF has fewer labelled values than an earlier one. Provenance
 * fields (sourcePdf / sourcePages / extractedAt) always come from the
 * latest extraction.
 */
function mergeRow(
  prev: AmfiMonthlyPdfRow | undefined,
  next: AmfiMonthlyPdfRow
): AmfiMonthlyPdfRow {
  if (!prev) return next;
  const merged: AmfiMonthlyPdfRow = { ...prev, ...next };
  for (const field of NUMERIC_FIELDS) {
    const nv = next[field];
    const pv = prev[field];
    if (typeof nv !== "number" && typeof pv === "number") {
      (merged as unknown as Record<string, number>)[field] = pv;
    }
  }
  return merged;
}

async function listPdfs(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`amfi-monthly-pdf: cannot read ${dir}: ${msg}`);
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function ingestAmfiMonthlyPdf(): Promise<void> {
  const pdfs = await listPdfs(PDF_DIR);
  if (pdfs.length === 0) {
    info(`amfi-monthly-pdf: no PDFs in ${PDF_DIR} — preserving prior snapshot`);
    return;
  }

  const prior = await readSnapshot<AmfiMonthlyPdfSnapshot>(SNAPSHOT_FILE);
  const priorByMonth = new Map<string, AmfiMonthlyPdfRow>();
  for (const r of prior?.rows ?? []) priorByMonth.set(r.month, r);

  let processed = 0;
  let parsedFields = 0;
  for (const pdfPath of pdfs) {
    const result = await extractFromPdf(pdfPath);
    if (!result) continue;
    processed += 1;
    parsedFields += result.row.sourcePages.length;
    const merged = mergeRow(priorByMonth.get(result.row.month), result.row);
    priorByMonth.set(result.row.month, merged);
  }

  const rows = Array.from(priorByMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  const snapshot: AmfiMonthlyPdfSnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: "manual-data/amfi-monthly/pdfs/",
      notes: `Industry-level monthly KPIs extracted from manually-uploaded AMFI PDFs. Optional fields are OMITTED when not detected — never zeroed. Rows merged by month; prior values preserved when the latest PDF doesn't carry them. processedPdfs=${processed} / ${pdfs.length}, totalRows=${rows.length}, totalFieldHits=${parsedFields}.`,
    },
    rows,
  };

  await writeSnapshot(SNAPSHOT_FILE, snapshot);
  info(
    `amfi-monthly-pdf: wrote ${rows.length} row(s) to src/data/snapshots/${SNAPSHOT_FILE} from ${processed}/${pdfs.length} PDFs`
  );
}

// Entry point when run via `npm run ingest:amfi-pdf`. The export above is
// kept so this step can also be plugged into the main `ingest` chain
// later without re-running the IIFE. ESM-safe self-detection via
// `import.meta.url` — `process.argv[1]` is the path tsx invoked.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (invokedDirectly) {
  ingestAmfiMonthlyPdf().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ingest][fatal] amfi-monthly-pdf: ${msg}\n`);
    process.exit(1);
  });
}
