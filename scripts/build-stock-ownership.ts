/**
 * Build the stock-level MF ownership index powering the "Search Stocks" tab:
 * pick a company, see which mutual-fund schemes hold it, how many shares each
 * holds, and how that shareholding moved month over month.
 *
 * This is the inverse of the tracker's scheme-first view — same AMC-direct
 * disclosures, pivoted around the stock.
 *
 * Emits:
 *   - public/stocks/index.json      — the autocomplete directory (one small row
 *     per company: slug, name, sector, holder count). Fetched once by the tab.
 *   - public/stocks/<slug>.json     — per-company detail, fetched on demand:
 *     the month axis, total shares held per month, and every holding scheme with
 *     its AUM, the stock's weight in it, and its share count per month.
 *
 * NOTE on the month axis: AMC filings don't share a reporting month, so the axis
 * is the union of months across the universe (latest first) and a fund
 * contributes only to the months IT disclosed — a blank means "not disclosed",
 * never "sold out". Monthly totals therefore move partly with disclosure
 * coverage; the UI states the holder count per month for that reason.
 *
 * Run AFTER build:amc-direct (reads public/holdings-direct):
 *   npm run build:stocks
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HOLDINGS_DIR = path.join(ROOT, "public/holdings-direct");
const DIRECT_INDEX = path.join(ROOT, "src/data/portfolio-tracker/amc-direct-index.json");
const OUT_DIR = path.join(ROOT, "public/stocks");

/** Months of history carried per stock (the newest N of the union). */
const MONTHS = 6;
/** Ignore dust rows so the holder list stays meaningful. */
const MIN_SHARES = 1;

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthOrder(label: string): number {
  const m = String(label).trim().toLowerCase().match(/^([a-z]{3})[^0-9]*(\d{2,4})$/);
  if (!m) return -1;
  const mo = MON3.findIndex((x) => x.toLowerCase() === m[1]);
  if (mo < 0) return -1;
  let y = parseInt(m[2], 10);
  if (y < 100) y += 2000;
  return y * 12 + mo;
}
const slugMonth = (l: string) =>
  l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// A handful of corporate bonds / CDs reach the equity view because they carry an
// INE ISIN and no debt keyword the holdings classifier looks for
// ("11.25% Spandana Sphoorty Financial Limited 04-SEP-2026", "HDFC Bank Limited
// 24-JUN-2026"). They are debt securities, so they don't belong in a STOCK
// search — and one of them sorted first alphabetically. Identified by the two
// things equity names never carry: a leading coupon rate, or a maturity date.
const COUPON_LED = /^\s*\d+(\.\d+)?\s*%/;
const MATURITY_DATE =
  /(\b\d{1,2}[-/\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/\s]\d{2,4}\b)|(\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/i;
function looksLikeDebtSecurity(name: string): boolean {
  return COUPON_LED.test(name) || MATURITY_DATE.test(name);
}

/** Filesystem-safe key for a stock (ISIN, or a hashed name for ISIN-less rows). */
function slugify(key: string): string {
  const s = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 64) || "unknown";
}

/** Clean a disclosed company name for display: drop scrape markers, collapse
 *  whitespace. The legal suffix is kept — it's how these names are recognised. */
