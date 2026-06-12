/**
 * Build GROSS monthly sector flows from the per-scheme equity holdings —
 * the "gross" side of the Overview sector-flows toggle (the net side is the
 * longer external research snapshot in src/data/sector-flows.ts).
 *
 * For every month-over-month pair in the holdings window and every stock:
 *   stock flow ₹ Cr = (sharesCur − sharesPrev) × current implied price
 * (same valuation as build-cap-flows: isolates trading from price moves,
 * with the same split/bonus guard). Flows are bucketed by classifySector and
 * summed per sector as:
 *   grossBuyCr  = Σ positive stock flows (money entering the sector)
 *   grossSellCr = Σ |negative stock flows| (money leaving)
 *   netCr       = grossBuy − grossSell
 *
 * Writes src/data/portfolio-tracker/sector-gross-flows.json. Re-run after a
 * holdings refresh: npm run build:sector-gross
 */
import fs from "node:fs";
import path from "node:path";
import { classifySector } from "../src/data/sector-classification";

const DIR = path.join(process.cwd(), "public", "holdings");
const OUT = path.join(
  process.cwd(),
  "src",
  "data",
  "portfolio-tracker",
  "sector-gross-flows.json"
);

const isActiveEquity = (c: string) =>
  /^Equity/.test(c) && !/ETF|Index|International/.test(c);

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const slugMonth = (l: string) =>
  l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

interface StockAgg {
  fincode: string;
  name: string;
  /** monthSlug → { shares, valueCr } aggregated across schemes */
  byMonth: Map<string, { shares: number; valueCr: number }>;
}

function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  const stocks = new Map<string, StockAgg>();
  let monthLabels: string[] = []; // newest first
  let monthSlugs: string[] = [];
  let fundCount = 0;

  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (!isActiveEquity(j.meta?.classification ?? "")) continue;
    const months: { label: string; aumCr: string | number | null }[] =
      j.meta?.months ?? [];
    if (months.length < 2) continue;
    if (monthLabels.length === 0) {
      monthLabels = months.map((m) => m.label);
      monthSlugs = months.map((m) => slugMonth(m.label));
    }
    fundCount++;
    const aums = months.map((m) => num(m.aumCr) || num(j.meta?.aumTotalCr));

    for (const r of j.rows) {
      const key = String(r.fincode ?? "").trim() || `n:${r.company_name}`;
      let s = stocks.get(key);
      if (!s) {
        s = { fincode: String(r.fincode ?? ""), name: r.company_name ?? "", byMonth: new Map() };
        stocks.set(key, s);
      }
      monthSlugs.forEach((slug, i) => {
        const cell = r.months?.[slug];
        if (!cell) return;
        const sh = num(cell.shares_num);
        const val =
          cell.aum_pct_num == null || aums[i] <= 0
            ? 0
            : (num(cell.aum_pct_num) / 100) * aums[i];
        const cur = s!.byMonth.get(slug) ?? { shares: 0, valueCr: 0 };
        cur.shares += sh;
        cur.valueCr += val;
        s!.byMonth.set(slug, cur);
      });
    }
  }

  // Flow months: each adjacent (cur, prev) pair, newest first.
  const flowMonths = monthLabels.slice(0, -1); // a flow exists for all but the oldest
  // sector → per-flow-month {buy, sell}
  const bySector = new Map<string, { buy: number[]; sell: number[] }>();
  const ensure = (sector: string) => {
    let e = bySector.get(sector);
    if (!e) {
      e = {
        buy: Array(flowMonths.length).fill(0),
        sell: Array(flowMonths.length).fill(0),
      };
      bySector.set(sector, e);
    }
    return e;
  };

  for (const s of stocks.values()) {
    const sector = classifySector(s.fincode, s.name);
    for (let i = 0; i < flowMonths.length; i++) {
      const cur = s.byMonth.get(monthSlugs[i]);
      const prev = s.byMonth.get(monthSlugs[i + 1]);
      if (!cur || !prev) continue;
      const price =
        cur.shares > 0 ? cur.valueCr / cur.shares : prev.shares > 0 ? prev.valueCr / prev.shares : 0;
      if (price <= 0) continue;
      // Split/bonus guard (mirrors build-cap-flows).
      if (prev.shares > 0 && cur.shares > 0 && prev.valueCr > 0 && cur.valueCr > 0) {
        const shareRatio = cur.shares / prev.shares;
        const valueRatio = cur.valueCr / prev.valueCr;
        if ((shareRatio > 1.4 || shareRatio < 0.71) && valueRatio > 0.88 && valueRatio < 1.14) {
          continue;
        }
      }
      const flow = (cur.shares - prev.shares) * price;
      if (Math.abs(flow) < 1) continue;
      const e = ensure(sector);
      if (flow > 0) e.buy[i] += flow;
      else e.sell[i] += -flow;
    }
  }

  const rows = [...bySector.entries()]
    .map(([sector, e]) => ({
      sector,
      grossBuy: e.buy.map((v) => Math.round(v)),
      grossSell: e.sell.map((v) => Math.round(v)),
      net: e.buy.map((v, i) => Math.round(v - e.sell[i])),
    }))
    .sort((a, b) => b.grossBuy[0] - a.grossBuy[0]);

  const totals = {
    grossBuy: flowMonths.map((_, i) => rows.reduce((s, r) => s + r.grossBuy[i], 0)),
    grossSell: flowMonths.map((_, i) => rows.reduce((s, r) => s + r.grossSell[i], 0)),
    net: flowMonths.map((_, i) => rows.reduce((s, r) => s + r.net[i], 0)),
  };

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      months: flowMonths, // newest first
      universe: "Active equity schemes only (excludes ETFs, index, international and hybrid funds)",
      funds: fundCount,
      note: "Gross buy = Σ positive stock-level net share changes × implied price; gross sell = Σ negative. Net = buy − sell. Values ₹ Cr. Corporate actions (split/bonus) excluded.",
    },
    rows,
    totals,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `wrote ${OUT} — sectors: ${rows.length} | months: ${flowMonths.join(", ")} | funds: ${fundCount}`
  );
  for (const r of rows.slice(0, 5)) {
    console.log(
      `  ${r.sector.padEnd(28)} buy ₹${r.grossBuy[0].toLocaleString("en-IN")} Cr · sell ₹${r.grossSell[0].toLocaleString("en-IN")} Cr · net ₹${r.net[0].toLocaleString("en-IN")} Cr (${flowMonths[0]})`
    );
  }
}

main();
