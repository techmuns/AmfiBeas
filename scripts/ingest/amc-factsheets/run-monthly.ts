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
} from "./advisorkhoj";
import { fetchLatest } from "./fetch";
import { parseAmcWorkbook } from "./parse";
import type { AmcParseOptions, AmcPortfolioSnapshot, AmcScheme } from "./types";

const OUT = path.resolve(process.cwd(), "public/amc-holdings");

// A generic profile is enough: scheme/holding detection is AMC-independent, and
// per-scheme pct is normalized after parsing (normalizeSchemePct). Values are
// quoted in ₹ Lakhs by the SEBI format, so valueToCr = 100.
const GENERIC: AmcParseOptions = { pctScale: 1, valueToCr: 100 };

// AMCs with a stable, templatable direct file URL — used only if AdvisorKhoj
// fails to resolve/download for them.
const DIRECT_FALLBACK = new Set(["sbi", "nippon", "kotak"]);

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
  source: "advisorkhoj" | "direct" | null;
  asOfMonth: string | null;
  schemes: number;
  holdings: number;
  file: string | null;
  updatedAt: string;
}

function countHoldings(schemes: AmcScheme[]): number {
  return schemes.reduce((s, x) => s + x.holdings.length, 0);
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

async function processAmc(amc: string, year: number): Promise<IndexEntry> {
  const slug = slugFor(amc);
  const base: IndexEntry = {
    slug, amc, status: "no-link", source: null, asOfMonth: null,
    schemes: 0, holdings: 0, file: null, updatedAt: new Date().toISOString(),
  };

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

  // 2) Direct-URL fallback for the three AMCs that have one.
  if (DIRECT_FALLBACK.has(slug)) {
    const f = fetchLatest(slug);
    if (f) {
      const schemes = parseAmcWorkbook(f.buf, GENERIC);
      if (schemes.length > 0) {
        const w = await writeSnapshot(slug, amc, f.url, f.asOfMonth, schemes);
        return { ...base, status: "ok", source: "direct", asOfMonth: f.asOfMonth, schemes: schemes.length, holdings: w.holdings, file: w.file };
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
  console.log(`Fetching ${amcs.length} AMCs via AdvisorKhoj (year ${year})…\n`);

  const index: IndexEntry[] = [];
  for (const amc of amcs) {
    try {
      const e = await processAmc(amc, year);
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

  index.sort((a, b) => a.slug.localeCompare(b.slug));
  const meta = {
    generatedAt: new Date().toISOString(),
    source: "AdvisorKhoj monthly portfolio disclosures (per-AMC, latest month)",
    latestMonthByAmc: Object.fromEntries(index.filter((e) => e.asOfMonth).map((e) => [e.slug, e.asOfMonth])),
    coverage: {
      total: index.length,
      ok: index.filter((e) => e.status === "ok").length,
      needsFallback: index.filter((e) => e.status !== "ok").map((e) => ({ slug: e.slug, status: e.status })),
    },
  };
  await fs.writeFile(path.join(OUT, "index.json"), JSON.stringify({ meta, amcs: index }, null, 2) + "\n", "utf8");

  const ok = meta.coverage.ok;
  const holdings = index.reduce((s, e) => s + e.holdings, 0);
  console.log(`\nAdvisorKhoj monthly fetch: ${ok}/${index.length} AMCs OK, ${holdings.toLocaleString()} holdings total.`);
  const gaps = meta.coverage.needsFallback;
  if (gaps.length) console.log(`Needs fallback (${gaps.length}): ${gaps.map((g) => `${g.slug}(${g.status})`).join(", ")}`);
}

main().catch((e) => { console.error("run-monthly failed:", e); process.exit(1); });
