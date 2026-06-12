/**
 * Whole-tab Excel export for the scheme-wise MFs Portfolio Tracker.
 *
 * Assembles ONE styled workbook that mirrors all four sub-tabs for the
 * selected fund — Overview, Holdings, Head-to-head and Trends — so the
 * download reads like the dashboard: navy headers, green "up / overweight",
 * red "down / underweight", in-cell weight bars and the same numbers.
 *
 * Pure data → workbook; the heavy `xlsx-js-style` engine is loaded lazily by
 * downloadStyledWorkbook. Trends figures come from the same bundled snapshots
 * the Trends tab renders from, so the sheet needs no network round-trip.
 */
import {
  type FundDirectoryEntry,
  type FundPortfolio,
  cleanSchemeName,
  monthSlug,
} from "@/data/portfolio-tracker";
import type { SectorAllocationRow } from "@/components/data/SectorAllocationChart";
import {
  buildCompareRows,
  partitionCompareRows,
  shortFundLabel,
  signalLabel,
  signalTone,
} from "@/lib/head-to-head";
import { formatCompactCrSafe } from "@/lib/format";
import {
  type Cell,
  type StyledSheet,
  bar,
  delta,
  downloadStyledWorkbook,
  num,
  pct,
  sectionTitle,
  shares,
  signal,
  subTh,
  subtitle,
  td,
  th,
  title,
} from "@/lib/xlsx-styled";
import { CHART_RAMP, FMT_PCT, POS_SOFT } from "@/lib/xlsx-theme";
import mfLatestNav from "@/data/snapshots/mf-latest-nav.json";
import mfReturns from "@/data/snapshots/mf-returns.json";
import mfCategoryReturns from "@/data/snapshots/mf-category-returns.json";

// ---------------------------------------------------------------------------
// Bundled Trends snapshots (subset of the fields used here)
// ---------------------------------------------------------------------------

const PERIODS = ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;
type PeriodKey = (typeof PERIODS)[number];

interface ReturnsFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: string;
  option: string;
  returns: Partial<Record<PeriodKey, { value: number }>>;
}
interface PeriodRankStats {
  statsAvailable: true;
  return: number;
  rank: number;
  peerCount: number;
  quartile: string;
  percentile: number;
  categoryAverage: number;
  categoryMedian: number;
  excessVsAverage: number;
}
type PeriodRank = PeriodRankStats | { statsAvailable: false };
interface CategoryFund {
  schemecode: string;
  classification: string | null;
  plan: string;
  option: string;
  periodRanks: Partial<Record<PeriodKey, PeriodRank>>;
}

const returnsByCode = new Map(
  (mfReturns as unknown as { funds: ReturnsFund[] }).funds.map((f) => [f.schemecode, f])
);
const categoryByCode = new Map(
  (mfCategoryReturns as unknown as { fundRanks: CategoryFund[] }).fundRanks.map((f) => [
    f.schemecode,
    f,
  ])
);
const latestNavByCode = new Map(
  (mfLatestNav as unknown as { funds: { schemecode: string; nav: number; navDate: string }[] }).funds.map(
    (f) => [f.schemecode, f]
  )
);

function cohortKey(c: string | null, plan: string, option: string): string {
  return `${c ?? "(unclassified)"} | ${plan} | ${option}`;
}

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

export interface TrackerFlowSummary {
  label: string;
  topAdd: { name: string; d: number } | null;
  topTrim: { name: string; d: number } | null;
  concCur: number;
  concDelta: number;
}

export interface TrackerExportInput {
  entry: FundDirectoryEntry;
  portfolio: FundPortfolio | null;
  sectorRows: SectorAllocationRow[];
  peerLabel: string | null;
  peerLoaded: number;
  peerTotal: number;
  flowSummary: TrackerFlowSummary | null;
  bEntry: FundDirectoryEntry | null;
  bPortfolio: FundPortfolio | undefined;
}

