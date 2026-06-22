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
 * holdings only).
 *
 * For every tracked fund we resolve BOTH its Regular and Direct plan and emit
 * one history file per plan, keyed:
 *   - "{schemecode}"     → Regular plan      → public/nav-history/{schemecode}.json
 *   - "{schemecode}-D"   → Direct plan       → public/nav-history/{schemecode}-D.json
 * The plan-key is what every downstream snapshot keys on, so the existing
 * returns + category-rank scripts (which already cohort by plan) run unchanged,
 * and the Trends tab's plan toggle just swaps the key.
 *
 * Outputs (all in the SAME shape the API backfill produced, so consumers are
 * untouched):
 *   - public/nav-history/{key}.json
 *   - src/data/snapshots/mf-history-manifest.json
 *   - src/data/snapshots/mf-latest-nav.json
 *
 * Then run, in order, to refresh the derived snapshots:
 *   npm run ingest:nav:returns
 *   npm run ingest:nav:category-returns
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
import type { SchemeNav } from "../../src/data/snapshots/types";

const MF_DATA_DIR = path.resolve(process.cwd(), "mf-data");
const HISTORY_DIR = path.resolve(process.cwd(), "public/nav-history");
const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-history-manifest.json");
const LATEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");

const STAGE = 3; // 5Y-capable; the UI gates nothing further on stage.
const RULE_VERSION = 1;
const PARSER_VERSION = 2; // v2 = mf-data bulk-CSV source (was v1 = AMFI API)
// A "full" business-day file lists the whole scheme universe; weekend/holiday
// files carry only liquid/overnight/debt NAVs. We pick the most recent full
// file as the crosswalk + plan-pairing reference.
const FULL_FILE_MIN_SCHEMES = 5000;

type Plan = "direct" | "regular" | "unknown";
type Option = "growth" | "idcw" | "unknown";
type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

// ---------------------------------------------------------------------------
// CSV parsing (header-driven, tolerant of column reordering)
// ---------------------------------------------------------------------------

const SECTION_LINE_RE = /^(Open|Close|Interval) Ended Schemes.*/i;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ddMMMyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function isoToDDMMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  const mi = Number(m) - 1;
  return `${d}-${MONTH_ABBR[mi] ?? m}-${y}`;
}

interface ColumnMap {
  schemeCode: number;
  schemeName: number;
  isinGrowth: number;
  isinReinv: number;
  nav: number;
  date: number;
}
function buildColumnMap(headerCells: string[]): ColumnMap | null {
  const idxOf = (re: RegExp) => headerCells.findIndex((c) => re.test(c));
  const isinIdxs = headerCells.map((c, i) => ({ c, i })).filter((x) => /isin/i.test(x.c)).map((x) => x.i);
  const dateIdxs = headerCells.map((c, i) => ({ c, i })).filter((x) => /date/i.test(x.c)).map((x) => x.i);
  const map: ColumnMap = {
    schemeCode: idxOf(/scheme\s*code/i),
    schemeName: idxOf(/scheme\s*name/i),
    isinGrowth: isinIdxs[0] ?? -1,
    isinReinv: isinIdxs[1] ?? -1,
    nav: idxOf(/net\s*asset\s*value/i),
    date: dateIdxs.length ? dateIdxs[dateIdxs.length - 1] : -1,
  };
  if (map.schemeCode < 0 || map.schemeName < 0 || map.nav < 0 || map.date < 0) return null;
  return map;
}

/** Full parse → SchemeNav[] (for the crosswalk + plan-pairing reference). */
function parseNavCsvFull(text: string): SchemeNav[] {
  const out: SchemeNav[] = [];
  let cm: ColumnMap | null = null;
  let amcName = "";
  let category = "";
  const codeMap = new Map<string, number>();
  let nextAmc = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_LINE_RE.test(line)) { category = line; continue; }
    if (/^scheme\s*code/i.test(line)) {
      cm = buildColumnMap(line.split(";").map((s) => s.trim()));
      continue;
    }
    if (!line.includes(";")) {
      amcName = line;
      if (!codeMap.has(amcName)) codeMap.set(amcName, nextAmc++);
      continue;
    }
    if (!cm) continue;
    const parts = line.split(";").map((s) => s.trim());
    const code = Number(parts[cm.schemeCode]);
    const nav = Number(parts[cm.nav] ?? "");
    const iso = ddMMMyyyyToIso(parts[cm.date] ?? "");
    if (!Number.isFinite(code) || !Number.isFinite(nav) || nav <= 0 || iso === null) continue;
    const isinG = cm.isinGrowth >= 0 ? parts[cm.isinGrowth] : "";
    const isinR = cm.isinReinv >= 0 ? parts[cm.isinReinv] : "";
    const isin = isinG && isinG !== "-" ? isinG : isinR && isinR !== "-" ? isinR : undefined;
    out.push({
      schemeCode: code,
      amcCode: codeMap.get(amcName) ?? 0,
      amcName,
      category,
      schemeName: parts[cm.schemeName] ?? "",
      isin,
      nav,
      date: iso,
    });
  }
  return out;
}

