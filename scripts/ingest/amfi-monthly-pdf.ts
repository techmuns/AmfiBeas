/**
 * Extract industry monthly KPIs from AMFI PDFs uploaded under
 * `manual-data/amfi-monthly/pdfs/` and write
 * `src/data/snapshots/amfi-monthly-pdf.json`.
 *
 * AMFI publishes the monthly numbers in TWO different shapes:
 *
 *   1. "Monthly Report"  — per-scheme tabular table with column headers
 *      ("Net Assets Under Management as on …", "Average Net AUM for the
 *      month …"), Sub Totals (I/II/III/IV/V) per scheme category, and a
 *      Grand Total row. Carries totalAum / totalAaum / debtAum /
 *      equityAum / liquidAum / netInflow. Does NOT carry SIP figures.
 *
 *   2. "Note for Press" / "Note for the Press" press release — flat
 *      label-and-number lines with AAUM, SIP Contribution, SIP AUM,
 *      SIP Accounts, etc.
 *
 * The script auto-detects format per file and dispatches to the right
 * parser. Fields the format does not carry stay OMITTED — never zeroed.
 *
 * Behaviour invariants:
 *   - Pure read-extract-merge. Re-running with the same PDFs is
 *     idempotent (modulo `extractedAt` / `meta.generatedAt` ISO stamps).
 *   - Merge by month: a field that the new run did not detect keeps
 *     its previous value; months not in the current run are kept.
 *   - Empty `pdfs/` directory is a no-op — preserves the existing
 *     snapshot.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type {
  AmfiMonthlyPdfRow,
  AmfiMonthlyPdfSnapshot,
} from "../../src/data/snapshots/types";
import {
  info,
  nowIso,
  parseMonth,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";

const PDF_DIR = path.resolve(process.cwd(), "manual-data/amfi-monthly/pdfs");
const SNAPSHOT_FILE = "amfi-monthly-pdf.json";

type Format = "monthly-report" | "press-release" | "unknown";

interface PdfPage {
  num: number;
  text: string;
}

// -------- format detection ---------------------------------------------

/**
 * Format heuristics — anchor on the most distinctive text in each
 * publication. Monthly Report wins ties (it has more numeric ground
 * truth, so we'd rather treat ambiguous PDFs as Monthly Reports).
 */
function detectFormat(pages: PdfPage[]): Format {
  const text = pages.map((p) => p.text).join("\n");
  const monthlyReportSignals = [
    /\bMonthly\s+Report\s+for\b/i,
    /\bSub\s*Total\s*-\s*I\b/i,
    /\bGrowth\s*\/\s*Equity\s+Oriented\s+Schemes\b/i,
    /\bIncome\s*\/\s*Debt\s+Oriented\s+Schemes\b/i,
    /\bNet\s+Assets\s+Under\s+Management\s+as\s+on\b/i,
  ];
  if (monthlyReportSignals.some((re) => re.test(text))) return "monthly-report";
  const pressReleaseSignals = [
    /\bNote\s+for\s+(?:the\s+)?Press\b/i,
    /\bSIP\s+Contribution\b/i,
    /\bMonthly\s+Trends?\b/i,
  ];
  if (pressReleaseSignals.some((re) => re.test(text))) return "press-release";
  return "unknown";
}

// -------- month detection ----------------------------------------------

const MONTH_NAMES =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * Generic month + 4-digit year scanner. Crucially, this requires a
 * FOUR-digit year — that's what dropped the bug where "as on March 31,
 * 2026" was being read as "March '31" → 2031. AMFI never abbreviates
 * years to 2 digits without an apostrophe in these documents.
 */
function findMonthYear(text: string): string | null {
  const re = new RegExp(String.raw`\b` + MONTH_NAMES + String.raw`[\s\-,/]+(\d{4})\b`, "i");
  const m = re.exec(text);
  if (!m) return null;
  return parseMonth(`${m[1]} ${m[2]}`);
}

