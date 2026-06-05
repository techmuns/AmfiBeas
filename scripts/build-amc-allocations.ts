/**
 * Build the per-AMC equity allocation snapshot from the per-fund holdings
 * (public/holdings) — the data behind the two IIFL-style fund-house charts on
 * the MFs Portfolio Tracker:
 *
 *   1. Cap Allocation  — Large / Mid / Small split of each AMC's equity book.
 *   2. Sector Allocation — sector split of each AMC's equity book.
 *
 * UNIVERSE (mirrors the IIFL note): only actively managed equity & hybrid
 * schemes — excludes ETFs, index funds, international funds and arbitrage.
 * The RupeeVest tracker lists EQUITY holdings only, so each fund's rows sum to
 * its equity sleeve; we weight every holding by its ₹ Cr value
 * (aum_pct × fund AUM), bucket by cap-tier / sector, blend across all of an
 * AMC's schemes, then normalise each AMC to 100 % of its classified equity.
 *
 * AMCs shown = the TOP_N_AMCS fund houses by total equity value, plus a
 * blended "Industry" column computed over the FULL universe (not just the
 * top N). Data-driven, never hardcoded — self-corrects as holdings refresh.
 *
 * Writes src/data/portfolio-tracker/amc-allocations.json. Re-run after a
 * holdings refresh:  npx tsx scripts/build-amc-allocations.ts
 */
import fs from "node:fs";
import path from "node:path";
import { classifyCap, type CapTier } from "../src/data/cap-classification";
import { classifySector } from "../src/data/sector-classification";
import { amcOf } from "../src/data/amc-name-map";

const DIR = path.join(process.cwd(), "public", "holdings");
const OUT = path.join(
  process.cwd(),
  "src",
  "data",
  "portfolio-tracker",
  "amc-allocations.json"
);
const TOP_N_AMCS = 9;

/** Actively managed equity OR hybrid, excluding passive & arbitrage. */
const inUniverse = (c: string): boolean =>
  (/^Equity\s*:/.test(c) || /^Hybrid\s*:/.test(c)) &&
  !/ETF|Index|International|Arbitrage/.test(c);

// AMC brand -> display label: amcOf + AMC_PREFIXES now live in the shared,
// runtime-safe src/data/amc-name-map.ts (imported above).

// Our curated sector taxonomy -> the named buckets shown on the chart. Any
// sector not listed (Services, Consumer Durables, Construction, Cement, Media,
// Agri, Textiles, Diversified, Overseas, Mutual Fund, Unclassified) folds into
// "Others". The map's combined "Financials" bucket is split into Banks vs
// Finance by company name (see `isBank` below) to mirror the IIFL figure's
// separate Bank and Finance segments.
const SECTOR_LABELS: Record<string, string> = {
  Technology: "IT",
  Energy: "Oil & Energy",
  "Automobile and Ancillaries": "Auto",
  Healthcare: "Healthcare",
  FMCG: "FMCG",
  "Capital Goods": "Capital Goods",
  Chemicals: "Chemicals",
  "Metals & Mining": "Metals",
  Realty: "Realty",
};
const OTHERS = "Others";
const BANKS = "Banks";
const FINANCE = "Finance";
/** Within the map's "Financials" bucket, holdings whose name carries the word
 *  "bank" are licensed banks (incl. small-finance banks); everything else
 *  (NBFCs, insurers, AMCs, exchanges, housing finance) is non-bank Finance. */
const isBank = (name: string) => /\bbank\b/i.test(name);
// Display order, largest-first across the industry, with Others pinned last.
const SECTOR_ORDER = [
  BANKS,
  FINANCE,
  "IT",
  "Oil & Energy",
  "Auto",
  "Healthcare",
  "FMCG",
  "Capital Goods",
  "Chemicals",
  "Metals",
  "Realty",
  OTHERS,
];
const CAP_TIERS: CapTier[] = ["large", "mid", "small"];

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const slugMonth = (l: string) =>
  l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

interface AmcAgg {
  equityCr: number;
  cap: Record<CapTier, number>;
  sector: Record<string, number>;
}
const newAgg = (): AmcAgg => ({
  equityCr: 0,
  cap: { large: 0, mid: 0, small: 0 },
  sector: {},
});

