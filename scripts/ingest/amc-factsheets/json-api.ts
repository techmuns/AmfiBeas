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
import crypto from "node:crypto";
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
interface UnionItem { Title?: string; Extension?: string; Url?: string }
interface AbslItem { pdfUrl?: string; ResourceLink?: string }
interface AxisDoc { documentName?: string; docuementURL?: string }
interface FrkCat { id?: string; dataRecords?: { linkdata?: FrkItem[] } }
interface FrkItem { frkReferenceDate?: string; dctermsTitle?: string; literatureHref?: string }

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
function pgimMonth(yy: number, mm: number): HarvestedLink[] {
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
  return links;
}
function discoverPgim(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = pgimMonth(yy, mm); if (l.length) return l; }
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

// ---- Canara Robeco: WordPress REST — enumerate all schemes, resolve file URLs ----
// The scheme-monthly-portfolio filter page is capped at 10 results with broken
// paging; the REST API exposes all ~27 schemes. Its cache is buggy (a call
// intermittently returns a truncated 2-item body), so retry until the page is
// full. The disclosure_media category-98 list is authoritative for WHICH schemes
// are the monthly portfolio (vs. half-yearly collisions in the same folder); the
// per-scheme .xlsx URLs live only in the media library, keyed by a 2-letter code.
const CANARA_MON = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canaraFull(baseUrl: string, page: number, perPage = 100, tries = 20): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let best: any[] = [];
  for (let i = 0; i < tries; i++) {
    const d = json(`${baseUrl}&per_page=${perPage}&page=${page}`);
    if (Array.isArray(d) && d.length > best.length) best = d;
    if (best.length >= perPage) break;
  }
  return best;
}
function canaraCode(t: string): string | null {
  const m = /^\s*([A-Za-z]{2})[\s\-_]/.exec(t.replace(/%E2%80%93/g, "-"));
  return m ? m[1].toUpperCase() : null;
}
// Disclosure titles read "IN – Canara Robeco Income Fund – May 2026": strip the
// leading 2-letter code and the trailing month so the link text is a clean fund
// name (used as the scheme name when the workbook's own header is unreadable).
function canaraCleanName(title: string): string {
  return (title || "")
    .replace(/%E2%80%93/g, "-").replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi, "-").replace(/[–—]/g, "-")
    .replace(/^\s*[A-Za-z]{2}\s*-\s*/, "")
    // trailing "- June-2026" / "- May 2026" / "- 30th June-2026" (any space/hyphen/comma between day/month/year)
    .replace(/\s*-\s*(?:\d{1,2}(?:st|nd|rd|th)?[\s-]+)?[A-Za-z]{3,9}\.?[\s,-]*\d{4}\s*$/i, "")
    .replace(/\s*-\s*$/, "").replace(/\s+/g, " ").trim();
}
function canaraMonthOnce(yy: number, mm: number): { links: HarvestedLink[]; expected: number } {
  const monthTok = `${CANARA_MON[mm - 1]} ${yy}`; // "may 2026"
  let fy = yy, fm = mm + 1; if (fm === 13) { fm = 1; fy++; } // portfolio month M → uploads/YYYY/(M+1)/
  const folder = `${fy}/${String(fm).padStart(2, "0")}`;
  // Step 1: which schemes are the monthly portfolio this month (+ their codes).
  // One page of 100 (date-desc, retried against the truncating WP cache) spans
  // ~3.5 months, so it already enumerates a back-month's full ~27-scheme set —
  // the coverage limit for older months is step 2 (the media list only surfaces
  // the newest ~100 uploads), not this listing.
  const dm = canaraFull("https://www.canararobeco.com/wp-json/wp/v2/disclosure_media?disclosure_category=98&orderby=date&order=desc&_fields=id,date,title", 1);
  const codes = new Map<string, string>();
  for (const p of dm) {
    const title: string = p?.title?.rendered ?? "";
    if (!title.toLowerCase().replace(/-/g, " ").includes(monthTok)) continue;
    const c = canaraCode(title);
    if (c && !codes.has(c)) codes.set(c, title);
  }
  if (!codes.size) return { links: [], expected: 0 };
  // Step 2: all .xlsx in the target upload folder. The media list is date-desc,
  // but the WP cache ignores &page (every page returns the newest ~100 uploads) —
  // so for the current month that's the whole folder, but for a back-month those
  // uploads are half-buried. Union two views: the newest ~100 (complete for the
  // latest month) and a slice scoped to the folder's own upload month via
  // after/before (recovers a back-month's uploads the newest list has since
  // pushed out). Non-regressive — the newest view alone is what worked before.
  const files = new Set<string>();
  const collect = (d: Array<{ source_url?: string }>) => {
    for (const u of d) {
      const su: string = u?.source_url ?? "";
      if (su.includes(`/uploads/${folder}/`) && /\.xlsx$/i.test(su)) files.add(su);
    }
  };
  collect(canaraFull("https://www.canararobeco.com/wp-json/wp/v2/media?orderby=date&order=desc&_fields=source_url,date", 1));
  let ny = fy, nm = fm + 1; if (nm === 13) { nm = 1; ny++; }
  const after = `${fy}-${String(fm).padStart(2, "0")}-01T00:00:00`;
  const before = `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00`;
  collect(canaraFull(`https://www.canararobeco.com/wp-json/wp/v2/media?orderby=date&order=desc&after=${after}&before=${before}&_fields=source_url,date`, 1));
  // Step 3: match each monthly scheme to its file by leading code, skipping the
  // half-yearly "…30th-Month" collisions that share a code in the same folder.
  const links: HarvestedLink[] = [];
  const list = [...files];
  for (const [code, title] of codes) {
    const hit = list.find((f) => {
      const base = (f.split("/").pop() ?? "").replace(/%E2%80%93/g, "-");
      return !/30th/i.test(base) && canaraCode(base) === code;
    });
    if (hit) links.push({ url: hit, text: canaraCleanName(title) });
  }
  return { links, expected: codes.size };
}
// Canara's WP cache intermittently truncates responses, so a single pass may
// resolve only some schemes. Retry the whole month until every enumerated scheme
// is matched (or a few rounds elapse); a good round returns all ~27.
function canaraMonth(yy: number, mm: number): HarvestedLink[] {
  let best: HarvestedLink[] = [];
  let expected = 0;
  for (let round = 0; round < 6; round++) {
    const r = canaraMonthOnce(yy, mm);
    expected = Math.max(expected, r.expected);
    if (r.links.length > best.length) best = r.links;
    if (expected === 0) { if (round >= 1) break; continue; } // no monthly posts this month
    if (best.length >= expected) break;
  }
  return best;
}
function discoverCanara(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = canaraMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- JM Financial: React SPA over an AES-encrypted download API ----
// The Portfolio-Disclosure page reads jmmfapi.jmfinancialmf.com; responses are
// AES-256-CBC ciphertext the app decrypts client-side (key+IV are static in the
// JS bundle). Category 2 / sub 4 = "Monthly Portfolio of Schemes", one .xlsx per
// scheme. The file's own header often can't be parsed for the scheme name, so we
// carry the API Title as the name (see downloadAndParse's fallback).
const JM_KEY = Buffer.from("6fa979f20126cb08aa645a8f495f6d85", "utf8"); // AES-256 key (32 bytes)
const JM_IV = Buffer.from("I8zyA4lVhMCaJ5Kg", "utf8");
interface JmItem { DocumentDate?: string; Title?: string; FileName?: string; FileEXT?: string }
function jmDecrypt(b64: string): JmItem[] {
  const d = crypto.createDecipheriv("aes-256-cbc", JM_KEY, JM_IV);
  const out = Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]);
  return JSON.parse(out.toString("latin1"));
}
function jmMonthlyItems(): JmItem[] {
  const raw = curl("https://jmmfapi.jmfinancialmf.com/api/GetDownloadNew", {
    method: "POST",
    body: JSON.stringify({ IICategoryID: 2, IISubCategoryID: 4, IVsearch: "" }),
    headers: { "Content-Type": "application/json", Origin: "https://www.jmfinancialmf.com" },
  });
  if (!raw) return [];
  try { return jmDecrypt(JSON.parse(raw).data) ?? []; } catch { return []; }
}
/** "Monthly Portfolio - JM Value Fund - June 30, 2026" → "JM Value Fund". */
function jmCleanName(title: string): string {
  return (title || "")
    .replace(/^\s*Monthly\s+Portfolio\s*-?\s*/i, "")
    .replace(/\s*-?\s*[A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4}\s*$/, "")
    .trim();
}
function jmHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const it of jmMonthlyItems()) {
    if ((it.FileEXT || "").toLowerCase() !== ".xlsx" || !it.FileName || !it.DocumentDate) continue;
    // DocumentDate is the upload month = data month + 1.
    let y = +it.DocumentDate.slice(0, 4), m = +it.DocumentDate.slice(5, 7) - 1;
    if (m === 0) { m = 12; y--; }
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (!inWin(ym, now, back)) continue;
    const url = "https://www.jmfinancialmf.com/" + it.FileName.split("/").map(encodeURIComponent).join("/");
    if (!out.has(ym)) out.set(ym, []);
    out.get(ym)!.push({ url, text: jmCleanName(it.Title || "") });
  }
  return out;
}
function discoverJm(now: Date): HarvestedLink[] {
  const h = jmHistory(now, 1);
  const ym = [...h.keys()].sort().pop();
  return ym ? h.get(ym)! : [];
}

