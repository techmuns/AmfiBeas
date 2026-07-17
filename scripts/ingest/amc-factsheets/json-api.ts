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

// ---- Mirae Asset: per-scheme portfolio files keyed by a fixed scheme code ----
// /docs/default-source/portfolios/<code>-<monthname><year>.xlsx. Codes are
// human-assigned per scheme (harvested from the portfolio page's rendered links);
// the ETF workbooks name only the tracked index, so carry the fund name as link
// text for downloadAndParse's fallback.
const MIRAE_SCHEMES: [string, string][] = [
  ["mafcf", "Mirae Asset Flexi Cap Fund"],
  ["maonf", "Mirae Asset Overnight Fund"],
  ["200ewfof", "Mirae Asset BSE 200 Equal Weight ETF Fund of Fund"],
  ["smqetf", "Mirae Asset Nifty Smallcap 250 Momentum Quality 100 ETF"],
  ["psubetf", "Mirae Asset Nifty PSU Bank ETF"],
  ["b2cetfof", "Mirae Asset Nifty India New Age Consumption ETF Fund of Fund"],
  ["mamcf", "Mirae Asset Midcap Fund"],
  ["mabff", "Mirae Asset Banking and Financial Services Fund"],
  ["ipofof", "Mirae Asset BSE Select IPO ETF Fund of Fund"],
  ["tm750", "Mirae Asset Nifty Total Market Index Fund"],
];
function miraeMonth(yy: number, mm: number): HarvestedLink[] {
  const suf = `${MONTH_FULL[mm - 1].toLowerCase()}${yy}`; // "june2026"
  return MIRAE_SCHEMES.map(([code, name]) => ({ url: `https://www.miraeassetmf.co.in/docs/default-source/portfolios/${code}-${suf}.xlsx`, text: name }));
}
function discoverMirae(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) {
    const suf = `${MONTH_FULL[mm - 1].toLowerCase()}${yy}`;
    if (curl(`https://www.miraeassetmf.co.in/docs/default-source/portfolios/mafcf-${suf}.xlsx`)) return miraeMonth(yy, mm);
  }
  return [];
}

// ---- NJ Mutual Fund: server-rendered "Monthly Portfolio Disclosure" listing ----
// downloads.njmutualfund.com/njmf_download.php?nme=127 lists per-scheme workbooks as
// <a href="viewfile.php?file=NJ-MF-Monthly-Portfolio-<CODE>-<Month>-<Year>-<ts>.xlsx">.
const NJ_NAMES: Record<string, string> = {
  NJBAF: "NJ Balanced Advantage Fund", NJOVERFD: "NJ Overnight Fund", NJABF: "NJ Arbitrage Fund",
  NJFCP: "NJ Flexi Cap Fund", NJELSTCH: "NJ ELSS Tax Saver Scheme",
};
function njMonth(yy: number, mm: number): HarvestedLink[] {
  const html = curl("https://downloads.njmutualfund.com/njmf_download.php?nme=127");
  if (!html) return [];
  const mon = MONTH_FULL[mm - 1].toLowerCase();
  const links: HarvestedLink[] = [];
  const seen = new Set<string>();
  const re = /viewfile\.php\?file=(NJ-MF-Monthly-Portfolio-([A-Za-z]+)-([A-Za-z]+)-(\d{4})-\d+\.xlsx)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, file, code, month, year] = m;
    if (month.toLowerCase() !== mon || +year !== yy) continue;
    const url = `https://downloads.njmutualfund.com/viewfile.php?file=${file}`;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: NJ_NAMES[code.toUpperCase()] ?? `NJ ${code}` });
  }
  return links;
}
function discoverNj(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) { const l = njMonth(yy, mm); if (l.length) return l; }
  return [];
}