/** Streaming accumulate: only target codes, only [isoDate, nav]. */
function accumulateFile(
  text: string,
  targetCodes: Set<number>,
  accum: Map<number, Array<[string, number]>>
): void {
  let cm: ColumnMap | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_LINE_RE.test(line)) continue;
    if (/^scheme\s*code/i.test(line)) {
      cm = buildColumnMap(line.split(";").map((s) => s.trim()));
      continue;
    }
    if (!line.includes(";") || !cm) continue;
    const parts = line.split(";");
    const code = Number(parts[cm.schemeCode]);
    if (!Number.isFinite(code) || !targetCodes.has(code)) continue;
    const nav = Number(parts[cm.nav]);
    const iso = ddMMMyyyyToIso((parts[cm.date] ?? "").trim());
    if (!Number.isFinite(nav) || nav <= 0 || iso === null) continue;
    let arr = accum.get(code);
    if (!arr) { arr = []; accum.set(code, arr); }
    arr.push([iso, nav]);
  }
}

// ---------------------------------------------------------------------------
// Name-derived scheme attributes (mirrors the API backfill's detectors)
// ---------------------------------------------------------------------------

function inferPlan(name: string): Plan {
  const s = name.toLowerCase();
  if (/-reg|\(reg\)|\bregular\b/.test(s)) return "regular";
  if (/-dir|\(dir\)|\bdirect\b/.test(s)) return "direct";
  if (/\((g|idcw|dividend)\)/.test(s)) return "direct";
  return "unknown";
}
function inferOption(name: string): Option {
  const s = name.toLowerCase();
  if (/\b(idcw|dividend|div\b)/.test(s)) return "idcw";
  if (/\bgrowth\b|\((g|growth)\)/.test(s)) return "growth";
  return "unknown";
}
function isEtfName(name: string, cls: string | null): boolean {
  return /\b(etf|exchange traded)\b/i.test(name) || (cls ?? "").includes("ETF");
}
function isFofName(name: string, cls: string | null): boolean {
  return /\bfof\b|\bfund of funds?\b/i.test(name) || (cls ?? "").includes("FoFs");
}

// ---------------------------------------------------------------------------
// Return-period availability — REPLICATES scripts/ingest/nav-returns.ts so the
// manifest's periodCoverage matches what that script later computes (it
// validates exact equality before writing).
// ---------------------------------------------------------------------------