/**
 * Detect the calendar month the PDF reports on.
 * Priority order:
 *   1. "for the month of <Month> <Year>" — strongest signal, used in
 *      Monthly Report column headers and sub-titles.
 *   2. "Monthly Report for <Month>-<Year>" or "<Month>-<Year>"
 *      — Monthly Report footer title.
 *   3. Generic "<Month> <Year>" anywhere — first hit on first page.
 *   4. ISO-style filename "<YYYY>-<MM>" or "<YYYY>_<MM>".
 *   5. Generic "<Month> <Year>" anywhere on later pages.
 *
 * NEVER matches "as on <Month> 31, <Year>" as "<Month> '31" → 2031,
 * because findMonthYear requires a 4-digit year.
 */
function detectMonth(filename: string, pages: PdfPage[]): string | null {
  const allText = pages.map((p) => p.text).join("\n");

  // Priority 1: "for the month of March 2026"
  const forMonth = new RegExp(
    String.raw`for\s+the\s+month(?:\s+of)?\s+` + MONTH_NAMES + String.raw`[\s\-,/]+(\d{4})\b`,
    "i"
  );
  const forMatch = forMonth.exec(allText);
  if (forMatch) {
    const m = parseMonth(`${forMatch[1]} ${forMatch[2]}`);
    if (m) return m;
  }

  // Priority 2: "Monthly Report for March-2026" or "March-2026"
  const reportFor = new RegExp(
    String.raw`Monthly\s+Report\s+for\s+` + MONTH_NAMES + String.raw`[\s\-]+(\d{4})\b`,
    "i"
  );
  const reportMatch = reportFor.exec(allText);
  if (reportMatch) {
    const m = parseMonth(`${reportMatch[1]} ${reportMatch[2]}`);
    if (m) return m;
  }

  // Priority 3: first month + 4-digit year on the first page
  if (pages.length > 0) {
    const firstPageMonth = findMonthYear(pages[0].text);
    if (firstPageMonth) return firstPageMonth;
  }

  // Priority 4: ISO-style filename
  const stem = filename.replace(/\.[^.]+$/, "");
  const isoMatch = /(\d{4})[-_](\d{2})/.exec(stem);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) return `${isoMatch[1]}-${isoMatch[2]}`;
  }

  // Priority 5: month + year anywhere
  for (const p of pages.slice(1)) {
    const m = findMonthYear(p.text);
    if (m) return m;
  }

  return null;
}

// -------- shared numeric helpers ---------------------------------------

const NUM_TOKEN = /^-?\d[\d,]*(?:\.\d+)?$/;