// ---- Invesco: ASP.NET Web API — per-classification scheme list w/ monthly URLs ----
// ClassificationCompleteMonthlyHoldings lists the fund classes; CompleteMonthlyHoldings
// returns each scheme with a <Mon>Url .xlsx for every month of the queried year. One
// file per scheme; the workbook header is often unreadable, so the scheme name comes
// from the API "Name" via downloadAndParse's link-text fallback.
const INVESCO_API = "https://www.invescomutualfund.com/api";
const INVESCO_HDR = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.invescomutualfund.com/literature-and-form?tab=Complete",
};
function invescoMonth(yy: number, mm: number): HarvestedLink[] {
  const classes = json(`${INVESCO_API}/ClassificationCompleteMonthlyHoldings?page=Holding&year=${yy}&month=${mm}`, { headers: INVESCO_HDR });
  if (!Array.isArray(classes)) return [];
  const mon = MON3[mm - 1];
  const field = `${mon[0].toUpperCase()}${mon.slice(1)}Url`; // e.g. "JunUrl"
  const links: HarvestedLink[] = [];
  const seen = new Set<string>();
  for (const c of classes) {
    const cv: string | undefined = c?.FunClassificationValue;
    if (!cv) continue;
    const schemes = json(`${INVESCO_API}/CompleteMonthlyHoldings?year=${yy}&month=${mm}&classification=${encodeURIComponent(cv)}`, { headers: INVESCO_HDR });
    if (!Array.isArray(schemes)) continue;
    for (const s of schemes) {
      const url: string = (s?.[field] || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push({ url, text: (s?.Name || "").trim() });
    }
  }
  return links;
}
function discoverInvesco(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = invescoMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Bajaj Finserv: WordPress wp-json media, per-scheme monthly workbooks ----
// Files are "Bajaj-Finserv-<Scheme>_Monthly-Portfolio-as-on-30-Jun-2026.xls.xlsx".
// Page the media list (date-desc), keep the target month by the filename's date
// token; the scheme name is derived from the filename (downloadAndParse fallback).
function bajajMonth(yy: number, mm: number): HarvestedLink[] {
  const tok = `-${MON3[mm - 1]}-${yy}`; // "-jun-2026"
  const links: HarvestedLink[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    const items = json(`https://www.bajajamc.com/wp-json/wp/v2/media?search=Monthly-Portfolio&per_page=100&page=${page}&orderby=date&order=desc&_fields=source_url`);
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      const url: string = it?.source_url ?? "";
      const base = decodeURIComponent(url.split("/").pop() ?? "");
      if (!/Monthly-Portfolio/i.test(base) || !base.toLowerCase().includes(tok)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const name = base.replace(/_Monthly-Portfolio.*$/i, "").replace(/[-_]+/g, " ").trim();
      links.push({ url, text: name });
    }
  }
  return links;
}
function discoverBajaj(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = bajajMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- UTI: JSON API returning one consolidated monthly ZIP of scheme workbooks ----
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function utiMonth(yy: number, mm: number): HarvestedLink[] {
  const data = json(
    `https://www.utimf.com/api/get-consolidate-portfolio-disclosure?year=${yy}&month=${MONTH_FULL[mm - 1]}`,
    { headers: { accept: "*/*", Referer: "https://www.utimf.com/downloads/consolidate-all-portfolio-disclosure" } },
  );
  const rows = data?.rows;
  if (!Array.isArray(rows)) return [];
  const links: HarvestedLink[] = [];
  for (const r of rows) {
    const url: string = r?.url || r?.doc || "";
    if (url) links.push({ url, text: r?.name || "" });
  }
  return links;
}
function discoverUti(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = utiMonth(yy, mm); if (l.length) return l; }
  return [];
}
function lastDay(yy: number, mm: number): number { return new Date(Date.UTC(yy, mm, 0)).getUTCDate(); }

// ---- Bank of India: templatable Sitecore monthly-portfolio URL (sfvrsn optional) ----
function boiMonth(yy: number, mm: number): HarvestedLink[] {
  const url = `https://www.boimf.in/docs/default-source/investorcorner/monthly-portfolio/monthly-portfolio---${lastDay(yy, mm)}-${MONTH_FULL[mm - 1].toLowerCase()}-${yy}.xlsx`;
  return [{ url, text: "" }];
}
function discoverBoi(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = boiMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Quant: templatable Admin/disclouser URL ("…_june_30062026.xlsx") ----
function quantMonth(yy: number, mm: number): HarvestedLink[] {
  const dd = String(lastDay(yy, mm)).padStart(2, "0");
  const url = `https://quantmutual.com/Admin/disclouser/monthly_portfolio_${MONTH_FULL[mm - 1].toLowerCase()}_${dd}${String(mm).padStart(2, "0")}${yy}.xlsx`;
  return [{ url, text: "" }];
}
function discoverQuant(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = quantMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Motilal Oswal: AEM search API → the month-end "Scheme Portfolio Details" file ----
function motilalMonth(yy: number, mm: number): HarvestedLink[] {
  const data = json(
    "https://www.motilaloswalmf.com/content/aem-cloud-dept-backend-motilal-oswal/api/search-documents.json?year=&category=month%20end%20portfolio&month=&type=mf",
    { headers: { accept: "*/*", Referer: "https://www.motilaloswalmf.com/downloads/scheme-portfolio-details" } },
  );
  const results = data?.results;
  if (!Array.isArray(results)) return [];
  const tok = `${MONTH_FULL[mm - 1]} ${yy}`.toLowerCase(); // "june 2026"
  for (const r of results) {
    const title = String(r?.title ?? "").toLowerCase();
    const path = String(r?.path ?? "");
    if (!path || !/scheme portfolio details/.test(title) || !title.includes(tok)) continue;
    const url = "https://www.motilaloswalmf.com" + path.split("/").map(encodeURIComponent).join("/");
    return [{ url, text: (r?.title ?? "").trim() }];
  }
  return [];
}
function discoverMotilal(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = motilalMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Mahindra Manulife: AES-encrypted downloads API ----
// investorapi returns {payload} = AES-256-CBC (CryptoJS; key/IV static in the JS
// bundle) over the whole download tree. Decrypt, flatten to {title,fileUrl}, and
// pick "Monthly Portfolio Disclosure - <Month>, <Year>" (one consolidated workbook).
const MAH_KEY = Buffer.from("mahindra2024mahindra2024mahindra", "utf8");
const MAH_IV = Buffer.from("hasnainsheikh202", "utf8");
let mahCache: { title: string; url: string }[] | null = null;
function mahLeaves(): { title: string; url: string }[] {
  if (mahCache) return mahCache;
  const raw = curl("https://investorapi.mahindramanulife.com/api/v1/web/preLogin/downloads", {
    headers: { accept: "application/json", "x-client-id": "5dceebf9-845d-4519-b42f-f3279afafc00", platform: "web", origin: "https://mahindramanulife.com", Referer: "https://mahindramanulife.com/" },
  });
  const out: { title: string; url: string }[] = [];
  if (raw) {
    try {
      const d = crypto.createDecipheriv("aes-256-cbc", MAH_KEY, MAH_IV);
      const data = JSON.parse(Buffer.concat([d.update(Buffer.from(JSON.parse(raw).payload, "base64")), d.final()]).toString("utf8"));
      const walk = (o: unknown): void => {
        if (!o || typeof o !== "object") return;
        const r = o as Record<string, unknown>;
        if (typeof r.fileUrl === "string" && typeof r.title === "string") out.push({ title: r.title, url: r.fileUrl });
        for (const v of Object.values(r)) if (v && typeof v === "object") walk(v);
      };
      walk(data);
    } catch { /* decrypt/parse failed */ }
  }
  mahCache = out;
  return out;
}
function mahMonth(yy: number, mm: number): HarvestedLink[] {
  const mon = MONTH_FULL[mm - 1].toLowerCase();
  for (const l of mahLeaves()) {
    const t = l.title.toLowerCase();
    if (!t.includes("monthly portfolio disclosure") || !t.includes(mon) || !t.includes(String(yy))) continue;
    if (!/\.xlsx?(\?|$)/i.test(l.url)) continue;
    return [{ url: l.url, text: "" }];
  }
  return [];
}
function discoverMahindra(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = mahMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Unifi: WordPress wp-json media, per-scheme monthly workbooks ----
// Files are "MP-Unifi-<Scheme>-DDMMYYYY.xlsx". Keep the target month by the
// filename's date suffix; the scheme name is derived from the filename. (Unifi's
// host is Cloudflare-walled from the dev sandbox but reachable from the cron.)
function unifiMonth(yy: number, mm: number): HarvestedLink[] {
  const dateRe = new RegExp(`-\\d{2}${String(mm).padStart(2, "0")}${yy}\\.xlsx?$`, "i"); // "-30062026.xlsx"
  const links: HarvestedLink[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 2; page++) {
    const items = json(`https://unifimf.com/wp-json/wp/v2/media?search=MP-Unifi&per_page=100&page=${page}&orderby=date&order=desc&_fields=source_url`);
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      const url: string = it?.source_url ?? "";
      const base = decodeURIComponent(url.split("/").pop() ?? "");
      if (!dateRe.test(base) || seen.has(url)) continue;
      seen.add(url);
      const name = base.replace(/\.xlsx?$/i, "").replace(/^MP-/i, "").replace(/-\d{8}$/, "").replace(/-+/g, " ").trim();
      links.push({ url, text: name });
    }
  }
  return links;
}
function discoverUnifi(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = unifiMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- LIC: cascade — categories → scheme codes → per-scheme monthly file ----
const LIC_FORM = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" };
function licSchemeList(): { code: string; name: string }[] {
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
  return schemes;
}
/** All schemes' monthly-portfolio files for one (year, month). */
function licMonth(schemes: { code: string; name: string }[], yy: number, mm: number): HarvestedLink[] {
  const links: HarvestedLink[] = [];
  for (const s of schemes) {
    const html = curl("https://www.licmf.com/downloads/portfolio-files", { method: "POST", body: `scheme_code=${encodeURIComponent(s.code)}&fund_name=${encodeURIComponent(s.name)}&type=monthly_portfolio&month=${mm}&year=${yy}`, headers: LIC_FORM });
    const m = html && /href=['"]([^'"]*\/assets\/downloads\/portfolio\/[^'"]*\.xlsx)['"]/i.exec(html);
    if (m) links.push({ url: m[1].startsWith("http") ? m[1] : `https://www.licmf.com${m[1]}`, text: s.name });
  }
  return links;
}
function discoverLic(now: Date): HarvestedLink[] {
  const schemes = licSchemeList();
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

// ---- Union: Sitefinity OData — newest documents, filtered to monthly portfolio ----
function discoverUnion(): HarvestedLink[] {
  // One query for the newest docs across all folders; the monthly-portfolio
  // .xlsx among them are the latest month (Union publishes ~32/month). The Url
  // field carries the required ?sfvrsn version token. (Avoids scraping the
  // per-month folder GUIDs from the page — one of which is a 900+ doc catch-all.)
  const d = json("https://www.unionmf.com/api/downloads/documents?$orderby=PublicationDate%20desc&$top=100"); // 100 is the endpoint's max
  const items = ((d?.value ?? []) as UnionItem[]).filter(
    (it) => (it.Extension || "").toLowerCase() === ".xlsx" && /monthly portfolio/i.test(it.Title || "") && it.Url,
  );
  if (!items.length) return [];
  // "… 30-06-2026" in the Title → year*12+month; keep only the latest month.
  const monthOf = (t: string) => { const m = /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/.exec(t); return m ? +m[3] * 12 + +m[2] : 0; };
  const best = Math.max(...items.map((it) => monthOf(it.Title || "")));
  return items.filter((it) => monthOf(it.Title || "") === best).map((it) => ({ url: `https://www.unionmf.com${it.Url}`, text: it.Title || "" }));
}

// ---- ABSL: Sitecore accordion API — newest-first list, one ZIP per month ----
// month=%20 (a space) and year=0 are required, else the endpoint 500s.
const ABSL_API =
  "https://mutualfund.adityabirlacapital.com/postlogin/CustomApi/Resources/FactsheetAccordionById" +
  "?id=3ccab227-9de5-4494-b78d-2b4f7c0c054a" +
  "&ctype=%2Fsitecore%2Fcontent%2FRoot%2FBSL%2FLibrary%2FLists%2FFAQ%2FCustomer%20Types%2FIndividual" +
  "&month=%20&year=0";
function discoverAbsl(): HarvestedLink[] {
  const d = json(ABSL_API);
  const list = (d?.AccordionList ?? []) as AbslItem[];
  const top = list[0]; // newest first
  const u = top?.pdfUrl;
  if (typeof u !== "string" || !/\.zip(\?|$)/i.test(u)) return [];
  // The pdfUrl points at abcscprod.azureedge.net (unreachable via the sandbox
  // proxy); the same media path is mirrored on the main domain.
  const url = u.replace(/^https:\/\/abcscprod\.azureedge\.net/i, "https://mutualfund.adityabirlacapital.com");
  return [{ url, text: top.ResourceLink || "" }]; // ResourceLink: "Monthly Portfolios as on June 30, 2026"
}

// ---- Axis: Strapi CMS — POST for the month's docs, one consolidated workbook ----
// The bearer is a fixed public token the SPA fetches from /cms/token and echoes;
// hard-coded here (the file download itself needs no auth).
const AXIS_TOKEN =
  "Bearer c060dc4235de5fefc8fe5da8ef2b64d59fdf4f46c8ebeddb394a47daeac8c67c083d602ed9d4133d32b50ce33241fbedb6240c94cc801279292b3f301ae1ef6f713e38c38d778f9a7ec84bd4c094c0b5fa3cd8b3c5e9d5ae43b9a47ddcfe60b6339fe8395818d3f21ffaaaca455fe03e48b47a5079bf4a2eb86fece310b253ff";
const MON_FULL_TC = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function axisMonth(yy: number, mm: number): HarvestedLink[] {
  const d = json("https://www.axismf.com/cms/get-scheme-documents", {
    method: "POST",
    body: JSON.stringify({ sdType: "yearMonthSchemeDocs", sdID: "sdMonthSchemePortfolio", schemeTypeID: "ALL", year: String(yy), month: MON_FULL_TC[mm - 1] }),
    headers: { "Content-Type": "application/json", Authorization: AXIS_TOKEN },
  });
  const docs = (d?.data?.documentList ?? []) as AxisDoc[];
  // The all-schemes consolidated workbook is "Monthly Portfolio-DD MM YY"
  // (schemeID null); the other ~86 entries are per-scheme .xls files.
  const consolidated = docs.find((x) => /^Monthly Portfolio-\d/i.test(x.documentName || "") && x.docuementURL);
  return consolidated?.docuementURL ? [{ url: consolidated.docuementURL, text: `Monthly Portfolio as on ${MON_FULL_TC[mm - 1]} ${yy}` }] : [];
}
function discoverAxis(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = axisMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Franklin Templeton: Bloomreach literature catalog — one workbook/month ----
function discoverFranklin(): HarvestedLink[] {
  const d = json("https://www.franklintempletonindia.com/api/literature/v1/responseLitJson?type=report", { headers: { Accept: "application/json" } });
  const cat = ((d?.FirstDropDown ?? []) as FrkCat[]).find((c) => c.id === "MONTHLY-PORTFOLIO-DSCLR");
  const items = (cat?.dataRecords?.linkdata ?? []) as FrkItem[];
  const maxDate = items.map((i) => i.frkReferenceDate || "").sort().pop();
  if (!maxDate) return [];
  // The raw /en-in/ href returns the SPA shell; the file is under /download.
  return items
    .filter((i) => (i.frkReferenceDate || "") === maxDate && i.literatureHref)
    .map((i) => ({ url: "https://www.franklintempletonindia.com/download" + i.literatureHref, text: i.dctermsTitle || i.frkReferenceDate || "" }));
}

// ---- History (backfill): the last N disclosure months, keyed "YYYY-MM" ----
function ymOf(s: string | undefined | null): string | null {
  if (!s) return null;
  let m = /(\d{4})-(\d{2})-\d{2}/.exec(s); // ISO date
  if (m) return `${m[1]}-${m[2]}`;
  m = /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/.exec(s); // DD-MM-YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}`;
  const t = /([A-Za-z]{3,})[a-z]*\.?\s+\d{0,2},?\s*(\d{4})/.exec(s); // "June 30, 2026"
  if (t) { const mo = MONTH_NUM[t[1].slice(0, 3).toLowerCase()]; if (mo) return `${t[2]}-${String(mo).padStart(2, "0")}`; }
  return null;
}
function lastNMonths(now: Date, back: number): { yy: number; mm: number }[] {
  const out: { yy: number; mm: number }[] = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  for (let i = 0; i <= back; i++) { out.push({ yy: y, mm: m }); m--; if (m === 0) { m = 12; y--; } }
  return out;
}
function inWin(ym: string | null, now: Date, back: number): ym is string {
  if (!ym) return false;
  const s = +ym.slice(0, 4) * 12 + +ym.slice(5, 7);
  const n = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
  return s <= n && s >= n - back;
}
function abslHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  const d = json(ABSL_API);
  for (const it of (d?.AccordionList ?? []) as AbslItem[]) {
    const ym = ymOf(it.ResourceLink);
    if (!inWin(ym, now, back) || out.has(ym)) continue;
    const u = it.pdfUrl;
    if (typeof u !== "string" || !/\.zip(\?|$)/i.test(u)) continue;
    out.set(ym, [{ url: u.replace(/^https:\/\/abcscprod\.azureedge\.net/i, "https://mutualfund.adityabirlacapital.com"), text: it.ResourceLink || "" }]);
  }
  return out;
}
function franklinHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  const d = json("https://www.franklintempletonindia.com/api/literature/v1/responseLitJson?type=report", { headers: { Accept: "application/json" } });
  const cat = ((d?.FirstDropDown ?? []) as FrkCat[]).find((c) => c.id === "MONTHLY-PORTFOLIO-DSCLR");
  for (const i of (cat?.dataRecords?.linkdata ?? []) as FrkItem[]) {
    const ym = ymOf(i.frkReferenceDate);
    if (!inWin(ym, now, back) || out.has(ym) || !i.literatureHref) continue;
    out.set(ym, [{ url: "https://www.franklintempletonindia.com/download" + i.literatureHref, text: i.dctermsTitle || "" }]);
  }
  return out;
}
function whiteoakHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  const d = json("https://cms.whiteoakamc.com/api/scheme-portfolios?filters[period][$eq]=Monthly&populate=*&sort=published_date:desc&pagination[pageSize]=200");
  for (const it of (d?.data ?? []) as WoItem[]) {
    const a = it.attributes;
    const ym = ymOf(a?.published_date);
    if (!inWin(ym, now, back)) continue;
    const f = a?.doc_file?.data?.attributes?.url ?? a?.doc_file?.url;
    if (typeof f !== "string" || !/\.xlsx?(\?|$)/i.test(f)) continue;
    if (!out.has(ym)) out.set(ym, []);
    out.get(ym)!.push({ url: f.startsWith("http") ? f : `https://content.whiteoakamc.com${f}`, text: a?.scheme_name || "" });
  }
  return out;
}
function loopMonths(now: Date, back: number, fetchMonth: (yy: number, mm: number) => HarvestedLink[]): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const { yy, mm } of lastNMonths(now, back)) {
    const ym = `${yy}-${String(mm).padStart(2, "0")}`;
    if (out.has(ym)) continue;
    const l = fetchMonth(yy, mm);
    if (l.length) out.set(ym, l);
  }
  return out;
}
function bandhanHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  const d = json("https://cmsnew.bandhanmutual.com/wp-json/finance-api/v1/posts/scheme-portfolios?bypass_pagination=true", { headers: { Accept: "application/json" } });
  for (const i of (d?.data ?? []) as BandhanItem[]) {
    if (!/monthly/i.test(i.sub_category || "")) continue;
    const s = dateScore(i.title); // year*12+month
    if (!s) continue;
    const ym = `${Math.floor((s - 1) / 12)}-${String(((s - 1) % 12) + 1).padStart(2, "0")}`;
    if (!inWin(ym, now, back)) continue;
    for (const df of i.acf_fields?.disclosure_files ?? []) {
      const u = df?.document_link?.url;
      if (typeof u !== "string" || !/\.xlsx?(\?|$)/i.test(u)) continue;
      if (!out.has(ym)) out.set(ym, []);
      out.get(ym)!.push({ url: u, text: df.document_name || i.title || "" });
    }
  }
  return out;
}
function licHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const schemes = licSchemeList(); // category cascade once, then query each month
  const out = new Map<string, HarvestedLink[]>();
  for (const { yy, mm } of lastNMonths(now, back)) {
    const l = licMonth(schemes, yy, mm);
    if (l.length) out.set(`${yy}-${String(mm).padStart(2, "0")}`, l);
  }
  return out;
}
function unionHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  // $filter surfaces monthly-portfolio docs beyond the newest month (the plain
  // $top=100 is dominated by daily/other docs → only the latest month).
  const d = json("https://www.unionmf.com/api/downloads/documents?$filter=contains(Title,'Monthly%20Portfolio')&$orderby=PublicationDate%20desc&$top=100");
  const monthOf = (t: string) => { const m = /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, "0")}` : null; };
  for (const it of (d?.value ?? []) as UnionItem[]) {
    if ((it.Extension || "").toLowerCase() !== ".xlsx" || !/monthly portfolio/i.test(it.Title || "") || !it.Url) continue;
    const ym = monthOf(it.Title || "");
    if (!inWin(ym, now, back)) continue;
    if (!out.has(ym)) out.set(ym, []);
    out.get(ym)!.push({ url: `https://www.unionmf.com${it.Url}`, text: it.Title || "" });
  }
  return out;
}
type HistoryDiscoverer = (now: Date, back: number) => Map<string, HarvestedLink[]>;
const JSON_API_HISTORY: Record<string, HistoryDiscoverer> = {
  absl: (n, b) => abslHistory(n, b),
  "franklin-templeton": (n, b) => franklinHistory(n, b),
  "whiteoak-capital": (n, b) => whiteoakHistory(n, b),
  axis: (n, b) => loopMonths(n, b, axisMonth),
  "pgim-india": (n, b) => loopMonths(n, b, pgimMonth),
  bandhan: (n, b) => bandhanHistory(n, b),
  lic: (n, b) => licHistory(n, b),
  union: (n, b) => unionHistory(n, b),
  "canara-robeco": (n, b) => loopMonths(n, b, canaraMonth),
  "jm-financial": (n, b) => jmHistory(n, b),
  invesco: (n, b) => loopMonths(n, b, invescoMonth),
  "bajaj-finserv": (n, b) => loopMonths(n, b, bajajMonth),
  uti: (n, b) => loopMonths(n, b, utiMonth),
  "bank-of-india": (n, b) => loopMonths(n, b, boiMonth),
  quant: (n, b) => loopMonths(n, b, quantMonth),
  "motilal-oswal": (n, b) => loopMonths(n, b, motilalMonth),
  mahindra: (n, b) => loopMonths(n, b, mahMonth),
  unifi: (n, b) => loopMonths(n, b, unifiMonth),
};
/** Modal plausible "YYYY-MM" from the parsed schemes' own as-on dates, else null.
 *  Lets us key a month by the file CONTENT rather than the listing's date, which
 *  for WhiteOak is a publish date (~10 days into the next month). */
