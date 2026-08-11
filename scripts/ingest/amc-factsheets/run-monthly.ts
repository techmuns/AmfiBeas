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
import { waybackFetch, WAYBACK_FALLBACK } from "./wayback";
import {
  isoEndOfMonth,
  isPlausibleYm,
  labelOfYm,
  MAX_SNAPSHOT_MONTHS,
  latestDisclosureYm,
  mergeMonthBuckets,
  modalYm,
  normalizeMonthLabel,
  ymOf,
} from "./months";
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

type Status = "ok" | "blocked" | "empty" | "no-link" | "parse-empty" | "no-month";

interface IndexEntry {
  slug: string;
  amc: string;
  status: Status;
  source: "advisorkhoj" | "direct" | "browser" | "page-scrape" | "json-api" | "wayback" | null;
  /** Newest month the snapshot now holds — what the dashboard shows. */
  asOfMonth: string | null;
  /** Month THIS run downloaded. Equal to asOfMonth on a healthy fetch; older
   *  when the AMC hasn't published yet (so staleness is visible in the index
   *  rather than only in the logs). */
  fetchedMonth?: string | null;
  /** How many months of history the snapshot holds after the merge. */
  months?: number;
  schemes: number;
  holdings: number;
  file: string | null;
  updatedAt: string;
}

function countHoldings(schemes: AmcScheme[]): number {
  return schemes.reduce((s, x) => s + x.holdings.length, 0);
}

/** The disclosure month a fetch actually delivered, as "YYYY-MM", or null when
 *  neither the file nor the tier names a plausible one.
 *
 *  The file's own as-on dates win: the tier's label is what we ASKED for (a
 *  templated URL, a listing link), and an AMC that hasn't published yet happily
 *  serves last month's workbook from this month's URL. Labelling that by the URL
 *  would silently overwrite a real month with older holdings. */
function resolveMonth(schemes: AmcScheme[], tierLabel: string | null): string | null {
  const content = modalYm(schemes);
  if (content) return content;
  const fromLabel = ymOf(tierLabel);
  return isPlausibleYm(fromLabel) ? fromLabel : null;
}

interface WriteResult {
  file: string;
  holdings: number;
  /** Canonical label of the month this run fetched ("Jul-26"). */
  fetchedMonth: string;
  /** Canonical label of the newest month the snapshot holds after merging. */
  latestMonth: string;
  months: number;
}

/**
 * Write an AMC's snapshot, MERGING the fetched month into the months the file
 * already holds.
 *
 * This used to overwrite the file with just the month it had downloaded, so the
 * first monthly cron after the history backfill wiped every older month — a
 * fund's month-over-month panel went from six columns to one. The months a
 * previous run captured are data we cannot re-fetch once an AMC rotates its
 * files off its site, so they are preserved here and only ever displaced by a
 * fresher copy of the SAME month.
 *
 * Returns null when the month can't be identified, in which case nothing is
 * written: a snapshot filed under an unknown month can neither be deduped nor
 * ordered, and would poison the merge for every later run.
 */
async function writeSnapshot(
  slug: string,
  amc: string,
  sourceUrl: string,
  asOfMonth: string | null,
  schemes: AmcScheme[],
): Promise<WriteResult | null> {
  const ym = resolveMonth(schemes, asOfMonth);
  if (!ym) return null;

  const normalized = schemes.map(normalizeSchemePct);
  const file = `${slug}.json`;
  const full = path.join(OUT, file);

  let prev: Partial<AmcPortfolioSnapshot> = {};
  try { prev = JSON.parse(await fs.readFile(full, "utf8")) as AmcPortfolioSnapshot; } catch { /* first fetch */ }
  const existing = prev.schemes?.length
    ? [{ asOfMonth: prev.asOfMonth ?? "", asOf: prev.schemes[0]?.asOf ?? null, schemes: prev.schemes }, ...(prev.history ?? [])]
    : (prev.history ?? []);

  const merged = mergeMonthBuckets(
    [{ asOfMonth: labelOfYm(ym), asOf: isoEndOfMonth(ym), schemes: normalized }],
    existing,
    MAX_SNAPSHOT_MONTHS,
  );
  const latest = merged[0];
  const latestYm = ymOf(latest.asOfMonth)!;

  const snapshot: AmcPortfolioSnapshot = {
    amc,
    amcSlug: slug,
    // The URL we just used describes the month we just fetched — keep the older
    // one on the record when this fetch turned out to be an older month.
    sourceUrl: latestYm === ym ? sourceUrl : prev.sourceUrl ?? sourceUrl,
    asOfMonth: latest.asOfMonth,
    fetchedAt: new Date().toISOString(),
    schemes: latest.schemes,
    history: merged.slice(1),
  };
  await fs.writeFile(full, JSON.stringify(snapshot) + "\n", "utf8");
  return {
    file,
    holdings: countHoldings(latest.schemes),
    fetchedMonth: labelOfYm(ym),
    latestMonth: latest.asOfMonth,
    months: merged.length,
  };
}

