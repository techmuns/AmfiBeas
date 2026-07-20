/**
 * One-time history backfill — seed the last N months of complete SEBI monthly
 * portfolios for every AMC we can fetch, so the Holdings-tab month-over-month
 * view starts populated instead of accruing one month at a time.
 *
 * For each AMC it collects up to `BACK_MONTHS` disclosure months in ONE pass
 * (reusing each listing page / API once), keyed "YYYY-MM", via the same tier
 * that the monthly run uses — direct file template (SBI/Nippon/Kotak/ICICI),
 * page-scrape (DSP/Tata/Samco/…), JSON-API with history (ABSL/Axis/Franklin/
 * WhiteOak/PGIM), else the AdvisorKhoj aggregator (the long tail, ~5 months).
 * It then augments public/amc-holdings/<slug>.json with a `history` array (older
 * months) while keeping the newest as `schemes` — the crosswalk builder merges
 * them all into the per-scheme panels. Runs curl-only, so it works in the dev
 * sandbox and isn't bound by the monthly workflow's 60-min CI budget.
 *
 * Run: npx tsx scripts/ingest/amc-factsheets/backfill-history.ts [BACK_MONTHS]
 *   AMC_ONLY=slug,slug restricts the set (for testing).
 */
import fs from "node:fs";
import path from "node:path";
import { discoverAmcs, slugFor, advisorkhojMonths, normalizeSchemePct, listPortfolioLinks, parseZip } from "./advisorkhoj";
import { parseAmcWorkbook } from "./parse";
import { fetchMonth } from "./fetch";
import { PAGE_SCRAPE_CONFIG, pageScrapeAmcMonths } from "./page-scrape";
import { JSON_API_CONFIG, jsonApiAmcMonths } from "./json-api";
import { launchBrowser } from "./browser";
import { browserFetchAmc } from "./browser-fallback";
import { BROWSER_CONFIG } from "./browser-hints";
import { waybackFetch, WAYBACK_FALLBACK } from "./wayback";
import type { Browser } from "playwright";
import type { AmcMonthSnapshot, AmcParseOptions, AmcPortfolioSnapshot, AmcScheme } from "./types";

const OUT = path.resolve(process.cwd(), "public/amc-holdings");
const GENERIC: AmcParseOptions = { pctScale: 1, valueToCr: 100 };
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DIRECT = new Set(["sbi", "nippon", "kotak", "icici-pru"]);
const REFERER: Record<string, string> = { nippon: "https://mf.nipponindiaim.com/", sbi: "https://www.sbimf.com/portfolios" };

const BACK_MONTHS = Number(process.argv[2]) || 6;
const now = new Date();

const FALLBACK_AMCS = [
  "360 ONE Mutual Fund", "Abakkus Mutual Fund", "Aditya Birla Sun Life Mutual Fund",
  "Angel One Mutual Fund", "Axis Mutual Fund", "Bajaj Finserv Mutual Fund", "Bandhan Mutual Fund",
  "Bank of India Mutual Fund", "Baroda BNP Paribas Mutual Fund", "Canara Robeco Mutual Fund",
  "Capitalmind Mutual Fund", "Choice Mutual Fund", "DSP Mutual Fund", "Edelweiss Mutual Fund",
  "Franklin Templeton Mutual Fund", "Groww Mutual Fund", "HDFC Mutual Fund", "Helios Mutual Fund",
  "HSBC Mutual Fund", "ICICI Prudential Mutual Fund", "Invesco Mutual Fund", "ITI Mutual Fund",
  "Jio BlackRock Mutual Fund", "JM Financial Mutual Fund", "Kotak Mahindra Mutual Fund",
  "LIC Mutual Fund", "Mahindra Mutual Fund", "Mirae Asset Mutual Fund", "Motilal Oswal Mutual Fund",
  "Navi Mutual Fund", "Nippon India Mutual Fund", "NJ Mutual Fund", "Old Bridge Mutual Fund",
  "PGIM India Mutual Fund", "PPFAS Mutual Fund", "Quant Mutual Fund", "Quantum Mutual Fund",
  "Samco Mutual Fund", "SBI Mutual Fund", "Shriram Mutual Fund", "Sundaram Mutual Fund",
  "Tata Mutual Fund", "Taurus Mutual Fund", "The Wealth Company Mutual Fund", "Trust Mutual Fund",
  "Unifi Mutual Fund", "Union Mutual Fund", "UTI Mutual Fund", "WhiteOak Capital Mutual Fund",
  "Zerodha Mutual Fund",
];

