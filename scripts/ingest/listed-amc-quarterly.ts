import * as cheerio from "cheerio";
import {
  fetchText,
  info,
  mergeBySlugQuarter,
  nowIso,
  parseNumberLoose,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";
import type {
  AmcAaumQuarterlySnapshot,
  AmcQuarterlyRow,
  AmcQuarterlySnapshot,
} from "../../src/data/snapshots/types";

interface ListedAmc {
  slug: string;
  ticker: string;
  amfiName: string;
  /**
   * Optional override of the screener URL. When set, takes precedence
   * over the default consolidated path. Use the bare /company/{ticker}/
   * form when the consolidated page returns an annual / TTM layout
   * (currently the case for ICICIAMC).
   */
  sourceUrl?: string;
  /**
   * Whether the resolved page is the consolidated variant. Defaults to
   * true. Currently only affects logs / provenance.
   */
  consolidated?: boolean;
}

const LISTED: ListedAmc[] = [
  { slug: "hdfc", ticker: "HDFCAMC", amfiName: "HDFC Mutual Fund" },
  {
    slug: "nippon",
    ticker: "NAM-INDIA",
    amfiName: "Nippon India Mutual Fund",
  },
  {
    slug: "absl",
    ticker: "ABSLAMC",
    amfiName: "Aditya Birla Sun Life Mutual Fund",
  },
  { slug: "uti", ticker: "UTIAMC", amfiName: "UTI Mutual Fund" },
  // ICICI Prudential Asset Management Company. The /consolidated/ variant
  // returns an annual/TTM layout for this ticker (~110 bps realisation
  // when mapped to quarter slots — see PR #18 rollback). The standalone
  // /company/ICICIAMC/ page exposes the standard Quarterly Results table.
  // Sanity guards (MIN_QUARTERS_PER_AMC + realization/margin caps) keep
  // us safe if this layout drifts again.
  {
    slug: "icici-pru",
    ticker: "ICICIAMC",
    amfiName: "ICICI Prudential Mutual Fund",
    sourceUrl: "https://www.screener.in/company/ICICIAMC/",
    consolidated: false,
  },
];

/**
 * A successfully-parsed AMC must have at least this many quarter columns
 * for us to accept the page as the standard quarterly results table. If
 * a page returns 1-3 columns it's almost certainly an annual / half-year
 * / TTM table layout that we'd map into quarter slots incorrectly.
 */
const MIN_QUARTERS_PER_AMC = 4;

/**
 * Caps used as final post-parse sanity guards. Listed AMCs (HDFC, Nippon,
 * ABSL, UTI, ICICI Pru) report quarterly revenue realisation in the
 * 35-60 bps range and operating margins in the 25-55 bps range; values
 * far outside that envelope almost always indicate the parser hit the
 * wrong table layout (annual / TTM / consolidated parent rather than
 * the AMC subsidiary). A breach causes us to reject the entire AMC's
 * fetched rows and preserve prior history via the merge helper.
 */
const REASONABLE_REALIZATION_BPS_MAX = 90;
const REASONABLE_OP_MARGIN_BPS_MAX = 75;

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthLabelToQuarter(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) return null;
  const monthNum = MONTHS_LOOKUP[m[1].toLowerCase()];
  if (!monthNum) return null;
  const year = Number(m[2]);
  const calendarQ = Math.ceil(monthNum / 3);
  return `${year}-Q${calendarQ}`;
}

interface ScreenerQuarter {
  quarter: string;
  /** "Sales" row from screener — for AMC issuers this is Revenue from
   *  Operations and excludes "Other Income". */
  revenueFromOperations: number;
  /** Optional "Other Income" row — display only, never feeds Revenue
   *  Realization. */
  otherIncome: number;
  operatingProfit: number;
  pat: number;
}

export function parseScreenerQuarterly(html: string): ScreenerQuarter[] {
  const $ = cheerio.load(html);

  let table = $("section#quarters table").first();
  if (!table.length) {
    table = $("table")
      .filter((_, t) => /quarterly\s+result/i.test($(t).prevAll("h2,h3").first().text()))
      .first();
  }
  if (!table.length) {
    table = $("table")
      .filter((_, t) => /sales|revenue/i.test($(t).find("tbody tr").first().find("td").first().text()))
      .first();
  }
  if (!table.length) return [];

  const headerCells = table
    .find("thead tr th")
    .map((_, el) => $(el).text().trim())
    .get();
  const quarters = headerCells.slice(1).map(monthLabelToQuarter);

  const valuesByMetric: Record<string, number[]> = {};
  table.find("tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td, th")
      .map((_, c) => $(c).text().trim())
      .get();
    if (cells.length < 2) return;
    const label = cells[0].toLowerCase().replace(/\s+/g, " ").trim();
    const numbers = cells.slice(1).map((v) => parseNumberLoose(v) ?? 0);
    valuesByMetric[label] = numbers;
  });

  // Screener's "Sales" row on a finance-company consolidated page IS the
  // Revenue from Operations line — Other Income is published separately.
  // We deliberately do NOT use the "revenue" alias here, because "Revenue"
  // in some screener variants means Total Income (Sales + Other).
  const sales =
    valuesByMetric["sales"] ||
    valuesByMetric["sales +"] ||
    valuesByMetric["revenue from operations"] ||
    [];
  const otherIncome = valuesByMetric["other income"] || [];
  const opProfit =
    valuesByMetric["operating profit"] ||
    valuesByMetric["operating profit +"] ||
    [];
  const pat =
    valuesByMetric["net profit"] ||
    valuesByMetric["net profit +"] ||
    valuesByMetric["profit after tax"] ||
    [];

  const out: ScreenerQuarter[] = [];
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    if (!q) continue;
    const rev = sales[i];
    const oi = otherIncome[i] ?? 0;
    const op = opProfit[i];
    const profit = pat[i];
    if (!rev && !op && !profit) continue;
    out.push({
      quarter: q,
      revenueFromOperations: rev ?? 0,
      otherIncome: oi,
      operatingProfit: op ?? 0,
      pat: profit ?? 0,
    });
  }
  return out;
}

