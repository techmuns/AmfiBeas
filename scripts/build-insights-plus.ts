/**
 * Build the "deep read" Insights blocks — the analytical layer the brokerage
 * research reports use, computed from OUR data (AMC-direct monthly disclosures
 * + the NAV snapshots). Five blocks, all precomputed here because the Insights
 * tab is statically rendered:
 *
 *   1. CONVICTION LEDGER — every position change split four ways (NEW / ADDED /
 *      TRIMMED / EXITED) per AMC-stock pair, bucketed Large/Mid/Small, with both
 *      ₹ value AND company counts. Net buying hides this: a brand-new position
 *      and a full exit are conviction statements; a top-up is housekeeping.
 *
 *   2. CONTESTED STOCKS — names where some fund houses BOUGHT while others SOLD
 *      the same month. Consensus is priced in; disagreement is the signal.
 *
 *   3. CHURN LEAGUE — per-AMC portfolio turnover, min(buys, sells) ÷ average
 *      book. The measurable counterpart to "long-term, patient" mandates.
 *
 *   4. FLOWS vs PERFORMANCE — does money reward performance? Each scheme's 3Y
 *      category percentile against its IMPLIED NET FLOW (book growth less the
 *      fund's own NAV return, so a market rally doesn't read as asset gathering).
 *      Four named quadrants: winning on merit / coasting on brand / falling
 *      behind / undiscovered.
 *
 *   5. QUARTILE PERSISTENCE — of the funds that were top-quartile over the PRIOR
 *      3 years, where are they now? A 4x4 transition matrix over two
 *      non-overlapping 3-year blocks, per active-equity cohort.
 *
 * IMPORTANT — non-uniform reporting months: AMC filings do not share a common
 * month (some AMCs are a month behind, a few skip one). Every month-over-month
 * figure here anchors to the LATEST month any fund disclosed and compares each
 * fund against ITS OWN previous disclosure; funds that have not filed the latest
 * month are excluded rather than read as having liquidated everything.
 *
 * Writes src/data/portfolio-tracker/insights-plus.json.
 * Run AFTER build:amc-direct (it reads public/holdings-direct):
 *   npm run build:insights-plus
 */
import fs from "node:fs";
import path from "node:path";
import { classifyCapFromNames, type CapTier } from "../src/data/cap-classification";

const ROOT = process.cwd();
const HOLDINGS_DIR = path.join(ROOT, "public/holdings-direct");
const DIRECT_INDEX = path.join(ROOT, "src/data/portfolio-tracker/amc-direct-index.json");
const NAV_DIR = path.join(ROOT, "public/nav-data");
const NAV_HISTORY_DIR = path.join(ROOT, "public/nav-history");
const OUT = path.join(ROOT, "src/data/portfolio-tracker/insights-plus.json");

// ---- shared helpers -------------------------------------------------------

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Sortable ordinal for a "Jun-26" style month label; -1 when unparseable. */
function monthOrder(label: string): number {
  const m = String(label).trim().toLowerCase().match(/^([a-z]{3})[^0-9]*(\d{2,4})$/);
  if (!m) return -1;
  const mo = MON3.findIndex((x) => x.toLowerCase() === m[1]);
  if (mo < 0) return -1;
  let y = parseInt(m[2], 10);
  if (y < 100) y += 2000;
  return y * 12 + mo;
}
const labelOfOrder = (o: number) => `${MON3[((o % 12) + 12) % 12]}-${String(Math.floor(o / 12)).slice(-2)}`;
const slugMonth = (l: string) =>
  l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Active, actively-managed equity only — ETFs / index / international funds
 *  don't express conviction, so they'd only add noise to every block here. */
