import * as cheerio from "cheerio";
import {
  fetchText,
  info,
  mergeBySlugQuarter,
  nowIso,
  parseNumberLoose,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";
import type {
  AmcQuarterlyRow,
  AmcQuarterlySnapshot,
} from "../../src/data/snapshots/types";

interface ListedAmc {
  slug: string;
  ticker: string;
  amfiName: string;
}

const LISTED: ListedAmc[] = [
  { slug: "hdfc", ticker: "HDFCAMC", amfiName: "HDFC Mutual Fund" },
  {
    slug: "nippon",
    ticker: "NAM-INDIA",
    amfiName: "Nippon India Mutual Fund",
  },
  {
    slug: "absl",
    ticker: "ABSLAMC",
    amfiName: "Aditya Birla Sun Life Mutual Fund",
  },
  { slug: "uti", ticker: "UTIAMC", amfiName: "UTI Mutual Fund" },
  // ICICI Prudential Asset Management Company — listed; screener URL
  // resolves to the canonical company page. Per-AMC try/catch keeps the
  // pipeline resilient if the page or a row label changes.
  {
    slug: "icici-pru",
    ticker: "ICICIAMC",
    amfiName: "ICICI Prudential Mutual Fund",
  },
];

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthLabelToQuarter(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) return null;
  const monthNum = MONTHS_LOOKUP[m[1].toLowerCase()];
  if (!monthNum) return null;
  const year = Number(m[2]);
  const calendarQ = Math.ceil(monthNum / 3);
  return `${year}-Q${calendarQ}`;
}

interface ScreenerQuarter {
  quarter: string;
  /** "Sales" row from screener — for AMC issuers this is Revenue from
   *  Operations and excludes "Other Income". */
  revenueFromOperations: number;
  /** Optional "Other Income" row — display only, never feeds Revenue
   *  Realization. */
  otherIncome: number;
  operatingProfit: number;
  pat: number;
}

export function parseScreenerQuarterly(html: string): ScreenerQuarter[] {
  const $ = cheerio.load(html);

  let table = $("section#quarters table").first();
  if (!table.length) {
    table = $("table")
      .filter((_, t) => /quarterly\s+result/i.test($(t).prevAll("h2,h3").first().text()))
      .first();
  }
  if (!table.length) {
    table = $("table")
      .filter((_, t) => /sales|revenue/i.test($(t).find("tbody tr").first().find("td").first().text()))
      .first();
  }
  if (!table.length) return [];

  const headerCells = table
    .find("thead tr th")
    .map((_, el) => $(el).text().trim())
    .get();
  const quarters = headerCells.slice(1).map(monthLabelToQuarter);

  const valuesByMetric: Record<string, number[]> = {};
  table.find("tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td, th")
      .map((_, c) => $(c).text().trim())
      .get();
    if (cells.length < 2) return;
    const label = cells[0].toLowerCase().replace(/\s+/g, " ").trim();
    const numbers = cells.slice(1).map((v) => parseNumberLoose(v) ?? 0);
    valuesByMetric[label] = numbers;
  });

  // Screener's "Sales" row on a finance-company consolidated page IS the
  // Revenue from Operations line — Other Income is published separately.
  // We deliberately do NOT use the "revenue" alias here, because "Revenue"
  // in some screener variants means Total Income (Sales + Other).
  const sales =
    valuesByMetric["sales"] ||
    valuesByMetric["sales +"] ||
    valuesByMetric["revenue from operations"] ||
    [];
  const otherIncome = valuesByMetric["other income"] || [];
  const opProfit =
    valuesByMetric["operating profit"] ||
    valuesByMetric["operating profit +"] ||
    [];
  const pat =
    valuesByMetric["net profit"] ||
    valuesByMetric["net profit +"] ||
    valuesByMetric["profit after tax"] ||
    [];

  const out: ScreenerQuarter[] = [];
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    if (!q) continue;
    const rev = sales[i];
    const oi = otherIncome[i] ?? 0;
    const op = opProfit[i];
    const profit = pat[i];
    if (!rev && !op && !profit) continue;
    out.push({
      quarter: q,
      revenueFromOperations: rev ?? 0,
      otherIncome: oi,
      operatingProfit: op ?? 0,
      pat: profit ?? 0,
    });
  }
  return out;
}

