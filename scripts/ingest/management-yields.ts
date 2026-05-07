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
  /** NSE equity ticker — used for the corporate-announcements API. */
  nseSymbol?: string;
  /** BSE scrip code (numeric) — used for the AnnGetData API. */
  bseScrip?: string;
  /** Company IR landing pages — Playwright/cheerio fallback. */
  pages: string[];
}

const AMC_SOURCES: AmcSource[] = [
  {
    amcSlug: "hdfc",
    nseSymbol: "HDFCAMC",
    bseScrip: "541729",
    pages: [
      "https://www.hdfcfund.com/about-us/about-us/investor-relations",
      "https://www.hdfcfund.com/about-us/about-us/investor-relations/financials",
    ],
  },
  {
    amcSlug: "nippon",
    nseSymbol: "NAM-INDIA",
    bseScrip: "540767",
    pages: [
      "https://mf.nipponindiaim.com/InvestorServices/Pages/Investor-Relations.aspx",
    ],
  },
  {
    amcSlug: "absl",
    nseSymbol: "ABSLAMC",
    bseScrip: "542752",
    pages: [
      "https://mutualfund.adityabirlacapital.com/about-us/investor-relations",
    ],
  },
  {
    amcSlug: "uti",
    nseSymbol: "UTIAMC",
    bseScrip: "543238",
    pages: ["https://www.utimf.com/about-uti/investors-information"],
  },
  // ICICI Pru AMC: not yet listed on NSE/BSE under a separate AMC ticker.
  // Once a stable corporate-announcements scrip exists, add nseSymbol +
  // bseScrip here.
  {
    amcSlug: "icici-pru",
    pages: [],
  },
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
  origin: "known" | "nse" | "bse" | "cheerio" | "playwright";
  /** Source-specific metadata baked into the row when extracted. */
  exchangeMeta?: {
    exchange: "NSE" | "BSE";
    ticker: string;
    announcementDate?: string;
    filingSubject?: string;
  };
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

/** Subjects/headlines that look like investor presentation / concall material. */
const EXCHANGE_FILING_KEYWORDS =
  /(investor\s*presentation|earnings\s*presentation|result\s*presentation|financial\s*results\s*presentation|concall|earnings\s*call|investor\s*update|quarterly\s*update|presentation|transcript)/i;

const EXCHANGE_LOOKBACK_MONTHS = 18;

interface NseAnnouncement {
  symbol: string;
  subject?: string;
  attchmntFile?: string;
  attchmntText?: string;
  ann_date?: string;
  desc?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function nseDateRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - EXCHANGE_LOOKBACK_MONTHS);
  const fmt = (d: Date) =>
    `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
  return { from: fmt(from), to: fmt(today) };
}

/**
 * NSE corporate-announcements API. The endpoint is cookie-gated — a direct
 * curl typically gets 401/403. We try a plain fetch first; if it fails we
 * fall through silently. (A future iteration can warm a Playwright session
 * to harvest cookies before the JSON call.)
 */
async function discoverFromNse(src: AmcSource): Promise<DiscoveredPdf[]> {
  if (!src.nseSymbol) return [];
  const { from, to } = nseDateRange();
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(src.nseSymbol)}&from_date=${from}&to_date=${to}`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        referer: `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${src.nseSymbol}`,
      },
    });
    if (!res.ok) {
      warn(
        `mgmt-yields[${src.amcSlug}]: NSE returned HTTP ${res.status} for ${src.nseSymbol}`
      );
      return [];
    }
    const json = (await res.json()) as NseAnnouncement[];
    const out: DiscoveredPdf[] = [];
    for (const a of json) {
      const subject = `${a.subject ?? ""} ${a.desc ?? ""} ${a.attchmntText ?? ""}`;
      if (!EXCHANGE_FILING_KEYWORDS.test(subject)) continue;
      const pdf = a.attchmntFile;
      if (!pdf || !/\.pdf(?:[?#]|$)/i.test(pdf)) continue;
      out.push({
        amcSlug: src.amcSlug,
        pageUrl: `nse:${src.nseSymbol}`,
        pdfUrl: pdf,
        linkText: (a.subject ?? a.desc ?? "NSE filing").slice(0, 140),
        sourceType: "exchange_filing",
        origin: "nse",
        exchangeMeta: {
          exchange: "NSE",
          ticker: src.nseSymbol,
          announcementDate: a.ann_date,
          filingSubject: a.subject,
        },
      });
    }
    return out;
  } catch (err) {
    warn(
      `mgmt-yields[${src.amcSlug}]: NSE fetch failed — ${(err as Error).message}`
    );
    return [];
  }
}

interface BseAnnouncementRow {
  HEADLINE?: string;
  SUBJECT?: string;
  NEWSSUB?: string;
  ATTACHMENTNAME?: string;
  NEWS_DT?: string;
}

/**
 * BSE corporate-announcements API. Public, returns JSON without cookies.
 * ATTACHMENTNAME is a relative filename; the canonical URL is
 *   https://www.bseindia.com/xml-data/corpfiling/AttachLive/{ATTACHMENTNAME}
 */
async function discoverFromBse(src: AmcSource): Promise<DiscoveredPdf[]> {
  if (!src.bseScrip) return [];
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - EXCHANGE_LOOKBACK_MONTHS);
  const fmt = (d: Date) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const url =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData_New/w` +
    `?strCat=Company%20Update&strPrevDate=${fmt(from)}&strScrip=${src.bseScrip}` +
    `&strSearch=P&strToDate=${fmt(today)}&strType=C`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        referer: "https://www.bseindia.com/corporates/ann.html",
      },
    });
    if (!res.ok) {
      warn(
        `mgmt-yields[${src.amcSlug}]: BSE returned HTTP ${res.status} for ${src.bseScrip}`
      );
      return [];
    }
    const json = (await res.json()) as { Table?: BseAnnouncementRow[] };
    const rows = json.Table ?? [];
    const out: DiscoveredPdf[] = [];
    for (const r of rows) {
      const subject = `${r.HEADLINE ?? ""} ${r.SUBJECT ?? ""} ${r.NEWSSUB ?? ""}`;
      if (!EXCHANGE_FILING_KEYWORDS.test(subject)) continue;
      const file = (r.ATTACHMENTNAME ?? "").trim();
      if (!file || !/\.pdf$/i.test(file)) continue;
      const pdf = `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${file}`;
      out.push({
        amcSlug: src.amcSlug,
        pageUrl: `bse:${src.bseScrip}`,
        pdfUrl: pdf,
        linkText: (r.SUBJECT ?? r.HEADLINE ?? "BSE filing").slice(0, 140),
        sourceType: "exchange_filing",
        origin: "bse",
        exchangeMeta: {
          exchange: "BSE",
          ticker: src.bseScrip,
          announcementDate: r.NEWS_DT,
          filingSubject: r.SUBJECT ?? r.HEADLINE,
        },
      });
    }
    return out;
  } catch (err) {
    warn(
      `mgmt-yields[${src.amcSlug}]: BSE fetch failed — ${(err as Error).message}`
    );
    return [];
  }
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
    nsePdfs: 0,
    bsePdfs: 0,
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
      info(
        `mgmt-yields: discovering for ${src.amcSlug} (nse=${src.nseSymbol ?? "—"} bse=${src.bseScrip ?? "—"})`
      );

      // Layer 1: NSE corporate announcements (primary).
      const nseRes = await discoverFromNse(src);
      stats.nsePdfs += nseRes.length;
      info(
        `mgmt-yields:   ${src.amcSlug} nse → ${nseRes.length} candidate filing(s)`
      );

      // Layer 2: BSE corporate announcements.
      const bseRes = await discoverFromBse(src);
      stats.bsePdfs += bseRes.length;
      info(
        `mgmt-yields:   ${src.amcSlug} bse → ${bseRes.length} candidate filing(s)`
      );

      // Layer 3: company IR static HTML (cheerio).
      const cheerioRes = await discoverFromCheerio(src);
      stats.cheerioPdfs += cheerioRes.length;
      info(
        `mgmt-yields:   ${src.amcSlug} cheerio → ${cheerioRes.length} link(s)`
      );

      // Layer 4: Playwright-rendered IR pages (only if upstream layers
      // returned zero — keeps runtime predictable).
      let playwrightRes: DiscoveredPdf[] = [];
      const upstream =
        nseRes.length + bseRes.length + cheerioRes.length;
      if (browser && upstream === 0) {
        playwrightRes = await discoverFromPlaywright(browser, src);
        stats.playwrightPdfs += playwrightRes.length;
        info(
          `mgmt-yields:   ${src.amcSlug} playwright → ${playwrightRes.length} link(s)`
        );
      }

      // Layer 5: pinned KNOWN_PDFS (always considered, dedupe handles
      // overlap with discovered URLs).
      const known = await discoverFromKnown(src);
      stats.knownPdfs += known.length;
      if (known.length > 0) {
        info(
          `mgmt-yields:   ${src.amcSlug} known → ${known.length} pinned URL(s)`
        );
      }

      const all = dedupePdfs([
        ...nseRes,
        ...bseRes,
        ...cheerioRes,
        ...playwrightRes,
        ...known,
      ]);
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
    `mgmt-yields: discover — nse=${stats.nsePdfs} bse=${stats.bsePdfs} cheerio=${stats.cheerioPdfs} playwright=${stats.playwrightPdfs} known=${stats.knownPdfs} unique=${stats.deduped}`
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
        "Management-disclosed bps-of-AAUM yields scraped from public exchange filings (NSE/BSE primary) and AMC IR pages (fallback).",
        `lastSuccessfulFetchAt=${fetchedAt} · playwright=${PLAYWRIGHT_ENABLED ? "on" : "off"} · nse=${stats.nsePdfs} · bse=${stats.bsePdfs} · cheerio=${stats.cheerioPdfs} · playwrightPdfs=${stats.playwrightPdfs} · pdfsTried=${stats.pdfsTried} · pdfsParsed=${stats.pdfsParsed} · keywordHits=${stats.keywordHits}.`,
        "Each row carries source URL, raw snippet, confidence; merged on (amcSlug, quarter, metric, sourceName).",
      ].join(" "),
    },
    rows: merged,
  };
  await writeSnapshot("amc-management-yields.json", snapshot);
  info("mgmt-yields: wrote amc-management-yields.json");
}