function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  const byAmc = new Map<string, AmcAgg>();
  const industry = newAgg();
  let monthLabel = "";
  let fundCount = 0;
  let totalEquity = 0;
  let unclassifiedSector = 0;

  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    const cls: string = j.meta?.classification ?? "";
    if (!inUniverse(cls)) continue;
    const months = j.meta?.months ?? [];
    if (months.length === 0) continue;
    if (!monthLabel) monthLabel = months[0].label;
    const slug = slugMonth(months[0].label);
    const aum = num(months[0].aumCr) || num(j.meta?.aumTotalCr);
    if (aum <= 0) continue;

    const amc = amcOf(j.meta.fund);
    let agg = byAmc.get(amc);
    if (!agg) {
      agg = newAgg();
      byAmc.set(amc, agg);
    }
    fundCount++;

    for (const r of j.rows) {
      const cell = r.months?.[slug];
      if (!cell || cell.aum_pct_num == null) continue;
      const val = (num(cell.aum_pct_num) / 100) * aum;
      if (val <= 0) continue;

      const tier = classifyCap(r.company_name);
      const rawSector = classifySector(r.fincode, r.company_name);
      const bucket =
        rawSector === "Financials"
          ? isBank(r.company_name)
            ? BANKS
            : FINANCE
          : SECTOR_LABELS[rawSector] ?? OTHERS;
      if (rawSector === "Unclassified") unclassifiedSector += val;
      totalEquity += val;

      for (const target of [agg, industry]) {
        target.equityCr += val;
        target.cap[tier] += val;
        target.sector[bucket] = (target.sector[bucket] ?? 0) + val;
      }
    }
  }

  // Normalise an AMC's buckets to % of its classified equity (1 dp).
  const round1 = (x: number) => Math.round(x * 10) / 10;
  const capPct = (a: AmcAgg) => {
    const s = CAP_TIERS.reduce((t, k) => t + a.cap[k], 0) || 1;
    return Object.fromEntries(
      CAP_TIERS.map((k) => [k, round1((a.cap[k] / s) * 100)])
    ) as Record<CapTier, number>;
  };
  const sectorPct = (a: AmcAgg) => {
    const s = SECTOR_ORDER.reduce((t, k) => t + (a.sector[k] ?? 0), 0) || 1;
    return Object.fromEntries(
      SECTOR_ORDER.map((k) => [k, round1(((a.sector[k] ?? 0) / s) * 100)])
    ) as Record<string, number>;
  };

  const ranked = [...byAmc.entries()]
    .sort((x, y) => y[1].equityCr - x[1].equityCr)
    .slice(0, TOP_N_AMCS);

  const cap = [
    ...ranked.map(([amc, a]) => ({ amc, equityCr: Math.round(a.equityCr), ...capPct(a) })),
    { amc: "Industry", equityCr: Math.round(industry.equityCr), ...capPct(industry) },
  ];
  const sector = [
    ...ranked.map(([amc, a]) => ({ amc, equityCr: Math.round(a.equityCr), ...sectorPct(a) })),
    { amc: "Industry", equityCr: Math.round(industry.equityCr), ...sectorPct(industry) },
  ];

  const out = {
    meta: {
      month: monthLabel,
      generatedAt: new Date().toISOString(),
      universe:
        "Actively managed equity & hybrid schemes (excludes ETFs, index, international and arbitrage funds)",
      funds: fundCount,
      amcsShown: ranked.length,
      capTiers: CAP_TIERS,
      sectorOrder: SECTOR_ORDER,
      sectorTaxonomyNote:
        "Sector buckets derive from a curated fincode map; its combined Financials bucket is split into Banks (licensed banks, incl. small-finance) and Finance (NBFCs, insurers, AMCs, exchanges) by company name.",
      sectorCoveragePct: round1(100 * (1 - unclassifiedSector / (totalEquity || 1))),
    },
    cap,
    sector,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
  console.log(
    `month: ${monthLabel} | universe funds: ${fundCount} | AMCs shown: ${ranked.length} | sector coverage: ${out.meta.sectorCoveragePct}%`
  );
  console.log("\n### CAP (Large/Mid/Small %) ###");
  for (const r of cap)
    console.log(`  ${r.amc.padEnd(16)} ${r.large}/${r.mid}/${r.small}`);
  console.log("\n### SECTOR (% by bucket) ###");
  console.log("  " + ["AMC".padEnd(16), ...SECTOR_ORDER.map((s) => s.slice(0, 5).padStart(6))].join(""));
  for (const r of sector)
    console.log(
      "  " +
        [r.amc.padEnd(16), ...SECTOR_ORDER.map((s) => String((r as unknown as Record<string, number>)[s]).padStart(6))].join("")
    );
}

main();
