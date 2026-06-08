import {
  amcIndexRows,
  amcMarketShareSeries,
  type AmcIndexRow,
} from "@/data/amc-detail";
import {
  quarterlyForAmc,
  yieldsForAmc,
  SOURCED_FINANCIALS_SLUGS,
} from "@/data/aggregate";
import { amcAaumQuarterlySnapshot } from "@/data/source";
import { amcEquityBook, type AmcEquityBookRow } from "@/data/amc-equity-book";
import { memoize } from "@/lib/memoize";

/**
 * Unified per-AMC comparison metrics for the head-to-head tool. Joins three
 * sources keyed differently:
 *   - AAUM / market share / growth  — amc-detail (AMFI Fundwise AAUM), by slug
 *   - listed-AMC financials & fee yield — aggregate.ts, listed slugs only
 *   - derived active/passive equity mix — amc-equity-book, matched by name
 * Fields that don't apply are null (listed-only financials; equity mix when no
 * confident name match), and the UI flags those as derived / listed-only.
 */
export interface AmcCompareMetrics {
  slug: string;
  displayName: string;
  isIndustry: boolean;
  aaumCr: number | null;
  marketSharePct: number | null;
  shareDeltaBps: number | null;
  qoqGrowthPct: number | null;
  yoyGrowthPct: number | null;
  rank: number | null;
  isListed: boolean;
  revenueCr: number | null;
  revenueYieldBps: number | null;
  opMarginPct: number | null;
  patMarginPct: number | null;
  finQuarter: string | null;
  equityMatched: boolean;
  activeEquityCr: number | null;
  passiveEquityCr: number | null;
  activePct: number | null;
  passivePct: number | null;
  equitySharePct: number | null;
}

/** All comparable AMCs (those in the latest AAUM quarter), largest first. */
function amcCompareUniverse_impl(): { slug: string; displayName: string }[] {
  const idx = amcIndexRows();
  if (!idx) return [];
  return idx.rows.map((r) => ({ slug: r.amcSlug, displayName: r.displayName }));
}

/** Match an AAUM displayName to a derived equity-book row by longest AMC-label
 *  prefix ("SBI Funds Management" → "SBI", "ICICI Prudential AMC" → "ICICI Pru",
 *  "Aditya Birla Sun Life AMC" → "Aditya Birla"). Longest-first avoids the
 *  Quant / Quantum collision. */
function equityRowForDisplayName(
  displayName: string,
  book: AmcEquityBookRow[]
): AmcEquityBookRow | null {
  const dn = displayName.toLowerCase();
  const sorted = [...book].sort((a, b) => b.amc.length - a.amc.length);
  for (const r of sorted) {
    if (dn.startsWith(r.amc.toLowerCase())) return r;
  }
  return null;
}

function shareDeltaBpsFor(slug: string): number | null {
  const series = amcMarketShareSeries(slug);
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  return (latest.marketSharePct - prev.marketSharePct) * 100;
}

function rowToMetrics(
  row: AmcIndexRow,
  book: AmcEquityBookRow[]
): AmcCompareMetrics {
  const isListed = SOURCED_FINANCIALS_SLUGS.has(row.amcSlug);
  let revenueCr: number | null = null;
  let revenueYieldBps: number | null = null;
  let opMarginPct: number | null = null;
  let patMarginPct: number | null = null;
  let finQuarter: string | null = null;
  if (isListed) {
    const fin = quarterlyForAmc(row.amcSlug);
    const yields = yieldsForAmc(row.amcSlug);
    const lastFin = fin[fin.length - 1];
    const lastY = yields[yields.length - 1];
    if (lastFin && lastY) {
      revenueCr = lastFin.revenue;
      revenueYieldBps = lastFin.avgAum ? lastY.revenueYieldBps : null;
      opMarginPct = lastY.opMargin;
      patMarginPct = lastY.patMargin;
      finQuarter = lastFin.quarter;
    }
  }
  const eq = equityRowForDisplayName(row.displayName, book);
  return {
    slug: row.amcSlug,
    displayName: row.displayName,
    isIndustry: false,
    aaumCr: row.avgAum,
    marketSharePct: row.marketSharePct,
    shareDeltaBps: shareDeltaBpsFor(row.amcSlug),
    qoqGrowthPct: row.qoqGrowthPct,
    yoyGrowthPct: row.yoyGrowthPct,
    rank: row.rank,
    isListed,
    revenueCr,
    revenueYieldBps,
    opMarginPct,
    patMarginPct,
    finQuarter,
    equityMatched: eq !== null,
    activeEquityCr: eq?.activeEquityCr ?? null,
    passiveEquityCr: eq?.passiveEquityCr ?? null,
    activePct: eq?.activePct ?? null,
    passivePct: eq?.passivePct ?? null,
    equitySharePct: eq?.equitySharePct ?? null,
  };
}

