/**
 * Monthly auto-fetch orchestrator — the job the 9th–12th cron runs.
 *
 * Primary source is the AdvisorKhoj aggregator (scripts/…/advisorkhoj.ts),
 * which lists every AMC's SEBI monthly portfolio disclosure on a single
 * server-rendered page per AMC. One code path therefore covers all ~50 AMCs:
 * resolve the latest month's link, download it (handling the .zip-of-workbooks
 * a few AMCs ship), parse complete holdings with the generic workbook parser,
 * normalize each scheme's weights to whole-percent, and write a normalized
 * snapshot to public/amc-holdings/<slug>.json (+ an index.json coverage map).
 *
 * A handful of AMCs host their file behind bot protection (Akamai) or only
 * expose a landing page rather than a direct file (HDFC, Mirae, Motilal,
 * Bandhan today) — those are recorded with a non-ok status rather than silently
 * dropped. For the three AMCs with a known stable direct URL (SBI, Nippon,
 * Kotak) we fall back to that (scripts/…/fetch.ts) if AdvisorKhoj ever fails.
 *
 * The (deferred) 2A integration maps these snapshots onto the tracker's
 * fincode-keyed scheme identities to feed the Holdings tab.
 *
 * Run: npx tsx scripts/ingest/amc-factsheets/run-monthly.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  discoverAmcs,
  slugFor,
  listPortfolioLinks,
  downloadFirstParsable,
  normalizeSchemePct,
  parseZip,
} from "./advisorkhoj";
import { fetchLatest } from "./fetch";
import { parseAmcWorkbook } from "./parse";
import { PAGE_SCRAPE_CONFIG, pageScrapeAmc } from "./page-scrape";
import { JSON_API_CONFIG, jsonApiAmc } from "./json-api";
import { launchBrowser } from "./browser";
import { browserFetchAmc, monthFloor, monthCeil } from "./browser-fallback";
import { BROWSER_CONFIG } from "./browser-hints";
import type { Browser } from "playwright";
import type { AmcParseOptions, AmcPortfolioSnapshot, AmcScheme } from "./types";

const OUT = path.resolve(process.cwd(), "public/amc-holdings");

// A generic profile is enough: scheme/holding detection is AMC-independent, and
// per-scheme pct is normalized after parsing (normalizeSchemePct). Values are
// quoted in ₹ Lakhs by the SEBI format, so valueToCr = 100.
const GENERIC: AmcParseOptions = { pctScale: 1, valueToCr: 100 };

// AMCs with a stable, templatable direct file URL to their OWN site. Tried
// BEFORE AdvisorKhoj (which aggregates with a ~1-month lag): the AMC publishes
// each month's complete SEBI portfolio on its own host within the 9th–12th
// window, so the direct file is the freshest and most complete source (e.g.
// SBI's consolidated workbook carries all ~116 schemes). Falls through to
// AdvisorKhoj if the direct URL for the latest month isn't up yet.
const DIRECT_PREFERRED = new Set(["sbi", "nippon", "kotak", "icici-pru"]);

// Safety net if AdvisorKhoj's AMC list can't be fetched (transient network).
const FALLBACK_AMCS = [
  "360 ONE Mutual Fund", "Abakkus Mutual Fund", "Aditya Birla Sun Life Mutual Fund",
  "Angel One Mutual Fund", "Axis Mutual Fund", "Bajaj Finserv Mutual Fund",
  "Bandhan Mutual Fund", "Bank of India Mutual Fund", "Baroda BNP Paribas Mutual Fund",
  "Canara Robeco Mutual Fund", "Capitalmind Mutual Fund", "Choice Mutual Fund",
  "DSP Mutual Fund", "Edelweiss Mutual Fund", "Franklin Templeton Mutual Fund",
  "Groww Mutual Fund", "HDFC Mutual Fund", "Helios Mutual Fund", "HSBC Mutual Fund",
  "ICICI Prudential Mutual Fund", "Invesco Mutual Fund", "ITI Mutual Fund",
  "Jio BlackRock Mutual Fund", "JM Financial Mutual Fund", "Kotak Mahindra Mutual Fund",
  "LIC Mutual Fund", "Mahindra Mutual Fund", "Mirae Asset Mutual Fund",
  "Motilal Oswal Mutual Fund", "Navi Mutual Fund", "Nippon India Mutual Fund",
  "NJ Mutual Fund", "Old Bridge Mutual Fund", "PGIM India Mutual Fund", "PPFAS Mutual Fund",
  "Quant Mutual Fund", "Quantum Mutual Fund", "Samco Mutual Fund", "SBI Mutual Fund",
  "Shriram Mutual Fund", "Sundaram Mutual Fund", "Tata Mutual Fund", "Taurus Mutual Fund",
  "The Wealth Company Mutual Fund", "Trust Mutual Fund", "Unifi Mutual Fund",
  "Union Mutual Fund", "UTI Mutual Fund", "WhiteOak Capital Mutual Fund", "Zerodha Mutual Fund",
];

type Status = "ok" | "blocked" | "empty" | "no-link" | "parse-empty";

interface IndexEntry {
  slug: string;
  amc: string;
  status: Status;
  source: "advisorkhoj" | "direct" | "browser" | "page-scrape" | "json-api" | null;
  asOfMonth: string | null;
  schemes: number;
  holdings: number;
  file: string | null;
  updatedAt: string;
}

function countHoldings(schemes: AmcScheme[]): number {
  return schemes.reduce((s, x) => s + x.holdings.length, 0);
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human month label from the modal per-scheme "as on" date, else a fallback.
 *  Future-dated `asOf` cells (seen in a few AMC workbooks, e.g. a "2030" typo)
 *  are ignored so they can't produce a nonsensical label. */