function aumNum(aumCr: string | number | null): number | null {
  if (aumCr === null || aumCr === "" || aumCr === "-") return null;
  const n = typeof aumCr === "number" ? aumCr : Number(aumCr);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function overviewSheet(input: TrackerExportInput): StyledSheet {
  const { entry, portfolio, sectorRows, peerLabel, peerLoaded, peerTotal, flowSummary } = input;
  const rows: Cell[][] = [];
  const latestMonth = portfolio?.meta.months[0]?.label ?? null;

  rows.push([title(`${entry.fund} — Portfolio Tracker`)]);
  const metaBits = [
    entry.classification,
    entry.aumTotalCr != null ? `Latest AUM ${formatCompactCrSafe(entry.aumTotalCr)}` : null,
    latestMonth ? `Latest month ${latestMonth}` : null,
  ].filter(Boolean);
  rows.push([subtitle(metaBits.join("  ·  "))]);
  rows.push([]);

  // Month-over-month key takeaway (mirrors the Overview KeyTakeaway card).
  if (flowSummary && flowSummary.topAdd && flowSummary.topTrim) {
    rows.push([sectionTitle(`Month-over-month — ${flowSummary.label}`)]);
    rows.push([th("Move"), th("Stock"), th("Δ (pp)", "right")]);
    rows.push([
      td("Biggest weight add"),
      td(flowSummary.topAdd.name),
      delta(flowSummary.topAdd.d),
    ]);
    rows.push([
      td("Biggest weight trim"),
      td(flowSummary.topTrim.name),
      delta(flowSummary.topTrim.d),
    ]);
    rows.push([
      td("Top-10 concentration"),
      td(`${flowSummary.concCur.toFixed(1)}% of equity AUM`),
      delta(flowSummary.concDelta),
    ]);
    rows.push([]);
  }

  // Sector allocation vs category average.
  if (sectorRows.length > 0) {
    rows.push([sectionTitle(`Sector allocation vs ${peerLabel ?? "category"} average`)]);
    rows.push([
      subtitle(
        `Fund weight (% of AUM) vs the average across the top-${peerTotal} same-category peers (${peerLoaded} loaded). Δ tinted green where the fund is overweight, red where underweight.`
      ),
    ]);
    rows.push([
      th("Sector"),
      th(`${entry.fund} %`, "right"),
      th(`${peerLabel ?? "Peer"} avg %`, "right"),
      th("Δ vs peers", "right"),
      th("Fund weight", "left"),
    ]);
    const maxFund = Math.max(...sectorRows.map((r) => r.fund ?? 0), 0.0001);
    sectorRows.forEach((r, i) => {
      const d = r.fund !== null && r.peerAvg !== null ? r.fund - r.peerAvg : null;
      rows.push([
        td(r.label),
        pct(r.fund),
        pct(r.peerAvg, { tone: "muted" }),
        delta(d),
        bar(r.fund, maxFund, CHART_RAMP[i % CHART_RAMP.length]),
      ]);
    });
  }

  return {
    name: "Overview",
    rows,
    cols: [30, 18, 18, 14, 18],
    merges: [],
  };
}

function holdingsSheet(input: TrackerExportInput): StyledSheet | null {
  const { entry, portfolio } = input;
  if (!portfolio) return null;
  const months = portfolio.meta.months;
  const slugs = months.map((m) => monthSlug(m.label));
  const rows: Cell[][] = [];

  rows.push([title(`Equity holdings — ${entry.fund}`)]);
  rows.push([
    subtitle(
      `${portfolio.rows.length} equity holdings · weights are % of equity AUM · arrows: share count vs the next-older month (green up / red down) · source ${portfolio.meta.source}`
    ),
  ]);
  rows.push([]);

  // Two-row header: Company (spans 2 rows) + each month spanning {% of AUM, Shares}.
  const headTop = rows.length; // index of the top header row
  const topRow: Cell[] = [th("Company")];
  const subRow: Cell[] = [th("")]; // covered by the vertical merge
  months.forEach((m) => {
    topRow.push(th(`${m.label} — AUM ${formatCompactCrSafe(aumNum(m.aumCr))}`, "center"));
    topRow.push(th("")); // covered by the horizontal merge
    subRow.push(subTh("% of AUM"));
    subRow.push(subTh("Shares"));
  });
  rows.push(topRow);
  rows.push(subRow);

  const merges: StyledSheet["merges"] = [
    { s: { r: headTop, c: 0 }, e: { r: headTop + 1, c: 0 } },
  ];
  months.forEach((_, i) => {
    const c = 1 + i * 2;
    merges!.push({ s: { r: headTop, c }, e: { r: headTop, c: c + 1 } });
  });

  // Rows sorted by the latest month's weight, biggest first (the on-screen default).
  const sortSlug = slugs[0] ?? "";
  const sorted = [...portfolio.rows].sort((a, b) => {
    const av = a.months[sortSlug]?.aum_pct_num ?? -1;
    const bv = b.months[sortSlug]?.aum_pct_num ?? -1;
    return bv - av;
  });
  for (const row of sorted) {
    const line: Cell[] = [td(row.company_name, { bold: false })];
    for (const slug of slugs) {
      const cell = row.months[slug];
      line.push(pct(cell?.aum_pct_num ?? null, { tone: "muted" }));
      line.push(shares(cell?.shares_num ?? null, cell?.arrow ?? "missing"));
    }
    rows.push(line);
  }

  const cols = [38, ...months.flatMap(() => [12, 14])];
  return { name: "Holdings", rows, cols, merges };
}

function headToHeadSheet(input: TrackerExportInput): StyledSheet | null {
  const { entry, bEntry, portfolio, bPortfolio } = input;
  if (!portfolio || !bPortfolio || !bEntry) return null;
  const compareRows = buildCompareRows(portfolio, bPortfolio);
  if (compareRows.length === 0) return null;
  const { mutual, exclusive } = partitionCompareRows(compareRows);
  const shortA = shortFundLabel(entry.fund);
  const shortB = shortFundLabel(bEntry.fund);
  const latestMonth = portfolio.meta.months[0]?.label ?? "";
  const rows: Cell[][] = [];

  rows.push([title(`${entry.fund}  vs  ${bEntry.fund}`)]);
  rows.push([
    subtitle(
      `${entry.classification ?? ""}${latestMonth ? `  ·  Latest month ${latestMonth}` : ""}  ·  Mutual = stocks both hold · Exclusive = stocks only one holds`
    ),
  ]);
  rows.push([]);

  // Mutual holdings.
  rows.push([sectionTitle(`Mutual holdings — both funds hold (${mutual.length})`)]);
  rows.push([
    th("Company"),
    th(`${entry.fund} %`, "right"),
    th(`${bEntry.fund} %`, "right"),
    th(`Δ ${shortA} − ${shortB} (pp)`, "right"),
    th("Signal"),
  ]);
  if (mutual.length === 0) {
    rows.push([td("These two funds share no common holdings this month.", { tone: "muted" })]);
  } else {
    for (const r of mutual) {
      rows.push([
        td(r.name),
        pct(r.a, { tone: "muted" }),
        pct(r.b, { tone: "muted" }),
        delta(r.delta),
        signal(signalLabel(r.signal, shortA, shortB), signalTone(r.signal)),
      ]);
    }
  }
  rows.push([]);

  // Exclusive holdings.
  rows.push([sectionTitle(`Exclusive holdings — only one fund holds (${exclusive.length})`)]);
  rows.push([
    th("Company"),
    th(`${entry.fund} %`, "right"),
    th(`${bEntry.fund} %`, "right"),
    th("Held by"),
  ]);
  if (exclusive.length === 0) {
    rows.push([td("Every position is shared — neither fund holds anything exclusively.", { tone: "muted" })]);
  } else {
    for (const r of exclusive) {
      rows.push([
        td(r.name),
        pct(r.a, { tone: "muted" }),
        pct(r.b, { tone: "muted" }),
        signal(signalLabel(r.signal, shortA, shortB), signalTone(r.signal)),
      ]);
    }
  }

  return { name: "Head-to-head", rows, cols: [36, 18, 18, 18, 18], merges: [] };
}

function trendsSheet(input: TrackerExportInput): StyledSheet | null {
  const { entry } = input;
  const code = entry.schemecode;
  const returnRow = returnsByCode.get(code);
  const categoryRow = categoryByCode.get(code);
  const latest = latestNavByCode.get(code);
  if (!returnRow) return null;
  const rows: Cell[][] = [];

  rows.push([title(`Trends — ${entry.fund}`)]);
  const cohortBits = [entry.classification, returnRow.plan, returnRow.option].filter(Boolean);
  rows.push([
    subtitle(
      `${cohortBits.join(" · ")}${latest ? `  ·  Latest NAV ₹${latest.nav.toFixed(2)} as of ${latest.navDate}` : ""}`
    ),
  ]);
  rows.push([]);

  // Returns table (period × fund/category).
  rows.push([sectionTitle("Returns")]);
  rows.push([
    th("Period"),
    th("Fund return %", "right"),
    th("Category avg %", "right"),
    th("vs avg (pp)", "right"),
    th("Rank"),
    th("Quartile"),
  ]);
  for (const p of PERIODS) {
    const fr = returnRow.returns[p]?.value ?? null;
    const pr = categoryRow?.periodRanks[p];
    const stats = pr && pr.statsAvailable ? pr : null;
    const isCagr = p === "3Y" || p === "5Y";
    rows.push([
      td(`${p}${isCagr ? " (CAGR)" : ""}`),
      num(fr, FMT_PCT, { tone: fr === null ? "muted" : fr >= 0 ? "positive" : "negative", bold: true }),
      stats ? num(stats.categoryAverage, FMT_PCT, { tone: "muted" }) : td("—", { align: "right", tone: "muted" }),
      stats ? delta(stats.excessVsAverage) : td("—", { align: "right", tone: "muted" }),
      stats ? td(`${stats.rank}/${stats.peerCount}`, { align: "left" }) : td("—", { tone: "muted" }),
      stats ? td(stats.quartile) : td("—", { tone: "muted" }),
    ]);
  }
  rows.push([]);

  // Cohort peer ranking by 1Y return (the Trends peer table, compacted).
  const ck = cohortKey(returnRow.classification, returnRow.plan, returnRow.option);
  const peers = [...categoryByCode.values()]
    .filter((f) => cohortKey(f.classification, f.plan, f.option) === ck)
    .map((f) => {
      const rr = returnsByCode.get(f.schemecode);
      return {
        schemecode: f.schemecode,
        name: cleanSchemeName(rr?.fundName ?? f.schemecode),
        r1y: rr?.returns["1Y"]?.value ?? null,
        r3y: rr?.returns["3Y"]?.value ?? null,
        r5y: rr?.returns["5Y"]?.value ?? null,
      };
    })
    .sort((a, b) => (b.r1y ?? -Infinity) - (a.r1y ?? -Infinity))
    .slice(0, 30);

  if (peers.length > 1) {
    rows.push([sectionTitle(`Category ranking — ${entry.classification ?? "peers"} (by 1Y return)`)]);
    rows.push([
      th("#"),
      th("Fund"),
      th("1Y %", "right"),
      th("3Y % (CAGR)", "right"),
      th("5Y % (CAGR)", "right"),
    ]);
    const toneOf = (v: number | null) => (v === null ? "muted" : v >= 0 ? "positive" : "negative");
    peers.forEach((p, i) => {
      const isSelf = p.schemecode === code;
      const fill = isSelf ? POS_SOFT : undefined;
      rows.push([
        td(String(i + 1), { align: "left", fill }),
        td(p.name, { bold: isSelf, fill }),
        num(p.r1y, FMT_PCT, { tone: toneOf(p.r1y), bold: isSelf, fill }),
        num(p.r3y, FMT_PCT, { tone: toneOf(p.r3y), fill }),
        num(p.r5y, FMT_PCT, { tone: toneOf(p.r5y), fill }),
      ]);
    });
  }

  return { name: "Trends", rows, cols: [8, 40, 12, 14, 14], merges: [] };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Build + download the full styled workbook for the selected fund. */
export async function downloadPortfolioTrackerWorkbook(
  input: TrackerExportInput
): Promise<void> {
  const sheets: StyledSheet[] = [overviewSheet(input)];
  const holdings = holdingsSheet(input);
  if (holdings) sheets.push(holdings);
  const h2h = headToHeadSheet(input);
  if (h2h) sheets.push(h2h);
  const trends = trendsSheet(input);
  if (trends) sheets.push(trends);

  const safe = input.entry.fund.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  await downloadStyledWorkbook(sheets, `portfolio-tracker-${safe || "fund"}.xlsx`);
}