// ---- Zerodha Fund House: per-scheme monthly portfolio workbooks on the CDN ----
// assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/
//   "<CODE> - Monthly Portfolio <Month> <Year>.xlsx" (spaces URL-encoded). Each
// workbook is a single scheme whose name is a banner "MONTHLY PORTFOLIO STATEMENT
// OF <name> FOR <Month> <Year>" (findSchemeName step 1b lifts <name>, so no code→
// name map is needed). Codes cover equity/index/debt schemes; commodity ETFs
// (gold/silver) hold no ISIN'd securities and parse to zero holdings — those are
// dropped downstream, leaving the schemes that actually have a portfolio.
const ZERODHA_CODES = ["ZBSEN", "ZE100", "ZE150", "ZELSS", "ZEN50", "ZESML", "ZGFOF", "ZGOLD", "ZLIQD", "ZLTGC", "ZMIDS", "ZMLTI", "ZN250", "ZNFTY", "ZNH73", "ZNSDG", "ZOVER", "ZSFOF", "ZSLVR"];
function zerodhaUrl(code: string, yy: number, mm: number): string {
  return `https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/${encodeURIComponent(`${code} - Monthly Portfolio ${MONTH_FULL[mm - 1]} ${yy}`)}.xlsx`;
}
function zerodhaMonth(yy: number, mm: number): HarvestedLink[] {
  return ZERODHA_CODES.map((code) => ({ url: zerodhaUrl(code, yy, mm), text: "" }));
}
function discoverZerodha(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) {
    if (curl(zerodhaUrl("ZNFTY", yy, mm))) return zerodhaMonth(yy, mm);
  }
  return [];
}

// ---- Trust Mutual Fund: GetData JSON API lists every monthly portfolio ----
// POST api/api/Trust/GetData (no auth) returns resultSetArray of disclosure rows;
// filter to matching_slugs "portfolio-monthly-disclosure". Each row's title carries
// the as-on date ("… as on 30.06.2026") and fileurl the workbook — a single file
// holding all schemes. The API returns fileurl on the bare trustmf.com host with
// literal spaces; normalize to www + %20 so the fetch succeeds.
const TRUST_API = "https://www.trustmf.com/api/api/Trust/GetData";
const TRUST_BODY = JSON.stringify({ systemQueryFileName: "disclosuresweb.xml", tagName: "GetDisclosureByType", searchField: "", searchValue: "", sortField: "uploaddate", sortDirection: "DESC", replaceField: "_slug_", replaceValue: "portfolio-monthly-disclosure" });
const TRUST_HEADERS = { "content-type": "application/json; charset=UTF-8", origin: "https://www.trustmf.com", referer: "https://www.trustmf.com/disclosures" };
interface TrustRow { title?: string; fileurl?: string; matching_slugs?: string }
function trustNormUrl(u: string): string {
  return u.replace(/^https?:\/\/(?:www\.)?trustmf\.com/i, "https://www.trustmf.com").replace(/ /g, "%20");
}
/** Every monthly-portfolio row keyed by its as-on "YYYY-MM", newest first. */
function trustRows(): { ym: string; url: string }[] {
  const j = json(TRUST_API, { headers: TRUST_HEADERS, body: TRUST_BODY });
  const arr = (j?.resultSetArray ?? []) as TrustRow[];
  const out: { ym: string; url: string }[] = [];
  for (const row of arr) {
    if (!/portfolio-monthly-disclosure/i.test(row.matching_slugs ?? "") || !row.fileurl) continue;
    const m = /as\s+on\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(row.title ?? "");
    if (!m) continue;
    out.push({ ym: `${m[3]}-${m[2]}`, url: trustNormUrl(row.fileurl) });
  }
  return out;
}
function discoverTrust(now: Date): HarvestedLink[] {
  const rows = trustRows();
  for (const [yy, mm] of monthsToTry(now)) {
    const ym = `${yy}-${String(mm).padStart(2, "0")}`;
    const hit = rows.find((r) => r.ym === ym);
    if (hit) return [{ url: hit.url, text: "" }];
  }
  return rows.length ? [{ url: rows[0].url, text: "" }] : [];
}
function trustHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const { ym, url } of trustRows()) {
    if (!inWin(ym, now, back + 1) || out.has(ym)) continue;
    out.set(ym, [{ url, text: "" }]);
  }
  return out;
}

