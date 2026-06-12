/**
 * Build FUND-WISE (AMC-level) portfolio snapshots from the per-scheme equity
 * holdings (public/holdings).
 *
 * The MFs Portfolio Tracker is scheme-wise: pick one scheme, see its holdings.
 * The fund-wise view answers the sibling question — "what does HDFC / SBI /
 * ICICI hold across ALL its schemes combined?" — by grouping every scheme by
 * its fund house (amcOf) and aggregating holdings:
 *
 *   - shares  = Σ shares held across the AMC's schemes (per company, per month)
 *   - value   = Σ (scheme aum_pct × scheme AUM)           (per company, per month)
 *   - % book  = company value ÷ AMC's total equity-holdings value that month
 *   - arrow   = aggregated share count vs the next-older month (up/down/flat)
 *
 * Output mirrors the per-scheme FundPortfolio shape so the UI reuses the same
 * holdings rendering. Per-AMC files are written to public/fundwise/<slug>.json
 * (fetched on demand, like the scheme files); a lightweight directory is
 * bundled at src/data/portfolio-tracker/fundwise-index.json.
 *
 * Re-run after a holdings refresh:  npx tsx scripts/build-fundwise-portfolios.ts
 */
import fs from "node:fs";
import path from "node:path";
import { amcOf } from "../src/data/amc-name-map";

const DIR = path.join(process.cwd(), "public", "holdings");
const OUT_DIR = path.join(process.cwd(), "public", "fundwise");
const INDEX_OUT = path.join(
  process.cwd(),
  "src",
  "data",
  "portfolio-tracker",
  "fundwise-index.json"
);

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const slugMonth = (l: string) =>
  l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const amcSlug = (amc: string) =>
  amc.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