const isActiveEquity = (c: string) => /^Equity/.test(c) && !/ETF|Index|International/.test(c);

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Display name: drop the Ltd/Limited suffix and stray disclosure markers. */
function cleanCompany(raw: string): string {
  return String(raw)
    .replace(/^eq\s*-\s*/i, "")
    .replace(/[\s^*#~£]+$/g, "")
    .replace(/\s+(Ltd\.?|Limited)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
/** Prefer a frequent, mixed-case, marker-free spelling of a company name. */
function pickName(names: Map<string, number>): string {
  let best = "";
  let bestScore = -Infinity;
  for (const [raw, count] of names) {
    const n = cleanCompany(raw);
    if (!n) continue;
    const letters = n.replace(/[^a-zA-Z]/g, "");
    const lower = (n.match(/[a-z]/g) || []).length;
    const allCaps = letters.length > 0 && lower === 0;
    const score = count * 2 + (allCaps ? -5 : 3);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}
const cleanScheme = (s: string) =>
  s.replace(/\([^)]*\)\s*$/, "").replace(/\s*[-–]\s*(Reg|Dir|Direct|Regular)\s*$/i, "").replace(/[\s-–]+$/, "").trim();

// ---- holdings pass --------------------------------------------------------

interface DirectFund {
  schemecode: string;
  fundName?: string;
  name?: string;
  classification: string | null;
  amc: string;
  file: string;
}

/** One (AMC, stock) position: aggregate shares/value across that AMC's schemes
 *  for the latest month and each fund's own prior month. */
interface Position {
  amc: string;
  fincode: string;
  shCur: number;
  shPrev: number;
}
/** Industry aggregate for a stock — drives the implied trade price + cap tier. */
interface StockAgg {
  names: Map<string, number>;
  shCur: number;
  shPrev: number;
  valCur: number;
  valPrev: number;
}
/** Per-AMC book totals, for the churn denominator. */
interface AmcBook {
  bookCur: number;
  bookPrev: number;
  buyCr: number;
  sellCr: number;
  schemes: number;
  holdings: Set<string>;
}

function main() {
  const idxRaw = readJson<{ funds?: DirectFund[] } | DirectFund[]>(DIRECT_INDEX, []);
  const directFunds: DirectFund[] = Array.isArray(idxRaw) ? idxRaw : idxRaw.funds ?? [];
  const amcByCode = new Map(directFunds.map((f) => [String(f.schemecode), f.amc]));
  const nameByCode = new Map(directFunds.map((f) => [String(f.schemecode), f.fundName || f.name || ""]));

  const files = fs.existsSync(HOLDINGS_DIR)
    ? fs.readdirSync(HOLDINGS_DIR).filter((f) => f.endsWith(".json") && f !== "index.json")
    : [];

  // Pass 1 — find the latest month anyone disclosed.
  let latestOrder = -1;
  for (const file of files) {
    const j = readJson<{ meta?: { classification?: string; months?: { label: string }[] } }>(path.join(HOLDINGS_DIR, file), {});
    if (!isActiveEquity(j.meta?.classification ?? "")) continue;
    const l = j.meta?.months?.[0]?.label;
    if (!l) continue;
    const o = monthOrder(l);
    if (o > latestOrder) latestOrder = o;
  }
  const monthCur = latestOrder >= 0 ? labelOfOrder(latestOrder) : "";
  const monthPrev = latestOrder >= 0 ? labelOfOrder(latestOrder - 1) : "";

  // Pass 2 — per-fund month-over-month, aggregated per stock and per (AMC, stock).
  const stocks = new Map<string, StockAgg>();
  const positions = new Map<string, Position>(); // key: amc|fincode
  const amcBooks = new Map<string, AmcBook>();
  // Scheme book: latest vs ~3 months back, for the flows-vs-performance block.
  const schemeBook = new Map<string, { cur: number; older: number; olderLabel: string; monthsBack: number }>();
  let fundCount = 0;

  interface HoldingsFile {
    meta?: { classification?: string; fund?: string; months?: { label: string; aumCr: number | string | null }[] };
    rows?: {
      company_name: string;
      fincode: string;
      months: Record<string, { aum_pct_num?: number | null; shares_num?: number | null }>;
    }[];
  }

  for (const file of files) {
    const j = readJson<HoldingsFile>(path.join(HOLDINGS_DIR, file), {});
    const cls = j.meta?.classification ?? "";
    if (!isActiveEquity(cls)) continue;
    const months = j.meta?.months ?? [];
    if (months.length < 2) continue;
    // Only funds whose newest disclosure IS the latest month participate.
    if (monthOrder(months[0].label) !== latestOrder) continue;

    const code = path.basename(file, ".json");
    const amc = amcByCode.get(code) ?? "Unknown";
    const curSlug = slugMonth(months[0].label);
    const prevSlug = slugMonth(months[1].label);
    const aumCur = num(months[0].aumCr);
    const aumPrev = num(months[1].aumCr);
    fundCount++;

    // Scheme book for the flows block: latest vs up to 3 months back.
    const backIdx = Math.min(3, months.length - 1);
    schemeBook.set(code, {
      cur: aumCur,
      older: num(months[backIdx].aumCr),
      olderLabel: months[backIdx].label,
      monthsBack: backIdx,
    });

    let book = amcBooks.get(amc);
    if (!book) {
      book = { bookCur: 0, bookPrev: 0, buyCr: 0, sellCr: 0, schemes: 0, holdings: new Set() };
      amcBooks.set(amc, book);
    }
    book.schemes++;
    book.bookCur += aumCur;
    book.bookPrev += aumPrev;

    for (const r of j.rows ?? []) {
      const cur = r.months?.[curSlug];
      const prev = r.months?.[prevSlug];
      const shC = cur ? num(cur.shares_num) : 0;
      const shP = prev ? num(prev.shares_num) : 0;
      const vC = cur?.aum_pct_num != null ? (num(cur.aum_pct_num) / 100) * aumCur : 0;
      const vP = prev?.aum_pct_num != null ? (num(prev.aum_pct_num) / 100) * aumPrev : 0;
      if (shC === 0 && shP === 0 && vC === 0 && vP === 0) continue;

      let a = stocks.get(r.fincode);
      if (!a) {
        a = { names: new Map(), shCur: 0, shPrev: 0, valCur: 0, valPrev: 0 };
        stocks.set(r.fincode, a);
      }
      a.names.set(r.company_name, (a.names.get(r.company_name) ?? 0) + 1);
      a.shCur += shC;
      a.shPrev += shP;
      a.valCur += vC;
      a.valPrev += vP;

      if (shC > 0) book.holdings.add(r.fincode);

      const pk = `${amc}|${r.fincode}`;
      let p = positions.get(pk);
      if (!p) {
        p = { amc, fincode: r.fincode, shCur: 0, shPrev: 0 };
        positions.set(pk, p);
      }
      p.shCur += shC;
      p.shPrev += shP;
    }
  }

  // Implied trade price per stock + corporate-action guard (mirrors cap-flows:
  // a big share-count move with a ~flat aggregate value is a split/bonus).
  const priceOf = new Map<string, number>();
  const tierOf = new Map<string, CapTier>();
  const displayOf = new Map<string, string>();
  for (const [fincode, a] of stocks) {
    const pc = a.shCur > 0 ? a.valCur / a.shCur : 0;
    const pp = a.shPrev > 0 ? a.valPrev / a.shPrev : 0;
    const price = pc > 0 ? pc : pp;
    if (price <= 0) continue;
    if (a.shPrev > 0 && a.shCur > 0 && a.valPrev > 0 && a.valCur > 0) {
      const sr = a.shCur / a.shPrev;
      const vr = a.valCur / a.valPrev;
      if ((sr > 1.4 || sr < 0.71) && vr > 0.88 && vr < 1.14) continue;
    }
    priceOf.set(fincode, price);
    tierOf.set(fincode, classifyCapFromNames(a.names.keys()));
    displayOf.set(fincode, pickName(a.names));
  }

  // ---- 1. Conviction ledger ---------------------------------------------
  type Quad = "new" | "increased" | "decreased" | "exited";
  const TIERS: CapTier[] = ["large", "mid", "small"];
  interface QuadAcc {
    totalCr: number;
    positions: number;
    companies: Set<string>;
    byTier: Record<CapTier, { cr: number; positions: number; companies: Set<string> }>;
    perCompany: Map<string, { cr: number; amcs: Map<string, number> }>;
  }
  const mkQuad = (): QuadAcc => ({
    totalCr: 0,
    positions: 0,
    companies: new Set(),
    byTier: {
      large: { cr: 0, positions: 0, companies: new Set() },
      mid: { cr: 0, positions: 0, companies: new Set() },
      small: { cr: 0, positions: 0, companies: new Set() },
    },
    perCompany: new Map(),
  });
  const quads: Record<Quad, QuadAcc> = {
    new: mkQuad(),
    increased: mkQuad(),
    decreased: mkQuad(),
    exited: mkQuad(),
  };
  // Buy/sell sides per stock (for contested) and per AMC (for churn).
  const sides = new Map<string, { buyers: Map<string, number>; sellers: Map<string, number> }>();

  const MIN_POSITION_CR = 1; // ignore sub-₹1 Cr dust

  for (const p of positions.values()) {
    const price = priceOf.get(p.fincode);
    if (price === undefined) continue;
    const d = p.shCur - p.shPrev;
    if (d === 0) continue;
    const valueCr = Math.abs(d) * price;

    // Churn accumulates every move, however small.
    const book = amcBooks.get(p.amc);
    if (book) {
      if (d > 0) book.buyCr += valueCr;
      else book.sellCr += valueCr;
    }

    if (valueCr < MIN_POSITION_CR) continue;

    let q: Quad;
    if (p.shPrev <= 0 && p.shCur > 0) q = "new";
    else if (p.shCur <= 0 && p.shPrev > 0) q = "exited";
    else q = d > 0 ? "increased" : "decreased";

    const acc = quads[q];
    const tier = tierOf.get(p.fincode) ?? "small";
    const name = displayOf.get(p.fincode) || p.fincode;
    acc.totalCr += valueCr;
    acc.positions++;
    acc.companies.add(p.fincode);
    acc.byTier[tier].cr += valueCr;
    acc.byTier[tier].positions++;
    acc.byTier[tier].companies.add(p.fincode);
    const pc = acc.perCompany.get(name) ?? { cr: 0, amcs: new Map<string, number>() };
    pc.cr += valueCr;
    pc.amcs.set(p.amc, (pc.amcs.get(p.amc) ?? 0) + valueCr);
    acc.perCompany.set(name, pc);

    let s = sides.get(p.fincode);
    if (!s) {
      s = { buyers: new Map(), sellers: new Map() };
      sides.set(p.fincode, s);
    }
    if (d > 0) s.buyers.set(p.amc, (s.buyers.get(p.amc) ?? 0) + valueCr);
    else s.sellers.set(p.amc, (s.sellers.get(p.amc) ?? 0) + valueCr);
  }

  const topNames = (acc: QuadAcc, n = 6) =>
    [...acc.perCompany.entries()]
      .sort((a, b) => b[1].cr - a[1].cr)
      .slice(0, n)
      .map(([company, v]) => ({
        company,
        valueCr: Math.round(v.cr),
        amcs: [...v.amcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
      }));
  const quadOut = (q: Quad) => {
    const acc = quads[q];
    return {
      totalCr: Math.round(acc.totalCr),
      positions: acc.positions,
      companies: acc.companies.size,
      byTier: Object.fromEntries(
        TIERS.map((t) => [t, { valueCr: Math.round(acc.byTier[t].cr), positions: acc.byTier[t].positions, companies: acc.byTier[t].companies.size }])
      ) as Record<CapTier, { valueCr: number; positions: number; companies: number }>,
      top: topNames(acc),
    };
  };
  const convictionLedger = {
    monthCur,
    monthPrev,
    funds: fundCount,
    amcs: amcBooks.size,
    quadrants: {
      new: quadOut("new"),
      increased: quadOut("increased"),
      decreased: quadOut("decreased"),
      exited: quadOut("exited"),
    },
  };

  // ---- 2. Contested stocks ----------------------------------------------
  // Real disagreement = at least 2 fund houses on EACH side of the same name in
  // the same month. Ranked by how balanced the split is, then by gross value.
  const MIN_SIDE = 2;
  const contestedRows = [...sides.entries()]
    .map(([fincode, s]) => {
      const buyCr = [...s.buyers.values()].reduce((x, y) => x + y, 0);
      const sellCr = [...s.sellers.values()].reduce((x, y) => x + y, 0);
      const topBuyer = [...s.buyers.entries()].sort((a, b) => b[1] - a[1])[0];
      const topSeller = [...s.sellers.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        company: displayOf.get(fincode) || fincode,
        tier: tierOf.get(fincode) ?? "small",
        buyers: s.buyers.size,
        sellers: s.sellers.size,
        buyCr: Math.round(buyCr),
        sellCr: Math.round(sellCr),
        netCr: Math.round(buyCr - sellCr),
        grossCr: Math.round(buyCr + sellCr),
        topBuyer: topBuyer ? topBuyer[0] : "",
        topSeller: topSeller ? topSeller[0] : "",
      };
    })
    .filter((r) => r.buyers >= MIN_SIDE && r.sellers >= MIN_SIDE && r.grossCr >= 50)
    .sort(
      (a, b) =>
        Math.min(b.buyers, b.sellers) - Math.min(a.buyers, a.sellers) || b.grossCr - a.grossCr
    )
    .slice(0, 15);
  const contested = { month: monthCur, monthPrev, rows: contestedRows };

  // ---- 3. Churn league ---------------------------------------------------
  // Turnover = min(buys, sells) ÷ average book — the share of the portfolio
  // genuinely rotated (matched buying and selling), not net flow.
  const MIN_BOOK_CR = 500;
  const churnRows = [...amcBooks.entries()]
    .map(([amc, b]) => {
      const avgBook = (b.bookCur + b.bookPrev) / 2;
      const matched = Math.min(b.buyCr, b.sellCr);
      return {
        amc,
        turnoverPct: avgBook > 0 ? r2((matched / avgBook) * 100) : 0,
        buyCr: Math.round(b.buyCr),
        sellCr: Math.round(b.sellCr),
        bookCr: Math.round(b.bookCur),
        schemes: b.schemes,
        holdings: b.holdings.size,
      };
    })
    .filter((r) => r.bookCr >= MIN_BOOK_CR)
    .sort((a, b) => b.turnoverPct - a.turnoverPct);
  const churn = {
    month: monthCur,
    monthPrev,
    minBookCr: MIN_BOOK_CR,
    medianTurnoverPct: churnRows.length
      ? r2(churnRows[Math.floor(churnRows.length / 2)].turnoverPct)
      : 0,
    rows: churnRows,
  };

  // ---- 4. Flows vs performance ------------------------------------------
  interface CategoryFund {
    schemecode: string;
    fundName: string;
    classification: string | null;
    periodRanks: Record<string, { percentile?: number; quartile?: string; return?: number; peerCount?: number; statsAvailable?: boolean } | undefined>;
  }
  const catSnap = readJson<{ fundRanks?: CategoryFund[] }>(path.join(NAV_DIR, "mf-category-returns.json"), {});
  const catByCode = new Map((catSnap.fundRanks ?? []).map((f) => [f.schemecode, f]));
  const retSnap = readJson<{ funds?: { schemecode: string; returns?: Record<string, { value: number } | undefined> }[] }>(
    path.join(NAV_DIR, "mf-returns.json"),
    {}
  );
  const retByCode = new Map((retSnap.funds ?? []).map((f) => [f.schemecode, f]));

  const PERF_PERIOD = "3Y";
  interface FlowRow {
    fund: string;
    amc: string;
    classification: string;
    percentile: number;
    quartile: string;
    perfReturn: number | null;
    bookGrowthPct: number;
    navReturnPct: number;
    impliedFlowPct: number;
    bookCr: number;
    /** Months between the two book observations — used to label the window. */
    monthsBack: number;
  }
  const flowRows: FlowRow[] = [];
  for (const [code, sb] of schemeBook) {
    if (sb.monthsBack < 1 || sb.cur <= 0 || sb.older <= 0) continue;
    const cat = catByCode.get(code);
    const pr = cat?.periodRanks?.[PERF_PERIOD];
    if (!cat || !pr || !pr.statsAvailable || typeof pr.percentile !== "number") continue;
    // NAV return over roughly the same window (3M feed return for a 3-month
    // book window) — subtracting it strips market movement out of book growth.
    const navKey = sb.monthsBack >= 3 ? "3M" : sb.monthsBack === 2 ? "3M" : "1M";
    const nav = retByCode.get(code)?.returns?.[navKey];
    if (!nav || typeof nav.value !== "number") continue;
    const bookGrowthPct = (sb.cur / sb.older - 1) * 100;
    const impliedFlowPct = bookGrowthPct - nav.value;
    flowRows.push({
      fund: cleanScheme(cat.fundName || nameByCode.get(code) || code),
      amc: amcByCode.get(code) ?? "Unknown",
      classification: cat.classification ?? "",
      percentile: r1(pr.percentile),
      quartile: pr.quartile ?? "",
      perfReturn: typeof pr.return === "number" ? r1(pr.return) : null,
      bookGrowthPct: r1(bookGrowthPct),
      navReturnPct: r1(nav.value),
      impliedFlowPct: r1(impliedFlowPct),
      bookCr: Math.round(sb.cur),
      monthsBack: sb.monthsBack,
    });
  }
  // Drop coverage artifacts: the AMC-direct book is a sum of PARSED holdings, so
  // a month whose filing parsed only partially would read as a huge flow. An
  // implied flow beyond this band over a ~quarter is a parsing gap, not investors.
  const MAX_PLAUSIBLE_FLOW_PCT = 60;
  const cleanRows = flowRows.filter((r) => Math.abs(r.impliedFlowPct) <= MAX_PLAUSIBLE_FLOW_PCT);
  // Compare each fund to the MEDIAN fund rather than to zero. The book is
  // disclosure-derived, so its level carries a systematic bias (older months are
  // parsed slightly less completely); a median split cancels any such uniform
  // bias and turns the axis into the question that actually matters — is this
  // fund gathering assets faster or slower than its typical peer?
  const flowsSorted = [...cleanRows].map((r) => r.impliedFlowPct).sort((a, b) => a - b);
  const medianFlow = flowsSorted.length
    ? flowsSorted[Math.floor(flowsSorted.length / 2)]
    : 0;
  // Percentile convention in the snapshot: HIGHER = better.
  const good = (r: FlowRow) => r.percentile >= 50;
  const gaining = (r: FlowRow) => r.impliedFlowPct >= medianFlow;
  const bucket = (pred: (r: FlowRow) => boolean, dir: "desc" | "asc") => {
    const rows = cleanRows.filter(pred).sort((a, b) =>
      dir === "desc" ? b.impliedFlowPct - a.impliedFlowPct : a.impliedFlowPct - b.impliedFlowPct
    );
    return { count: rows.length, rows: rows.slice(0, 8) };
  };
  // Label the window from the MODAL lookback across the schemes actually used
  // (most have 3 months of history; a few only have 1–2), so the caption is
  // representative rather than whatever the first scheme happened to have.
  const backCounts = new Map<number, number>();
  for (const r of cleanRows) backCounts.set(r.monthsBack, (backCounts.get(r.monthsBack) ?? 0) + 1);
  const modalBack = [...backCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
  const flowsVsPerf = {
    month: monthCur,
    windowLabel: `${latestOrder >= 0 ? labelOfOrder(latestOrder - modalBack) : monthPrev} → ${monthCur}`,
    windowMonths: modalBack,
    period: PERF_PERIOD,
    universe: cleanRows.length,
    medianFlowPct: r1(medianFlow),
    quadrants: {
      // Strong performance AND gathering faster than the median fund.
      winning: bucket((r) => good(r) && gaining(r), "desc"),
      // Weak performance but still gathering — brand/distribution at work.
      coasting: bucket((r) => !good(r) && gaining(r), "desc"),
      // Weak performance and gathering slower than the median.
      falling: bucket((r) => !good(r) && !gaining(r), "asc"),
      // Strong performance the money hasn't found yet.
      undiscovered: bucket((r) => good(r) && !gaining(r), "asc"),
    },
  };

  // ---- 5. Quartile persistence ------------------------------------------
  interface ManifestFund {
    schemecode: string;
    fundName: string;
    classification: string | null;
    firstDate: string;
    lastDate: string;
    available?: boolean;
  }
  const manifest = readJson<{ funds?: ManifestFund[] }>(path.join(NAV_DIR, "mf-history-manifest.json"), {});
  const mFunds = (manifest.funds ?? []).filter(
    (f) => f.available && isActiveEquity(f.classification ?? "")
  );
  const asOf = mFunds.reduce((m, f) => (f.lastDate > m ? f.lastDate : m), "");
  const shiftYears = (iso: string, years: number) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
  };
  const tRecentEnd = asOf;
  const tMid = shiftYears(asOf, 3);
  const tPriorStart = shiftYears(asOf, 6);
  const TOL_DAYS = 20;
  const dayDiff = (a: string, b: string) =>
    Math.abs((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
  /** NAV on the trading day closest to `target`, within TOL_DAYS. */
  function navAt(series: [string, number][], target: string): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const [d, v] of series) {
      const diff = dayDiff(d, target);
      if (diff < bestD) {
        bestD = diff;
        best = v;
      } else if (d > target && diff > bestD) break;
    }
    return bestD <= TOL_DAYS && best !== null && best > 0 ? best : null;
  }
  const cagr = (from: number, to: number, years: number) =>
    from > 0 && to > 0 ? (Math.pow(to / from, 1 / years) - 1) * 100 : null;

  interface PersistFund {
    fund: string;
    classification: string;
    prior: number;
    recent: number;
  }
  const persistFunds: PersistFund[] = [];
  for (const f of mFunds) {
    if (f.firstDate > tPriorStart) continue; // not enough history for both blocks
    const file = path.join(NAV_HISTORY_DIR, `${f.schemecode}.json`);
    const hist = readJson<{ series?: [string, number][] }>(file, {});
    const series = hist.series ?? [];
    if (series.length < 100) continue;
    const n0 = navAt(series, tPriorStart);
    const n1 = navAt(series, tMid);
    const n2 = navAt(series, tRecentEnd);
    if (n0 === null || n1 === null || n2 === null) continue;
    const prior = cagr(n0, n1, 3);
    const recent = cagr(n1, n2, 3);
    if (prior === null || recent === null) continue;
    persistFunds.push({
      fund: cleanScheme(f.fundName),
      classification: f.classification ?? "",
      prior,
      recent,
    });
  }
  // Quartiles are assigned WITHIN each category cohort (comparing a small-cap
  // fund's return to a large-cap fund's would just measure the cap cycle).
  const MIN_COHORT = 8;
  const byCohort = new Map<string, PersistFund[]>();
  for (const f of persistFunds) {
    const arr = byCohort.get(f.classification) ?? [];
    arr.push(f);
    byCohort.set(f.classification, arr);
  }
  const matrix = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  /** 0-based quartile index by rank position (0 = best quartile). */
  const quartileIdx = (rank: number, n: number) => Math.min(3, Math.floor((rank / n) * 4));
  let cohortsUsed = 0;
  let fundsUsed = 0;
  const stayers: { fund: string; classification: string; prior: number; recent: number }[] = [];
  for (const [cohort, arr] of byCohort) {
    if (arr.length < MIN_COHORT) continue;
    cohortsUsed++;
    const n = arr.length;
    const priorRank = new Map<PersistFund, number>();
    [...arr].sort((a, b) => b.prior - a.prior).forEach((f, i) => priorRank.set(f, i));
    const recentRank = new Map<PersistFund, number>();
    [...arr].sort((a, b) => b.recent - a.recent).forEach((f, i) => recentRank.set(f, i));
    for (const f of arr) {
      const qp = quartileIdx(priorRank.get(f)!, n);
      const qr = quartileIdx(recentRank.get(f)!, n);
      matrix[qp][qr]++;
      fundsUsed++;
      if (qp === 0 && qr === 0) {
        stayers.push({ fund: f.fund, classification: cohort, prior: r1(f.prior), recent: r1(f.recent) });
      }
    }
  }
  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const q1Total = rowTotals[0] || 1;
  const persistence = {
    asOf,
    priorWindow: { from: tPriorStart, to: tMid },
    recentWindow: { from: tMid, to: tRecentEnd },
    cohorts: cohortsUsed,
    funds: fundsUsed,
    minCohort: MIN_COHORT,
    matrix,
    rowTotals,
    q1StayPct: r1((matrix[0][0] / q1Total) * 100),
    q1ToBottomHalfPct: r1(((matrix[0][2] + matrix[0][3]) / q1Total) * 100),
    topStayers: stayers.sort((a, b) => b.recent - a.recent).slice(0, 8),
  };

  // ---- write -------------------------------------------------------------
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      monthCur,
      monthPrev,
      universe:
        "Actively-managed equity schemes from the AMC-direct monthly disclosures (excludes ETFs, index and international funds).",
      anchoring:
        "Anchored to the latest month any fund disclosed; each fund is compared against its OWN previous disclosure. Funds that have not filed the latest month are excluded.",
    },
    convictionLedger,
    contested,
    churn,
    flowsVsPerf,
    persistence,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  const q = convictionLedger.quadrants;
  console.log(`wrote ${OUT}`);
  console.log(`months: ${monthCur} vs ${monthPrev} | funds: ${fundCount} | AMCs: ${amcBooks.size} | stocks: ${stocks.size}`);
  console.log(
    `ledger — new ₹${q.new.totalCr.toLocaleString("en-IN")} Cr (${q.new.companies} cos) · added ₹${q.increased.totalCr.toLocaleString("en-IN")} Cr (${q.increased.companies}) · trimmed ₹${q.decreased.totalCr.toLocaleString("en-IN")} Cr (${q.decreased.companies}) · exited ₹${q.exited.totalCr.toLocaleString("en-IN")} Cr (${q.exited.companies})`
  );
  console.log(`contested: ${contestedRows.length} names | churn: ${churnRows.length} AMCs (median ${churn.medianTurnoverPct}%)`);
  console.log(
    `flows vs perf: ${flowRows.length} schemes — winning ${flowsVsPerf.quadrants.winning.count} · coasting ${flowsVsPerf.quadrants.coasting.count} · falling ${flowsVsPerf.quadrants.falling.count} · undiscovered ${flowsVsPerf.quadrants.undiscovered.count}`
  );
  console.log(
    `persistence: ${fundsUsed} funds / ${cohortsUsed} cohorts | Q1 stayed Q1: ${persistence.q1StayPct}% | Q1 → bottom half: ${persistence.q1ToBottomHalfPct}%`
  );
}

main();