// ---- ITI Mutual Fund: AES-encrypted catalog API lists every monthly portfolio ----
// The SPA reads itiamc.com/jeeth/api/v1/catalog; BOTH request and response wrap
// their JSON in an `eData` field = AES-128-CBC ciphertext the app de/encrypts
// client-side (key+IV are static in the main bundle). getPartnerDocumentByType
// with {type:"Disclosure"} returns the whole disclosure catalog; the "Monthly
// Portfolio - <Month> <Year>" rows each carry a single consolidated workbook
// (all schemes). A row's own month/year is the PUBLISH month (data month + 1),
// so key by the as-on month parsed from the fileName label instead.
const ITI_API = "https://itiamc.com/jeeth/api/v1/catalog/getPartnerDocumentByType";
const ITI_KEY = Buffer.from("aar6tzij8o1snaar", "utf8"); // AES-128 key (16 bytes)
const ITI_IV = Buffer.from("0123456789ABCDEF", "utf8");
const ITI_HEADERS = { "content-type": "application/json", origin: "https://www.itiamc.com", referer: "https://www.itiamc.com/" };
function itiEnc(s: string): string {
  const c = crypto.createCipheriv("aes-128-cbc", ITI_KEY, ITI_IV);
  return Buffer.concat([c.update(Buffer.from(s, "utf8")), c.final()]).toString("base64");
}
function itiDec(b64: string): string {
  const d = crypto.createDecipheriv("aes-128-cbc", ITI_KEY, ITI_IV);
  return Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8");
}
interface ItiTopic { fileName?: string; url?: string }
interface ItiEnvelope { data?: { typeList?: { subTypesList?: { topicsList?: ItiTopic[] }[] }[] } }
/** Every "Monthly Portfolio - <Month> <Year>" workbook keyed by its as-on "YYYY-MM". */
function itiRows(): { ym: string; url: string }[] {
  const guid = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({ type: "Disclosure", guid, timeStamp: Date.now() });
  const body = JSON.stringify({ eData: itiEnc(payload) });
  const raw = curl(ITI_API, { method: "POST", body, headers: ITI_HEADERS });
  if (!raw) return [];
  let obj: ItiEnvelope;
  try { obj = JSON.parse(itiDec(JSON.parse(raw).eData)); } catch { return []; }
  const out: { ym: string; url: string }[] = [];
  for (const t of obj.data?.typeList ?? [])
    for (const s of t.subTypesList ?? [])
      for (const tp of s.topicsList ?? []) {
        const m = /^\s*monthly portfolio\s*-\s*([A-Za-z]+)\s+(\d{4})/i.exec(tp.fileName ?? "");
        if (!m || !tp.url || !/\.xlsx?(\?|$)/i.test(tp.url)) continue;
        const mo = MONTH_NUM[m[1].slice(0, 3).toLowerCase()];
        if (!mo) continue;
        out.push({ ym: `${m[2]}-${String(mo).padStart(2, "0")}`, url: tp.url.replace(/ /g, "%20") });
      }
  return out;
}
function discoverIti(now: Date): HarvestedLink[] {
  const rows = itiRows();
  for (const [yy, mm] of monthsToTry(now)) {
    const ym = `${yy}-${String(mm).padStart(2, "0")}`;
    const hit = rows.find((r) => r.ym === ym);
    if (hit) return [{ url: hit.url, text: "" }];
  }
  return rows.length ? [{ url: rows[0].url, text: "" }] : [];
}
function itiHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const { ym, url } of itiRows()) {
    if (!inWin(ym, now, back + 1) || out.has(ym)) continue;
    out.set(ym, [{ url, text: "" }]);
  }
  return out;
}