function cleanName(raw: string): string {
  return String(raw)
    .replace(/^eq\s*-\s*/i, "")
    .replace(/[\s^*#~£]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
/** Prefer a frequent, mixed-case spelling over an ALL-CAPS one. */
function pickName(names: Map<string, number>): string {
  let best = "";
  let bestScore = -Infinity;
  for (const [raw, count] of names) {
    const n = cleanName(raw);
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

interface DirectFund { schemecode: string; fundName?: string; name?: string; amc: string; classification: string | null }
interface HoldingsFile {
  meta?: { fund?: string; classification?: string; aumTotalCr?: number | null; months?: { label: string; aumCr: number | string | null }[] };
  rows?: {
    company_name: string;
    fincode: string;
    sector?: string | null;
    months: Record<string, { aum_pct_num?: number | null; shares_num?: number | null }>;
  }[];
}

interface HolderRow {
  scheme: string;
  amc: string;
  code: string;
  aumCr: number | null;
  /** The stock's weight in this scheme, latest disclosed month (% to NAV). */
  pctOfAum: number | null;
  /** Shares held, aligned to the stock's month axis; null = not disclosed. */
  shares: (number | null)[];
}
interface StockAgg {
  names: Map<string, number>;
  sectors: Map<string, number>;
  holders: HolderRow[];
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function main() {
  const idxRaw = readJson<{ funds?: DirectFund[] } | DirectFund[]>(DIRECT_INDEX, []);
  const directFunds: DirectFund[] = Array.isArray(idxRaw) ? idxRaw : idxRaw.funds ?? [];
  const metaByCode = new Map(directFunds.map((f) => [String(f.schemecode), f]));

  const files = fs.existsSync(HOLDINGS_DIR)
    ? fs.readdirSync(HOLDINGS_DIR).filter((f) => f.endsWith(".json") && f !== "index.json")
    : [];

  // Pass 1 — the global month axis (union across every scheme, newest first).
  const monthOrders = new Set<number>();
  for (const file of files) {
    const j = readJson<HoldingsFile>(path.join(HOLDINGS_DIR, file), {});
    for (const m of j.meta?.months ?? []) {
      const o = monthOrder(m.label);
      if (o > 0) monthOrders.add(o);
    }
  }
  const axis = [...monthOrders].sort((a, b) => b - a).slice(0, MONTHS);
  const axisLabels = axis.map((o) => `${MON3[((o % 12) + 12) % 12]}-${String(Math.floor(o / 12)).slice(-2)}`);
  const axisSlugs = axisLabels.map(slugMonth);

  // Pass 2 — pivot every scheme's equity rows onto the stock.
  const stocks = new Map<string, StockAgg>();
  let schemeCount = 0;

  for (const file of files) {
    const j = readJson<HoldingsFile>(path.join(HOLDINGS_DIR, file), {});
    const rows = j.rows ?? [];
    if (!rows.length) continue;
    const code = path.basename(file, ".json");
    const meta = metaByCode.get(code);
    const scheme = meta?.fundName || meta?.name || j.meta?.fund || code;
    const amc = meta?.amc ?? "";
    const aumCr = num(j.meta?.aumTotalCr);
    // Which of this scheme's own months land on each axis slot.
    const ownLabels = (j.meta?.months ?? []).map((m) => m.label);
    const ownSet = new Set(ownLabels.map(slugMonth));
    schemeCount++;

    for (const r of rows) {
      const key = String(r.fincode ?? "").trim() || `n:${r.company_name}`;
      let s = stocks.get(key);
      if (!s) {
        s = { names: new Map(), sectors: new Map(), holders: [] };
        stocks.set(key, s);
      }
      s.names.set(r.company_name, (s.names.get(r.company_name) ?? 0) + 1);
      const sec = (r.sector ?? "").trim();
      if (sec) s.sectors.set(sec, (s.sectors.get(sec) ?? 0) + 1);

      const shares = axisSlugs.map((slug) => {
        // Distinguish "this fund didn't file that month" (null) from "filed but
        // held none" (0) — only the latter is a real zero position.
        if (!ownSet.has(slug)) return null;
        return num(r.months?.[slug]?.shares_num);
      });
      // Weight comes from the newest month this fund actually disclosed.
      let pctOfAum: number | null = null;
      for (const slug of axisSlugs) {
        if (!ownSet.has(slug)) continue;
        const p = num(r.months?.[slug]?.aum_pct_num);
        if (p != null) { pctOfAum = p; break; }
      }
      // Skip funds that never held a meaningful position in the window.
      if (!shares.some((v) => v != null && v >= MIN_SHARES)) continue;
      s.holders.push({ scheme, amc, code, aumCr, pctOfAum, shares });
    }
  }

  // Write per-stock detail + collect the autocomplete directory.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  interface IndexRow { slug: string; name: string; sector: string; funds: number }
  const indexRows: IndexRow[] = [];
  const usedSlugs = new Set<string>();

  let skippedDebt = 0;
  for (const [key, s] of stocks) {
    if (s.holders.length === 0) continue;
    const name = pickName(s.names) || key;
    if (looksLikeDebtSecurity(name)) {
      skippedDebt++;
      continue;
    }
    const sector =
      [...s.sectors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unclassified";
    let slug = slugify(key);
    if (usedSlugs.has(slug)) {
      let n = 2;
      while (usedSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);

    // Biggest holder first (by the newest month with a number).
    const latestOf = (h: HolderRow) => h.shares.find((v) => v != null) ?? 0;
    const holders = s.holders.slice().sort((a, b) => latestOf(b) - latestOf(a));

    // Totals + how many funds reported in each month.
    const totalShares = axisLabels.map((_, i) => {
      let sum = 0;
      let any = false;
      for (const h of holders) {
        const v = h.shares[i];
        if (v != null) { sum += v; any = true; }
      }
      return any ? sum : null;
    });
    const holdersByMonth = axisLabels.map(
      (_, i) => holders.filter((h) => (h.shares[i] ?? 0) > 0).length
    );

    fs.writeFileSync(
      path.join(OUT_DIR, `${slug}.json`),
      JSON.stringify({
        slug,
        fincode: key.startsWith("n:") ? null : key,
        name,
        sector,
        months: axisLabels,
        fundCount: holders.filter((h) => (h.shares[0] ?? 0) > 0).length || holders.length,
        holdersByMonth,
        totalShares,
        funds: holders,
      }) + "\n",
      "utf8"
    );

    indexRows.push({
      slug,
      name,
      sector,
      funds: holders.filter((h) => (h.shares[0] ?? 0) > 0).length || holders.length,
    });
  }

  indexRows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({
      meta: {
        generatedAt: new Date().toISOString(),
        months: axisLabels,
        schemes: schemeCount,
        stocks: indexRows.length,
        source: "AMC-direct SEBI monthly portfolio disclosures",
        note: "Shareholding is not adjusted for outstanding derivative positions. A blank month means the fund did not disclose that month, not a nil holding.",
      },
      stocks: indexRows,
    }) + "\n",
    "utf8"
  );

  console.log(
    `wrote public/stocks/: ${indexRows.length} companies from ${schemeCount} schemes | months ${axisLabels.join(", ")}`
  );
  if (skippedDebt) console.log(`  skipped ${skippedDebt} debt securities (coupon-led / dated names)`);
  const top = [...indexRows].sort((a, b) => b.funds - a.funds).slice(0, 5);
  for (const t of top) console.log(`  ${String(t.funds).padStart(4)} funds  ${t.name} (${t.sector})`);
}

main();
