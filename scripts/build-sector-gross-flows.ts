/**
 * Build GROSS monthly sector flows from the AMC-direct equity holdings
 * (public/holdings-direct — the same portfolios that power the MFs Portfolio
 * Tracker), the "gross" side of the Overview sector-flows toggle (the net side
 * is the longer external research snapshot in src/data/sector-flows.ts).
 *
 * For every month-over-month pair in the holdings window and every stock:
 *   stock flow ₹ Cr = (sharesCur − sharesPrev) × current implied price
 * (same valuation as build-cap-flows: isolates trading from price moves,
 * with the same split/bonus guard). Flows are bucketed by the AMC-disclosed
 * industry (canonicalAmcSector) — the fincode is now an ISIN, so the numeric
 * fincode→sector map no longer applies; we classify straight off the filing —
 * and summed per sector as:
 *   grossBuyCr  = Σ positive stock flows (money entering the sector)
 *   grossSellCr = Σ |negative stock flows| (money leaving)
 *   netCr       = grossBuy − grossSell
 *
 * Writes src/data/portfolio-tracker/sector-gross-flows.json. Re-run after a
 * holdings refresh: npm run build:sector-gross
 */
import fs from "node:fs";
import path from "node:path";
import { classifySector, canonicalAmcSector, UNCLASSIFIED } from "../src/data/sector-classification";

const DIR = path.join(process.cwd(), "public", "holdings-direct");
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

/** Per stock, per flow-month, the cross-fund aggregate of the funds that
 *  disclosed BOTH sides of that flow-month's adjacent pair. netShares =
 *  sharesCur − sharesPrev is therefore the sum of each contributing fund's OWN
 *  month-over-month delta — a fund that hasn't filed the month contributes to
 *  neither side, so it can never look like a phantom sell. */
interface StockAgg {
  fincode: string;
  name: string;
  /** AMC-disclosed industry (canonicalised), first non-empty seen. */
  sector: string;
  /** flowLabel → aggregate {sharesCur, sharesPrev, valCur, valPrev} */
  byFlow: Map<string, { sc: number; sp: number; vc: number; vp: number }>;
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOrder = (label: string): number => {
  const m = String(label).trim().toLowerCase().match(/^([a-z]{3})[^0-9]*(\d{2,4})$/);
  if (!m) return -1;
  const mo = MON3.findIndex((x) => x.toLowerCase() === m[1]);
  if (mo < 0) return -1;
  let y = parseInt(m[2], 10);
  if (y < 100) y += 2000;
  return y * 12 + mo;
};

function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  const stocks = new Map<string, StockAgg>();
  const flowLabelSet = new Set<string>();
  let fundCount = 0;

  // AMC filings don't share a reporting month, so we NEVER diff one aggregate
  // month against another. Instead, for every fund we walk ITS OWN adjacent
  // month pairs (newest first) and attribute the change to the newer month's
  // label. A fund that skipped a month still yields a valid self-referential
  // delta labelled by its latest month.
  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (!isActiveEquity(j.meta?.classification ?? "")) continue;
    const months: { label: string; aumCr: string | number | null }[] =
      j.meta?.months ?? [];
    if (months.length < 2) continue;
    fundCount++;
    const slugs = months.map((m) => slugMonth(m.label));
    const aums = months.map((m) => num(m.aumCr) || num(j.meta?.aumTotalCr));

    for (const r of j.rows) {
      const key = String(r.fincode ?? "").trim() || `n:${r.company_name}`;
      let s = stocks.get(key);
      if (!s) {
        s = { fincode: String(r.fincode ?? ""), name: r.company_name ?? "", sector: "", byFlow: new Map() };
        stocks.set(key, s);
      }
      // AMC-disclosed industry from the filing (equity rows carry it); keep the
      // first non-empty one seen for this stock across schemes.
      if (!s.sector) {
        const canon = canonicalAmcSector(r.sector);
        if (canon !== UNCLASSIFIED) s.sector = canon;
      }
      // Each adjacent (newer=i, older=i+1) pair in THIS fund's own months.
      for (let i = 0; i < months.length - 1; i++) {
        const curCell = r.months?.[slugs[i]];
        const prevCell = r.months?.[slugs[i + 1]];
        if (!curCell && !prevCell) continue;
        const shC = curCell ? num(curCell.shares_num) : 0;
        const shP = prevCell ? num(prevCell.shares_num) : 0;
        const vC = curCell && curCell.aum_pct_num != null && aums[i] > 0 ? (num(curCell.aum_pct_num) / 100) * aums[i] : 0;
        const vP = prevCell && prevCell.aum_pct_num != null && aums[i + 1] > 0 ? (num(prevCell.aum_pct_num) / 100) * aums[i + 1] : 0;
        if (shC === 0 && shP === 0) continue;
        const label = months[i].label;
        flowLabelSet.add(label);
        const e = s.byFlow.get(label) ?? { sc: 0, sp: 0, vc: 0, vp: 0 };
        e.sc += shC;
        e.sp += shP;
        e.vc += vC;
        e.vp += vP;
        s.byFlow.set(label, e);
      }
    }
  }

  // Flow months present, newest first.
  const flowMonths = [...flowLabelSet].sort((a, b) => monthOrder(b) - monthOrder(a));
  const flowIndex = new Map(flowMonths.map((l, i) => [l, i] as const));
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
    // Prefer the AMC-disclosed industry; fall back to name-based detection
    // (overseas / mutual-fund units) only when the filing left it blank.
    const sector = s.sector || classifySector(s.fincode, s.name);
    for (const [label, a] of s.byFlow) {
      const i = flowIndex.get(label);
      if (i === undefined) continue;
      const price = a.sc > 0 ? a.vc / a.sc : a.sp > 0 ? a.vp / a.sp : 0;
      if (price <= 0) continue;
      // Split/bonus guard (mirrors build-cap-flows).
      if (a.sp > 0 && a.sc > 0 && a.vp > 0 && a.vc > 0) {
        const shareRatio = a.sc / a.sp;
        const valueRatio = a.vc / a.vp;
        if ((shareRatio > 1.4 || shareRatio < 0.71) && valueRatio > 0.88 && valueRatio < 1.14) {
          continue;
        }
      }
      const flow = (a.sc - a.sp) * price;
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