async function fetchOne(
  amc: ListedAmc,
  aaumLookup: Map<string, number>
): Promise<AmcQuarterlyRow[]> {
  const useConsolidated = amc.consolidated !== false;
  const primaryUrl =
    amc.sourceUrl ??
    `https://www.screener.in/company/${amc.ticker}/${useConsolidated ? "consolidated/" : ""}`;
  info(
    `listed-amc-q: ${amc.slug} → ${primaryUrl}${useConsolidated ? "" : " (standalone)"}`
  );
  let html: string;
  try {
    html = await fetchText(primaryUrl);
  } catch (err) {
    // Only fall back if the AMC didn't pin a custom URL (i.e. the default
    // consolidated path). A pinned override should not silently switch
    // pages.
    if (amc.sourceUrl) throw err;
    warn(
      `  ${amc.slug} consolidated → ${(err as Error).message}; trying standalone`
    );
    const fallback = `https://www.screener.in/company/${amc.ticker}/`;
    html = await fetchText(fallback);
  }
  const quarterly = parseScreenerQuarterly(html);
  info(`  → parsed ${quarterly.length} quarters for ${amc.slug}`);
  // Sanity check: standard screener quarterly tables show 12-13 columns.
  // 1-3 columns means we landed on an annual / half-year / TTM layout and
  // would write garbage into quarter slots. Reject and let the merge
  // preserve any prior (good) rows for this AMC.
  if (quarterly.length > 0 && quarterly.length < MIN_QUARTERS_PER_AMC) {
    warn(
      `listed-amc-q: ${amc.slug} returned only ${quarterly.length} quarter(s) (< ${MIN_QUARTERS_PER_AMC}) — likely annual/TTM layout; rejecting page`
    );
    return [];
  }

  // Per-row hygiene: drop rows where the numerator is missing/non-positive
  // or PAT is non-finite. These typically come from blank columns or
  // trailing TTM rows.
  const valid = quarterly.filter(
    (q) =>
      q.revenueFromOperations > 0 && Number.isFinite(q.pat)
  );
  if (valid.length < MIN_QUARTERS_PER_AMC) {
    warn(
      `listed-amc-q: ${amc.slug} only ${valid.length} valid row(s) after hygiene filter (< ${MIN_QUARTERS_PER_AMC}); rejecting page`
    );
    return [];
  }

  // Realization / op-margin sanity envelope. Compute against the live
  // AMFI MF QAAUM for the most recent quarter where both sides exist.
  // If a value falls outside the envelope we reject the entire AMC's
  // fetch — a parser-level layout mismatch typically affects every row.
  const sortedDesc = [...valid].sort((a, b) =>
    b.quarter.localeCompare(a.quarter)
  );
  const checked = sortedDesc.find((q) =>
    aaumLookup.has(`${amc.slug}::${q.quarter}`)
  );
  if (checked) {
    const aaum = aaumLookup.get(`${amc.slug}::${checked.quarter}`)!;
    const realization =
      (checked.revenueFromOperations * 4 * 10_000) / aaum;
    const opMargin = (checked.operatingProfit * 4 * 10_000) / aaum;
    if (realization > REASONABLE_REALIZATION_BPS_MAX) {
      warn(
        `listed-amc-q: ${amc.slug} ${checked.quarter} realization ${realization.toFixed(1)} bps > ${REASONABLE_REALIZATION_BPS_MAX} cap — rejecting page (likely wrong table/parent layout)`
      );
      return [];
    }
    if (opMargin > REASONABLE_OP_MARGIN_BPS_MAX) {
      warn(
        `listed-amc-q: ${amc.slug} ${checked.quarter} op margin ${opMargin.toFixed(1)} bps > ${REASONABLE_OP_MARGIN_BPS_MAX} cap — rejecting page`
      );
      return [];
    }
    info(
      `listed-amc-q: ${amc.slug} sanity ok — ${checked.quarter} realization ${realization.toFixed(1)} bps · op margin ${opMargin.toFixed(1)} bps`
    );
  } else {
    info(
      `listed-amc-q: ${amc.slug} sanity check skipped — no overlapping AMFI quarter`
    );
  }

  return valid.map((q) => ({
    amcSlug: amc.slug,
    quarter: q.quarter,
    revenue: q.revenueFromOperations,
    revenueFromOperations: q.revenueFromOperations,
    otherIncome: q.otherIncome,
    operatingProfit: q.operatingProfit,
    pat: q.pat,
    avgAum: 0,
  }));
}

