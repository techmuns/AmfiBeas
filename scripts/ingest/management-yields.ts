import * as cheerio from "cheerio";
import {
  fetchBuffer,
  fetchText,
  info,
  nowIso,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";
import type {
  ManagementYieldMetric,
  ManagementYieldRow,
  ManagementYieldSourceType,
  ManagementYieldsSnapshot,
} from "../../src/data/snapshots/types";

/**
 * Per-AMC list of investor-relations entry points. The ingester walks each
 * page, collects PDF links, and parses them looking for "bps of AAUM"
 * disclosures. URLs are intentionally documented inline so it's easy to
 * audit / extend without grepping commit history.
 */
interface AmcSource {
  amcSlug: string;
  pages: string[];
}

const AMC_SOURCES: AmcSource[] = [
  {
    amcSlug: "hdfc",
    pages: [
      "https://www.hdfcfund.com/about-us/about-us/investor-relations",
      "https://www.hdfcfund.com/about-us/about-us/investor-relations/financials",
    ],
  },
  {
    amcSlug: "nippon",
    pages: [
      "https://mf.nipponindiaim.com/InvestorServices/Pages/Investor-Relations.aspx",
    ],
  },
  {
    amcSlug: "absl",
    pages: [
      "https://mutualfund.adityabirlacapital.com/about-us/investor-relations",
    ],
  },
  {
    amcSlug: "uti",
    pages: ["https://www.utimf.com/about-uti/investors-information"],
  },
  // ICICI Pru AMC IR site URL TBD — added once stable.
];

const PDF_LINK = /\.pdf(?:[?#].*)?$/i;

interface DiscoveredPdf {
  amcSlug: string;
  pageUrl: string;
  pdfUrl: string;
  linkText: string;
  sourceType: ManagementYieldSourceType;
}

function classifySource(linkText: string, url: string): ManagementYieldSourceType {
  const t = `${linkText} ${url}`.toLowerCase();
  if (/concall|earnings\s*call|transcript/.test(t)) return "concall_transcript";
  if (/presentation|investor\s*deck|invest_pres/.test(t))
    return "investor_presentation";
  if (/exchange|nse|bse|stock\s*exchange/.test(t)) return "exchange_filing";
  return "company_ir";
}

async function discoverPdfs(src: AmcSource): Promise<DiscoveredPdf[]> {
  const out: DiscoveredPdf[] = [];
  for (const page of src.pages) {
    let html: string;
    try {
      html = await fetchText(page);
    } catch (err) {
      warn(`mgmt-yields[${src.amcSlug}]: cannot fetch ${page} — ${(err as Error).message}`);
      continue;
    }
    const $ = cheerio.load(html);
    $("a").each((_, el) => {
      const href = ($(el).attr("href") ?? "").trim();
      if (!href || !PDF_LINK.test(href)) return;
      const text = $(el).text().trim();
      const abs = href.startsWith("http") ? href : new URL(href, page).toString();
      out.push({
        amcSlug: src.amcSlug,
        pageUrl: page,
        pdfUrl: abs,
        linkText: text || abs,
        sourceType: classifySource(text, abs),
      });
    });
  }
  return out;
}

/**
 * Map a management period label like "Q1 FY26" to the calendar quarter id
 * used in our snapshots ("2025-Q2"). Indian FY runs Apr-Mar:
 *   FY{N} Q1 = Apr-Jun (calendar Q2 of N-1)
 *   FY{N} Q2 = Jul-Sep (calendar Q3 of N-1)
 *   FY{N} Q3 = Oct-Dec (calendar Q4 of N-1)
 *   FY{N} Q4 = Jan-Mar (calendar Q1 of N)
 */
export function fyQuarterToCalendar(label: string): string | null {
  const m = label.toUpperCase().match(/Q\s*([1-4])\s*FY\s*('?\d{2,4})/);
  if (!m) return null;
  const fyQ = Number(m[1]);
  const yearRaw = m[2].replace("'", "");
  let year = Number(yearRaw);
  if (year < 100) year += 2000;
  // year here = the FY end-year. e.g. FY26 → year=26 → 2026.
  if (fyQ === 4) return `${year}-Q1`;
  if (fyQ === 1) return `${year - 1}-Q2`;
  if (fyQ === 2) return `${year - 1}-Q3`;
  return `${year - 1}-Q4`; // fyQ === 3
}

interface ExtractedValue {
  metric: ManagementYieldMetric;
  valueBps: number;
  lowBps?: number;
  highBps?: number;
  periodLabel: string;
  rawText: string;
  confidence: "high" | "medium" | "low";
}

const METRIC_PATTERNS: { metric: ManagementYieldMetric; cue: RegExp }[] = [
  { metric: "operating_margin_bps_of_aaum", cue: /operating\s*margin/i },
  { metric: "revenue_realization_bps_of_aaum", cue: /(revenue\s*realisation|operating\s*revenue|revenue\s*\(bps)/i },
  { metric: "operating_expense_bps_of_aaum", cue: /(operating\s*expense|opex)/i },
  { metric: "blended_yield_bps", cue: /blended/i },
  { metric: "active_equity_yield_bps", cue: /active\s*equity/i },
  { metric: "equity_yield_bps", cue: /\bequity\b/i },
  { metric: "debt_yield_bps", cue: /\bdebt\b/i },
  { metric: "liquid_yield_bps", cue: /\bliquid\b/i },
  { metric: "profit_yield_bps_of_aaum", cue: /(profit\s*yield|pat\s*yield)/i },
];

/**
 * Best-effort extractor. PDF text from investor decks is unstructured and
 * varies AMC-to-AMC, so we rely on cue words ("operating margin",
 * "blended", …) plus an explicit "bps" / "AAUM" anchor in the same
 * sentence. Anything ambiguous is dropped. False positives are far worse
 * than missing values for this dashboard.
 */
export function extractFromText(text: string): ExtractedValue[] {
  const out: ExtractedValue[] = [];
  // Split into sentences by punctuation; keep enough context per sentence.
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const raw of sentences) {
    const lc = raw.toLowerCase();
    if (!/bps/.test(lc)) continue;
    if (!/aaum|basis\s*points|\bbp\b/.test(lc)) continue;

    // Find period label (Q1 FY26 / 9M FY26 etc.). Without a period anchor
    // we can't map to a quarter, so skip.
    const periodM = raw.match(/(Q[1-4]\s*FY\s*'?\d{2,4})/i);
    const periodLabel = periodM ? periodM[1].toUpperCase().replace(/\s+/g, " ") : null;
    if (!periodLabel) continue;

    // Pull all bps numbers from the sentence.
    const numMatches = Array.from(raw.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:bps|basis\s*points)/gi));
    if (numMatches.length === 0) continue;

    const metric = METRIC_PATTERNS.find((p) => p.cue.test(raw))?.metric;
    if (!metric) continue;

    const values = numMatches.map((m) => Number(m[1]));
    const valueBps = values[0];
    const range = values.length > 1
      ? { lowBps: Math.min(...values), highBps: Math.max(...values) }
      : {};

    out.push({
      metric,
      valueBps,
      ...range,
      periodLabel,
      rawText: raw.trim().slice(0, 280),
      confidence: numMatches.length === 1 ? "high" : "medium",
    });
  }
  return out;
}

async function parsePdf(url: string): Promise<string | null> {
  let pdfParse: (buf: Buffer) => Promise<{ text: string }>;
  try {
    // pdf-parse is a CommonJS module without bundled type declarations. Resolved
    // at runtime by the GitHub Actions runner after `npm ci`. Sandbox / local
    // typechecks may not have it installed, so we avoid a static import.
    const modName = "pdf-parse";
    const mod = (await import(/* webpackIgnore: true */ modName)) as unknown as {
      default?: (buf: Buffer) => Promise<{ text: string }>;
    };
    pdfParse = mod.default ?? (mod as unknown as (buf: Buffer) => Promise<{ text: string }>);
  } catch (err) {
    warn(`mgmt-yields: pdf-parse unavailable — ${(err as Error).message}`);
    return null;
  }
  let buf: Buffer;
  try {
    const ab = await fetchBuffer(url, 90_000);
    buf = Buffer.from(ab);
  } catch (err) {
    warn(`mgmt-yields: fetch failed for ${url} — ${(err as Error).message}`);
    return null;
  }
  try {
    const parsed = await pdfParse(buf);
    return parsed.text;
  } catch (err) {
    warn(`mgmt-yields: parse failed for ${url} — ${(err as Error).message}`);
    return null;
  }
}

interface MergeKey {
  amcSlug: string;
  quarter: string;
  metric: ManagementYieldMetric;
  sourceName: string;
}

function rowKey(r: MergeKey): string {
  return `${r.amcSlug}::${r.quarter}::${r.metric}::${r.sourceName}`;
}

export async function ingestManagementYields(): Promise<void> {
  info("=== management-yields ===");
  const fetchedAt = nowIso();
  const fetched: ManagementYieldRow[] = [];
  const stats = {
    pdfsTried: 0,
    pdfsParsed: 0,
    extractedRows: 0,
    unmapped: 0,
    failuresByAmc: {} as Record<string, number>,
  };

  for (const src of AMC_SOURCES) {
    info(`mgmt-yields: discovering PDFs for ${src.amcSlug}`);
    const pdfs = await discoverPdfs(src);
    info(`mgmt-yields:   ${src.amcSlug} → ${pdfs.length} PDF link(s)`);
    if (pdfs.length === 0) {
      stats.failuresByAmc[src.amcSlug] = (stats.failuresByAmc[src.amcSlug] ?? 0) + 1;
      continue;
    }
    // Cap to the most recent N PDFs to avoid pulling the entire archive.
    const candidates = pdfs.slice(0, 8);
    for (const pdf of candidates) {
      stats.pdfsTried += 1;
      const text = await parsePdf(pdf.pdfUrl);
      if (!text) continue;
      stats.pdfsParsed += 1;
      const extracted = extractFromText(text);
      info(
        `mgmt-yields:   ${pdf.pdfUrl} → ${extracted.length} candidate value(s)`
      );
      for (const e of extracted) {
        stats.extractedRows += 1;
        const quarter = fyQuarterToCalendar(e.periodLabel);
        if (!quarter) {
          stats.unmapped += 1;
          continue;
        }
        fetched.push({
          amcSlug: src.amcSlug,
          quarter,
          periodLabel: e.periodLabel,
          metric: e.metric,
          valueBps: e.valueBps,
          ...(e.lowBps !== undefined ? { lowBps: e.lowBps } : {}),
          ...(e.highBps !== undefined ? { highBps: e.highBps } : {}),
          sourceName: pdf.linkText.slice(0, 120),
          sourceUrl: pdf.pdfUrl,
          sourceType: pdf.sourceType,
          rawText: e.rawText,
          confidence: e.confidence,
          fetchedAt,
        });
      }
    }
  }

  // Merge with prior snapshot so a partial run never wipes good rows.
  const prior =
    (await readSnapshot<ManagementYieldsSnapshot>(
      "amc-management-yields.json"
    ))?.rows ?? [];
  const map = new Map<string, ManagementYieldRow>();
  for (const r of prior) map.set(rowKey(r), r);
  let added = 0;
  let updated = 0;
  for (const r of fetched) {
    const k = rowKey(r);
    if (map.has(k)) updated += 1;
    else added += 1;
    map.set(k, r);
  }
  const merged = Array.from(map.values()).sort((a, b) => {
    if (a.amcSlug !== b.amcSlug) return a.amcSlug.localeCompare(b.amcSlug);
    if (a.quarter !== b.quarter) return a.quarter.localeCompare(b.quarter);
    return a.metric.localeCompare(b.metric);
  });

  const amcsCovered = Array.from(new Set(merged.map((r) => r.amcSlug))).sort();
  const quartersCovered = Array.from(
    new Set(merged.map((r) => r.quarter))
  ).sort();
  const status =
    merged.length === 0
      ? "empty"
      : amcsCovered.length === AMC_SOURCES.length
        ? "ok"
        : "partial";

  info(
    `mgmt-yields: pdfsTried=${stats.pdfsTried} pdfsParsed=${stats.pdfsParsed} extracted=${stats.extractedRows} unmapped=${stats.unmapped}`
  );
  info(
    `mgmt-yields: merge — added=${added} updated=${updated} preserved=${prior.length - updated} total=${merged.length}`
  );
  info(
    `mgmt-yields: status=${status} amcs=[${amcsCovered.join(", ")}] quarters=[${quartersCovered.join(", ")}]`
  );

  const snapshot: ManagementYieldsSnapshot = {
    meta: {
      generatedAt: fetchedAt,
      source:
        "Public AMC investor relations (presentations, concall transcripts, exchange filings)",
      status,
      rowCount: merged.length,
      amcsCovered,
      quartersCovered,
      notes: [
        "Management-disclosed bps-of-AAUM yields scraped from public IR pages.",
        `lastSuccessfulFetchAt=${fetchedAt} · pdfsTried=${stats.pdfsTried} · pdfsParsed=${stats.pdfsParsed}.`,
        "Each row carries source URL, raw snippet, confidence; merged on (amcSlug, quarter, metric, sourceName).",
      ].join(" "),
    },
    rows: merged,
  };
  await writeSnapshot("amc-management-yields.json", snapshot);
  info("mgmt-yields: wrote amc-management-yields.json");
}
