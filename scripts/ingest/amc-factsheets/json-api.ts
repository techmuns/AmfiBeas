/**
 * JSON-API tier — AMCs that publish their complete SEBI monthly portfolio as
 * per-scheme .xlsx behind a PUBLIC (un-walled) JSON/REST API rather than as
 * links on a server-rendered page. Each adapter below hits that API with curl,
 * resolves the latest disclosure month, and returns the per-scheme file URLs;
 * the shared downloadAndParse() then fetches + parses them like everywhere else.
 *
 * All curl-based, so testable in the dev sandbox and identical on CI.
 */
import { execFileSync } from "node:child_process";
import { downloadAndParse } from "./page-scrape";
import type { HarvestedLink } from "./browser-fallback";
import type { AmcParseOptions, AmcScheme } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NUM: Record<string, number> = Object.fromEntries(MON3.map((m, i) => [m, i + 1]));

interface CurlOpts { method?: "GET" | "POST"; body?: string; headers?: Record<string, string> }
function curl(url: string, opts: CurlOpts = {}): string | null {
  // -g/--globoff: don't treat [ ] { } in URLs (Strapi filter syntax) as globs.
  const args = ["-fsL", "-g", "--max-time", "90", "-A", UA];
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push("-H", `${k}: ${v}`);
  if (opts.body != null) args.push("--data-raw", opts.body); // presence of data → POST
  args.push(url);
  try {
    return execFileSync("curl", args, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } catch {
    return null;
  }
}
// Parsed JSON body of an untyped third-party API, or null. Typed `any` on
// purpose (these bodies have no schema); field access is guarded at each site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(url: string, opts?: CurlOpts): any {
  const t = curl(url, opts);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}
// Minimal shapes for the fields each API body actually exposes (bodies are
// otherwise untyped; casting these keeps call sites type-checked).
interface BandhanItem { title?: string; sub_category?: string; acf_fields?: { disclosure_files?: { document_name?: string; document_link?: { url?: string } }[] } }
interface PgimTab { content?: { pdfPath?: string; dateMonthYear?: string; title?: string }[] }
interface ChoiceRow { reports?: { report_date?: string; file_path?: string }[] }
interface WoItem { attributes?: { scheme_name?: string; published_date?: string; doc_file?: { data?: { attributes?: { url?: string } }; url?: string } } }

/** year*12+month for the "<DD> <Month> <YYYY>" date in a string, else 0. */
function dateScore(s: string | undefined): number {
  const m = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/.exec(s || "");
  if (!m) return 0;
  const mo = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
  return mo ? +m[3] * 12 + mo : 0;
}
/** [[y,m] current, [y,m] previous] — AMCs publish the prior month around the 9th. */
function monthsToTry(now: Date): [number, number][] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return [[y, m], m > 1 ? [y, m - 1] : [y - 1, 12]];
}

// ---- Bandhan: WordPress finance-api, one post per scheme ----
function discoverBandhan(): HarvestedLink[] {
  const d = json("https://cmsnew.bandhanmutual.com/wp-json/finance-api/v1/posts/scheme-portfolios?bypass_pagination=true", { headers: { Accept: "application/json" } });
  const items = (d?.data ?? []) as BandhanItem[];
  const monthly = items.filter((i) => /monthly/i.test(i.sub_category || ""));
  const best = monthly.reduce((mx, i) => Math.max(mx, dateScore(i.title)), 0);
  if (!best) return [];
  const links: HarvestedLink[] = [];
  for (const i of monthly) {
    if (dateScore(i.title) !== best) continue;
    for (const df of i.acf_fields?.disclosure_files ?? []) {
      const u = df?.document_link?.url;
      if (typeof u === "string" && /\.xlsx?(\?|$)/i.test(u)) links.push({ url: u, text: df.document_name || i.title || "" });
    }
  }
  return links;
}

// ---- PGIM India: Angular SPA's REST API, POST per tab ----
function discoverPgim(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) {
    const links: HarvestedLink[] = [];
    for (const tabId of [12, 13, 14]) { // Equity / Debt / Fund of Funds
      const d = json("https://www.pgimindia.com/api/v1/brochure/published/disclosure", {
        method: "POST",
        body: JSON.stringify({ sectionId: "SECTION_747960037", tabId, month: mm, year: yy }),
        headers: { "Content-Type": "application/json" },
      });
      for (const tab of (d?.data ?? []) as PgimTab[]) {
        for (const c of tab.content ?? []) {
          const p: string = c.pdfPath || "";
          if (/\.xlsx(\?|$)/i.test(p) && dateScore(c.dateMonthYear) === yy * 12 + mm) {
            links.push({ url: p, text: c.title || "" });
          }
        }
      }
    }
    if (links.length) return links;
  }
  return [];
}

