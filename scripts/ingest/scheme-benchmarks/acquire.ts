/**
 * Acquisition tier for official scheme-benchmark evidence.
 *
 * Reuses the AMC infrastructure the repo already has rather than growing a
 * second scraper stack:
 *   - curl transport + link harvesting  → amc-factsheets/page-scrape.ts
 *   - month scoring / latest-file pick  → amc-factsheets/browser-fallback.ts
 *   - headless Chromium (bot walls,     → amc-factsheets/browser.ts
 *     JS-rendered listings)               amc-factsheets/browser-fallback.ts
 *   - PDF text extraction               → pdf-parse (already a dependency,
 *                                         used by scripts/ingest/amfi-monthly-pdf.ts)
 *
 * Output is a list of DOCUMENTS (url + plain text + inferred document date) per
 * AMC, all fetched from the AMC's OWN host. extract.ts turns them into
 * scheme → benchmark hits; nothing here decides mapping status.
 */

import { PDFParse } from "pdf-parse";
import { curlBuffer, curlText } from "../amc-factsheets/page-scrape";
import { monthScore, type HarvestedLink } from "../amc-factsheets/browser-fallback";
import { launchBrowser, newContext } from "../amc-factsheets/browser";
import { info, warn } from "../utils";
import { FACTSHEET_LINK_RE, SID_KIM_LINK_RE, type SchemeDocSource } from "./sources";
import type { BenchmarkSourceType } from "../../../src/data/scheme-benchmarks";
import type { Browser } from "playwright";

const DOC_RE = /\.(pdf|htm|html|aspx)(\?|#|$)/i;
/** Documents to download per AMC. A factsheet is one big file; a couple of
 *  candidates is plenty and keeps the monthly job inside its time budget. */
const MAX_DOCS_PER_AMC = 3;
const MAX_PDF_BYTES = 80 * 1024 * 1024;

export interface AcquiredDocument {
  /** First-party URL the text came from. */
  url: string;
  /** Plain text of the document. */
  text: string;
  sourceType: BenchmarkSourceType;
  /** "As on" date inferred from the filename/URL, ISO month-end, or null. */
  documentDate: string | null;
  /** Transport that produced it, for the build log. */
  via: "curl" | "browser" | "page-html";
  /** Extraction mode overrides (see extract.ts ExtractOptions). Omitted for
   *  free-flowing documents, which use the defaults. */
  anchorMode?: "nearest-preceding" | "same-line";
  scans?: Array<"label" | "descriptor">;
}

// ---------------------------------------------------------------------------
// Link harvesting
// ---------------------------------------------------------------------------

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#x26;/gi, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\\//g, "/");
}