function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
function nearestPrior(series: Array<[string, number]>, target: string): [string, number] | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i][0] <= target) return series[i];
  return null;
}
function elapsedYears(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  return (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / (86400_000 * 365.25);
}
const PERIODS: Array<{ key: PeriodKey; months: number; years: number; cagr: boolean }> = [
  { key: "1M", months: 1, years: 0, cagr: false },
  { key: "3M", months: 3, years: 0, cagr: false },
  { key: "6M", months: 6, years: 0, cagr: false },
  { key: "1Y", months: 0, years: 1, cagr: false },
  { key: "3Y", months: 0, years: 3, cagr: true },
  { key: "5Y", months: 0, years: 5, cagr: true },
];
function availablePeriods(series: Array<[string, number]>): PeriodKey[] {
  const out: PeriodKey[] = [];
  if (series.length < 2) return out;
  const end = series[series.length - 1];
  const firstDate = series[0][0];
  for (const p of PERIODS) {
    const target = subPeriod(end[0], p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start[1] <= 0) continue;
    if (p.cagr) {
      const years = elapsedYears(start[0], end[0]);
      if (!(years > 0) || !(end[1] > 0) || !(start[1] > 0)) continue;
    }
    out.push(p.key);
  }
  return out;
}

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

// ---------------------------------------------------------------------------
// Output file types (byte-compatible with the API backfill's output)
// ---------------------------------------------------------------------------

interface HistoryFile {
  meta: {
    schemecode: string;
    amfiSchemeCode: number;
    isin: string | null;
    fundName: string;
    amfiSchemeName: string | null;
    amfiAmcName: string | null;
    classification: string | null;
    plan: Plan;
    option: Option;
    isEtf: boolean;
    isFof: boolean;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
    stage: number;
    ruleVersion: number;
    parserVersion: number;
    generatedAt: string;
    lastForwardAppendAt: string | null;
    provenance: {
      backfillSource: string;
      source: string;
      parser: string;
      parserVersion: number;
      firstFile: string;
      lastFile: string;
    };
  };
  series: Array<[string, number]>;
}

interface ManifestFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  available: boolean;
  availablePeriods: PeriodKey[];
  path: string;
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

async function atomicWriteJson(p: string, data: unknown): Promise<void> {
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function listCsvFiles(): Promise<string[]> {
  const entries = await fs.readdir(MF_DATA_DIR, { recursive: true });
  return entries
    .filter((e) => e.endsWith(".csv") && !path.basename(e).startsWith(".~lock"))
    .map((e) => path.join(MF_DATA_DIR, e))
    // mf-data/YYYY/MM/DD.csv → path sorts chronologically.
    .sort();
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

  // 1) Pick the most recent FULL business-day file as the crosswalk + pairing
  //    reference (weekend/holiday files only carry debt/liquid NAVs).
  let referenceNavs: SchemeNav[] | null = null;
  let referenceFile = "";
  for (let i = files.length - 1; i >= 0 && !referenceNavs; i--) {
    const parsed = parseNavCsvFull(await fs.readFile(files[i], "utf8"));
    if (parsed.length >= FULL_FILE_MIN_SCHEMES) { referenceNavs = parsed; referenceFile = files[i]; }
  }
  if (!referenceNavs) { warn("no full business-day file found in mf-data"); process.exit(1); }
  info(`reference universe: ${referenceNavs.length} schemes from ${path.relative(process.cwd(), referenceFile)}`);

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
    const sib: Sibling = {
      amfiCode: n.schemeCode,
      isin: n.isin ?? null,
      schemeName: n.schemeName,
      amcName: n.amcName,
      plan,
      option,
    };
    let g = groups.get(key);
    if (!g) { g = {}; groups.set(key, g); }
    if (plan === "regular") g.regular ??= sib;
    else if (plan === "direct") g.direct ??= sib;
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
    const base = {
      schemecode: m.schemecode,
      fundName: m.fundName,
      classification: m.classification,
      amfiAmcName: m.amfiAmcName,
      hasHoldings,
    };

    // Primary (unsuffixed) key = Regular when available, else the only plan we
    // have — so the picker fund (which joins to Regular holdings) always resolves.
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
    // Direct sibling, only when it's a distinct scheme from the primary.
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
    accumulateFile(await fs.readFile(file, "utf8"), targetCodes, accum);
    processed += 1;
    if (processed % 500 === 0) info(`  …parsed ${processed}/${files.length} files`);
  }
  info(`accumulated NAV series for ${accum.size}/${targetCodes.size} distinct AMFI codes`);

  // 6) Sort + dedup each AMFI code's series once (shared across funds that map
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
    if (series.length === 0) continue; // skip schemes with no NAV in the window
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
          firstFile: path.relative(process.cwd(), files[0]),
          lastFile: path.relative(process.cwd(), files[files.length - 1]),
        },
      },
      series,
    };
    await atomicWriteJson(path.join(HISTORY_DIR, `${t.key}.json`), history);
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

  // 8) Sort outputs by plan-key (numeric base, Regular before its -D) for
  //    stable, reviewable diffs.
  const keyRank = (k: string) => {
    const isD = k.endsWith("-D");
    const n = Number(isD ? k.slice(0, -2) : k);
    return [Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER, isD ? 1 : 0] as const;
  };
  const byKey = (a: { schemecode: string }, b: { schemecode: string }) => {
    const ra = keyRank(a.schemecode), rb = keyRank(b.schemecode);
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
  await atomicWriteJson(MANIFEST_PATH, manifest);

  const latest = {
    generatedAt,
    source: "AMFI bulk CSV (mf-data/YYYY/MM/DD.csv)",
    feedDate: maxLastDate ? isoToDDMMMYYYY(maxLastDate) : null,
    ruleVersion: RULE_VERSION,
    parserVersion: PARSER_VERSION,
    funds: latestFunds,
  };
  await atomicWriteJson(LATEST_PATH, latest);

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