// ---- 360 ONE (formerly IIFL) Mutual Fund: monthly portfolio S3 links on the page ----
// The downloads SPA server-renders its full document catalog into the page's Next.js
// flight data — "View Results" only filters already-rendered client data, it fires no
// listing XHR. The "Monthly Portfolio <YYYY>" section maps each month to an OPAQUE S3
// workbook URL whose filename is not templatable (random hash suffix + inconsistent
// month spelling), so we discover from the page DOM itself: bound each year block by
// the next "year" marker and pair month → fileUrl within it (so pairing can't cross a
// year boundary). One consolidated workbook per month, holding all schemes.
const ONE_PAGE = "https://www.360.one/asset/mutual-funds/downloads/";
/** Every "Monthly Portfolio" workbook keyed by its as-on "YYYY-MM", newest wins. */
function oneRows(): { ym: string; url: string }[] {
  const html = curl(ONE_PAGE, { headers: { referer: "https://www.360.one/" } });
  if (!html) return [];
  const s = html.replace(/\\"/g, '"').replace(/\\\//g, "/"); // un-escape the embedded flight JSON
  const yearMarks = [...s.matchAll(/"year":"/g)].map((m) => m.index ?? 0);
  const out: { ym: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const ymatch of s.matchAll(/"year":"Monthly Portfolio (\d{4})"/g)) {
    const pos = ymatch.index ?? 0, year = ymatch[1];
    const end = yearMarks.find((p) => p > pos) ?? s.length; // bound to this year block
    for (const d of s.slice(pos, end).matchAll(/"month":"([A-Za-z]+)"[\s\S]*?"fileUrl":"(https:\/\/s3[^"]*IN_MF_MONTHLY_PORTFOLIO[^"]+\.xlsx?)"/g)) {
      const mo = MONTH_NUM[d[1].slice(0, 3).toLowerCase()];
      if (!mo) continue;
      const ym = `${year}-${String(mo).padStart(2, "0")}`;
      if (seen.has(ym)) continue;
      seen.add(ym);
      out.push({ ym, url: d[2] });
    }
  }
  return out;
}
function discoverOne(now: Date): HarvestedLink[] {
  const rows = oneRows();
  for (const [yy, mm] of monthsToTry(now)) {
    const hit = rows.find((r) => r.ym === `${yy}-${String(mm).padStart(2, "0")}`);
    if (hit) return [{ url: hit.url, text: "" }];
  }
  const newest = rows.map((r) => r.ym).sort().pop(); // else the newest month present
  const hit = newest ? rows.find((r) => r.ym === newest) : undefined;
  return hit ? [{ url: hit.url, text: "" }] : [];
}
function oneHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const { ym, url } of oneRows()) {
    if (!inWin(ym, now, back + 1) || out.has(ym)) continue;
    out.set(ym, [{ url, text: "" }]);
  }
  return out;
}

// ---- Capitalmind Mutual Fund: per-scheme monthly workbooks on the disclosures page ----
// The statutory-disclosures page renders each disclosure as
// <span class="fs-16">Month Year</span><a href="/uploads/…xlsx"> inside per-scheme
// accordions (only one open at a time in the browser, but all are in the DOM). The
// /uploads/ filenames are opaque (Strapi hash suffix) and inconsistently spelled
// (e.g. CMFLEXI_Portfolio_Disclosure_February_28_2026 has no "Monthly" token), so we
// key off the rendered month LABEL, not the filename: keep pairs whose file is a
// portfolio disclosure (excluding fortnightly + half-yearly) and whose label is a
// bare "Month YYYY" (drops day-stamped fortnightly and "Apr to Sep" half-yearly rows).
// One workbook per scheme, so a month yields several links (fewer for older months,
// as Arbitrage/Multi-Asset launched later).
const CM_PAGE = "https://capitalmindmf.com/statutory-disclosures.html";
const CM_ORIGIN = "https://capitalmindmf.com";
function cmRows(): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  const html = curl(CM_PAGE, { headers: { referer: `${CM_ORIGIN}/` } });
  if (!html) return out;
  for (const m of html.matchAll(/<span class="fs-16">([^<]+)<\/span>\s*<a\s+href="(\/uploads\/[^"]+\.xlsx?)"/g)) {
    const f = m[2].toLowerCase();
    if (!f.includes("portfolio") || f.includes("fortnight") || f.includes("half")) continue;
    const lm = /^([A-Za-z]+)\s+(\d{4})$/.exec(m[1].trim()); // strict "Month YYYY" → monthly only
    if (!lm) continue;
    const mo = MONTH_NUM[lm[1].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const ym = `${lm[2]}-${String(mo).padStart(2, "0")}`;
    const url = CM_ORIGIN + m[2];
    if (!out.has(ym)) out.set(ym, []);
    if (!out.get(ym)!.some((l) => l.url === url)) out.get(ym)!.push({ url, text: "" });
  }
  return out;
}
function discoverCm(now: Date): HarvestedLink[] {
  const all = cmRows();
  for (const [yy, mm] of monthsToTry(now)) {
    const hit = all.get(`${yy}-${String(mm).padStart(2, "0")}`);
    if (hit?.length) return hit;
  }
  const newest = [...all.keys()].sort().pop();
  return newest ? all.get(newest)! : [];
}
function cmHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const [ym, links] of cmRows()) {
    if (!inWin(ym, now, back + 1)) continue;
    out.set(ym, links);
  }
  return out;
}

// Shared discover/history for AMCs that publish ONE consolidated workbook per month
// as an already-resolved {ym,url} list (PPFAS / Shriram / Abakkus below).
function latestMonthLinks(rows: { ym: string; url: string }[], now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) {
    const hit = rows.find((r) => r.ym === `${yy}-${String(mm).padStart(2, "0")}`);
    if (hit) return [{ url: hit.url, text: "" }];
  }
  const newest = rows.map((r) => r.ym).sort().pop(); // else the newest month present
  const hit = newest ? rows.find((r) => r.ym === newest) : undefined;
  return hit ? [{ url: hit.url, text: "" }] : [];
}
function monthRowsHistory(rows: { ym: string; url: string }[], now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const { ym, url } of rows) {
    if (!inWin(ym, now, back + 1) || out.has(ym)) continue;
    out.set(ym, [{ url, text: "" }]);
  }
  return out;
}

