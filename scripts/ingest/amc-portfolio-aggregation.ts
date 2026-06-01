/**
 * AMC-level aggregation of per-fund equity holdings.
 *
 * Reads every fund snapshot under `public/holdings/`, maps each fund
 * to its AMC by name prefix, filters to "active equity" classifications
 * (mirroring the IIFL peer-comparison universe), and produces two
 * per-AMC series:
 *
 *  1. **Cash allocation %** over the months reported by the holdings
 *     tracker. For each fund-month, cash% = 100 - sum(equity holding
 *     weights). The AMC-level value is AUM-weighted across that AMC's
 *     active equity funds in that month.
 *
 *  2. **AUM concentration** in the latest month: per AMC, aggregate
 *     stock $-AUM across active equity funds, then surface the share
 *     of total AMC active-equity AUM held in the Top 10 / Top 25
 *     stocks. An "Industry" row aggregates across all included AMCs.
 *
 * Output is written to
 *   `src/data/snapshots/amc-portfolio-aggregation.json`
 *
 * Universe: the curated peer slugs in src/data/amcs.ts. Funds whose
 * name prefix matches one of those AMCs are kept; everything else is
 * dropped (so the snapshot stays comparable to the IIFL peer chart).
 * ETFs, Index Funds, International, all Hybrid, and all Debt funds
 * are excluded — they don't share the active-equity cash/concentration
 * dynamics IIFL is plotting.
 *
 * Run with:
 *   npx tsx scripts/ingest/amc-portfolio-aggregation.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HOLDINGS_DIR = path.resolve(ROOT, "public/holdings");
const INDEX_PATH = path.resolve(ROOT, "src/data/portfolio-tracker/index.json");
const OUT_PATH = path.resolve(
  ROOT,
  "src/data/snapshots/amc-portfolio-aggregation.json"
);

function log(msg: string) {
  console.log(`[amc-portfolio-aggregation] ${msg}`);
}

// Fund-name prefix → curated AMC slug. Order matters: longer / more
// specific prefixes first so "Aditya Birla SL" wins over a bare
// "Birla" match. Anything not matching is skipped.
const PREFIX_TO_SLUG: { prefix: string; slug: string }[] = [
  { prefix: "Aditya Birla SL", slug: "absl" },
  { prefix: "ICICI Pru", slug: "icici-pru" },
  { prefix: "Canara Robeco", slug: "canara-robeco" },
  { prefix: "Mirae Asset", slug: "mirae" },
  { prefix: "Nippon India", slug: "nippon" },
  { prefix: "HDFC", slug: "hdfc" },
  { prefix: "SBI", slug: "sbi" },
  { prefix: "Kotak", slug: "kotak" },
  { prefix: "Axis", slug: "axis" },
  { prefix: "UTI", slug: "uti" },
  { prefix: "DSP", slug: "dsp" },
];

function amcSlugFor(fundName: string): string | null {
  for (const p of PREFIX_TO_SLUG) {
    if (fundName.startsWith(p.prefix)) return p.slug;
  }
  return null;
}

// "Active equity" universe — Equity ex ETFs/Index/International.
// Excludes all hybrid/debt because our holdings JSON only carries
// equity rows, so cash% = 100 − Σequity would conflate debt with cash
// on hybrid funds and inflate the series.
function isActiveEquity(classification: string | null): boolean {
  if (!classification) return false;
  if (!classification.startsWith("Equity")) return false;
  if (classification === "Equity : ETFs") return false;
  if (classification === "Equity : Index Funds") return false;
  if (classification === "Equity : International") return false;
  return true;
}

interface RawIndexEntry {
  schemecode: string;
  fundName: string | null;
  name: string;
  classification: string | null;
  aumTotalCr: number | null;
  rowCount: number;
  file: string | null;
}

interface RawIndex {
  funds: RawIndexEntry[];
}

interface RawHoldingCell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
  arrow: string;
  arrow_raw: string | null;
}

interface RawHolding {
  company_name: string;
  fincode: string;
  months: Record<string, RawHoldingCell>;
}

interface RawMonth {
  label: string;
  aumCr: string | number | null;
}

interface RawFundPortfolio {
  meta: {
    fund: string;
    schemecode: string;
    classification: string | null;
    aumTotalCr: number | null;
    months: RawMonth[];
  };
  rows: RawHolding[];
}

function monthSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toNumber(v: string | number | null): number | null {
  if (v === null || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Light name-cleanup for display labels — strips a stray leading
// "EQ - " marker, trailing footnote glyphs, and collapses whitespace.
function cleanCompanyName(s: string): string {
  return s
    .replace(/^eq\s*-\s*/i, "")
    .replace(/^[\s^*#~]+/, "")
    .replace(/[£@*#~]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PerFundMonth {
  monthLabel: string;
  monthSlug: string;
  fundAumCr: number;
  equityPct: number;
}

interface FundData {
  schemecode: string;
  fundName: string;
  classification: string;
  amcSlug: string;
  perMonth: PerFundMonth[];
  // Latest-month stock contributions, keyed by canonical company name
  // → stock $-AUM (₹ Cr) in this fund.
  latestStockContribCr: Map<string, number>;
  latestMonth: string;
}

function loadFund(p: string): RawFundPortfolio | null {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as RawFundPortfolio;
  } catch (e) {
    log(`skip (read error): ${p} — ${(e as Error).message}`);
    return null;
  }
}

function processFund(
  entry: RawIndexEntry,
  amcSlug: string
): FundData | null {
  if (!entry.file) return null;
  const fullPath = path.resolve(ROOT, "public", entry.file);
  if (!fs.existsSync(fullPath)) {
    log(`skip (missing file): ${entry.file}`);
    return null;
  }
  const portfolio = loadFund(fullPath);
  if (!portfolio) return null;

  const months = portfolio.meta.months ?? [];
  if (months.length === 0) return null;

  const perMonth: PerFundMonth[] = [];
  for (const m of months) {
    const fundAumCr = toNumber(m.aumCr);
    if (fundAumCr === null || fundAumCr <= 0) continue;
    const slug = monthSlug(m.label);
    let equityPct = 0;
    for (const row of portfolio.rows) {
      const cell = row.months[slug];
      const v = cell?.aum_pct_num;
      if (typeof v === "number" && Number.isFinite(v)) equityPct += v;
    }
    // Clamp to 100 — the holdings tracker occasionally rounds-up enough
    // for a sum to land at 100.01 / 100.02. Treat anything ≥ 100 as
    // fully invested (cash = 0) rather than emitting a negative cash %.
    if (equityPct > 100) equityPct = 100;
    perMonth.push({
      monthLabel: m.label,
      monthSlug: slug,
      fundAumCr,
      equityPct,
    });
  }
  if (perMonth.length === 0) return null;

  // Latest-month stock contributions (₹ Cr held in each stock by this
  // fund), keyed by cleaned company name. Used for AMC-level Top-10 /
  // Top-25 stock concentration.
  const latest = perMonth[0];
  const latestStockContribCr = new Map<string, number>();
  for (const row of portfolio.rows) {
    const cell = row.months[latest.monthSlug];
    const v = cell?.aum_pct_num;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    const cr = (latest.fundAumCr * v) / 100;
    const name = cleanCompanyName(row.company_name);
    if (!name) continue;
    latestStockContribCr.set(
      name,
      (latestStockContribCr.get(name) ?? 0) + cr
    );
  }

  return {
    schemecode: entry.schemecode,
    fundName: entry.fundName ?? entry.name,
    classification: entry.classification ?? "",
    amcSlug,
    perMonth,
    latestStockContribCr,
    latestMonth: latest.monthLabel,
  };
}

interface AmcCashRow {
  amcSlug: string;
  byMonth: Record<string, { cashPct: number; aumCr: number; fundCount: number }>;
}

interface AmcConcentrationRow {
  amcSlug: string;
  month: string;
  totalAumCr: number;
  fundCount: number;
  top10PctOfTotal: number;
  top25PctOfTotal: number;
  top10Names: string[];
  top25Names: string[];
}

function main() {
  const indexRaw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as RawIndex;
  log(`loaded index — ${indexRaw.funds.length} funds`);

  const fundsByAmc = new Map<string, FundData[]>();
  let included = 0;
  let skipNonEquity = 0;
  let skipNoAmc = 0;
  let skipNoFile = 0;
  for (const entry of indexRaw.funds) {
    if (!entry.file) {
      skipNoFile++;
      continue;
    }
    if (!isActiveEquity(entry.classification)) {
      skipNonEquity++;
      continue;
    }
    const fundName = entry.fundName ?? entry.name;
    const amcSlug = amcSlugFor(fundName);
    if (!amcSlug) {
      skipNoAmc++;
      continue;
    }
    const fund = processFund(entry, amcSlug);
    if (!fund) continue;
    let list = fundsByAmc.get(amcSlug);
    if (!list) {
      list = [];
      fundsByAmc.set(amcSlug, list);
    }
    list.push(fund);
    included++;
  }
  log(
    `included ${included} funds across ${fundsByAmc.size} AMCs ` +
      `(skipped ${skipNonEquity} non-equity, ${skipNoAmc} non-peer, ${skipNoFile} no-file)`
  );

  // ---- Cash allocation series per AMC ---------------------------
  const allMonthsSet = new Set<string>();
  for (const funds of fundsByAmc.values()) {
    for (const f of funds) for (const m of f.perMonth) allMonthsSet.add(m.monthLabel);
  }
  const cashRows: AmcCashRow[] = [];
  for (const [amcSlug, funds] of fundsByAmc) {
    const byMonth: Record<string, { cashPct: number; aumCr: number; fundCount: number }> = {};
    for (const monthLabel of allMonthsSet) {
      let sumWAumCash = 0;
      let sumAum = 0;
      let count = 0;
      for (const f of funds) {
        const fm = f.perMonth.find((p) => p.monthLabel === monthLabel);
        if (!fm) continue;
        const cashPct = 100 - fm.equityPct;
        sumWAumCash += cashPct * fm.fundAumCr;
        sumAum += fm.fundAumCr;
        count++;
      }
      if (sumAum > 0) {
        byMonth[monthLabel] = {
          cashPct: sumWAumCash / sumAum,
          aumCr: sumAum,
          fundCount: count,
        };
      }
    }
    cashRows.push({ amcSlug, byMonth });
  }

  // ---- Latest-month AUM concentration per AMC -------------------
  // Use the most-common "latest month" across the included funds as
  // the snapshot month — every fund's latest cell already lives in
  // perMonth[0], and they all share the same window (the tracker is
  // updated cohort-wide), so this should converge on one label.
  const latestMonthLabel = (() => {
    const counts = new Map<string, number>();
    for (const funds of fundsByAmc.values()) {
      for (const f of funds) {
        counts.set(f.latestMonth, (counts.get(f.latestMonth) ?? 0) + 1);
      }
    }
    let best = "";
    let bestN = -1;
    for (const [k, n] of counts) {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    return best;
  })();

  const concRows: AmcConcentrationRow[] = [];
  const industryStockContribCr = new Map<string, number>();
  let industryTotalAumCr = 0;
  let industryFundCount = 0;
  for (const [amcSlug, funds] of fundsByAmc) {
    const stockCr = new Map<string, number>();
    let totalAumCr = 0;
    let fundCount = 0;
    for (const f of funds) {
      if (f.latestMonth !== latestMonthLabel) continue;
      const latest = f.perMonth[0];
      totalAumCr += latest.fundAumCr;
      fundCount++;
      for (const [name, cr] of f.latestStockContribCr) {
        stockCr.set(name, (stockCr.get(name) ?? 0) + cr);
        industryStockContribCr.set(
          name,
          (industryStockContribCr.get(name) ?? 0) + cr
        );
      }
    }
    if (fundCount === 0 || totalAumCr <= 0) continue;
    industryTotalAumCr += totalAumCr;
    industryFundCount += fundCount;
    const sorted = [...stockCr.entries()].sort((a, b) => b[1] - a[1]);
    const top10Sum = sorted.slice(0, 10).reduce((s, x) => s + x[1], 0);
    const top25Sum = sorted.slice(0, 25).reduce((s, x) => s + x[1], 0);
    concRows.push({
      amcSlug,
      month: latestMonthLabel,
      totalAumCr,
      fundCount,
      top10PctOfTotal: (top10Sum / totalAumCr) * 100,
      top25PctOfTotal: (top25Sum / totalAumCr) * 100,
      top10Names: sorted.slice(0, 10).map(([n]) => n),
      top25Names: sorted.slice(0, 25).map(([n]) => n),
    });
  }
  // Industry composite row.
  if (industryTotalAumCr > 0) {
    const sorted = [...industryStockContribCr.entries()].sort(
      (a, b) => b[1] - a[1]
    );
    const top10Sum = sorted.slice(0, 10).reduce((s, x) => s + x[1], 0);
    const top25Sum = sorted.slice(0, 25).reduce((s, x) => s + x[1], 0);
    concRows.push({
      amcSlug: "industry",
      month: latestMonthLabel,
      totalAumCr: industryTotalAumCr,
      fundCount: industryFundCount,
      top10PctOfTotal: (top10Sum / industryTotalAumCr) * 100,
      top25PctOfTotal: (top25Sum / industryTotalAumCr) * 100,
      top10Names: sorted.slice(0, 10).map(([n]) => n),
      top25Names: sorted.slice(0, 25).map(([n]) => n),
    });
  }

  // ---- Stable month ordering (oldest → newest) ------------------
  // Holdings JSONs already list months newest-first; flip for charting.
  // Parse "MMM-YY" so April-26 sorts after March-26 etc.
  const MONTH_ABBR = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  function monthOrder(label: string): number {
    const m = /^([A-Za-z]{3})-?(\d{2,4})$/.exec(label.trim());
    if (!m) return 0;
    const mi = MONTH_ABBR.indexOf(m[1].toLowerCase());
    let yr = Number(m[2]);
    if (yr < 100) yr += 2000;
    return yr * 12 + (mi < 0 ? 0 : mi);
  }
  const orderedMonths = [...allMonthsSet].sort(
    (a, b) => monthOrder(a) - monthOrder(b)
  );

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "RupeeVest Mutual Fund Portfolio Tracker",
      notes:
        "AMC-level aggregation of per-fund equity holdings. Cash % = " +
        "AUM-weighted (100 − Σequity holding weights) across the AMC's " +
        "active-equity funds. Concentration % = AUM-weighted Top-10 / " +
        "Top-25 stock contribution as % of the AMC's total active-equity " +
        "AUM in the latest reported month. Active-equity universe excludes " +
        "ETFs, Index Funds, International, and all hybrid / debt schemes.",
      months: orderedMonths,
      latestMonth: latestMonthLabel,
      amcSlugsIncluded: [...fundsByAmc.keys()].sort(),
      fundCountByAmc: Object.fromEntries(
        [...fundsByAmc].map(([slug, fs]) => [slug, fs.length])
      ),
    },
    cash: cashRows,
    concentration: concRows,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  log(`wrote snapshot → ${path.relative(ROOT, OUT_PATH)}`);
}

main();