function monthLabelFromSchemes(schemes: AmcScheme[], fallback: string | null): string {
  const now = new Date();
  const ceilYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 2).padStart(2, "0")}`; // now+1 month
  const counts = new Map<string, number>();
  for (const s of schemes) {
    if (!s.asOf) continue;
    const key = s.asOf.slice(0, 7); // YYYY-MM
    if (key > ceilYm) continue; // ignore implausible future dates
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let modal: string | null = null;
  let best = -1;
  for (const [k, c] of counts) if (c > best || (c === best && k > (modal ?? ""))) { best = c; modal = k; }
  if (modal) {
    const [y, m] = modal.split("-");
    return `${MON3[+m - 1]} ${y}`;
  }
  return fallback ?? "latest";
}

async function writeSnapshot(
  slug: string,
  amc: string,
  sourceUrl: string,
  asOfMonth: string,
  schemes: AmcScheme[],
): Promise<{ file: string; holdings: number }> {
  const normalized = schemes.map(normalizeSchemePct);
  const snapshot: AmcPortfolioSnapshot = {
    amc,
    amcSlug: slug,
    sourceUrl,
    asOfMonth,
    fetchedAt: new Date().toISOString(),
    schemes: normalized,
  };
  const file = `${slug}.json`;
  await fs.writeFile(path.join(OUT, file), JSON.stringify(snapshot) + "\n", "utf8");
  return { file, holdings: countHoldings(normalized) };
}

async function processAmc(amc: string, year: number, browser: Browser | null): Promise<IndexEntry> {
  const slug = slugFor(amc);
  const base: IndexEntry = {
    slug, amc, status: "no-link", source: null, asOfMonth: null,
    schemes: 0, holdings: 0, file: null, updatedAt: new Date().toISOString(),
  };

  // 0) Page-scrape (curl) tier — for AMCs whose monthly portfolio sits on a
  //    non-walled, server-rendered page or embedded page JSON (SAMCO, Taurus,
  //    Sundaram, …). Cheaper than the browser and works in the sandbox, so try
  //    it first when configured.
  const scrapeCfg = PAGE_SCRAPE_CONFIG[slug];
  if (scrapeCfg) {
    const res = pageScrapeAmc(scrapeCfg, GENERIC, new Date());
    if (res.schemes.length > 0) {
      const label = monthLabelFromSchemes(res.schemes, null);
      const w = await writeSnapshot(slug, amc, res.usedUrl ?? "", label, res.schemes);
      return { ...base, status: "ok", source: "page-scrape", asOfMonth: label, schemes: res.schemes.length, holdings: w.holdings, file: w.file };
    }
  }

  // 0b) JSON-API (curl) tier — AMCs whose complete portfolio is behind a public
  //     JSON/REST API (LIC, Bandhan, PGIM India, WhiteOak, Choice).
  const apiCfg = JSON_API_CONFIG[slug];
  if (apiCfg) {
    const res = jsonApiAmc(slug, GENERIC, new Date());
    if (res.schemes.length > 0) {
      const label = monthLabelFromSchemes(res.schemes, null);
      const w = await writeSnapshot(slug, amc, res.usedUrl ?? "", label, res.schemes);
      return { ...base, status: "ok", source: "json-api", asOfMonth: label, schemes: res.schemes.length, holdings: w.holdings, file: w.file };
    }
  }

  // 0c) Direct-URL tier for AMCs with a templatable file on their own site.
  //     Tried before AdvisorKhoj so we get the freshest month (AdvisorKhoj lags
  //     ~1 month); fetchLatest probes newest-first and returns null if the
  //     latest month isn't published yet, letting us fall through cleanly.
  if (DIRECT_PREFERRED.has(slug)) {
    const f = fetchLatest(slug);
    if (f) {
      // One workbook (SBI/Nippon/Kotak) or a zip of per-scheme workbooks (ICICI);
      // a zip makes parseAmcWorkbook throw, so fall through to parseZip.
      let schemes: AmcScheme[] = [];
      try { schemes = parseAmcWorkbook(f.buf, GENERIC); } catch { /* maybe a zip */ }
      if (schemes.length === 0) schemes = parseZip(f.buf, GENERIC);
      if (schemes.length > 0) {
        const w = await writeSnapshot(slug, amc, f.url, f.asOfMonth, schemes);
        return { ...base, status: "ok", source: "direct", asOfMonth: f.asOfMonth, schemes: schemes.length, holdings: w.holdings, file: w.file };
      }
    }
  }

  // 1) AdvisorKhoj (primary). Try the newest links first, falling back to the
  //    prior month when the freshest link is a dead/unpublished URL.
  const links = listPortfolioLinks(amc, year);
  if (links.length > 0) {
    const res = downloadFirstParsable(links, GENERIC);
    const used = res.link ?? links[0];
    if (res.schemes.length > 0) {
      const w = await writeSnapshot(slug, amc, used.url, used.label, res.schemes);
      return { ...base, status: "ok", source: "advisorkhoj", asOfMonth: used.label, schemes: res.schemes.length, holdings: w.holdings, file: w.file };
    }
    base.status = res.kind === "blocked" ? "blocked" : res.kind === "empty" ? "empty" : "parse-empty";
    base.asOfMonth = used.label;
  }

  // 3) Browser fallback — clears Akamai bot-walls (HDFC, …) and runs JS-rendered
  //    disclosure pages (Mirae, …) that plain curl can't. Explicit config URLs
  //    (no-link AMCs) are tried before the AdvisorKhoj-resolved links.
  if (browser) {
    const cfg = BROWSER_CONFIG[slug] ?? {};
    // Explicit config URLs (no-link AMCs) + the resolved disclosure page. Older
    // months resolve to the same landing page, so one AdvisorKhoj link is enough.
    const urls = [...(cfg.urls ?? []), links[0]?.url].filter((u): u is string => !!u);
    if (urls.length > 0) {
      const now = new Date();
      const hints = { floorScore: monthFloor(now), ceilScore: monthCeil(now), ...cfg.hints };
      const r = await browserFetchAmc(browser, urls, GENERIC, hints);
      if (r.schemes.length > 0) {
        const label = monthLabelFromSchemes(r.schemes, base.asOfMonth);
        const w = await writeSnapshot(slug, amc, r.usedUrl ?? urls[0], label, r.schemes);
        return { ...base, status: "ok", source: "browser", asOfMonth: label, schemes: r.schemes.length, holdings: w.holdings, file: w.file };
      }
    }
  }

  return base;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const year = new Date().getUTCFullYear();

  let amcs = discoverAmcs();
  if (amcs.length < 10) {
    console.log(`AdvisorKhoj AMC discovery returned ${amcs.length}; using the built-in list.`);
    amcs = FALLBACK_AMCS;
  }
  // AMC_ONLY=<slug,slug,…> restricts the run to those AMCs — used for fast CI
  // iteration on the browser-fallback AMCs without a full ~50-AMC run. NOTE: a
  // filtered run writes a filtered index.json, so pair it with a no-commit test
  // dispatch (see amc-factsheet-monthly.yml) and keep index.json commits to full runs.
  const only = process.env.AMC_ONLY?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (only?.length) {
    amcs = amcs.filter((a) => only.includes(slugFor(a)));
    console.log(`AMC_ONLY set — restricting to ${amcs.length} AMC(s): ${amcs.map(slugFor).join(", ") || "(none matched)"}`);
  }
  console.log(`Fetching ${amcs.length} AMCs via AdvisorKhoj (year ${year})…\n`);

  // Browser is the tier-3 fallback for bot-walled / JS-rendered AMCs. Launch it
  // once and reuse across AMCs; degrade to curl-only if it can't start (or when
  // AMC_SKIP_BROWSER is set for a fast curl-only run).
  let browser: Browser | null = null;
  if (!process.env.AMC_SKIP_BROWSER) {
    try {
      browser = await launchBrowser();
    } catch (err) {
      console.log(`(browser fallback unavailable: ${(err as Error).message.slice(0, 80)})`);
    }
  }

  const index: IndexEntry[] = [];
  try {
    for (const amc of amcs) {
      try {
        const e = await processAmc(amc, year, browser);
        index.push(e);
        const mark = e.status === "ok" ? "✓" : "✗";
        const detail = e.status === "ok"
          ? `${e.asOfMonth}  schemes=${String(e.schemes).padStart(4)} holdings=${String(e.holdings).padStart(6)}  [${e.source}]`
          : e.status;
        console.log(`${mark} ${e.slug.padEnd(16)} ${detail}`);
      } catch (err) {
        console.log(`✗ ${slugFor(amc).padEnd(16)} ERROR ${(err as Error).message.slice(0, 80)}`);
        index.push({ slug: slugFor(amc), amc, status: "empty", source: null, asOfMonth: null, schemes: 0, holdings: 0, file: null, updatedAt: new Date().toISOString() });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  // Merge into any existing index so a filtered (AMC_ONLY) run updates only its
  // AMCs and preserves every other AMC's entry — a partial run must never drop
  // AMCs it didn't process. A full run overlays them all, so behaviour is
  // unchanged there.
  const bySlug = new Map<string, IndexEntry>();
  try {
    const prev = JSON.parse(await fs.readFile(path.join(OUT, "index.json"), "utf8")) as { amcs?: IndexEntry[] };
    for (const e of prev.amcs ?? []) bySlug.set(e.slug, e);
  } catch { /* no existing index yet */ }
  for (const e of index) bySlug.set(e.slug, e);
  const merged = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));

  const meta = {
    generatedAt: new Date().toISOString(),
    source: "AdvisorKhoj monthly portfolio disclosures (per-AMC, latest month)",
    latestMonthByAmc: Object.fromEntries(merged.filter((e) => e.asOfMonth).map((e) => [e.slug, e.asOfMonth])),
    coverage: {
      total: merged.length,
      ok: merged.filter((e) => e.status === "ok").length,
      needsFallback: merged.filter((e) => e.status !== "ok").map((e) => ({ slug: e.slug, status: e.status })),
    },
  };
  await fs.writeFile(path.join(OUT, "index.json"), JSON.stringify({ meta, amcs: merged }, null, 2) + "\n", "utf8");

  const ok = index.filter((e) => e.status === "ok").length;
  const holdings = index.reduce((s, e) => s + e.holdings, 0);
  console.log(`\nAdvisorKhoj monthly fetch: ${ok}/${index.length} processed AMCs OK, ${holdings.toLocaleString()} holdings total.`);
  const gaps = meta.coverage.needsFallback;
  if (gaps.length) console.log(`Needs fallback (${gaps.length}): ${gaps.map((g) => `${g.slug}(${g.status})`).join(", ")}`);
}

main().catch((e) => { console.error("run-monthly failed:", e); process.exit(1); });
