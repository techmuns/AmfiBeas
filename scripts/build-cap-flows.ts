/**
 * Build the cap-bucketed MF buy/sell snapshot from the per-fund equity
 * holdings (public/holdings). For the latest month vs the prior month, across
 * ACTIVE EQUITY schemes only (excludes ETFs, index, international and all
 * hybrids), aggregate each company's net buying/selling and the AMCs driving
 * it, then bucket by Large/Mid/Small cap.
 *
 * Metric: NET Rs Cr BOUGHT/SOLD = (sharesCur - sharesPrev) x current price,
 * where price is the holdings-implied price (aggregate value / aggregate
 * shares). This values the net change in shares at the current price, so it
 * isolates actual buying/selling and ignores pure price moves. Companies whose
 * share count jumped while aggregate value stayed flat are treated as corporate
 * actions (splits/bonuses) and skipped.
 *
 * Writes src/data/portfolio-tracker/cap-flows.json. Re-run after holdings
 * refresh:  npx tsx scripts/build-cap-flows.ts
 */
import fs from "node:fs";
import path from "node:path";
import { classifyCapFromNames, type CapTier } from "../src/data/cap-classification";
import { amcOf } from "../src/data/amc-name-map";

const DIR = path.join(process.cwd(), "public", "holdings");
const OUT = path.join(process.cwd(), "src", "data", "portfolio-tracker", "cap-flows.json");
// Shares-outstanding feed (keyed by fincode), populated out-of-band by
// scripts/ingest/shares-outstanding.ts from screener.in. Optional — when a
// company is missing here, its pctOutstanding is emitted as null and the UI
// renders "—". Read defensively so an absent/parse-broken file never blocks
// the cap-flows build.
const SHARES_OUT = path.join(
  process.cwd(),
  "src",
  "data",
  "portfolio-tracker",
  "shares-outstanding.json"
);
const TOP_N = 5;

interface SharesOutstandingEntry {
  sharesOutstanding: number;
}

function loadSharesOutstanding(): Map<string, number> {
  const m = new Map<string, number>();
  try {
    const raw = JSON.parse(fs.readFileSync(SHARES_OUT, "utf8")) as {
      companies?: Record<string, SharesOutstandingEntry>;
    };
    for (const [fincode, e] of Object.entries(raw.companies ?? {})) {
      if (e && Number.isFinite(e.sharesOutstanding) && e.sharesOutstanding > 0) {
        m.set(fincode, e.sharesOutstanding);
      }
    }
  } catch {
    // No feed yet (first run) or unreadable — proceed with empty map.
  }
  return m;
}

const isActiveEquity = (c: string) => /^Equity/.test(c) && !/ETF|Index|International/.test(c);

// AMC brand -> display label: amcOf + AMC_PREFIXES now live in the shared,
// runtime-safe src/data/amc-name-map.ts (imported above).

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

interface Agg {
  names: Map<string, number>;
  shCur: number;
  shPrev: number;
  valCur: number;
  valPrev: number;
  amc: Map<string, number>; // amc -> delta shares
}

