/**
 * Curl-based page-scrape tier for AMCs whose monthly portfolio is published on a
 * SERVER-RENDERED listing page (or embedded in that page's JSON, e.g. Next.js
 * __NEXT_DATA__) and whose file host is NOT bot-walled — so no headless browser
 * is needed. Covers the small / newer fund houses AdvisorKhoj lists only a
 * landing page for (SAMCO, Taurus, Zerodha, Sundaram, …).
 *
 * Everything goes through `curl` (like advisorkhoj.ts), so it behaves identically
 * in the dev sandbox (egress proxy) and on CI runners, and — unlike the browser
 * tier — is testable locally. Per-AMC config lives in PAGE_SCRAPE_CONFIG below:
 * a disclosure page URL (or a date-derived set) + an optional link filter.
 */
import { execFileSync } from "node:child_process";
import { parseAmcWorkbook } from "./parse";
import { normalizeSchemePct, parseZip } from "./advisorkhoj";
import { selectLatestMonthFiles, monthScore, monthFloor, monthCeil, type HarvestedLink } from "./browser-fallback";
import type { AmcParseOptions, AmcScheme } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FILE_RE = /\.(xlsx?|zip)(\?|#|$)/i;

export interface PageScrapeConfig {
  /** Disclosure listing page(s), newest-first. A function is re-evaluated per
   *  run for pages that need the current month in the query string (Taurus). */
  urls: string[] | ((now: Date) => string[]);
  /** Keep only links whose (href + anchor text) matches this. */
  include?: RegExp;
  /** Referer header some hosts require. */
  referer?: string;
}

function curlText(url: string, referer?: string): string | null {
  try {
    const args = ["-fsL", "--max-time", "60", "-A", UA];
    if (referer) args.push("-H", `Referer: ${referer}`);
    return execFileSync("curl", [...args, url], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } catch {
    return null;
  }
}

export function curlBuffer(url: string, referer?: string): Buffer | null {
  try {
    // -g/--globoff: don't treat [ ] { } in a filename as curl globs (we no
    // longer percent-encode them, unlike the old encodeURI path).
    const args = ["-fsL", "-g", "--max-time", "120", "-A", UA];
    if (referer) args.push("-H", `Referer: ${referer}`);
    // Encode literal spaces + any lone '%' (not already part of a %XX escape)
    // without double-encoding: Tata ships %20-encoded filenames (encodeURI would
    // turn %20 into %2520 → 404), Zerodha ships literal spaces. This handles both.
    const safe = url.replace(/%(?![0-9A-Fa-f]{2})/g, "%25").replace(/ /g, "%20");
    const out = execFileSync("curl", [...args, safe], { maxBuffer: 256 * 1024 * 1024 });
    return out.length > 500 ? out : null;
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#x26;/gi, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\\//g, "/");
}

/** Extract candidate workbook links from a raw HTML/JSON page: <a href> anchors
 *  (with their text, needed when the month lives in the label not the URL — e.g.
 *  Sundaram), quoted JSON "url":"…xlsx" values (Next.js/JSON APIs, which may
 *  contain spaces), and any bare file URL in the text. Relative hrefs resolve
 *  against the page URL. */
export function extractFileLinks(html: string, pageUrl: string): HarvestedLink[] {
  const out: HarvestedLink[] = [];
  const seen = new Set<string>();
  const add = (rawUrl: string, text: string) => {
    let u = decodeHtml(rawUrl.trim());
    if (!u) return;
    try { u = new URL(u, pageUrl).href; } catch { return; }
    if (!FILE_RE.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push({ url: u, text: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  };
  // <a href="…">text</a>
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) add(m[1], m[2]);
  // quoted JSON/attribute values: "url":"…xlsx", href='…', data-file="…"
  for (const m of html.matchAll(/["'](https?:\/\/[^"']+?\.(?:xlsx?|zip)(?:\?[^"']*)?)["']/gi)) add(m[1], "");
  for (const m of html.matchAll(/["']((?:\/[^"']+?)\.(?:xlsx?|zip)(?:\?[^"']*)?)["']/gi)) add(m[1], "");
  // bare whitespace-delimited URLs (no quotes/spaces)
  for (const m of html.matchAll(/https?:\/\/[^"'`\\\s<>()]+?\.(?:xlsx?|zip)(?:\?[^"'`\\\s<>()]*)?/gi)) add(m[0], "");
  return out;
}

/** Download a set of resolved workbook links → parsed, normalized schemes.
 *  Shared by the page-scrape and json-api tiers. Dedupes primary-host vs CDN
 *  mirrors by filename, and any remaining dup by scheme code + as-of month. */
export function downloadAndParse(links: HarvestedLink[], opts: AmcParseOptions, referer?: string): { schemes: AmcScheme[]; fileCount: number } {
  const byFile = new Map<string, HarvestedLink>();
  for (const l of links) {
    const name = decodeURIComponent(l.url.split(/[?#]/)[0].split("/").pop() ?? l.url).toLowerCase();
    if (!byFile.has(name)) byFile.set(name, l);
  }
  const schemes: AmcScheme[] = [];
  const seen = new Set<string>();
  for (const l of byFile.values()) {
    const buf = curlBuffer(l.url, referer);
    if (!buf) continue;
    const head = buf.subarray(0, 64).toString("latin1").trimStart().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html")) continue; // walled/HTML
    // One multi-sheet workbook (most AMCs), falling back to a zip-of-workbooks
    // (DSP ships the monthly disclosure as a .zip of per-asset-class workbooks).
    let parsed: AmcScheme[] = [];
    try { parsed = parseAmcWorkbook(buf, opts); } catch { /* maybe a zip */ }
    if (parsed.length === 0) {
      try { parsed = parseZip(buf, opts); } catch { /* skip bad file */ }
    }
    for (const sc of parsed.map(normalizeSchemePct)) {
      const key = `${sc.schemeCode}|${sc.asOf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      schemes.push(sc);
    }
  }
  return { schemes, fileCount: byFile.size };
}

export interface PageScrapeResult {
  schemes: AmcScheme[];
  usedUrl: string | null;
  fileCount: number;
}

/** Override every scheme's as-on date with the disclosure month taken from the
 *  selected file's name — authoritative, and immune to a workbook whose
 *  per-holding dates (maturities, Tata's layout) the generic parser would
 *  otherwise mistake for the as-on date. No-op if the filename carries no month. */
function stampAsOfFromFilename(schemes: AmcScheme[], picked: HarvestedLink[]): void {
  const best = Math.max(0, ...picked.map((l) => monthScore(`${decodeURIComponent(l.url)} ${l.text}`)));
  if (best <= 0) return;
  const year = Math.floor((best - 1) / 12);
  const month1 = ((best - 1) % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const iso = `${year}-${String(month1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  for (const s of schemes) s.asOf = iso;
}

/** Scrape an AMC's monthly portfolio via curl: for each candidate page, harvest
 *  workbook links, keep the newest disclosure month, download + parse + merge. */
export function pageScrapeAmc(cfg: PageScrapeConfig, opts: AmcParseOptions, now: Date): PageScrapeResult {
  const urls = typeof cfg.urls === "function" ? cfg.urls(now) : cfg.urls;
  const floorScore = monthFloor(now);
  const ceilScore = monthCeil(now);
  for (const pageUrl of urls) {
    const html = curlText(pageUrl, cfg.referer);
    if (!html) continue;
    let links = extractFileLinks(html, pageUrl);
    if (cfg.include) links = links.filter((l) => cfg.include!.test(`${l.url} ${l.text}`));
    if (links.length === 0) continue;
    const picked = selectLatestMonthFiles(links, 200, floorScore, ceilScore);
    if (picked.length === 0) continue;
    const { schemes, fileCount } = downloadAndParse(picked, opts, cfg.referer ?? pageUrl);
    if (schemes.length > 0) {
      stampAsOfFromFilename(schemes, picked);
      return { schemes, usedUrl: pageUrl, fileCount };
    }
  }
  return { schemes: [], usedUrl: null, fileCount: 0 };
}

/**
 * Per-AMC page-scrape config. Each AMC below publishes its complete SEBI monthly
 * portfolio as per-scheme .xlsx workbooks on a non-walled, server-rendered page.
 */
export const PAGE_SCRAPE_CONFIG: Record<string, PageScrapeConfig> = {
  // Server-rendered HTML table of every statutory doc; keep the monthly-portfolio rows.
  samco: {
    urls: ["https://www.samcomf.com/StatutoryDisclosure"],
    include: /monthly[_\s-]*portfolio/i,
  },
  // Next.js page; per-scheme file URLs live in __NEXT_DATA__ JSON (spaces in names).
  zerodha: {
    urls: ["https://www.zerodhafundhouse.com/resources/disclosures"],
    include: /monthly[_\s-]*portfolio/i,
  },
  // Drupal exposed-filter view — the bare page lists nothing; the year+month TIDs
  // must be in the query string. Try the current then prior month (publish lag).
  taurus: {
    urls: (now: Date) => taurusUrls(now),
    include: /monthly[_\s-]*portfolio|portfolio[_\s-]*report/i,
  },
  // File host has no directory index and unguessable upload-timestamp names, but
  // AdvisorKhoj's form-download page lists the two monthly workbooks with dated labels.
  sundaram: {
    urls: ["https://www.advisorkhoj.com/form-download-centre/Mutual/Sundaram-Mutual-Fund/Monthly-Portfolio-Disclosures"],
    include: /monthly.?portfolio/i,
    referer: "https://www.advisorkhoj.com/",
  },
  // Kirby CMS listing; every disclosure is an <a href> to a hash-prefixed media
  // path. The complete monthly file is the "monthend-portfolio(s)" ZIP (a zip of
  // an equity+FOF and a debt workbook) — the half-yearly / debt-fortnightly /
  // fund-performance files on the same page don't start with that stem.
  dsp: {
    urls: ["https://www.dspim.com/mandatory-disclosures/portfolio-disclosures"],
    include: /monthend[-_]portfolios?[-_]/i,
  },
  // Next.js page; per-month consolidated workbook URLs are embedded in the
  // streaming __next_f JSON (field_media_document) on the betacms file host.
  // Filenames aren't templatable (human-entered), so scrape + pick newest month.
  tata: {
    urls: ["https://www.tatamutualfund.com/schemes-related/portfolio"],
    include: /monthly.{0,4}portfolio|portfolio.{0,4}as.{0,4}on/i,
  },
};

// Taurus year taxonomy-term ids (from the site's exposed filter); month TID = 280 + month.
const TAURUS_YEAR_TID: Record<number, number> = { 2022: 456, 2023: 473, 2024: 514, 2025: 558, 2026: 567 };
function taurusUrls(now: Date): string[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const months: [number, number][] = [[y, m], m > 1 ? [y, m - 1] : [y - 1, 12]];
  const out: string[] = [];
  for (const [yy, mm] of months) {
    const yt = TAURUS_YEAR_TID[yy];
    if (!yt) continue;
    out.push(`https://www.taurusmutualfund.com/index.php/monthly-portfolio?field_monthly_portfolio_target_id=${yt}&field_month_target_id=${280 + mm}`);
  }
  return out;
}