async function processAmc(amc: string, year: number, browser: Browser | null): Promise<IndexEntry> {
  const slug = slugFor(amc);
  const base: IndexEntry = {
    slug, amc, status: "no-link", source: null, asOfMonth: null,
    schemes: 0, holdings: 0, file: null, updatedAt: new Date().toISOString(),
  };
  // A tier that only has a STALE month must not stop the tiers behind it. Kotak
  // moved its consolidated workbook to a new path, the old path kept serving May
  // — and because the direct tier "succeeded", AdvisorKhoj (which had June) was
  // never tried, so Kotak sat two months behind while reporting ok. So each tier
  // returns immediately only when it delivered the newest month an AMC could
  // have published; otherwise we keep its result as a floor and try the next.
  // Every tier writes through writeSnapshot, which merges, so continuing can
  // only add months.
  const targetMonth = labelOfYm(latestDisclosureYm(new Date()));
  let best: IndexEntry | null = null;
  const settle = (e: IndexEntry): IndexEntry | null => {
    if (!best || (ymOf(e.asOfMonth) ?? "") > (ymOf(best.asOfMonth) ?? "")) best = e;
    return e.fetchedMonth === targetMonth ? e : null;
  };

  // 0) Page-scrape (curl) tier — for AMCs whose monthly portfolio sits on a
  //    non-walled, server-rendered page or embedded page JSON (SAMCO, Taurus,
  //    Sundaram, …). Cheaper than the browser and works in the sandbox, so try
  //    it first when configured.
  const scrapeCfg = PAGE_SCRAPE_CONFIG[slug];
  if (scrapeCfg) {
    const res = pageScrapeAmc(scrapeCfg, GENERIC, new Date());
    if (res.schemes.length > 0) {
      const w = await writeSnapshot(slug, amc, res.usedUrl ?? "", null, res.schemes);
      if (w) {
        const done = settle({ ...base, status: "ok", source: "page-scrape", asOfMonth: w.latestMonth, fetchedMonth: w.fetchedMonth, months: w.months, schemes: res.schemes.length, holdings: w.holdings, file: w.file });
        if (done) return done;
      } else {
        base.status = "no-month"; // month unidentifiable — try the next tier
      }
    }
  }

  // 0b) JSON-API (curl) tier — AMCs whose complete portfolio is behind a public
  //     JSON/REST API (LIC, Bandhan, PGIM India, WhiteOak, Choice).
  const apiCfg = JSON_API_CONFIG[slug];
  if (apiCfg) {
    const res = jsonApiAmc(slug, GENERIC, new Date());
    if (res.schemes.length > 0) {
      const w = await writeSnapshot(slug, amc, res.usedUrl ?? "", null, res.schemes);
      if (w) {
        const done = settle({ ...base, status: "ok", source: "json-api", asOfMonth: w.latestMonth, fetchedMonth: w.fetchedMonth, months: w.months, schemes: res.schemes.length, holdings: w.holdings, file: w.file });
        if (done) return done;
      } else {
        base.status = "no-month";
      }
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
        if (w) {
          const done = settle({ ...base, status: "ok", source: "direct", asOfMonth: w.latestMonth, fetchedMonth: w.fetchedMonth, months: w.months, schemes: schemes.length, holdings: w.holdings, file: w.file });
          if (done) return done;
        } else {
          base.status = "no-month";
        }
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
      if (w) {
        const done = settle({ ...base, status: "ok", source: "advisorkhoj", asOfMonth: w.latestMonth, fetchedMonth: w.fetchedMonth, months: w.months, schemes: res.schemes.length, holdings: w.holdings, file: w.file });
        if (done) return done;
      } else {
        base.status = "no-month";
      }
    } else {
      base.status = res.kind === "blocked" ? "blocked" : res.kind === "empty" ? "empty" : "parse-empty";
    }
    base.asOfMonth = normalizeMonthLabel(used.label);
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
        const w = await writeSnapshot(slug, amc, r.usedUrl ?? urls[0], base.asOfMonth, r.schemes);
        if (w) {
          const done = settle({ ...base, status: "ok", source: "browser", asOfMonth: w.latestMonth, fetchedMonth: w.fetchedMonth, months: w.months, schemes: r.schemes.length, holdings: w.holdings, file: w.file });
          if (done) return done;
        } else {
          base.status = "no-month";
        }
      }
    }
  }

  // 4) Internet Archive fallback — for hosts whose Akamai edge 403s BOTH curl
  //    and CI's browser by IP (Edelweiss), fetch the AdvisorKhoj-named file URLs
  //    on the AMC's own host through archive.org instead (see wayback.ts).
  //    Newest month first; stop at the first month whose file parses.
  if (WAYBACK_FALLBACK.has(slug)) {
    for (const link of links.slice(0, 4)) {
      const buf = waybackFetch(link.url);
      if (!buf) continue;
      let schemes: AmcScheme[] = [];
      try { schemes = parseAmcWorkbook(buf, GENERIC); } catch { /* maybe a zip */ }
      if (schemes.length === 0) schemes = parseZip(buf, GENERIC);
      console.log(`  (wayback ${link.label}: ${buf.length}b → ${schemes.length} scheme(s))`);
      if (schemes.length === 0) continue;
      const w = await writeSnapshot(slug, amc, link.url, link.label, schemes);
      if (!w) { base.status = "no-month"; continue; }
      const done = settle({ ...base, status: "ok", source: "wayback", asOfMonth: w.latestMonth, fetchedMonth: w.fetchedMonth, months: w.months, schemes: schemes.length, holdings: w.holdings, file: w.file });
      if (done) return done;
    }
  }

  // Nothing fetched. Report what the snapshot on disk still holds rather than the
  // month we tried and failed to get, so the index's asOfMonth always describes
  // the data the dashboard is actually serving.
  return best ?? { ...base, asOfMonth: (await snapshotLatestMonth(slug)) ?? base.asOfMonth };
}