function parseLooseNumber(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull all numeric tokens out of a single line. Trailing "-" cells in
 * the AMFI Monthly Report tables (segregated portfolios columns when
 * empty) are preserved as null so column indices stay aligned with
 * the table header. LEADING "-" tokens — e.g. the separator dash in a
 * label like "Sub Total - II" — are skipped so they don't shift all
 * downstream column indices by one.
 */
function numericColumns(line: string): (number | null)[] {
  const tokens = line.trim().split(/\s+/);
  const out: (number | null)[] = [];
  let started = false;
  for (const t of tokens) {
    if (t === "-" || t === "—") {
      if (started) out.push(null);
      continue;
    }
    if (NUM_TOKEN.test(t)) {
      out.push(parseLooseNumber(t));
      started = true;
    }
  }
  return out;
}

// -------- Monthly Report parser ----------------------------------------

/**
 * Monthly Report column ordering, per the AMFI table headers:
 *   0. No. of Schemes
 *   1. No. of Folios
 *   2. Funds Mobilized (₹ Cr)
 *   3. Repurchase / Redemption (₹ Cr)
 *   4. Net Inflow (+ve) / Outflow (-ve) (₹ Cr)
 *   5. Net AUM as on month-end (₹ Cr)
 *   6. Average Net AUM for the month (₹ Cr)
 *   7. No. of segregated portfolios
 *   8. Net AUM in segregated portfolio
 *
 * Sub-totals and Grand Total share this column ordering. Per-scheme
 * rows like "Liquid Fund" use the same ordering but with the label
 * inline at the start of the line.
 */
const COL_NET_INFLOW = 4;
const COL_NET_AUM = 5;
const COL_AAUM = 6;

interface MonthlyReportHits {
  totalAum?: { value: number; page: number };
  totalAaum?: { value: number; page: number };
  netInflow?: { value: number; page: number };
  equityAum?: { value: number; page: number };
  debtAum?: { value: number; page: number };
  liquidAum?: { value: number; page: number };
}

/**
 * Find the FIRST data line at or after `startIdx` whose first numeric
 * token is at index `expectedNumericIndex` of the tokenised line. We
 * use this to find the data row that follows a Sub Total / Grand Total
 * label that may span multiple lines (the formula "(i+ii+iii+...)" is
 * sometimes wrapped). Returns the columns of that row.
 */
function findDataRow(
  lines: string[],
  startIdx: number,
  /** Stop searching after this many lines past `startIdx`. */
  windowLines = 6
): (number | null)[] | null {
  for (let i = startIdx; i < Math.min(lines.length, startIdx + windowLines); i++) {
    const cols = numericColumns(lines[i]);
    // Heuristic: a real data row has at least 7 numeric/null tokens in
    // a row (schemes, folios, funds, repurchase, netInflow, netAum,
    // aaum). Lines like "(i+ii+iii+...)" decompose to 0 numeric tokens.
    if (cols.length >= 7 && lines[i].trim().length > 0) {
      // Reject lines that are clearly the formula "(i+ii+...)" or
      // bare scheme names — neither contains comma-separated thousand
      // groups, so an additional check on the netAum cell suffices:
      // a real netAum is a comma-formatted number > 0.
      const candidate = cols[COL_NET_AUM];
      if (candidate !== null && candidate > 0) return cols;
      // Some Sub Totals have segregatedPortfolios=- so cols[7]/[8] are
      // null but we still want them. The data-row check above already
      // accepts that.
      if (cols.length >= 9) return cols;
    }
  }
  return null;
}

function parseMonthlyReport(pages: PdfPage[]): {
  hits: MonthlyReportHits;
  pagesUsed: Set<number>;
} {
  const hits: MonthlyReportHits = {};
  const pagesUsed = new Set<number>();

  // Match the row labels we care about. For block-style sub totals,
  // the label sits on its own line(s) and the data row comes 1-3 lines
  // later. For the Liquid Fund / Active Equity rows, the label and
  // data are on the SAME line, with the label prefixed by a roman
  // numeral.
  const blockLabels: { key: keyof MonthlyReportHits; re: RegExp }[] = [
    {
      key: "debtAum",
      re: /^\s*Sub\s*Total\s*-\s*I\b(?!\s*[IV])/i, // Sub Total - I, NOT II/III/IV
    },
    {
      key: "equityAum",
      re: /^\s*Sub\s*Total\s*-\s*II\b(?!\s*[IV])/i,
    },
    {
      key: "totalAum",
      re: /^\s*Grand\s+Total\b/i,
    },
  ];

  // Inline rows: label and numbers on the same line.
  const inlineLabels: {
    key: keyof MonthlyReportHits;
    re: RegExp;
    targetCol: number;
  }[] = [
    {
      key: "liquidAum",
      // "ii Liquid Fund 42 27,19,972 4,55,110.25 ..."
      re: /\bLiquid\s+Fund\b/i,
      targetCol: COL_NET_AUM,
    },
  ];

  for (const page of pages) {
    const lines = page.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Block labels. The data row may be either:
      //   - INLINE on the same line as the label (most rows, e.g.
      //     "Sub Total - II (i+ii+...) 568 ... 31,97,698.15 ..."
      //     and "Grand Total 1958 ... 73,73,376.98 ..."), or
      //   - 1-3 lines below the label when the formula breaks across
      //     lines (e.g. Sub Total - I has 16 sub-items and overflows).
      // findDataRow accepts both because we start at the label line.
      for (const spec of blockLabels) {
        if (!hits[spec.key] && spec.re.test(line)) {
          const dataCols = findDataRow(lines, i, 6);
          if (dataCols) {
            const aum = dataCols[COL_NET_AUM];
            if (aum !== null && aum > 0) {
              hits[spec.key] = { value: aum, page: page.num };
              pagesUsed.add(page.num);
            }
            // Grand Total carries totalAaum and netInflow too.
            if (spec.key === "totalAum") {
              const aaum = dataCols[COL_AAUM];
              const netInflow = dataCols[COL_NET_INFLOW];
              if (aaum !== null && aaum > 0 && !hits.totalAaum) {
                hits.totalAaum = { value: aaum, page: page.num };
              }
              if (netInflow !== null && !hits.netInflow) {
                hits.netInflow = { value: netInflow, page: page.num };
              }
            }
          }
        }
      }

      // Inline labels (data on the same line as the label).
      for (const spec of inlineLabels) {
        if (!hits[spec.key] && spec.re.test(line)) {
          const cols = numericColumns(line);
          // For inline rows the row label may consume 1-2 leading
          // tokens (roman numeral, scheme name); the numeric columns
          // start whenever the first numeric token appears.
          if (cols.length >= 7) {
            const aum = cols[spec.targetCol];
            if (aum !== null && aum > 0) {
              hits[spec.key] = { value: aum, page: page.num };
              pagesUsed.add(page.num);
            }
          }
        }
      }
    }
  }

  return { hits, pagesUsed };
}