// ---- PPFAS (Parag Parikh) Mutual Fund: consolidated monthly report on the index ----
// The portfolio-disclosure index lists, per month accordion, a consolidated all-schemes
// workbook with NO scheme-code prefix (PPFAS_Monthly_Portfolio_Report_<Month>_<DD>_<YYYY>
// .xls) alongside per-scheme breakouts (PPFCF_…, PPLF_…). Take the consolidated one; key
// by the filename's month/year. Anchoring the match to "/<YEAR>/PPFAS_Monthly" excludes
// the prefixed per-scheme files.
const PPFAS_ORIGIN = "https://amc.ppfas.com";
const PPFAS_PAGE = "https://amc.ppfas.com/downloads/portfolio-disclosure/";
function ppfasRows(): { ym: string; url: string }[] {
  const html = curl(PPFAS_PAGE, { headers: { referer: `${PPFAS_ORIGIN}/` } });
  if (!html) return [];
  const out: { ym: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="(\/downloads\/portfolio-disclosure\/\d{4}\/PPFAS_Monthly_Portfolio_Report_([A-Za-z]+)_\d{1,2}_(\d{4})\.xls[^"]*)"/g)) {
    const mo = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const ym = `${m[3]}-${String(mo).padStart(2, "0")}`;
    if (seen.has(ym)) continue;
    seen.add(ym);
    out.push({ ym, url: PPFAS_ORIGIN + m[1] });
  }
  return out;
}

// ---- Shriram Mutual Fund: consolidated monthly workbook on the CDN ----
// The statutory-disclosures page links a consolidated all-schemes workbook per month
// at cdn.shriramamc.in/…/Monthly-Portfolio-Shriram-Mutual-Fund-<Month>-<Year>.xls; the
// path also carries fortnightly / AUM / complaint files, so anchor on that filename.
const SHRIRAM_PAGE = "https://www.shriramamc.in/investor-statutory-disclosures";
function shriramRows(): { ym: string; url: string }[] {
  const html = curl(SHRIRAM_PAGE, { headers: { referer: "https://www.shriramamc.in/" } });
  if (!html) return [];
  const out: { ym: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/(https:\/\/cdn\.shriramamc\.in\/uploads\/[^"'\s]*Monthly-Portfolio-Shriram-Mutual-Fund-([A-Za-z]+)-(\d{4})\.xlsx?)/g)) {
    const mo = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const ym = `${m[3]}-${String(mo).padStart(2, "0")}`;
    if (seen.has(ym)) continue;
    seen.add(ym);
    out.push({ ym, url: m[1] });
  }
  return out;
}

// ---- Abakkus Mutual Fund: consolidated monthly workbook on the disclosures page ----
// The /uploads/ filenames are opaque and wildly inconsistent (Abakkus_MF_MONTHLY…,
// Abakkus_Mutual_Fund_31_05_2026, Monthly_Portfolio_Jun26_30_Jun…), so key off the
// rendered <h4> label. Monthly rows read "<Month> <DD>, <YYYY>" (month-end); fortnightly
// rows read "<DDth> <Month> <YYYY>" — so accept only the comma form with a month-end day.
const ABAKKUS_ORIGIN = "https://www.abakkusmf.com";
const ABAKKUS_PAGE = "https://www.abakkusmf.com/statutory-disclosures.html";
function abakkusRows(): { ym: string; url: string }[] {
  const html = curl(ABAKKUS_PAGE, { headers: { referer: `${ABAKKUS_ORIGIN}/` } });
  if (!html) return [];
  const out: { ym: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<h4 class="float-start fs-14 mb-0">([^<]+)<\/h4>\s*<a href="(\/uploads\/[^"]+\.xlsx?)"/g)) {
    const lm = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(m[1].trim());
    if (!lm || +lm[2] < 28 || /fortnight/i.test(m[2])) continue; // month-end monthly only
    const mo = MONTH_NUM[lm[1].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const ym = `${lm[3]}-${String(mo).padStart(2, "0")}`;
    if (seen.has(ym)) continue;
    seen.add(ym);
    out.push({ ym, url: ABAKKUS_ORIGIN + m[2] });
  }
  return out;
}

// ---- Old Bridge Mutual Fund: per-scheme monthly workbooks on the disclosures page ----
// Opaque /uploads/ filenames (June is just OBFX/OBAF/OBFE + a hash), so key off the DOM.
// Each item renders <h2>Old Bridge <Scheme> - <Month> <Year></h2><a …xlsx>. Bound to the
// "Monthly Portfolio" section (ends at the next non-FY section head, "Half Yearly …") so
// half-yearly portfolios and financials with the same markup don't leak in. One workbook
// per scheme → a month yields several links (fewer for older months; Focused launched later).
const OB_ORIGIN = "https://oldbridgemf.com";
const OB_PAGE = "https://oldbridgemf.com/statutory-disclosures.html";
function obRows(): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  const html = curl(OB_PAGE, { headers: { referer: `${OB_ORIGIN}/` } });
  if (!html) return out;
  const heads = [...html.matchAll(/<div class="grey-head[^"]*"[^>]*>([^<]+)<\/div>/g)];
  const startIdx = heads.findIndex((h) => h[1].trim() === "Monthly Portfolio");
  if (startIdx < 0) return out;
  const start = heads[startIdx].index ?? 0;
  const endHead = heads.slice(startIdx + 1).find((h) => { const t = h[1].trim(); return t !== "" && !/^\d{4}\s*-\s*\d{2}$/.test(t); });
  const seg = html.slice(start, endHead?.index ?? html.length);
  for (const m of seg.matchAll(/<h2 class="float-start fs-16 mb-0">([^<]+)<\/h2>\s*<a href="(\/uploads\/[^"]+\.xlsx?)"/g)) {
    const lm = /-\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(m[1]);
    if (!lm) continue;
    const mo = MONTH_NUM[lm[1].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const ym = `${lm[2]}-${String(mo).padStart(2, "0")}`;
    const url = OB_ORIGIN + m[2];
    if (!out.has(ym)) out.set(ym, []);
    if (!out.get(ym)!.some((l) => l.url === url)) out.get(ym)!.push({ url, text: "" });
  }
  return out;
}
function discoverOb(now: Date): HarvestedLink[] {
  const all = obRows();
  for (const [yy, mm] of monthsToTry(now)) {
    const hit = all.get(`${yy}-${String(mm).padStart(2, "0")}`);
    if (hit?.length) return hit;
  }
  const newest = [...all.keys()].sort().pop();
  return newest ? all.get(newest)! : [];
}
function obHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const [ym, links] of obRows()) {
    if (!inWin(ym, now, back + 1)) continue;
    out.set(ym, links);
  }
  return out;
}

