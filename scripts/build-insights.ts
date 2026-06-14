/**
 * Build the precomputed inputs for the Insights tab that require scanning the
 * per-scheme holdings universe (too heavy to compute at request time):
 *
 *   1. UNIQUE HOLDINGS — companies held by exactly ONE fund house across the
 *      whole tracked universe in the latest month (the InvestXL-style
 *      "only fund to own X" read), ranked by ₹ value, flagged when the
 *      position is NEW this month (no shares in the prior month).
 *
 *   2. ACTIVE-EQUITY SHARE SHIFTS — each fund house's share of the tracked
 *      equity-holdings universe by month (from the fund-wise rollups), so the
 *      Insights tab can surface the biggest month-over-month share gainers
 *      and losers in basis points.
 *
 * Writes src/data/portfolio-tracker/insights-holdings.json. Re-run after a
 * holdings refresh: npm run build:insights (run AFTER build:fundwise).
 */
import fs from "node:fs";
import path from "node:path";
import { amcOf } from "../src/data/amc-name-map";

const HOLDINGS_DIR = path.join(process.cwd(), "public", "holdings");
const FUNDWISE_DIR = path.join(process.cwd(), "public", "fundwise");
const OUT = path.join(
  process.cwd(),
  "src",
  "data",
  "portfolio-tracker",
  "insights-holdings.json"
);

// Ignore dust: a "unique conviction bet" below this latest-month ₹ value is
// noise, not signal.
const MIN_UNIQUE_VALUE_CR = 25;
const TOP_UNIQUES = 12;

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
/** "Apr-26" → sortable key 202604 (descending = newest first). Mirrors the
 *  helper in build-fundwise-portfolios.ts so the month axes stay in agreement. */