// -------- Press Release parser -----------------------------------------

interface PressReleaseLabelSpec {
  field: keyof Pick<
    AmfiMonthlyPdfRow,
    | "totalAum"
    | "totalAaum"
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
  /** "cr" → ₹ Cr (number, possibly with comma group separators).
   *  "count" → integer count.
   *  "lakh" → input is in lakh; converted to count by ×100,000. */
  kind: "cr" | "count" | "lakh";
}

const NUM = String.raw`([0-9][0-9,]*\.?[0-9]*)`;
const NEAR_NUM = String.raw`(?:[^\n]{0,160}?)` + NUM;

const PRESS_RELEASE_PATTERNS: PressReleaseLabelSpec[] = [
  {
    field: "totalAaum",
    patterns: [
      new RegExp(
        String.raw`Average\s+Assets\s+Under\s+Management[^\n]{0,80}?` + NUM,
        "i"
      ),
      new RegExp(String.raw`\bAAUM\b[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "totalAum",
    patterns: [
      new RegExp(String.raw`Industry\s+(?:Total\s+)?AUM[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Total\s+AUM[^\n]{0,80}?` + NUM, "i"),
      new RegExp(String.raw`Net\s+AUM[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "equityAum",
    patterns: [
      new RegExp(
        String.raw`Equity[\s\-]+Oriented(?:\s+Schemes)?[^\n]{0,80}?` + NUM,
        "i"
      ),
      new RegExp(String.raw`Equity\s+Schemes[^\n]{0,80}?` + NUM, "i"),
    ],
    kind: "cr",
  },
  {
    field: "activeEquityAum",
    patterns: [new RegExp(String.raw`Active\s+Equity[^\n]{0,80}?` + NUM, "i")],
    kind: "cr",
  },
  {
    field: "debtAum",
    patterns: [
      new RegExp(
        String.raw`Debt[\s\-]+Oriented(?:\s+Schemes)?[^\n]{0,80}?` + NUM,
        "i"
      ),
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
    patterns: [new RegExp(String.raw`SIP\s+AUM[^\n]{0,80}?` + NUM, "i")],
    kind: "cr",
  },
  {
    field: "sipAccounts",
    patterns: [
      new RegExp(
        String.raw`(?:No\.?\s+of\s+)?SIP\s+Accounts(?:[^\n]{0,40}\bin\s+lakh\b)` +
          NEAR_NUM,
        "i"
      ),
      new RegExp(String.raw`(?:No\.?\s+of\s+)?SIP\s+Accounts[^\n]{0,80}?` + NUM, "i"),
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

interface PressReleaseHits {
  [field: string]: { value: number; page: number };
}

function parsePressRelease(pages: PdfPage[]): {
  hits: PressReleaseHits;
  pagesUsed: Set<number>;
} {
  const hits: PressReleaseHits = {};
  const pagesUsed = new Set<number>();

  for (const page of pages) {
    for (const spec of PRESS_RELEASE_PATTERNS) {
      if (hits[spec.field]) continue;
      for (const re of spec.patterns) {
        const m = re.exec(page.text);
        if (!m) continue;
        // sipAccounts has a (in lakh) variant — switch scaling locally.
        const localKind: PressReleaseLabelSpec["kind"] =
          spec.field === "sipAccounts" && /\blakh\b/i.test(m[0])
            ? "lakh"
            : spec.kind;
        const cleaned = m[1].replace(/,/g, "");
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n <= 0) continue;
        const value =
          localKind === "lakh"
            ? Math.round(n * 100_000)
            : localKind === "count"
              ? Math.round(n)
              : n;
        hits[spec.field] = { value, page: page.num };
        pagesUsed.add(page.num);
        break;
      }
    }
  }

  return { hits, pagesUsed };
}

// -------- top-level extraction -----------------------------------------

interface ExtractedRow {
  row: AmfiMonthlyPdfRow;
}

async function extractFromPdf(pdfPath: string): Promise<ExtractedRow | null> {
  const filename = path.basename(pdfPath);
  const buffer = await fs.readFile(pdfPath);

  let pages: PdfPage[];
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

  const format = detectFormat(pages);
  const row: AmfiMonthlyPdfRow = {
    month,
    sourceFormat: format,
    sourcePdf: filename,
    sourcePages: [],
    extractedAt: nowIso(),
  };

  let pagesUsed = new Set<number>();
  let hitCount = 0;

  if (format === "monthly-report") {
    const { hits, pagesUsed: pu } = parseMonthlyReport(pages);
    pagesUsed = pu;
    for (const [field, hit] of Object.entries(hits)) {
      if (!hit) continue;
      (row as unknown as Record<string, number>)[field] = hit.value;
      hitCount += 1;
    }
  } else if (format === "press-release") {
    const { hits, pagesUsed: pu } = parsePressRelease(pages);
    pagesUsed = pu;
    for (const [field, hit] of Object.entries(hits)) {
      (row as unknown as Record<string, number>)[field] = hit.value;
      hitCount += 1;
    }
  }

  row.sourcePages = Array.from(pagesUsed).sort((a, b) => a - b);

  if (hitCount === 0) {
    warn(
      `amfi-monthly-pdf: ${filename}: format=${format}, month=${month} — no labelled values matched`
    );
  } else {
    info(
      `amfi-monthly-pdf: ${filename}: format=${format}, month=${month}, fields=${hitCount}, pages=${row.sourcePages.join(",") || "-"}`
    );
  }

  return { row };
}

// -------- merge + write ------------------------------------------------

const NUMERIC_FIELDS: (keyof AmfiMonthlyPdfRow)[] = [
  "totalAum",
  "totalAaum",
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
 * Merge by month. Numeric fields PRESENT on `next` overwrite; numeric
 * fields ABSENT on `next` keep their `prev` value (so a Monthly Report
 * run does not blank previously-captured SIP figures, and vice versa).
 * Provenance fields always come from the latest extraction.
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
  for (const pdfPath of pdfs) {
    const result = await extractFromPdf(pdfPath);
    if (!result) continue;
    processed += 1;
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
      notes: `Industry-level monthly KPIs extracted from manually-uploaded AMFI PDFs. Auto-detects Monthly Report vs press release per file. Optional fields are OMITTED when not detected — never zeroed. Rows merged by month; prior values preserved when the latest PDF doesn't carry them. processedPdfs=${processed} / ${pdfs.length}, totalRows=${rows.length}.`,
    },
    rows,
  };

  await writeSnapshot(SNAPSHOT_FILE, snapshot);
  info(
    `amfi-monthly-pdf: wrote ${rows.length} row(s) to src/data/snapshots/${SNAPSHOT_FILE} from ${processed}/${pdfs.length} PDFs`
  );
}

// Entry point when run via `npm run ingest:amfi-pdf`. ESM-safe self-
// detection: only run when this file is the script's main entry, not
// when imported.
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