// ---- Choice: single POST returns every scheme's latest report ----
function discoverChoice(): HarvestedLink[] {
  const d = json("https://beta.choicemf.com/api/monthly-portfolio-report/portfolio-website-list", {
    method: "POST", body: "{}", headers: { "Content-Type": "application/json" },
  });
  const all: { date: string; path: string }[] = [];
  for (const r of (d?.body?.data ?? d?.data ?? []) as ChoiceRow[]) for (const rep of r.reports ?? []) if (rep.file_path) all.push({ date: rep.report_date || "", path: rep.file_path });
  if (!all.length) return [];
  const maxDate = all.map((a) => a.date).sort().pop();
  return all.filter((a) => a.date === maxDate).map((a) => ({ url: "https://doc.choicemf.com/" + a.path.replace(/^\//, ""), text: a.path }));
}

// ---- WhiteOak: Strapi REST, sorted newest-first ----
function discoverWhiteoak(): HarvestedLink[] {
  const d = json("https://cms.whiteoakamc.com/api/scheme-portfolios?filters[period][$eq]=Monthly&populate=*&sort=published_date:desc&pagination[pageSize]=100");
  const data = (d?.data ?? []) as WoItem[]; // Strapi v4: [{ attributes: {...} }]
  const maxDate = data.map((it) => it.attributes?.published_date || "").sort().pop();
  if (!maxDate) return [];
  const links: HarvestedLink[] = [];
  for (const it of data) {
    const a = it.attributes;
    if (!a || (a.published_date || "") !== maxDate) continue;
    const f = a.doc_file?.data?.attributes?.url ?? a.doc_file?.url;
    if (typeof f === "string" && /\.xlsx?(\?|$)/i.test(f)) links.push({ url: f.startsWith("http") ? f : `https://content.whiteoakamc.com${f}`, text: a.scheme_name || "" });
  }
  return links;
}

// ---- LIC: cascade — categories → scheme codes → per-scheme monthly file ----
const LIC_FORM = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" };
function discoverLic(now: Date): HarvestedLink[] {
  const schemes: { code: string; name: string }[] = [];
  for (const cat of ["Equity", "Hybrid", "ETFs & Index Funds", "Debt", "Solution Oriented Funds"]) {
    const html = curl("https://www.licmf.com/downloads/portfolio-filter-options", { method: "POST", body: `fund_category=${encodeURIComponent(cat)}&filter=category`, headers: LIC_FORM });
    if (!html) continue;
    for (const m of html.matchAll(/<option[^>]*value=['"]([^'"]*)['"][^>]*>([^<]*)<\/option>/gi)) {
      const code = m[1].trim();
      const name = m[2].trim();
      if (code && !/select|scheme name/i.test(name)) schemes.push({ code, name });
    }
  }
  const links: HarvestedLink[] = [];
  let month: [number, number] | null = null; // lock onto the first month that resolves
  for (const s of schemes) {
    for (const [yy, mm] of month ? [month] : monthsToTry(now)) {
      const html = curl("https://www.licmf.com/downloads/portfolio-files", { method: "POST", body: `scheme_code=${encodeURIComponent(s.code)}&fund_name=${encodeURIComponent(s.name)}&type=monthly_portfolio&month=${mm}&year=${yy}`, headers: LIC_FORM });
      const m = html && /href=['"]([^'"]*\/assets\/downloads\/portfolio\/[^'"]*\.xlsx)['"]/i.exec(html);
      if (m) {
        links.push({ url: m[1].startsWith("http") ? m[1] : `https://www.licmf.com${m[1]}`, text: s.name });
        month = [yy, mm];
        break;
      }
    }
  }
  return links;
}

export type ApiDiscoverer = (now: Date) => HarvestedLink[];
interface ApiConfig { discover: ApiDiscoverer; referer?: string; page: string }
export const JSON_API_CONFIG: Record<string, ApiConfig> = {
  bandhan: { discover: () => discoverBandhan(), page: "https://bandhanmutual.com/downloads/disclosures" },
  "pgim-india": { discover: (now) => discoverPgim(now), referer: "https://www.pgimindia.com/", page: "https://www.pgimindia.com/mutual-funds/disclosures/Portfolios/Monthly-Portfolio" },
  choice: { discover: () => discoverChoice(), referer: "https://www.choicemf.com/", page: "https://www.choicemf.com/disclosures/monthly-portfolio" },
  "whiteoak-capital": { discover: () => discoverWhiteoak(), page: "https://mf.whiteoakamc.com/regulatory-disclosures/scheme-portfolios" },
  lic: { discover: (now) => discoverLic(now), referer: "https://www.licmf.com/", page: "https://www.licmf.com/downloads/monthly-portfolio" },
};

export interface JsonApiResult { schemes: AmcScheme[]; usedUrl: string | null; fileCount: number }
export function jsonApiAmc(slug: string, opts: AmcParseOptions, now: Date): JsonApiResult {
  const cfg = JSON_API_CONFIG[slug];
  if (!cfg) return { schemes: [], usedUrl: null, fileCount: 0 };
  const links = cfg.discover(now);
  if (!links.length) return { schemes: [], usedUrl: null, fileCount: 0 };
  const { schemes, fileCount } = downloadAndParse(links, opts, cfg.referer);
  return { schemes, usedUrl: cfg.page, fileCount };
}