/** Every document-looking link on a page (anchors, JSON values, bare URLs). */
export function harvestDocLinks(html: string, pageUrl: string): HarvestedLink[] {
  const out: HarvestedLink[] = [];
  const seen = new Set<string>();
  const add = (rawUrl: string, text: string) => {
    let u = decodeHtml(rawUrl.trim());
    if (!u) return;
    try { u = new URL(u, pageUrl).href; } catch { return; }
    if (!DOC_RE.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push({ url: u, text: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  };
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) add(m[1], m[2]);
  for (const m of html.matchAll(/["'](https?:\/\/[^"']+?\.(?:pdf|html?|aspx)(?:\?[^"']*)?)["']/gi)) add(m[1], "");
  for (const m of html.matchAll(/["']((?:\/[^"']+?)\.(?:pdf|html?|aspx)(?:\?[^"']*)?)["']/gi)) add(m[1], "");
  return out;
}

/** Same-origin check — a harvested link must stay on the AMC's own host family
 *  for the evidence to count as first-party. */
export function isFirstParty(docUrl: string, pageUrl: string): boolean {
  try {
    const a = new URL(docUrl).hostname.toLowerCase();
    const b = new URL(pageUrl).hostname.toLowerCase();
    const root = (h: string) => h.split(".").slice(-3).join(".");
    if (a === b) return true;
    // AMCs commonly serve documents from a CDN/blob subdomain of the same
    // registrable domain (files.hdfcfund.com, media.bajajamc.com).
    return root(a) === root(b) || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

/** ISO month-end for the newest month token in a string, or null. */
export function documentDateFrom(text: string): string | null {
  const score = monthScore(text);
  if (!score) return null;
  const year = Math.floor((score - 1) / 12);
  const month = score - year * 12;
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Document → text
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Block-level tags become line breaks so the extractor's line-oriented
    // value window works on HTML the same way it does on a factsheet PDF.
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

export async function pdfToText(buf: Buffer): Promise<string | null> {
  if (buf.length > MAX_PDF_BYTES) return null;
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text ?? "").join("\n");
  } catch (e) {
    warn(`pdf text extraction failed: ${(e as Error).message}`);
    return null;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function bufferToText(buf: Buffer, url: string): Promise<string | null> {
  const head = buf.subarray(0, 8).toString("latin1");
  if (head.startsWith("%PDF")) return pdfToText(buf);
  if (/\.pdf(\?|#|$)/i.test(url)) return pdfToText(buf); // mislabelled but PDF
  const text = buf.toString("utf8");
  if (/<html|<!doctype/i.test(text.slice(0, 2048))) return htmlToText(text);
  return text;
}

// ---------------------------------------------------------------------------
// Per-AMC acquisition
// ---------------------------------------------------------------------------

/** Documents whose link text/URL looks like a factsheet, newest month first. */
function rankLinks(links: HarvestedLink[], pageUrl: string): HarvestedLink[] {
  const wanted = links.filter(
    (l) => isFirstParty(l.url, pageUrl) && (FACTSHEET_LINK_RE.test(`${l.url} ${l.text}`) || SID_KIM_LINK_RE.test(`${l.url} ${l.text}`))
  );
  return wanted
    .map((l) => ({ l, s: monthScore(`${decodeURIComponent(l.url)} ${l.text}`), fact: FACTSHEET_LINK_RE.test(`${l.url} ${l.text}`) }))
    .sort((a, b) => (b.fact ? 1 : 0) - (a.fact ? 1 : 0) || b.s - a.s)
    .map((x) => x.l);
}

function sourceTypeFor(link: HarvestedLink, fallback: BenchmarkSourceType): BenchmarkSourceType {
  const hay = `${link.url} ${link.text}`;
  if (FACTSHEET_LINK_RE.test(hay)) return "factsheet";
  if (/\bkim\b|key[\s_-]*information[\s_-]*memorandum/i.test(hay)) return "KIM";
  if (/\bsid\b|scheme[\s_-]*information[\s_-]*document/i.test(hay)) return "SID";
  return fallback;
}

/** A listing page can itself be the evidence: plenty of AMCs render a
 *  "Scheme | Benchmark" table straight into the fund-list HTML. */
function pageIsEvidence(text: string): boolean {
  const labels = text.match(/\bbenchmark\b/gi);
  return !!labels && labels.length >= 3;
}

export interface AcquireOptions {
  /** Reuse one browser across AMCs (the caller owns its lifecycle). */
  browser?: Browser | null;
  debug?: boolean;
}

export async function acquireAmcDocuments(
  source: SchemeDocSource,
  opts: AcquireOptions = {}
): Promise<AcquiredDocument[]> {
  const docs: AcquiredDocument[] = [];
  const tried = new Set<string>();

  for (const pageUrl of source.pages) {
    if (docs.length >= MAX_DOCS_PER_AMC) break;
    let html: string | null = curlText(pageUrl, source.referer);
    let via: AcquiredDocument["via"] = "curl";

    if ((!html || html.length < 512) && (source.browser || opts.browser)) {
      html = await renderPage(pageUrl, opts);
      via = "browser";
    }
    if (!html) {
      if (opts.debug) warn(`[${source.slug}] no HTML from ${pageUrl}`);
      continue;
    }

    const pageText = htmlToText(html);
    if (pageIsEvidence(pageText)) {
      docs.push({ url: pageUrl, text: pageText, sourceType: "scheme-page", documentDate: documentDateFrom(pageText.slice(0, 4000)), via: via === "browser" ? "browser" : "page-html" });
    }

    for (const link of rankLinks(harvestDocLinks(html, pageUrl), pageUrl)) {
      if (docs.length >= MAX_DOCS_PER_AMC) break;
      if (tried.has(link.url)) continue;
      tried.add(link.url);
      const buf = curlBuffer(link.url, source.referer);
      if (!buf) {
        if (opts.debug) warn(`[${source.slug}] download failed ${link.url}`);
        continue;
      }
      const text = await bufferToText(buf, link.url);
      if (!text || text.length < 1000) continue;
      docs.push({
        url: link.url,
        text,
        sourceType: sourceTypeFor(link, source.sourceType),
        documentDate: documentDateFrom(`${decodeURIComponent(link.url)} ${link.text}`) ?? documentDateFrom(text.slice(0, 4000)),
        via: "curl",
      });
      info(`[${source.slug}] acquired ${link.url} (${text.length} chars)`);
    }
  }
  return docs;
}

async function renderPage(url: string, opts: AcquireOptions): Promise<string | null> {
  if (!opts.browser) return null;
  try {
    const ctx = await newContext(opts.browser);
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(4000);
      return await page.content();
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch (e) {
    warn(`browser render failed for ${url}: ${(e as Error).message}`);
    return null;
  }
}

/** Launch the shared browser only when at least one AMC needs it. */
export async function maybeLaunchBrowser(needed: boolean): Promise<Browser | null> {
  if (!needed) return null;
  try {
    return await launchBrowser();
  } catch (e) {
    warn(`headless browser unavailable (${(e as Error).message}); curl-only tiers still run`);
    return null;
  }
}