function contentYm(schemes: AmcScheme[]): string | null {
  const counts = new Map<string, number>();
  for (const s of schemes) {
    if (!s.asOf || !/^\d{4}-\d{2}/.test(s.asOf)) continue;
    const k = s.asOf.slice(0, 7);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null, bc = 0;
  for (const [k, c] of counts) if (c > bc) { bc = c; best = k; }
  return best;
}
/** Backfill: download+parse the last `back` disclosure months for a JSON-API AMC
 *  that exposes history, keyed "YYYY-MM" by as-on month, schemes normalized and
 *  as-on-stamped. */
export function jsonApiAmcMonths(slug: string, opts: AmcParseOptions, now: Date, back = 6): Map<string, AmcScheme[]> {
  const hist = JSON_API_HISTORY[slug];
  const cfg = JSON_API_CONFIG[slug];
  const out = new Map<string, AmcScheme[]>();
  if (!hist || !cfg) return out;
  for (const [listYm, links] of hist(now, back)) {
    const { schemes } = downloadAndParse(links, opts, cfg.referer);
    if (!schemes.length) continue;
    // Prefer the file's own as-on month when it's plausible and not LATER than
    // the listing month (WhiteOak lists a publish date one month ahead); this
    // is a no-op for the others, whose listing month is already the as-on month.
    const cy = contentYm(schemes);
    const ym = cy && cy <= listYm && inWin(cy, now, back + 1) ? cy : listYm;
    if (out.has(ym)) continue;
    const [y, m] = ym.split("-").map(Number);
    const iso = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    for (const sc of schemes) sc.asOf = iso;
    out.set(ym, schemes);
  }
  return out;
}

export type ApiDiscoverer = (now: Date) => HarvestedLink[];
interface ApiConfig { discover: ApiDiscoverer; referer?: string; page: string }
export const JSON_API_CONFIG: Record<string, ApiConfig> = {
  bandhan: { discover: () => discoverBandhan(), page: "https://bandhanmutual.com/downloads/disclosures" },
  "pgim-india": { discover: (now) => discoverPgim(now), referer: "https://www.pgimindia.com/", page: "https://www.pgimindia.com/mutual-funds/disclosures/Portfolios/Monthly-Portfolio" },
  choice: { discover: () => discoverChoice(), referer: "https://www.choicemf.com/", page: "https://www.choicemf.com/disclosures/monthly-portfolio" },
  "whiteoak-capital": { discover: () => discoverWhiteoak(), page: "https://mf.whiteoakamc.com/regulatory-disclosures/scheme-portfolios" },
  lic: { discover: (now) => discoverLic(now), referer: "https://www.licmf.com/", page: "https://www.licmf.com/downloads/monthly-portfolio" },
  union: { discover: () => discoverUnion(), referer: "https://www.unionmf.com/", page: "https://www.unionmf.com/about-us/downloads" },
  absl: { discover: () => discoverAbsl(), referer: "https://mutualfund.adityabirlacapital.com/", page: "https://mutualfund.adityabirlacapital.com/forms-and-downloads/portfolio" },
  axis: { discover: (now) => discoverAxis(now), referer: "https://www.axismf.com/", page: "https://www.axismf.com/statutory-disclosures/monthly-portfolio" },
  "franklin-templeton": { discover: () => discoverFranklin(), referer: "https://www.franklintempletonindia.com/", page: "https://www.franklintempletonindia.com/reports" },
  "canara-robeco": { discover: (now) => discoverCanara(now), referer: "https://www.canararobeco.com/", page: "https://www.canararobeco.com/statutory-disclosures/scheme-dashboard/scheme-monthly-portfolio" },
  "jm-financial": { discover: (now) => discoverJm(now), referer: "https://www.jmfinancialmf.com/", page: "https://www.jmfinancialmf.com/downloads/Portfolio-Disclosure" },
  invesco: { discover: (now) => discoverInvesco(now), referer: "https://www.invescomutualfund.com/", page: "https://www.invescomutualfund.com/literature-and-form?tab=Complete" },
  "bajaj-finserv": { discover: (now) => discoverBajaj(now), referer: "https://www.bajajamc.com/", page: "https://www.bajajamc.com/downloads?portfolio=" },
  uti: { discover: (now) => discoverUti(now), referer: "https://www.utimf.com/", page: "https://www.utimf.com/downloads/consolidate-all-portfolio-disclosure" },
  "bank-of-india": { discover: (now) => discoverBoi(now), referer: "https://www.boimf.in/", page: "https://www.boimf.in/investor-corner" },
  quant: { discover: (now) => discoverQuant(now), referer: "https://quantmutual.com/", page: "https://quantmutual.com/statutory-disclosures" },
  "motilal-oswal": { discover: (now) => discoverMotilal(now), referer: "https://www.motilaloswalmf.com/", page: "https://www.motilaloswalmf.com/downloads/scheme-portfolio-details" },
  mahindra: { discover: (now) => discoverMahindra(now), referer: "https://www.mahindramanulife.com/", page: "https://www.mahindramanulife.com/downloads" },
  unifi: { discover: (now) => discoverUnifi(now), referer: "https://unifimf.com/", page: "https://unifimf.com/statutorydocuments/" },
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
