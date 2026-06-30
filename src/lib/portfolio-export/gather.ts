/**
 * Assembles the presentation-ready export payloads (SchemeExport /
 * FundHouseExport) from the already-loaded holdings plus the runtime nav-data
 * snapshots (returns / category ranks / risk ratios / latest NAV). Everything
 * here is plain data shaping — no document generation.
 */

import { cleanSchemeName } from "@/lib/format";
import { classifyCap } from "@/data/cap-classification";
import { classifySector, UNCLASSIFIED } from "@/data/sector-classification";
import {
  monthSlug,
  type FundPortfolio,
  type FundDirectoryEntry,
  type HoldingArrow,
} from "@/data/portfolio-tracker";
import type { FundHouseEntry, FundHousePortfolio } from "@/data/fundwise-tracker";
import { ppToBps } from "@/lib/units";
import type {
  Arrow,
  FundHouseExport,
  FundHousePeerRow,
  HoldingExportRow,
  PeerRow,
  PlanProfile,
  RatioRow,
  ReturnRow,
  SchemeExport,
  SectorRow,
} from "./types";

const PERIODS = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y"] as const;
type PeriodKey = (typeof PERIODS)[number];
const CAGR_PERIODS = new Set<PeriodKey>(["3Y", "5Y", "10Y"]);

// ---- nav-data snapshot subsets -------------------------------------------

