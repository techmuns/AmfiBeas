/**
 * Shares-outstanding feed for the cap-flows buy/sell tables.
 *
 * The Overview "What mutual funds are buying & selling" cards express each
 * name's net MF buying/selling as a % of the company's TOTAL shares
 * outstanding. The per-fund holdings only carry shares HELD BY MUTUAL FUNDS,
 * never the company's float, so this script sources the missing denominator
 * from screener.in.
 *
 * Scope: only the handful of companies that actually surface in
 * src/data/portfolio-tracker/cap-flows.json (top-N per cap tier per side) need
 * a figure — so this is a small, polite scrape (~30 companies), not the full
 * 1,200-name universe.
 *
 * For each fincode we:
 *   1. resolve a screener symbol — an override (shares-outstanding-overrides.json)
 *      wins, else the top hit from screener's autocomplete API for the cleaned
 *      company name;
 *   2. fetch the company page and read "Market Cap" (₹ Cr) and "Current Price"
 *      (₹) from the #top-ratios block;
 *   3. derive sharesOutstanding = marketCap(₹) / price(₹) = marketCapCr·1e7 / price.
 *
 * Results are MERGED into src/data/portfolio-tracker/shares-outstanding.json:
 * fresh entries (asOf within STALE_DAYS) are kept as-is, so a re-run only hits
 * the network for new or stale names. Network/parse failures are tolerated per
 * company — the prior value (if any) is preserved, otherwise the name is left
 * absent and the build emits pctOutstanding: null ("—" in the UI).
 *
 * Run:  npx tsx scripts/ingest/shares-outstanding.ts
 * Env:  SHARES_OUTSTANDING_STALE_DAYS (default 30)
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { fetchText, info, warn, nowIso } from "./utils";

const ROOT = process.cwd();
const CAP_FLOWS = path.join(ROOT, "src/data/portfolio-tracker/cap-flows.json");
const OUT = path.join(ROOT, "src/data/portfolio-tracker/shares-outstanding.json");
const OVERRIDES = path.join(
  ROOT,
  "src/data/portfolio-tracker/shares-outstanding-overrides.json"
);

const STALE_DAYS = Number(process.env.SHARES_OUTSTANDING_STALE_DAYS ?? "30");
const REQUEST_DELAY_MS = 1500;

interface CapFlowRow {
  company: string;
  fincode: string;
}
interface CapFlowCard {
  bought: CapFlowRow[];
  sold: CapFlowRow[];
}
interface CapFlows {
  large: CapFlowCard;
  mid: CapFlowCard;
  small: CapFlowCard;
}

interface SoEntry {
  company: string;
  symbol: string;
  sharesOutstanding: number;
  marketCapCr: number;
  priceInr: number;
  asOf: string;
  source: string;
}
interface SoFile {
  meta: {
    generatedAt: string;
    source: string;
    staleDays: number;
    note: string;
  };
  companies: Record<string, SoEntry>;
}

interface Overrides {
  companies: Record<string, { symbol: string; note?: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Unique fincode → display name across every cap-flow card. */
function collectTargets(): Map<string, string> {
  const flows = readJson<CapFlows | null>(CAP_FLOWS, null);
  const targets = new Map<string, string>();
  if (!flows) return targets;
  for (const tier of [flows.large, flows.mid, flows.small]) {
    if (!tier) continue;
    for (const row of [...(tier.bought ?? []), ...(tier.sold ?? [])]) {
      if (row.fincode && !targets.has(row.fincode)) {
        targets.set(row.fincode, row.company);
      }
    }
  }
  return targets;
}