// ---- Sundaram Mutual Fund: per-scheme workbooks via the fund-card JSON feed ----
// The site has no directory index and its download buttons call DownloadExcel('<code>'),
// which resolves the scheme's workbook from the live fund-card feed. That same feed
// (Fund_Card_data.json) carries, for every scheme, PORTFOLIO_PATH — the exact per-scheme
// workbook for the current reporting month at /Downloads_Pdf/Portfolio_Archives/<YYYY>/
// <Mon>/<Equity|Fixed>/<CODE>.xlsx. So enumerate all Equity + Fixed Income files straight
// from the feed (one workbook per scheme). History reuses each scheme's basename with the
// month folder swapped (the path template is stable month-to-month).
const SUN_ORIGIN = "https://www.sundarammutual.com";
const SUN_CARDS = `${SUN_ORIGIN}/Upload/JSON/Fund_Card_data.json`;
const SUN_PAGE = `${SUN_ORIGIN}/portfolio`;
interface SunFund { name: string; path: string }
const SUN_PATH_RE = /\/Portfolio_Archives\/(\d{4})\/([A-Za-z]{3})\/(?:Equity|Fixed)\/[^/]+\.xlsx?$/i;
function sunFunds(): SunFund[] {
  const j = json(SUN_CARDS, { headers: { referer: `${SUN_ORIGIN}/` } });
  if (!Array.isArray(j)) return [];
  const out: SunFund[] = [];
  for (const f of j as { GROUP_NAME?: string; PORTFOLIO_PATH?: string }[]) {
    const path = f.PORTFOLIO_PATH ?? "";
    if (SUN_PATH_RE.test(path)) out.push({ name: f.GROUP_NAME ?? "", path });
  }
  return out;
}
function sunTitleMon(mm: number): string {
  const m = MON3[mm - 1];
  return m.charAt(0).toUpperCase() + m.slice(1); // "jun" → "Jun", matching the feed's casing
}
function discoverSundaram(): HarvestedLink[] {
  // The live fund-card feed always carries the current reporting month for every scheme.
  return sunFunds().map((f) => ({ url: SUN_ORIGIN + f.path, text: f.name }));
}
function sundaramHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const funds = sunFunds();
  const out = new Map<string, HarvestedLink[]>();
  if (!funds.length) return out;
  for (const { yy, mm } of lastNMonths(now, back + 1)) {
    const ym = `${yy}-${String(mm).padStart(2, "0")}`;
    if (out.has(ym)) continue;
    const folder = `/Portfolio_Archives/${yy}/${sunTitleMon(mm)}/`;
    out.set(ym, funds.map((f) => ({
      url: SUN_ORIGIN + f.path.replace(/\/Portfolio_Archives\/\d{4}\/[A-Za-z]{3}\//, folder),
      text: f.name,
    })));
  }
  return out;
}