/** "Apr-26" → sortable key 2026_04 (descending sort = newest first). */
function monthSortKey(label: string): number {
  const m = label.trim().toLowerCase().match(/^([a-z]{3})[^0-9]*'?(\d{2,4})$/);
  if (!m) return 0;
  const mo = MONTHS_LOOKUP[m[1]] ?? 0;
  let y = Number(m[2]);
  if (y < 100) y += 2000;
  return y * 100 + mo;
}

/** Pick a clean, human display name from the variants a company appears under
 *  across schemes — prefer frequent, mixed-case, marker-free strings. */
function pickName(names: Map<string, number>): string {
  const clean = (s: string) =>
    s.replace(/^eq\s*-\s*/i, "").replace(/^[\s^*#~£@]+/, "").replace(/[£@*#~^]+$/, "").replace(/\s+/g, " ").trim();
  let best = "";
  let bestScore = -Infinity;
  for (const [raw, count] of names) {
    const n = clean(raw);
    if (!n) continue;
    const letters = n.replace(/[^a-zA-Z]/g, "");
    const lower = (n.match(/[a-z]/g) || []).length;
    const isAllCaps = letters.length > 0 && lower === 0;
    const score = count * 2 + (isAllCaps ? -5 : 3);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

const fmtSharesIndian = (n: number): string =>
  Math.round(n).toLocaleString("en-IN");

interface CompanyAgg {
  fincode: string;
  names: Map<string, number>;
  /** monthSlug → aggregated shares */
  shares: Map<string, number>;
  /** monthSlug → aggregated ₹ Cr value */
  value: Map<string, number>;
}

interface AmcAgg {
  amc: string;
  schemeCount: number;
  /** label → slug, kept so we can render real labels */
  monthLabels: Map<string, string>;
  /** monthSlug → total equity-holdings value (₹ Cr) — the %-book denominator */
  monthTotalValue: Map<string, number>;
  companies: Map<string, CompanyAgg>;
}

function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  const byAmc = new Map<string, AmcAgg>();

  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    const months: { label: string; aumCr: string | number | null }[] =
      j.meta?.months ?? [];
    if (months.length === 0 || !Array.isArray(j.rows)) continue;

    const amc = amcOf(j.meta?.fund ?? file);
    let agg = byAmc.get(amc);
    if (!agg) {
      agg = {
        amc,
        schemeCount: 0,
        monthLabels: new Map(),
        monthTotalValue: new Map(),
        companies: new Map(),
      };
      byAmc.set(amc, agg);
    }
    agg.schemeCount++;

    // Per-scheme month → (slug, AUM) for value weighting.
    const schemeMonths = months.map((m) => ({
      label: m.label,
      slug: slugMonth(m.label),
      aum: num(m.aumCr) || num(j.meta?.aumTotalCr),
    }));
    for (const sm of schemeMonths) agg.monthLabels.set(sm.label, sm.slug);

    for (const r of j.rows) {
      const fincode = String(r.fincode ?? "").trim();
      const key = fincode || `name:${(r.company_name ?? "").toLowerCase().trim()}`;
      if (!key) continue;
      let c = agg.companies.get(key);
      if (!c) {
        c = { fincode, names: new Map(), shares: new Map(), value: new Map() };
        agg.companies.set(key, c);
      }
      if (r.company_name) {
        c.names.set(r.company_name, (c.names.get(r.company_name) ?? 0) + 1);
      }
      for (const sm of schemeMonths) {
        const cell = r.months?.[sm.slug];
        if (!cell) continue;
        const sh = num(cell.shares_num);
        const pct = cell.aum_pct_num == null ? 0 : num(cell.aum_pct_num);
        const val = sm.aum > 0 ? (pct / 100) * sm.aum : 0;
        if (sh !== 0) c.shares.set(sm.slug, (c.shares.get(sm.slug) ?? 0) + sh);
        if (val !== 0) {
          c.value.set(sm.slug, (c.value.get(sm.slug) ?? 0) + val);
          agg.monthTotalValue.set(
            sm.slug,
            (agg.monthTotalValue.get(sm.slug) ?? 0) + val
          );
        }
      }
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  interface DirEntry {
    slug: string;
    amc: string;
    schemeCount: number;
    holdingsCount: number;
    equityValueCr: number;
    latestMonth: string;
    path: string;
  }
  const directory: DirEntry[] = [];

  for (const agg of byAmc.values()) {
    // Ordered months (newest first) that actually carry value.
    const monthEntries = [...agg.monthLabels.entries()]
      .filter(([, slug]) => (agg.monthTotalValue.get(slug) ?? 0) > 0)
      .sort((a, b) => monthSortKey(b[0]) - monthSortKey(a[0]));
    if (monthEntries.length === 0) continue;
    const orderedSlugs = monthEntries.map(([, slug]) => slug);

    const rows = [...agg.companies.values()]
      .map((c) => {
        const name = pickName(c.names) || c.fincode;
        const monthsObj: Record<string, unknown> = {};
        orderedSlugs.forEach((slug, i) => {
          const total = agg.monthTotalValue.get(slug) ?? 0;
          const sh = c.shares.get(slug);
          const val = c.value.get(slug);
          const hasData = sh !== undefined || val !== undefined;
          if (!hasData) return;
          const pct = total > 0 && val !== undefined ? (val / total) * 100 : null;
          // Arrow vs the next-older month's aggregated share count.
          const olderSlug = orderedSlugs[i + 1];
          const olderSh = olderSlug ? c.shares.get(olderSlug) : undefined;
          let arrow: string = "flat/none";
          if (olderSlug === undefined || olderSh === undefined || sh === undefined) {
            arrow = i === orderedSlugs.length - 1 ? "flat/none" : "missing";
          } else if (sh > olderSh) arrow = "up";
          else if (sh < olderSh) arrow = "down";
          monthsObj[slug] = {
            aum_pct_raw: pct === null ? "" : pct.toFixed(2),
            aum_pct_num: pct === null ? null : Number(pct.toFixed(2)),
            shares_raw: sh === undefined ? "" : fmtSharesIndian(sh),
            shares_num: sh === undefined ? null : Math.round(sh),
            arrow,
            arrow_raw: null,
          };
        });
        // Latest-month %book for sorting.
        const latestPct =
          (monthsObj[orderedSlugs[0]] as { aum_pct_num: number | null } | undefined)
            ?.aum_pct_num ?? -1;
        return { company_name: name, fincode: c.fincode, months: monthsObj, latestPct };
      })
      .filter((r) => Object.keys(r.months).length > 0)
      .sort((a, b) => (b.latestPct ?? -1) - (a.latestPct ?? -1))
      .map(({ latestPct: _drop, ...r }) => {
        void _drop;
        return r;
      });

    const latestSlug = orderedSlugs[0];
    const equityValueCr = Math.round(agg.monthTotalValue.get(latestSlug) ?? 0);
    const slug = amcSlug(agg.amc);

    const portfolio = {
      meta: {
        fund: agg.amc,
        schemecode: slug,
        classification: null,
        aumTotalCr: equityValueCr,
        aumAsOf: null,
        scrapedAt: new Date().toISOString(),
        source:
          "Aggregated from RupeeVest Portfolio Tracker scheme holdings, grouped by fund house.",
        section: "Equity Holdings (all schemes combined)",
        months: monthEntries.map(([label, slug]) => ({
          label,
          aumCr: Math.round(agg.monthTotalValue.get(slug) ?? 0),
        })),
      },
      rows,
    };

    fs.writeFileSync(
      path.join(OUT_DIR, `${slug}.json`),
      JSON.stringify(portfolio) + "\n"
    );
    directory.push({
      slug,
      amc: agg.amc,
      schemeCount: agg.schemeCount,
      holdingsCount: rows.length,
      equityValueCr,
      latestMonth: monthEntries[0][0],
      path: `/fundwise/${slug}.json`,
    });
  }

  directory.sort((a, b) => b.equityValueCr - a.equityValueCr);

  fs.writeFileSync(
    INDEX_OUT,
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          fundHouses: directory.length,
          note: "Fund-wise (AMC-level) portfolios aggregated from per-scheme holdings grouped by fund house (amcOf). %book = company value ÷ AMC equity-holdings value.",
        },
        fundHouses: directory,
      },
      null,
      2
    ) + "\n"
  );

  console.log(`wrote ${directory.length} fund-house portfolios → ${OUT_DIR}`);
  console.log(`wrote directory → ${INDEX_OUT}`);
  for (const d of directory.slice(0, 12)) {
    console.log(
      `  ${d.amc.padEnd(16)} ${String(d.schemeCount).padStart(3)} schemes · ${d.holdingsCount
        .toString()
        .padStart(4)} holdings · ₹${d.equityValueCr.toLocaleString("en-IN")} Cr`
    );
  }
}

main();