/** Strip legal suffixes and rupeevest markers so screener search matches. */
function cleanName(name: string): string {
  return name
    .replace(/[£@*#~^]+/g, " ")
    .replace(/\b(Ltd\.?|Limited)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFresh(entry: SoEntry | undefined): boolean {
  if (!entry) return false;
  const asOf = Date.parse(entry.asOf);
  if (!Number.isFinite(asOf)) return false;
  const ageDays = (Date.now() - asOf) / 86_400_000;
  return ageDays < STALE_DAYS && entry.sharesOutstanding > 0;
}

interface SearchHit {
  name: string;
  url: string;
}

/** Resolve a screener company path (e.g. "/company/HDFCBANK/") for a name. */
async function resolveSymbol(query: string): Promise<SearchHit | null> {
  const url = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(
    query
  )}&v=3&fts=1`;
  const text = await fetchText(url, 30_000);
  let hits: unknown;
  try {
    hits = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const first = hits[0] as { name?: string; url?: string };
  if (typeof first.url !== "string") return null;
  return { name: first.name ?? query, url: first.url };
}

/** Parse "12,34,567" style strings into a number; null when unparseable. */
function parseScreenerNumber(s: string): number | null {
  const cleaned = s.replace(/[₹,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface TopRatios {
  marketCapCr: number;
  priceInr: number;
}

/** Read Market Cap (₹ Cr) and Current Price (₹) from a screener page. */
function parseTopRatios(html: string): TopRatios | null {
  const $ = cheerio.load(html);
  let marketCapCr: number | null = null;
  let priceInr: number | null = null;
  $("#top-ratios li").each((_, li) => {
    const name = $(li).find(".name").first().text().trim().toLowerCase();
    const num = parseScreenerNumber($(li).find(".number").first().text());
    if (num === null) return;
    if (name.includes("market cap")) marketCapCr = num;
    else if (name.includes("current price")) priceInr = num;
  });
  if (marketCapCr === null || priceInr === null || priceInr <= 0) return null;
  return { marketCapCr, priceInr };
}

async function fetchEntry(
  fincode: string,
  company: string,
  override: { symbol: string } | undefined
): Promise<SoEntry | null> {
  let hit: SearchHit | null;
  if (override?.symbol) {
    hit = { name: company, url: `/company/${override.symbol}/` };
  } else {
    hit = await resolveSymbol(cleanName(company));
    await sleep(REQUEST_DELAY_MS);
  }
  if (!hit) {
    warn(`shares-out: no screener match for ${company} (fincode ${fincode})`);
    return null;
  }
  const symbol = hit.url.replace(/^\/company\//, "").replace(/\/.*$/, "");
  const pageUrl = `https://www.screener.in${hit.url.endsWith("/") ? hit.url : hit.url + "/"}`;
  const html = await fetchText(pageUrl, 30_000);
  const ratios = parseTopRatios(html);
  if (!ratios) {
    warn(`shares-out: could not parse top-ratios for ${symbol} (${company})`);
    return null;
  }
  const sharesOutstanding = Math.round(
    (ratios.marketCapCr * 1e7) / ratios.priceInr
  );
  if (!(sharesOutstanding > 0)) return null;
  return {
    company,
    symbol,
    sharesOutstanding,
    marketCapCr: ratios.marketCapCr,
    priceInr: ratios.priceInr,
    asOf: nowIso(),
    source: pageUrl,
  };
}

async function main() {
  const targets = collectTargets();
  if (targets.size === 0) {
    warn("shares-out: no cap-flow targets found — nothing to do.");
    return;
  }
  const overrides = readJson<Overrides>(OVERRIDES, { companies: {} });
  const existing = readJson<SoFile>(OUT, {
    meta: { generatedAt: "", source: "", staleDays: STALE_DAYS, note: "" },
    companies: {},
  });
  const companies: Record<string, SoEntry> = { ...existing.companies };

  let fetched = 0;
  let kept = 0;
  let failed = 0;
  for (const [fincode, company] of targets) {
    if (isFresh(companies[fincode])) {
      kept += 1;
      continue;
    }
    try {
      const entry = await fetchEntry(
        fincode,
        company,
        overrides.companies[fincode]
      );
      if (entry) {
        companies[fincode] = entry;
        fetched += 1;
        info(
          `shares-out: ${company} → ${entry.symbol} · ${entry.sharesOutstanding.toLocaleString(
            "en-IN"
          )} shares (mcap ₹${entry.marketCapCr.toLocaleString("en-IN")} Cr / ₹${entry.priceInr})`
        );
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      warn(`shares-out: ${company} (fincode ${fincode}) → ${(err as Error).message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const out: SoFile = {
    meta: {
      generatedAt: nowIso(),
      source: "screener.in (Market Cap ÷ Current Price)",
      staleDays: STALE_DAYS,
      note: "sharesOutstanding = marketCapCr·1e7 / priceInr. Keyed by RupeeVest fincode. Only companies surfacing in cap-flows.json are fetched. Fix bad symbol matches in shares-outstanding-overrides.json (fincode → screener symbol).",
    },
    // Stable key order so re-runs produce minimal diffs.
    companies: Object.fromEntries(
      Object.entries(companies).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  info(
    `shares-out: wrote ${OUT} — ${Object.keys(out.companies).length} companies (fetched ${fetched}, kept ${kept} fresh, failed ${failed}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