/** Comparison metrics for one AMC slug, or null if it isn't in the universe. */
function amcComparison_impl(slug: string): AmcCompareMetrics | null {
  const idx = amcIndexRows();
  if (!idx) return null;
  const row = idx.rows.find((r) => r.amcSlug === slug);
  if (!row) return null;
  return rowToMetrics(row, amcEquityBook());
}

/** Industry-total benchmark column. AAUM is the sum of per-AMC AAUM; growth is
 *  computed on that summed series; the equity mix sums the derived book. */
function industryComparison_impl(): AmcCompareMetrics {
  const book = amcEquityBook();
  const totalsByQuarter = new Map<string, number>();
  for (const r of amcAaumQuarterlySnapshot.rows) {
    if (r.status !== "ok" || typeof r.avgAum !== "number") continue;
    totalsByQuarter.set(r.quarter, (totalsByQuarter.get(r.quarter) ?? 0) + r.avgAum);
  }
  const quarters = [...totalsByQuarter.keys()].sort((a, b) => a.localeCompare(b));
  const latestQ = quarters[quarters.length - 1] ?? null;
  const latestTotal = latestQ ? (totalsByQuarter.get(latestQ) ?? 0) : 0;
  const prevQ = quarters[quarters.length - 2] ?? null;
  const prevTotal = prevQ ? totalsByQuarter.get(prevQ) ?? null : null;
  let yoyTotal: number | null = null;
  if (latestQ) {
    const [y, qPart] = latestQ.split("-");
    const yoyId = `${Number(y) - 1}-${qPart}`;
    yoyTotal = totalsByQuarter.get(yoyId) ?? null;
  }
  const qoq =
    prevTotal && prevTotal > 0 ? (latestTotal / prevTotal - 1) * 100 : null;
  const yoy =
    yoyTotal && yoyTotal > 0 ? (latestTotal / yoyTotal - 1) * 100 : null;
  const activeEquity = book.reduce((s, r) => s + r.activeEquityCr, 0);
  const passiveEquity = book.reduce((s, r) => s + r.passiveEquityCr, 0);
  const totalEquity = activeEquity + passiveEquity;
  return {
    slug: "industry",
    displayName: "Industry",
    isIndustry: true,
    aaumCr: latestTotal,
    marketSharePct: 100,
    shareDeltaBps: 0,
    qoqGrowthPct: qoq,
    yoyGrowthPct: yoy,
    rank: null,
    isListed: false,
    revenueCr: null,
    revenueYieldBps: null,
    opMarginPct: null,
    patMarginPct: null,
    finQuarter: null,
    equityMatched: totalEquity > 0,
    activeEquityCr: activeEquity,
    passiveEquityCr: passiveEquity,
    activePct: totalEquity > 0 ? (activeEquity / totalEquity) * 100 : null,
    passivePct: totalEquity > 0 ? (passiveEquity / totalEquity) * 100 : null,
    equitySharePct: totalEquity > 0 ? 100 : null,
  };
}