interface ReturnsFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: "direct" | "regular" | "unknown";
  option: "growth" | "idcw" | "unknown";
  returns: Partial<Record<PeriodKey, { value: number }>>;
}
interface ReturnsSnapshot {
  feedDate?: string;
  asOfDate?: string;
  funds: ReturnsFund[];
}
interface CategoryPeriodEntry {
  return?: number;
  rank?: number;
  peerCount: number;
  percentile?: number;
  quartile?: string;
  categoryAverage?: number;
  excessVsMedian?: number;
  statsAvailable: boolean;
}
interface CategoryFund {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: string;
  option: string;
  periodRanks: Partial<Record<PeriodKey, CategoryPeriodEntry>>;
}
interface CategorySnapshot {
  fundRanks: CategoryFund[];
}
interface RatioCell {
  value: number;
  categoryAverage: number;
  rank: number;
  count: number;
}
interface RatiosFund {
  stdDev: RatioCell;
  beta: RatioCell;
  sharpe: RatioCell;
  sortino: RatioCell;
  alpha: RatioCell;
}
interface RatiosSnapshot {
  benchmark: string;
  windowMonths: number;
  params: { riskFreeRate: number; marketReturn: number };
  funds: Record<string, RatiosFund>;
}
interface LatestFund {
  schemecode: string;
  nav: number;
  navDate: string;
}
interface LatestSnapshot {
  feedDate: string;
  funds: LatestFund[];
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function mapArrow(a: HoldingArrow): Arrow {
  if (a === "up") return "up";
  if (a === "down") return "down";
  if (a === "missing" || a === "unknown") return "missing";
  return "none";
}

function cohortKey(c: string | null, plan: string, option: string): string {
  return `${c ?? "(unclassified)"} | ${plan} | ${option}`;
}

/** Holdings rows sorted by the latest month's % of book (desc), shaped for export. */
function buildHoldings(portfolio: FundPortfolio): {
  rows: HoldingExportRow[];
  monthLabels: string[];
  monthBooksCr: (number | null)[];
} {
  const months = portfolio.meta.months ?? [];
  const monthLabels = months.map((m) => m.label);
  const slugs = monthLabels.map(monthSlug);
  const monthBooksCr = months.map((m) => {
    const v = m.aumCr;
    if (v === null || v === "" || v === "-") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });
  const latestSlug = slugs[0] ?? "";
  const withKey = portfolio.rows.map((r) => ({
    row: {
      company: r.company_name,
      months: slugs.map((slug, i) => {
        const c = r.months[slug];
        return {
          label: monthLabels[i],
          aumPct: c?.aum_pct_num ?? null,
          shares: c?.shares_num ?? null,
          arrow: mapArrow(c?.arrow ?? "missing"),
        };
      }),
    } satisfies HoldingExportRow,
    sortKey: r.months[latestSlug]?.aum_pct_num ?? -1,
  }));
  withKey.sort((a, b) => b.sortKey - a.sortKey);
  return { rows: withKey.map((w) => w.row), monthLabels, monthBooksCr };
}

// ---- Scheme export --------------------------------------------------------

const RATIO_DEFS: Array<{
  key: keyof RatiosFund;
  label: string;
  unit: "%" | "";
  higherBetter: boolean;
  signed: boolean;
}> = [
  { key: "stdDev", label: "Std Dev", unit: "%", higherBetter: false, signed: false },
  { key: "beta", label: "Beta", unit: "", higherBetter: false, signed: false },
  { key: "sharpe", label: "Sharpe", unit: "", higherBetter: true, signed: false },
  { key: "sortino", label: "Sortino", unit: "", higherBetter: true, signed: false },
  { key: "alpha", label: "Alpha", unit: "%", higherBetter: true, signed: true },
];

export async function gatherSchemeExport(args: {
  entry: FundDirectoryEntry;
  amc: string;
  portfolio: FundPortfolio | null;
  sectorRows: { label: string; fund: number | null; peerAvg: number | null }[];
  generatedAt: string;
}): Promise<SchemeExport> {
  const { entry, amc, sectorRows, generatedAt } = args;
  const [latest, returns, category, ratios, portfolio] = await Promise.all([
    getJson<LatestSnapshot>("/nav-data/mf-latest-nav.json"),
    getJson<ReturnsSnapshot>("/nav-data/mf-returns.json"),
    getJson<CategorySnapshot>("/nav-data/mf-category-returns.json"),
    getJson<RatiosSnapshot>("/nav-data/mf-ratios.json"),
    args.portfolio
      ? Promise.resolve(args.portfolio)
      : getJson<FundPortfolio>(entry.path),
  ]);

  const returnsByCode = new Map((returns?.funds ?? []).map((f) => [f.schemecode, f]));
  const categoryByCode = new Map((category?.fundRanks ?? []).map((f) => [f.schemecode, f]));
  const latestByCode = new Map((latest?.funds ?? []).map((f) => [f.schemecode, f]));

  // Plan keys: Regular = schemecode, Direct = `${schemecode}-D` (when present).
  const planCandidates: Array<{ plan: "Regular" | "Direct"; key: string }> = [
    { plan: "Regular" as const, key: entry.schemecode },
    { plan: "Direct" as const, key: `${entry.schemecode}-D` },
  ].filter((c) => returnsByCode.has(c.key));
  if (planCandidates.length === 0) {
    planCandidates.push({ plan: "Regular", key: entry.schemecode });
  }

  const plans: PlanProfile[] = planCandidates.map(({ plan, key }) => {
    const rfund = returnsByCode.get(key);
    const cfund = categoryByCode.get(key);
    const lfund = latestByCode.get(key);
    const returnRows: ReturnRow[] = PERIODS.map((p) => {
      const rc = rfund?.returns[p];
      const cc = cfund?.periodRanks[p];
      const stats = cc?.statsAvailable ? cc : null;
      return {
        period: p,
        cagr: CAGR_PERIODS.has(p),
        fundPct: rc ? rc.value : null,
        categoryAvgPct: stats?.categoryAverage ?? null,
        rank: stats?.rank ?? null,
        peerCount: stats?.peerCount ?? null,
        quartile: stats?.quartile ?? null,
        percentile: stats?.percentile ?? null,
      };
    });
    const rf = ratios?.funds[key];
    const ratioRows: RatioRow[] | null = rf
      ? RATIO_DEFS.map((d) => {
          const c = rf[d.key];
          return {
            label: d.label,
            fund: c.value,
            categoryAvg: c.categoryAverage,
            rank: c.rank,
            count: c.count,
            unit: d.unit,
            higherBetter: d.higherBetter,
            signed: d.signed,
          };
        })
      : null;
    return {
      plan,
      navLatest: lfund?.nav ?? null,
      navDate: lfund?.navDate ?? null,
      returns: returnRows,
      ratios: ratioRows,
    };
  });

  // Peer cohort: use the primary plan-key's cohort + the best available period.
  const primary = returnsByCode.get(entry.schemecode) ?? returns?.funds.find((f) => f.schemecode === entry.schemecode);
  const peerPlan = primary?.plan ?? "regular";
  const peerOption = primary?.option ?? "growth";
  const peerKey = cohortKey(entry.classification, peerPlan, peerOption);
  const cohortFunds = (category?.fundRanks ?? []).filter(
    (f) => cohortKey(f.classification, f.plan, f.option) === peerKey
  );
  // Pick the period most peers have a rank for (prefer 1Y, then descend/ascend).
  const PEER_PERIOD_ORDER: PeriodKey[] = ["1Y", "3Y", "6M", "3M", "1M", "5Y", "10Y"];
  let peerPeriod: PeriodKey = "1Y";
  for (const p of PEER_PERIOD_ORDER) {
    if (cohortFunds.some((f) => f.periodRanks[p]?.statsAvailable)) {
      peerPeriod = p;
      break;
    }
  }
  const peers: PeerRow[] = cohortFunds
    .map((f) => {
      const e = f.periodRanks[peerPeriod];
      const stats = e?.statsAvailable ? e : null;
      const ret = e && typeof e.return === "number" ? e.return : null;
      return {
        fund: cleanSchemeName(f.fundName),
        ret,
        rank: stats?.rank ?? null,
        peerCount: stats?.peerCount ?? null,
        percentile: stats?.percentile ?? null,
        quartile: stats?.quartile ?? null,
        vsMedianBps:
          stats && typeof stats.excessVsMedian === "number"
            ? ppToBps(stats.excessVsMedian)
            : null,
        selected: f.schemecode === entry.schemecode || f.schemecode === `${entry.schemecode}-D`,
      };
    })
    .sort((a, b) => {
      const ar = a.rank ?? Number.POSITIVE_INFINITY;
      const br = b.rank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return (b.ret ?? -Infinity) - (a.ret ?? -Infinity);
    });

  const sectors: SectorRow[] = sectorRows.map((s) => ({
    sector: s.label,
    fundPct: s.fund ?? 0,
    categoryAvgPct: s.peerAvg,
  }));

  const holdingsData = portfolio
    ? buildHoldings(portfolio)
    : { rows: [], monthLabels: [], monthBooksCr: [] };

  const peerCohortParts: string[] = [];
  if (entry.classification) peerCohortParts.push(entry.classification);
  peerCohortParts.push(peerPlan === "direct" ? "Direct" : "Regular");
  peerCohortParts.push(peerOption === "idcw" ? "IDCW" : "Growth");

  return {
    kind: "scheme",
    fundName: cleanSchemeName(entry.fund),
    category: entry.classification,
    amc,
    aumCr: entry.aumTotalCr,
    navAsOf: latest?.feedDate ?? null,
    asOfMonth: holdingsData.monthLabels[0] ?? portfolio?.meta.months[0]?.label ?? "",
    generatedAt,
    monthLabels: holdingsData.monthLabels,
    monthBooksCr: holdingsData.monthBooksCr,
    plans,
    ratiosMeta: ratios
      ? {
          benchmark: ratios.benchmark,
          windowMonths: ratios.windowMonths,
          riskFreeRate: ratios.params.riskFreeRate,
          marketReturn: ratios.params.marketReturn,
        }
      : null,
    sectors,
    peerCohortLabel: peerCohortParts.join(" · "),
    peerPeriod,
    peers,
    holdings: holdingsData.rows,
    holdingsSource: portfolio?.meta.source ?? "RupeeVest Portfolio Tracker",
  };
}

// ---- Fund-house export ----------------------------------------------------

function capSplit(portfolio: FundHousePortfolio): { large: number; mid: number; small: number } | null {
  const slug = monthSlug(portfolio.meta.months[0]?.label ?? "");
  const raw = { large: 0, mid: 0, small: 0 };
  let total = 0;
  for (const r of portfolio.rows) {
    const w = r.months[slug]?.aum_pct_num ?? 0;
    if (!w) continue;
    total += w;
    raw[classifyCap(r.company_name)] += w;
  }
  if (total <= 0) return null;
  return {
    large: (raw.large / total) * 100,
    mid: (raw.mid / total) * 100,
    small: (raw.small / total) * 100,
  };
}

function sectorMix(portfolio: FundHousePortfolio): { sector: string; pct: number }[] {
  const slug = monthSlug(portfolio.meta.months[0]?.label ?? "");
  const m = new Map<string, number>();
  let total = 0;
  for (const r of portfolio.rows) {
    const w = r.months[slug]?.aum_pct_num ?? 0;
    if (!w) continue;
    total += w;
    const s = classifySector(r.fincode, r.company_name);
    m.set(s, (m.get(s) ?? 0) + w);
  }
  if (total <= 0) return [];
  return [...m.entries()]
    .map(([sector, w]) => ({ sector, pct: (w / total) * 100 }))
    .sort(
      (a, b) =>
        (a.sector === UNCLASSIFIED ? 1 : 0) - (b.sector === UNCLASSIFIED ? 1 : 0) ||
        b.pct - a.pct
    );
}

export async function gatherFundHouseExport(args: {
  entry: FundHouseEntry;
  fundHouses: FundHouseEntry[];
  portfolio: FundHousePortfolio | null;
  generatedAt: string;
}): Promise<FundHouseExport> {
  const { entry, fundHouses, generatedAt } = args;
  const portfolio = args.portfolio ?? (await getJson<FundHousePortfolio>(entry.path));

  const holdingsData = portfolio
    ? buildHoldings(portfolio)
    : { rows: [], monthLabels: [], monthBooksCr: [] };

  const peers: FundHousePeerRow[] = [...fundHouses]
    .sort((a, b) => b.equityValueCr - a.equityValueCr)
    .map((p) => ({
      amc: p.amc,
      schemes: p.schemeCount,
      equityBookCr: p.equityValueCr,
      top10Pct: p.top10Pct,
      top10DeltaBps: p.top10DeltaPp === null ? null : ppToBps(p.top10DeltaPp),
      biggestBuyBps: p.biggestAdd ? ppToBps(p.biggestAdd.pp) : null,
      biggestBuyName: p.biggestAdd?.company ?? "",
      biggestSellBps: p.biggestTrim ? ppToBps(p.biggestTrim.pp) : null,
      biggestSellName: p.biggestTrim?.company ?? "",
      selected: p.slug === entry.slug,
    }));

  return {
    kind: "fund-house",
    amc: entry.amc,
    schemeCount: entry.schemeCount,
    holdingsCount: entry.holdingsCount,
    equityValueCr: entry.equityValueCr,
    latestMonth: entry.latestMonth,
    generatedAt,
    monthLabels: holdingsData.monthLabels,
    monthBooksCr: holdingsData.monthBooksCr,
    capMix: portfolio ? capSplit(portfolio) : null,
    sectorMix: portfolio ? sectorMix(portfolio) : [],
    peers,
    holdings: holdingsData.rows,
    holdingsSource: portfolio?.meta.source ?? "RupeeVest Portfolio Tracker (aggregated)",
  };
}
