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
import type { Browser, Page } from "playwright";

/**
 * Per-AMC list of investor-relations entry points. The ingester walks each
 * page, collects PDF / presentation links, and parses them looking for
 * "bps of AAUM" disclosures. URLs are intentionally documented inline so
 * it's easy to audit / extend without grepping commit history.
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

/**
 * Direct-URL escape hatch. Empty by default — populate ONLY with verified
 * official company / exchange URLs. Never use third-party or guessed
 * URLs. This config bypasses page discovery entirely for entries listed
 * here, useful when an IR page is JS-heavy or anti-bot-protected but the
 * underlying PDF is publicly hosted.
 */
const KNOWN_PDFS: Record<
  string,
  Array<{
    url: string;
    sourceName: string;
    sourceType: ManagementYieldSourceType;
    quarterHint?: string;
  }>
> = {
  // hdfc: [{ url: "https://...", sourceName: "HDFC AMC Q3 FY26 Investor Presentation", sourceType: "investor_presentation" }],
};

/** Match anchors that look like a PDF or presentation/results/concall link. */
const HREF_KEYWORDS =
  /(\.pdf(?:[?#].*)?$|presentation|investor|results|earnings|concall|transcript)/i;

const KEYWORDS_TO_AUDIT = [
  "bps of AAUM",
  "basis points of AAUM",
  "realisation",
  "realization",
  "operating margin",
  "operating revenue",
  "operating expense",
  "blended",
  "equity",
  "debt",
  "liquid",
];

const PLAYWRIGHT_ENABLED = process.env.MGMT_YIELDS_PLAYWRIGHT === "1";

interface DiscoveredPdf {
  amcSlug: string;
  pageUrl: string;
  pdfUrl: string;
  linkText: string;
  sourceType: ManagementYieldSourceType;
  origin: "known" | "cheerio" | "playwright";
}

function classifySource(
  linkText: string,
  url: string
): ManagementYieldSourceType {
  const t = `${linkText} ${url}`.toLowerCase();
  if (/concall|earnings\s*call|transcript/.test(t)) return "concall_transcript";
  if (/presentation|investor\s*deck|invest_pres/.test(t))
    return "investor_presentation";
  if (/exchange|nse|bse|stock\s*exchange/.test(t)) return "exchange_filing";
  return "company_ir";
}

function dedupePdfs(pdfs: DiscoveredPdf[]): DiscoveredPdf[] {
  const seen = new Set<string>();
  const out: DiscoveredPdf[] = [];
  for (const p of pdfs) {
    if (seen.has(p.pdfUrl)) continue;
    seen.add(p.pdfUrl);
    out.push(p);
  }
  return out;
}

async function discoverFromKnown(src: AmcSource): Promise<DiscoveredPdf[]> {
  const known = KNOWN_PDFS[src.amcSlug] ?? [];
  return known.map((k) => ({
    amcSlug: src.amcSlug,
    pageUrl: "(known)",
    pdfUrl: k.url,
    linkText: k.sourceName,
    sourceType: k.sourceType,
    origin: "known" as const,
  }));
}

async function discoverFromCheerio(src: AmcSource): Promise<DiscoveredPdf[]> {
  const out: DiscoveredPdf[] = [];
  for (const page of src.pages) {
    let html: string;
    try {
      html = await fetchText(page);
    } catch (err) {
      warn(
        `mgmt-yields[${src.amcSlug}]: cheerio fetch failed for ${page} — ${(err as Error).message}`
      );
      continue;
    }
    const $ = cheerio.load(html);
    $("a").each((_, el) => {
      const href = ($(el).attr("href") ?? "").trim();
      if (!href) return;
      if (!HREF_KEYWORDS.test(href)) return;
      const text = $(el).text().trim();
      const abs = href.startsWith("http")
        ? href
        : new URL(href, page).toString();
      out.push({
        amcSlug: src.amcSlug,
        pageUrl: page,
        pdfUrl: abs,
        linkText: text || abs,
        sourceType: classifySource(text, abs),
        origin: "cheerio",
      });
    });
  }
  return out;
}

async function discoverFromPlaywright(
  browser: Browser,
  src: AmcSource
): Promise<DiscoveredPdf[]> {
  const out: DiscoveredPdf[] = [];
  for (const page of src.pages) {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    const tab: Page = await ctx.newPage();
    try {
      await tab.goto(page, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await tab.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const links = await tab.$$eval("a[href]", (els) =>
        (els as HTMLAnchorElement[]).map((a) => ({
          href: a.href,
          text: (a.textContent ?? "").trim(),
        }))
      );
      for (const l of links) {
        if (!l.href || !HREF_KEYWORDS.test(l.href)) continue;
        out.push({
          amcSlug: src.amcSlug,
          pageUrl: page,
          pdfUrl: l.href,
          linkText: l.text || l.href,
          sourceType: classifySource(l.text, l.href),
          origin: "playwright",
        });
      }
    } catch (err) {
      warn(
        `mgmt-yields[${src.amcSlug}]: playwright failed on ${page} — ${(err as Error).message}`
      );
    } finally {
      await ctx.close().catch(() => {});
    }
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
  if (fyQ === 4) return `${year}-Q1`;
  if (fyQ === 1) return `${year - 1}-Q2`;
  if (fyQ === 2) return `${year - 1}-Q3`;
  return `${year - 1}-Q4`;
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
  {
    metric: "revenue_realization_bps_of_aaum",
    cue: /(revenue\s*realisation|operating\s*revenue|revenue\s*\(bps)/i,
  },
  {
    metric: "operating_expense_bps_of_aaum",
    cue: /(operating\s*expense|opex)/i,
  },
  { metric: "blended_yield_bps", cue: /blended/i },
  { metric: "active_equity_yield_bps", cue: /active\s*equity/i },
  { metric: "equity_yield_bps", cue: /\bequity\b/i },
  { metric: "debt_yield_bps", cue: /\bdebt\b/i },
  { metric: "liquid_yield_bps", cue: /\bliquid\b/i },
  { metric: "profit_yield_bps_of_aaum", cue: /(profit\s*yield|pat\s*yield)/i },
];

export function extractFromText(text: string): ExtractedValue[] {
  const out: ExtractedValue[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const raw of sentences) {
    const lc = raw.toLowerCase();
    if (!/bps/.test(lc)) continue;
    if (!/aaum|basis\s*points|\bbp\b/.test(lc)) continue;
    const periodM = raw.match(/(Q[1-4]\s*FY\s*'?\d{2,4})/i);
    const periodLabel = periodM
      ? periodM[1].toUpperCase().replace(/\s+/g, " ")
      : null;
    if (!periodLabel) continue;
    const numMatches = Array.from(
      raw.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:bps|basis\s*points)/gi)
    );
    if (numMatches.length === 0) continue;
    const metric = METRIC_PATTERNS.find((p) => p.cue.test(raw))?.metric;
    if (!metric) continue;
    const values = numMatches.map((m) => Number(m[1]));
    const valueBps = values[0];
    const range =
      values.length > 1
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

/** Snippet around the first occurrence of a keyword. Used for diagnostics
 *  when a PDF parses but yields no extracted rows. */
function keywordSnippet(text: string, keyword: string, ctx = 80): string | null {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - ctx);
  const end = Math.min(text.length, idx + keyword.length + ctx);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

async function parsePdf(url: string): Promise<string | null> {
  let pdfParse: (buf: Buffer) => Promise<{ text: string }>;
  try {
    const modName = "pdf-parse";
    const mod = (await import(/* webpackIgnore: true */ modName)) as unknown as {
      default?: (buf: Buffer) => Promise<{ text: string }>;
    };
    pdfParse =
      mod.default ??
      (mod as unknown as (buf: Buffer) => Promise<{ text: string }>);
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
  // Quick sniff — non-PDF bytes (HTML 403/redirect) shouldn't be sent to pdf-parse.
  if (buf.length < 5 || buf.slice(0, 4).toString("ascii") !== "%PDF") {
    warn(`mgmt-yields: not a PDF (signature mismatch) — ${url}`);
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
  info(
    `mgmt-yields: playwright=${PLAYWRIGHT_ENABLED ? "on" : "off"} amcs=${AMC_SOURCES.length}`
  );
  const fetchedAt = nowIso();
  const fetched: ManagementYieldRow[] = [];
  const stats = {
    knownPdfs: 0,
    cheerioPdfs: 0,
    playwrightPdfs: 0,
    deduped: 0,
    pdfsTried: 0,
    pdfsParsed: 0,
    pdfsNotPdf: 0,
    keywordHits: 0,
    extractedRows: 0,
    unmapped: 0,
    failuresByAmc: {} as Record<string, number>,
  };

  let browser: Browser | null = null;
  if (PLAYWRIGHT_ENABLED) {
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      warn(`mgmt-yields: playwright unavailable — ${(err as Error).message}`);
    }
  }

  try {
    for (const src of AMC_SOURCES) {
      info(`mgmt-yields: discovering for ${src.amcSlug}`);
      const known = await discoverFromKnown(src);
      stats.knownPdfs += known.length;

      const cheerioRes = await discoverFromCheerio(src);
      stats.cheerioPdfs += cheerioRes.length;
      info(
        `mgmt-yields:   ${src.amcSlug} cheerio → ${cheerioRes.length} link(s)`
      );

      let playwrightRes: DiscoveredPdf[] = [];
      if (browser && cheerioRes.length === 0) {
        playwrightRes = await discoverFromPlaywright(browser, src);
        stats.playwrightPdfs += playwrightRes.length;
        info(
          `mgmt-yields:   ${src.amcSlug} playwright → ${playwrightRes.length} link(s)`
        );
      }

      const all = dedupePdfs([...known, ...cheerioRes, ...playwrightRes]);
      stats.deduped += all.length;
      info(
        `mgmt-yields:   ${src.amcSlug} dedupe → ${all.length} unique URL(s)`
      );

      if (all.length === 0) {
        stats.failuresByAmc[src.amcSlug] =
          (stats.failuresByAmc[src.amcSlug] ?? 0) + 1;
        continue;
      }

      // Cap per AMC to bound runtime.
      const candidates = all.slice(0, 8);
      for (const pdf of candidates) {
        stats.pdfsTried += 1;
        info(
          `mgmt-yields:   try ${pdf.origin} ${pdf.pdfUrl} «${pdf.linkText.slice(0, 60)}»`
        );
        const text = await parsePdf(pdf.pdfUrl);
        if (text === null) {
          stats.pdfsNotPdf += 1;
          continue;
        }
        stats.pdfsParsed += 1;
        const keywordsFound = KEYWORDS_TO_AUDIT.filter((k) =>
          text.toLowerCase().includes(k.toLowerCase())
        );
        stats.keywordHits += keywordsFound.length > 0 ? 1 : 0;
        info(
          `mgmt-yields:     parsed textLen=${text.length} keywords=[${keywordsFound.join(", ") || "none"}]`
        );
        const extracted = extractFromText(text);
        info(
          `mgmt-yields:     extracted ${extracted.length} candidate value(s)`
        );
        if (extracted.length === 0 && keywordsFound.length > 0) {
          for (const k of keywordsFound.slice(0, 3)) {
            const snip = keywordSnippet(text, k);
            if (snip) info(`mgmt-yields:       «${k}» → ${snip}`);
          }
        }
        for (const e of extracted) {
          const quarter = fyQuarterToCalendar(e.periodLabel);
          if (!quarter) {
            stats.unmapped += 1;
            continue;
          }
          stats.extractedRows += 1;
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
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Merge with prior snapshot — partial / failed runs preserve history.
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
    `mgmt-yields: discover — known=${stats.knownPdfs} cheerio=${stats.cheerioPdfs} playwright=${stats.playwrightPdfs} unique=${stats.deduped}`
  );
  info(
    `mgmt-yields: parse — tried=${stats.pdfsTried} parsed=${stats.pdfsParsed} not_pdf=${stats.pdfsNotPdf} keyword_hits=${stats.keywordHits}`
  );
  info(
    `mgmt-yields: extract — rows=${stats.extractedRows} unmapped=${stats.unmapped}`
  );
  info(
    `mgmt-yields: merge — added=${added} updated=${updated} preserved=${prior.length - updated} total=${merged.length}`
  );
  if (Object.keys(stats.failuresByAmc).length > 0) {
    info(
      `mgmt-yields: failuresByAmc=${JSON.stringify(stats.failuresByAmc)}`
    );
  }
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
        `lastSuccessfulFetchAt=${fetchedAt} · playwright=${PLAYWRIGHT_ENABLED ? "on" : "off"} · pdfsTried=${stats.pdfsTried} · pdfsParsed=${stats.pdfsParsed} · keywordHits=${stats.keywordHits}.`,
        "Each row carries source URL, raw snippet, confidence; merged on (amcSlug, quarter, metric, sourceName).",
      ].join(" "),
    },
    rows: merged,
  };
  await writeSnapshot("amc-management-yields.json", snapshot);
  info("mgmt-yields: wrote amc-management-yields.json");
}