async function fetchOne(amc: ListedAmc): Promise<AmcQuarterlyRow[]> {
  const url = `https://www.screener.in/company/${amc.ticker}/consolidated/`;
  info(`listed-amc-q: ${amc.slug} → ${url}`);
  let html: string;
  try {
    html = await fetchText(url);
  } catch (err) {
    warn(`  ${amc.slug} consolidated → ${(err as Error).message}; trying standalone`);
    const fallback = `https://www.screener.in/company/${amc.ticker}/`;
    html = await fetchText(fallback);
  }
  const quarterly = parseScreenerQuarterly(html);
  info(`  → parsed ${quarterly.length} quarters for ${amc.slug}`);
  return quarterly.map((q) => ({
    amcSlug: amc.slug,
    quarter: q.quarter,
    revenue: q.revenueFromOperations,
    revenueFromOperations: q.revenueFromOperations,
    otherIncome: q.otherIncome,
    operatingProfit: q.operatingProfit,
    pat: q.pat,
    avgAum: 0,
  }));
}

export async function ingestListedAmcQuarterly(): Promise<void> {
  info("=== listed-amc-quarterly ===");
  const fetched: AmcQuarterlyRow[] = [];
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const amc of LISTED) {
    try {
      const rows = await fetchOne(amc);
      if (rows.length === 0) {
        warn(`listed-amc-q: ${amc.slug} returned 0 rows — preserving prior`);
        failed.push(amc.slug);
        continue;
      }
      fetched.push(...rows);
      succeeded.push(amc.slug);
    } catch (err) {
      warn(`listed-amc-q: ${amc.slug} failed → ${(err as Error).message}`);
      failed.push(amc.slug);
    }
  }

  // Merge into prior snapshot. Missing AMCs (in failed[]) keep their
  // historical rows untouched; refetched AMCs replace their (slug, quarter)
  // rows in place so corrections to a published quarter propagate.
  const prior =
    (await readSnapshot<AmcQuarterlySnapshot>("amc-quarterly.json"))?.rows ??
    [];

  if (fetched.length === 0) {
    warn(
      "listed-amc-q: no new rows parsed across all AMCs — keeping previous snapshot"
    );
    return;
  }

  const { rows: merged, stats } = mergeBySlugQuarter(prior, fetched);
  const fetchedQuarters = Array.from(
    new Set(fetched.map((r) => r.quarter))
  ).sort();
  const allQuarters = Array.from(new Set(merged.map((r) => r.quarter))).sort();
  const allSlugs = Array.from(new Set(merged.map((r) => r.amcSlug))).sort();

  info(
    `listed-amc-q: AMCs fetched=${succeeded.length}/${LISTED.length} ok=[${succeeded.join(", ")}] failed=[${failed.join(", ")}]`
  );
  info(
    `listed-amc-q: fetched ${fetched.length} rows across ${fetchedQuarters.length} quarters (${fetchedQuarters[0]}…${fetchedQuarters[fetchedQuarters.length - 1]})`
  );
  info(
    `listed-amc-q: merge — added=${stats.added} updated=${stats.updated} preserved=${stats.preserved} total=${stats.total}`
  );
  info(
    `listed-amc-q: snapshot range ${allQuarters[0]}…${allQuarters[allQuarters.length - 1]} · ${allSlugs.length} AMCs`
  );

  const snapshot: AmcQuarterlySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: "https://www.screener.in/company/{ticker}/consolidated/",
      notes: [
        "Quarterly P&L for listed Indian AMCs (HDFCAMC, NAM-INDIA, ABSLAMC, UTIAMC, ICICIAMC).",
        "Source mapping: screener.in 'Sales' row → Revenue from Operations (excludes Other Income); 'Other Income' captured separately for display only; 'Operating Profit' and 'Net Profit' as labelled. revenueFromOperations is what feeds Revenue Realization (bps of MF QAAUM). avgAum not provided by this source.",
        `lastSuccessfulFetchAt=${nowIso()} · slugsThisRun=[${succeeded.join(", ")}] · failedThisRun=[${failed.join(", ")}].`,
        `quartersCovered=${allQuarters.length} (${allQuarters[0]}…${allQuarters[allQuarters.length - 1]}) · rowCount=${stats.total} · fetchWindow=${fetchedQuarters.length}.`,
      ].join(" "),
    },
    rows: merged,
  };
  await writeSnapshot("amc-quarterly.json", snapshot);
  info("wrote amc-quarterly.json");
}
