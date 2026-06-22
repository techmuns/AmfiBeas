/**
 * Daily forward NAV refresh from AMFI's "Complete NAV Report" (NAVAll.txt) —
 * the same file the nav-download page serves when you click "Complete NAV
 * Report". One HTTP GET, no browser needed.
 *
 * mf-data/ is the one-time historical base (built by nav-history-from-mfdata
 * .ts). This script extends it forward: it reads the committed per-plan history
 * files, and for each tracked plan-series appends the feed's latest NAV when
 * it's newer than the series' last date. Both Regular ("{schemecode}") and
 * Direct ("{schemecode}-D") plan-series advance — each carries its AMFI scheme
 * code in its meta, which is what we look the feed up by.
 *
 * Safety (keep-last-good): on a failed/empty fetch, or if the feed parses to
 * fewer than the floor of scheme rows, NOTHING is written and the script exits
 * non-zero (so the workflow's commit step is skipped). Never-rewind: a feed
 * date on/before a series' last date is ignored. A run where no fund advances
 * is a clean no-op (exit 0, nothing to commit).
 *
 * After this, run nav-returns + nav-category-returns to refresh the derived
 * snapshots.
 *
 * Run: npm run ingest:nav:daily
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";
import {
  atomicWriteJson,
  availablePeriods,
  isoToDDMMMYYYY,
  planKeyRank,
  streamNavRows,
  type HistoryFile,
  type ManifestFund,
  type PeriodKey,
} from "./mfdata-nav";

// "Complete NAV Report" → NAVAll.txt. Primary host is the portal CDN; the
// www host serves the same file and is tried as a fallback.
const NAV_URLS = [
  "https://portal.amfiindia.com/spages/NAVAll.txt",
  "https://www.amfiindia.com/spages/NAVAll.txt",
];
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-history-manifest.json");
const LATEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");

// Catastrophic-fetch floor: a healthy NAVAll.txt has ~10k+ scheme rows.
const MIN_FEED_ROWS = 1000;

interface ManifestFile {
  generatedAt: string;
  source: string;
  stage: number;
  requestedRange: { from: string; to: string; windowCount: number };
  totalFunds: number;
  fundsAvailable: number;
  fundsMissing: number;
  periodCoverage: Record<PeriodKey, number>;
  ruleVersion: number;
  parserVersion: number;
  funds: ManifestFund[];
}

async function fetchFeed(): Promise<string> {
  let lastErr: Error | null = null;
  for (const url of NAV_URLS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
      info(`fetching ${url}`);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > 0) return text;
      throw new Error("empty body");
    } catch (e) {
      lastErr = e as Error;
      warn(`  ${url} failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr ?? new Error("all NAV URLs failed");
}

async function main(): Promise<void> {
  const generatedAt = nowIso();

  // 1) Fetch + parse the feed → latest NAV per AMFI scheme code.
  let text: string;
  try {
    text = await fetchFeed();
  } catch (e) {
    warn(`feed fetch failed (${(e as Error).message}); keeping previous snapshot, not writing.`);
    process.exit(1);
  }
  const latestByCode = new Map<number, { nav: number; iso: string }>();
  streamNavRows(text, (code, nav, iso) => {
    const ex = latestByCode.get(code);
    if (!ex || iso > ex.iso) latestByCode.set(code, { nav, iso });
  });
  info(`feed: ${latestByCode.size} schemes with a latest NAV`);
  if (latestByCode.size < MIN_FEED_ROWS) {
    warn(`feed parsed only ${latestByCode.size} schemes (< ${MIN_FEED_ROWS}); keeping previous snapshot, not writing.`);
    process.exit(1);
  }

  // 2) Read the manifest (drives which plan-series exist + their files) and
  //    carry over hasHoldings from the previous latest snapshot (it's directory
  //    metadata, not derivable from the feed).
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as ManifestFile;
  info(`manifest: ${manifest.totalFunds} plan-series`);
  const holdingsFlags = new Map<string, boolean>();
  try {
    const prev = JSON.parse(await fs.readFile(LATEST_PATH, "utf8")) as { funds: Array<{ schemecode: string; hasHoldings?: boolean }> };
    for (const f of prev.funds) holdingsFlags.set(f.schemecode, Boolean(f.hasHoldings));
  } catch {
    /* first run / missing — default all false */
  }

  // 3) Walk each plan-series: append the feed's latest NAV when newer, and
  //    rebuild the manifest + latest entries from the (possibly extended)
  //    series. History files are rewritten only when they actually advance.
  const newManifestFunds: ManifestFund[] = [];
  const latestFunds: Array<Record<string, unknown>> = [];
  const periodCoverage: Record<PeriodKey, number> = { "1M": 0, "3M": 0, "6M": 0, "1Y": 0, "3Y": 0, "5Y": 0 };
  let advanced = 0;
  let maxLastDate = "";
  const issues: string[] = [];

  for (const mf of manifest.funds) {
    const filePath = path.resolve(process.cwd(), mf.path);
    let history: HistoryFile;
    try {
      history = JSON.parse(await fs.readFile(filePath, "utf8")) as HistoryFile;
    } catch (e) {
      issues.push(`${mf.schemecode}: could not read ${mf.path}: ${(e as Error).message}`);
      continue;
    }

    const feed = latestByCode.get(history.meta.amfiSchemeCode);
    const prevLast = history.meta.lastDate;
    if (feed && (prevLast === null || feed.iso > prevLast)) {
      history.series.push([feed.iso, feed.nav]);
      history.meta.lastDate = feed.iso;
      history.meta.points = history.series.length;
      history.meta.firstDate = history.series[0][0];
      history.meta.lastForwardAppendAt = generatedAt;
      history.meta.provenance.forwardSource = "AMFI NAVAll.txt (nav-daily-refresh.ts)";
      await atomicWriteJson(fs, filePath, history);
      advanced += 1;
    }

    const periods = availablePeriods(history.series);
    for (const p of periods) periodCoverage[p] += 1;
    const lastDate = history.meta.lastDate;
    if (lastDate && lastDate > maxLastDate) maxLastDate = lastDate;

    newManifestFunds.push({
      schemecode: mf.schemecode,
      amfiSchemeCode: history.meta.amfiSchemeCode,
      fundName: history.meta.fundName,
      classification: history.meta.classification,
      firstDate: history.meta.firstDate,
      lastDate: history.meta.lastDate,
      points: history.meta.points,
      available: history.meta.points > 0,
      availablePeriods: periods,
      path: mf.path,
    });
    latestFunds.push({
      schemecode: mf.schemecode,
      fundName: history.meta.fundName,
      classification: history.meta.classification,
      amfiSchemeCode: history.meta.amfiSchemeCode,
      amfiSchemeName: history.meta.amfiSchemeName,
      amfiAmcName: history.meta.amfiAmcName,
      isin: history.meta.isin,
      plan: history.meta.plan,
      option: history.meta.option,
      nav: history.series[history.series.length - 1]?.[1] ?? null,
      navDate: lastDate ? isoToDDMMMYYYY(lastDate) : null,
      matchConfidence: "exact",
      matchedBy: "mf-data+amfi-daily",
      hasHoldings: holdingsFlags.get(mf.schemecode) ?? false,
    });
  }

  if (issues.length > 0) {
    warn(`${issues.length} per-fund read issues; keeping previous snapshot, not writing.`);
    for (const i of issues.slice(0, 5)) warn(`  - ${i}`);
    process.exit(1);
  }

  // 4) Rewrite the manifest + latest snapshot (stable order). The returns +
  //    category scripts run next and re-validate periodCoverage exactly.
  const byKey = (a: { schemecode: string }, b: { schemecode: string }) => {
    const ra = planKeyRank(a.schemecode), rb = planKeyRank(b.schemecode);
    return ra[0] - rb[0] || ra[1] - rb[1] || a.schemecode.localeCompare(b.schemecode);
  };
  newManifestFunds.sort(byKey);
  latestFunds.sort((a, b) => byKey(a as { schemecode: string }, b as { schemecode: string }));

  const newManifest: ManifestFile = {
    ...manifest,
    generatedAt,
    requestedRange: { ...manifest.requestedRange, to: maxLastDate ? isoToDDMMMYYYY(maxLastDate) : manifest.requestedRange.to },
    totalFunds: newManifestFunds.length,
    fundsAvailable: newManifestFunds.filter((f) => f.available).length,
    fundsMissing: newManifestFunds.filter((f) => !f.available).length,
    periodCoverage,
    funds: newManifestFunds,
  };
  await atomicWriteJson(fs, MANIFEST_PATH, newManifest);
  await atomicWriteJson(fs, LATEST_PATH, {
    generatedAt,
    source: "AMFI NAVAll.txt (daily) over mf-data base",
    feedDate: maxLastDate ? isoToDDMMMYYYY(maxLastDate) : null,
    ruleVersion: manifest.ruleVersion,
    parserVersion: manifest.parserVersion,
    funds: latestFunds,
  });

  info("================ NAV DAILY REFRESH SUMMARY ================");
  info(`plan-series advanced: ${advanced}/${manifest.totalFunds} · latest feed date ${maxLastDate ? isoToDDMMMYYYY(maxLastDate) : "?"}`);
  info(`period coverage: 1M=${periodCoverage["1M"]} 3M=${periodCoverage["3M"]} 6M=${periodCoverage["6M"]} 1Y=${periodCoverage["1Y"]} 3Y=${periodCoverage["3Y"]} 5Y=${periodCoverage["5Y"]}`);
  if (advanced === 0) info("no fund advanced — clean no-op (nothing to commit).");
  info("Next: npm run ingest:nav:returns && npm run ingest:nav:category-returns");
  info("==========================================================");
}

main().catch((e) => {
  warn(`nav-daily-refresh failed: ${(e as Error).message}`);
  warn((e as Error).stack ?? "");
  process.exit(1);
});