function pickName(names: Map<string, number>): string {
  const clean = (s: string) =>
    s.replace(/^eq\s*-\s*/i, "").replace(/^[\s^*#~]+/, "").replace(/\s+/g, " ").trim();
  let best = "";
  let bestScore = -Infinity;
  for (const [raw, count] of names) {
    const n = clean(raw);
    if (!n) continue;
    const letters = n.replace(/[^a-zA-Z]/g, "");
    const lower = (n.match(/[a-z]/g) || []).length;
    const isAllCaps = letters.length > 0 && lower === 0;
    // prefer frequent, mixed-case, marker-free names
    const score = count * 2 + (isAllCaps ? -5 : 3) + (/^eq\b/i.test(raw) ? -5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
  const agg = new Map<string, Agg>();
  let monthCurLabel = "";
  let monthPrevLabel = "";
  let curSlug = "";
  let prevSlug = "";
  let fundCount = 0;

  const slugMonth = (l: string) =>
    l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (!isActiveEquity(j.meta?.classification ?? "")) continue;
    const months = j.meta?.months ?? [];
    if (months.length < 2) continue;
    if (!curSlug) {
      monthCurLabel = months[0].label;
      monthPrevLabel = months[1].label;
      curSlug = slugMonth(months[0].label);
      prevSlug = slugMonth(months[1].label);
    }
    const aumCur = num(months[0].aumCr);
    const aumPrev = num(months[1].aumCr);
    const amc = amcOf(j.meta.fund);
    fundCount++;

    for (const r of j.rows) {
      const cur = r.months?.[curSlug];
      const prev = r.months?.[prevSlug];
      const shC = cur ? num(cur.shares_num) : 0;
      const shP = prev ? num(prev.shares_num) : 0;
      const vC = cur && cur.aum_pct_num != null ? (num(cur.aum_pct_num) / 100) * aumCur : 0;
      const vP = prev && prev.aum_pct_num != null ? (num(prev.aum_pct_num) / 100) * aumPrev : 0;
      let a = agg.get(r.fincode);
      if (!a) {
        a = { names: new Map(), shCur: 0, shPrev: 0, valCur: 0, valPrev: 0, amc: new Map() };
        agg.set(r.fincode, a);
      }
      a.names.set(r.company_name, (a.names.get(r.company_name) ?? 0) + 1);
      a.shCur += shC;
      a.shPrev += shP;
      a.valCur += vC;
      a.valPrev += vP;
      const d = shC - shP;
      if (d !== 0) a.amc.set(amc, (a.amc.get(amc) ?? 0) + d);
    }
  }

  const sharesOutstanding = loadSharesOutstanding();

  interface Row {
    company: string;
    fincode: string;
    netCr: number;
    // Net shares traded by MFs (signed: + bought / − sold) as a % of the
    // company's total shares outstanding. null when no shares-outstanding
    // figure is available for this fincode yet.
    pctOutstanding: number | null;
    buyers: string[];
    sellers: string[];
    tier: CapTier;
  }
  const rows: Row[] = [];
  for (const [fincode, a] of agg) {
    const priceCur = a.shCur > 0 ? a.valCur / a.shCur : 0;
    const pricePrev = a.shPrev > 0 ? a.valPrev / a.shPrev : 0;
    const price = priceCur > 0 ? priceCur : pricePrev;
    if (price <= 0) continue;

    // Corporate-action guard: big share-count move with ~flat aggregate value
    // => split/bonus, not a trade.
    if (a.shPrev > 0 && a.shCur > 0 && a.valPrev > 0 && a.valCur > 0) {
      const shareRatio = a.shCur / a.shPrev;
      const valueRatio = a.valCur / a.valPrev;
      if ((shareRatio > 1.4 || shareRatio < 0.71) && valueRatio > 0.88 && valueRatio < 1.14) {
        continue;
      }
    }

    const netShares = a.shCur - a.shPrev;
    const netCr = netShares * price;
    if (Math.abs(netCr) < 1) continue; // ignore sub-1cr noise

    // % of the company's total shares outstanding that MFs net traded this
    // month (signed, mirrors netCr). null until the screener feed carries
    // a shares-outstanding figure for this fincode.
    const so = sharesOutstanding.get(fincode);
    const pctOutstanding =
      so && so > 0 ? (netShares / so) * 100 : null;

    const tier = classifyCapFromNames(a.names.keys());

    // The small bucket is the unrestricted universe, so guard it against
    // non-Indian-listed noise the large/mid lists already exclude: demerger /
    // unlisted markers ("**", "^^") and foreign-entity suffixes.
    if (tier === "small") {
      const marked = [...a.names.keys()].some((n) => /\*\*|\^\^/.test(n));
      const display = pickName(a.names);
      // Foreign entities end in these tokens; Indian listings end in Ltd/Limited.
      const foreign = /\b(inc|plc|llc|ord|adr|nv|ag|spa|gmbh|corp|co ltd)\b\.?$/i.test(display);
      if (marked || foreign) continue;
    }

    const byAmc = [...a.amc.entries()];
    const buyers = byAmc.filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]).slice(0, 3).map((e) => e[0]);
    const sellers = byAmc.filter(([, d]) => d < 0).sort((x, y) => x[1] - y[1]).slice(0, 3).map((e) => e[0]);

    rows.push({
      company: pickName(a.names),
      fincode,
      netCr: Math.round(netCr),
      pctOutstanding,
      buyers,
      sellers,
      tier,
    });
  }

  const round2 = (v: number | null): number | null =>
    v === null ? null : Math.round(v * 100) / 100;

  const card = (tier: CapTier) => {
    const inTier = rows.filter((r) => r.tier === tier);
    const bought = inTier
      .filter((r) => r.netCr > 0)
      .sort((x, y) => y.netCr - x.netCr)
      .slice(0, TOP_N)
      .map((r) => ({
        company: r.company,
        fincode: r.fincode,
        netCr: r.netCr,
        pctOutstanding: round2(r.pctOutstanding),
        amcs: r.buyers,
      }));
    const sold = inTier
      .filter((r) => r.netCr < 0)
      .sort((x, y) => x.netCr - y.netCr)
      .slice(0, TOP_N)
      .map((r) => ({
        company: r.company,
        fincode: r.fincode,
        netCr: Math.abs(r.netCr),
        pctOutstanding:
          r.pctOutstanding === null ? null : round2(Math.abs(r.pctOutstanding)),
        amcs: r.sellers,
      }));
    return { bought, sold };
  };

  const out = {
    meta: {
      monthCur: monthCurLabel,
      monthPrev: monthPrevLabel,
      generatedAt: new Date().toISOString(),
      universe: "Active equity schemes only (excludes ETFs, index, international and hybrid funds)",
      activeEquityFunds: fundCount,
      metric:
        "Net Rs Cr bought/sold = change in aggregate shares held x current implied price. Excludes corporate actions (split/bonus). pctOutstanding = net shares traded ÷ company shares outstanding x 100 (null until the screener feed covers the fincode).",
      topN: TOP_N,
    },
    large: card("large"),
    mid: card("mid"),
    small: card("small"),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const withPct = [out.large, out.mid, out.small].flatMap((c) => [
    ...c.bought,
    ...c.sold,
  ]).filter((r) => r.pctOutstanding !== null).length;
  console.log(`wrote ${OUT}`);
  console.log(`months: ${monthCurLabel} vs ${monthPrevLabel} | active-equity funds: ${fundCount} | companies: ${agg.size} | rows with shares-outstanding: ${withPct}`);
  const fmtPct = (v: number | null) => (v === null ? "  —  " : `${v.toFixed(2)}%`);
  for (const t of ["large", "mid", "small"] as CapTier[]) {
    const c = out[t];
    console.log(`\n### ${t.toUpperCase()} — bought ###`);
    c.bought.forEach((r) => console.log(`  +${r.netCr.toLocaleString("en-IN").padStart(7)} Cr  ${fmtPct(r.pctOutstanding).padStart(7)}  ${r.company}  [${r.amcs.join(", ")}]`));
    console.log(`### ${t.toUpperCase()} — sold ###`);
    c.sold.forEach((r) => console.log(`  -${r.netCr.toLocaleString("en-IN").padStart(7)} Cr  ${fmtPct(r.pctOutstanding).padStart(7)}  ${r.company}  [${r.amcs.join(", ")}]`));
  }
}

main();