export async function ingestListedAmcQuarterly(): Promise<void> {
  info("=== listed-amc-quarterly ===");
  const fetched: AmcQuarterlyRow[] = [];
  const succeeded: string[] = [];
  const failed: string[] = [];

  // AMFI MF QAAUM lookup powers the realization / op-margin sanity guard.
  // Empty map is fine — guard simply skips for AMCs without overlap.
  const aaumSnap = await readSnapshot<AmcAaumQuarterlySnapshot>(
    "amc-aaum-quarterly.json"
  );
  const aaumLookup = new Map<string, number>();
  if (aaumSnap) {
    for (const r of aaumSnap.rows) {
      if (r.status === "ok" && r.avgAum > 0) {
        aaumLookup.set(`${r.amcSlug}::${r.quarter}`, r.avgAum);
      }
    }
  }
  info(
    `listed-amc-q: AAUM lookup loaded ${aaumLookup.size} (slug, quarter) entries for sanity guards`
  );

  for (const amc of LISTED) {
    try {
      const rows = await fetchOne(amc, aaumLookup);
      if (rows.length === 0) {
        warn(`listed-amc-q: ${amc.slug} returned 0 rows — preserving prior`);
        failed.push(amc.slug);
        continue;
      }
      fetched.push(...rows);
      succeeded.push(amc.slug);
    } catch (err) {
      warn(`listed-amc-q: ${amc.slug} failed → ${(err as Error).message}`);
      failed.push(amc.slug);
    }
  }

  // Merge into prior snapshot. Missing AMCs (in failed[]) keep their
  // historical rows untouched; refetched AMCs replace their (slug, quarter)
  // rows in place so corrections to a published quarter propagate.
  const prior =
    (await readSnapshot<AmcQuarterlySnapshot>("amc-quarterly.json"))?.rows ??
    [];

  if (fetched.length === 0) {
    warn(
      "listed-amc-q: no new rows parsed across all AMCs — keeping previous snapshot"
    );
    return;
  }

  const { rows: merged, stats } = mergeBySlugQuarter(prior, fetched);
  const fetchedQuarters = Array.from(
    new Set(fetched.map((r) => r.quarter))
  ).sort();
  const allQuarters = Array.from(new Set(merged.map((r) => r.quarter))).sort();
  const allSlugs = Array.from(new Set(merged.map((r) => r.amcSlug))).sort();

  info(
    `listed-amc-q: AMCs fetched=${succeeded.length}/${LISTED.length} ok=[${succeeded.join(", ")}] failed=[${failed.join(", ")}]`
  );
  info(
    `listed-amc-q: fetched ${fetched.length} rows across ${fetchedQuarters.length} quarters (${fetchedQuarters[0]}…${fetchedQuarters[fetchedQuarters.length - 1]})`
  );
  info(
    `listed-amc-q: merge — added=${stats.added} updated=${stats.updated} preserved=${stats.preserved} total=${stats.total}`
  );
  info(
    `listed-amc-q: snapshot range ${allQuarters[0]}…${allQuarters[allQuarters.length - 1]} · ${allSlugs.length} AMCs`
  );

  const snapshot: AmcQuarterlySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: "https://www.screener.in/company/{ticker}/consolidated/",
      notes: [
        "Quarterly P&L for listed Indian AMCs (HDFCAMC, NAM-INDIA, ABSLAMC, UTIAMC, ICICIAMC standalone). ICICIAMC uses /company/ICICIAMC/ — the consolidated variant returned an annual/TTM layout. Sanity guards: MIN_QUARTERS_PER_AMC=4, REVENUE_REALIZATION ≤ 90 bps, OP_MARGIN ≤ 75 bps; failures preserve prior history.",
        "Source mapping: screener.in 'Sales' row → Revenue from Operations (excludes Other Income); 'Other Income' captured separately for display only; 'Operating Profit' and 'Net Profit' as labelled. revenueFromOperations is what feeds Revenue Realization (bps of MF QAAUM). avgAum not provided by this source.",
        `lastSuccessfulFetchAt=${nowIso()} · slugsThisRun=[${succeeded.join(", ")}] · failedThisRun=[${failed.join(", ")}].`,
        `quartersCovered=${allQuarters.length} (${allQuarters[0]}…${allQuarters[allQuarters.length - 1]}) · rowCount=${stats.total} · fetchWindow=${fetchedQuarters.length}.`,
      ].join(" "),
    },
    rows: merged,
  };
  await writeSnapshot("amc-quarterly.json", snapshot);
  info("wrote amc-quarterly.json");
}