// ---- HSBC Mutual Fund: per-scheme workbooks on the open media host ----
// The monthly-portfolio listing is a Sitecore SPA (not curl-able) and the
// per-scheme workbooks appear on no server-rendered page, but the media host is
// OPEN and the URL is fully determined by the reporting date:
//   /-/media/…/portfolios/document-<DDMMYYYY>/hsbc-<slug>-<DD>-<month>-<YYYY>.xlsx
// (folder AND filename both carry the month-end reporting date; the workbook is
// per scheme). So enumerate HSBC's scheme universe against that host for the
// latest published month-end — probe the current month, then the prior; a scheme
// not filed for a month simply 404s and is skipped by downloadAndParse.
const HSBC_MEDIA = "https://www.assetmanagement.hsbc.co.in/-/media/files/attachments/india/mutual-funds/portfolios";
const HSBC_PAGE = "https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources";
// HSBC's scheme universe as name → URL slug (the marketing name slugified the way
// HSBC publishes it). The live host is the source of truth — a wrong/retired slug
// just 404s; a newly launched scheme is a one-line add here.
const HSBC_SCHEMES: { name: string; slug: string }[] = [
  { name: "HSBC Large Cap Fund", slug: "large-cap-fund" },
  { name: "HSBC Small Cap Fund", slug: "small-cap-fund" },
  { name: "HSBC Midcap Fund", slug: "midcap-fund" },
  { name: "HSBC Flexi Cap Fund", slug: "flexi-cap-fund" },
  { name: "HSBC Value Fund", slug: "value-fund" },
  { name: "HSBC Focused Fund", slug: "focused-fund" },
  { name: "HSBC ELSS Tax Saver Fund", slug: "elss-tax-saver-fund" },
  { name: "HSBC Business Cycles Fund", slug: "business-cycles-fund" },
  { name: "HSBC Multi Cap Fund", slug: "multi-cap-fund" },
  { name: "HSBC Consumption Fund", slug: "consumption-fund" },
  { name: "HSBC Infrastructure Fund", slug: "infrastructure-fund" },
  { name: "HSBC Aggressive Hybrid Fund", slug: "aggressive-hybrid-fund" },
  { name: "HSBC Balanced Advantage Fund", slug: "balanced-advantage-fund" },
  { name: "HSBC Equity Savings Fund", slug: "equity-savings-fund" },
  { name: "HSBC Arbitrage Fund", slug: "arbitrage-fund" },
  { name: "HSBC Conservative Hybrid Fund", slug: "conservative-hybrid-fund" },
  { name: "HSBC Multi Asset Allocation Fund", slug: "multi-asset-allocation-fund" },
  { name: "HSBC Nifty 50 Index Fund", slug: "nifty-50-index-fund" },
  { name: "HSBC Nifty Next 50 Index Fund", slug: "nifty-next-50-index-fund" },
  { name: "HSBC Corporate Bond Fund", slug: "corporate-bond-fund" },
  { name: "HSBC Banking and PSU Debt Fund", slug: "banking-and-psu-debt-fund" },
  { name: "HSBC Short Duration Fund", slug: "short-duration-fund" },
  { name: "HSBC Ultra Short Duration Fund", slug: "ultra-short-duration-fund" },
  { name: "HSBC Low Duration Fund", slug: "low-duration-fund" },
  { name: "HSBC Money Market Fund", slug: "money-market-fund" },
  { name: "HSBC Overnight Fund", slug: "overnight-fund" },
  { name: "HSBC Liquid Fund", slug: "liquid-fund" },
  { name: "HSBC Gilt Fund", slug: "gilt-fund" },
  { name: "HSBC Dynamic Bond Fund", slug: "dynamic-bond-fund" },
  { name: "HSBC Credit Risk Fund", slug: "credit-risk-fund" },
  { name: "HSBC Medium Duration Fund", slug: "medium-duration-fund" },
  { name: "HSBC Brazil Fund", slug: "brazil-fund" },
  { name: "HSBC Global Emerging Markets Fund", slug: "global-emerging-markets-fund" },
];
function hsbcUrl(slug: string, yy: number, mm: number): string {
  const d = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); // last day of month mm (1-based)
  const folder = `document-${String(d).padStart(2, "0")}${String(mm).padStart(2, "0")}${yy}`;
  const file = `hsbc-${slug}-${d}-${MONTH_FULL[mm - 1].toLowerCase()}-${yy}.xlsx`;
  return `${HSBC_MEDIA}/${folder}/${file}`;
}
function hsbcLinksFor(yy: number, mm: number): HarvestedLink[] {
  return HSBC_SCHEMES.map((s) => ({ url: hsbcUrl(s.slug, yy, mm), text: s.name }));
}
// The host blocks HEAD (403), so probe existence with the (small) Flexi Cap
// workbook GET — it's always filed for a published month.
function hsbcMonthPublished(yy: number, mm: number): boolean {
  return curl(hsbcUrl("flexi-cap-fund", yy, mm), { headers: { referer: `${HSBC_PAGE}` } }) != null;
}
function discoverHsbc(now: Date): HarvestedLink[] {
  for (const [yy, mm] of monthsToTry(now)) if (hsbcMonthPublished(yy, mm)) return hsbcLinksFor(yy, mm);
  return [];
}
function hsbcHistory(now: Date, back: number): Map<string, HarvestedLink[]> {
  const out = new Map<string, HarvestedLink[]>();
  for (const { yy, mm } of lastNMonths(now, back + 1)) {
    const ym = `${yy}-${String(mm).padStart(2, "0")}`;
    if (out.has(ym) || !hsbcMonthPublished(yy, mm)) continue;
    out.set(ym, hsbcLinksFor(yy, mm));
  }
  return out;
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
  mirae: (n, b) => loopMonths(n, b, miraeMonth),
  nj: (n, b) => loopMonths(n, b, njMonth),
  zerodha: (n, b) => loopMonths(n, b, zerodhaMonth),
  trust: (n, b) => trustHistory(n, b),
  iti: (n, b) => itiHistory(n, b),
  "360-one": (n, b) => oneHistory(n, b),
  capitalmind: (n, b) => cmHistory(n, b),
  ppfas: (n, b) => monthRowsHistory(ppfasRows(), n, b),
  shriram: (n, b) => monthRowsHistory(shriramRows(), n, b),
  abakkus: (n, b) => monthRowsHistory(abakkusRows(), n, b),
  "old-bridge": (n, b) => obHistory(n, b),
  sundaram: (n, b) => sundaramHistory(n, b),
  hsbc: (n, b) => hsbcHistory(n, b),
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
  mirae: { discover: (now) => discoverMirae(now), referer: "https://www.miraeassetmf.co.in/", page: "https://www.miraeassetmf.co.in/downloads/portfolio" },
  nj: { discover: (now) => discoverNj(now), referer: "https://downloads.njmutualfund.com/", page: "https://downloads.njmutualfund.com/njmf_download.php?nme=127" },
  zerodha: { discover: (now) => discoverZerodha(now), referer: "https://www.zerodhafundhouse.com/", page: "https://www.zerodhafundhouse.com/resources/disclosures" },
  trust: { discover: (now) => discoverTrust(now), referer: "https://www.trustmf.com/", page: "https://www.trustmf.com/disclosures?activeTab=portfolio-disclosures" },
  iti: { discover: (now) => discoverIti(now), referer: "https://www.itiamc.com/", page: "https://www.itiamc.com/statuory-disclosure" },
  "360-one": { discover: (now) => discoverOne(now), referer: "https://www.360.one/", page: ONE_PAGE },
  capitalmind: { discover: (now) => discoverCm(now), referer: `${CM_ORIGIN}/`, page: CM_PAGE },
  ppfas: { discover: (now) => latestMonthLinks(ppfasRows(), now), referer: `${PPFAS_ORIGIN}/`, page: PPFAS_PAGE },
  shriram: { discover: (now) => latestMonthLinks(shriramRows(), now), referer: "https://www.shriramamc.in/", page: SHRIRAM_PAGE },
  abakkus: { discover: (now) => latestMonthLinks(abakkusRows(), now), referer: `${ABAKKUS_ORIGIN}/`, page: ABAKKUS_PAGE },
  "old-bridge": { discover: (now) => discoverOb(now), referer: `${OB_ORIGIN}/`, page: OB_PAGE },
  sundaram: { discover: () => discoverSundaram(), referer: `${SUN_ORIGIN}/`, page: SUN_PAGE },
  hsbc: { discover: (now) => discoverHsbc(now), referer: `${HSBC_PAGE}`, page: HSBC_PAGE },
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