function labelOf(ym: string): string { return `${MON3[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`; }
function isoLastDay(ym: string): string {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Direct file template months (SBI/Nippon/Kotak/ICICI): one file per month. */
function directMonths(slug: string): Map<string, AmcScheme[]> {
  const out = new Map<string, AmcScheme[]>();
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  for (let i = 0; i <= BACK_MONTHS; i++) {
    const f = fetchMonth(slug, y, m);
    if (f) {
      let schemes: AmcScheme[] = [];
      try { schemes = parseAmcWorkbook(f.buf, GENERIC); } catch { /* zip */ }
      if (schemes.length === 0) schemes = parseZip(f.buf, GENERIC);
      if (schemes.length) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        const iso = isoLastDay(ym);
        const norm = schemes.map(normalizeSchemePct);
        for (const sc of norm) sc.asOf = iso;
        out.set(ym, norm);
      }
    }
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

function collectMonths(slug: string, amc: string): Map<string, AmcScheme[]> {
  if (DIRECT.has(slug)) return directMonths(slug);
  if (PAGE_SCRAPE_CONFIG[slug]) return pageScrapeAmcMonths(PAGE_SCRAPE_CONFIG[slug], GENERIC, now, BACK_MONTHS);
  if (JSON_API_CONFIG[slug]) {
    const m = jsonApiAmcMonths(slug, GENERIC, now, BACK_MONTHS);
    if (m.size) return m; // some JSON-API AMCs have no history discoverer → fall through
  }
  return advisorkhojMonths(amc, now.getUTCFullYear(), now, GENERIC, BACK_MONTHS);
}

/** Internet Archive tier: months whose file URL on the AMC's own host (named by
 *  AdvisorKhoj) is 403'd to every direct path — curl AND CI browser IPs — by an
 *  Akamai edge (Edelweiss). archive.org's crawlers fetch from their own IP space;
 *  we take the original bytes from the snapshot. CI-only (the sandbox's egress
 *  policy blocks archive.org). Multiple files can share a month (the MF
 *  consolidated workbook + a SIF strategy file) — merge them. */
function waybackMonths(amc: string): Map<string, AmcScheme[]> {
  const out = new Map<string, AmcScheme[]>();
  const nowScore = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
  for (const link of listPortfolioLinks(amc, now.getUTCFullYear())) {
    const s = link.year * 12 + link.month;
    if (s > nowScore || s < nowScore - BACK_MONTHS) continue;
    const buf = waybackFetch(link.url);
    if (!buf) continue;
    let schemes: AmcScheme[] = [];
    try { schemes = parseAmcWorkbook(buf, GENERIC); } catch { /* maybe a zip */ }
    if (schemes.length === 0) schemes = parseZip(buf, GENERIC);
    console.log(`  (wayback ${link.label}: ${buf.length}b → ${schemes.length} scheme(s))`);
    if (schemes.length === 0) continue;
    const ym = `${link.year}-${String(link.month).padStart(2, "0")}`;
    const iso = isoLastDay(ym);
    const norm = schemes.map(normalizeSchemePct);
    for (const sc of norm) sc.asOf = iso;
    out.set(ym, [...(out.get(ym) ?? []), ...norm]);
  }
  return out;
}

/** Browser tier (opt-in, BACKFILL_BROWSER=1): for AMCs whose monthly portfolio
 *  sits behind a JS-rendered filter page (Canara, Invesco, Mirae, …) that curl
 *  can't read. AdvisorKhoj lists each month's filter-page URL; render each in a
 *  headless browser and harvest that month's workbooks. */
async function browserMonths(browser: Browser, amc: string): Promise<Map<string, AmcScheme[]>> {
  const out = new Map<string, AmcScheme[]>();
  const nowScore = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
  const cfg = BROWSER_CONFIG[slugFor(amc)] ?? {};
  for (const link of listPortfolioLinks(amc, now.getUTCFullYear())) {
    const s = link.year * 12 + link.month;
    if (s > nowScore || s < nowScore - BACK_MONTHS) continue;
    const ym = `${link.year}-${String(link.month).padStart(2, "0")}`;
    if (out.has(ym)) continue;
    const r = await browserFetchAmc(browser, [link.url], GENERIC, cfg.hints);
    if (r.schemes.length) {
      const iso = isoLastDay(ym);
      for (const sc of r.schemes) sc.asOf = iso;
      out.set(ym, r.schemes);
    }
  }
  return out;
}

async function main(): Promise<void> {
  let amcs = discoverAmcs();
  if (amcs.length < 10) amcs = FALLBACK_AMCS;
  const only = process.env.AMC_ONLY?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (only?.length) amcs = amcs.filter((a) => only.includes(slugFor(a)));

  let browser: Browser | null = null;
  if (process.env.BACKFILL_BROWSER) {
    try { browser = await launchBrowser(); } catch (e) { console.log(`(browser unavailable: ${(e as Error).message.slice(0, 60)})`); }
  }

  console.log(`Backfilling ${BACK_MONTHS} months for ${amcs.length} AMC(s)…\n`);
  let ok = 0;
  for (const amc of amcs) {
    const slug = slugFor(amc);
    let months: Map<string, AmcScheme[]>;
    try { months = collectMonths(slug, amc); } catch (e) { console.log(`✗ ${slug.padEnd(20)} ERROR ${(e as Error).message.slice(0, 60)}`); months = new Map(); }
    if (months.size === 0 && browser) {
      try { months = await browserMonths(browser, amc); } catch (e) { console.log(`  (browser ${slug}: ${(e as Error).message.slice(0, 40)})`); }
    }
    if (months.size === 0 && WAYBACK_FALLBACK.has(slug)) {
      try { months = waybackMonths(amc); } catch (e) { console.log(`  (wayback ${slug}: ${(e as Error).message.slice(0, 40)})`); }
    }
    if (months.size === 0) { console.log(`· ${slug.padEnd(20)} no history`); continue; }

    const yms = [...months.keys()].sort().reverse(); // newest first
    const latestYm = yms[0];
    const file = path.join(OUT, `${slug}.json`);
    let prev: Partial<AmcPortfolioSnapshot> = {};
    try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* new */ }
    const history: AmcMonthSnapshot[] = yms.slice(1).map((ym) => ({ asOfMonth: labelOf(ym), asOf: isoLastDay(ym), schemes: months.get(ym)! }));
    const snap: AmcPortfolioSnapshot = {
      amc: prev.amc ?? amc,
      amcSlug: slug,
      sourceUrl: prev.sourceUrl ?? "",
      asOfMonth: labelOf(latestYm),
      fetchedAt: now.toISOString(),
      schemes: months.get(latestYm)!,
      history,
    };
    fs.writeFileSync(file, JSON.stringify(snap) + "\n", "utf8");
    ok++;
    console.log(`✓ ${slug.padEnd(20)} ${yms.length} months: ${yms.join(" ")}`);
  }
  if (browser) await browser.close();
  console.log(`\nBackfilled ${ok}/${amcs.length} AMCs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
