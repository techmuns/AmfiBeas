/**
 * Build the monthly sector net-flow heatmap data from the per-fund equity
 * holdings (public/holdings). Across ACTIVE EQUITY schemes only (excludes
 * ETFs, index, international and all hybrids), for each available month-on-
 * month transition, aggregate every company's net buying/selling and roll it
 * up by sector (curated fincode -> sector map; see sector-classification).
 *
 * Metric (mirrors build-cap-flows.ts): NET Rs bought/sold = (sharesCur -
 * sharesPrev) x current implied price, where price = aggregate value /
 * aggregate shares across all funds holding the name. Companies whose share
 * count jumped while aggregate value stayed flat are treated as corporate
 * actions (splits/bonuses) and skipped. Reported in Rs bn (1 bn = 100 Cr).
 *
 * Note: Rupeevest holdings carry only the latest ~4 months, so flows are
 * computable for the latest 3 month-on-month transitions only.
 *
 * Writes src/data/portfolio-tracker/sector-flows.json. Re-run after holdings
 * refresh:  npx tsx scripts/build-sector-flows.ts
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
  "sector-flows.json"
);
const N_TRANSITIONS = 3;
// Buckets that are not equity sectors and should not appear as heatmap rows.
const EXCLUDE = new Set(["Mutual Fund"]);

const isActiveEquity = (c: string) =>
  /^Equity/.test(c) && !/ETF|Index|International/.test(c);

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const slugMonth = (l: string) =>
  l
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

interface Agg {
  shCur: number;
  shPrev: number;
  valCur: number;
  valPrev: number;
  name: string;
}

function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  // One per-company aggregation per transition (index 0 = latest month).
  const aggs: Map<string, Agg>[] = Array.from(
    { length: N_TRANSITIONS },
    () => new Map<string, Agg>()
  );
  let labels: string[] = []; // newest-first, e.g. [Apr-26, Mar-26, Feb-26]
  let fundCount = 0;

  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (!isActiveEquity(j.meta?.classification ?? "")) continue;
    const months = j.meta?.months ?? [];
    if (months.length < N_TRANSITIONS + 1) continue;
    if (labels.length === 0) {
      labels = Array.from({ length: N_TRANSITIONS }, (_, i) => months[i].label);
    }
    fundCount++;

    for (let i = 0; i < N_TRANSITIONS; i++) {
      const curSlug = slugMonth(months[i].label);
      const prevSlug = slugMonth(months[i + 1].label);
      const aumCur = num(months[i].aumCr);
      const aumPrev = num(months[i + 1].aumCr);
      const agg = aggs[i];
      for (const r of j.rows) {
        const cur = r.months?.[curSlug];
        const prev = r.months?.[prevSlug];
        const shC = cur ? num(cur.shares_num) : 0;
        const shP = prev ? num(prev.shares_num) : 0;
        const vC =
          cur && cur.aum_pct_num != null
            ? (num(cur.aum_pct_num) / 100) * aumCur
            : 0;
        const vP =
          prev && prev.aum_pct_num != null
            ? (num(prev.aum_pct_num) / 100) * aumPrev
            : 0;
        let a = agg.get(r.fincode);
        if (!a) {
          a = { shCur: 0, shPrev: 0, valCur: 0, valPrev: 0, name: r.company_name };
          agg.set(r.fincode, a);
        }
        a.shCur += shC;
        a.shPrev += shP;
        a.valCur += vC;
        a.valPrev += vP;
      }
    }
  }

  // sector -> net Rs Cr per transition (newest-first index order).
  const sectorCr = new Map<string, number[]>();
  const bucket = (s: string) => {
    let v = sectorCr.get(s);
    if (!v) {
      v = Array.from({ length: N_TRANSITIONS }, () => 0);
      sectorCr.set(s, v);
    }
    return v;
  };

  for (let i = 0; i < N_TRANSITIONS; i++) {
    for (const [fincode, a] of aggs[i]) {
      const priceCur = a.shCur > 0 ? a.valCur / a.shCur : 0;
      const pricePrev = a.shPrev > 0 ? a.valPrev / a.shPrev : 0;
      const price = priceCur > 0 ? priceCur : pricePrev;
      if (price <= 0) continue;

      // Corporate-action guard: big share move with ~flat aggregate value.
      if (a.shPrev > 0 && a.shCur > 0 && a.valPrev > 0 && a.valCur > 0) {
        const shareRatio = a.shCur / a.shPrev;
        const valueRatio = a.valCur / a.valPrev;
        if (
          (shareRatio > 1.4 || shareRatio < 0.71) &&
          valueRatio > 0.88 &&
          valueRatio < 1.14
        ) {
          continue;
        }
      }

      const netCr = (a.shCur - a.shPrev) * price;
      if (Math.abs(netCr) < 1) continue; // ignore sub-1cr noise
      bucket(classifySector(String(fincode), a.name))[i] += netCr;
    }
  }

  // Emit chronological (oldest-first) Rs bn, rounded to whole bn like the
  // source heatmap. 1 bn = 100 Cr.
  const chronoLabels = [...labels].reverse();
  const toBn = (cr: number) => Math.round(cr / 100);

  interface Row {
    sector: string;
    monthly: number[];
    ytd: number;
  }
  let rows: Row[] = [];
  for (const [sector, crArr] of sectorCr) {
    if (EXCLUDE.has(sector)) continue;
    const monthly = chronoLabels.map((_, idx) =>
      toBn(crArr[N_TRANSITIONS - 1 - idx])
    );
    const ytd = monthly.reduce((s, v) => s + v, 0);
    rows.push({ sector, monthly, ytd });
  }
  rows = rows.filter((r) => r.monthly.some((v) => v !== 0) || r.ytd !== 0);
  rows.sort((a, b) => b.ytd - a.ytd);

  const totalsMonthly = chronoLabels.map((_, idx) =>
    rows.reduce((s, r) => s + r.monthly[idx], 0)
  );
  const ytdTotal = totalsMonthly.reduce((s, v) => s + v, 0);

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      months: chronoLabels,
      ytdLabel: "CY26 YTD",
      ytdCoverage: chronoLabels.join(", "),
      universe:
        "Active equity schemes only (excludes ETFs, index, international and hybrid funds)",
      activeEquityFunds: fundCount,
      metric:
        "Net Rs bn = change in aggregate shares held x current implied price, rolled up by sector. Excludes corporate actions (split/bonus).",
      note: "Holdings history spans ~4 months, so flows are computable for the latest 3 month-on-month transitions only.",
    },
    months: chronoLabels,
    rows,
    totals: { monthly: totalsMonthly, ytd: ytdTotal },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log(`wrote ${OUT}`);
  console.log(
    `months: ${chronoLabels.join(", ")} | active-equity funds: ${fundCount} | sectors: ${rows.length}`
  );
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  for (const r of rows) {
    console.log(
      `  ${r.sector.padEnd(34)} ${r.monthly.map((v) => pad(v, 7)).join(" ")}  | YTD ${pad(r.ytd, 6)}`
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(34)} ${totalsMonthly.map((v) => pad(v, 7)).join(" ")}  | YTD ${pad(ytdTotal, 6)}`
  );
}

main();