/** Industry-AVERAGE benchmark column — the MEAN of each metric across all
 *  comparable AMCs (distinct from industryComparison()'s total/aggregate).
 *  Answers "is this AMC above or below the typical AMC?" rather than "vs the
 *  whole market". Computed straight off the already-built index rows + equity
 *  book (O(AMCs)) — it must NOT call rowToMetrics per AMC, which re-derives the
 *  per-AMC market-share series and is O(quarters × AMCs²) (blows the Worker
 *  CPU budget). Nulls are skipped per field; rank isn't meaningful as a mean. */
function industryAverageComparison_impl(): AmcCompareMetrics {
  const idx = amcIndexRows();
  const rows = idx?.rows ?? [];
  const book = amcEquityBook();
  const mean = (vals: (number | null | undefined)[]): number | null => {
    const f = vals.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v)
    );
    return f.length ? f.reduce((s, v) => s + v, 0) / f.length : null;
  };

  // Listed-AMC financials: only the sourced-financials slugs (a small set),
  // so this stays O(listed), not O(all AMCs).
  type Fin = {
    revenue: number | null;
    yield: number | null;
    op: number | null;
    pat: number | null;
  };
  const fins: Fin[] = rows
    .filter((r) => SOURCED_FINANCIALS_SLUGS.has(r.amcSlug))
    .map((r): Fin | null => {
      const fin = quarterlyForAmc(r.amcSlug);
      const yields = yieldsForAmc(r.amcSlug);
      const lastFin = fin[fin.length - 1];
      const lastY = yields[yields.length - 1];
      if (!lastFin || !lastY) return null;
      return {
        revenue: lastFin.revenue,
        yield: lastFin.avgAum ? lastY.revenueYieldBps : null,
        op: lastY.opMargin,
        pat: lastY.patMargin,
      };
    })
    .filter((f): f is Fin => f !== null);

  return {
    slug: "industry-average",
    displayName: "Industry avg",
    isIndustry: true,
    aaumCr: mean(rows.map((r) => r.avgAum)),
    marketSharePct: mean(rows.map((r) => r.marketSharePct)),
    // Mean of per-AMC share deltas is ~0 (shares are zero-sum), so skip the
    // expensive per-AMC series and report 0.
    shareDeltaBps: 0,
    qoqGrowthPct: mean(rows.map((r) => r.qoqGrowthPct)),
    yoyGrowthPct: mean(rows.map((r) => r.yoyGrowthPct)),
    rank: null,
    isListed: false,
    revenueCr: mean(fins.map((f) => f.revenue)),
    revenueYieldBps: mean(fins.map((f) => f.yield)),
    opMarginPct: mean(fins.map((f) => f.op)),
    patMarginPct: mean(fins.map((f) => f.pat)),
    finQuarter: null,
    equityMatched: book.length > 0,
    activeEquityCr: mean(book.map((b) => b.activeEquityCr)),
    passiveEquityCr: mean(book.map((b) => b.passiveEquityCr)),
    activePct: mean(book.map((b) => b.activePct)),
    passivePct: mean(book.map((b) => b.passivePct)),
    equitySharePct: mean(book.map((b) => b.equitySharePct)),
  };
}

/** The fiscal label of the latest AAUM quarter (for subtitles). */
function amcCompareQuarterLabel_impl(): string | null {
  return amcIndexRows()?.fiscalLabel ?? null;
}

// Memoized public exports. The Compare tab calls amcComparison three times
// (A, B, industry) plus the two industry aggregates per render, each fanning
// out to amcIndexRows / amcEquityBook, so caching per isolate keeps the Worker
// under its CPU budget (Cloudflare Error 1102). See src/lib/memoize.ts.
export const amcCompareUniverse = memoize(amcCompareUniverse_impl);
export const amcComparison = memoize(amcComparison_impl);
export const industryComparison = memoize(industryComparison_impl);
export const industryAverageComparison = memoize(industryAverageComparison_impl);
export const amcCompareQuarterLabel = memoize(amcCompareQuarterLabel_impl);
