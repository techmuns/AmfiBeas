import * as cheerio from "cheerio";
import {
  fetchText,
  info,
  nowIso,
  parseNumberLoose,
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
  revenue: number;
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

  const sales =
    valuesByMetric["sales"] ||
    valuesByMetric["revenue"] ||
    valuesByMetric["sales +"] ||
    [];
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
    const op = opProfit[i];
    const profit = pat[i];
    if (!rev && !op && !profit) continue;
    out.push({
      quarter: q,
      revenue: rev ?? 0,
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
    revenue: q.revenue,
    operatingProfit: q.operatingProfit,
    pat: q.pat,
    avgAum: 0,
  }));
}

export async function ingestListedAmcQuarterly(): Promise<void> {
  const all: AmcQuarterlyRow[] = [];
  for (const amc of LISTED) {
    try {
      const rows = await fetchOne(amc);
      all.push(...rows);
    } catch (err) {
      warn(`listed-amc-q: ${amc.slug} failed → ${(err as Error).message}`);
    }
  }

  if (all.length === 0) {
    warn("listed-amc-q: no rows parsed — keeping previous snapshot");
    return;
  }

  const slugsCovered = new Set(all.map((r) => r.amcSlug));
  const quartersCovered = Array.from(new Set(all.map((r) => r.quarter))).sort();
  info(
    `listed-amc-q: ${all.length} rows · ${slugsCovered.size}/4 AMCs · ${quartersCovered.length} quarters · range ${quartersCovered[0]}…${quartersCovered[quartersCovered.length - 1]}`
  );

  const snapshot: AmcQuarterlySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: "https://www.screener.in/company/{ticker}/consolidated/",
      notes:
        "Quarterly P&L for the 4 listed Indian AMCs (HDFCAMC, NAM-INDIA, ABSLAMC, UTIAMC). Revenue / op profit / PAT in ₹ Cr; avgAum not provided by source.",
    },
    rows: all,
  };
  await writeSnapshot("amc-quarterly.json", snapshot);
  info("wrote amc-quarterly.json");
}