function monthSortKey(label: string): number {
  const m = label.trim().toLowerCase().match(/^([a-z]{3})[^0-9]*'?(\d{2,4})$/);
  if (!m) return 0;
  const mo = MONTHS_LOOKUP[m[1]] ?? 0;
  let y = Number(m[2]);
  if (y < 100) y += 2000;
  return y * 100 + mo;
}

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const slugMonth = (l: string) =>
  l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function cleanName(s: string): string {
  return s
    .replace(/^eq\s*-\s*/i, "")
    .replace(/^[\s^*#~£@]+/, "")
    .replace(/[£@*#~^]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface UniqueAgg {
  names: Map<string, number>;
  houses: Set<string>;
  valueCr: number;
  sharesCur: number;
  sharesPrev: number;
}

function main() {
  // ---- 1. Unique holdings -------------------------------------------------
  const files = fs
    .readdirSync(HOLDINGS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  const byCompany = new Map<string, UniqueAgg>();
  let monthCur = "";
  let monthPrev = "";

  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.join(HOLDINGS_DIR, file), "utf8"));
    const months: { label: string; aumCr: string | number | null }[] =
      j.meta?.months ?? [];
    if (months.length === 0 || !Array.isArray(j.rows)) continue;
    if (!monthCur) {
      monthCur = months[0].label;
      monthPrev = months[1]?.label ?? "";
    }
    const curSlug = slugMonth(months[0].label);
    const prevSlug = months[1] ? slugMonth(months[1].label) : "";
    const aumCur = num(months[0].aumCr) || num(j.meta?.aumTotalCr);
    const house = amcOf(j.meta?.fund ?? file);

    for (const r of j.rows) {
      const key = String(r.fincode ?? "").trim() || `name:${cleanName(r.company_name ?? "")}`;
      if (!key) continue;
      const cur = r.months?.[curSlug];
      const prev = prevSlug ? r.months?.[prevSlug] : undefined;
      const shCur = cur ? num(cur.shares_num) : 0;
      const shPrev = prev ? num(prev.shares_num) : 0;
      if (shCur <= 0 && shPrev <= 0) continue;
      let a = byCompany.get(key);
      if (!a) {
        a = { names: new Map(), houses: new Set(), valueCr: 0, sharesCur: 0, sharesPrev: 0 };
        byCompany.set(key, a);
      }
      if (r.company_name) {
        a.names.set(r.company_name, (a.names.get(r.company_name) ?? 0) + 1);
      }
      if (shCur > 0) {
        a.houses.add(house);
        a.sharesCur += shCur;
        const pct = cur?.aum_pct_num == null ? 0 : num(cur.aum_pct_num);
        if (aumCur > 0) a.valueCr += (pct / 100) * aumCur;
      }
      a.sharesPrev += shPrev;
    }
  }

  const pickName = (names: Map<string, number>): string => {
    let best = "";
    let bestCount = -1;
    for (const [raw, count] of names) {
      const n = cleanName(raw);
      if (!n) continue;
      if (count > bestCount) {
        bestCount = count;
        best = n;
      }
    }
    return best;
  };

  const uniqueRows = [...byCompany.values()]
    .filter((a) => a.houses.size === 1 && a.sharesCur > 0 && a.valueCr >= MIN_UNIQUE_VALUE_CR)
    .map((a) => ({
      company: pickName(a.names),
      fundHouse: [...a.houses][0],
      valueCr: Math.round(a.valueCr * 10) / 10,
      shares: Math.round(a.sharesCur),
      newThisMonth: a.sharesPrev === 0,
    }))
    // Exclude foreign listings / demerger markers that aren't Indian equities.
    .filter(
      (r) =>
        !/\b(inc|plc|llc|ord|adr|nv|ag|spa|gmbh|corp|corporation|co ltd)\b\.?$/i.test(
          r.company
        ) &&
        r.company.length > 0
    )
    .sort((x, y) => Number(y.newThisMonth) - Number(x.newThisMonth) || y.valueCr - x.valueCr);

  const totalUniques = uniqueRows.length;
  const newUniques = uniqueRows.filter((r) => r.newThisMonth).length;

  // ---- 2. Fund-house active-equity share shifts ---------------------------
  const fwFiles = fs.existsSync(FUNDWISE_DIR)
    ? fs.readdirSync(FUNDWISE_DIR).filter((f) => f.endsWith(".json"))
    : [];
  // label → (amc → bookCr)
  const bookByMonth = new Map<string, Map<string, number>>();
  for (const f of fwFiles) {
    const j = JSON.parse(fs.readFileSync(path.join(FUNDWISE_DIR, f), "utf8"));
    const amc: string = j.meta?.fund ?? f.replace(/\.json$/, "");
    for (const m of j.meta?.months ?? []) {
      if (!bookByMonth.has(m.label)) bookByMonth.set(m.label, new Map());
      bookByMonth.get(m.label)!.set(amc, num(m.aumCr));
    }
  }
  // Newest 4 months across ALL files, sorted by actual calendar month — not
  // by whichever file was read first. If the first fundwise file processed
  // happened to miss the latest month, the old first-file order made
  // labels[0] a stale month and the MoM share-shift pairing wrong for every
  // AMC.
  const labels = [...bookByMonth.keys()]
    .sort((a, b) => monthSortKey(b) - monthSortKey(a))
    .slice(0, 4);
  const totals = labels.map((l) =>
    [...(bookByMonth.get(l)?.values() ?? [])].reduce((s, v) => s + v, 0)
  );
  const shareRows = [...new Set(fwFiles.map((f) => f))]
    .map((f) => {
      const j = JSON.parse(fs.readFileSync(path.join(FUNDWISE_DIR, f), "utf8"));
      // Must match the populate-loop fallback above (`f.replace(/\.json$/, "")`)
      // exactly — otherwise, when meta.fund is absent, this lookup key keeps the
      // ".json" suffix, never matches bookByMonth's key, and the AMC silently
      // shows 0% share / ₹0 book.
      const amc: string = j.meta?.fund ?? f.replace(/\.json$/, "");
      const shares = labels.map((l, i) => {
        const book = bookByMonth.get(l)?.get(amc) ?? 0;
        return totals[i] > 0 ? (book / totals[i]) * 100 : 0;
      });
      const momBps =
        shares.length >= 2 ? Math.round((shares[0] - shares[1]) * 100) : null;
      return {
        amc,
        latestSharePct: Math.round(shares[0] * 100) / 100,
        momBps,
        latestBookCr: Math.round(bookByMonth.get(labels[0])?.get(amc) ?? 0),
      };
    })
    .filter((r) => r.latestSharePct >= 0.05)
    .sort((a, b) => (b.momBps ?? 0) - (a.momBps ?? 0));

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      monthCur,
      monthPrev,
      universeSchemes: files.length,
      minUniqueValueCr: MIN_UNIQUE_VALUE_CR,
      note: "Unique holdings = companies held by exactly one fund house in the latest month (≥ ₹25 Cr). Share shifts = each house's share of the tracked equity-holdings universe (fund-wise rollups), MoM in bps.",
    },
    uniques: {
      total: totalUniques,
      newThisMonth: newUniques,
      rows: uniqueRows.slice(0, TOP_UNIQUES),
    },
    amcShare: {
      months: labels,
      rows: shareRows,
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `wrote ${OUT} — uniques: ${totalUniques} (${newUniques} new) | share rows: ${shareRows.length} | months: ${labels.join(", ")}`
  );
  for (const r of out.uniques.rows.slice(0, 6)) {
    console.log(
      `  ${r.newThisMonth ? "NEW " : "    "}${r.company} — only ${r.fundHouse} · ₹${r.valueCr} Cr`
    );
  }
}

main();
