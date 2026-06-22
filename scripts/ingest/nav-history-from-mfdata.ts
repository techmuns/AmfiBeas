/**
 * Build NAV history + snapshots from the local AMFI bulk CSVs at
 * mf-data/YYYY/MM/DD.csv (the AMFI "NAV history report" layout:
 *   Scheme Code;Scheme Name;ISIN…Growth;ISIN…Reinvestment;Net Asset Value;
 *   Repurchase Price;Sale Price;Date
 * one file per calendar day, ~10 years deep).
 *
 * This REPLACES the old AMFI DownloadNAVHistoryReport_Po.aspx API backfill:
 * the full daily NAV history is now read straight off disk. RupeeVest is no
 * longer used for NAV (it remains the source of the fund directory + monthly
 * holdings only). The daily go-forward refresh is nav-daily-refresh.ts.
 *
 * For every tracked fund we resolve BOTH its Regular and Direct plan and emit
 * one history file per plan, keyed:
 *   - "{schemecode}"     → Regular plan      → public/nav-history/{schemecode}.json
 *   - "{schemecode}-D"   → Direct plan       → public/nav-history/{schemecode}-D.json
 *
 * Outputs (the SAME shape the API backfill produced, so consumers are
 * untouched): public/nav-history/{key}.json, mf-history-manifest.json,
 * mf-latest-nav.json. Then run nav-returns + nav-category-returns.
 *
 * Run: npm run build:nav-history
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";
import {
  buildCrosswalk,
  loadOverrides,
  normalize,
  pct,
  DEFAULT_INDEX_PATH,
  DEFAULT_OVERRIDES_PATH,
  type IndexFile,
  type MatchRow,
} from "./nav-crosswalk";
import {
  atomicWriteJson,
  availablePeriods,
  inferOption,
  inferPlan,
  isEtfName,
  isFofName,
  isoToDDMMMYYYY,
  parseNavCsvFull,
  planKeyRank,
  streamNavRows,
  type HistoryFile,
  type ManifestFund,
  type Option,
  type PeriodKey,
  type Plan,
} from "./mfdata-nav";
import type { SchemeNav } from "../../src/data/snapshots/types";

const MF_DATA_DIR = path.resolve(process.cwd(), "mf-data");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const MANIFEST_PATH = path.resolve(process.cwd(), "public/nav-data/mf-history-manifest.json");
const LATEST_PATH = path.resolve(process.cwd(), "public/nav-data/mf-latest-nav.json");

const STAGE = 3; // 5Y-capable; the UI gates nothing further on stage.
const RULE_VERSION = 1;
const PARSER_VERSION = 2; // v2 = mf-data bulk-CSV source (was v1 = AMFI API)
// A "full" business-day file lists the whole scheme universe; weekend/holiday
// files carry only liquid/overnight/debt NAVs. We union the most recent full
// files as the crosswalk + plan-pairing reference (one day alone misses funds
// that report on a lag — e.g. international / ETF schemes).
const FULL_FILE_MIN_SCHEMES = 5000;
const REFERENCE_FULL_FILES = 10;

// ---------------------------------------------------------------------------
// Plan pairing — group the reference universe by (token-key, option) so each
// fund's Regular + Direct siblings sit together.
// ---------------------------------------------------------------------------

interface Sibling {
  amfiCode: number;
  isin: string | null;
  schemeName: string;
  amcName: string;
  plan: Plan;
  option: Option;
}
function pairingKey(schemeName: string): { key: string; plan: Plan; option: Option } {
  const n = normalize(schemeName);
  return { key: `${n.tokenKey}||${n.option}`, plan: n.plan, option: n.option };
}

interface Target {
  key: string; // schemecode | schemecode-D
  schemecode: string; // RupeeVest base code
  amfiCode: number;
  isin: string | null;
  plan: Plan;
  option: Option;
  isEtf: boolean;
  isFof: boolean;
  fundName: string;
  classification: string | null;
  amfiSchemeName: string;
  amfiAmcName: string;
  hasHoldings: boolean;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function listCsvFiles(): Promise<string[]> {
  const entries = await fs.readdir(MF_DATA_DIR, { recursive: true });
  return entries
    .filter((e) => e.endsWith(".csv") && !path.basename(e).startsWith(".~lock"))
    .map((e) => path.join(MF_DATA_DIR, e))
    .sort(); // mf-data/YYYY/MM/DD.csv → path sorts chronologically.
}

async function main(): Promise<void> {
  const generatedAt = nowIso();

  info(`reading directory ${path.relative(process.cwd(), DEFAULT_INDEX_PATH)}`);
  const indexFile = JSON.parse(await fs.readFile(DEFAULT_INDEX_PATH, "utf8")) as IndexFile;
  const holdingsByCode = new Map<string, boolean>();
  for (const f of indexFile.funds) holdingsByCode.set(String(f.schemecode), Boolean(f.file));

  const overrides = await loadOverrides(DEFAULT_OVERRIDES_PATH);
  info(`overrides: ${overrides.size} loaded`);

  const files = await listCsvFiles();
  if (files.length === 0) { warn("no mf-data CSV files found"); process.exit(1); }
  info(`mf-data: ${files.length} daily CSV files (${path.basename(files[0])} … ${path.basename(files[files.length - 1])})`);

  // 1) Reference universe = union of the most recent FULL business-day files,
  //    deduped by AMFI scheme code (newest record per code wins). A single day
  //    can miss funds that report on a lag — notably international / ETF
  //    schemes — so a multi-day union gives a complete, current scheme list.
  const byCode = new Map<number, SchemeNav>();
  const referenceFiles: string[] = [];
  for (let i = files.length - 1; i >= 0 && referenceFiles.length < REFERENCE_FULL_FILES; i--) {
    const parsed = parseNavCsvFull(await fs.readFile(files[i], "utf8"));
    if (parsed.length < FULL_FILE_MIN_SCHEMES) continue;
    referenceFiles.push(files[i]);
    for (const n of parsed) {
      const ex = byCode.get(n.schemeCode);
      if (!ex || n.date > ex.date) byCode.set(n.schemeCode, n);
    }
  }
  if (byCode.size === 0) { warn("no full business-day file found in mf-data"); process.exit(1); }
  const referenceNavs: SchemeNav[] = Array.from(byCode.values());
  const referenceFile = referenceFiles[0] ?? "";
  info(
    `reference universe: ${referenceNavs.length} schemes (union of ${referenceFiles.length} full days, ` +
      `newest ${path.relative(process.cwd(), referenceFile)})`
  );

  // 2) Crosswalk RupeeVest directory → AMFI scheme (production matches only).
  const cw = buildCrosswalk(indexFile.funds, referenceNavs, overrides.map);
  const matches: MatchRow[] = [...cw.autoMatches, ...cw.overrideMatches];
  info(
    `crosswalk: ${matches.length} production matches ` +
      `(auto=${cw.autoMatches.length} override=${cw.overrideMatches.length}); ` +
      `with-holdings coverage ${cw.matchedWithHoldings}/${cw.fundsWithHoldings} = ${pct(cw.matchedWithHoldings, cw.fundsWithHoldings)}%`
  );

  // 3) Plan-pairing index over the reference universe.
  const groups = new Map<string, { regular?: Sibling; direct?: Sibling }>();
  for (const n of referenceNavs) {
    const { key, plan, option } = pairingKey(n.schemeName);
    const sib: Sibling = { amfiCode: n.schemeCode, isin: n.isin ?? null, schemeName: n.schemeName, amcName: n.amcName, plan, option };
    let g = groups.get(key);
    if (!g) { g = {}; groups.set(key, g); }
    // A growth fund has exactly a Regular + Direct plan. The Regular plan is
    // often named "… Growth Plan" with no "Regular" marker (older schemes), so
    // detectPlan returns "unknown" for it — treat any NON-direct member as the
    // Regular sibling (forcing plan="regular") so the plan toggle resolves.
    if (plan === "direct") g.direct ??= sib;
    else g.regular ??= { ...sib, plan: "regular" };
  }

  // 4) Resolve a Regular + Direct target per matched fund.
  const targets: Target[] = [];
  let pairedBoth = 0, regularOnly = 0, directOnly = 0;
  for (const m of matches) {
    const { key } = pairingKey(m.amfiSchemeName);
    const g = groups.get(key);
    const matchedSib: Sibling = {
      amfiCode: m.amfiSchemeCode,
      isin: m.isin,
      schemeName: m.amfiSchemeName,
      amcName: m.amfiAmcName,
      plan: inferPlan(m.amfiSchemeName),
      option: inferOption(m.amfiSchemeName),
    };
    const reg = g?.regular ?? (matchedSib.plan !== "direct" ? matchedSib : undefined);
    const dir = g?.direct ?? (matchedSib.plan === "direct" ? matchedSib : undefined);
    const hasHoldings = holdingsByCode.get(m.schemecode) ?? false;
    const base = { schemecode: m.schemecode, fundName: m.fundName, classification: m.classification, amfiAmcName: m.amfiAmcName, hasHoldings };

    // Primary (unsuffixed) = Regular when available, else the only plan we have
    // — so the picker fund (which joins to Regular holdings) always resolves.
    const primary = reg ?? dir!;
    targets.push({
      ...base,
      key: m.schemecode,
      amfiCode: primary.amfiCode,
      isin: primary.isin,
      plan: primary.plan,
      option: primary.option,
      isEtf: isEtfName(primary.schemeName, m.classification),
      isFof: isFofName(primary.schemeName, m.classification),
      amfiSchemeName: primary.schemeName,
    });
    if (dir && dir.amfiCode !== primary.amfiCode) {
      targets.push({
        ...base,
        key: `${m.schemecode}-D`,
        amfiCode: dir.amfiCode,
        isin: dir.isin,
        plan: "direct",
        option: dir.option,
        isEtf: isEtfName(dir.schemeName, m.classification),
        isFof: isFofName(dir.schemeName, m.classification),
        amfiSchemeName: dir.schemeName,
      });
      pairedBoth += 1;
    } else if (primary.plan === "direct") directOnly += 1;
    else regularOnly += 1;
  }
  info(`targets: ${targets.length} plan-series (both=${pairedBoth} regular-only=${regularOnly} direct-only=${directOnly})`);

  // 5) Stream every daily CSV, accumulating NAV series for the target AMFI codes.
  const targetCodes = new Set(targets.map((t) => t.amfiCode));
  const accum = new Map<number, Array<[string, number]>>();
  let processed = 0;
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    streamNavRows(text, (code, nav, iso) => {
      if (!targetCodes.has(code)) return;
      let arr = accum.get(code);
      if (!arr) { arr = []; accum.set(code, arr); }
      arr.push([iso, nav]);
    });
    processed += 1;
    if (processed % 500 === 0) info(`  …parsed ${processed}/${files.length} files`);
  }
  info(`accumulated NAV series for ${accum.size}/${targetCodes.size} distinct AMFI codes`);

  // 6) Sort + dedup each AMFI code's series once (shared across funds mapping
  //    to the same code).
  const seriesByCode = new Map<number, Array<[string, number]>>();
  for (const [code, rows] of accum) {
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const deduped: Array<[string, number]> = [];
    for (const r of rows) {
      const last = deduped[deduped.length - 1];
      if (last && last[0] === r[0]) last[1] = r[1]; // last-write-wins per date
      else deduped.push(r);
    }
    seriesByCode.set(code, deduped);
  }

  // 7) Wipe + rewrite the history dir, then write one file per target.
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  for (const name of await fs.readdir(HISTORY_DIR)) {
    if (name.endsWith(".json")) await fs.rm(path.join(HISTORY_DIR, name));
  }

  const manifestFunds: ManifestFund[] = [];
  const latestFunds: Array<Record<string, unknown>> = [];
  const periodCoverage: Record<PeriodKey, number> = { "1M": 0, "3M": 0, "6M": 0, "1Y": 0, "3Y": 0, "5Y": 0 };
  let written = 0;
  let maxLastDate = "";
  let minFirstDate = "9999-12-31";

  for (const t of targets) {
    const series = seriesByCode.get(t.amfiCode) ?? [];
    if (series.length === 0) continue;
    const firstDate = series[0][0];
    const lastDate = series[series.length - 1][0];
    const periods = availablePeriods(series);
    for (const p of periods) periodCoverage[p] += 1;
    if (lastDate > maxLastDate) maxLastDate = lastDate;
    if (firstDate < minFirstDate) minFirstDate = firstDate;

    const history: HistoryFile = {
      meta: {
        schemecode: t.key,
        amfiSchemeCode: t.amfiCode,
        isin: t.isin,
        fundName: t.fundName,
        amfiSchemeName: t.amfiSchemeName,
        amfiAmcName: t.amfiAmcName,
        classification: t.classification,
        plan: t.plan,
        option: t.option,
        isEtf: t.isEtf,
        isFof: t.isFof,
        firstDate,
        lastDate,
        points: series.length,
        stage: STAGE,
        ruleVersion: RULE_VERSION,
        parserVersion: PARSER_VERSION,
        generatedAt,
        lastForwardAppendAt: null,
        provenance: {
          backfillSource: "AMFI bulk CSV (mf-data/YYYY/MM/DD.csv)",
          source: "mf-data",
          parser: "scripts/ingest/nav-history-from-mfdata.ts",
          parserVersion: PARSER_VERSION,
          forwardSource: "AMFI NAVAll.txt (scripts/ingest/nav-daily-refresh.ts)",
          firstFile: path.relative(process.cwd(), files[0]),
          lastFile: path.relative(process.cwd(), files[files.length - 1]),
        },
      },
      series,
    };
    await atomicWriteJson(fs, path.join(HISTORY_DIR, `${t.key}.json`), history);
    written += 1;

    manifestFunds.push({
      schemecode: t.key,
      amfiSchemeCode: t.amfiCode,
      fundName: t.fundName,
      classification: t.classification,
      firstDate,
      lastDate,
      points: series.length,
      available: true,
      availablePeriods: periods,
      path: `public/nav-history/${t.key}.json`,
    });
    latestFunds.push({
      schemecode: t.key,
      fundName: t.fundName,
      classification: t.classification,
      amfiSchemeCode: t.amfiCode,
      amfiSchemeName: t.amfiSchemeName,
      amfiAmcName: t.amfiAmcName,
      isin: t.isin,
      plan: t.plan,
      option: t.option,
      nav: series[series.length - 1][1],
      navDate: isoToDDMMMYYYY(lastDate),
      matchConfidence: "exact",
      matchedBy: "mf-data",
      hasHoldings: t.hasHoldings,
    });
  }

  // 8) Stable ordering for reviewable diffs (numeric base, Regular before -D).
  const byKey = (a: { schemecode: string }, b: { schemecode: string }) => {
    const ra = planKeyRank(a.schemecode), rb = planKeyRank(b.schemecode);
    return ra[0] - rb[0] || ra[1] - rb[1] || a.schemecode.localeCompare(b.schemecode);
  };
  manifestFunds.sort(byKey);
  latestFunds.sort((a, b) => byKey(a as { schemecode: string }, b as { schemecode: string }));

  const manifest = {
    generatedAt,
    source: "AMFI bulk CSV (mf-data/YYYY/MM/DD.csv)",
    stage: STAGE,
    requestedRange: {
      from: isoToDDMMMYYYY(minFirstDate <= maxLastDate ? minFirstDate : maxLastDate),
      to: isoToDDMMMYYYY(maxLastDate),
      windowCount: files.length,
    },
    totalFunds: written,
    fundsAvailable: written,
    fundsMissing: 0,
    periodCoverage,
    ruleVersion: RULE_VERSION,
    parserVersion: PARSER_VERSION,
    funds: manifestFunds,
  };
  await atomicWriteJson(fs, MANIFEST_PATH, manifest);

  const latest = {
    generatedAt,
    source: "AMFI bulk CSV (mf-data/YYYY/MM/DD.csv)",
    feedDate: maxLastDate ? isoToDDMMMYYYY(maxLastDate) : null,
    ruleVersion: RULE_VERSION,
    parserVersion: PARSER_VERSION,
    funds: latestFunds,
  };
  await atomicWriteJson(fs, LATEST_PATH, latest);

  info("================ NAV HISTORY (mf-data) SUMMARY ================");
  info(`reference: ${path.relative(process.cwd(), referenceFile)} · feedDate ${latest.feedDate}`);
  info(`history files written: ${written} (Regular + Direct plan-series)`);
  info(`period coverage: 1M=${periodCoverage["1M"]} 3M=${periodCoverage["3M"]} 6M=${periodCoverage["6M"]} 1Y=${periodCoverage["1Y"]} 3Y=${periodCoverage["3Y"]} 5Y=${periodCoverage["5Y"]}`);
  info(`wrote ${path.relative(process.cwd(), MANIFEST_PATH)} + ${path.relative(process.cwd(), LATEST_PATH)}`);
  info("Next: npm run ingest:nav:returns && npm run ingest:nav:category-returns");
  info("==============================================================");
}

main().catch((e) => {
  warn(`nav-history-from-mfdata failed: ${(e as Error).message}`);
  warn((e as Error).stack ?? "");
  process.exit(1);
});