/** Newest month already on file for an AMC, canonicalised, or null. */
async function snapshotLatestMonth(slug: string): Promise<string | null> {
  try {
    const snap = JSON.parse(await fs.readFile(path.join(OUT, `${slug}.json`), "utf8")) as AmcPortfolioSnapshot;
    const ym = ymOf(snap.asOfMonth);
    return ym ? labelOfYm(ym) : null;
  } catch {
    return null;
  }
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

  const targetMonth = labelOfYm(latestDisclosureYm(new Date()));
  const behind = merged.filter((e) => normalizeMonthLabel(e.asOfMonth ?? "") !== targetMonth);

  const meta = {
    generatedAt: new Date().toISOString(),
    source: "AdvisorKhoj monthly portfolio disclosures (per-AMC, latest month)",
    /** The month every AMC should be at by now — anything below is stale. */
    targetMonth,
    latestMonthByAmc: Object.fromEntries(merged.filter((e) => e.asOfMonth).map((e) => [e.slug, e.asOfMonth])),
    monthsByAmc: Object.fromEntries(merged.filter((e) => e.months).map((e) => [e.slug, e.months])),
    behindTarget: behind.map((e) => ({ slug: e.slug, latest: e.asOfMonth, status: e.status })),
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
  // Staleness is the failure mode that used to hide: an AMC whose source quietly
  // stops yielding the newest month still reports "ok" every run.
  if (behind.length) {
    console.log(`Behind ${targetMonth} (${behind.length}/${merged.length}): ${behind.map((e) => `${e.slug}(${e.asOfMonth ?? "none"})`).join(", ")}`);
  } else {
    console.log(`All ${merged.length} AMCs are at ${targetMonth}.`);
  }
}

main().catch((e) => { console.error("run-monthly failed:", e); process.exit(1); });
