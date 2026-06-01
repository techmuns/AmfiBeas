/**
 * AMC-level portfolio aggregates derived from the per-fund RupeeVest
 * holdings snapshot. The underlying JSON is precomputed offline by
 * `scripts/ingest/amc-portfolio-aggregation.ts` — see that file for
 * the universe / methodology contract.
 *
 * Two views are exposed:
 *  - `amcCashAllocationTrend()` — AUM-weighted cash % per AMC over the
 *    months reported by the tracker (chart-shaped: rows are months,
 *    columns are AMC slugs).
 *  - `amcStockConcentration()` — latest-month Top-10 / Top-25 stock
 *    concentration per AMC, with an "Industry" composite row.
 */
import snapshot from "./snapshots/amc-portfolio-aggregation.json";
import { AMCS } from "./amcs";

interface CashByMonthCell {
  cashPct: number;
  aumCr: number;
  fundCount: number;
}

interface RawCashRow {
  amcSlug: string;
  byMonth: Record<string, CashByMonthCell>;
}

interface RawConcRow {
  amcSlug: string;
  month: string;
  totalAumCr: number;
  fundCount: number;
  top10PctOfTotal: number;
  top25PctOfTotal: number;
  top10Names: string[];
  top25Names: string[];
}

interface SnapshotShape {
  meta: {
    generatedAt: string;
    source: string;
    notes: string;
    months: string[];
    latestMonth: string;
    amcSlugsIncluded: string[];
    fundCountByAmc: Record<string, number>;
  };
  cash: RawCashRow[];
  concentration: RawConcRow[];
}

const SNAPSHOT = snapshot as unknown as SnapshotShape;

export interface CashAllocationPoint {
  month: string;
  /** AMC slug → cash % for that month. Missing slugs render as gaps. */
  [amcSlug: string]: number | string | null;
}

export interface CashAllocationTrend {
  months: string[];
  amcSlugs: string[];
  points: CashAllocationPoint[];
  latestMonth: string;
  fundCountByAmc: Record<string, number>;
}

/** Build the chart-shaped cash-allocation trend.
 *
 * Months are returned oldest → newest so a multi-line chart reads left
 * to right. AMC slugs are sorted by curated peer order (see AMCS) when
 * available, falling back to alphabetical for any extras.
 */
export function amcCashAllocationTrend(): CashAllocationTrend {
  const months = SNAPSHOT.meta.months;
  const slugs = sortBySnapshotOrder(SNAPSHOT.meta.amcSlugsIncluded);
  const cashByAmc = new Map<string, RawCashRow>();
  for (const row of SNAPSHOT.cash) cashByAmc.set(row.amcSlug, row);
  const points: CashAllocationPoint[] = months.map((m) => {
    const row: CashAllocationPoint = { month: m };
    for (const slug of slugs) {
      const cell = cashByAmc.get(slug)?.byMonth[m];
      row[slug] = cell ? Number(cell.cashPct.toFixed(2)) : null;
    }
    return row;
  });
  return {
    months,
    amcSlugs: slugs,
    points,
    latestMonth: SNAPSHOT.meta.latestMonth,
    fundCountByAmc: SNAPSHOT.meta.fundCountByAmc,
  };
}

export interface ConcentrationBar {
  amcSlug: string;
  /** Display label — short ticker / brand for the AMC, or "Industry". */
  label: string;
  top10PctOfTotal: number;
  top25PctOfTotal: number;
  totalAumCr: number;
  fundCount: number;
  /** Top-10 stock names (longest-form readable) for tooltip / drilldown. */
  top10Names: string[];
}

export interface StockConcentration {
  month: string;
  bars: ConcentrationBar[];
}

/** Latest-month Top-10 / Top-25 stock concentration per AMC + Industry.
 *
 * Per-AMC bars are ordered by curated peer order; the Industry composite
 * always trails so it reads as a benchmark. */
export function amcStockConcentration(): StockConcentration {
  const peerSlugs = sortBySnapshotOrder(
    SNAPSHOT.concentration
      .filter((r) => r.amcSlug !== "industry")
      .map((r) => r.amcSlug)
  );
  const byAmc = new Map<string, RawConcRow>();
  for (const row of SNAPSHOT.concentration) byAmc.set(row.amcSlug, row);
  const bars: ConcentrationBar[] = [];
  for (const slug of peerSlugs) {
    const r = byAmc.get(slug);
    if (!r) continue;
    bars.push({
      amcSlug: slug,
      label: amcShortLabelForChart(slug),
      top10PctOfTotal: Number(r.top10PctOfTotal.toFixed(2)),
      top25PctOfTotal: Number(r.top25PctOfTotal.toFixed(2)),
      totalAumCr: r.totalAumCr,
      fundCount: r.fundCount,
      top10Names: r.top10Names,
    });
  }
  const industry = byAmc.get("industry");
  if (industry) {
    bars.push({
      amcSlug: "industry",
      label: "Industry",
      top10PctOfTotal: Number(industry.top10PctOfTotal.toFixed(2)),
      top25PctOfTotal: Number(industry.top25PctOfTotal.toFixed(2)),
      totalAumCr: industry.totalAumCr,
      fundCount: industry.fundCount,
      top10Names: industry.top10Names,
    });
  }
  return {
    month: industry?.month ?? SNAPSHOT.meta.latestMonth,
    bars,
  };
}

/** Order AMC slugs by their position in the curated AMCS list. Slugs
 *  not in the list trail at the end in alphabetical order. */
function sortBySnapshotOrder(slugs: string[]): string[] {
  const order = new Map<string, number>();
  AMCS.forEach((a, i) => order.set(a.slug, i));
  return slugs.slice().sort((a, b) => {
    const ai = order.get(a);
    const bi = order.get(b);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.localeCompare(b);
  });
}

/** Short brand label for the bar chart — ticker when available, else
 *  first token of the AMC name. Mirrors lib/chart-meta but inlined so
 *  this module stays free of UI dependencies. */
function amcShortLabelForChart(slug: string): string {
  const a = AMCS.find((x) => x.slug === slug);
  if (!a) return slug;
  if (slug === "absl") return "Birla MF";
  if (slug === "icici-pru") return "ICICI Pru MF";
  if (slug === "canara-robeco") return "Canara MF";
  if (slug === "nippon") return "Nippon MF";
  if (slug === "hdfc") return "HDFC MF";
  if (slug === "sbi") return "SBI MF";
  if (slug === "kotak") return "Kotak MF";
  if (slug === "axis") return "Axis MF";
  if (slug === "uti") return "UTI MF";
  if (slug === "dsp") return "DSP MF";
  if (slug === "mirae") return "Mirae MF";
  return a.ticker ?? a.name.split(" ")[0];
}
